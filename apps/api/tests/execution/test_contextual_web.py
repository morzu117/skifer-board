"""Contrat figé et calculs contextuels sur les résultats autorisés."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import duckdb
import pytest
import yaml
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from identity.conftest import cles as cles
from identity.conftest import config as config
from identity.conftest import fournisseur as fournisseur
from identity.conftest import horloge as horloge
from skifer_board.catalog import CatalogService
from skifer_board.execution.runs import ExecutionStore
from skifer_board.state.schema import executions, telemetry
from skifer_board.telemetry import Recorder, TelemetryStore
from spaces.monde import (
    ADMIN_GROUPE,
    LECTEUR_GROUPE,
    LECTEUR_PERSONNE,
    PLATEFORME_SEULE,
    A,
    B,
    Monde,
)
from spaces.monde import config_plateforme as config_plateforme
from spaces.monde import monde as monde
from sqlalchemy import select, update
from state.conftest import migre as migre

from execution.test_runs_web import (
    BODY,
    CONTRACTS,
    PATH,
    _call,
    _client,
    _contract,
    _database,
    _done,
    _prepare,
)

REQUEST: dict[str, Any] = {
    "operation": "aggregate",
    "metric": "revenue",
    "group_by": [],
    "selection": None,
    "scope": None,
    "denominator": None,
}


def test_calcul_sur_resultat_et_autorisations(
    monde: Monde, service: CatalogService, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _prepare(monde)
    reference = _database(tmp_path)
    with duckdb.connect(str(reference)) as source:
        source.execute("INSERT INTO orders VALUES ('A', 5)")
        attendu = source.execute(
            "SELECT SUM(amount) FROM orders WHERE tenant = ? AND amount = ?", ["A", 12]
        ).fetchone()
        total_reference = source.execute(
            "SELECT SUM(amount) FROM orders WHERE tenant = ?", ["A"]
        ).fetchone()
        selection_reference = source.execute(
            "SELECT SUM(amount) FROM orders WHERE tenant = ? AND amount IN (?, ?)",
            ["A", 5, 12],
        ).fetchone()
        groupes_reference = source.execute(
            "SELECT tenant, SUM(amount) FROM orders WHERE tenant = ? GROUP BY tenant", ["A"]
        ).fetchall()
    assert attendu is not None and total_reference is not None and selection_reference is not None
    recorder = Recorder(TelemetryStore(monde.moteur), monde.horloge)
    with _client(monde, service, tmp_path, recorder=recorder) as client:
        models = tmp_path / "models"
        path = models / "orders.yaml"
        model = yaml.safe_load(path.read_text())
        model["models"][0]["dimensions"] = [
            {"name": "amount", "type": "integer", "sql": "amount"},
            {"name": "tenant", "type": "string", "sql": "tenant"},
        ]
        model["models"][0]["metrics"].append(
            {"name": "customers", "type": "count_distinct", "sql": "amount"}
        )
        path.write_text(yaml.safe_dump(model))
        catalog_path = models / "semantic_catalog.yaml"
        catalog = yaml.safe_load(catalog_path.read_text())
        catalog["models"][0]["dimensions"] = ["amount", "tenant"]
        catalog["models"][0]["metrics"].append("customers")
        catalog_path.write_text(yaml.safe_dump(catalog))
        body = {**BODY, "dimensions": ["amount", "tenant"], "metrics": ["revenue", "customers"]}
        submitted = _call(client, monde, LECTEUR_GROUPE, "POST", PATH, json=body)
        assert submitted.status_code == 202
        identifier = submitted.json()["id"]
        done = _done(client, monde, LECTEUR_GROUPE, identifier)
        assert done["state"] == "succeeded"
        assert done["result_contract"] == {
            "dimensions": ["amount", "tenant"],
            "metrics": [
                {"name": "revenue", "aggregation": "sum", "additivity": "additive"},
                {
                    "name": "customers",
                    "aggregation": "count_distinct",
                    "additivity": "non_additive",
                },
            ],
            "completeness": "complete",
        }
        bob = _call(client, monde, LECTEUR_PERSONNE, "POST", PATH, json=body)
        assert bob.status_code == 202
        assert _done(client, monde, LECTEUR_PERSONNE, bob.json()["id"])["state"] == "succeeded"
        bob_url = PATH + "/" + bob.json()["id"] + "/contextual"
        bob_total = _call(client, monde, LECTEUR_PERSONNE, "POST", bob_url, json=REQUEST)
        assert bob_total.json()["rows"] == [{"revenue": {"type": "decimal", "value": "100"}}]
        assert (
            _call(client, monde, LECTEUR_GROUPE, "POST", bob_url, json=REQUEST).status_code == 404
        )
        # Un changement ultérieur ne modifie pas le contrat figé.
        model["models"][0]["metrics"][0]["type"] = "avg"
        path.write_text(yaml.safe_dump(model))
        url = PATH + "/" + identifier + "/contextual"
        response = _call(
            client,
            monde,
            LECTEUR_GROUPE,
            "POST",
            url,
            json={**REQUEST, "selection": {"amount": [12]}},
        )
        assert response.status_code == 200
        assert response.json()["rows"] == [{"revenue": {"type": "decimal", "value": "12"}}]
        assert response.json()["scope"] == "selection"

        def exemple(reponse: Any, nom: str) -> None:
            payload = reponse.json()
            if "source_evidence_id" in payload:
                payload["source_evidence_id"] = "00000000-0000-4000-8000-000000000003"
            if "result_contract" in payload:
                payload["id"] = "00000000-0000-4000-8000-000000000001"
                payload["connector_run_id"] = "00000000-0000-4000-8000-000000000002"
                evidence = payload["evidence"]
                evidence.update(
                    {
                        "evidence_id": "00000000-0000-4000-8000-000000000003",
                        "statement_id": "00000000-0000-4000-8000-000000000002",
                        "compiled_at": "2026-01-15T12:00:00+00:00",
                        "executed_at": "2026-01-15T12:00:00+00:00",
                        "execution_duration_seconds": 0,
                    }
                )
                evidence["policy"]["evaluated_at"] = "2026-01-15T12:00:00+00:00"
            assert {"status": reponse.status_code, "body": payload} == json.loads(
                (CONTRACTS / nom).read_text()
            )

        exemple(
            _call(client, monde, LECTEUR_GROUPE, "GET", PATH + "/" + identifier),
            "contextuel-detail.json",
        )
        exemple(response, "contextuel-selection.json")
        total = _call(client, monde, LECTEUR_GROUPE, "POST", url, json=REQUEST).json()
        assert int(total["rows"][0]["revenue"]["value"]) == total_reference[0]
        assert total["row_count"] == 2
        multiple = _call(
            client,
            monde,
            LECTEUR_GROUPE,
            "POST",
            url,
            json={**REQUEST, "selection": {"amount": [5, 12]}},
        ).json()
        assert (
            int(multiple["rows"][0]["revenue"]["value"]) == selection_reference[0]
            and multiple["row_count"] == 2
        )
        grouped = _call(
            client, monde, LECTEUR_GROUPE, "POST", url, json={**REQUEST, "group_by": ["tenant"]}
        ).json()
        assert [
            (row["tenant"], int(row["revenue"]["value"])) for row in grouped["rows"]
        ] == groupes_reference
        assert grouped["row_count"] == 2
        empty = _call(
            client,
            monde,
            LECTEUR_GROUPE,
            "POST",
            url,
            json={**REQUEST, "selection": {"amount": [999]}},
        )
        assert empty.json()["reason"] == "empty_selection"
        exemple(empty, "contextuel-selection-vide.json")
        exemple(
            _call(
                client,
                monde,
                LECTEUR_GROUPE,
                "POST",
                url,
                json={
                    **REQUEST,
                    "operation": "share",
                    "metric": "customers",
                    "denominator": "loaded_result",
                },
            ),
            "contextuel-part-indefinie.json",
        )
        with monkeypatch.context() as patch:
            patch.setattr(ExecutionStore, "result", lambda *args: b"flux illisible")
            exemple(
                _call(client, monde, LECTEUR_GROUPE, "POST", url, json=REQUEST),
                "contextuel-resultat-illisible.json",
            )

        exemple(
            _call(
                client, monde, LECTEUR_GROUPE, "POST", url, json={**REQUEST, "group_by": ["tenant"]}
            ),
            "contextuel-sous-totaux.json",
        )
        exemple(
            _call(
                client,
                monde,
                LECTEUR_GROUPE,
                "POST",
                url,
                json={
                    **REQUEST,
                    "operation": "share",
                    "group_by": ["amount"],
                    "denominator": "loaded_result",
                },
            ),
            "contextuel-part.json",
        )
        exemple(
            _call(
                client, monde, LECTEUR_GROUPE, "POST", url, json={**REQUEST, "metric": "customers"}
            ),
            "contextuel-indisponible.json",
        )
        assert int(response.json()["rows"][0]["revenue"]["value"]) == attendu[0]
        _contract(
            _call(client, monde, LECTEUR_GROUPE, "POST", url, json={}), "contextuel-invalide.json"
        )
        with monde.moteur.begin() as connection:
            connection.execute(
                update(executions).where(executions.c.id == identifier).values(truncated=True)
            )
        partial = _call(client, monde, LECTEUR_GROUPE, "POST", url, json=REQUEST)
        assert partial.json()["partial"] is True and partial.json()["scope"] == "loaded_result"
        exemple(partial, "contextuel-tronque.json")
        incomplete = _call(
            client,
            monde,
            LECTEUR_GROUPE,
            "POST",
            url,
            json={**REQUEST, "scope": "filtered_perimeter"},
        )
        assert incomplete.json()["reason"] == "incomplete_result"
        with monde.moteur.begin() as connection:
            connection.execute(
                update(executions).where(executions.c.id == identifier).values(result_contract=None)
            )
        legacy = _call(client, monde, LECTEUR_GROUPE, "POST", url, json=REQUEST)
        assert legacy.json()["reason"] == "contract_unavailable"
        exemple(legacy, "contextuel-contrat-absent.json")
        assert _call(client, monde, PLATEFORME_SEULE, "POST", url, json=REQUEST).status_code == 403
        for profile in (LECTEUR_PERSONNE, ADMIN_GROUPE):
            _contract(
                _call(client, monde, profile, "POST", url, json=REQUEST), "execution-inconnue.json"
            )
        assert (
            _call(
                client,
                monde,
                LECTEUR_GROUPE,
                "POST",
                f"/api/spaces/{B}/executions/{identifier}/contextual",
                json=REQUEST,
            ).status_code
            == 404
        )

    with monde.moteur.connect() as connection:
        mesures = connection.execute(
            select(telemetry).where(telemetry.c.operation == "contextual.compute")
        ).all()
    assert {row.outcome for row in mesures} == {"ok", "unavailable", "invalid_request"}
    assert all(row.space_id == A and row.duration_ms >= 0 for row in mesures)


def test_panne_de_mesure_ne_change_pas_le_calcul(
    monde: Monde, service: CatalogService, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _prepare(monde)
    original = Recorder.submit

    def panne(self: Recorder, measure: Any) -> None:
        if measure.operation == "contextual.compute":
            raise RuntimeError("mesure indisponible")
        original(self, measure)

    monkeypatch.setattr(Recorder, "submit", panne)
    with _client(monde, service, tmp_path) as client:
        submitted = _call(client, monde, LECTEUR_GROUPE, "POST", PATH, json=BODY)
        identifier = submitted.json()["id"]
        assert _done(client, monde, LECTEUR_GROUPE, identifier)["state"] == "succeeded"
        response = _call(
            client,
            monde,
            LECTEUR_GROUPE,
            "POST",
            PATH + "/" + identifier + "/contextual",
            json=REQUEST,
        )
        assert response.status_code == 200 and response.json()["status"] == "derived"
        monkeypatch.setattr(ExecutionStore, "result", lambda *args: None)
        _contract(
            _call(
                client,
                monde,
                LECTEUR_GROUPE,
                "POST",
                PATH + "/" + identifier + "/contextual",
                json=REQUEST,
            ),
            "contextuel-source-indisponible.json",
        )


def test_execution_non_reussie_et_mode_local(
    monde: Monde, service: CatalogService, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from datetime import timedelta

    from fastapi.testclient import TestClient
    from skifer_board.execution import ConnectionStore
    from skifer_board.server import create_app
    from skifer_board.spaces.model import Environment

    _prepare(monde)
    binding = ConnectionStore(monde.moteur).get_binding(A, "source", Environment.DEV)
    now = monde.horloge()
    record = ExecutionStore(monde.moteur).create(
        binding,
        LECTEUR_GROUPE.ref,
        "hash",
        now,
        now + timedelta(seconds=30),
        now + timedelta(seconds=40),
        "owner",
    )

    def interdit(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("Aucun calcul sur une exécution en attente")

    monkeypatch.setattr("skifer_board.execution.runs_web.calculer", interdit)
    with _client(monde, service, tmp_path) as client:
        for etat in ("queued", "running", "denied", "failed", "timed_out", "cancelled"):
            with monde.moteur.begin() as connection:
                connection.execute(
                    update(executions).where(executions.c.id == record.id).values(state=etat)
                )
            response = _call(
                client,
                monde,
                LECTEUR_GROUPE,
                "POST",
                PATH + "/" + record.id + "/contextual",
                json=REQUEST,
            )
            _contract(response, "contextuel-non-reussi.json")
            detail = _call(client, monde, LECTEUR_GROUPE, "GET", PATH + "/" + record.id)
            assert "result_contract" not in detail.json()
    with TestClient(create_app(service), base_url="http://127.0.0.1") as client:
        response = client.post(
            "/api/spaces/local/executions/00000000-0000-0000-0000-000000000000/contextual",
            json=REQUEST,
            headers={"Origin": "http://127.0.0.1"},
        )
        assert (response.status_code, response.json()["error"]["code"]) == (409, "local_mode")
