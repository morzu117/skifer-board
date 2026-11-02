"""Plusieurs serveurs, une base : parcours de connexion et sessions partagés (plan 07, P5 à
P8, P10, sous-tâche 7.2 ; plan 06, I4, I5).

Chaque « serveur » est une application `create_app` distincte, avec son propre runtime et son
propre moteur, sur la même base migrée : comme deux processus derrière un répartiteur. Le
navigateur est simulé en recopiant ses cookies d'un client HTTP à l'autre. Le fournisseur
OIDC est celui, simulé, des tests d'identité.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import ExitStack
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from fastapi.testclient import TestClient
from httpx2 import Response
from identity.conftest import SECRET, Cles, Fournisseur, Horloge
from identity.conftest import claims as claims
from identity.conftest import cles as cles
from identity.conftest import config as config
from identity.conftest import fournisseur as fournisseur
from identity.conftest import horloge as horloge
from identity.test_flow import parametres
from postgres import Cluster
from skifer_board import server
from skifer_board.catalog import CatalogService
from skifer_board.identity import MemorySessionStore, OidcConfig
from skifer_board.identity.config import REQUIRED
from skifer_board.identity.sessions import fingerprint
from skifer_board.identity.web import IdentityRuntime, build_runtime
from skifer_board.server import create_app
from skifer_board.state import (
    DATABASE_URL,
    PgLoginRequests,
    PgSessionStore,
    connect,
    login_requests,
    sessions,
    upgrade,
)
from skifer_board.state import config_from_env as database_from_env
from sqlalchemy import Engine, MetaData, create_engine, func, select, text
from sqlalchemy.engine import URL

from .conftest import MOT_DE_PASSE, environnement, injoignable

ORIGINE = "https://board.example.invalid"
LOGIN = "__Host-sb_login"
SESSION = "__Host-sb_session"
ACCES = "jeton-acces-du-fournisseur"
RENOUVELLEMENT = "jeton-renouvellement-du-fournisseur"
CODE = "code-autorisation-confidentiel"
INTERNE = {"error": {"code": "internal_error"}}


@dataclass
class Serveur:
    runtime: IdentityRuntime
    client: TestClient


@dataclass(frozen=True)
class Ouverture:
    """Ce que le navigateur garde d'une connexion ouverte : `state`, `nonce` et son cookie."""

    state: str
    nonce: str
    lien: str


Demarrer = Callable[..., Serveur]


@pytest.fixture
def pile() -> Iterator[ExitStack]:
    with ExitStack() as ouverts:
        yield ouverts


def moteur_de_production(database_url: URL, pile: ExitStack) -> Engine:
    """Moteur tel que le serveur le crée : adresse avec mot de passe, schéma vérifié."""
    moteur = server.state_engine(environnement(database_url))
    assert moteur is not None
    pile.callback(moteur.dispose)
    return moteur


@pytest.fixture
def demarrer(
    pile: ExitStack,
    service: CatalogService,
    config: OidcConfig,
    fournisseur: Fournisseur,
    horloge: Horloge,
    database_url: URL,
    migre: Engine,
) -> Demarrer:
    def nouveau(en_base: bool = True, moteur: Engine | None = None) -> Serveur:
        if en_base:
            moteur = moteur_de_production(database_url, pile) if moteur is None else moteur
            runtime = build_runtime(
                config,
                fournisseur,
                horloge,
                PgSessionStore(moteur, config.session_absolute, config.session_idle),
                PgLoginRequests(moteur),
            )
        else:
            runtime = build_runtime(config, fournisseur, horloge)
        client = TestClient(
            create_app(service, runtime),
            base_url=ORIGINE,
            follow_redirects=False,
            raise_server_exceptions=False,
        )
        return Serveur(runtime, pile.enter_context(client))

    return nouveau


def ouvrir(serveur: Serveur) -> Ouverture:
    serveur.client.cookies.delete(LOGIN)
    debut = serveur.client.get("/auth/login")
    assert debut.status_code == 303
    params = parametres(debut.headers["location"])
    return Ouverture(params["state"], params["nonce"], serveur.client.cookies[LOGIN])


def terminer(
    serveur: Serveur,
    ouverture: Ouverture,
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
) -> Response:
    """Retour du fournisseur sur `serveur`, avec le cookie de connexion du navigateur."""
    fournisseur.reponse = {
        "id_token": cles.signer({**claims, "nonce": ouverture.nonce}),
        "access_token": ACCES,
        "refresh_token": RENOUVELLEMENT,
    }
    serveur.client.cookies.delete(LOGIN)
    serveur.client.cookies.set(LOGIN, ouverture.lien)
    return serveur.client.get("/auth/callback", params={"state": ouverture.state, "code": CODE})


def connecte(reponse: Response) -> None:
    assert reponse.status_code == 303
    assert reponse.headers["location"] == "/"


def refuse(reponse: Response, code: str = "invalid_state") -> None:
    assert reponse.status_code == 303
    assert reponse.headers["location"] == f"/?login_error={code}"
    assert SESSION not in reponse.headers.get("set-cookie", "")


def presenter(serveur: Serveur, jeton: str) -> Response:
    serveur.client.cookies.delete(SESSION)
    serveur.client.cookies.set(SESSION, jeton)
    return serveur.client.get("/api/me")


def compter(moteur: Engine, table: Any) -> int:
    with moteur.connect() as connexion:
        return int(connexion.execute(select(func.count()).select_from(table)).scalar_one())


def identite_attendue(claims: dict[str, Any]) -> dict[str, Any]:
    return {
        "issuer": claims["iss"],
        "subject": claims["sub"],
        "name": claims["name"],
        "email": claims["email"],
        "groups": claims["groups"],
    }


# --- C. Plusieurs serveurs, une base --------------------------------------------------------


def test_connexion_ouverte_sur_a_terminee_sur_b(
    demarrer: Demarrer,
    migre: Engine,
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
    horloge: Horloge,
) -> None:
    a, b = demarrer(), demarrer()
    ouverture = ouvrir(a)
    assert compter(migre, login_requests) == 1
    retour = terminer(b, ouverture, fournisseur, cles, claims)
    connecte(retour)
    jeton = b.client.cookies[SESSION]
    assert compter(migre, login_requests) == 0
    assert compter(migre, sessions) == 1
    me = presenter(a, jeton)
    assert me.status_code == 200
    corps = me.json()
    assert corps["established"] is True
    assert corps["identity"] == identite_attendue(claims)
    assert datetime.fromisoformat(corps["expires_at"]) == horloge() + timedelta(hours=8)


def test_session_partagee_et_deconnexion_croisee(
    demarrer: Demarrer, fournisseur: Fournisseur, cles: Cles, claims: dict[str, Any]
) -> None:
    a, b = demarrer(), demarrer()
    connecte(terminer(a, ouvrir(a), fournisseur, cles, claims))
    jeton = a.client.cookies[SESSION]
    assert presenter(b, jeton).status_code == 200
    assert b.client.get("/api/catalog").status_code == 200
    sortie = b.client.post("/auth/logout", headers={"Origin": ORIGINE})
    assert sortie.status_code == 200
    for serveur in (a, b):
        refus = presenter(serveur, jeton)
        assert refus.status_code == 401
        assert refus.json() == {"error": {"code": "unauthenticated", "login_url": "/auth/login"}}


def test_expiration_vue_par_tous_les_serveurs(
    demarrer: Demarrer,
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
    horloge: Horloge,
) -> None:
    a, b = demarrer(), demarrer()
    connecte(terminer(a, ouvrir(a), fournisseur, cles, claims))
    jeton = a.client.cookies[SESSION]
    # L'activité sur B repousse l'inactivité vue par A : un seul état, en base.
    horloge.instant += timedelta(minutes=20)
    assert presenter(b, jeton).status_code == 200
    horloge.instant += timedelta(minutes=20)
    assert presenter(a, jeton).status_code == 200
    horloge.instant += timedelta(minutes=30)
    assert presenter(b, jeton).status_code == 401
    horloge.instant -= timedelta(minutes=29)
    assert presenter(a, jeton).status_code == 401


def test_redemarrage_reconnait_la_session(
    demarrer: Demarrer, fournisseur: Fournisseur, cles: Cles, claims: dict[str, Any]
) -> None:
    a = demarrer()
    connecte(terminer(a, ouvrir(a), fournisseur, cles, claims))
    jeton = a.client.cookies[SESSION]
    ouverture = ouvrir(a)
    a.client.close()
    # Un serveur neuf, avec un nouveau moteur, sur la même base.
    neuf = demarrer()
    me = presenter(neuf, jeton)
    assert me.status_code == 200
    assert me.json()["identity"] == identite_attendue(claims)
    # Une connexion ouverte avant le redémarrage se termine après lui.
    neuf.client.cookies.delete(SESSION)
    connecte(terminer(neuf, ouverture, fournisseur, cles, claims))


@pytest.mark.parametrize("ordre", ["a-puis-b", "b-puis-a"])
def test_state_rejoue_sur_deux_serveurs(
    demarrer: Demarrer,
    migre: Engine,
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
    ordre: str,
) -> None:
    a, b = demarrer(), demarrer()
    ouverture = ouvrir(a)
    premier, second = (a, b) if ordre == "a-puis-b" else (b, a)
    connecte(terminer(premier, ouverture, fournisseur, cles, claims))
    refuse(terminer(second, ouverture, fournisseur, cles, claims))
    assert SESSION not in second.client.cookies
    assert compter(migre, sessions) == 1
    # Le second retour n'a pas même atteint le fournisseur : le code n'est échangé qu'une fois.
    assert len(fournisseur.formulaires) == 1


def test_en_memoire_une_connexion_ne_passe_pas_d_un_serveur_a_l_autre(
    demarrer: Demarrer, fournisseur: Fournisseur, cles: Cles, claims: dict[str, Any]
) -> None:
    """Raison d'être de 7.2 : sans base partagée, deux processus ne se comprennent pas."""
    a, b = demarrer(en_base=False), demarrer(en_base=False)
    ouverture = ouvrir(a)
    refuse(terminer(b, ouverture, fournisseur, cles, claims))
    assert fournisseur.formulaires == []
    # Terminée sur A, la session reste inconnue de B.
    connecte(terminer(a, ouverture, fournisseur, cles, claims))
    jeton = a.client.cookies[SESSION]
    assert presenter(a, jeton).status_code == 200
    assert presenter(b, jeton).status_code == 401


# --- B. Rien de secret en base après un parcours complet -----------------------------------


def toutes_les_valeurs(moteur: Engine) -> list[str]:
    """Toutes les valeurs de toutes les tables de la base, en texte."""
    tables = MetaData()
    tables.reflect(moteur)
    assert {"sessions", "login_requests", "alembic_version"} <= set(tables.tables)
    valeurs: list[str] = []
    with moteur.connect() as connexion:
        for table in tables.sorted_tables:
            for ligne in connexion.execute(select(table)):
                valeurs.extend(repr(valeur) for valeur in ligne)
    return valeurs


def test_aucun_secret_en_base_apres_parcours(
    demarrer: Demarrer,
    migre: Engine,
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
) -> None:
    a, b = demarrer(), demarrer()
    terminee = ouvrir(a)
    connecte(terminer(b, terminee, fournisseur, cles, claims))
    jeton = b.client.cookies[SESSION]
    id_token = str(fournisseur.reponse["id_token"]) if fournisseur.reponse else ""
    verificateur = fournisseur.formulaires[-1][1]["code_verifier"]
    assert presenter(a, jeton).status_code == 200
    # Une seconde connexion reste ouverte : sa demande est en base.
    en_cours = ouvrir(b)
    valeurs = toutes_les_valeurs(migre)
    assert valeurs
    texte = "\n".join(valeurs)
    secrets_ = {
        "secret client": SECRET,
        "id_token": id_token,
        "id_token (charge)": id_token.split(".")[1],
        "id_token (signature)": id_token.split(".")[2],
        "access_token": ACCES,
        "refresh_token": RENOUVELLEMENT,
        "code": CODE,
        "identifiant de session": jeton,
        "state terminé": terminee.state,
        "lien terminé": terminee.lien,
        "nonce terminé": terminee.nonce,
        "vérificateur PKCE consommé": verificateur,
        "state en cours": en_cours.state,
        "lien en cours": en_cours.lien,
        "mot de passe de la base": MOT_DE_PASSE,
    }
    for nom, secret in secrets_.items():
        assert secret and secret not in texte, nom
    # Ce qui est gardé, ce sont les empreintes.
    assert repr(fingerprint(jeton)) in valeurs
    assert repr(fingerprint(en_cours.state)) in valeurs
    assert repr(fingerprint(en_cours.lien)) in valeurs


# --- E. Assemblage par le serveur ----------------------------------------------------------


@pytest.fixture
def environnement_oidc(config: OidcConfig) -> dict[str, str]:
    valeurs = (
        config.issuer,
        config.client_id,
        config.client_secret,
        config.redirect_uri,
        config.public_origin,
    )
    return dict(zip(REQUIRED, valeurs, strict=True))


@pytest.fixture
def serveur_assemble(
    monkeypatch: pytest.MonkeyPatch, fournisseur: Fournisseur, horloge: Horloge
) -> None:
    """Le serveur assemble son runtime lui-même, avec le fournisseur simulé et l'horloge."""

    class DateFigee(datetime):
        @classmethod
        def now(cls, tz: object = None) -> DateFigee:
            assert tz == UTC
            return cls.fromtimestamp(horloge().timestamp(), UTC)

    monkeypatch.setattr(server, "datetime", DateFigee)
    monkeypatch.setattr(server, "UrllibHttp", lambda: fournisseur)


@pytest.mark.usefixtures("serveur_assemble")
def test_identity_runtime_range_sessions_et_demandes_en_base(
    environnement_oidc: dict[str, str],
    service: CatalogService,
    database_url: URL,
    migre: Engine,
    pile: ExitStack,
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
) -> None:
    serveurs: list[Serveur] = []
    for _ in range(2):
        runtime = server.identity_runtime(
            environnement_oidc, "board.example.invalid", moteur_de_production(database_url, pile)
        )
        assert runtime is not None
        assert isinstance(runtime.sessions, PgSessionStore)
        client = TestClient(create_app(service, runtime), base_url=ORIGINE, follow_redirects=False)
        serveurs.append(Serveur(runtime, pile.enter_context(client)))
    a, b = serveurs
    ouverture = ouvrir(a)
    # La demande ouverte par le serveur est en base, sous l'empreinte de son `state`.
    with migre.connect() as connexion:
        cles_ = list(connexion.execute(select(login_requests.c.state_fingerprint)).scalars())
    assert cles_ == [fingerprint(ouverture.state)]
    assert b.runtime.flow.pending_count() == 1
    connecte(terminer(b, ouverture, fournisseur, cles, claims))
    jeton = b.client.cookies[SESSION]
    with migre.connect() as connexion:
        empreintes = list(connexion.execute(select(sessions.c.fingerprint)).scalars())
    assert empreintes == [fingerprint(jeton)]
    assert presenter(a, jeton).status_code == 200


def test_build_runtime_sans_magasins_reste_en_memoire(
    config: OidcConfig, fournisseur: Fournisseur, horloge: Horloge
) -> None:
    premier = build_runtime(config, fournisseur, horloge)
    second = build_runtime(config, fournisseur, horloge)
    assert isinstance(premier.sessions, MemorySessionStore)
    assert premier.sessions is not second.sessions
    premier.flow.start()
    assert premier.flow.pending_count() == 1
    assert second.flow.pending_count() == 0


# --- P8 : instants rendus en UTC, quel que soit le fuseau de la base ------------------------


def test_me_rend_l_echeance_en_utc_quel_que_soit_le_fuseau_de_la_base(
    demarrer: Demarrer,
    database_url: URL,
    migre: Engine,
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
    horloge: Horloge,
) -> None:
    with migre.connect() as connexion:
        connexion.execute(
            text(f"ALTER DATABASE \"{database_url.database}\" SET timezone TO 'Pacific/Chatham'")
        )
        connexion.commit()
    a = demarrer()
    connecte(terminer(a, ouvrir(a), fournisseur, cles, claims))
    me = a.client.get("/api/me")
    assert me.status_code == 200
    assert me.json()["expires_at"] == (horloge() + timedelta(hours=8)).isoformat()


# --- F. Base perdue pendant l'usage : jamais de données servies -----------------------------


def jamais_servi(reponse: Response, cluster: Cluster, base: str) -> None:
    """Refus fermé : 500 sans détail ou 401, et aucune adresse ni mot de passe visible."""
    assert reponse.status_code in (500, 401), reponse.status_code
    if reponse.status_code == 500:
        assert reponse.json() == INTERNE
    else:
        assert reponse.json()["error"]["code"] == "unauthenticated"
    visible = reponse.text + str(reponse.headers)
    for secret in (MOT_DE_PASSE, str(cluster.root), "pg8000", "postgresql", base):
        assert secret not in visible, secret


def retour_ferme(reponse: Response, cluster: Cluster, base: str) -> None:
    """Retour du fournisseur sans base : aucune session n'est ouverte."""
    if reponse.status_code == 303:
        assert reponse.headers["location"].startswith("/?login_error=")
    else:
        assert reponse.status_code == 500
        assert reponse.json() == INTERNE
    assert SESSION not in reponse.headers.get("set-cookie", "")
    visible = reponse.text + str(reponse.headers)
    for secret in (MOT_DE_PASSE, str(cluster.root), "pg8000", "postgresql", base):
        assert secret not in visible, secret


def administrer(cluster: Cluster, instruction: str) -> None:
    admin = create_engine(cluster.url("postgres"), isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as connexion:
            connexion.execute(text(instruction))
    finally:
        admin.dispose()


def test_base_supprimee_pendant_l_usage(
    demarrer: Demarrer,
    postgres_cluster: Cluster,
    database_url: URL,
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
) -> None:
    base = str(database_url.database)
    a = demarrer()
    connecte(terminer(a, ouvrir(a), fournisseur, cles, claims))
    jeton = a.client.cookies[SESSION]
    assert a.client.get("/api/catalog").status_code == 200
    ouverture = ouvrir(a)
    a.client.cookies.delete(LOGIN)

    administrer(postgres_cluster, f'DROP DATABASE "{base}" WITH (FORCE)')
    try:
        for route in ("/api/me", "/api/catalog"):
            jamais_servi(presenter(a, jeton), postgres_cluster, base)
            jamais_servi(a.client.get(route), postgres_cluster, base)
        a.client.cookies.delete(SESSION)
        retour_ferme(terminer(a, ouverture, fournisseur, cles, claims), postgres_cluster, base)
        debut = a.client.get("/auth/login")
        assert debut.status_code in (303, 500)
        if debut.status_code == 303:
            assert debut.headers["location"].startswith("/?login_error=")
    finally:
        # Base recréée vide, pour la suite du test et pour la fixture qui la supprime.
        administrer(postgres_cluster, f'CREATE DATABASE "{base}"')

    # Base revenue sans tables : toujours aucune donnée servie.
    jamais_servi(presenter(a, jeton), postgres_cluster, base)
    a.client.cookies.delete(SESSION)
    retour_ferme(terminer(a, ouverture, fournisseur, cles, claims), postgres_cluster, base)

    # Base migrée à nouveau : la session perdue ne revient pas, une nouvelle connexion marche.
    neuve = create_engine(database_url)
    try:
        upgrade(neuve)
    finally:
        neuve.dispose()
    assert presenter(a, jeton).status_code == 401
    a.client.cookies.delete(SESSION)
    connecte(terminer(a, ouvrir(a), fournisseur, cles, claims))
    assert a.client.get("/api/me").status_code == 200


def test_base_injoignable_des_le_depart(
    demarrer: Demarrer, postgres_cluster: Cluster, fournisseur: Fournisseur, cles: Cles
) -> None:
    config_base = database_from_env({DATABASE_URL: injoignable()})
    assert config_base is not None
    moteur = connect(config_base)
    try:
        a = demarrer(moteur=moteur)
        jamais_servi(presenter(a, "jeton-quelconque"), postgres_cluster, "etat")
        a.client.cookies.delete(SESSION)
        ouverture = Ouverture("state-quelconque", "nonce", "lien")
        retour_ferme(
            terminer(a, ouverture, fournisseur, cles, {"sub": "x"}), postgres_cluster, "etat"
        )
        debut = a.client.get("/auth/login")
        assert debut.status_code == 500
        assert debut.json() == INTERNE
        assert MOT_DE_PASSE not in debut.text + str(debut.headers)
    finally:
        moteur.dispose()
