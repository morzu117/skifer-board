"""Accords du droit de déployer posés en même temps, comme depuis plusieurs processus (plan 09,
V5, V6 ; plan 07, P6).

Deux accords identiques simultanés donnent un seul accord et un seul événement, ou un refus
à code fermé : jamais un doublon, jamais une erreur de base qui deviendrait une 500.
"""

from __future__ import annotations

from collections.abc import Callable
from functools import partial

from identity.conftest import INSTANT
from skifer_board.spaces import SpaceError, SpaceStore
from skifer_board.spaces.model import ENVIRONMENTS, DeployGrant, GrantNotFound
from skifer_board.state.schema import deploy_grants
from sqlalchemy import Engine

from .conftest import ACTEUR, ALICE, ATLAS, compter, groupe, plus, ref
from .test_concurrence import FILS, TOURS, en_meme_temps
from .test_concurrence import magasins as magasins

PROD = ENVIRONMENTS[2]


def test_accords_identiques_simultanes(magasins: list[SpaceStore], migre: Engine) -> None:
    magasin = magasins[0]
    magasin.record_login(ALICE, INSTANT)
    for tour in range(TOURS):
        espace = f"tour-{tour}"
        magasin.create_space(espace, espace, ATLAS, groupe("admins"), ACTEUR, INSTANT)
        principal = groupe("deployeurs") if tour % 2 else ref(ALICE)
        taches: list[Callable[[], DeployGrant]] = [
            partial(fil.grant, espace, PROD, principal, ACTEUR, plus(i))
            for i, fil in enumerate(magasins)
        ]
        resultats = en_meme_temps(taches)
        # Aucune exception hors des refus à code fermé n'a traversé `en_meme_temps`.
        accords = [r for r in resultats if isinstance(r, DeployGrant)]
        assert len(accords) == FILS, (tour, resultats)
        assert len({a.id for a in accords}) == 1, (tour, resultats)
        assert magasin.grants(espace) == [accords[0]]
        journal = [e.action for e in magasin.events(espace)]
        assert journal.count("deploy_granted") == 1, (tour, journal)
    assert compter(migre, deploy_grants) == TOURS


def test_retraits_simultanes_d_un_meme_accord(magasins: list[SpaceStore], migre: Engine) -> None:
    magasin = magasins[0]
    for tour in range(TOURS):
        espace = f"tour-{tour}"
        magasin.create_space(espace, espace, ATLAS, groupe("admins"), ACTEUR, INSTANT)
        accorde = magasin.grant(espace, PROD, groupe("deployeurs"), ACTEUR, plus(1))
        taches: list[Callable[[], None]] = [
            partial(fil.revoke, espace, accorde.id, ACTEUR, plus(2)) for fil in magasins
        ]
        resultats = en_meme_temps(taches)
        reussis = [r for r in resultats if r is None]
        refus = [r for r in resultats if isinstance(r, SpaceError)]
        assert len(reussis) == 1, (tour, resultats)
        assert len(refus) == FILS - 1 and all(isinstance(r, GrantNotFound) for r in refus)
        assert magasin.grants(espace) == []
        journal = [e.action for e in magasin.events(espace)]
        assert journal.count("deploy_revoked") == 1, (tour, journal)
    assert compter(migre, deploy_grants) == 0
