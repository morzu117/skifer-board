"""Monde de référence des routes d'espaces (plan 08, 8.2) : deux espaces, des profils de
chaque rôle, et un serveur réel sur une base migrée.

Les profils sont des personnes connues de Board (E5). Leurs sessions sont ouvertes dans le
magasin de sessions du serveur lui-même, celui que lit la garde : la requête porte le cookie
de session comme un navigateur. Les parcours de connexion complets, sur le fournisseur
simulé, sont exercés par les tests de contrats et de révocation.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterator, MutableMapping
from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx2 import Response
from identity.conftest import Horloge
from skifer_board.catalog import CatalogService
from skifer_board.identity import MemorySessionStore, OidcConfig
from skifer_board.identity.model import Identity
from skifer_board.identity.web import IdentityRuntime, build_runtime
from skifer_board.server import create_app
from skifer_board.spaces import GroupPrincipal, PersonRef, Role, Spaces, SpaceStore
from skifer_board.state import DatabaseConfig, connect
from skifer_board.state.schema import people, space_bindings, space_events, spaces
from sqlalchemy import Engine, Table, create_engine, func, select

ORIGINE = "https://board.example.invalid"
COOKIE = "__Host-sb_session"
EMETTEUR = "https://id.example.invalid"
ATLAS = "skifer-atlas"
PLATEFORME = "board-admins"

A = "finance"
B = "rh"


@dataclass(frozen=True)
class Profil:
    nom: str
    sujet: str
    groupes: tuple[str, ...] = ()

    @property
    def identite(self) -> Identity:
        return Identity(
            EMETTEUR,
            self.sujet,
            f"Nom {self.sujet}",
            f"{self.sujet}@example.invalid",
            self.groupes,
        )

    @property
    def ref(self) -> PersonRef:
        return PersonRef(EMETTEUR, self.sujet)


# Rôle obtenu dans A par un groupe, ou par une liaison de personne (E3).
LECTEUR_GROUPE = Profil("lecteur-groupe", "lea", ("finance-lecteurs",))
LECTEUR_PERSONNE = Profil("lecteur-personne", "luc")
CREATEUR_GROUPE = Profil("createur-groupe", "cora", ("finance-createurs",))
CREATEUR_PERSONNE = Profil("createur-personne", "cyril")
ADMIN_GROUPE = Profil("admin-groupe", "ada", ("finance-admins",))
ADMIN_PERSONNE = Profil("admin-personne", "axel")
# Groupes voisins de ceux de A, sans en être : casse, espace final, autre espace (E3).
NON_MEMBRE = Profil("non-membre", "nina", ("Finance-Admins", "finance-admins ", "autres"))
PLATEFORME_SEULE = Profil("plateforme", "pia", (PLATEFORME,))
PLATEFORME_LECTEUR = Profil("plateforme-lecteur", "paul", (PLATEFORME, "finance-lecteurs"))
# Administrateur de B seulement.
ADMIN_B = Profil("admin-b", "rachel", ("rh-admins",))
# Personne connue, liée nulle part : cible des liaisons de personne.
INVITEE = Profil("invitee", "ines", ("groupe-secret-de-l-invitee",))

PROFILS = (
    LECTEUR_GROUPE,
    LECTEUR_PERSONNE,
    CREATEUR_GROUPE,
    CREATEUR_PERSONNE,
    ADMIN_GROUPE,
    ADMIN_PERSONNE,
    NON_MEMBRE,
    PLATEFORME_SEULE,
    PLATEFORME_LECTEUR,
    ADMIN_B,
    INVITEE,
)
PAR_NOM = {profil.nom: profil for profil in PROFILS}


def compter(moteur: Engine, table: Table) -> int:
    with moteur.connect() as connexion:
        return int(connexion.execute(select(func.count()).select_from(table)).scalar_one())


def instantane(moteur: Engine) -> dict[str, list[tuple[Any, ...]]]:
    """Contenu complet des tables des espaces, pour constater qu'un refus n'a rien écrit.

    Lu par un moteur à part : une connexion du serveur laissée dans un état incohérent ne
    fausse pas le constat."""
    temoin = create_engine(moteur.url)
    contenu: dict[str, list[tuple[Any, ...]]] = {}
    try:
        with temoin.connect() as connexion:
            for table in (spaces, space_bindings, space_events, people):
                lignes = connexion.execute(select(table)).all()
                contenu[table.name] = sorted((tuple(ligne) for ligne in lignes), key=repr)
    finally:
        temoin.dispose()
    return contenu


@dataclass
class Monde:
    app: FastAPI
    client: TestClient
    moteur: Engine
    magasin: SpaceStore
    runtime: IdentityRuntime
    horloge: Horloge
    liaisons: dict[str, str] = field(default_factory=dict)
    jetons: dict[str, str] = field(default_factory=dict)

    def session(self, profil: Profil) -> str:
        """Jeton de session du profil, ouvert une fois dans le magasin du serveur."""
        if profil.nom not in self.jetons:
            self.jetons[profil.nom] = self.runtime.sessions.create(profil.identite, self.horloge())
        return self.jetons[profil.nom]

    def requete(
        self,
        profil: Profil | None,
        methode: str,
        chemin: str,
        *,
        corps: object = None,
        contenu: bytes | None = None,
        origine: str | None = ORIGINE,
        params: dict[str, str] | None = None,
    ) -> Response:
        entetes: dict[str, str] = {}
        if profil is not None:
            entetes["Cookie"] = f"{COOKIE}={self.session(profil)}"
        if origine is not None:
            entetes["Origin"] = origine
        if corps is not None:
            return self.client.request(methode, chemin, json=corps, headers=entetes, params=params)
        return self.client.request(methode, chemin, content=contenu, headers=entetes, params=params)

    def liaison_ids(self, espace: str) -> set[str]:
        return {liaison.id for liaison in self.magasin.bindings(espace)}


def peupler(magasin: SpaceStore, horloge: Horloge) -> dict[str, str]:
    """Personnes connues, espaces A et B et leurs liaisons ; rend les identifiants utiles."""
    for profil in PROFILS:
        magasin.record_login(profil.identite, horloge())
    auteur = PLATEFORME_SEULE.ref
    instant = horloge()
    magasin.create_space(A, "Finance", ATLAS, GroupPrincipal("finance-admins"), auteur, instant)
    magasin.create_space(
        B, "Ressources humaines", ATLAS, GroupPrincipal("rh-admins"), auteur, instant
    )
    ids: dict[str, str] = {}
    for nom, principal, role in (
        ("a-lecteurs", GroupPrincipal("finance-lecteurs"), Role.READER),
        ("a-createurs", GroupPrincipal("finance-createurs"), Role.CREATOR),
        ("a-stagiaires", GroupPrincipal("finance-stagiaires"), Role.READER),
        ("a-luc", LECTEUR_PERSONNE.ref, Role.READER),
        ("a-cyril", CREATEUR_PERSONNE.ref, Role.CREATOR),
        ("a-axel", ADMIN_PERSONNE.ref, Role.ADMIN),
    ):
        ids[nom] = magasin.set_binding(A, principal, role, auteur, instant).id
    for nom, principal, role in (
        ("b-lecteurs", GroupPrincipal("rh-lecteurs"), Role.READER),
        ("b-invitee", INVITEE.ref, Role.READER),
    ):
        ids[nom] = magasin.set_binding(B, principal, role, auteur, instant).id
    for liaison in magasin.bindings(A):
        if liaison.principal == GroupPrincipal("finance-admins"):
            ids["a-admins"] = liaison.id
    for liaison in magasin.bindings(B):
        if liaison.principal == GroupPrincipal("rh-admins"):
            ids["b-admins"] = liaison.id
    return ids


def espaces_en_base(
    moteur: Engine, horloge: Callable[[], datetime], groupe_admin: str | None = PLATEFORME
) -> Spaces:
    return Spaces.database(SpaceStore(moteur), ATLAS, groupe_admin, horloge)


def ouvrir_aux_lecteurs(
    moteur: Engine, instant: datetime, groupe: str = "lecteurs", espace: str = A
) -> str:
    """Espace où les membres de `groupe` sont lecteurs : rend l'adresse de son catalogue."""
    magasin = SpaceStore(moteur)
    auteur = PersonRef(EMETTEUR, "admin-plateforme")
    magasin.create_space(espace, "Finance", ATLAS, GroupPrincipal("admins"), auteur, instant)
    magasin.set_binding(espace, GroupPrincipal(groupe), Role.READER, auteur, instant)
    return f"/api/spaces/{espace}/catalog"


@pytest.fixture
def config_plateforme(config: OidcConfig) -> OidcConfig:
    return replace(config, admin_group=PLATEFORME)


@pytest.fixture
def monde(
    service: CatalogService,
    config_plateforme: OidcConfig,
    fournisseur: Any,
    horloge: Horloge,
    migre: Engine,
) -> Iterator[Monde]:
    # Moteur tel que le serveur l'ouvre (`connect`), avec ses défenses, sur la base migrée.
    moteur = connect(DatabaseConfig(migre.url))
    magasin = SpaceStore(moteur)
    runtime = build_runtime(
        config_plateforme,
        fournisseur,
        horloge,
        MemorySessionStore(config_plateforme.session_absolute, config_plateforme.session_idle),
        on_login=magasin.record_login,
    )
    app = create_app(service, runtime, espaces_en_base(moteur, horloge))
    try:
        with TestClient(
            app, base_url=ORIGINE, follow_redirects=False, raise_server_exceptions=False
        ) as client:
            resultat = Monde(app, client, moteur, magasin, runtime, horloge)
            resultat.liaisons.update(peupler(magasin, horloge))
            yield resultat
    finally:
        moteur.dispose()


def appel_brut(
    app: FastAPI, methode: str, chemin: str, entetes: dict[str, str]
) -> tuple[int, dict[str, str], bytes]:
    """Requête ASGI au chemin exact, sans la normalisation des segments `..` du client HTTP."""
    messages: list[dict[str, Any]] = []

    async def recevoir() -> dict[str, Any]:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def envoyer(message: MutableMapping[str, Any]) -> None:
        messages.append(dict(message))

    portee = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": methode,
        "scheme": "https",
        "server": ("board.example.invalid", 443),
        "client": ("127.0.0.1", 50000),
        "root_path": "",
        "path": chemin,
        "raw_path": chemin.encode(),
        "query_string": b"",
        "headers": [(cle.lower().encode(), valeur.encode()) for cle, valeur in entetes.items()],
    }
    asyncio.run(app(portee, recevoir, envoyer))
    debut = next(message for message in messages if message["type"] == "http.response.start")
    corps = b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body")
    entetes_rendus = {cle.decode(): valeur.decode() for cle, valeur in debut["headers"]}
    return debut["status"], entetes_rendus, corps
