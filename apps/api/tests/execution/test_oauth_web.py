"""Parcours URL → OAuth → découverte et essai sous l'identité personnelle."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterator
from datetime import timedelta
from typing import cast
from urllib.parse import parse_qs, urlencode, urlsplit

import pytest
from fastapi import FastAPI, Request, Response
from fastapi.testclient import TestClient
from skifer_board.catalog import CatalogService
from skifer_board.execution.connectors import DatabricksEndpoint, HttpResponse
from skifer_board.execution.oauth import CALLBACK
from skifer_board.server import create_app
from skifer_board.state.schema import databricks_oauth, space_bindings
from spaces.monde import (
    ADMIN_GROUPE,
    ADMIN_PERSONNE,
    CREATEUR_GROUPE,
    LECTEUR_GROUPE,
    NON_MEMBRE,
    ORIGINE,
    PLATEFORME_SEULE,
    A,
    B,
    Monde,
    Profil,
    espaces_en_base,
)
from sqlalchemy import delete, update

from execution.test_oauth import CONFIG, HOST, KEYS, Forms, response
from execution.test_oauth import cles as cles
from execution.test_oauth import config as config
from execution.test_oauth import config_plateforme as config_plateforme
from execution.test_oauth import espace as espace
from execution.test_oauth import fournisseur as fournisseur
from execution.test_oauth import horloge as horloge
from execution.test_oauth import migre as migre
from execution.test_oauth import monde as monde
from execution.test_oauth import service as service

ROOT = f"/api/spaces/{A}/databricks-oauth"


class Http:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []
        self.result = response(
            {"warehouses": [{"id": "wh1", "name": "Warehouse 1", "state": "RUNNING"}]}
        )

    def get(self, url: str, token: str) -> HttpResponse:
        self.calls.append((url, token))
        if url.endswith("/wh1"):
            return response({"id": "wh1", "state": "RUNNING"})
        return self.result

    def post(self, url: str, token: str, body: dict[str, object]) -> HttpResponse:
        raise AssertionError("Aucun SQL attendu")


@pytest.fixture
def forms() -> Forms:
    return Forms()


@pytest.fixture
def http() -> Http:
    return Http()


@pytest.fixture
def client(monde: Monde, service: CatalogService, forms: Forms, http: Http) -> Iterator[TestClient]:
    app = create_app(
        service,
        monde.runtime,
        espaces_en_base(monde.moteur, monde.horloge),
        vault_keys=KEYS,
        databricks_oauth_client_id=CONFIG.client_id,
        databricks_oauth_transport=forms,
        connection_transport=http,
        endpoints={"reserved": DatabricksEndpoint(HOST, "wh1")},
    )
    queries: list[bytes] = []
    app.state.oauth_queries = queries

    @app.middleware("http")
    async def observe(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        result = await call_next(request)
        if request.url.path == CALLBACK:
            queries.append(request.scope["query_string"])
        return result

    with TestClient(app, base_url=ORIGINE, follow_redirects=False) as current:
        current.headers.update(
            {"Origin": ORIGINE, "Cookie": f"__Host-sb_session={monde.session(ADMIN_GROUPE)}"}
        )
        yield current


def begin(client: TestClient, return_to: str = "connections") -> str:
    started = client.post(ROOT + "/start", json={"host": HOST + "/", "return_to": return_to})
    assert started.status_code == 200
    params = parse_qs(urlsplit(str(started.json()["authorization_url"])).query)
    assert params["redirect_uri"] == [ORIGINE + CALLBACK]
    return params["state"][0]


def connect(client: TestClient, return_to: str = "connections") -> None:
    result = client.get(
        CALLBACK, params={"state": begin(client, return_to), "code": "code-sentinel"}
    )
    assert result.status_code == 303
    assert "databricks_oauth=connected" in result.headers["location"]
    target = "connexions" if return_to == "connections" else "executions"
    assert f"#/espaces/finance/{target}" in result.headers["location"]


def test_parcours_oauth_decouverte_selection_essai_et_deconnexion(
    client: TestClient, monde: Monde, forms: Forms, http: Http
) -> None:
    assert client.get(ROOT).json() == {
        "configured": True,
        "redirect_uri": CONFIG.callback,
        "connections": [],
    }
    connect(client)
    assert forms.calls[0][1]["code"] == "code-sentinel"
    assert forms.calls[0][1]["grant_type"] == "authorization_code"
    status = client.get(ROOT)
    assert status.json()["connections"][0]["host"] == HOST
    assert "access-sentinel" not in status.text
    discovered = client.post(ROOT + "/warehouses", json={"host": HOST})
    assert discovered.status_code == 200
    assert discovered.json()["warehouses"][0]["id"] == "wh1"
    selected = client.post(
        ROOT + "/select", json={"host": HOST, "key": "databricks_test", "warehouse_id": "wh1"}
    )
    assert selected.status_code == 201
    assert selected.json() == {"key": "databricks_test", "host": HOST, "warehouse_id": "wh1"}
    probe = client.post(ROOT + "/test", json={"host": HOST, "warehouse_id": "wh1"})
    assert probe.json()["identity"] == "person"
    assert probe.json()["state"] == "RUNNING"
    assert probe.json()["credential_expires_at"] is not None
    assert all(token == "access-sentinel" for _, token in http.calls)
    assert "sentinel" not in probe.text
    # Le renouvellement est automatique, sans saisie d'un jeton.
    monde.horloge.instant += timedelta(hours=1)
    client.headers["Cookie"] = f"__Host-sb_session={monde.session(ADMIN_GROUPE)}"
    # Le fixture garde le même identifiant de session : renouveler explicitement pour ce test.
    client.headers["Cookie"] = (
        f"__Host-sb_session={monde.runtime.sessions.create(ADMIN_GROUPE.identite, monde.horloge())}"
    )
    assert client.post(ROOT + "/warehouses", json={"host": HOST}).status_code == 200
    assert forms.calls[-1][1]["grant_type"] == "refresh_token"
    assert client.request("DELETE", ROOT, json={"host": HOST}).status_code == 204
    assert client.get(ROOT).json()["connections"] == []
    assert client.post(ROOT + "/warehouses", json={"host": HOST}).json() == {
        "error": {"code": "oauth_reconnect"}
    }


def test_droits_isolation_origine_et_validation(
    client: TestClient, monde: Monde, http: Http
) -> None:
    connect(client)
    assert client.post(ROOT + "/start", json={"host": "https://localhost"}).status_code == 400
    assert client.post(ROOT + "/start", json={"host": 3}).status_code == 400
    assert client.post(ROOT + "/start", json={"host": HOST, "extra": True}).status_code == 400
    for key in (3, "Bad", "reserved"):
        assert (
            client.post(
                ROOT + "/select", json={"host": HOST, "key": key, "warehouse_id": "wh1"}
            ).status_code
            == 400
        )
    assert (
        client.post(
            ROOT + "/select", json={"host": HOST, "key": "valid", "warehouse_id": "not-visible"}
        ).status_code
        == 400
    )
    for key in (3, "bad/id"):
        assert (
            client.post(ROOT + "/test", json={"host": HOST, "warehouse_id": key}).status_code == 400
        )
    assert (
        client.post(
            ROOT + "/start", json={"host": HOST}, headers={"Origin": "https://evil.invalid"}
        ).status_code
        == 403
    )
    assert (
        client.get(
            ROOT, headers={"Cookie": f"__Host-sb_session={monde.session(LECTEUR_GROUPE)}"}
        ).json()["connections"]
        == []
    )
    other = {"Cookie": f"__Host-sb_session={monde.session(ADMIN_PERSONNE)}"}
    assert client.get(ROOT, headers=other).json()["connections"] == []
    assert client.post(ROOT + "/warehouses", json={"host": HOST}, headers=other).status_code == 409
    assert client.get(ROOT.replace(f"/{A}/", f"/{B}/")).status_code == 404
    assert (
        client.post(
            ROOT + "/warehouses", json={"host": "https://adb-999.2.azuredatabricks.net"}
        ).status_code
        == 409
    )
    assert all(url.startswith(HOST) for url, _ in http.calls)


@pytest.mark.parametrize(
    "case",
    [
        "denied",
        "missing-code",
        "duplicate-code",
        "expired",
        "binding",
        "owner",
        "replayed",
        "provider",
        "no-session",
        "missing-state",
        "duplicate-state",
        "revoked",
        "vault",
    ],
)
def test_callback_refuse_ferme(case: str, client: TestClient, monde: Monde, forms: Forms) -> None:
    state = begin(client)
    params: list[tuple[str, str]] = [("state", state), ("code", "code-sentinel")]
    if case == "denied":
        params = [("state", state), ("error", "access_denied")]
    elif case == "missing-code":
        params = [("state", state)]
    elif case == "duplicate-code":
        params.append(("code", "other"))
    elif case == "expired":
        monde.horloge.instant += timedelta(minutes=11)
    elif case == "binding":
        binding = monde.runtime.sessions.create(ADMIN_GROUPE.identite, monde.horloge())
        client.headers["Cookie"] = f"__Host-sb_session={binding}"
    elif case == "owner":
        client.headers["Cookie"] = f"__Host-sb_session={monde.session(ADMIN_PERSONNE)}"
    elif case == "replayed":
        assert client.get(CALLBACK, params=urlencode(params)).status_code == 303
    elif case == "revoked":
        with monde.moteur.begin() as connection:
            connection.execute(
                delete(space_bindings).where(
                    space_bindings.c.space_id == A, space_bindings.c.group_name == "finance-admins"
                )
            )
    elif case == "vault":
        with monde.moteur.begin() as connection:
            connection.execute(update(databricks_oauth).values(ciphertext=b"broken"))
    elif case == "provider":
        forms.result = response({}, 401)
    elif case == "no-session":
        client.headers["Cookie"] = "__Host-sb_session=absent"
    elif case == "missing-state":
        params = [("code", "code-sentinel")]
    elif case == "duplicate-state":
        params.append(("state", state))
    result = client.get(CALLBACK, params=urlencode(params))
    assert result.status_code in (303, 400)
    assert "databricks_oauth=connected" not in result.headers.get("location", "")
    assert "code-sentinel" not in result.text + str(result.headers)
    assert result.headers["referrer-policy"] == "no-referrer"


def test_code_retire_des_journaux_et_etat_consomme(client: TestClient) -> None:
    connect(client)
    assert cast(FastAPI, client.app).state.oauth_queries == [b""]


@pytest.mark.parametrize("missing", ["client", "keys", "identity"])
def test_configuration_absente_et_mode_local(
    missing: str, monde: Monde, service: CatalogService
) -> None:
    app = create_app(
        service,
        None if missing == "identity" else monde.runtime,
        None if missing == "identity" else espaces_en_base(monde.moteur, monde.horloge),
        vault_keys=None if missing == "keys" else KEYS,
        databricks_oauth_client_id=None if missing == "client" else CONFIG.client_id,
    )
    with TestClient(app, base_url=ORIGINE, follow_redirects=False) as client:
        client.headers.update(
            {"Origin": ORIGINE, "Cookie": f"__Host-sb_session={monde.session(ADMIN_GROUPE)}"}
        )
        status = client.get(ROOT)
        if missing == "identity":
            assert status.status_code == 409
        else:
            assert status.json()["configured"] is False
            assert client.post(ROOT + "/start", json={"host": HOST}).status_code == 503
        result = client.get(CALLBACK, params={"state": "absent", "code": "code-secret"})
        assert result.status_code == 400
        assert "code-secret" not in result.text


@pytest.mark.parametrize(
    "profile", [LECTEUR_GROUPE, CREATEUR_GROUPE, ADMIN_GROUPE, PLATEFORME_SEULE]
)
def test_autorisation_personnelle_du_membre_et_selection_admin_seulement(
    profile: Profil, client: TestClient, monde: Monde
) -> None:
    client.headers["Cookie"] = f"__Host-sb_session={monde.session(profile)}"
    connect(client, "executions")
    assert len(client.get(ROOT).json()["connections"]) == 1
    assert client.post(ROOT + "/warehouses", json={"host": HOST}).status_code == 200
    assert (
        client.post(ROOT + "/test", json={"host": HOST, "warehouse_id": "wh1"}).json()["identity"]
        == "person"
    )
    selected = client.post(
        ROOT + "/select", json={"host": HOST, "warehouse_id": "wh1", "key": "reader-source"}
    )
    assert selected.status_code == (201 if profile in (ADMIN_GROUPE, PLATEFORME_SEULE) else 403)
    assert client.request("DELETE", ROOT, json={"host": HOST}).status_code == 204
    assert client.get(ROOT).json()["connections"] == []
    client.headers["Cookie"] = f"__Host-sb_session={monde.session(NON_MEMBRE)}"
    assert client.get(ROOT).status_code == 404
    assert client.post(ROOT + "/start", json={"host": HOST}).status_code == 404


def test_destination_de_retour_fermee_et_corps_malforme(client: TestClient) -> None:
    for destination in (None, 3, "https://evil.invalid", "catalogue"):
        assert (
            client.post(ROOT + "/start", json={"host": HOST, "return_to": destination}).status_code
            == 400
        )
    assert client.post(ROOT + "/start", json=[]).status_code == 400
    state = client.post(ROOT + "/start", json={"host": HOST}).json()["authorization_url"]
    params = parse_qs(urlsplit(str(state)).query)
    result = client.get(CALLBACK, params={"state": params["state"][0], "code": "code-sentinel"})
    assert result.headers["location"].endswith("#/espaces/finance/connexions")
