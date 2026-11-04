"""Paramètres de déploiement dans le magasin des espaces (plan 10, P1, P3 à P5, P7, P8).

Chaque écriture verrouille l'espace et journalise dans la même transaction ; une écriture sans
changement n'est pas journalisée ; un refus n'écrit rien.
"""

from __future__ import annotations

from typing import Any

import pytest
from identity.conftest import INSTANT
from skifer_board.spaces import (
    PARAMETERS_LIMIT,
    Declaration,
    InvalidParameter,
    Parameter,
    ParameterExists,
    ParameterLimit,
    ParameterNotFound,
    ParameterValue,
    PersonRef,
    Resolved,
    SpaceNotFound,
    SpaceStore,
    State,
    ValuesIncompatible,
)
from skifer_board.spaces.model import ENVIRONMENTS
from skifer_board.state.schema import deploy_parameters, parameter_values, space_events
from sqlalchemy import Engine, func, insert, select

from .conftest import ACTEUR, ATLAS, EMETTEUR, compter, groupe, plus
from .test_magasin import creer, resume, utc
from .test_parametres_modele import booleen, choix, entier, identifiant, texte

DEV, TEST, PROD = ENVIRONMENTS
AUTRE_ACTEUR = PersonRef(EMETTEUR, "admin-espace")
MAX = 2**53 - 1


def contenu(moteur: Engine) -> dict[str, list[tuple[Any, ...]]]:
    """Paramètres, valeurs et journal en base : un refus n'y change rien."""
    with moteur.connect() as connexion:
        return {
            table.name: sorted(
                (tuple(ligne) for ligne in connexion.execute(select(table))), key=repr
            )
            for table in (deploy_parameters, parameter_values, space_events)
        }


def types_json(moteur: Engine) -> dict[tuple[str, str, str], str]:
    """Type JSON de chaque valeur en base : une donnée typée, jamais du texte à interpréter."""
    with moteur.connect() as connexion:
        lignes = connexion.execute(
            select(
                parameter_values.c.space_id,
                parameter_values.c.name,
                parameter_values.c.environment,
                func.jsonb_typeof(parameter_values.c.value),
            )
        ).all()
    return {(e, n, env): t for e, n, env, t in lignes}


@pytest.fixture
def deux_espaces(magasin: SpaceStore) -> SpaceStore:
    creer(magasin, "a", groupe("equipe-a"))
    creer(magasin, "b", groupe("equipe-b"))
    return magasin


def dernier(magasin: SpaceStore, espace: str = "a") -> tuple[str, dict[str, Any], PersonRef, Any]:
    [evenement, *_] = magasin.events(espace)
    return evenement.action, evenement.detail, evenement.actor, evenement.at


# --- Déclarer (P3, P7) ----------------------------------------------------------------------


def test_declarer(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    declaration = entier(0, 10, required=True, default=0, description="Lignes")
    cree = magasin.declare("a", "lignes", declaration, ACTEUR, plus(1))
    assert cree == Parameter("a", "lignes", declaration, plus(1), ACTEUR, plus(1), ACTEUR)
    configuration = magasin.configuration("a")
    assert configuration.parameters == (cree,)
    assert configuration.values == ()
    assert dernier(magasin) == (
        "parameter_declared",
        {
            "name": "lignes",
            "declaration": {
                "type": "integer",
                "constraints": {"minimum": 0, "maximum": 10},
                "required": True,
                "default": 0,
                "description": "Lignes",
            },
        },
        ACTEUR,
        plus(1),
    )
    assert magasin.configuration("b").parameters == ()


@pytest.mark.parametrize(
    "declaration",
    [
        texte(1024, required=True, default="é" * 1024, description="x" * 200),
        texte(1),
        entier(),
        entier(-MAX, MAX, default=-MAX),
        entier(minimum=MAX, default=MAX),
        entier(maximum=0, default=0),
        booleen(default=False),
        booleen(default=True, required=True),
        booleen(),
        choix(*(f"v{i}" for i in range(50)), default="v49"),
        choix("b", "a"),
        identifiant(default="_" + "a" * 127),
        identifiant(required=True),
    ],
    ids=lambda d: f"{d.type.value}-{d.default!r:.12}",
)
def test_declaration_relue_a_l_identique(
    deux_espaces: SpaceStore, declaration: Declaration
) -> None:
    magasin = deux_espaces
    magasin.declare("a", "p", declaration, ACTEUR, plus(1))
    [relu] = magasin.configuration("a").parameters
    assert relu.declaration == declaration
    assert relu.declaration.same_as(declaration)
    assert type(relu.declaration.default) is type(declaration.default)


def test_parametres_lus_par_nom(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    for i, nom in enumerate(("zeta", "alpha", "m_1", "m0", "beta")):
        magasin.declare("a", nom, booleen(), ACTEUR, plus(i))
    noms = [p.name for p in magasin.configuration("a").parameters]
    assert noms == ["alpha", "beta", "m0", "m_1", "zeta"]


@pytest.mark.parametrize("nom", ["", "Majuscule", "1chiffre", "a" * 64, "nom-tiret", "é"])
def test_nom_invalide_refuse_par_le_magasin(
    deux_espaces: SpaceStore, migre: Engine, nom: str
) -> None:
    """Le magasin valide le nom lui-même : un nom trop long n'arrive pas jusqu'à la base."""
    avant = contenu(migre)
    with pytest.raises(InvalidParameter) as refus:
        deux_espaces.declare("a", nom, booleen(), ACTEUR, plus(1))
    assert refus.value.field == "name"
    assert contenu(migre) == avant


def test_doublon_refuse_sans_rien_ecrire(deux_espaces: SpaceStore, migre: Engine) -> None:
    magasin = deux_espaces
    premier = magasin.declare("a", "region", choix("eu"), ACTEUR, plus(1))
    avant = contenu(migre)
    with pytest.raises(ParameterExists) as refus:
        magasin.declare("a", "region", texte(5), AUTRE_ACTEUR, plus(2))
    assert refus.value.code == "parameter_exists"
    assert contenu(migre) == avant
    assert magasin.configuration("a").parameters == (premier,)


def test_meme_nom_dans_deux_espaces(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    dans_a = magasin.declare("a", "region", choix("eu", "us"), ACTEUR, plus(1))
    dans_b = magasin.declare("b", "region", entier(), AUTRE_ACTEUR, plus(2))
    magasin.set_value("a", "region", PROD, "us", ACTEUR, plus(3))
    magasin.set_value("b", "region", PROD, 7, ACTEUR, plus(4))
    a, b = magasin.configuration("a"), magasin.configuration("b")
    assert a.parameters == (dans_a,) and b.parameters == (dans_b,)
    assert [(v.space_id, v.value) for v in a.values] == [("a", "us")]
    assert [(v.space_id, v.value) for v in b.values] == [("b", 7)]
    # Retirer dans A ne touche pas B, ni son journal.
    evenements_b = magasin.events("b")
    magasin.remove_parameter("a", "region", ACTEUR, plus(5))
    assert magasin.configuration("a").parameters == ()
    assert magasin.configuration("b") == b
    assert magasin.events("b") == evenements_b
    # Une valeur ou une déclaration de B n'est pas trouvée depuis A.
    magasin.declare("b", "seul_b", booleen(), ACTEUR, plus(6))
    with pytest.raises(ParameterNotFound):
        magasin.set_value("a", "seul_b", DEV, True, ACTEUR, plus(7))
    with pytest.raises(ParameterNotFound):
        magasin.redeclare("a", "seul_b", booleen(required=True), ACTEUR, plus(7))
    with pytest.raises(ParameterNotFound):
        magasin.clear_value("a", "region", PROD, ACTEUR, plus(7))
    assert [(v.name, v.value) for v in magasin.configuration("b").values] == [("region", 7)]


# --- Limite de 100 (P3) ---------------------------------------------------------------------


def test_limite_de_cent_parametres(deux_espaces: SpaceStore, migre: Engine) -> None:
    magasin = deux_espaces
    for i in range(PARAMETERS_LIMIT):
        magasin.declare("a", f"p{i:03d}", booleen(), ACTEUR, plus(1))
    assert len(magasin.configuration("a").parameters) == 100
    avant = contenu(migre)
    with pytest.raises(ParameterLimit) as refus:
        magasin.declare("a", "p_de_trop", booleen(), ACTEUR, plus(2))
    assert refus.value.code == "parameter_limit"
    assert contenu(migre) == avant
    # La limite vaut par espace.
    magasin.declare("b", "p_de_trop", booleen(), ACTEUR, plus(3))
    # Un retrait libère une place.
    magasin.remove_parameter("a", "p042", ACTEUR, plus(4))
    magasin.declare("a", "p_de_trop", booleen(), ACTEUR, plus(5))
    assert len(magasin.configuration("a").parameters) == 100
    with pytest.raises(ParameterLimit):
        magasin.declare("a", "encore", booleen(), ACTEUR, plus(6))


# --- Espace et paramètre inconnus (P8) ------------------------------------------------------


def test_espace_inconnu(deux_espaces: SpaceStore, migre: Engine) -> None:
    magasin = deux_espaces
    magasin.declare("a", "p", entier(), ACTEUR, plus(1))
    avant = contenu(migre)
    with pytest.raises(SpaceNotFound) as refus:
        magasin.configuration("inconnu")
    assert refus.value.code == "space_not_found"
    for ecrire in (
        lambda: magasin.declare("inconnu", "p", entier(), ACTEUR, plus(2)),
        lambda: magasin.redeclare("inconnu", "p", entier(), ACTEUR, plus(2)),
        lambda: magasin.remove_parameter("inconnu", "p", ACTEUR, plus(2)),
        lambda: magasin.set_value("inconnu", "p", DEV, 1, ACTEUR, plus(2)),
        lambda: magasin.clear_value("inconnu", "p", DEV, ACTEUR, plus(2)),
        # Même avec une valeur invalide : l'espace est refusé avant la valeur.
        lambda: magasin.set_value("inconnu", "p", DEV, "x", ACTEUR, plus(2)),
    ):
        with pytest.raises(SpaceNotFound):
            ecrire()
    assert contenu(migre) == avant


@pytest.mark.parametrize("nom", ["inconnu", "P", "", "p" * 200])
def test_parametre_inconnu(deux_espaces: SpaceStore, migre: Engine, nom: str) -> None:
    magasin = deux_espaces
    magasin.declare("a", "p", entier(), ACTEUR, plus(1))
    avant = contenu(migre)
    for ecrire in (
        lambda: magasin.redeclare("a", nom, entier(), ACTEUR, plus(2)),
        lambda: magasin.remove_parameter("a", nom, ACTEUR, plus(2)),
        lambda: magasin.set_value("a", nom, DEV, 1, ACTEUR, plus(2)),
        lambda: magasin.clear_value("a", nom, DEV, ACTEUR, plus(2)),
    ):
        with pytest.raises(ParameterNotFound) as refus:
            ecrire()
        assert refus.value.code == "parameter_not_found"
    assert contenu(migre) == avant


# --- Redéclarer (P5, P7) --------------------------------------------------------------------


def test_redeclaration_inchangee_sans_evenement(deux_espaces: SpaceStore, migre: Engine) -> None:
    magasin = deux_espaces
    cree = magasin.declare("a", "p", entier(0, 10, default=0), ACTEUR, plus(1))
    avant = contenu(migre)
    rendu = magasin.redeclare("a", "p", entier(0, 10, default=0), AUTRE_ACTEUR, plus(2))
    # Rien n'est refait : auteur et instant de la déclaration d'origine.
    assert rendu == cree
    assert contenu(migre) == avant


def test_redeclaration_journalisee_avec_avant_et_apres(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    magasin.declare("a", "p", entier(0, 10), ACTEUR, plus(1))
    nouvelle = entier(0, 20, required=True, default=5, description="Plafond")
    rendu = magasin.redeclare("a", "p", nouvelle, AUTRE_ACTEUR, plus(2))
    assert rendu == Parameter("a", "p", nouvelle, plus(1), ACTEUR, plus(2), AUTRE_ACTEUR)
    assert magasin.configuration("a").parameters == (rendu,)
    assert dernier(magasin) == (
        "parameter_changed",
        {
            "name": "p",
            "before": {
                "type": "integer",
                "constraints": {"minimum": 0, "maximum": 10},
                "required": False,
                "default": None,
                "description": "",
            },
            "after": {
                "type": "integer",
                "constraints": {"minimum": 0, "maximum": 20},
                "required": True,
                "default": 5,
                "description": "Plafond",
            },
        },
        AUTRE_ACTEUR,
        plus(2),
    )


@pytest.mark.parametrize(
    ("avant", "apres"),
    [
        (texte(5), texte(5, description="d")),
        (booleen(default=False), booleen()),
        (booleen(), booleen(default=False)),
        (booleen(default=False), booleen(default=True)),
        (entier(default=0), entier(default=1)),
        (choix("a", "b"), choix("b", "a")),
        (identifiant(), texte(5)),
    ],
    ids=str,
)
def test_tout_changement_est_journalise(
    deux_espaces: SpaceStore, avant: Declaration, apres: Declaration
) -> None:
    magasin = deux_espaces
    magasin.declare("a", "p", avant, ACTEUR, plus(1))
    magasin.redeclare("a", "p", apres, ACTEUR, plus(2))
    action, detail, _, _ = dernier(magasin)
    assert (action, detail["before"], detail["after"]) == (
        "parameter_changed",
        avant.to_json(),
        apres.to_json(),
    )
    [relu] = magasin.configuration("a").parameters
    assert relu.declaration.same_as(apres)


@pytest.mark.parametrize(
    ("declaration", "valeurs", "nouvelle", "en_cause"),
    [
        (entier(0, 10), {DEV: 3, TEST: 8, PROD: 10}, entier(0, 5), (TEST, PROD)),
        (entier(), {PROD: 0, DEV: -1}, entier(minimum=0), (DEV,)),
        (entier(), {PROD: 1}, booleen(), (PROD,)),
        (booleen(), {DEV: False, PROD: True}, entier(), (DEV, PROD)),
        (texte(10), {TEST: "abcdef", DEV: "ab"}, texte(5), (TEST,)),
        (texte(10), {DEV: "a-b", PROD: "ab"}, identifiant(), (DEV,)),
        (choix("eu", "us"), {PROD: "us", DEV: "eu"}, choix("eu"), (PROD,)),
        (choix("eu", "us"), {PROD: "us", DEV: "eu"}, choix("EU", "US"), (DEV, PROD)),
    ],
    ids=str,
)
def test_redeclaration_incompatible_refusee_sans_rien_ecrire(
    deux_espaces: SpaceStore,
    migre: Engine,
    declaration: Declaration,
    valeurs: dict[Any, Any],
    nouvelle: Declaration,
    en_cause: tuple[Any, ...],
) -> None:
    magasin = deux_espaces
    magasin.declare("a", "p", declaration, ACTEUR, plus(1))
    for environnement, valeur in valeurs.items():
        magasin.set_value("a", "p", environnement, valeur, ACTEUR, plus(2))
    avant = contenu(migre)
    with pytest.raises(ValuesIncompatible) as refus:
        magasin.redeclare("a", "p", nouvelle, AUTRE_ACTEUR, plus(3))
    assert refus.value.environments == en_cause
    assert refus.value.code == "values_incompatible"
    assert contenu(migre) == avant
    # Vider les valeurs en cause permet ensuite le changement.
    for environnement in en_cause:
        magasin.clear_value("a", "p", environnement, ACTEUR, plus(4))
    magasin.redeclare("a", "p", nouvelle, AUTRE_ACTEUR, plus(5))
    [relu] = magasin.configuration("a").parameters
    assert relu.declaration == nouvelle


def test_valeurs_des_autres_espaces_ne_bloquent_pas(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    for espace in ("a", "b"):
        magasin.declare(espace, "p", entier(), ACTEUR, plus(1))
    magasin.set_value("b", "p", PROD, 100, ACTEUR, plus(2))
    magasin.redeclare("a", "p", entier(0, 10), ACTEUR, plus(3))
    with pytest.raises(ValuesIncompatible):
        magasin.redeclare("b", "p", entier(0, 10), ACTEUR, plus(4))


def test_rendre_obligatoire_permis_rend_incomplet(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    magasin.declare("a", "p", texte(5), ACTEUR, plus(1))
    magasin.set_value("a", "p", TEST, "t", ACTEUR, plus(2))
    assert all(magasin.configuration("a").complete(e) for e in ENVIRONMENTS)
    magasin.redeclare("a", "p", texte(5, required=True), ACTEUR, plus(3))
    configuration = magasin.configuration("a")
    assert configuration.missing(DEV) == ("p",)
    assert configuration.missing(TEST) == ()
    assert configuration.missing(PROD) == ("p",)
    # Un défaut complète les environnements sans valeur propre.
    magasin.redeclare("a", "p", texte(5, required=True, default="d"), ACTEUR, plus(4))
    configuration = magasin.configuration("a")
    assert [r for _, r in configuration.resolved(DEV)] == [Resolved(State.DEFAULT, "d")]
    assert [r for _, r in configuration.resolved(TEST)] == [Resolved(State.VALUE, "t")]
    assert all(configuration.complete(e) for e in ENVIRONMENTS)


def test_changer_le_defaut_permis_malgre_les_valeurs(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    magasin.declare("a", "p", entier(0, 10, default=1), ACTEUR, plus(1))
    magasin.set_value("a", "p", PROD, 10, ACTEUR, plus(2))
    magasin.redeclare("a", "p", entier(0, 10, default=0), ACTEUR, plus(3))
    configuration = magasin.configuration("a")
    assert [r for _, r in configuration.resolved(DEV)] == [Resolved(State.DEFAULT, 0)]
    assert [r for _, r in configuration.resolved(PROD)] == [Resolved(State.VALUE, 10)]


# --- Retirer (P5, P7) -----------------------------------------------------------------------


def test_retrait_retire_les_valeurs_et_les_journalise(
    deux_espaces: SpaceStore, migre: Engine
) -> None:
    magasin = deux_espaces
    magasin.declare("a", "p", entier(default=0), ACTEUR, plus(1))
    garde = magasin.declare("a", "q", booleen(), ACTEUR, plus(1))
    magasin.set_value("a", "p", PROD, 0, ACTEUR, plus(2))
    magasin.set_value("a", "p", DEV, -3, ACTEUR, plus(3))
    garde_valeur = magasin.set_value("a", "q", DEV, False, ACTEUR, plus(4))
    magasin.remove_parameter("a", "p", AUTRE_ACTEUR, plus(5))
    configuration = magasin.configuration("a")
    assert configuration.parameters == (garde,)
    assert configuration.values == (garde_valeur,)
    assert compter(migre, parameter_values) == 1
    action, detail, acteur, instant = dernier(magasin)
    assert (action, acteur, instant) == ("parameter_removed", AUTRE_ACTEUR, plus(5))
    assert detail == {
        "name": "p",
        "declaration": {
            "type": "integer",
            "constraints": {"minimum": None, "maximum": None},
            "required": False,
            "default": 0,
            "description": "",
        },
        "values": {"DEV": -3, "PROD": 0},
    }
    # Dans l'ordre de promotion, quel que soit l'ordre de pose.
    assert list(detail["values"]) == ["DEV", "PROD"]
    # Retirer deux fois : la seconde fois, le paramètre est inconnu.
    with pytest.raises(ParameterNotFound):
        magasin.remove_parameter("a", "p", ACTEUR, plus(6))


def test_retrait_sans_valeur(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    magasin.declare("a", "p", booleen(), ACTEUR, plus(1))
    magasin.remove_parameter("a", "p", ACTEUR, plus(2))
    _, detail, _, _ = dernier(magasin)
    assert detail["values"] == {}


def test_redeclarer_apres_retrait_repart_de_zero(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    magasin.declare("a", "p", entier(), ACTEUR, plus(1))
    magasin.set_value("a", "p", PROD, 5, ACTEUR, plus(2))
    magasin.remove_parameter("a", "p", ACTEUR, plus(3))
    nouveau = magasin.declare("a", "p", texte(3), AUTRE_ACTEUR, plus(4))
    configuration = magasin.configuration("a")
    assert configuration.parameters == (nouveau,)
    assert configuration.values == ()
    assert nouveau.created_at == plus(4) and nouveau.created_by == AUTRE_ACTEUR


# --- Valeurs (P4, P7) -----------------------------------------------------------------------


def test_poser_puis_reposer_la_meme_valeur(deux_espaces: SpaceStore, migre: Engine) -> None:
    magasin = deux_espaces
    magasin.declare("a", "p", texte(10), ACTEUR, plus(1))
    pose = magasin.set_value("a", "p", PROD, "eu", ACTEUR, plus(2))
    assert pose == ParameterValue("a", "p", PROD, "eu", plus(2), ACTEUR)
    assert magasin.configuration("a").values == (pose,)
    assert dernier(magasin) == (
        "value_set",
        {"name": "p", "environment": "PROD", "before": None, "after": "eu"},
        ACTEUR,
        plus(2),
    )
    avant = contenu(migre)
    # La même valeur une seconde fois : ni écriture ni événement ; la pose d'origine est rendue.
    repose = magasin.set_value("a", "p", PROD, "eu", AUTRE_ACTEUR, plus(3))
    assert repose == pose
    assert contenu(migre) == avant
    # Une autre valeur : avant et après.
    change = magasin.set_value("a", "p", PROD, "us", AUTRE_ACTEUR, plus(4))
    assert change == ParameterValue("a", "p", PROD, "us", plus(4), AUTRE_ACTEUR)
    assert magasin.configuration("a").values == (change,)
    assert dernier(magasin) == (
        "value_set",
        {"name": "p", "environment": "PROD", "before": "eu", "after": "us"},
        AUTRE_ACTEUR,
        plus(4),
    )
    assert compter(migre, parameter_values) == 1


@pytest.mark.parametrize(
    ("declaration", "valeur"),
    [(entier(), 0), (booleen(), False), (booleen(), True), (entier(), -MAX), (entier(), MAX)],
    ids=repr,
)
def test_reposer_une_valeur_fausse_sans_evenement(
    deux_espaces: SpaceStore, migre: Engine, declaration: Declaration, valeur: Any
) -> None:
    magasin = deux_espaces
    magasin.declare("a", "p", declaration, ACTEUR, plus(1))
    pose = magasin.set_value("a", "p", TEST, valeur, ACTEUR, plus(2))
    avant = contenu(migre)
    assert magasin.set_value("a", "p", TEST, valeur, AUTRE_ACTEUR, plus(3)) == pose
    assert contenu(migre) == avant


def test_une_valeur_par_environnement(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    magasin.declare("a", "p", entier(), ACTEUR, plus(1))
    magasin.declare("a", "o", entier(), ACTEUR, plus(1))
    for i, environnement in enumerate((PROD, DEV, TEST)):
        magasin.set_value("a", "p", environnement, i, ACTEUR, plus(2 + i))
    magasin.set_value("a", "o", PROD, 9, ACTEUR, plus(9))
    valeurs = magasin.configuration("a").values
    # Par nom, puis dans l'ordre de promotion.
    assert [(v.name, v.environment, v.value) for v in valeurs] == [
        ("o", PROD, 9),
        ("p", DEV, 1),
        ("p", TEST, 2),
        ("p", PROD, 0),
    ]


@pytest.mark.parametrize(
    ("declaration", "valeur"),
    [
        (texte(3), "abcd"),
        (texte(3), ""),
        (texte(3), 1),
        (texte(3), "a\x00"),
        (texte(3), "\ud800"),
        (entier(0, 10), 11),
        (entier(), MAX + 1),
        (entier(), 1.0),
        (entier(), "1"),
        (entier(), True),
        (entier(), None),
        (booleen(), 1),
        (booleen(), 0),
        (booleen(), "true"),
        (choix("a"), "b"),
        (identifiant(), "1a"),
        (identifiant(), "a\n"),
    ],
    ids=repr,
)
def test_valeur_invalide_refusee_sans_rien_ecrire(
    deux_espaces: SpaceStore, migre: Engine, declaration: Declaration, valeur: object
) -> None:
    magasin = deux_espaces
    magasin.declare("a", "p", declaration, ACTEUR, plus(1))
    avant = contenu(migre)
    with pytest.raises(InvalidParameter) as refus:
        magasin.set_value("a", "p", DEV, valeur, ACTEUR, plus(2))
    assert refus.value.field == "value"
    assert contenu(migre) == avant


def test_true_puis_1_ne_sont_pas_la_meme_valeur(deux_espaces: SpaceStore, migre: Engine) -> None:
    magasin = deux_espaces
    magasin.declare("a", "drapeau", booleen(), ACTEUR, plus(1))
    magasin.declare("a", "nombre", entier(), ACTEUR, plus(1))
    magasin.set_value("a", "drapeau", DEV, True, ACTEUR, plus(2))
    magasin.set_value("a", "nombre", DEV, 1, ACTEUR, plus(2))
    magasin.set_value("a", "drapeau", TEST, False, ACTEUR, plus(2))
    magasin.set_value("a", "nombre", TEST, 0, ACTEUR, plus(2))
    avant = contenu(migre)
    # `1` n'est pas « la même valeur » que `True` : c'est une valeur invalide, refusée.
    for nom, environnement, valeur in (
        ("drapeau", DEV, 1),
        ("nombre", DEV, True),
        ("drapeau", TEST, 0),
        ("nombre", TEST, False),
    ):
        with pytest.raises(InvalidParameter):
            magasin.set_value("a", nom, environnement, valeur, ACTEUR, plus(3))
    assert contenu(migre) == avant


def test_valeurs_relues_avec_leur_type_exact(deux_espaces: SpaceStore, migre: Engine) -> None:
    magasin = deux_espaces
    magasin.declare("a", "b", booleen(), ACTEUR, plus(1))
    magasin.declare("a", "c", choix("1", "2"), ACTEUR, plus(1))
    magasin.declare("a", "i", entier(), ACTEUR, plus(1))
    magasin.declare("a", "n", identifiant(), ACTEUR, plus(1))
    magasin.declare("a", "t", texte(1024), ACTEUR, plus(1))
    poses: list[tuple[str, Any, Any]] = [
        ("b", DEV, False),
        ("b", PROD, True),
        ("c", DEV, "1"),
        ("i", DEV, 0),
        ("i", TEST, MAX),
        ("i", PROD, -MAX),
        ("n", DEV, "Catalogue_1"),
        ("t", DEV, "true"),
        ("t", TEST, "0"),
        ("t", PROD, "é" * 1000 + "\U0001f600" + " ' OR 1=1 --"),
    ]
    for nom, environnement, valeur in poses:
        magasin.set_value("a", nom, environnement, valeur, ACTEUR, plus(2))
    relues = {(v.name, v.environment): v.value for v in magasin.configuration("a").values}
    for nom, environnement, valeur in poses:
        assert relues[(nom, environnement)] == valeur
        assert type(relues[(nom, environnement)]) is type(valeur), (nom, environnement)
    assert types_json(migre) == {
        ("a", "b", "DEV"): "boolean",
        ("a", "b", "PROD"): "boolean",
        ("a", "c", "DEV"): "string",
        ("a", "i", "DEV"): "number",
        ("a", "i", "TEST"): "number",
        ("a", "i", "PROD"): "number",
        ("a", "n", "DEV"): "string",
        ("a", "t", "DEV"): "string",
        ("a", "t", "TEST"): "string",
        ("a", "t", "PROD"): "string",
    }


def test_defaut_et_contraintes_en_json_type(deux_espaces: SpaceStore, migre: Engine) -> None:
    magasin = deux_espaces
    magasin.declare("a", "b", booleen(default=False), ACTEUR, plus(1))
    magasin.declare("a", "i", entier(0, 5, default=0), ACTEUR, plus(1))
    magasin.declare("a", "s", texte(3), ACTEUR, plus(1))
    with migre.connect() as connexion:
        lignes = connexion.execute(
            select(
                deploy_parameters.c.name,
                func.jsonb_typeof(deploy_parameters.c.constraints),
                deploy_parameters.c.default_value.is_(None),
                func.jsonb_typeof(deploy_parameters.c.default_value),
            ).order_by(deploy_parameters.c.name)
        ).all()
    # Un défaut absent est un NULL SQL, pas un `null` JSON.
    assert [tuple(ligne) for ligne in lignes] == [
        ("b", "object", False, "boolean"),
        ("i", "object", False, "number"),
        ("s", "object", True, None),
    ]


def test_valeur_posee_validee_contre_la_declaration_courante(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    magasin.declare("a", "p", entier(0, 100), ACTEUR, plus(1))
    magasin.set_value("a", "p", DEV, 50, ACTEUR, plus(2))
    magasin.clear_value("a", "p", DEV, ACTEUR, plus(3))
    magasin.redeclare("a", "p", entier(0, 10), ACTEUR, plus(4))
    with pytest.raises(InvalidParameter):
        magasin.set_value("a", "p", DEV, 50, ACTEUR, plus(5))
    magasin.set_value("a", "p", DEV, 10, ACTEUR, plus(6))


# --- Vider une valeur (P7) ------------------------------------------------------------------


@pytest.mark.parametrize(
    ("declaration", "valeur"),
    [(texte(5), "eu"), (entier(), 0), (booleen(), False), (texte(5), "0")],
    ids=repr,
)
def test_vider_une_valeur(
    deux_espaces: SpaceStore, migre: Engine, declaration: Declaration, valeur: Any
) -> None:
    magasin = deux_espaces
    magasin.declare("a", "p", declaration, ACTEUR, plus(1))
    magasin.set_value("a", "p", PROD, valeur, ACTEUR, plus(2))
    garde = magasin.set_value("a", "p", DEV, valeur, ACTEUR, plus(2))
    magasin.clear_value("a", "p", PROD, AUTRE_ACTEUR, plus(3))
    assert magasin.configuration("a").values == (garde,)
    action, detail, acteur, instant = dernier(magasin)
    assert (action, detail, acteur, instant) == (
        "value_cleared",
        {"name": "p", "environment": "PROD", "before": valeur},
        AUTRE_ACTEUR,
        plus(3),
    )
    assert type(detail["before"]) is type(valeur)
    # Vider une valeur absente : rien n'est écrit ni journalisé.
    avant = contenu(migre)
    magasin.clear_value("a", "p", PROD, ACTEUR, plus(4))
    magasin.clear_value("a", "p", TEST, ACTEUR, plus(4))
    assert contenu(migre) == avant


def test_vider_dans_un_parametre_sans_aucune_valeur(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    magasin.declare("a", "p", booleen(), ACTEUR, plus(1))
    evenements = magasin.events("a")
    for environnement in ENVIRONMENTS:
        magasin.clear_value("a", "p", environnement, ACTEUR, plus(2))
    assert magasin.events("a") == evenements


# --- Journal complet (P7) -------------------------------------------------------------------


def test_journal_complet(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    magasin.declare("a", "region", choix("eu", "us"), ACTEUR, plus(1))
    magasin.set_value("a", "region", DEV, "eu", ACTEUR, plus(3))
    magasin.set_value("a", "region", DEV, "eu", ACTEUR, plus(4))  # inchangée
    magasin.set_value("a", "region", DEV, "us", ACTEUR, plus(5))
    magasin.redeclare("a", "region", choix("eu", "us"), ACTEUR, plus(6))  # inchangée
    magasin.redeclare("a", "region", choix("eu", "us", required=True), ACTEUR, plus(7))
    magasin.clear_value("a", "region", TEST, ACTEUR, plus(8))  # absente
    magasin.clear_value("a", "region", DEV, ACTEUR, plus(9))
    magasin.set_value("a", "region", PROD, "eu", ACTEUR, plus(10))
    magasin.remove_parameter("a", "region", ACTEUR, plus(11))
    choix_json = {"choices": ["eu", "us"]}
    facultatif = {
        "type": "choice",
        "constraints": choix_json,
        "required": False,
        "default": None,
        "description": "",
    }
    obligatoire = {**facultatif, "required": True}
    evenements = magasin.events("a")
    assert resume(evenements)[:7] == [
        (
            "parameter_removed",
            {"name": "region", "declaration": obligatoire, "values": {"PROD": "eu"}},
        ),
        ("value_set", {"name": "region", "environment": "PROD", "before": None, "after": "eu"}),
        ("value_cleared", {"name": "region", "environment": "DEV", "before": "us"}),
        ("parameter_changed", {"name": "region", "before": facultatif, "after": obligatoire}),
        ("value_set", {"name": "region", "environment": "DEV", "before": "eu", "after": "us"}),
        ("value_set", {"name": "region", "environment": "DEV", "before": None, "after": "eu"}),
        ("parameter_declared", {"name": "region", "declaration": facultatif}),
    ]
    assert [e.at for e in evenements[:7]] == [
        plus(11),
        plus(10),
        plus(9),
        plus(7),
        plus(5),
        plus(3),
        plus(1),
    ]
    assert [e.action for e in evenements[7:]] == ["binding_added", "space_created"]
    assert [e.action for e in magasin.events("b")] == ["binding_added", "space_created"]


# --- Lecture fail-closed et instants --------------------------------------------------------


def test_declaration_invalide_en_base_jamais_montree(
    deux_espaces: SpaceStore, migre: Engine
) -> None:
    # Une ligne écrite hors de Board avec un type inconnu : la lecture refuse plutôt que de
    # montrer une déclaration que le modèle ne sait pas valider.
    with migre.begin() as connexion:
        connexion.execute(
            insert(deploy_parameters).values(
                space_id="a",
                name="p",
                type="secret",
                constraints={},
                required=False,
                default_value=None,
                description="",
                created_at=INSTANT,
                created_by_issuer=EMETTEUR,
                created_by_subject="x",
                updated_at=INSTANT,
                updated_by_issuer=EMETTEUR,
                updated_by_subject="x",
            )
        )
    with pytest.raises(InvalidParameter) as refus:
        deux_espaces.configuration("a")
    assert refus.value.field == "type"
    assert deux_espaces.configuration("b").parameters == ()


def test_instants_relus_en_utc(moteur_hors_utc: Engine) -> None:
    magasin = SpaceStore(moteur_hors_utc)
    magasin.create_space("a", "A", ATLAS, groupe("admins"), ACTEUR, INSTANT)
    magasin.declare("a", "p", entier(), ACTEUR, INSTANT)
    magasin.declare("a", "q", entier(), ACTEUR, INSTANT)
    magasin.redeclare("a", "q", entier(default=1), ACTEUR, INSTANT)
    magasin.set_value("a", "p", DEV, 1, ACTEUR, INSTANT)
    rendu = magasin.set_value("a", "p", DEV, 1, ACTEUR, plus(1))
    configuration = magasin.configuration("a")
    lus = [
        rendu.set_at,
        *(p.created_at for p in configuration.parameters),
        *(p.updated_at for p in configuration.parameters),
        *(v.set_at for v in configuration.values),
    ]
    assert len(lus) == 6
    for instant in lus:
        assert instant == INSTANT
        assert utc(instant), instant


def test_auteurs_relus(deux_espaces: SpaceStore) -> None:
    magasin = deux_espaces
    magasin.declare("a", "p", entier(), ACTEUR, plus(1))
    magasin.redeclare("a", "p", entier(default=2), AUTRE_ACTEUR, plus(2))
    magasin.set_value("a", "p", TEST, 3, AUTRE_ACTEUR, plus(3))
    configuration = magasin.configuration("a")
    [parametre] = configuration.parameters
    assert (parametre.created_by, parametre.created_at) == (ACTEUR, plus(1))
    assert (parametre.updated_by, parametre.updated_at) == (AUTRE_ACTEUR, plus(2))
    assert configuration.values == (ParameterValue("a", "p", TEST, 3, plus(3), AUTRE_ACTEUR),)
    assert [e.actor for e in magasin.events("a")[:3]] == [AUTRE_ACTEUR, AUTRE_ACTEUR, ACTEUR]
