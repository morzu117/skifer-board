"""Enregistrement des personnes à la connexion (plan 08, E5) et groupe d'administration de la
plateforme lu de la configuration (E6), sur le fournisseur OIDC simulé."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from fastapi.testclient import TestClient
from identity.conftest import Cles, Fournisseur, Horloge
from identity.conftest import claims as claims
from identity.conftest import cles as cles
from identity.conftest import config as config
from identity.conftest import fournisseur as fournisseur
from identity.conftest import horloge as horloge
from identity.test_flow import parametres
from identity.test_web import ORIGINE, connecter
from skifer_board import server
from skifer_board.catalog import CatalogService
from skifer_board.identity import MemorySessionStore, OidcConfig
from skifer_board.identity.config import ADMIN_GROUP, REQUIRED
from skifer_board.identity.model import Identity
from skifer_board.identity.web import IdentityRuntime, build_runtime
from skifer_board.server import create_app
from skifer_board.spaces import Person, PersonRef, SpaceStore, is_platform_admin
from skifer_board.state.schema import people
from sqlalchemy import Engine, select

from .conftest import compter


def client_de(service: CatalogService, runtime: IdentityRuntime) -> TestClient:
    return TestClient(
        create_app(service, runtime),
        base_url=ORIGINE,
        follow_redirects=False,
        raise_server_exceptions=False,
    )


@pytest.fixture
def runtime(
    config: OidcConfig, fournisseur: Fournisseur, horloge: Horloge, migre: Engine
) -> IdentityRuntime:
    return build_runtime(
        config,
        fournisseur,
        horloge,
        MemorySessionStore(config.session_absolute, config.session_idle),
        on_login=SpaceStore(migre).record_login,
    )


@pytest.fixture
def client(service: CatalogService, runtime: IdentityRuntime) -> Iterator[TestClient]:
    with client_de(service, runtime) as connexion:
        yield connexion


def personne_attendue(claims: dict[str, Any], instant: datetime) -> Person:
    return Person(claims["iss"], claims["sub"], claims["name"], claims["email"], instant)


def test_connexion_enregistre_la_personne(
    client: TestClient,
    migre: Engine,
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
    horloge: Horloge,
) -> None:
    magasin = SpaceStore(migre)
    ref = PersonRef(claims["iss"], claims["sub"])
    assert magasin.get_person(ref) is None
    connecter(client, fournisseur, cles, claims)
    assert magasin.get_person(ref) == personne_attendue(claims, horloge())
    # Groupes lus pour la session, jamais gardés avec la personne.
    with migre.connect() as connexion:
        [ligne] = connexion.execute(select(people)).all()
    for groupe in claims["groups"]:
        assert all(groupe not in str(valeur) for valeur in ligne)
    # Reconnexion plus tard, sous un autre nom : la personne est mise à jour, pas doublée.
    horloge.instant += timedelta(hours=1)
    client.cookies.clear()
    maintenant = horloge().timestamp()
    autres = {
        **claims,
        "name": "Nom changé",
        "email": "nouvelle@example.invalid",
        "iat": maintenant - 60,
        "exp": maintenant + 60,
    }
    connecter(client, fournisseur, cles, autres)
    assert magasin.get_person(ref) == personne_attendue(autres, horloge())
    assert compter(migre, people) == 1


def test_refus_de_connexion_n_enregistre_personne(
    client: TestClient,
    migre: Engine,
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
) -> None:
    for cas in ("audience", "state"):
        client.cookies.clear()
        debut = client.get("/auth/login")
        params = parametres(debut.headers["location"])
        jeton = {**claims, "nonce": params["nonce"]}
        if cas == "audience":
            jeton["aud"] = "autre-client"
        fournisseur.reponse = {"id_token": cles.signer(jeton)}
        state = params["state"] if cas == "audience" else "inconnu"
        retour = client.get("/auth/callback", params={"state": state, "code": "code"})
        assert retour.status_code == 303
        assert retour.headers["location"].startswith("/?login_error=")
        assert "__Host-sb_session" not in client.cookies
    assert compter(migre, people) == 0


def test_echec_de_l_enregistrement_aucune_session(
    service: CatalogService,
    config: OidcConfig,
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
    horloge: Horloge,
) -> None:
    sessions = MemorySessionStore(config.session_absolute, config.session_idle)
    appels: list[tuple[Identity, datetime]] = []

    def en_panne(identite: Identity, instant: datetime) -> None:
        appels.append((identite, instant))
        raise RuntimeError("base perdue")

    runtime = build_runtime(config, fournisseur, horloge, sessions, on_login=en_panne)
    with client_de(service, runtime) as client:
        debut = client.get("/auth/login")
        params = parametres(debut.headers["location"])
        fournisseur.reponse = {"id_token": cles.signer({**claims, "nonce": params["nonce"]})}
        retour = client.get("/auth/callback", params={"state": params["state"], "code": "c"})
        # Fail-closed : pas de session si la personne n'a pas pu être enregistrée.
        assert retour.status_code == 500
        assert retour.json() == {"error": {"code": "internal_error"}}
        assert "__Host-sb_session" not in client.cookies
        assert "base perdue" not in retour.text
    assert sessions.fingerprints() == frozenset()
    assert [(i.subject, t) for i, t in appels] == [(claims["sub"], horloge())]


def test_enregistrement_au_meme_instant_que_la_session(
    service: CatalogService,
    config: OidcConfig,
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
    horloge: Horloge,
) -> None:
    appels: list[tuple[Identity, datetime]] = []
    runtime = build_runtime(
        config, fournisseur, horloge, on_login=lambda i, t: appels.append((i, t))
    )
    with client_de(service, runtime) as client:
        connecter(client, fournisseur, cles, claims)
        session = runtime.sessions.get(client.cookies["__Host-sb_session"], horloge())
    assert session is not None
    [(identite, instant)] = appels
    assert identite == session.identity
    assert instant == session.created_at == horloge()


# --- Serveur assemblé par `identity_runtime` -------------------------------------------------


@pytest.fixture
def environnement(config: OidcConfig) -> dict[str, str]:
    return dict(
        zip(
            REQUIRED,
            (
                config.issuer,
                config.client_id,
                config.client_secret,
                config.redirect_uri,
                config.public_origin,
            ),
            strict=True,
        )
    )


@pytest.fixture
def serveur_reel(
    monkeypatch: pytest.MonkeyPatch, fournisseur: Fournisseur, horloge: Horloge
) -> None:
    """Le serveur tel que `main` l'assemble, avec le fournisseur simulé et l'horloge du test."""

    class DateFigee(datetime):
        @classmethod
        def now(cls, tz: object = None) -> DateFigee:
            assert tz == UTC
            return cls.fromtimestamp(horloge().timestamp(), UTC)

    monkeypatch.setattr(server, "datetime", DateFigee)
    monkeypatch.setattr(server, "UrllibHttp", lambda: fournisseur)


@pytest.mark.usefixtures("serveur_reel")
def test_identity_runtime_enregistre_la_personne_en_base(
    service: CatalogService,
    environnement: dict[str, str],
    migre: Engine,
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
    horloge: Horloge,
) -> None:
    runtime = server.identity_runtime(environnement, "board.example.invalid", migre)
    assert runtime is not None
    assert runtime.config.admin_group is None
    with client_de(service, runtime) as client:
        connecter(client, fournisseur, cles, claims)
        assert client.get("/api/me").status_code == 200
    personne = SpaceStore(migre).get_person(PersonRef(claims["iss"], claims["sub"]))
    assert personne == personne_attendue(claims, horloge())
    assert personne is not None and personne.last_login.utcoffset() == timedelta(0)


@pytest.mark.parametrize("valeur,attendu", [(None, None), ("", None), ("plateforme", "plateforme")])
def test_identity_runtime_lit_le_groupe_d_administration(
    environnement: dict[str, str], migre: Engine, valeur: str | None, attendu: str | None
) -> None:
    if valeur is not None:
        environnement[ADMIN_GROUP] = valeur
    runtime = server.identity_runtime(environnement, "board.example.invalid", migre)
    assert runtime is not None
    assert runtime.config.admin_group == attendu
    membre = Identity(environnement[REQUIRED[0]], "s", None, None, ("plateforme", ""))
    assert is_platform_admin(membre, runtime.config.admin_group) is (attendu is not None)
