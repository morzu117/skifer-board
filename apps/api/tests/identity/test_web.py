"""Parcours HTTP réel, cookies et garde de chaque route du serveur (I5 à I8)."""

from collections.abc import Iterator
from dataclasses import replace
from datetime import timedelta
from http.cookies import SimpleCookie
from typing import Any
from urllib.parse import urlsplit

import pytest
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from httpx2 import Response
from skifer_board.catalog import CatalogService
from skifer_board.identity import OidcConfig
from skifer_board.identity.web import IdentityRuntime, build_runtime
from skifer_board.server import create_app
from spaces.monde import espaces_en_base, ouvrir_aux_lecteurs
from sqlalchemy import Engine
from state.conftest import migre as migre

from identity.conftest import SECRET, Cles, Fournisseur, Horloge
from identity.test_flow import parametres

ORIGINE = "https://board.example.invalid"


@pytest.fixture
def runtime(config: OidcConfig, fournisseur: Fournisseur, horloge: Horloge) -> IdentityRuntime:
    return build_runtime(config, fournisseur, horloge)


@pytest.fixture
def client(
    service: CatalogService, runtime: IdentityRuntime, migre: Engine, horloge: Horloge
) -> Iterator[TestClient]:
    # Avec OIDC, les espaces en base sont obligatoires (plan 08, 8.2).
    app = create_app(service, runtime, espaces_en_base(migre, horloge, None))
    with TestClient(app, base_url=ORIGINE, follow_redirects=False) as connexion:
        yield connexion


def verifier_cookie(reponse: Response, nom: str, age: int) -> str:
    cookies: SimpleCookie = SimpleCookie()
    for entete in reponse.headers.get_list("set-cookie"):
        cookies.load(entete)
    cookie = cookies[nom]
    assert cookie["secure"] is True
    assert cookie["httponly"] is True
    assert cookie["samesite"] == "lax"
    assert cookie["path"] == "/"
    assert cookie["max-age"] == str(age)
    assert cookie["domain"] == ""
    if age == 0:
        assert cookie.value == ""
    return cookie.value


def connecter(
    client: TestClient,
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
    chemin: str = "/auth/callback",
) -> tuple[Response, str]:
    debut = client.get("/auth/login")
    assert debut.status_code == 303
    verifier_cookie(debut, "__Host-sb_login", 600)
    params = parametres(debut.headers["location"])
    jeton = cles.signer({**claims, "nonce": params["nonce"]})
    fournisseur.reponse = {
        "id_token": jeton,
        "access_token": "acces-secret",
        "refresh_token": "renouvellement-secret",
    }
    retour = client.get(chemin, params={"state": params["state"], "code": "code-secret"})
    assert retour.status_code == 303
    assert retour.headers["location"] == "/"
    verifier_cookie(retour, "__Host-sb_login", 0)
    verifier_cookie(retour, "__Host-sb_session", 28800)
    return retour, jeton


def test_parcours_complet_et_absence_de_secrets(
    client: TestClient,
    runtime: IdentityRuntime,
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
    migre: Engine,
) -> None:
    # Le catalogue se lit dans un espace où le groupe `lecteurs` des claims est lecteur.
    catalogue = ouvrir_aux_lecteurs(migre, runtime.clock())
    retour, jeton = connecter(client, fournisseur, cles, claims)
    cookie = client.cookies["__Host-sb_session"]
    session = runtime.sessions.get(cookie, runtime.clock())
    assert session is not None
    me = client.get("/api/me")
    assert me.status_code == 200
    assert me.json() == {
        "established": True,
        "identity": {
            "issuer": claims["iss"],
            "subject": claims["sub"],
            "name": claims["name"],
            "email": claims["email"],
            "groups": claims["groups"],
        },
        "expires_at": (runtime.clock() + timedelta(hours=8)).isoformat(),
        "platform_admin": False,
    }
    assert client.get(catalogue).status_code == 200
    sortie = client.post("/auth/logout", headers={"Origin": ORIGINE})
    assert sortie.status_code == 200
    assert sortie.json() == {"redirect": "/"}
    verifier_cookie(sortie, "__Host-sb_session", 0)
    assert runtime.sessions.get(cookie, runtime.clock()) is None
    client.cookies.set("__Host-sb_session", cookie)
    refuse = client.get("/api/me")
    assert refuse.status_code == 401
    for reponse in (retour, me, sortie, refuse):
        visible = reponse.text + str(reponse.headers) + repr(session) + str(client.cookies)
        for secret in (jeton, "acces-secret", "renouvellement-secret", SECRET, "code-secret"):
            assert secret not in visible
    assert set(vars(session)) == {"identity", "created_at", "last_seen", "expires_at"}
    assert set(vars(session.identity)) == {"issuer", "subject", "name", "email", "groups"}


@pytest.mark.parametrize("expiration", [None, "inactivite", "absolue"])
def test_toutes_les_routes_api_exigent_une_session(
    service: CatalogService,
    runtime: IdentityRuntime,
    fournisseur: Fournisseur,
    horloge: Horloge,
    cles: Cles,
    claims: dict[str, Any],
    expiration: str | None,
    migre: Engine,
) -> None:
    app = create_app(service, runtime, espaces_en_base(migre, horloge, runtime.config.admin_group))
    routes = [
        route
        for route in app.routes
        if isinstance(route, APIRoute) and route.path.startswith("/api/")
    ]
    assert routes
    # Toutes les routes des espaces (plan 08, 8.2), des accords de déploiement (plan 09,
    # 9.2), des paramètres de déploiement (plan 10, 10.2) et la lecture de la télémétrie
    # (plan 11, 11.3) sont sous la garde.
    assert {(methode, route.path) for route in routes for methode in route.methods or ()} == {
        ("GET", "/api/me"),
        ("GET", "/api/spaces"),
        ("POST", "/api/spaces"),
        ("GET", "/api/spaces/{space_id}"),
        ("GET", "/api/spaces/{space_id}/members"),
        ("POST", "/api/spaces/{space_id}/members"),
        ("DELETE", "/api/spaces/{space_id}/members/{binding_id}"),
        ("GET", "/api/spaces/{space_id}/events"),
        ("GET", "/api/spaces/{space_id}/deploy-grants"),
        ("POST", "/api/spaces/{space_id}/deploy-grants"),
        ("DELETE", "/api/spaces/{space_id}/deploy-grants/{grant_id}"),
        ("GET", "/api/spaces/{space_id}/parameters"),
        ("POST", "/api/spaces/{space_id}/parameters"),
        ("PUT", "/api/spaces/{space_id}/parameters/{name}"),
        ("DELETE", "/api/spaces/{space_id}/parameters/{name}"),
        ("PUT", "/api/spaces/{space_id}/parameters/{name}/values/{environment}"),
        ("DELETE", "/api/spaces/{space_id}/parameters/{name}/values/{environment}"),
        ("GET", "/api/spaces/{space_id}/connection-endpoints"),
        ("POST", "/api/spaces/{space_id}/connection-endpoints"),
        ("DELETE", "/api/spaces/{space_id}/connection-endpoints/{key}"),
        ("GET", "/api/spaces/{space_id}/connections"),
        ("POST", "/api/spaces/{space_id}/connections"),
        ("PUT", "/api/spaces/{space_id}/connections/{name}/bindings/{environment}"),
        ("POST", "/api/spaces/{space_id}/connections/{name}/bindings/{environment}/test"),
        ("PUT", "/api/spaces/{space_id}/connections/{name}/bindings/{environment}/credential"),
        ("DELETE", "/api/spaces/{space_id}/connections/{name}/bindings/{environment}/credential"),
        ("DELETE", "/api/spaces/{space_id}/connections/{name}/bindings/{environment}"),
        ("DELETE", "/api/spaces/{space_id}/connections/{name}"),
        ("POST", "/api/spaces/{space_id}/executions"),
        ("GET", "/api/spaces/{space_id}/executions"),
        ("GET", "/api/spaces/{space_id}/executions/{execution_id}"),
        ("GET", "/api/spaces/{space_id}/executions/{execution_id}/result"),
        ("POST", "/api/spaces/{space_id}/executions/{execution_id}/cancel"),
        ("GET", "/api/people"),
        ("GET", "/api/telemetry"),
        ("GET", "/api/spaces/{space_id}/catalog"),
        ("GET", "/api/spaces/{space_id}/catalog/{document_id}"),
        ("GET", "/api/spaces/{space_id}/catalog/{document_id}/versions"),
        ("GET", "/api/spaces/{space_id}/catalog/{document_id}/diff"),
    }
    with TestClient(app, base_url=ORIGINE, follow_redirects=False) as client:
        if expiration is not None:
            connecter(client, fournisseur, cles, claims)
            if expiration == "absolue":
                for _ in range(47):
                    horloge.instant += timedelta(minutes=10)
                    assert client.get("/api/me").status_code == 200
                horloge.instant += timedelta(minutes=10)
            else:
                horloge.instant += timedelta(minutes=30)
        for route in routes:
            assert route.methods is not None
            for methode in route.methods:
                chemin = (
                    route.path.replace("{document_id}", "revenu-net")
                    .replace("{space_id}", "finance")
                    .replace("{binding_id}", "liaison")
                    .replace("{grant_id}", "5b0e4c1e-0000-4000-8000-000000000000")
                    .replace("{name}", "catalogue")
                    .replace("{environment}", "PROD")
                    .replace("{execution_id}", "11111111-1111-1111-1111-111111111111")
                )
                reponse = client.request(methode, chemin, headers={"Origin": ORIGINE})
                assert reponse.status_code == 401
                assert reponse.json() == {
                    "error": {"code": "unauthenticated", "login_url": "/auth/login"}
                }


@pytest.mark.parametrize("origine", [None, "https://autre.example.invalid", ORIGINE])
def test_deconnexion_controle_origine(
    client: TestClient,
    runtime: IdentityRuntime,
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
    origine: str | None,
) -> None:
    connecter(client, fournisseur, cles, claims)
    cookie = client.cookies["__Host-sb_session"]
    reponse = client.post("/auth/logout", headers={} if origine is None else {"Origin": origine})
    if origine == ORIGINE:
        assert reponse.status_code == 200
        assert runtime.sessions.get(cookie, runtime.clock()) is None
        assert client.post("/auth/logout", headers={"Origin": ORIGINE}).status_code == 200
    else:
        assert reponse.status_code == 403
        assert reponse.json() == {"error": {"code": "origin_refused"}}
        assert runtime.sessions.get(cookie, runtime.clock()) is not None


@pytest.mark.parametrize(
    "cas,code",
    [
        ("state", "invalid_state"),
        ("annule", "login_cancelled"),
        ("code", "code_rejected"),
        ("jeton", "token_refused"),
        ("fournisseur", "provider_unavailable"),
    ],
)
def test_redirection_echec_et_cookie_efface(
    client: TestClient, fournisseur: Fournisseur, cas: str, code: str
) -> None:
    debut = client.get("/auth/login")
    params = {"state": parametres(debut.headers["location"])["state"]}
    fournisseur.reponse = {"id_token": "jeton-malforme-secret"}
    if cas == "state":
        params["state"] = "inconnu"
    elif cas == "annule":
        params["error"] = "detail-fournisseur-secret"
    elif cas in ("jeton", "fournisseur"):
        params["code"] = "code-secret"
        if cas == "fournisseur":
            from skifer_board.identity import ProviderError

            fournisseur.erreur_echange = ProviderError("detail-secret")
    retour = client.get("/auth/callback", params=params)
    assert retour.status_code == 303
    assert retour.headers["location"] == f"/?login_error={code}"
    verifier_cookie(retour, "__Host-sb_login", 0)
    assert "__Host-sb_session" not in client.cookies
    for secret in (SECRET, "code-secret", "detail-secret", "jeton-malforme-secret"):
        assert secret not in retour.text + str(retour.headers)


def test_decouverte_indisponible(client: TestClient, fournisseur: Fournisseur) -> None:
    fournisseur.document["issuer"] = "https://mauvais.example.invalid"
    retour = client.get("/auth/login")
    assert retour.status_code == 303
    assert retour.headers["location"] == "/?login_error=provider_unavailable"
    verifier_cookie(retour, "__Host-sb_login", 0)


def test_chemin_de_retour_configurable(
    service: CatalogService,
    config: OidcConfig,
    fournisseur: Fournisseur,
    horloge: Horloge,
    cles: Cles,
    claims: dict[str, Any],
    migre: Engine,
) -> None:
    config = replace(config, redirect_uri=f"{ORIGINE}/connexion/retour")
    with TestClient(
        create_app(
            service,
            build_runtime(config, fournisseur, horloge),
            espaces_en_base(migre, horloge, None),
        ),
        base_url=ORIGINE,
        follow_redirects=False,
    ) as client:
        connecter(client, fournisseur, cles, claims, urlsplit(config.redirect_uri).path)
        assert client.get("/auth/callback").status_code == 404


@pytest.mark.parametrize(
    "origine,statut",
    [
        (None, 403),
        ("null", 403),
        ("https://autre.example.invalid", 403),
        ("http://localhost:5173", 405),
        ("http://127.0.0.1:5173", 405),
        ("http://[::1]:5173", 405),
    ],
)
def test_mode_local(service: CatalogService, origine: str | None, statut: int) -> None:
    with TestClient(create_app(service), base_url=ORIGINE, follow_redirects=False) as client:
        assert client.get("/api/me").json() == {"established": False}
        assert client.get("/api/spaces/local/catalog").status_code == 200
        reponse = client.post(
            "/api/spaces/local/catalog", headers={} if origine is None else {"Origin": origine}
        )
        assert reponse.status_code == statut
        assert reponse.json() == {
            "error": {"code": "origin_refused" if statut == 403 else "method_not_allowed"}
        }


def test_lecture_interne_sans_identite_en_mode_local(service: CatalogService) -> None:
    """Le lecteur local renvoie None, même si une future route l'appelle directement.

    La garde court-circuite ce lecteur en mode local : on accède à sa fermeture
    pour vérifier ce retour défensif sans modifier le code de production.
    """
    from collections.abc import Callable
    from inspect import getclosurevars
    from typing import cast

    from fastapi import Request
    from skifer_board.identity.sessions import Session

    app = create_app(service)
    # La garde se reconnaît à sa clé `dispatch` : la télémétrie l'enveloppe (plan 11).
    garde = next(m.kwargs["dispatch"] for m in app.user_middleware if "dispatch" in m.kwargs)
    assert callable(garde)
    lecteur = cast(Callable[[Request], Session | None], getclosurevars(garde).nonlocals["current"])
    requete = Request({"type": "http", "headers": []})
    assert lecteur(requete) is None


def test_origine_malformee_refusee(service: CatalogService) -> None:
    with TestClient(
        create_app(service), base_url=ORIGINE, follow_redirects=False, raise_server_exceptions=False
    ) as client:
        reponse = client.post("/api/spaces/local/catalog", headers={"Origin": "http://[::1"})
        assert reponse.status_code == 403
        assert reponse.json() == {"error": {"code": "origin_refused"}}
