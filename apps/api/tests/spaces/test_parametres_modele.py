"""Modèle pur des paramètres de déploiement : types, contraintes, déclaration, résolution et
compatibilité (plan 10, P2 à P5, P8).

Chaque refus nomme le champ en cause (`InvalidParameter.field`), jamais la valeur refusée. Une
valeur « fausse » (`0`, `False`) est une valeur : elle n'est jamais prise pour une absence.
"""

from __future__ import annotations

import itertools
from typing import Any

import pytest
from hypothesis import given
from hypothesis import strategies as st
from identity.conftest import INSTANT
from skifer_board.spaces import (
    PARAMETERS_LIMIT,
    Configuration,
    Constraints,
    Declaration,
    InvalidParameter,
    Parameter,
    ParameterExists,
    ParameterLimit,
    ParameterNotFound,
    ParameterType,
    ParameterValue,
    Resolved,
    SpaceError,
    State,
    Value,
    ValuesIncompatible,
    check_name,
)
from skifer_board.spaces.model import ENVIRONMENTS, Environment
from skifer_board.spaces.parameters import (
    CHOICE_MAX,
    CHOICES_MAX,
    DESCRIPTION_MAX,
    SAFE_INTEGER,
    TEXT_MAX,
    constraints_json,
    parse_constraints,
    same_value,
    values_by_environment,
)

from .conftest import ACTEUR

DEV, TEST, PROD = ENVIRONMENTS
MAX = 2**53 - 1


def declarer(
    type_: object,
    contraintes: object,
    obligatoire: object = False,
    defaut: object = None,
    description: object = "",
) -> Declaration:
    return Declaration.parse(type_, contraintes, obligatoire, defaut, description)


def refus(
    champ: str,
    type_: object,
    contraintes: object,
    obligatoire: object = False,
    defaut: object = None,
    description: object = "",
) -> None:
    with pytest.raises(InvalidParameter) as erreur:
        declarer(type_, contraintes, obligatoire, defaut, description)
    assert erreur.value.field == champ


def texte(longueur: int = 10, **reste: Any) -> Declaration:
    return declarer("text", {"max_length": longueur}, **_cles(reste))


def entier(minimum: int | None = None, maximum: int | None = None, **reste: Any) -> Declaration:
    contraintes: dict[str, int] = {}
    if minimum is not None:
        contraintes["minimum"] = minimum
    if maximum is not None:
        contraintes["maximum"] = maximum
    return declarer("integer", contraintes, **_cles(reste))


def booleen(**reste: Any) -> Declaration:
    return declarer("boolean", {}, **_cles(reste))


def choix(*valeurs: str, **reste: Any) -> Declaration:
    return declarer("choice", {"choices": list(valeurs)}, **_cles(reste))


def identifiant(**reste: Any) -> Declaration:
    return declarer("identifier", {}, **_cles(reste))


def _cles(reste: dict[str, Any]) -> dict[str, Any]:
    traduction = {"required": "obligatoire", "default": "defaut", "description": "description"}
    return {traduction[cle]: valeur for cle, valeur in reste.items()}


def refuse_valeur(declaration: Declaration, valeur: object) -> None:
    assert not declaration.accepts(valeur)
    with pytest.raises(InvalidParameter) as erreur:
        declaration.check(valeur)
    assert erreur.value.field == "value"


def accepte(declaration: Declaration, valeur: Value) -> None:
    assert declaration.accepts(valeur)
    rendue = declaration.check(valeur)
    assert rendue == valeur and type(rendue) is type(valeur)


# --- Bornes fixées par le plan --------------------------------------------------------------


def test_bornes_du_plan() -> None:
    assert (TEXT_MAX, SAFE_INTEGER, CHOICES_MAX, CHOICE_MAX) == (1024, MAX, 50, 128)
    assert (DESCRIPTION_MAX, PARAMETERS_LIMIT) == (200, 100)
    assert [t.value for t in ParameterType] == [
        "text",
        "integer",
        "boolean",
        "choice",
        "identifier",
    ]
    assert [s.value for s in State] == ["value", "default", "missing", "absent"]


# --- Type et clés de contraintes ------------------------------------------------------------


@pytest.mark.parametrize(
    "type_", ["TEXT", "Text", "string", "secret", "connection", "", " text", None, 1, ["text"]]
)
def test_type_hors_des_cinq_refuse(type_: object) -> None:
    refus("type", type_, {})


@pytest.mark.parametrize(
    ("type_", "contraintes"),
    [
        ("text", {"max_length": 10, "minimum": 1}),
        ("text", {"max_length": 10, "pattern": ".*"}),
        ("integer", {"max_length": 10}),
        ("integer", {"minimum": 1, "choices": ["a"]}),
        ("boolean", {"max_length": 1}),
        ("boolean", {"default": True}),
        ("choice", {"choices": ["a"], "max_length": 3}),
        ("identifier", {"max_length": 10}),
        ("identifier", {"pattern": "[a-z]+"}),
    ],
)
def test_cle_de_contrainte_inconnue_refusee(type_: str, contraintes: dict[str, object]) -> None:
    refus("constraints", type_, contraintes)


@pytest.mark.parametrize("type_", [t.value for t in ParameterType])
@pytest.mark.parametrize("contraintes", [None, [], "max_length", 10, ("max_length",)])
def test_contraintes_qui_ne_sont_pas_un_objet(type_: str, contraintes: object) -> None:
    refus("constraints", type_, contraintes)


@pytest.mark.parametrize(
    ("type_", "champ"),
    [("text", "constraints.max_length"), ("choice", "constraints.choices")],
)
def test_contrainte_obligatoire_manquante(type_: str, champ: str) -> None:
    refus(champ, type_, {})


def test_contraintes_vides_permises_aux_types_sans_contrainte() -> None:
    for declaration in (booleen(), identifiant(), entier()):
        assert declaration.constraints == Constraints()


# --- text (P2) ------------------------------------------------------------------------------


@pytest.mark.parametrize("longueur", [1, 2, 1023, 1024])
def test_texte_longueur_maximale_permise(longueur: int) -> None:
    declaration = texte(longueur)
    assert declaration.type is ParameterType.TEXT
    assert declaration.constraints == Constraints(max_length=longueur)


@pytest.mark.parametrize("longueur", [0, -1, 1025, 10**9, True, False, 10.0, "10", None, [10]])
def test_texte_longueur_maximale_refusee(longueur: object) -> None:
    refus("constraints.max_length", "text", {"max_length": longueur})


def test_texte_a_ses_bornes() -> None:
    court = texte(1)
    accepte(court, "a")
    refuse_valeur(court, "ab")
    refuse_valeur(court, "")
    long = texte(1024)
    accepte(long, "x" * 1024)
    accepte(long, "é" * 1024)
    refuse_valeur(long, "x" * 1025)
    refuse_valeur(long, "")
    moyen = texte(5)
    accepte(moyen, "abcde")
    refuse_valeur(moyen, "abcdef")


@pytest.mark.parametrize("valeur", [1, 0, True, False, None, 1.5, ["a"], {"a": 1}, b"abc"])
def test_texte_refuse_ce_qui_n_est_pas_du_texte(valeur: object) -> None:
    refuse_valeur(texte(10), valeur)


@pytest.mark.parametrize(
    "valeur",
    ["a\nb", "a\rb", "\t", "a\x00", "\x1f", "\x7f", "a\x85", "\ud800", "a\udfff", "\udc00\udbff"],
    ids=repr,
)
def test_texte_sans_caractere_de_controle_ni_demi_paire(valeur: str) -> None:
    refuse_valeur(texte(10), valeur)


@pytest.mark.parametrize("valeur", ["é", "日本", "\U0001f600", "a b", "' OR 1=1 --", "${x}"])
def test_texte_libre_accepte_tel_quel(valeur: str) -> None:
    # Une valeur est une donnée, jamais un fragment de requête : rien n'est interprété.
    accepte(texte(20), valeur)


# --- integer (P2) ---------------------------------------------------------------------------


@pytest.mark.parametrize("valeur", [0, 1, -1, MAX, -MAX, 2**31, -(2**31)])
def test_entier_sans_bornes_accepte(valeur: int) -> None:
    accepte(entier(), valeur)


@pytest.mark.parametrize("valeur", [MAX + 1, -MAX - 1, 2**64, -(2**64)])
def test_entier_hors_de_la_zone_exacte_refuse(valeur: int) -> None:
    refuse_valeur(entier(), valeur)
    refuse_valeur(entier(-MAX, MAX), valeur)


@pytest.mark.parametrize("valeur", [True, False, 1.0, 0.0, 1.5, float("nan"), "1", None, [1]])
def test_entier_refuse_booleen_flottant_et_texte(valeur: object) -> None:
    refuse_valeur(entier(), valeur)


def test_entier_bornes_incluses() -> None:
    declaration = entier(0, 10)
    for valeur in (0, 5, 10):
        accepte(declaration, valeur)
    for valeur in (-1, 11):
        refuse_valeur(declaration, valeur)
    seul_minimum = entier(minimum=-5)
    accepte(seul_minimum, -5)
    accepte(seul_minimum, MAX)
    refuse_valeur(seul_minimum, -6)
    seul_maximum = entier(maximum=-5)
    accepte(seul_maximum, -MAX)
    accepte(seul_maximum, -5)
    refuse_valeur(seul_maximum, -4)
    egales = entier(7, 7)
    accepte(egales, 7)
    refuse_valeur(egales, 6)
    refuse_valeur(egales, 8)


@pytest.mark.parametrize("borne", [MAX, -MAX, 0])
@pytest.mark.parametrize("cle", ["minimum", "maximum"])
def test_entier_borne_permise(cle: str, borne: int) -> None:
    declaration = declarer("integer", {cle: borne})
    assert getattr(declaration.constraints, cle) == borne


@pytest.mark.parametrize("borne", [MAX + 1, -MAX - 1, True, False, 1.0, "1", [1], {"v": 1}])
@pytest.mark.parametrize("cle", ["minimum", "maximum"])
def test_entier_borne_refusee(cle: str, borne: object) -> None:
    refus(f"constraints.{cle}", "integer", {cle: borne})


def test_entier_bornes_nulles_valent_absence() -> None:
    # Les contraintes relues de la base portent `null` pour une borne absente.
    declaration = declarer("integer", {"minimum": None, "maximum": None})
    assert declaration.constraints == Constraints()
    assert declaration == entier()


@pytest.mark.parametrize(("minimum", "maximum"), [(1, 0), (MAX, -MAX), (0, -1), (-1, -2)])
def test_entier_minimum_au_dessus_du_maximum(minimum: int, maximum: int) -> None:
    refus("constraints.maximum", "integer", {"minimum": minimum, "maximum": maximum})


@given(st.integers(min_value=-MAX, max_value=MAX))
def test_entier_tout_entier_exact_accepte(valeur: int) -> None:
    assert entier().accepts(valeur)


@given(st.one_of(st.integers(min_value=MAX + 1), st.integers(max_value=-MAX - 1)))
def test_entier_tout_entier_inexact_refuse(valeur: int) -> None:
    assert not entier().accepts(valeur)


# --- boolean (P2) ---------------------------------------------------------------------------


def test_booleen() -> None:
    declaration = booleen()
    accepte(declaration, True)
    accepte(declaration, False)


@pytest.mark.parametrize("valeur", [0, 1, -1, "true", "false", "", None, 0.0, [True]])
def test_booleen_refuse_entier_et_texte(valeur: object) -> None:
    refuse_valeur(booleen(), valeur)


# --- choice (P2) ----------------------------------------------------------------------------


def test_choix_a_ses_bornes() -> None:
    un = choix("a")
    assert un.constraints == Constraints(choices=("a",))
    accepte(un, "a")
    cinquante = [f"v{i}" for i in range(50)]
    declaration = choix(*cinquante)
    assert declaration.constraints.choices == tuple(cinquante)
    accepte(declaration, "v49")
    long = choix("x" * 128, "é" * 128)
    accepte(long, "x" * 128)
    accepte(long, "é" * 128)


@pytest.mark.parametrize(
    "valeurs",
    [
        [],
        [f"v{i}" for i in range(51)],
        ["a", "a"],
        ["a", "b", "a"],
        ["x" * 129],
        ["a", "x" * 129],
        [""],
        ["a", ""],
        [1],
        ["1", 1],
        [True],
        [None],
        [["a"]],
        ["a\n"],
        ["\x00"],
        ["\ud800"],
        "abc",
        ("a", "b"),
        {"a": 1},
        None,
        1,
    ],
    ids=repr,
)
def test_choix_refuses(valeurs: object) -> None:
    refus("constraints.choices", "choice", {"choices": valeurs})


def test_choix_valeur_exacte_seulement() -> None:
    declaration = choix("eu-west", "eu-central")
    accepte(declaration, "eu-west")
    for valeur in ("EU-WEST", "eu-west ", "eu", "", 1, True, None, ["eu-west"]):
        refuse_valeur(declaration, valeur)


def test_choix_numeriques_restent_du_texte() -> None:
    declaration = choix("1", "2")
    accepte(declaration, "1")
    refuse_valeur(declaration, 1)


# --- identifier (P2) ------------------------------------------------------------------------


@pytest.mark.parametrize(
    "valeur",
    ["a", "A", "_", "_1", "z9", "Catalogue_2026", "a" * 128, "_" * 128, "Z" + "9" * 127],
)
def test_identifiant_accepte(valeur: str) -> None:
    accepte(identifiant(), valeur)


@pytest.mark.parametrize(
    "valeur",
    [
        "",
        "1a",
        "9",
        "a" * 129,
        "é",
        "aé",
        "ａ",
        "a٣",
        "a-b",
        "a b",
        "a.b",
        "a;",
        "a\n",
        "\na",
        "a\r\n",
        "a\x00",
        "a\ud800",
        " a",
        "a ",
        "ß",
        "\u212a",  # signe Kelvin, que l'insensibilité à la casse rapprocherait de « K »
    ],
    ids=repr,
)
def test_identifiant_refuse(valeur: str) -> None:
    refuse_valeur(identifiant(), valeur)


@pytest.mark.parametrize("valeur", [1, True, None, ["a"]])
def test_identifiant_refuse_ce_qui_n_est_pas_du_texte(valeur: object) -> None:
    refuse_valeur(identifiant(), valeur)


# --- Déclaration (P3) -----------------------------------------------------------------------


@pytest.mark.parametrize("obligatoire", [1, 0, "true", None, "oui"])
def test_obligatoire_doit_etre_un_booleen(obligatoire: object) -> None:
    refus("required", "boolean", {}, obligatoire)


@pytest.mark.parametrize(
    ("type_", "contraintes", "defaut"),
    [
        ("text", {"max_length": 3}, "abcd"),
        ("text", {"max_length": 3}, ""),
        ("text", {"max_length": 3}, 1),
        ("text", {"max_length": 3}, "a\n"),
        ("integer", {"minimum": 0, "maximum": 10}, 11),
        ("integer", {"minimum": 0, "maximum": 10}, -1),
        ("integer", {}, MAX + 1),
        ("integer", {}, True),
        ("integer", {}, 1.0),
        ("boolean", {}, 0),
        ("boolean", {}, "false"),
        ("choice", {"choices": ["a", "b"]}, "c"),
        ("choice", {"choices": ["a", "b"]}, "A"),
        ("identifier", {}, "1a"),
        ("identifier", {}, "a" * 129),
    ],
    ids=repr,
)
def test_defaut_hors_contraintes_refuse(type_: str, contraintes: object, defaut: object) -> None:
    refus("default", type_, contraintes, False, defaut)


@pytest.mark.parametrize(
    ("type_", "contraintes", "defaut"),
    [
        ("text", {"max_length": 3}, "abc"),
        ("integer", {"minimum": 0}, 0),
        ("integer", {}, -MAX),
        ("boolean", {}, False),
        ("boolean", {}, True),
        ("choice", {"choices": ["a", "b"]}, "b"),
        ("identifier", {}, "_x"),
    ],
)
def test_defaut_permis_garde_son_type(type_: str, contraintes: object, defaut: Value) -> None:
    for obligatoire in (True, False):
        declaration = declarer(type_, contraintes, obligatoire, defaut)
        assert declaration.default == defaut
        assert type(declaration.default) is type(defaut)
        assert declaration.required is obligatoire


@pytest.mark.parametrize("description", ["", "x", "x" * 200, "é" * 200, "Région « EU »"])
def test_description_permise(description: str) -> None:
    assert booleen(description=description).description == description


@pytest.mark.parametrize(
    "description", ["x" * 201, "a\nb", "\t", "a\x00", "\ud800", None, 1, ["x"]], ids=repr
)
def test_description_refusee(description: object) -> None:
    refus("description", "boolean", {}, False, None, description)


def test_premier_champ_en_cause() -> None:
    # Ordre des contrôles : type, contraintes, obligatoire, défaut, description.
    refus("type", "secret", None, "x", 1, None)
    refus("constraints", "text", None, "x", 1, None)
    refus("constraints.max_length", "text", {"max_length": 0}, "x", 1, None)
    refus("required", "text", {"max_length": 3}, "x", 1, None)
    refus("default", "text", {"max_length": 3}, True, 1, None)
    refus("description", "text", {"max_length": 3}, True, "a", None)


@pytest.mark.parametrize(
    "nom", ["a", "z", "a1", "a_b", "abc_123", "a" * 63, "a" + "_" * 62, "a" + "9" * 62]
)
def test_nom_permis(nom: str) -> None:
    assert check_name(nom) == nom


@pytest.mark.parametrize(
    "nom",
    [
        "",
        "a" * 64,
        "A",
        "aB",
        "1a",
        "_a",
        "a-b",
        "a.b",
        "a b",
        "é",
        "aé",
        "a\n",
        "\na",
        "a\x00",
        "ａ",
        None,
        1,
        ["a"],
    ],
    ids=repr,
)
def test_nom_refuse(nom: object) -> None:
    with pytest.raises(InvalidParameter) as erreur:
        check_name(nom)
    assert erreur.value.field == "name"


def test_refus_ne_montre_jamais_la_valeur() -> None:
    secret = "mot-de-passe-tres-secret"
    with pytest.raises(InvalidParameter) as erreur:
        texte(3).check(secret)
    assert str(erreur.value) == "value"
    assert secret not in repr(erreur.value)
    with pytest.raises(InvalidParameter) as erreur:
        declarer("text", {"max_length": 3}, False, secret)
    assert str(erreur.value) == "default" and secret not in repr(erreur.value)
    assert issubclass(InvalidParameter, ValueError)
    assert not issubclass(InvalidParameter, SpaceError)


# --- Forme JSON et égalité ------------------------------------------------------------------


@pytest.mark.parametrize(
    ("declaration", "attendu"),
    [
        (
            texte(12, required=True, default="abc", description="Région"),
            {
                "type": "text",
                "constraints": {"max_length": 12},
                "required": True,
                "default": "abc",
                "description": "Région",
            },
        ),
        (
            entier(minimum=0),
            {
                "type": "integer",
                "constraints": {"minimum": 0, "maximum": None},
                "required": False,
                "default": None,
                "description": "",
            },
        ),
        (
            booleen(default=False),
            {
                "type": "boolean",
                "constraints": {},
                "required": False,
                "default": False,
                "description": "",
            },
        ),
        (
            choix("b", "a", required=True),
            {
                "type": "choice",
                "constraints": {"choices": ["b", "a"]},
                "required": True,
                "default": None,
                "description": "",
            },
        ),
        (
            identifiant(default="cat"),
            {
                "type": "identifier",
                "constraints": {},
                "required": False,
                "default": "cat",
                "description": "",
            },
        ),
    ],
    ids=lambda v: v.type.value if isinstance(v, Declaration) else "",
)
def test_forme_json_et_relecture(declaration: Declaration, attendu: dict[str, object]) -> None:
    assert declaration.to_json() == attendu
    assert constraints_json(declaration.type, declaration.constraints) == attendu["constraints"]
    relue = declarer(
        attendu["type"],
        attendu["constraints"],
        attendu["required"],
        attendu["default"],
        attendu["description"],
    )
    assert relue == declaration and relue.same_as(declaration)
    assert parse_constraints(declaration.type, attendu["constraints"]) == declaration.constraints


def test_valeurs_egales_par_type() -> None:
    assert same_value(None, None)
    assert same_value(True, True) and same_value(0, 0) and same_value("a", "a")
    assert not same_value(True, 1)
    assert not same_value(1, True)
    assert not same_value(False, 0)
    assert not same_value(0, False)
    assert not same_value(0, None) and not same_value(None, 0)
    assert not same_value(False, None)
    assert not same_value("", None)
    assert not same_value("1", 1)
    assert not same_value(1, 2)


def test_meme_declaration() -> None:
    base = texte(10, default="a")
    assert base.same_as(texte(10, default="a"))
    for autre in (
        texte(11, default="a"),
        texte(10, default="b"),
        texte(10),
        texte(10, default="a", required=True),
        texte(10, default="a", description="d"),
        identifiant(default="a"),
    ):
        assert not base.same_as(autre)
    assert not choix("a", "b").same_as(choix("b", "a"))
    assert not entier(0, 10).same_as(entier(0, 11))
    assert not entier(minimum=0).same_as(entier())
    assert not booleen(default=False).same_as(booleen())
    assert not booleen().same_as(identifiant())


# --- Résolution par environnement (P4) ------------------------------------------------------


@pytest.mark.parametrize(
    ("propre", "defaut", "obligatoire", "attendu"),
    [
        (5, 3, True, Resolved(State.VALUE, 5)),
        (5, 3, False, Resolved(State.VALUE, 5)),
        (5, None, True, Resolved(State.VALUE, 5)),
        (5, None, False, Resolved(State.VALUE, 5)),
        (None, 3, True, Resolved(State.DEFAULT, 3)),
        (None, 3, False, Resolved(State.DEFAULT, 3)),
        (None, None, True, Resolved(State.MISSING, None)),
        (None, None, False, Resolved(State.ABSENT, None)),
        # Valeurs « fausses » : des valeurs, jamais des absences.
        (0, 3, True, Resolved(State.VALUE, 0)),
        (0, None, True, Resolved(State.VALUE, 0)),
        (None, 0, True, Resolved(State.DEFAULT, 0)),
        (None, 0, False, Resolved(State.DEFAULT, 0)),
        (0, 0, False, Resolved(State.VALUE, 0)),
    ],
)
def test_resolution_entier(
    propre: int | None, defaut: int | None, obligatoire: bool, attendu: Resolved
) -> None:
    declaration = entier(required=obligatoire, default=defaut)
    rendu = declaration.resolve(propre)
    assert rendu == attendu
    assert type(rendu.value) is type(attendu.value)


@pytest.mark.parametrize(
    ("propre", "defaut", "obligatoire", "attendu"),
    [
        (False, True, True, Resolved(State.VALUE, False)),
        (False, None, True, Resolved(State.VALUE, False)),
        (None, False, True, Resolved(State.DEFAULT, False)),
        (None, False, False, Resolved(State.DEFAULT, False)),
        (True, False, False, Resolved(State.VALUE, True)),
        (None, None, True, Resolved(State.MISSING, None)),
        (None, None, False, Resolved(State.ABSENT, None)),
    ],
)
def test_resolution_booleen(
    propre: bool | None, defaut: bool | None, obligatoire: bool, attendu: Resolved
) -> None:
    rendu = booleen(required=obligatoire, default=defaut).resolve(propre)
    assert rendu == attendu
    assert type(rendu.value) is type(attendu.value)


def parametre(nom: str, declaration: Declaration, espace: str = "a") -> Parameter:
    return Parameter(espace, nom, declaration, INSTANT, ACTEUR, INSTANT, ACTEUR)


def valeur(
    nom: str, environnement: Environment, donnee: Value, espace: str = "a"
) -> ParameterValue:
    return ParameterValue(espace, nom, environnement, donnee, INSTANT, ACTEUR)


def test_configuration_resolue_et_completude() -> None:
    region = parametre("region", choix("eu", "us", required=True))
    lignes = parametre("lignes", entier(0, 100, required=True, default=0))
    actif = parametre("actif", booleen(required=True))
    note = parametre("note", texte(20))
    configuration = Configuration(
        (actif, lignes, note, region),
        (
            valeur("actif", DEV, False),
            valeur("region", DEV, "eu"),
            valeur("lignes", TEST, 50),
            valeur("note", PROD, "prod"),
            valeur("region", PROD, "us"),
            valeur("actif", PROD, True),
        ),
    )
    assert configuration.resolved(DEV) == (
        (actif, Resolved(State.VALUE, False)),
        (lignes, Resolved(State.DEFAULT, 0)),
        (note, Resolved(State.ABSENT, None)),
        (region, Resolved(State.VALUE, "eu")),
    )
    assert configuration.resolved(TEST) == (
        (actif, Resolved(State.MISSING, None)),
        (lignes, Resolved(State.VALUE, 50)),
        (note, Resolved(State.ABSENT, None)),
        (region, Resolved(State.MISSING, None)),
    )
    assert configuration.resolved(PROD) == (
        (actif, Resolved(State.VALUE, True)),
        (lignes, Resolved(State.DEFAULT, 0)),
        (note, Resolved(State.VALUE, "prod")),
        (region, Resolved(State.VALUE, "us")),
    )
    # `False` en DEV est une valeur : DEV est complet ; TEST manque deux paramètres, dans
    # l'ordre des déclarations.
    assert configuration.missing(DEV) == ()
    assert configuration.missing(TEST) == ("actif", "region")
    assert configuration.missing(PROD) == ()
    assert [configuration.complete(e) for e in ENVIRONMENTS] == [True, False, True]
    assert configuration.own("region", PROD) == valeur("region", PROD, "us")
    assert configuration.own("region", TEST) is None
    assert configuration.own("inconnu", DEV) is None


def test_configuration_vide_complete() -> None:
    vide = Configuration((), ())
    for environnement in ENVIRONMENTS:
        assert vide.resolved(environnement) == ()
        assert vide.missing(environnement) == ()
        assert vide.complete(environnement)


def test_facultatif_sans_valeur_ne_rend_pas_incomplet() -> None:
    configuration = Configuration((parametre("note", texte(5)),), ())
    assert all(configuration.complete(e) for e in ENVIRONMENTS)


def test_valeur_propre_d_un_autre_parametre_ignoree() -> None:
    configuration = Configuration(
        (parametre("a", entier(required=True)), parametre("b", entier(required=True))),
        (valeur("b", DEV, 0),),
    )
    assert configuration.missing(DEV) == ("a",)


def test_valeurs_par_environnement() -> None:
    assert values_by_environment([]) == {}
    trouvees = values_by_environment(
        [valeur("x", PROD, 0), valeur("x", DEV, False), valeur("x", TEST, "t")]
    )
    assert trouvees == {PROD: 0, DEV: False, TEST: "t"}
    assert type(trouvees[DEV]) is bool and type(trouvees[PROD]) is int


# --- Compatibilité avec les valeurs existantes (P5) -----------------------------------------


def test_compatibilite_bornes_dans_l_ordre_de_promotion() -> None:
    # Valeurs données dans le désordre : les environnements en cause sortent DEV, TEST, PROD.
    valeurs: dict[Environment, Value] = {PROD: 10, TEST: 8, DEV: 3}
    assert entier(0, 10).incompatible(valeurs) == ()
    assert entier(0, 5).incompatible(valeurs) == (TEST, PROD)
    assert entier(4, 9).incompatible(valeurs) == (DEV, PROD)
    assert entier(11, 20).incompatible(valeurs) == (DEV, TEST, PROD)
    assert entier(minimum=0).incompatible(valeurs) == ()
    assert entier(maximum=0).incompatible({DEV: 0}) == ()
    assert entier(minimum=1).incompatible({DEV: 0}) == (DEV,)


def test_compatibilite_changement_de_type() -> None:
    valeurs: dict[Environment, Value] = {DEV: 1, TEST: True, PROD: "abc"}
    assert texte(10).incompatible(valeurs) == (DEV, TEST)
    assert entier().incompatible(valeurs) == (TEST, PROD)
    assert booleen().incompatible(valeurs) == (DEV, PROD)
    assert identifiant().incompatible(valeurs) == (DEV, TEST)
    assert choix("abc").incompatible(valeurs) == (DEV, TEST)
    # `0` n'est pas `False`, `1` n'est pas `True`.
    assert booleen().incompatible({DEV: 0, PROD: 1}) == (DEV, PROD)
    assert entier().incompatible({TEST: False}) == (TEST,)


def test_compatibilite_choix_et_longueur() -> None:
    valeurs: dict[Environment, Value] = {DEV: "eu", PROD: "us"}
    assert choix("eu", "us", "ap").incompatible(valeurs) == ()
    assert choix("eu").incompatible(valeurs) == (PROD,)
    assert choix("EU", "US").incompatible(valeurs) == (DEV, PROD)
    longs: dict[Environment, Value] = {DEV: "abc", TEST: "abcdef"}
    assert texte(6).incompatible(longs) == ()
    assert texte(5).incompatible(longs) == (TEST,)
    assert texte(2).incompatible(longs) == (DEV, TEST)


def test_compatibilite_defaut_et_obligatoire_sans_effet_sur_les_valeurs() -> None:
    valeurs: dict[Environment, Value] = {DEV: 3, PROD: 7}
    assert entier(0, 10, default=0).incompatible(valeurs) == ()
    assert entier(0, 10, required=True).incompatible(valeurs) == ()
    assert entier(0, 10, required=True).incompatible({}) == ()
    assert entier(0, 10, required=True, default=10, description="x").incompatible(valeurs) == ()


@given(
    st.dictionaries(
        st.sampled_from(ENVIRONMENTS),
        st.one_of(st.integers(-20, 20), st.booleans(), st.text(max_size=3)),
    ),
    st.integers(-10, 10),
    st.integers(0, 10),
)
def test_compatibilite_concorde_avec_l_acceptation(
    valeurs: dict[Environment, Value], minimum: int, etendue: int
) -> None:
    declaration = entier(minimum, minimum + etendue)
    attendu = tuple(e for e in ENVIRONMENTS if e in valeurs and not declaration.accepts(valeurs[e]))
    assert declaration.incompatible(valeurs) == attendu
    assert list(attendu) == sorted(attendu, key=lambda e: e.rank)


# --- Refus à codes fermés (P8) --------------------------------------------------------------


def test_codes_fermes() -> None:
    for classe, code in (
        (ParameterNotFound, "parameter_not_found"),
        (ParameterExists, "parameter_exists"),
        (ParameterLimit, "parameter_limit"),
        (ValuesIncompatible, "values_incompatible"),
    ):
        assert issubclass(classe, SpaceError)
        assert classe.code == code
    refus_ = ValuesIncompatible((DEV, PROD))
    assert refus_.environments == (DEV, PROD)
    assert refus_.code == "values_incompatible"
    assert str(refus_) == "DEV, PROD"


def test_combinaisons_completes_de_resolution() -> None:
    # Toutes les combinaisons (valeur propre, défaut, obligatoire) pour chaque type.
    exemples: list[tuple[Declaration, Value, Value]] = [
        (texte(5), "x", "d"),
        (entier(), 0, 1),
        (booleen(), False, True),
        (choix("a", "b"), "a", "b"),
        (identifiant(), "x", "_d"),
    ]
    for (base, propre, defaut), avec_propre, avec_defaut, obligatoire in itertools.product(
        exemples, (True, False), (True, False), (True, False)
    ):
        declaration = declarer(
            base.type.value,
            constraints_json(base.type, base.constraints),
            obligatoire,
            defaut if avec_defaut else None,
        )
        rendu = declaration.resolve(propre if avec_propre else None)
        if avec_propre:
            attendu = Resolved(State.VALUE, propre)
        elif avec_defaut:
            attendu = Resolved(State.DEFAULT, defaut)
        else:
            attendu = Resolved(State.MISSING if obligatoire else State.ABSENT, None)
        assert rendu == attendu and type(rendu.value) is type(attendu.value)
