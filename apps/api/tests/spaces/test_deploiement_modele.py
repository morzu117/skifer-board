"""Décision pure du droit de déployer : environnements, accords, rôle requis (plan 09, V1, V3,
V4).

Un accord n'a d'effet que s'il correspond à la session (groupe exact, ou même émetteur et même
sujet) et si son rôle dans l'espace est créateur ou plus. Aucun rôle, administrateur compris,
ne donne le droit d'office.
"""

from __future__ import annotations

import itertools

import pytest
from hypothesis import given
from hypothesis import strategies as st
from identity.conftest import INSTANT
from skifer_board.identity.model import Identity
from skifer_board.spaces import GroupPrincipal, PersonRef, Principal, Role, SpaceError
from skifer_board.spaces.model import (
    ENVIRONMENTS,
    DeployGrant,
    Environment,
    GrantNotFound,
    can_deploy,
    deployable,
    matches,
)

from .conftest import ACTEUR, ALICE, ALICE_AILLEURS, AUTRE_EMETTEUR, CHLOE, EMETTEUR, groupe, ref

ROLES: list[Role | None] = [None, Role.READER, Role.CREATOR, Role.ADMIN]
DEPLOYEURS = {Role.CREATOR, Role.ADMIN}


def accord(
    principal: Principal, environnement: Environment, espace: str = "esp", numero: int = 0
) -> DeployGrant:
    return DeployGrant(
        f"accord-{numero}-{environnement}-{principal}",
        espace,
        environnement,
        principal,
        INSTANT,
        ACTEUR,
    )


def identite(
    groupes: tuple[str, ...] = (), sujet: str = "sujet", emetteur: str = EMETTEUR
) -> Identity:
    return Identity(emetteur, sujet, None, None, groupes)


# --- Environnements (V1) -------------------------------------------------------------------


def test_trois_environnements_dans_l_ordre_de_promotion() -> None:
    assert ENVIRONMENTS == (Environment.DEV, Environment.TEST, Environment.PROD)
    assert list(Environment) == list(ENVIRONMENTS)
    assert [e.value for e in ENVIRONMENTS] == ["DEV", "TEST", "PROD"]
    assert [e.rank for e in ENVIRONMENTS] == [1, 2, 3]
    assert sorted(Environment, key=lambda e: e.rank) == list(ENVIRONMENTS)


@pytest.mark.parametrize("valeur", ["dev", "Prod", "QA", "LOCAL", "PRODUCTION", "", " DEV"])
def test_code_hors_des_trois_ne_designe_rien(valeur: str) -> None:
    with pytest.raises(ValueError):
        Environment(valeur)


def test_code_ferme_de_l_accord_introuvable() -> None:
    assert issubclass(GrantNotFound, SpaceError)
    assert GrantNotFound.code == "grant_not_found"


# --- Décision (V3, V4) ---------------------------------------------------------------------


@pytest.mark.parametrize("role", ROLES, ids=str)
def test_aucun_accord_aucun_droit(role: Role | None) -> None:
    # Pas de droit d'office, administrateur compris (V4).
    assert deployable(ALICE, role, []) == frozenset()
    for environnement in ENVIRONMENTS:
        assert not can_deploy(ALICE, role, [], environnement)


@pytest.mark.parametrize("principal", [groupe("equipe-a"), ref(ALICE)], ids=["groupe", "personne"])
@pytest.mark.parametrize("role", ROLES, ids=str)
def test_accord_de_groupe_ou_de_personne_selon_le_role(
    principal: Principal, role: Role | None
) -> None:
    accords = [accord(principal, Environment.TEST)]
    attendu = frozenset({Environment.TEST}) if role in DEPLOYEURS else frozenset()
    assert deployable(ALICE, role, accords) == attendu
    assert can_deploy(ALICE, role, accords, Environment.TEST) is (role in DEPLOYEURS)
    assert not can_deploy(ALICE, role, accords, Environment.DEV)
    assert not can_deploy(ALICE, role, accords, Environment.PROD)


def test_accord_dans_un_autre_environnement() -> None:
    accords = [accord(ref(ALICE), Environment.DEV), accord(groupe("equipe-a"), Environment.TEST)]
    assert deployable(ALICE, Role.ADMIN, accords) == {Environment.DEV, Environment.TEST}
    assert not can_deploy(ALICE, Role.ADMIN, accords, Environment.PROD)


def test_accords_cumules_sur_les_trois_environnements() -> None:
    accords = [
        accord(groupe("equipe-a"), Environment.DEV),
        accord(ref(ALICE), Environment.PROD),
        accord(groupe("autres"), Environment.TEST),
    ]
    assert deployable(ALICE, Role.CREATOR, accords) == {Environment.DEV, Environment.PROD}
    # Deux accords qui donnent le même environnement : un seul droit.
    doubles = [*accords, accord(ref(ALICE), Environment.DEV, numero=1)]
    assert deployable(ALICE, Role.CREATOR, doubles) == {Environment.DEV, Environment.PROD}


def test_accord_a_quelqu_un_d_autre_sans_effet() -> None:
    accords = [accord(ref(CHLOE), env) for env in ENVIRONMENTS]
    accords += [accord(groupe("lecteurs"), env) for env in ENVIRONMENTS]
    assert deployable(ALICE, Role.ADMIN, accords) == frozenset()
    assert deployable(CHLOE, Role.CREATOR, accords) == frozenset(ENVIRONMENTS)


def test_meme_sujet_chez_un_autre_emetteur() -> None:
    # Même sujet, autre émetteur : une autre personne (plan 08, E3).
    accords = [accord(ref(ALICE), env) for env in ENVIRONMENTS]
    assert deployable(ALICE_AILLEURS, Role.ADMIN, accords) == frozenset()
    assert deployable(ALICE, Role.ADMIN, accords) == frozenset(ENVIRONMENTS)
    ailleurs = [accord(PersonRef(AUTRE_EMETTEUR, "alice"), Environment.PROD)]
    assert deployable(ALICE, Role.ADMIN, ailleurs) == frozenset()
    assert deployable(ALICE_AILLEURS, Role.ADMIN, ailleurs) == {Environment.PROD}


def test_groupe_homonyme_d_une_personne() -> None:
    # Un groupe nommé comme le sujet ne désigne pas la personne, et inversement.
    assert deployable(CHLOE, Role.ADMIN, [accord(groupe("chloe"), Environment.DEV)]) == frozenset()
    assert deployable(CHLOE, Role.ADMIN, [accord(groupe(EMETTEUR), Environment.DEV)]) == frozenset()
    membre = identite(("chloe",), sujet="zoe")
    assert deployable(membre, Role.ADMIN, [accord(ref(CHLOE), Environment.DEV)]) == frozenset()
    assert deployable(membre, Role.ADMIN, [accord(groupe("chloe"), Environment.DEV)]) == {
        Environment.DEV
    }


@pytest.mark.parametrize(
    "variante", ["Equipe-a", "EQUIPE-A", " equipe-a", "equipe-a ", "equipe", ""]
)
def test_groupe_valeur_exacte(variante: str) -> None:
    accords = [accord(groupe("equipe-a"), Environment.PROD)]
    assert deployable(identite((variante,)), Role.ADMIN, accords) == frozenset()
    assert deployable(identite(), Role.ADMIN, [accord(groupe(""), Environment.PROD)]) == frozenset()


def test_lecteur_avec_tous_les_accords_reste_sans_droit() -> None:
    # Un accord de groupe donné à des personnes qui ne sont que lectrices (risque du plan, §6).
    accords = [accord(groupe("equipe-a"), env) for env in ENVIRONMENTS]
    accords += [accord(ref(ALICE), env, numero=1) for env in ENVIRONMENTS]
    assert deployable(ALICE, Role.READER, accords) == frozenset()
    assert deployable(ALICE, None, accords) == frozenset()


def test_iterable_a_usage_unique() -> None:
    accords = (
        a for a in [accord(ref(ALICE), Environment.DEV), accord(ref(ALICE), Environment.PROD)]
    )
    assert deployable(ALICE, Role.CREATOR, accords) == {Environment.DEV, Environment.PROD}


def test_decision_immuable() -> None:
    droit = deployable(ALICE, Role.CREATOR, [accord(ref(ALICE), Environment.DEV)])
    assert isinstance(droit, frozenset)


# --- Propriétés ----------------------------------------------------------------------------

GROUPES = st.sampled_from(["a", "b", "A", "", "sujet"])
EMETTEURS = st.sampled_from([EMETTEUR, AUTRE_EMETTEUR])
SUJETS = st.sampled_from(["sujet", "autre", "a"])
PRINCIPAUX: st.SearchStrategy[Principal] = st.one_of(
    GROUPES.map(GroupPrincipal), st.builds(PersonRef, EMETTEURS, SUJETS)
)
ENVS = st.sampled_from(list(ENVIRONMENTS))


def reference(
    personne: Identity, role: Role | None, accords: list[DeployGrant]
) -> set[Environment]:
    if role not in DEPLOYEURS:
        return set()
    trouves = set()
    for a in accords:
        p = a.principal
        if isinstance(p, GroupPrincipal):
            if p.name in personne.groups:
                trouves.add(a.environment)
        elif (p.issuer, p.subject) == (personne.issuer, personne.subject):
            trouves.add(a.environment)
    return trouves


@given(
    st.lists(st.tuples(PRINCIPAUX, ENVS), max_size=8),
    st.sampled_from(ROLES),
    st.lists(GROUPES, max_size=4).map(tuple),
    EMETTEURS,
    SUJETS,
)
def test_decision_propriete(
    paires: list[tuple[Principal, Environment]],
    role: Role | None,
    groupes: tuple[str, ...],
    emetteur: str,
    sujet: str,
) -> None:
    accords = [accord(p, e, numero=i) for i, (p, e) in enumerate(paires)]
    personne = identite(groupes, sujet, emetteur)
    attendu = reference(personne, role, accords)
    assert deployable(personne, role, accords) == attendu
    assert deployable(personne, role, list(reversed(accords))) == attendu
    for environnement in ENVIRONMENTS:
        assert can_deploy(personne, role, accords, environnement) is (environnement in attendu)
    # Tout droit vient d'un accord qui correspond à la session.
    for environnement in attendu:
        assert any(
            a.environment == environnement and matches(a.principal, personne) for a in accords
        )


@given(st.lists(st.tuples(PRINCIPAUX, ENVS), max_size=8), st.lists(GROUPES, max_size=4).map(tuple))
def test_droit_monotone_avec_le_role(
    paires: list[tuple[Principal, Environment]], groupes: tuple[str, ...]
) -> None:
    accords = [accord(p, e, numero=i) for i, (p, e) in enumerate(paires)]
    personne = identite(groupes)
    droits = [deployable(personne, role, accords) for role in ROLES]
    assert droits[0] == droits[1] == frozenset()
    # Créateur et administrateur ont exactement le même droit : aucun droit d'office (V4).
    assert droits[2] == droits[3]
    for faible, fort in itertools.pairwise(droits):
        assert faible <= fort
