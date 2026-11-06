"""Validation des champs et filtres déclaratifs (plan 17.2)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from identity.conftest import cles as cles
from identity.conftest import config as config
from identity.conftest import fournisseur as fournisseur
from identity.conftest import horloge as horloge
from skifer_board.catalog import CatalogService
from skifer_board.execution.connectors import DuckDbExecution
from skifer_board.execution.model import Connector
from skifer_board.execution.query_validation import filtre, valider
from skifer_board.execution.runs import ExecutionStore
from skifer_board.execution.runs_web import _request
from skifer_board.execution.semantic import SemanticRequest, describe_catalog
from skifer_board.spaces.web import Invalid
from spaces.monde import LECTEUR_GROUPE, A, Monde
from spaces.monde import config_plateforme as config_plateforme
from spaces.monde import monde as monde
from state.conftest import migre as migre

from execution.test_runs_web import BODY, PATH, _call, _client, _contract, _prepare
from execution.test_semantic import RecordingConnector, _binding, _database, _model, _reader, _run

TYPES = {
    "string": "A",
    "number": 2,
    "date": "date",
    "timestamp": "instant",
    "boolean": True,
    "unknown": "A",
}
MATRICE = {
    "string": {"eq", "ne", "in"},
    "number": {"eq", "ne", "gt", "gte", "lt", "lte", "in", "between"},
    "date": set(),
    "timestamp": set(),
    "boolean": {"eq", "ne"},
    "unknown": {"eq", "ne"},
}


def catalogue() -> dict[str, Any]:
    return {
        "models": [
            {
                "name": "orders",
                "metrics": [{"name": "revenue"}],
                "dimensions": [{"name": kind, "type": kind} for kind in TYPES],
            }
        ]
    }


@pytest.mark.parametrize("kind", list(TYPES))
@pytest.mark.parametrize("operator", ["eq", "ne", "gt", "gte", "lt", "lte", "in", "between"])
def test_matrice(kind: str, operator: str) -> None:
    value = TYPES[kind]
    if operator == "in":
        value = [value]
    if operator == "between":
        value = [value, value]
    request = SemanticRequest("orders", ("revenue",), (), (filtre(kind, operator, value),))
    if operator in MATRICE[kind]:
        assert valider(request, catalogue()).filters
    else:
        with pytest.raises(Invalid):
            valider(request, catalogue())


@pytest.mark.parametrize(
    "operator,value",
    [
        ("in", []),
        ("in", list(range(101))),
        ("in", [1, 1]),
        ("in", [1, True]),
        ("in", [1, 1.0]),
        ("between", [2]),
        ("between", [1, 2, 3]),
        ("eq", None),
        ("eq", float("inf")),
        ("eq", "x" * 1025),
        ("eq", "a\x00b"),
        ("like", "x"),
        ("is_null", "x"),
        ("eq", {}),
    ],
)
def test_formes_refusees(operator: str, value: Any) -> None:
    with pytest.raises(Invalid):
        filtre("number", operator, value)


@pytest.mark.parametrize(
    "kind,operator,value",
    [
        ("number", "eq", True),
        ("number", "eq", "3"),
        ("boolean", "eq", 1),
        ("string", "eq", 2),
        ("number", "between", [3, 1]),
    ],
)
def test_valeurs_refusees(kind: str, operator: str, value: Any) -> None:
    with pytest.raises(Invalid):
        valider(
            SemanticRequest("orders", ("revenue",), (), (filtre(kind, operator, value),)),
            catalogue(),
        )


def test_empreinte_in_canonique() -> None:
    body = {**BODY, "filters": [{"column": "region", "operator": "in", "value": ["Sud", "Nord"]}]}
    reverse = {
        **body,
        "filters": [{"column": "region", "operator": "in", "value": ["Nord", "Sud"]}],
    }
    _, _, first, digest = _request(body)
    _, _, second, other = _request(reverse)
    assert digest == other
    assert (
        first.filters
        == second.filters
        == ({"column": "region", "operator": "in", "value": ["Nord", "Sud"]},)
    )


@pytest.mark.parametrize(
    "patch,contract",
    [
        ({"model": "inconnu"}, "validation-modele.json"),
        ({"metrics": ["inconnu"]}, "validation-metriques.json"),
        ({"dimensions": ["inconnu"]}, "validation-dimensions.json"),
        (
            {"filters": [{"column": "inconnu", "operator": "eq", "value": "sentinelle"}]},
            "validation-filtres.json",
        ),
    ],
)
def test_refus_avant_execution(
    monde: Monde,
    service: CatalogService,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    patch: dict[str, Any],
    contract: str,
) -> None:
    _prepare(monde)

    def interdit(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("Le connecteur ne doit pas être appelé")

    monkeypatch.setattr(DuckDbExecution, "execute", interdit)
    with _client(monde, service, tmp_path) as client:
        response = _call(client, monde, LECTEUR_GROUPE, "POST", PATH, json={**BODY, **patch})
        _contract(response, contract)
        assert "sentinelle" not in response.text and "inconnu" not in response.text
        assert ExecutionStore(monde.moteur).list(A, LECTEUR_GROUPE.ref) == []


def test_filtres_rls_et_dialectes(tmp_path: Path) -> None:
    models = _model(tmp_path)
    model_path = models / "orders.yaml"
    document = yaml.safe_load(model_path.read_text())
    document["models"][0]["dimensions"].append(
        {"name": "amount", "type": "integer", "sql": "amount"}
    )
    model_path.write_text(yaml.safe_dump(document))
    catalog_path = models / "semantic_catalog.yaml"
    catalog = yaml.safe_load(catalog_path.read_text())
    catalog["models"][0]["dimensions"].append("amount")
    catalog_path.write_text(yaml.safe_dump(catalog))
    path = _database(tmp_path)
    filters = (
        {"column": "region", "operator": "in", "value": ["South", "North"]},
        {"column": "amount", "operator": "between", "value": [1, 200]},
    )
    request = SemanticRequest(
        "orders", ("revenue",), ("region",), tuple(filtre(**item) for item in filters)
    )
    request = valider(request, describe_catalog(models))
    for dialect in (Connector.DUCKDB, Connector.DATABRICKS):
        for person, tenant, expected in (("alice", "A", [5, 12]), ("bob", "B", [7, 100])):
            connector = RecordingConnector(path)
            result = _run(request, _reader(person, tenant), _binding(dialect), connector, models)
            assert sorted(row["revenue"] for row in result.rows.to_pylist()) == expected
            assert (
                " IN " in connector.sql[0].upper()
                and ">=" in connector.sql[0]
                and "<=" in connector.sql[0]
            )
            sans = _run(
                SemanticRequest("orders", ("revenue",), ("region",)),
                _reader(person, tenant),
                _binding(dialect),
                RecordingConnector(path),
                models,
            )
            assert sorted(row["revenue"] for row in sans.rows.to_pylist()) == expected


def test_transport_databricks_recoit_in_et_bornes(tmp_path: Path) -> None:
    from skifer_board.execution.connectors import (
        DatabricksEndpoint,
        DatabricksExecution,
        HttpResponse,
    )
    from skifer_board.execution.semantic import run_semantic

    models = _model(tmp_path)
    document_path = models / "orders.yaml"
    document = yaml.safe_load(document_path.read_text())
    document["models"][0]["dimensions"].append(
        {"name": "amount", "type": "integer", "sql": "amount"}
    )
    document_path.write_text(yaml.safe_dump(document))
    catalog_path = models / "semantic_catalog.yaml"
    catalog = yaml.safe_load(catalog_path.read_text())
    catalog["models"][0]["dimensions"].append("amount")
    catalog_path.write_text(yaml.safe_dump(catalog))
    request = SemanticRequest(
        "orders",
        ("revenue",),
        (),
        (filtre("region", "in", ["South", "North"]), filtre("amount", "between", [1, 200])),
    )
    request = valider(request, describe_catalog(models))

    class Transport:
        statement = ""

        def post(self, url: str, token: str, body: dict[str, object]) -> HttpResponse:
            self.statement = str(body["statement"])
            return HttpResponse(
                200,
                b'{"statement_id":"12345678-1234-1234-1234-123456789abc","status":{"state":"SUCCEEDED"}}',
                "application/json",
            )

        def get(self, url: str, token: str) -> HttpResponse:
            return HttpResponse(
                200,
                b'{"statement_id":"12345678-1234-1234-1234-123456789abc","status":{"state":"SUCCEEDED"},"manifest":{"total_chunk_count":1,"truncated":false},"result":{"data_array":[]}}',
                "application/json",
            )

    transport = Transport()
    run_semantic(
        request,
        _reader("alice", "A"),
        _binding(Connector.DATABRICKS),
        DatabricksExecution(
            DatabricksEndpoint("https://dbc-123.cloud.databricks.com", "warehouse"),
            "jeton",
            transport,
        ),
        models_dir=models,
        certification_mode="off",
    )
    assert " IN " in transport.statement.upper()
    assert ">=" in transport.statement and "<=" in transport.statement


def test_ne_par_le_vrai_serveur_duckdb(
    monde: Monde, service: CatalogService, tmp_path: Path
) -> None:
    from execution.test_runs_web import _done

    _prepare(monde)
    with _client(monde, service, tmp_path) as client:
        directory = tmp_path / "models"
        model_path = directory / "orders.yaml"
        document = yaml.safe_load(model_path.read_text())
        document["models"][0]["dimensions"] = [
            {"name": "amount", "type": "integer", "sql": "amount"}
        ]
        model_path.write_text(yaml.safe_dump(document))
        catalog_path = directory / "semantic_catalog.yaml"
        catalog = yaml.safe_load(catalog_path.read_text())
        catalog["models"][0]["dimensions"] = ["amount"]
        catalog_path.write_text(yaml.safe_dump(catalog))
        body = {
            **BODY,
            "dimensions": ["amount"],
            "filters": [{"column": "amount", "operator": "ne", "value": 100}],
        }
        response = _call(client, monde, LECTEUR_GROUPE, "POST", PATH, json=body)
        assert response.status_code == 202
        assert _done(client, monde, LECTEUR_GROUPE, response.json()["id"])["state"] == "succeeded"
        result = _call(
            client, monde, LECTEUR_GROUPE, "GET", PATH + "/" + response.json()["id"] + "/result"
        )
        import pyarrow as pa

        assert pa.ipc.open_stream(result.content).read_all().to_pylist() == [
            {"amount": 12, "revenue": 12}
        ]


def test_soumission_catalogue_invalide_avant_connecteur(
    monde: Monde, service: CatalogService, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _prepare(monde)

    def interdit(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("Le connecteur ne doit pas être appelé")

    monkeypatch.setattr(DuckDbExecution, "execute", interdit)
    with _client(monde, service, tmp_path) as client:
        (tmp_path / "models" / "semantic_catalog.yaml").write_text("[")
        response = _call(client, monde, LECTEUR_GROUPE, "POST", PATH, json=BODY)
        _contract(response, "moteur-indisponible.json")
        assert ExecutionStore(monde.moteur).list(A, LECTEUR_GROUPE.ref) == []


def test_intervalle_numerique_entier_et_flottant() -> None:
    request = SemanticRequest("orders", ("revenue",), (), (filtre("number", "between", [1, 2.5]),))
    assert valider(request, catalogue()).filters == (
        {"column": "number", "operator": "gte", "value": 1},
        {"column": "number", "operator": "lte", "value": 2.5},
    )


@pytest.mark.parametrize(
    "value",
    [
        "North-1",
        "a;b",
        "a'b",
        'a"b',
        "a\\b",
        "a%b",
        "a*b",
        "a\nb",
        "a\tb",
        "a$b",
        "a`b",
        "a=b",
        "😀",
        "e\u0301",
        "a\u00a0b",
        "a\u200bb",
    ],
)
def test_caracteres_refuses(value: str) -> None:
    with pytest.raises(Invalid):
        filtre("region", "eq", value)
    with pytest.raises(Invalid):
        filtre("region", "in", ["Nord", value])


@pytest.mark.parametrize("value", [-(2**63) - 1, 2**63, float("nan"), float("-inf")])
def test_nombres_hors_bornes(value: Any) -> None:
    with pytest.raises(Invalid):
        filtre("amount", "eq", value)
    with pytest.raises(Invalid):
        filtre("amount", "in", [value])


@pytest.mark.parametrize("value", [-(2**63), 2**63 - 1])
def test_bornes_entiers_admises(value: int) -> None:
    assert filtre("amount", "eq", value)["value"] == value


def test_tiret_refuse_par_skifer_actuel(tmp_path: Path) -> None:
    from skifer_board.execution.semantic import SemanticRefusal

    models = _model(tmp_path)
    connector = RecordingConnector(_database(tmp_path))
    request = SemanticRequest(
        "orders", ("revenue",), (), ({"column": "region", "operator": "eq", "value": "North-1"},)
    )
    with pytest.raises(SemanticRefusal, match="engine_unavailable"):
        _run(request, _reader("alice", "A"), _binding(), connector, models)
    assert connector.sql == []


def test_filtres_colonne_politique_rls(tmp_path: Path) -> None:
    models = _model(tmp_path)
    model_path = models / "orders.yaml"
    document = yaml.safe_load(model_path.read_text())
    document["models"][0]["dimensions"].append(
        {"name": "tenant", "type": "string", "sql": "tenant"}
    )
    model_path.write_text(yaml.safe_dump(document))
    catalog_path = models / "semantic_catalog.yaml"
    catalog = yaml.safe_load(catalog_path.read_text())
    catalog["models"][0]["dimensions"].append("tenant")
    catalog_path.write_text(yaml.safe_dump(catalog))
    path = _database(tmp_path)
    for tenant, other, expected in (("A", "B", 17), ("B", "A", 107)):
        for operator, value, expected_rows in (
            ("eq", other, []),
            ("ne", tenant, []),
            ("in", ["A", "B"], [{"tenant": tenant, "revenue": expected}]),
        ):
            request = SemanticRequest(
                "orders", ("revenue",), ("tenant",), (filtre("tenant", operator, value),)
            )
            request = valider(request, describe_catalog(models))
            output = _run(
                request, _reader(tenant, tenant), _binding(), RecordingConnector(path), models
            )
            assert output.rows.to_pylist() == expected_rows


@pytest.mark.parametrize(
    "column,value",
    [
        ("revenue", "Nord"),
        ("Region", "Nord"),
        ("orders.region", "Nord"),
        ("autre", "Nord"),
        ("region", "North-1"),
        ("jour", "2026-01-05"),
        ("jour", "date"),
    ],
)
def test_filtres_invalides_avant_creation(
    monde: Monde,
    service: CatalogService,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    column: str,
    value: str,
) -> None:
    _prepare(monde)

    def interdit(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("Le connecteur ne doit pas être appelé")

    monkeypatch.setattr(DuckDbExecution, "execute", interdit)
    with _client(monde, service, tmp_path) as client:
        directory = tmp_path / "models"
        model_path = directory / "orders.yaml"
        document = yaml.safe_load(model_path.read_text())
        document["models"][0]["dimensions"] = [
            {"name": "region", "type": "string", "sql": "tenant"},
            {"name": "jour", "type": "date", "sql": "tenant"},
        ]
        model_path.write_text(yaml.safe_dump(document))
        other = {
            "models": [
                {
                    "name": "other",
                    "table": "main.orders",
                    "row_policy": {"column": "tenant", "attribute": "tenant"},
                    "dimensions": [{"name": "autre", "type": "string", "sql": "tenant"}],
                    "metrics": [{"name": "revenue", "type": "sum", "sql": "amount"}],
                }
            ]
        }
        (directory / "other.yaml").write_text(yaml.safe_dump(other))
        catalog_path = directory / "semantic_catalog.yaml"
        catalog = yaml.safe_load(catalog_path.read_text())
        catalog["models"][0]["dimensions"] = ["region", "jour"]
        catalog["models"].append(
            {"key": "other", "file": "other.yaml", "metrics": ["revenue"], "dimensions": ["autre"]}
        )
        catalog_path.write_text(yaml.safe_dump(catalog))
        body = {**BODY, "filters": [{"column": column, "operator": "eq", "value": value}]}
        response = _call(client, monde, LECTEUR_GROUPE, "POST", PATH, json=body)
        _contract(response, "validation-filtres.json")
        assert ExecutionStore(monde.moteur).list(A, LECTEUR_GROUPE.ref) == []


@pytest.mark.parametrize(
    "value", ["Été", "東京", "Łódź", "numéro １２", "a_b.c,d:e/f@g&h+i(j)", " début et fin ", ""]
)
def test_caracteres_admis(value: str) -> None:
    assert filtre("region", "eq", value)["value"] == value
    assert filtre("region", "in", [value])["value"] == [value]


def test_caracteres_par_le_serveur(monde: Monde, service: CatalogService, tmp_path: Path) -> None:
    from execution.test_runs_web import _done

    _prepare(monde)
    with _client(monde, service, tmp_path) as client:
        directory = tmp_path / "models"
        model_path = directory / "orders.yaml"
        document = yaml.safe_load(model_path.read_text())
        document["models"][0]["dimensions"] = [
            {"name": "region", "type": "string", "sql": "tenant"}
        ]
        model_path.write_text(yaml.safe_dump(document))
        catalog_path = directory / "semantic_catalog.yaml"
        catalog = yaml.safe_load(catalog_path.read_text())
        catalog["models"][0]["dimensions"] = ["region"]
        catalog_path.write_text(yaml.safe_dump(catalog))
        for value in (
            "a\\b",
            "a'b",
            'a"b',
            "a-b",
            "a;b",
            "a%b",
            "a*b",
            "a\nb",
            "a\tb",
            "a$b",
            "a`b",
            "a=b",
            "😀",
            "e\u0301",
        ):
            body = {**BODY, "filters": [{"column": "region", "operator": "eq", "value": value}]}
            response = _call(client, monde, LECTEUR_GROUPE, "POST", PATH, json=body)
            _contract(response, "validation-filtres.json")
            assert ExecutionStore(monde.moteur).list(A, LECTEUR_GROUPE.ref) == []
        for value in ("Été", "東京", "a_b.c,d:e/f@g&h+i(j)", " début et fin "):
            body = {**BODY, "filters": [{"column": "region", "operator": "eq", "value": value}]}
            response = _call(client, monde, LECTEUR_GROUPE, "POST", PATH, json=body)
            assert response.status_code == 202
            assert (
                _done(client, monde, LECTEUR_GROUPE, response.json()["id"])["state"] == "succeeded"
            )
