"""Routes suivies : vrai serveur, deux lecteurs et contrat Arrow (plan 12.5c)."""

from __future__ import annotations

import json
import time
from datetime import timedelta
from pathlib import Path
from typing import Any, cast

import duckdb
import pyarrow as pa
import pytest
import yaml
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from fastapi.testclient import TestClient
from identity.conftest import cles as cles
from identity.conftest import config as config
from identity.conftest import fournisseur as fournisseur
from identity.conftest import horloge as horloge
from skifer_board.catalog import CatalogService
from skifer_board.execution import ConnectionStore
from skifer_board.execution.connectors import DatabricksEndpoint, DuckDbEndpoint, HttpResponse
from skifer_board.execution.model import Connector, IdentityMode
from skifer_board.execution.runs import ExecutionStore, ExecutionUnavailable
from skifer_board.execution.runs_web import _request
from skifer_board.execution.vault import CredentialVault, VaultKeys
from skifer_board.execution.worker import ExecutionBusy, ExecutionWorkerPool
from skifer_board.server import create_app
from skifer_board.spaces.model import Environment, PersonRef
from skifer_board.state.schema import telemetry
from skifer_board.telemetry import Recorder, TelemetryStore
from spaces.monde import (
    ADMIN_GROUPE,
    LECTEUR_GROUPE,
    LECTEUR_PERSONNE,
    NON_MEMBRE,
    ORIGINE,
    PLATEFORME_SEULE,
    A,
    B,
    Monde,
    Profil,
    espaces_en_base,
)
from spaces.monde import config_plateforme as config_plateforme
from spaces.monde import monde as monde
from sqlalchemy import select
from state.conftest import migre as migre

PATH = f"/api/spaces/{A}/executions"
CONTRACTS = Path(__file__).resolve().parents[4] / "contracts/executions"
BODY = {
    "connection": "source",
    "environment": "DEV",
    "model": "orders",
    "metrics": ["revenue"],
    "dimensions": [],
    "filters": [],
}


def _models(tmp_path: Path) -> Path:
    directory = tmp_path / "models"
    directory.mkdir(exist_ok=True)
    (directory / "orders.yaml").write_text(
        yaml.safe_dump(
            {
                "models": [
                    {
                        "key": "orders",
                        "name": "orders",
                        "table": "main.orders",
                        "row_policy": {"column": "tenant", "attribute": "tenant"},
                        "metrics": [{"name": "revenue", "sql": "amount", "type": "sum"}],
                    }
                ]
            }
        )
    )
    (directory / "semantic_catalog.yaml").write_text(
        yaml.safe_dump(
            {
                "models": [
                    {
                        "key": "orders",
                        "file": "orders.yaml",
                        "metrics": ["revenue"],
                        "dimensions": [],
                    }
                ]
            }
        )
    )
    return directory


def _database(tmp_path: Path) -> Path:
    path = tmp_path / "orders.duckdb"
    if not path.exists():
        with duckdb.connect(str(path)) as connection:
            connection.execute("CREATE TABLE orders (tenant VARCHAR, amount INTEGER)")
            connection.execute("INSERT INTO orders VALUES ('A', 12), ('B', 100)")
    return path


def _prepare(monde: Monde, connector: Connector = Connector.DUCKDB) -> None:
    registry = ConnectionStore(monde.moteur)
    actor = PersonRef.of(ADMIN_GROUPE.identite)
    at = monde.horloge()
    registry.create(A, "source", actor, at)
    registry.bind(
        A, "source", Environment.DEV, connector, "orders", IdentityMode.SERVICE, actor, at
    )


def _client(monde: Monde, service: CatalogService, tmp_path: Path, **kwargs: Any) -> TestClient:
    options: dict[str, Any] = {
        "connections": ConnectionStore(monde.moteur),
        "endpoints": {"orders": DuckDbEndpoint(_database(tmp_path))},
        "execution_models_dir": _models(tmp_path),
        "execution_certification_mode": "off",
        "execution_reader_attributes": lambda identity: {
            "tenant": "A" if identity.subject == LECTEUR_GROUPE.sujet else "B"
        },
    }
    options.update(kwargs)
    app = create_app(
        service,
        monde.runtime,
        espaces_en_base(monde.moteur, monde.horloge),
        **options,
    )
    return TestClient(app, base_url=ORIGINE, raise_server_exceptions=False)


def _call(
    client: TestClient, monde: Monde, profile: Profil, method: str, url: str, **kwargs: Any
) -> Any:
    headers = {"Origin": ORIGINE, "Cookie": f"__Host-sb_session={monde.session(profile)}"}
    return client.request(method, url, headers=headers, **kwargs)


def _done(client: TestClient, monde: Monde, profile: Profil, identifier: str) -> dict[str, Any]:
    for _ in range(100):
        response = _call(client, monde, profile, "GET", PATH + "/" + identifier)
        assert response.status_code == 200
        body = response.json()
        if body["state"] not in {"queued", "running"}:
            return cast(dict[str, Any], body)
        time.sleep(0.02)
    pytest.fail("execution did not finish")


def _contract(response: Any, name: str) -> None:
    expected = json.loads((CONTRACTS / name).read_text())
    assert {"status": response.status_code, "body": response.json()} == expected


def test_two_readers_result_isolation_and_admin_metadata(
    monde: Monde, service: CatalogService, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _prepare(monde)
    recorder = Recorder(TelemetryStore(monde.moteur), monde.horloge)
    with _client(monde, service, tmp_path, recorder=recorder) as client:
        alice = _call(client, monde, LECTEUR_GROUPE, "POST", PATH, json=BODY)
        assert alice.status_code == 202
        alice_id = alice.json()["id"]
        alice_done = _done(client, monde, LECTEUR_GROUPE, alice_id)
        assert alice_done["state"] == "succeeded" and alice_done["evidence"]["sql_hash"]
        assert alice_done["rows"] == 1 and alice_done["truncated"] is False
        result = _call(client, monde, LECTEUR_GROUPE, "GET", PATH + "/" + alice_id + "/result")
        assert result.status_code == 200
        assert result.headers["content-type"] == "application/vnd.apache.arrow.stream"
        assert pa.ipc.open_stream(result.content).read_all().to_pylist() == [{"revenue": 12}]

        bob = _call(client, monde, LECTEUR_PERSONNE, "POST", PATH, json=BODY)
        assert bob.status_code == 202
        bob_id = bob.json()["id"]
        assert _done(client, monde, LECTEUR_PERSONNE, bob_id)["state"] == "succeeded"
        bob_result = _call(client, monde, LECTEUR_PERSONNE, "GET", PATH + "/" + bob_id + "/result")
        assert pa.ipc.open_stream(bob_result.content).read_all().to_pylist() == [{"revenue": 100}]
        assert (
            _call(client, monde, LECTEUR_PERSONNE, "GET", PATH + "/" + alice_id).status_code == 404
        )
        assert (
            _call(
                client, monde, LECTEUR_PERSONNE, "GET", PATH + "/" + alice_id + "/result"
            ).status_code
            == 404
        )
        assert (
            _call(
                client, monde, LECTEUR_GROUPE, "GET", f"/api/spaces/{B}/executions/{alice_id}"
            ).status_code
            == 404
        )
        own = _call(client, monde, LECTEUR_GROUPE, "GET", PATH).json()["executions"]
        assert [row["id"] for row in own] == [alice_id]
        admin = _call(client, monde, ADMIN_GROUPE, "GET", PATH, params={"scope": "space"}).json()[
            "executions"
        ]
        assert {row["id"] for row in admin} == {alice_id, bob_id}
        admin_detail = _call(client, monde, PLATEFORME_SEULE, "GET", PATH + "/" + alice_id)
        assert admin_detail.status_code == 200 and "evidence" not in admin_detail.json()
        assert (
            _call(client, monde, ADMIN_GROUPE, "GET", PATH + "/" + alice_id + "/result").status_code
            == 404
        )
        unknown = PATH + "/11111111-1111-1111-1111-111111111111"
        assert _call(client, monde, ADMIN_GROUPE, "GET", unknown).status_code == 404
        monkeypatch.setattr(ExecutionStore, "result", lambda *args: None)
        assert (
            _call(
                client, monde, LECTEUR_GROUPE, "GET", PATH + "/" + alice_id + "/result"
            ).status_code
            == 503
        )
    with monde.moteur.connect() as connection:
        measures = connection.execute(
            select(telemetry).where(telemetry.c.kind == "execution")
        ).all()
    assert len(measures) == 2
    assert all(item.outcome == "ok" and item.rows == 1 and item.size > 0 for item in measures)


def test_invalid_submission_and_refusals(
    monde: Monde, service: CatalogService, tmp_path: Path
) -> None:
    _prepare(monde)
    with _client(monde, service, tmp_path) as client:
        assert _call(client, monde, NON_MEMBRE, "POST", PATH, json=BODY).status_code == 404
        assert _call(client, monde, PLATEFORME_SEULE, "POST", PATH, json=BODY).status_code == 403
        patches: tuple[dict[str, Any], ...] = (
            {"sql": "SELECT 1"},
            {"metrics": []},
            {"metrics": ["x", "x"]},
            {"filters": [{"column": "tenant", "operator": "eq", "value": "A", "sql": "x"}]},
            {"filters": [{"column": "tenant", "operator": [], "value": "A"}]},
        )
        for patch in patches:
            response = _call(client, monde, LECTEUR_GROUPE, "POST", PATH, json={**BODY, **patch})
            assert response.status_code == 400
        assert (
            _call(
                client,
                monde,
                LECTEUR_GROUPE,
                "POST",
                PATH,
                content=b'{"connection":"source","environment":"DEV","model":"orders","metrics":["revenue"],"dimensions":[],"filters":[{"column":"tenant","operator":"eq","value":NaN}]}',
            ).status_code
            == 400
        )
        assert (
            _call(client, monde, LECTEUR_GROUPE, "GET", PATH, params={"scope": "other"}).status_code
            == 400
        )
        assert (
            _call(client, monde, LECTEUR_GROUPE, "GET", PATH, params={"scope": "space"}).status_code
            == 403
        )
        assert _call(client, monde, LECTEUR_GROUPE, "GET", PATH + "/bad").status_code == 404
        assert _call(client, monde, LECTEUR_GROUPE, "POST", PATH + "/bad/cancel").status_code == 404
        assert ExecutionStore(monde.moteur).list(A, LECTEUR_GROUPE.ref) == []


@pytest.mark.parametrize(
    "patch",
    [
        {"connection": "bad name"},
        {"model": "1bad"},
        {"environment": "prod"},
        {"metrics": "revenue"},
        {"metrics": ["bad-name"]},
        {"dimensions": ["x"] * 33},
        {"filters": "bad"},
        {"filters": [{}]},
        {"filters": [{"column": "bad-name", "operator": "eq", "value": 1}]},
        {"filters": [{"column": "tenant", "operator": "sql", "value": "A"}]},
        {"filters": [{"column": "tenant", "operator": "eq", "value": {"x": 1}}]},
        {"filters": [{"column": "tenant", "operator": "eq", "value": "x" * 1025}]},
        {"filters": [{"column": "tenant", "operator": "eq", "value": "\ud800"}]},
    ],
)
def test_request_contract_rejects_invalid_values(patch: dict[str, Any]) -> None:
    from skifer_board.spaces.web import Invalid

    with pytest.raises(Invalid):
        _request({**BODY, **patch})


def test_request_hash_comes_from_declarative_values() -> None:
    with_filter = {**BODY, "filters": [{"column": "tenant", "operator": "eq", "value": "A"}]}
    _, _, request, digest = _request(with_filter)
    assert request.filters == ({"column": "tenant", "operator": "eq", "value": "A"},)
    assert len(digest) == 64 and digest != _request(BODY)[3]


def test_unconfigured_and_missing_contracts(monde: Monde) -> None:
    _contract(monde.requete(LECTEUR_GROUPE, "POST", PATH, corps=BODY), "moteur-indisponible.json")
    _contract(monde.requete(LECTEUR_GROUPE, "GET", PATH + "/bad"), "execution-inconnue.json")
    assert monde.requete(LECTEUR_GROUPE, "GET", PATH).json() == {"executions": []}


def test_local_routes_explicitly_refuse_execution(service: CatalogService) -> None:
    with TestClient(
        create_app(service), base_url="http://127.0.0.1", raise_server_exceptions=False
    ) as client:
        assert client.get("/api/spaces/local/executions").json()["error"]["code"] == "local_mode"
        assert (
            client.post(
                "/api/spaces/local/executions", json=BODY, headers={"Origin": "http://127.0.0.1"}
            ).json()["error"]["code"]
            == "local_mode"
        )


def test_cancel_queued_and_result_refusal(monde: Monde) -> None:
    _prepare(monde, Connector.DATABRICKS)
    registry = ConnectionStore(monde.moteur)
    binding = registry.get_binding(A, "source", Environment.DEV)
    at = monde.horloge()
    store = ExecutionStore(monde.moteur)
    record = store.create(
        binding,
        LECTEUR_GROUPE.ref,
        "request",
        at,
        at + timedelta(seconds=30),
        at + timedelta(seconds=40),
        "owner",
    )
    url = PATH + "/" + record.id
    _contract(monde.requete(LECTEUR_GROUPE, "GET", url + "/result"), "resultat-indisponible.json")
    assert monde.requete(LECTEUR_GROUPE, "POST", url + "/cancel", corps={}).status_code == 400
    assert monde.requete(LECTEUR_PERSONNE, "POST", url + "/cancel").status_code == 404
    response = monde.requete(LECTEUR_GROUPE, "POST", url + "/cancel")
    assert response.status_code == 200 and response.json()["state"] == "cancelled"
    assert response.json()["error_code"] == "cancelled"
    _contract(monde.requete(LECTEUR_GROUPE, "GET", url + "/result"), "resultat-indisponible.json")
    assert monde.requete(ADMIN_GROUPE, "POST", url + "/cancel").json()["state"] == "cancelled"


def test_restart_just_before_lease_expiry_is_resolved_on_next_read(
    monde: Monde, service: CatalogService, tmp_path: Path
) -> None:
    _prepare(monde)
    binding = ConnectionStore(monde.moteur).get_binding(A, "source", Environment.DEV)
    at = monde.horloge()
    record = ExecutionStore(monde.moteur).create(
        binding,
        LECTEUR_GROUPE.ref,
        "request",
        at,
        at + timedelta(seconds=30),
        at + timedelta(seconds=40),
        "old-owner",
    )
    with _client(monde, service, tmp_path) as client:
        url = PATH + "/" + record.id
        assert _call(client, monde, LECTEUR_GROUPE, "GET", url).json()["state"] == "queued"
        monde.horloge.instant += timedelta(seconds=41)
        expired = _call(client, monde, LECTEUR_GROUPE, "GET", url).json()
        assert expired["state"] == "failed" and expired["error_code"] == "server_restarted"
        assert (
            _call(client, monde, LECTEUR_GROUPE, "GET", PATH).json()["executions"][0]["state"]
            == "failed"
        )


def test_worker_and_binding_refusal_contracts(
    monde: Monde, service: CatalogService, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _prepare(monde)
    with _client(monde, service, tmp_path) as client:
        monkeypatch.setattr(
            ExecutionWorkerPool, "submit", lambda *args: (_ for _ in ()).throw(ExecutionBusy())
        )
        _contract(
            _call(client, monde, LECTEUR_GROUPE, "POST", PATH, json=BODY),
            "travail-indisponible.json",
        )
        monkeypatch.setattr(
            ExecutionWorkerPool,
            "submit",
            lambda *args: (_ for _ in ()).throw(ExecutionUnavailable()),
        )
        _contract(
            _call(client, monde, LECTEUR_GROUPE, "POST", PATH, json=BODY), "liaison-modifiee.json"
        )


def test_missing_endpoint_person_identity_and_bad_attributes(
    monde: Monde, service: CatalogService, tmp_path: Path
) -> None:
    _prepare(monde)
    with _client(monde, service, tmp_path, endpoints={}) as client:
        response = _call(client, monde, LECTEUR_GROUPE, "POST", PATH, json=BODY)
        assert (
            response.status_code == 409
            and response.json()["error"]["code"] == "endpoint_not_configured"
        )
    with _client(
        monde, service, tmp_path, execution_reader_attributes=lambda _: {"tenant": 1}
    ) as client:
        _contract(
            _call(client, monde, LECTEUR_GROUPE, "POST", PATH, json=BODY),
            "moteur-indisponible.json",
        )
    registry = ConnectionStore(monde.moteur)
    registry.bind(
        A,
        "source",
        Environment.DEV,
        Connector.DUCKDB,
        "orders",
        IdentityMode.PERSON,
        ADMIN_GROUPE.ref,
        monde.horloge(),
    )
    with _client(monde, service, tmp_path) as client:
        response = _call(client, monde, LECTEUR_GROUPE, "POST", PATH, json=BODY)
        assert (
            response.status_code == 409
            and response.json()["error"]["code"] == "identity_unavailable"
        )


def test_databricks_submission_uses_vault_and_execution_is_measured(
    monde: Monde, service: CatalogService, tmp_path: Path
) -> None:
    _prepare(monde, Connector.DATABRICKS)
    keys = VaultKeys("test", {"test": b"1" * 32})
    CredentialVault(monde.moteur, keys).put(
        A, "source", Environment.DEV, "secret-sentinel", ADMIN_GROUPE.ref, monde.horloge()
    )

    class Transport:
        def post(self, url: str, token: str, body: dict[str, object]) -> HttpResponse:
            assert token == "secret-sentinel"
            return HttpResponse(
                200,
                b'{"statement_id":"12345678-1234-1234-1234-123456789abc","status":{"state":"SUCCEEDED"}}',
                "application/json",
            )

        def get(self, url: str, token: str) -> HttpResponse:
            assert token == "secret-sentinel"
            return HttpResponse(200, b"{}", "application/json")

    recorder = Recorder(TelemetryStore(monde.moteur), monde.horloge)
    with _client(
        monde,
        service,
        tmp_path,
        endpoints={
            "orders": DatabricksEndpoint("https://dbc-123.cloud.databricks.com", "warehouse")
        },
        vault_keys=keys,
        connection_transport=Transport(),
        recorder=recorder,
    ) as client:
        submitted = _call(client, monde, LECTEUR_GROUPE, "POST", PATH, json=BODY)
        assert submitted.status_code == 202 and submitted.json()["can_cancel"] is True
        done = _done(client, monde, LECTEUR_GROUPE, submitted.json()["id"])
        assert done["state"] == "failed" and done["error_code"] == "invalid_upstream"
        assert "secret-sentinel" not in str(done)
    with monde.moteur.connect() as connection:
        measures = connection.execute(
            select(telemetry).where(telemetry.c.kind == "execution")
        ).all()
    assert len(measures) == 1
    assert (
        measures[0].operation,
        measures[0].space_id,
        measures[0].environment,
        measures[0].outcome,
    ) == ("semantic.execute", A, "DEV", "invalid_upstream")
    assert "secret-sentinel" not in str(measures[0])


def test_databricks_submission_resolves_endpoint_entered_in_board(
    monde: Monde, service: CatalogService, tmp_path: Path
) -> None:
    endpoint = DatabricksEndpoint("https://adb-123.2.azuredatabricks.net", "warehouse")
    ConnectionStore(monde.moteur).create_endpoint(
        A, "orders", endpoint, ADMIN_GROUPE.ref, monde.horloge()
    )
    _prepare(monde, Connector.DATABRICKS)
    keys = VaultKeys("test", {"test": b"1" * 32})
    CredentialVault(monde.moteur, keys).put(
        A, "source", Environment.DEV, "secret-sentinel", ADMIN_GROUPE.ref, monde.horloge()
    )

    class Transport:
        def post(self, url: str, token: str, body: dict[str, object]) -> HttpResponse:
            assert url == endpoint.host + "/api/2.0/sql/statements"
            assert token == "secret-sentinel"
            return HttpResponse(503, b"", "application/json")

        def get(self, url: str, token: str) -> HttpResponse:
            raise AssertionError("Aucun GET attendu après un refus de soumission")

    with _client(
        monde, service, tmp_path, endpoints={}, vault_keys=keys, connection_transport=Transport()
    ) as client:
        submitted = _call(client, monde, LECTEUR_GROUPE, "POST", PATH, json=BODY)
        assert submitted.status_code == 202
        done = _done(client, monde, LECTEUR_GROUPE, submitted.json()["id"])
        assert done["state"] == "failed"


def test_databricks_without_vault_fails_closed(
    monde: Monde, service: CatalogService, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import skifer_board.server as server

    _prepare(monde, Connector.DATABRICKS)
    monkeypatch.setattr(server, "CredentialVault", lambda *args: None)
    with _client(
        monde,
        service,
        tmp_path,
        endpoints={
            "orders": DatabricksEndpoint("https://dbc-123.cloud.databricks.com", "warehouse")
        },
    ) as client:
        _contract(
            _call(client, monde, LECTEUR_GROUPE, "POST", PATH, json=BODY),
            "moteur-indisponible.json",
        )
