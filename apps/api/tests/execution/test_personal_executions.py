"""Deux lecteurs OAuth, RLS réelle skifer et transport Databricks simulé (plan 16)."""

from __future__ import annotations

import threading
from datetime import timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

import duckdb
import pyarrow as pa
import pytest
from skifer_board.catalog import CatalogService
from skifer_board.execution import ConnectionStore
from skifer_board.execution.connectors import DatabricksEndpoint, HttpResponse
from skifer_board.execution.model import Connector, IdentityMode
from skifer_board.execution.oauth import Tokens
from skifer_board.execution.oauth_store import OAuthStore
from skifer_board.execution.runs import ExecutionStore
from skifer_board.execution.vault import CredentialVault
from skifer_board.spaces.model import Environment
from skifer_board.state.schema import executions
from spaces.monde import (
    ADMIN_GROUPE,
    LECTEUR_GROUPE,
    LECTEUR_PERSONNE,
    NON_MEMBRE,
    PLATEFORME_SEULE,
    A,
    B,
    Monde,
)
from sqlalchemy import select

from execution.test_oauth import CONFIG, HOST, KEYS, Forms, response
from execution.test_runs_web import BODY, PATH, _call, _client, _database, _done, _prepare
from execution.test_runs_web import cles as cles
from execution.test_runs_web import config as config
from execution.test_runs_web import config_plateforme as config_plateforme
from execution.test_runs_web import espace as espace
from execution.test_runs_web import fournisseur as fournisseur
from execution.test_runs_web import horloge as horloge
from execution.test_runs_web import migre as migre
from execution.test_runs_web import monde as monde
from execution.test_runs_web import service as service

ALICE = "oauth-alice-sentinel"
BOB = "oauth-bob-sentinel"


class Transport:
    def __init__(self, path: Path, *, running: bool = False) -> None:
        self.path, self.running = path, running
        self.sql: list[tuple[str, str]] = []
        self.calls: list[tuple[str, str]] = []
        self.results: dict[str, tuple[str, list[list[str]]]] = {}
        self.submitted = threading.Event()
        self.cancelled = False

    def post(self, url: str, token: str, body: dict[str, object]) -> HttpResponse:
        self.calls.append((token, url))
        if url.endswith("/cancel"):
            identifier = url.split("/")[-2]
            assert self.results[identifier][0] == token
            self.cancelled = True
            return HttpResponse(200, b"", "application/json")
        assert url == HOST + "/api/2.0/sql/statements"
        assert token in (ALICE, BOB)
        sql = body["statement"]
        assert isinstance(sql, str)
        assert "tenant" in sql and ("'A'" if token == ALICE else "'B'") in sql
        self.sql.append((token, sql))
        with duckdb.connect(str(self.path), read_only=True) as connection:
            rows = [[str(value) for value in row] for row in connection.sql(sql).fetchall()]
        identifier = str(uuid4())
        self.results[identifier] = (token, rows)
        self.submitted.set()
        return response(
            {
                "statement_id": identifier,
                "status": {"state": "RUNNING" if self.running else "SUCCEEDED"},
            }
        )

    def get(self, url: str, token: str) -> HttpResponse:
        self.calls.append((token, url))
        if "/warehouses/" in url:
            assert token in (ALICE, BOB)
            return response({"id": "warehouse", "state": "RUNNING"})
        identifier = url.rsplit("/", 1)[-1]
        owner, rows = self.results[identifier]
        assert token == owner
        state = "CANCELED" if self.cancelled else "RUNNING" if self.running else "SUCCEEDED"
        return response(
            {
                "statement_id": identifier,
                "status": {"state": state},
                "manifest": {
                    "truncated": False,
                    "total_chunk_count": 1,
                    "schema": {
                        "column_count": 1,
                        "columns": [{"name": "revenue", "type_name": "LONG", "position": 0}],
                    },
                },
                "result": {"data_array": rows},
            }
        )


def prepare(monde: Monde) -> OAuthStore:
    _prepare(monde, Connector.DATABRICKS)
    ConnectionStore(monde.moteur).bind(
        A,
        "source",
        Environment.DEV,
        Connector.DATABRICKS,
        "orders",
        IdentityMode.PERSON,
        ADMIN_GROUPE.ref,
        monde.horloge(),
    )
    store = OAuthStore(monde.moteur, KEYS, CONFIG.client_id)
    now = monde.horloge()
    for person, token in ((LECTEUR_GROUPE.ref, ALICE), (LECTEUR_PERSONNE.ref, BOB)):
        store.save(
            A, person, HOST, Tokens(token, "refresh-" + token, now + timedelta(hours=1)), now
        )
    return store


def options(transport: Transport, forms: Forms | None = None) -> dict[str, Any]:
    return {
        "endpoints": {"orders": DatabricksEndpoint(HOST, "warehouse")},
        "vault_keys": KEYS,
        "databricks_oauth_client_id": CONFIG.client_id,
        "databricks_oauth_transport": forms or Forms(),
        "connection_transport": transport,
    }


def test_deux_lecteurs_deux_jetons_deux_resultats_et_aucun_repli_service(
    monde: Monde, service: CatalogService, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    prepare(monde)
    transport = Transport(_database(tmp_path))

    def forbidden(*args: object) -> str:
        pytest.fail("Une exécution personnelle ne doit pas ouvrir le coffre de service")

    monkeypatch.setattr(CredentialVault, "reveal_for_execution", forbidden)
    with _client(monde, service, tmp_path, **options(transport)) as client:
        identifiers: list[str] = []
        for profile, expected in ((LECTEUR_GROUPE, 12), (LECTEUR_PERSONNE, 100)):
            submitted = _call(client, monde, profile, "POST", PATH, json=BODY)
            assert submitted.status_code == 202
            identifier = str(submitted.json()["id"])
            identifiers.append(identifier)
            done = _done(client, monde, profile, identifier)
            assert done["state"] == "succeeded"
            assert done["evidence"]["policy"]["decision"] == "ALLOW"
            assert any(
                item["origin"] == "policy" for item in done["evidence"]["normalized_filters"]
            )
            result = _call(client, monde, profile, "GET", PATH + "/" + identifier + "/result")
            assert pa.ipc.open_stream(result.content).read_all().to_pylist() == [
                {"revenue": expected}
            ]
            record = ExecutionStore(monde.moteur).get(A, identifier, profile.ref)
            assert record is not None and record.identity_mode is IdentityMode.PERSON
        assert (
            _call(
                client, monde, LECTEUR_PERSONNE, "GET", PATH + "/" + identifiers[0] + "/result"
            ).status_code
            == 404
        )
        assert (
            _call(
                client, monde, ADMIN_GROUPE, "GET", PATH + "/" + identifiers[0] + "/result"
            ).status_code
            == 404
        )
        assert _call(client, monde, PLATEFORME_SEULE, "POST", PATH, json=BODY).status_code == 403
        assert (
            _call(
                client, monde, LECTEUR_GROUPE, "POST", PATH.replace(f"/{A}/", f"/{B}/"), json=BODY
            ).status_code
            == 404
        )
        assert _call(client, monde, NON_MEMBRE, "POST", PATH, json=BODY).status_code == 404
        view = _call(client, monde, ADMIN_GROUPE, "GET", PATH, params={"scope": "space"})
        assert ALICE not in view.text and BOB not in view.text
    assert {token for token, _ in transport.sql} == {ALICE, BOB}
    with monde.moteur.connect() as connection:
        persisted = str(connection.execute(select(executions)).all())
    assert ALICE not in persisted and BOB not in persisted


def test_autorisation_absente_expiree_ou_autre_personne_ne_soumet_rien(
    monde: Monde, service: CatalogService, tmp_path: Path
) -> None:
    store = prepare(monde)
    transport = Transport(_database(tmp_path))
    now = monde.horloge()
    store.save(
        A,
        ADMIN_GROUPE.ref,
        HOST,
        Tokens("admin-sentinel", "admin-refresh", now + timedelta(hours=1)),
        now,
    )
    store.disconnect(A, LECTEUR_GROUPE.ref, HOST)
    with _client(monde, service, tmp_path, **options(transport)) as client:
        rejected = _call(client, monde, LECTEUR_GROUPE, "POST", PATH, json=BODY)
        assert rejected.status_code == 409 and rejected.json()["error"]["code"] == "oauth_reconnect"
        assert _call(client, monde, LECTEUR_GROUPE, "GET", PATH).json()["executions"] == []
    store.save(
        A, LECTEUR_GROUPE.ref, HOST, Tokens(ALICE, "refresh", now - timedelta(seconds=1)), now
    )
    forms = Forms(response({}, 401))
    with _client(monde, service, tmp_path, **options(transport, forms)) as client:
        rejected = _call(client, monde, LECTEUR_GROUPE, "POST", PATH, json=BODY)
        assert rejected.status_code == 409 and rejected.json()["error"]["code"] == "oauth_refused"
    assert transport.calls == []


def test_rls_manquante_refuse_avant_tout_appel_de_donnees(
    monde: Monde, service: CatalogService, tmp_path: Path
) -> None:
    prepare(monde)
    transport = Transport(_database(tmp_path))
    with _client(
        monde, service, tmp_path, execution_reader_attributes=lambda _: {}, **options(transport)
    ) as client:
        submitted = _call(client, monde, LECTEUR_GROUPE, "POST", PATH, json=BODY)
        assert submitted.status_code == 202
        result = _done(client, monde, LECTEUR_GROUPE, submitted.json()["id"])
        assert result["state"] in {"failed", "denied"}
        assert result["rows"] is None
    assert transport.calls == []


def test_annulation_reutilise_le_connecteur_personnel_fige(
    monde: Monde, service: CatalogService, tmp_path: Path
) -> None:
    store = prepare(monde)
    transport = Transport(_database(tmp_path), running=True)
    with _client(monde, service, tmp_path, **options(transport)) as client:
        submitted = _call(client, monde, LECTEUR_GROUPE, "POST", PATH, json=BODY)
        identifier = str(submitted.json()["id"])
        assert transport.submitted.wait(3)
        store.disconnect(A, LECTEUR_GROUPE.ref, HOST)
        assert (
            _call(
                client, monde, LECTEUR_PERSONNE, "POST", PATH + "/" + identifier + "/cancel"
            ).status_code
            == 404
        )
        assert (
            _call(
                client, monde, LECTEUR_GROUPE, "POST", PATH + "/" + identifier + "/cancel"
            ).status_code
            == 200
        )
        result = _done(client, monde, LECTEUR_GROUPE, identifier)
        assert result["state"] == "cancelled" and result["rows"] is None
    assert transport.cancelled
    assert all(token == ALICE for token, _ in transport.calls)


def test_essai_liaison_personnelle_utilise_le_compte_demandeur(
    monde: Monde, service: CatalogService, tmp_path: Path
) -> None:
    store = prepare(monde)
    now = monde.horloge()
    store.save(A, ADMIN_GROUPE.ref, HOST, Tokens(ALICE, "refresh", now + timedelta(hours=1)), now)
    transport = Transport(_database(tmp_path))
    with _client(monde, service, tmp_path, **options(transport)) as client:
        result = _call(
            client,
            monde,
            ADMIN_GROUPE,
            "POST",
            f"/api/spaces/{A}/connections/source/bindings/DEV/test",
        )
        assert result.status_code == 200
        assert (
            result.json()["identity"] == "person"
            and result.json()["credential_expires_at"] is not None
        )
        store.disconnect(A, ADMIN_GROUPE.ref, HOST)
        refused = _call(
            client,
            monde,
            ADMIN_GROUPE,
            "POST",
            f"/api/spaces/{A}/connections/source/bindings/DEV/test",
        )
        assert refused.status_code == 409
    assert transport.calls == [(ALICE, HOST + "/api/2.0/sql/warehouses/warehouse")]


def test_essai_duckdb_personnel_reste_refuse(
    monde: Monde, service: CatalogService, tmp_path: Path
) -> None:
    from skifer_board.execution.connectors import DuckDbEndpoint

    prepare(monde)
    ConnectionStore(monde.moteur).bind(
        A,
        "source",
        Environment.DEV,
        Connector.DUCKDB,
        "orders",
        IdentityMode.PERSON,
        ADMIN_GROUPE.ref,
        monde.horloge(),
    )
    path = _database(tmp_path)
    transport = Transport(path)
    configured = {**options(transport), "endpoints": {"orders": DuckDbEndpoint(path)}}
    with _client(monde, service, tmp_path, **configured) as client:
        refused = _call(
            client,
            monde,
            ADMIN_GROUPE,
            "POST",
            f"/api/spaces/{A}/connections/source/bindings/DEV/test",
        )
        assert (
            refused.status_code == 409 and refused.json()["error"]["code"] == "identity_unavailable"
        )
    assert transport.calls == []


def test_renouvellement_avant_soumission_transmet_le_nouveau_jeton(
    monde: Monde, service: CatalogService, tmp_path: Path
) -> None:
    store = prepare(monde)
    now = monde.horloge()
    store.save(
        A,
        LECTEUR_GROUPE.ref,
        HOST,
        Tokens("expired-sentinel", "refresh-reader", now - timedelta(seconds=1)),
        now,
    )
    forms = Forms(
        response(
            {
                "access_token": ALICE,
                "refresh_token": "new-refresh",
                "token_type": "Bearer",
                "expires_in": 3600,
            }
        )
    )
    transport = Transport(_database(tmp_path))
    with _client(monde, service, tmp_path, **options(transport, forms)) as client:
        submitted = _call(client, monde, LECTEUR_GROUPE, "POST", PATH, json=BODY)
        assert submitted.status_code == 202
        assert _done(client, monde, LECTEUR_GROUPE, submitted.json()["id"])["state"] == "succeeded"
    assert forms.calls[0][1]["refresh_token"] == "refresh-reader"
    assert all(token == ALICE for token, _ in transport.calls)


@pytest.mark.parametrize("status", [401, 403])
def test_refus_databricks_personnel_ne_retourne_aucune_ligne(
    monde: Monde, service: CatalogService, tmp_path: Path, status: int
) -> None:
    prepare(monde)

    class RefusedTransport(Transport):
        def post(self, url: str, token: str, body: dict[str, object]) -> HttpResponse:
            assert token == ALICE
            self.calls.append((token, url))
            return HttpResponse(status, b"", "application/json")

    transport = RefusedTransport(_database(tmp_path))
    with _client(monde, service, tmp_path, **options(transport)) as client:
        submitted = _call(client, monde, LECTEUR_GROUPE, "POST", PATH, json=BODY)
        assert submitted.status_code == 202
        identifier = str(submitted.json()["id"])
        done = _done(client, monde, LECTEUR_GROUPE, identifier)
        assert done["state"] == "failed" and done["error_code"] == "credential_rejected"
        assert done["rows"] is None
        assert (
            _call(
                client, monde, LECTEUR_GROUPE, "GET", PATH + "/" + identifier + "/result"
            ).status_code
            == 409
        )
    assert len(transport.calls) == 1
