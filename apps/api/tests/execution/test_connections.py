"""Registre de connexions du lot 03 : droits, isolation, journal, états et refus."""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC
from pathlib import Path
from typing import Any, cast

import pytest
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from fastapi.testclient import TestClient
from identity.conftest import cles as cles
from identity.conftest import config as config
from identity.conftest import fournisseur as fournisseur
from identity.conftest import horloge as horloge
from skifer_board.execution import ConnectionStore
from skifer_board.execution.model import Connector, IdentityMode
from skifer_board.execution.store import (
    BindingNotFound,
    ConnectionExists,
    ConnectionInUse,
    ConnectionNotFound,
)
from skifer_board.server import create_app
from skifer_board.spaces.model import Environment
from skifer_board.state.schema import connection_bindings, logical_connections, space_events
from spaces.monde import (
    ADMIN_B,
    ADMIN_GROUPE,
    CREATEUR_GROUPE,
    LECTEUR_GROUPE,
    NON_MEMBRE,
    PLATEFORME_SEULE,
    A,
    B,
    Monde,
)
from spaces.monde import config_plateforme as config_plateforme
from spaces.monde import monde as monde
from sqlalchemy import select
from state.conftest import migre as migre

PATH = f"/api/spaces/{A}/connections"
CONTRACTS = Path(__file__).resolve().parents[4] / "contracts" / "executions"


def erreur(code: str) -> dict[str, Any]:
    return {"error": {"code": code}}


def contrat(name: str) -> dict[str, Any]:
    return cast(dict[str, Any], json.loads((CONTRACTS / name).read_text())["body"])


def creer(monde: Monde, name: str = "finance") -> dict[str, Any]:
    response = monde.requete(ADMIN_GROUPE, "POST", PATH, corps={"name": name})
    assert response.status_code == 201, response.text
    return cast(dict[str, Any], response.json())


def lier(
    monde: Monde,
    environment: str = "DEV",
    name: str = "finance",
    connector: str = "databricks",
    endpoint: str = "warehouse-prod",
    identity: str = "service",
) -> Any:
    return monde.requete(
        ADMIN_GROUPE,
        "PUT",
        f"{PATH}/{name}/bindings/{environment}",
        corps={"connector": connector, "endpoint_key": endpoint, "identity_mode": identity},
    )


def test_cycle_isolation_et_journal(monde: Monde) -> None:
    created = creer(monde)
    assert created["name"] == "finance"
    assert [part["state"] for part in created["bindings"]] == ["unconfigured"] * 3
    assert created["created_by"]["subject"] == ADMIN_GROUPE.sujet
    assert created["created_at"].endswith("+00:00")
    response = lier(monde)
    assert response.status_code == 200
    assert response.json()["credential_state"] == "unconfigured"
    assert response.json()["endpoint_key"] == "warehouse-prod"
    # Le même état est idempotent ; ni auteur ni journal ne changent.
    before = monde.magasin.events(A)
    again = lier(monde)
    assert again.json() == response.json()
    assert monde.magasin.events(A) == before
    assert (
        lier(monde, "TEST", connector="duckdb", endpoint="local", identity="person").status_code
        == 200
    )
    listed = monde.requete(ADMIN_GROUPE, "GET", PATH).json()["connections"]
    assert [part["environment"] for part in listed[0]["bindings"]] == ["DEV", "TEST", "PROD"]
    assert listed[0]["bindings"][2] == {"environment": "PROD", "state": "unconfigured"}
    assert monde.requete(ADMIN_B, "GET", f"/api/spaces/{B}/connections").json() == {
        "connections": []
    }
    assert monde.requete(ADMIN_B, "GET", PATH).json() == erreur("space_not_found")
    assert [event.action for event in monde.magasin.events(A)][:3] == [
        "connection_bound",
        "connection_bound",
        "connection_created",
    ]
    # Une connexion liée ne peut disparaître.
    blocked = monde.requete(ADMIN_GROUPE, "DELETE", f"{PATH}/finance")
    assert blocked.status_code == 409 and blocked.json() == contrat("connexion-utilisee.json")
    for env in ("DEV", "TEST"):
        assert (
            monde.requete(ADMIN_GROUPE, "DELETE", f"{PATH}/finance/bindings/{env}").status_code
            == 204
        )
    assert monde.requete(ADMIN_GROUPE, "DELETE", f"{PATH}/finance").status_code == 204
    assert monde.requete(ADMIN_GROUPE, "GET", PATH).json() == {"connections": []}
    assert [event.action for event in monde.magasin.events(A)][:3] == [
        "connection_removed",
        "connection_unbound",
        "connection_unbound",
    ]
    with monde.moteur.connect() as connection:
        assert connection.execute(select(logical_connections)).all() == []
        assert connection.execute(select(connection_bindings)).all() == []


@pytest.mark.parametrize(
    "profile,expected",
    [
        (LECTEUR_GROUPE, "forbidden"),
        (CREATEUR_GROUPE, "forbidden"),
        (NON_MEMBRE, "space_not_found"),
    ],
)
def test_droits(monde: Monde, profile: Any, expected: str) -> None:
    for method, path, body in (
        ("GET", PATH, None),
        ("POST", PATH, {"name": "x"}),
        ("DELETE", f"{PATH}/x", None),
    ):
        response = monde.requete(profile, method, path, corps=body)
        assert response.status_code in (403, 404)
        assert response.json()["error"]["code"] == expected
    assert monde.requete(PLATEFORME_SEULE, "GET", PATH).status_code == 200


def test_refus_et_validation(monde: Monde) -> None:
    assert monde.requete(ADMIN_GROUPE, "POST", PATH, corps={"name": "Bad"}).json() == {
        "error": {"code": "invalid_request", "field": "name"}
    }
    creer(monde)
    duplicate = monde.requete(ADMIN_GROUPE, "POST", PATH, corps={"name": "finance"})
    assert duplicate.status_code == 409 and duplicate.json() == contrat("connexion-existante.json")
    assert lier(monde, name="absent").json() == contrat("connexion-inconnue.json")
    for field, changed in (
        ("connector", {"connector": "sqlite"}),
        ("endpoint_key", {"endpoint_key": "https://example.invalid"}),
        ("identity_mode", {"identity_mode": "unknown"}),
    ):
        body = {"connector": "databricks", "endpoint_key": "warehouse", "identity_mode": "person"}
        body.update(changed)
        response = monde.requete(ADMIN_GROUPE, "PUT", f"{PATH}/finance/bindings/DEV", corps=body)
        assert response.status_code == 400
        assert response.json() == {"error": {"code": "invalid_request", "field": field}}
    assert lier(monde, environment="QA").json() == {
        "error": {"code": "invalid_request", "field": "environment"}
    }
    assert monde.requete(ADMIN_GROUPE, "DELETE", f"{PATH}/finance/bindings/DEV").json() == contrat(
        "liaison-inconnue.json"
    )
    assert monde.requete(ADMIN_GROUPE, "DELETE", f"{PATH}/absent").json() == erreur(
        "connection_not_found"
    )
    assert monde.requete(ADMIN_GROUPE, "DELETE", f"{PATH}/Bad").json() == {
        "error": {"code": "invalid_request", "field": "name"}
    }
    assert (
        monde.requete(
            ADMIN_GROUPE, "POST", PATH, corps={"name": "x", "secret": "value"}
        ).status_code
        == 400
    )


def test_magasin_refus_et_remplacement(monde: Monde) -> None:
    store = ConnectionStore(monde.moteur)
    now = monde.horloge()
    actor = ADMIN_GROUPE.ref
    with pytest.raises(ConnectionNotFound):
        store.bind(
            A,
            "missing",
            Environment.DEV,
            Connector.DUCKDB,
            "local",
            IdentityMode.PERSON,
            actor,
            now,
        )
    with pytest.raises(ConnectionNotFound):
        store.unbind(A, "missing", Environment.DEV, actor, now)
    with pytest.raises(ConnectionNotFound):
        store.remove(A, "missing", actor, now)
    store.create(A, "x", actor, now)
    with pytest.raises(ConnectionExists):
        store.create(A, "x", actor, now)
    with pytest.raises(BindingNotFound):
        store.unbind(A, "x", Environment.DEV, actor, now)
    first = store.bind(
        A, "x", Environment.DEV, Connector.DUCKDB, "local", IdentityMode.PERSON, actor, now
    )
    changed = store.bind(
        A, "x", Environment.DEV, Connector.DATABRICKS, "wh", IdentityMode.SERVICE, actor, now
    )
    assert changed.set_at.astimezone(UTC) == now.astimezone(UTC)
    assert first.connector is Connector.DUCKDB
    assert store.list(A)[0][1][0].connector is Connector.DATABRICKS
    with pytest.raises(ConnectionInUse):
        store.remove(A, "x", actor, now)
    store.unbind(A, "x", Environment.DEV, actor, now)
    store.remove(A, "x", actor, now)
    with monde.moteur.connect() as connection:
        assert connection.execute(
            select(space_events).where(space_events.c.action == "connection_removed")
        ).one().detail == {"name": "x"}


def test_mode_local(service: Any) -> None:
    with TestClient(create_app(service), raise_server_exceptions=False) as client:
        response = client.get("/api/spaces/local/connections")
        assert response.status_code == 409
        assert response.json() == erreur("local_mode")


def test_deux_serveurs_ne_creent_qu_une_connexion(monde: Monde) -> None:
    stores = (ConnectionStore(monde.moteur), ConnectionStore(monde.moteur))

    def create(store: ConnectionStore) -> str:
        try:
            store.create(A, "concurrent", ADMIN_GROUPE.ref, monde.horloge())
            return "created"
        except ConnectionExists:
            return "exists"

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(create, stores)) == ["created", "exists"]
    assert [logical.name for logical, _ in stores[0].list(A)] == ["concurrent"]
    assert [e.action for e in monde.magasin.events(A)].count("connection_created") == 1
