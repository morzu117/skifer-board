"""Points d'accès Databricks saisis dans Board (plan 14)."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

import pytest
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from fastapi.testclient import TestClient
from identity.conftest import cles as cles
from identity.conftest import config as config
from identity.conftest import fournisseur as fournisseur
from identity.conftest import horloge as horloge
from skifer_board.catalog import CatalogService
from skifer_board.execution import ConnectionStore
from skifer_board.execution.connectors import (
    DatabricksEndpoint,
    EndpointConfigError,
    HttpResponse,
    databricks_endpoint,
)
from skifer_board.execution.store import EndpointExists
from skifer_board.execution.vault import VaultKeys
from skifer_board.server import create_app
from skifer_board.spaces.model import PersonRef
from spaces.monde import ADMIN_GROUPE, LECTEUR_GROUPE, ORIGINE, A, B, Monde, espaces_en_base
from spaces.monde import config_plateforme as config_plateforme
from spaces.monde import monde as monde
from state.conftest import migre as migre

ROUTE = f"/api/spaces/{A}/connection-endpoints"
BODY = {
    "key": "azure-test",
    "host": "https://adb-123.2.azuredatabricks.net",
    "warehouse_id": "abc123",
}


@pytest.mark.parametrize("key", ["databricks_test", "databricks-test", "databricks_test-dev"])
def test_cle_avec_separateurs_creation_liaison_et_retrait(monde: Monde, key: str) -> None:
    body = {**BODY, "key": key}
    created = monde.requete(ADMIN_GROUPE, "POST", ROUTE, corps=body)
    assert created.status_code == 201
    assert created.json() == body
    listed = monde.requete(ADMIN_GROUPE, "GET", ROUTE)
    assert listed.json() == {"endpoints": [body]}
    connections = f"/api/spaces/{A}/connections"
    assert (
        monde.requete(ADMIN_GROUPE, "POST", connections, corps={"name": "source"}).status_code
        == 201
    )
    binding = f"{connections}/source/bindings/DEV"
    bound = monde.requete(
        ADMIN_GROUPE,
        "PUT",
        binding,
        corps={"connector": "databricks", "endpoint_key": key, "identity_mode": "service"},
    )
    assert bound.status_code == 200
    assert bound.json()["endpoint_key"] == key
    assert monde.requete(ADMIN_GROUPE, "DELETE", binding).status_code == 204
    assert monde.requete(ADMIN_GROUPE, "DELETE", f"{ROUTE}/{key}").status_code == 204


def test_validation_du_point_d_acces() -> None:
    assert databricks_endpoint(BODY["host"], BODY["warehouse_id"]) == DatabricksEndpoint(
        BODY["host"], BODY["warehouse_id"]
    )
    for host, warehouse in (
        ("http://adb-123.2.azuredatabricks.net", "abc123"),
        ("https://localhost", "abc123"),
        ("https://adb-123.2.azuredatabricks.net/api", "abc123"),
        (BODY["host"], "invalid/id"),
    ):
        with pytest.raises(EndpointConfigError):
            databricks_endpoint(host, warehouse)


def test_registre_par_espace_et_suppression_en_usage(monde: Monde) -> None:
    store = ConnectionStore(monde.moteur)
    actor = PersonRef.of(ADMIN_GROUPE.identite)
    at = datetime.now(UTC)
    endpoint = databricks_endpoint(BODY["host"], BODY["warehouse_id"])
    assert store.get_endpoint(A, "azure-test") is None
    assert store.create_endpoint(A, "azure-test", endpoint, actor, at) == BODY
    assert store.list_endpoints(A) == [BODY]
    assert store.list_endpoints(B) == []
    assert store.get_endpoint(A, "azure-test") == endpoint
    assert store.get_endpoint(B, "azure-test") is None
    with pytest.raises(Exception, match="azure-test"):
        store.create_endpoint(A, "azure-test", endpoint, actor, at)
    assert (
        monde.requete(
            ADMIN_GROUPE, "POST", f"/api/spaces/{A}/connections", corps={"name": "source"}
        ).status_code
        == 201
    )
    assert (
        monde.requete(
            ADMIN_GROUPE,
            "PUT",
            f"/api/spaces/{A}/connections/source/bindings/DEV",
            corps={
                "connector": "databricks",
                "endpoint_key": "azure-test",
                "identity_mode": "service",
            },
        ).status_code
        == 200
    )
    with pytest.raises(Exception, match="azure-test"):
        store.remove_endpoint(A, "azure-test", actor, at)
    assert (
        monde.requete(
            ADMIN_GROUPE, "DELETE", f"/api/spaces/{A}/connections/source/bindings/DEV"
        ).status_code
        == 204
    )
    store.remove_endpoint(A, "azure-test", actor, at)
    assert store.list_endpoints(A) == []
    with pytest.raises(Exception, match="azure-test"):
        store.remove_endpoint(A, "azure-test", actor, at)


def test_creation_concurrente_ne_produit_qu_un_point(monde: Monde) -> None:
    store = ConnectionStore(monde.moteur)
    actor = ADMIN_GROUPE.ref
    endpoint = databricks_endpoint(BODY["host"], BODY["warehouse_id"])

    def create() -> str:
        try:
            store.create_endpoint(A, "azure-test", endpoint, actor, monde.horloge())
            return "created"
        except EndpointExists:
            return "exists"

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(lambda _: create(), range(2))) == ["created", "exists"]
    assert store.list_endpoints(A) == [BODY]


def test_une_cle_de_liaison_existante_ne_peut_changer_de_workspace(monde: Monde) -> None:
    assert (
        monde.requete(
            ADMIN_GROUPE, "POST", f"/api/spaces/{A}/connections", corps={"name": "source"}
        ).status_code
        == 201
    )
    binding = f"/api/spaces/{A}/connections/source/bindings/DEV"
    assert (
        monde.requete(
            ADMIN_GROUPE,
            "PUT",
            binding,
            corps={
                "connector": "databricks",
                "endpoint_key": "azure-test",
                "identity_mode": "service",
            },
        ).status_code
        == 200
    )
    response = monde.requete(ADMIN_GROUPE, "POST", ROUTE, corps=BODY)
    assert response.status_code == 409
    assert response.json() == {"error": {"code": "endpoint_in_use"}}
    assert monde.requete(ADMIN_GROUPE, "DELETE", binding).status_code == 204
    assert monde.requete(ADMIN_GROUPE, "POST", ROUTE, corps=BODY).status_code == 201


def test_routes_de_configuration_et_refus(monde: Monde) -> None:
    assert monde.requete(LECTEUR_GROUPE, "GET", ROUTE).status_code == 403
    assert monde.requete(ADMIN_GROUPE, "GET", ROUTE).json() == {"endpoints": []}
    assert monde.requete(ADMIN_GROUPE, "POST", ROUTE, corps=BODY).status_code == 201
    assert monde.requete(ADMIN_GROUPE, "GET", ROUTE).json() == {"endpoints": [BODY]}
    assert monde.requete(ADMIN_GROUPE, "POST", ROUTE, corps=BODY).json() == {
        "error": {"code": "endpoint_exists"}
    }
    for wrong in (
        {**BODY, "key": "Bad"},
        {**BODY, "host": "https://localhost"},
        {**BODY, "warehouse_id": 3},
        {**BODY, "key": 3},
    ):
        assert monde.requete(ADMIN_GROUPE, "POST", ROUTE, corps=wrong).status_code == 400
    assert monde.requete(ADMIN_GROUPE, "DELETE", ROUTE + "/Bad").status_code == 400
    assert monde.requete(ADMIN_GROUPE, "DELETE", ROUTE + "/missing").json() == {
        "error": {"code": "endpoint_not_found"}
    }
    assert monde.requete(ADMIN_GROUPE, "DELETE", ROUTE + "/azure-test").status_code == 204


def test_resolution_par_board_pour_essai(monde: Monde, service: CatalogService) -> None:
    class Transport:
        def get(self, url: str, token: str) -> HttpResponse:
            assert url == BODY["host"] + "/api/2.0/sql/warehouses/abc123"
            assert token == "sentinelle"
            return HttpResponse(200, b'{"id":"abc123","state":"RUNNING"}', "application/json")

        def post(self, url: str, token: str, body: dict[str, object]) -> HttpResponse:
            raise AssertionError("L'essai ne soumet aucun statement")

    app = create_app(
        service,
        monde.runtime,
        espaces_en_base(monde.moteur, monde.horloge),
        connections=ConnectionStore(monde.moteur),
        vault_keys=VaultKeys("test", {"test": b"1" * 32}),
        connection_transport=Transport(),
    )
    headers = {"Origin": ORIGINE, "Cookie": f"__Host-sb_session={monde.session(ADMIN_GROUPE)}"}
    with TestClient(app, base_url=ORIGINE) as client:
        assert client.post(ROUTE, headers=headers, json=BODY).status_code == 201
        assert (
            client.post(
                f"/api/spaces/{A}/connections", headers=headers, json={"name": "source"}
            ).status_code
            == 201
        )
        binding = f"/api/spaces/{A}/connections/source/bindings/DEV"
        assert (
            client.put(
                binding,
                headers=headers,
                json={
                    "connector": "databricks",
                    "endpoint_key": "azure-test",
                    "identity_mode": "service",
                },
            ).status_code
            == 200
        )
        assert (
            client.put(
                binding + "/credential", headers=headers, json={"secret": "sentinelle"}
            ).status_code
            == 204
        )
        assert client.post(binding + "/test", headers=headers).status_code == 200
        assert client.delete(ROUTE + "/azure-test", headers=headers).json() == {
            "error": {"code": "endpoint_in_use"}
        }
    restarted = create_app(
        service,
        monde.runtime,
        espaces_en_base(monde.moteur, monde.horloge),
        connections=ConnectionStore(monde.moteur),
        vault_keys=VaultKeys("test", {"test": b"1" * 32}),
        endpoints={
            "azure-test": DatabricksEndpoint("https://dbc-999.cloud.databricks.com", "other")
        },
        connection_transport=Transport(),
    )
    with TestClient(restarted, base_url=ORIGINE) as client:
        assert client.post(binding + "/test", headers=headers).status_code == 200


def test_cle_reservee_par_la_configuration_serveur(monde: Monde, service: CatalogService) -> None:
    app = create_app(
        service,
        monde.runtime,
        espaces_en_base(monde.moteur, monde.horloge),
        endpoints={"azure-test": DatabricksEndpoint(BODY["host"], BODY["warehouse_id"])},
    )
    headers = {"Origin": ORIGINE, "Cookie": f"__Host-sb_session={monde.session(ADMIN_GROUPE)}"}
    with TestClient(app, base_url=ORIGINE) as client:
        response = client.post(ROUTE, headers=headers, json=BODY)
        assert response.status_code == 400
        assert response.json() == {"error": {"code": "invalid_request", "field": "key"}}


@pytest.mark.parametrize("upstream,status", [(200, 200), (401, 409), (503, 503)])
def test_essai_direct_sans_conserver_le_jeton(
    monde: Monde, service: CatalogService, upstream: int, status: int
) -> None:
    calls: list[str] = []

    class Transport:
        def get(self, url: str, token: str) -> HttpResponse:
            assert url == BODY["host"] + "/api/2.0/sql/warehouses/abc123"
            assert token == "sentinelle"
            calls.append(url)
            return HttpResponse(upstream, b'{"id":"abc123","state":"RUNNING"}', "application/json")

        def post(self, url: str, token: str, body: dict[str, object]) -> HttpResponse:
            raise AssertionError("Aucun statement attendu")

    app = create_app(
        service,
        monde.runtime,
        espaces_en_base(monde.moteur, monde.horloge),
        connections=ConnectionStore(monde.moteur),
        connection_transport=Transport(),
    )
    headers = {"Origin": ORIGINE, "Cookie": f"__Host-sb_session={monde.session(ADMIN_GROUPE)}"}
    route = ROUTE + "/azure-test/test"
    with TestClient(app, base_url=ORIGINE) as client:
        assert client.post(ROUTE, headers=headers, json=BODY).status_code == 201
        for body in ({}, {"secret": ""}, {"secret": 1}, {"secret": "x" * 16385}):
            assert client.post(route, headers=headers, json=body).status_code == 400
        assert (
            client.post(
                ROUTE + "/Bad/test", headers=headers, json={"secret": "sentinelle"}
            ).status_code
            == 400
        )
        assert (
            client.post(
                ROUTE + "/absent/test", headers=headers, json={"secret": "sentinelle"}
            ).status_code
            == 409
        )
        assert (
            client.post(
                route, headers={"Origin": ORIGINE}, json={"secret": "sentinelle"}
            ).status_code
            == 401
        )
        reader = {**headers, "Cookie": f"__Host-sb_session={monde.session(LECTEUR_GROUPE)}"}
        assert client.post(route, headers=reader, json={"secret": "sentinelle"}).status_code == 403
        assert (
            client.post(
                route,
                headers={**headers, "Origin": "https://evil.invalid"},
                json={"secret": "sentinelle"},
            ).status_code
            == 403
        )
        assert client.post(
            route.replace(f"/{A}/", f"/{B}/"), headers=headers, json={"secret": "sentinelle"}
        ).status_code in (403, 404, 409)
        assert calls == []
        result = client.post(route, headers=headers, json={"secret": "sentinelle"})
        assert result.status_code == status
        assert len(calls) == 1
        assert "sentinelle" not in result.text + str(result.headers)
        assert client.get(f"/api/spaces/{A}/connections", headers=headers).json() == {
            "connections": []
        }
        assert client.delete(ROUTE + "/azure-test", headers=headers).status_code == 204
