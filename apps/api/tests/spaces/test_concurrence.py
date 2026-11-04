"""Écritures concurrentes sur les espaces, comme depuis plusieurs processus (plan 08, E8 ;
plan 07, P6).

Chaque fil a son propre moteur, donc sa propre connexion. Les fils partent ensemble derrière
une barrière : la règle du dernier administrateur et l'unicité d'un identifiant d'espace
doivent tenir sans dépendre de l'ordre d'arrivée.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from functools import partial

import pytest
from identity.conftest import INSTANT
from skifer_board.spaces import (
    GroupPrincipal,
    LastAdmin,
    Role,
    Space,
    SpaceError,
    SpaceExists,
    SpaceStore,
)
from skifer_board.state.schema import space_events
from sqlalchemy import Engine, create_engine, select
from sqlalchemy.engine import URL

from .conftest import ACTEUR, ATLAS, groupe, plus, traces

ESPACES = 8
FILS = 2 * ESPACES
TOURS = 6


@pytest.fixture
def magasins(database_url: URL, migre: Engine) -> Iterator[list[SpaceStore]]:
    """Un magasin par fil, chacun sur son propre moteur : autant de « processus » que de fils."""
    moteurs = [create_engine(database_url) for _ in range(FILS)]
    try:
        yield [SpaceStore(moteur) for moteur in moteurs]
    finally:
        for moteur in moteurs:
            moteur.dispose()


def en_meme_temps[T](taches: list[Callable[[], T]]) -> list[T | SpaceError]:
    """Lance les tâches ensemble, derrière une barrière ; un refus est rendu comme résultat."""
    barriere = threading.Barrier(len(taches), timeout=10)

    def lancer(tache: Callable[[], T]) -> T | SpaceError:
        barriere.wait()
        try:
            return tache()
        except SpaceError as refus:
            return refus

    with ThreadPoolExecutor(max_workers=len(taches)) as executeur:
        return list(executeur.map(lancer, taches))


def admins(magasin: SpaceStore, espace: str) -> list[GroupPrincipal]:
    return [
        b.principal
        for b in magasin.bindings(espace)
        if b.role == Role.ADMIN and isinstance(b.principal, GroupPrincipal)
    ]


@pytest.mark.parametrize("maniere", ["retrait", "abaissement", "mixte"])
def test_deux_retraits_concurrents_laissent_un_administrateur(
    magasins: list[SpaceStore], migre: Engine, maniere: str
) -> None:
    magasin = magasins[0]
    for tour in range(TOURS):
        noms = [f"t{tour}-e{k}" for k in range(ESPACES)]
        for nom in noms:
            magasin.create_space(nom, nom, ATLAS, groupe(f"{nom}-un"), ACTEUR, INSTANT)
            magasin.set_binding(nom, groupe(f"{nom}-deux"), Role.ADMIN, ACTEUR, plus(1))
        taches: list[Callable[[], object]] = []
        for k, nom in enumerate(noms):
            for i, liaison in enumerate(magasin.bindings(nom)):
                fil = magasins[2 * k + i]
                abaisser = maniere == "abaissement" or (maniere == "mixte" and i == 1)
                if abaisser:
                    taches.append(
                        partial(
                            fil.set_binding, nom, liaison.principal, Role.READER, ACTEUR, plus(2)
                        )
                    )
                else:
                    taches.append(partial(fil.remove_binding, nom, liaison.id, ACTEUR, plus(2)))
        resultats = en_meme_temps(taches)
        for k, nom in enumerate(noms):
            paire = resultats[2 * k : 2 * k + 2]
            refus = [r for r in paire if isinstance(r, SpaceError)]
            # Exactement un des deux passe, l'autre se heurte au dernier administrateur.
            assert len(refus) == 1, (tour, nom, paire)
            assert isinstance(refus[0], LastAdmin), (tour, nom, paire)
            assert len(admins(magasin, nom)) == 1, (tour, nom)
            journal = [e.action for e in magasin.events(nom)]
            assert journal.count("binding_removed") + journal.count("binding_changed") == 1


def test_creation_concurrente_d_un_meme_identifiant(
    magasins: list[SpaceStore], migre: Engine
) -> None:
    for tour in range(TOURS):
        identifiant = f"commun-{tour}"
        taches: list[Callable[[], Space]] = [
            partial(
                fil.create_space,
                identifiant,
                f"nom-{i}",
                ATLAS,
                groupe(f"admins-{i}"),
                ACTEUR,
                plus(i),
            )
            for i, fil in enumerate(magasins)
        ]
        resultats = en_meme_temps(taches)
        reussies = [r for r in resultats if isinstance(r, Space)]
        assert len(reussies) == 1, (tour, resultats)
        assert all(isinstance(r, SpaceExists) for r in resultats if not isinstance(r, Space))
        [gagnant] = reussies
        gagnant_i = int(gagnant.name.removeprefix("nom-"))
        assert magasins[0].get_space(identifiant) == gagnant
        [liaison] = magasins[0].bindings(identifiant)
        assert liaison.principal == groupe(f"admins-{gagnant_i}")
        assert [e.action for e in magasins[0].events(identifiant)] == [
            "binding_added",
            "space_created",
        ]
    assert traces(migre) == (TOURS, TOURS, 2 * TOURS)
    with migre.connect() as connexion:
        assert len(connexion.execute(select(space_events.c.id)).all()) == 2 * TOURS
