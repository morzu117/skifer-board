"""Base migrée, magasin des espaces et personnes de référence (plan 08, 8.1).

Les personnes de référence portent des groupes : ils servent au calcul du rôle, jamais à
l'enregistrement d'une personne (E5).
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timedelta

import pytest
from identity.conftest import INSTANT
from skifer_board.identity.model import Identity
from skifer_board.spaces import Binding, GroupPrincipal, PersonRef, Principal, Role, SpaceStore
from skifer_board.state.schema import space_bindings, space_events, spaces
from sqlalchemy import Engine, Table, create_engine, func, select, text
from sqlalchemy.engine import URL
from state.conftest import migre as migre

EMETTEUR = "https://id.example.invalid"
AUTRE_EMETTEUR = "https://autre.example.invalid"
ATLAS = "/srv/atlas"

ALICE = Identity(EMETTEUR, "alice", "Alice Martin", "alice@example.invalid", ("equipe-a",))
BOB = Identity(EMETTEUR, "bob", "Bob Durand", "bob@example.invalid", ("lecteurs",))
CHLOE = Identity(EMETTEUR, "chloe", "Chloé Petit", "chloe@example.invalid", ())
# Même sujet qu'Alice, chez un autre émetteur : une autre personne (E3).
ALICE_AILLEURS = Identity(AUTRE_EMETTEUR, "alice", "Alice Martin", "alice@example.invalid", ())
ACTEUR = PersonRef(EMETTEUR, "admin-plateforme")


def ref(identite: Identity) -> PersonRef:
    return PersonRef(identite.issuer, identite.subject)


def plus(minutes: int) -> datetime:
    return INSTANT + timedelta(minutes=minutes)


def liaison(principal: Principal, role: Role, espace: str = "esp") -> Binding:
    """Liaison en mémoire, pour le calcul pur du rôle effectif."""
    return Binding(f"id-{principal}-{role}", espace, principal, role, INSTANT, ACTEUR)


def groupe(nom: str) -> GroupPrincipal:
    return GroupPrincipal(nom)


def compter(moteur: Engine, table: Table) -> int:
    with moteur.connect() as connexion:
        return int(connexion.execute(select(func.count()).select_from(table)).scalar_one())


def traces(moteur: Engine) -> tuple[int, int, int]:
    """Espaces, liaisons et événements présents en base."""
    return compter(moteur, spaces), compter(moteur, space_bindings), compter(moteur, space_events)


@pytest.fixture
def magasin(migre: Engine) -> SpaceStore:
    return SpaceStore(migre)


@pytest.fixture
def moteur_hors_utc(database_url: URL, migre: Engine) -> Iterator[Engine]:
    """Base dont le fuseau par défaut n'est pas UTC : les instants relus doivent l'être."""
    with migre.connect() as connexion:
        connexion.execute(
            text(f"ALTER DATABASE \"{database_url.database}\" SET timezone TO 'Pacific/Chatham'")
        )
        connexion.commit()
    moteur = create_engine(database_url)
    try:
        with moteur.connect() as connexion:
            assert connexion.execute(text("SHOW timezone")).scalar_one() == "Pacific/Chatham"
        yield moteur
    finally:
        moteur.dispose()
