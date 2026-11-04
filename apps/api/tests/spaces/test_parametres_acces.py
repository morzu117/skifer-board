"""Droit de modifier les valeurs de paramètres, et paramètres par l'accès aux espaces (plan 10,
P6, P9).

Poser ou vider une valeur demande le rôle administrateur dans l'espace et le droit d'y
déployer : ni l'un ni l'autre seul ne suffit, et l'administration de la plateforme sans rôle
ne modifie aucune valeur. Sans base, les paramètres ne se gèrent pas (`local_mode`).
"""

from __future__ import annotations

from collections.abc import Callable

import pytest
from identity.conftest import INSTANT
from skifer_board.identity.model import Identity
from skifer_board.spaces import (
    LOCAL_SPACE,
    Access,
    LocalMode,
    Parameter,
    ParameterValue,
    Role,
    Space,
    Spaces,
    SpaceStore,
)
from skifer_board.spaces.model import ENVIRONMENTS, Environment
from skifer_board.state.schema import deploy_parameters, parameter_values, space_events
from sqlalchemy import Engine

from .conftest import ACTEUR, ALICE, ATLAS, BOB, CHLOE, EMETTEUR, compter, groupe, plus, ref
from .test_parametres_modele import booleen, entier

DEV, TEST, PROD = ENVIRONMENTS
PLATEFORME = "plateforme"
RIEN: frozenset[Environment] = frozenset()

# Dans A : Alice administre par `equipe-a`, Bob crée, Chloé lit. Pia administre la plateforme
# sans rôle ; Paul administre la plateforme et crée ; Quentin administre la plateforme et A.
PIA = Identity(EMETTEUR, "pia", None, None, (PLATEFORME,))
PAUL = Identity(EMETTEUR, "paul", None, None, (PLATEFORME, "createurs"))
QUENTIN = Identity(EMETTEUR, "quentin", None, None, (PLATEFORME, "equipe-a"))


@pytest.fixture
def espaces(magasin: SpaceStore) -> Spaces:
    for personne in (ALICE, BOB, CHLOE, PIA, PAUL, QUENTIN):
        magasin.record_login(personne, INSTANT)
    for espace in ("a", "b"):
        magasin.create_space(
            espace, espace.upper(), ATLAS, groupe(f"equipe-{espace}"), ACTEUR, INSTANT
        )
    magasin.set_binding("a", ref(BOB), Role.CREATOR, ACTEUR, plus(1))
    magasin.set_binding("a", ref(CHLOE), Role.READER, ACTEUR, plus(1))
    magasin.set_binding("a", groupe("createurs"), Role.CREATOR, ACTEUR, plus(1))
    magasin.set_binding("b", ref(BOB), Role.ADMIN, ACTEUR, plus(1))
    return Spaces.database(magasin, ATLAS, PLATEFORME, lambda: plus(10))


def acces(espaces: Spaces, qui: Identity, espace: str = "a") -> Access:
    trouve = espaces.access(qui, espace)
    assert trouve is not None
    return trouve


# --- Qui modifie les valeurs (P6) -----------------------------------------------------------


def test_administrateur_sans_droit_de_deployer(espaces: Spaces) -> None:
    trouve = acces(espaces, ALICE)
    assert trouve.role is Role.ADMIN and trouve.manages
    assert trouve.sets_values == RIEN


def test_administrateur_avec_droit_de_deployer(espaces: Spaces) -> None:
    espaces.grant(ALICE, "a", PROD, ref(ALICE))
    assert acces(espaces, ALICE).sets_values == {PROD}
    espaces.grant(ALICE, "a", DEV, groupe("equipe-a"))
    assert acces(espaces, ALICE).sets_values == {DEV, PROD}
    # Le droit de A ne vaut pas dans B, où Alice n'est rien.
    assert espaces.access(ALICE, "b") is None


def test_createur_avec_droit_de_deployer_ne_modifie_rien(espaces: Spaces) -> None:
    for environnement in ENVIRONMENTS:
        espaces.grant(ALICE, "a", environnement, ref(BOB))
    trouve = acces(espaces, BOB)
    assert trouve.deploy == frozenset(ENVIRONMENTS)
    assert trouve.sets_values == RIEN
    # Administrateur de B avec un accord : il y modifie les valeurs.
    espaces.grant(BOB, "b", TEST, ref(BOB))
    assert acces(espaces, BOB, "b").sets_values == {TEST}


def test_lecteur_avec_accord_ne_modifie_rien(espaces: Spaces) -> None:
    for environnement in ENVIRONMENTS:
        espaces.grant(ALICE, "a", environnement, ref(CHLOE))
    assert acces(espaces, CHLOE).sets_values == RIEN


def test_administration_de_la_plateforme_sans_role(espaces: Spaces) -> None:
    for environnement in ENVIRONMENTS:
        espaces.grant(PIA, "a", environnement, ref(PIA))
    trouve = acces(espaces, PIA)
    assert (trouve.role, trouve.platform_admin, trouve.manages) == (None, True, True)
    assert trouve.sets_values == RIEN
    assert all(a.sets_values == RIEN for a in espaces.visible(PIA))


def test_administration_de_la_plateforme_avec_un_role(espaces: Spaces) -> None:
    espaces.grant(PIA, "a", DEV, ref(PAUL))
    espaces.grant(PIA, "a", PROD, ref(QUENTIN))
    # Créateur : il déploie en DEV sans modifier de valeur ; administrateur : il modifie PROD.
    paul = acces(espaces, PAUL)
    assert (paul.deploy, paul.sets_values) == (frozenset({DEV}), RIEN)
    quentin = acces(espaces, QUENTIN)
    assert quentin.role is Role.ADMIN
    assert quentin.deploy == quentin.sets_values == {PROD}


def test_recalcule_a_chaque_appel(espaces: Spaces) -> None:
    accorde = espaces.grant(ALICE, "a", PROD, ref(ALICE))
    assert acces(espaces, ALICE).sets_values == {PROD}
    espaces.revoke(ALICE, "a", accorde.id)
    assert acces(espaces, ALICE).sets_values == RIEN
    espaces.grant(ALICE, "a", TEST, ref(BOB))
    espaces.set_binding(ALICE, "a", ref(BOB), Role.ADMIN)
    assert acces(espaces, BOB).sets_values == {TEST}
    espaces.set_binding(ALICE, "a", ref(BOB), Role.CREATOR)
    assert acces(espaces, BOB).sets_values == RIEN


def test_acces_et_liste_concordent(espaces: Spaces) -> None:
    espaces.grant(ALICE, "a", DEV, groupe("equipe-a"))
    espaces.grant(BOB, "b", PROD, ref(BOB))
    for qui in (ALICE, BOB, CHLOE, PIA, PAUL, QUENTIN):
        for trouve in espaces.visible(qui):
            assert espaces.access(qui, trouve.space.id) == trouve
            assert trouve.sets_values <= trouve.deploy


@pytest.mark.parametrize(
    ("role", "plateforme", "attendu"),
    [
        (Role.ADMIN, False, {DEV, PROD}),
        (Role.ADMIN, True, {DEV, PROD}),
        (Role.CREATOR, False, set()),
        (Role.CREATOR, True, set()),
        (Role.READER, False, set()),
        (None, True, set()),
        (None, False, set()),
    ],
)
def test_regle_pure(role: Role | None, plateforme: bool, attendu: set[Environment]) -> None:
    espace = Space("a", "A", ATLAS, INSTANT, ACTEUR)
    trouve = Access(espace, role, plateforme, deploy=frozenset({DEV, PROD}))
    assert trouve.sets_values == attendu
    assert Access(espace, role, plateforme).sets_values == RIEN


# --- Par l'accès aux espaces ----------------------------------------------------------------


def test_auteur_et_instant_sont_ceux_de_la_session(espaces: Spaces) -> None:
    cree = espaces.declare(ALICE, "a", "lignes", entier(0, 10))
    assert cree == Parameter(
        "a", "lignes", entier(0, 10), plus(10), ref(ALICE), plus(10), ref(ALICE)
    )
    change = espaces.redeclare(PIA, "a", "lignes", entier(0, 10, default=1))
    assert (change.created_by, change.updated_by, change.updated_at) == (
        ref(ALICE),
        ref(PIA),
        plus(10),
    )
    pose = espaces.set_value(ALICE, "a", "lignes", PROD, 0)
    assert pose == ParameterValue("a", "lignes", PROD, 0, plus(10), ref(ALICE))
    configuration = espaces.configuration("a")
    assert configuration.values == (pose,)
    espaces.clear_value(BOB, "a", "lignes", PROD)
    espaces.remove_parameter(QUENTIN, "a", "lignes")
    assert espaces.configuration("a").parameters == ()
    acteurs = [(e.action, e.actor) for e in espaces.events("a")[:5]]
    assert acteurs == [
        ("parameter_removed", ref(QUENTIN)),
        ("value_cleared", ref(BOB)),
        ("value_set", ref(ALICE)),
        ("parameter_changed", ref(PIA)),
        ("parameter_declared", ref(ALICE)),
    ]


def ecritures(espaces: Spaces, qui: Identity | None, espace: str) -> list[Callable[[], object]]:
    return [
        lambda: espaces.declare(qui, espace, "p", booleen()),
        lambda: espaces.redeclare(qui, espace, "p", booleen(required=True)),
        lambda: espaces.remove_parameter(qui, espace, "p"),
        lambda: espaces.set_value(qui, espace, "p", DEV, True),
        lambda: espaces.clear_value(qui, espace, "p", DEV),
    ]


def test_ecriture_sans_session_refusee_en_base(espaces: Spaces, migre: Engine) -> None:
    espaces.declare(ALICE, "a", "p", booleen())
    avant = [compter(migre, t) for t in (deploy_parameters, parameter_values, space_events)]
    for ecrire in ecritures(espaces, None, "a"):
        with pytest.raises(LocalMode) as refus:
            ecrire()
        assert refus.value.code == "local_mode"
    assert [compter(migre, t) for t in (deploy_parameters, parameter_values, space_events)] == (
        avant
    )


# --- Mode local (P9) ------------------------------------------------------------------------


def test_mode_local_parametres_non_geres() -> None:
    espaces = Spaces.local(ATLAS, lambda: INSTANT)
    for qui in (None, ALICE):
        for ecrire in ecritures(espaces, qui, LOCAL_SPACE):
            with pytest.raises(LocalMode) as refus:
                ecrire()
            assert refus.value.code == "local_mode"
    with pytest.raises(LocalMode):
        espaces.configuration(LOCAL_SPACE)


def test_mode_local_droit_calcule_comme_ailleurs() -> None:
    # La personne locale administre et déploie partout : la règle donne les trois
    # environnements, même si les paramètres n'y sont pas gérés (P9).
    trouve = Spaces.local(ATLAS, lambda: INSTANT).access(None, LOCAL_SPACE)
    assert trouve is not None and trouve.implicit
    assert trouve.sets_values == frozenset(ENVIRONMENTS)
