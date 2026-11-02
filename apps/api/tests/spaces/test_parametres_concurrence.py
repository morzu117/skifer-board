"""Paramètres écrits en même temps, comme depuis plusieurs processus (plan 10, 10.1 ; plan 07,
P6).

Chaque écriture verrouille l'espace : des écritures simultanées se suivent. La limite de 100,
l'unicité d'un nom, la compatibilité des valeurs avec la déclaration et l'absence d'événement
pour une écriture sans changement tiennent quel que soit l'ordre d'arrivée, sans jamais une
erreur de base qui deviendrait une 500.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from functools import partial

import pytest
from identity.conftest import INSTANT
from skifer_board.spaces import (
    PARAMETERS_LIMIT,
    Configuration,
    InvalidParameter,
    Parameter,
    ParameterExists,
    ParameterLimit,
    ParameterNotFound,
    ParameterValue,
    SpaceError,
    SpaceStore,
    ValuesIncompatible,
)
from skifer_board.spaces.model import ENVIRONMENTS
from skifer_board.state.schema import deploy_parameters, parameter_values, spaces
from sqlalchemy import Engine, delete, insert, select

from .conftest import ACTEUR, ATLAS, EMETTEUR, groupe, plus
from .test_concurrence import FILS, TOURS
from .test_concurrence import magasins as magasins
from .test_parametres_modele import booleen, entier

DEV, TEST, PROD = ENVIRONMENTS
Refus = SpaceError | InvalidParameter


def ensemble[T](taches: list[Callable[[], T]]) -> list[T | Refus]:
    """Lance les tâches ensemble, derrière une barrière ; un refus, à code fermé ou de
    validation, est rendu comme résultat. Toute autre exception traverse."""
    barriere = threading.Barrier(len(taches), timeout=10)

    def lancer(tache: Callable[[], T]) -> T | Refus:
        barriere.wait()
        try:
            return tache()
        except (SpaceError, InvalidParameter) as refus:
            return refus

    with ThreadPoolExecutor(max_workers=len(taches)) as executeur:
        return list(executeur.map(lancer, taches))


def espace_neuf(magasin: SpaceStore, espace: str) -> None:
    magasin.create_space(espace, espace, ATLAS, groupe("admins"), ACTEUR, INSTANT)


def remplir(moteur: Engine, espace: str, nombre: int) -> None:
    """`nombre` déclarations posées d'un coup, pour arriver vite au bord de la limite."""
    colonnes = {
        "type": "boolean",
        "constraints": {},
        "required": False,
        "default_value": None,
        "description": "",
        "created_at": INSTANT,
        "created_by_issuer": EMETTEUR,
        "created_by_subject": "x",
        "updated_at": INSTANT,
        "updated_by_issuer": EMETTEUR,
        "updated_by_subject": "x",
    }
    with moteur.begin() as connexion:
        connexion.execute(
            insert(deploy_parameters),
            [{"space_id": espace, "name": f"p{i:03d}", **colonnes} for i in range(nombre)],
        )


def test_declarations_simultanees_pour_la_derniere_place(
    magasins: list[SpaceStore], migre: Engine
) -> None:
    magasin = magasins[0]
    for tour in range(TOURS):
        espace = f"tour-{tour}"
        espace_neuf(magasin, espace)
        remplir(migre, espace, PARAMETERS_LIMIT - 1)
        taches: list[Callable[[], Parameter]] = [
            partial(fil.declare, espace, f"nouveau_{i}", booleen(), ACTEUR, plus(i))
            for i, fil in enumerate(magasins)
        ]
        resultats = ensemble(taches)
        reussis = [r for r in resultats if isinstance(r, Parameter)]
        refus = [r for r in resultats if not isinstance(r, Parameter)]
        assert len(reussis) == 1, (tour, resultats)
        assert all(isinstance(r, ParameterLimit) for r in refus), (tour, resultats)
        assert len(magasin.configuration(espace).parameters) == PARAMETERS_LIMIT
        journal = [e.action for e in magasin.events(espace)]
        assert journal.count("parameter_declared") == 1, (tour, journal)


def test_declarations_simultanees_d_un_meme_nom(magasins: list[SpaceStore]) -> None:
    magasin = magasins[0]
    for tour in range(TOURS):
        espace = f"tour-{tour}"
        espace_neuf(magasin, espace)
        taches: list[Callable[[], Parameter]] = [
            partial(fil.declare, espace, "region", entier(maximum=i), ACTEUR, plus(i))
            for i, fil in enumerate(magasins)
        ]
        resultats = ensemble(taches)
        reussis = [r for r in resultats if isinstance(r, Parameter)]
        refus = [r for r in resultats if not isinstance(r, Parameter)]
        assert len(reussis) == 1, (tour, resultats)
        assert len(refus) == FILS - 1 and all(isinstance(r, ParameterExists) for r in refus)
        assert magasin.configuration(espace).parameters == (reussis[0],)
        journal = [e.action for e in magasin.events(espace)]
        assert journal.count("parameter_declared") == 1, (tour, journal)


def test_redeclaration_et_poses_simultanees(magasins: list[SpaceStore]) -> None:
    """Resserrer les bornes pendant qu'on pose une valeur qui en sortirait : l'un des deux est
    refusé, jamais une valeur invalide qui resterait en base (P5)."""
    magasin = magasins[0]
    moitie = FILS // 2
    for tour in range(TOURS):
        espace = f"tour-{tour}"
        espace_neuf(magasin, espace)
        magasin.declare(espace, "p", entier(0, 10), ACTEUR, INSTANT)
        taches: list[Callable[[], object]] = [
            partial(fil.redeclare, espace, "p", entier(0, 5), ACTEUR, plus(1))
            for fil in magasins[:moitie]
        ]
        taches += [
            partial(fil.set_value, espace, "p", ENVIRONMENTS[i % 3], 8, ACTEUR, plus(2))
            for i, fil in enumerate(magasins[moitie:])
        ]
        resultats = ensemble(taches)
        assert all(
            isinstance(r, Parameter | ParameterValue | ValuesIncompatible | InvalidParameter)
            for r in resultats
        ), (tour, resultats)
        configuration = magasin.configuration(espace)
        [parametre] = configuration.parameters
        valeurs = {v.environment: v.value for v in configuration.values}
        assert parametre.declaration.incompatible(valeurs) == (), (tour, parametre, valeurs)
        journal = [e.action for e in magasin.events(espace)]
        # Une redéclaration réussie au plus est journalisée, les suivantes sont inchangées.
        assert journal.count("parameter_changed") <= 1, (tour, journal)
        assert journal.count("value_set") == len(valeurs), (tour, journal)
        if journal.count("parameter_changed"):
            assert parametre.declaration == entier(0, 5)
            # Toute pose après le resserrement a été refusée comme hors contraintes.
            assert valeurs == {}
        else:
            assert parametre.declaration == entier(0, 10)
            assert set(valeurs) == set(ENVIRONMENTS)


def test_meme_valeur_posee_simultanement(magasins: list[SpaceStore]) -> None:
    magasin = magasins[0]
    for tour in range(TOURS):
        espace = f"tour-{tour}"
        espace_neuf(magasin, espace)
        magasin.declare(espace, "p", booleen(), ACTEUR, INSTANT)
        taches: list[Callable[[], ParameterValue]] = [
            partial(fil.set_value, espace, "p", PROD, False, ACTEUR, plus(i))
            for i, fil in enumerate(magasins)
        ]
        resultats = ensemble(taches)
        assert all(isinstance(r, ParameterValue) for r in resultats), (tour, resultats)
        # Toutes rendent la même pose : la première arrivée.
        assert len(set(resultats)) == 1, (tour, resultats)
        assert magasin.configuration(espace).values == (resultats[0],)
        journal = [e.action for e in magasin.events(espace)]
        assert journal.count("value_set") == 1, (tour, journal)


def test_retrait_et_poses_simultanes(magasins: list[SpaceStore]) -> None:
    magasin = magasins[0]
    moitie = FILS // 2
    for tour in range(TOURS):
        espace = f"tour-{tour}"
        espace_neuf(magasin, espace)
        magasin.declare(espace, "p", entier(), ACTEUR, INSTANT)
        taches: list[Callable[[], object]] = [
            partial(fil.remove_parameter, espace, "p", ACTEUR, plus(1)) for fil in magasins[:moitie]
        ]
        taches += [
            partial(fil.set_value, espace, "p", ENVIRONMENTS[i % 3], i, ACTEUR, plus(2))
            for i, fil in enumerate(magasins[moitie:])
        ]
        resultats = ensemble(taches)
        refus = [r for r in resultats if isinstance(r, Refus)]
        assert all(isinstance(r, ParameterNotFound) for r in refus), (tour, resultats)
        # Un seul retrait réussit ; aucune valeur ne survit à sa déclaration.
        assert sum(r is None for r in resultats) == 1, (tour, resultats)
        configuration = magasin.configuration(espace)
        assert (configuration.parameters, configuration.values) == ((), ())
        journal = [e.action for e in magasin.events(espace)]
        assert journal.count("parameter_removed") == 1, (tour, journal)


def test_lecture_coherente_pendant_les_ecritures(magasins: list[SpaceStore]) -> None:
    """Une lecture ne voit jamais une valeur sans sa déclaration."""
    magasin = magasins[0]
    moitie = FILS // 2
    for tour in range(TOURS):
        espace = f"tour-{tour}"
        espace_neuf(magasin, espace)
        for nom in ("a", "b", "c"):
            magasin.declare(espace, nom, entier(), ACTEUR, INSTANT)
            for environnement in ENVIRONMENTS:
                magasin.set_value(espace, nom, environnement, 1, ACTEUR, INSTANT)
        taches: list[Callable[[], object]] = [
            partial(fil.remove_parameter, espace, nom, ACTEUR, plus(1))
            for fil, nom in zip(magasins[:3], ("a", "b", "c"), strict=True)
        ]
        taches += [partial(fil.configuration, espace) for fil in magasins[3:moitie]]
        resultats = ensemble(taches)
        assert resultats[:3] == [None, None, None], (tour, resultats)
        for lu in resultats[3:]:
            assert isinstance(lu, Configuration), (tour, lu)
            assert {v.name for v in lu.values} <= {p.name for p in lu.parameters}, (tour, lu)


def test_lecture_attend_l_ecriture_en_cours(magasins: list[SpaceStore], migre: Engine) -> None:
    """Pendant qu'une écriture tient l'espace, la lecture attend sa fin et voit son résultat,
    au lieu de lire déclarations et valeurs à deux instants différents."""
    lecteur = magasins[0]
    espace_neuf(lecteur, "a")
    lecteur.declare("a", "p", entier(), ACTEUR, INSTANT)
    lecteur.set_value("a", "p", DEV, 1, ACTEUR, INSTANT)
    with ThreadPoolExecutor(max_workers=1) as executeur, migre.connect() as ecrivain:
        transaction = ecrivain.begin()
        ecrivain.execute(select(spaces.c.id).where(spaces.c.id == "a").with_for_update())
        ecrivain.execute(delete(parameter_values))
        lecture = executeur.submit(lecteur.configuration, "a")
        try:
            # La lecture ne peut pas aboutir tant que l'écriture tient l'espace.
            with pytest.raises(TimeoutError):
                lecture.result(timeout=0.5)
        finally:
            ecrivain.execute(delete(deploy_parameters))
            transaction.commit()
        lu = lecture.result(timeout=10)
    assert (lu.parameters, lu.values) == ((), ())
