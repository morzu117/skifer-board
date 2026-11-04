"""Corps, valeurs et déclarations refusés par les routes des paramètres (plan 10, 10.2 ; P2,
P3, P5, P8, P9).

Chaque refus donne `400 invalid_request` avec le champ en cause, jamais la valeur reçue, et
n'écrit rien. Une déclaration qui rendrait invalide une valeur existante est refusée
(`409 values_incompatible`) avec les environnements en cause, toujours dans l'ordre DEV, TEST,
PROD. En mode local, toute route des paramètres répond `409 local_mode`.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import pytest
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from fastapi.testclient import TestClient
from identity.conftest import cles as cles
from identity.conftest import config as config
from identity.conftest import fournisseur as fournisseur
from identity.conftest import horloge as horloge
from skifer_board.catalog import CatalogService
from skifer_board.server import create_app
from state.conftest import migre as migre

from spaces.monde import ADMIN_GROUPE, ADMIN_PERSONNE, PLATEFORME_SEULE, A, Monde, Profil
from spaces.monde import config_plateforme as config_plateforme
from spaces.monde import monde as monde
from spaces.test_routes_ecritures import CORPS_ILLISIBLES, SENTINELLE, rembourre, sans, sans_trace
from spaces.test_routes_parametres import (
    CATALOGUE,
    DEV,
    LIGNES,
    MODE_LOCAL,
    PLATEFORME_ADMIN,
    PROD,
    REGION,
    TEST,
    declarer,
    etat,
    etats,
    incompatibles,
    invalide,
    parametres,
)
from spaces.test_routes_parametres import droits as droits

BASE = f"/api/spaces/{A}/parameters"
NOUVEAU: dict[str, Any] = {"name": "nouveau", **LIGNES}
SUR = 2**53 - 1


def quelconques(valeurs: list[object]) -> list[object]:
    """Valeurs de types mêlés, envoyées telles quelles."""
    return valeurs


def envoyer(monde: Monde, profil: Profil, methode: str, chemin: str, envoi: object) -> Any:
    """Corps envoyé tel quel s'il est en octets, sinon en JSON ASCII : un demi-code isolé y
    passe en échappement, comme un client peut l'envoyer."""
    contenu = envoi if isinstance(envoi, bytes) else json.dumps(envoi).encode()
    return monde.requete(profil, methode, chemin, contenu=contenu)


def verifier(monde: Monde, profil: Profil, methode: str, chemin: str, cas: list[Any]) -> None:
    """Chaque cas (nom, envoi, champ) donne `400 invalid_request` sur ce champ, sans trace ni
    écriture."""
    avant = etat(monde.moteur)
    ecarts = []
    for nom, envoi, champ in cas:
        reponse = envoyer(monde, profil, methode, chemin, envoi)
        if (reponse.status_code, reponse.json()) != (400, invalide(champ)):
            ecarts.append(f"{nom} : {reponse.status_code} {reponse.text}")
        sans_trace(reponse.text)
    assert ecarts == []
    assert etat(monde.moteur) == avant


# --- Déclarations invalides : chaque champ, dans l'ordre de leur contrôle. ---------------

# (nom, déclaration sans `name`, champ attendu)
DECLARATIONS_INVALIDES: list[tuple[str, dict[str, Any], str]] = [
    # Type : fermé, sans secret ni connexion.
    *[
        (f"type-{i}", {**LIGNES, "type": v}, "type")
        for i, v in enumerate(
            quelconques(
                [
                    None,
                    1,
                    True,
                    [],
                    {},
                    "",
                    "TEXT",
                    "Integer",
                    "secret",
                    "connection",
                    "regex",
                    "string",
                    "int",
                    "bool",
                    "text ",
                    SENTINELLE,
                ]
            )
        )
    ],
    # Contraintes qui ne sont pas un objet, ou qui portent une clé d'un autre type.
    *[
        (f"contraintes-{i}", {**LIGNES, "constraints": v}, "constraints")
        for i, v in enumerate(
            quelconques(
                [
                    None,
                    [],
                    "x",
                    1,
                    {"max_length": 5},
                    {"choices": ["a"]},
                    {"pattern": "a+"},
                    {SENTINELLE: 1},
                    {"minimum": 1, "regex": "x"},
                ]
            )
        )
    ],
    (
        "booleen-avec-contrainte",
        {
            "type": "boolean",
            "constraints": {"max_length": 1},
            "required": False,
            "default": None,
            "description": "",
        },
        "constraints",
    ),
    (
        "identifiant-avec-format",
        {
            "type": "identifier",
            "constraints": {"pattern": ".*"},
            "required": False,
            "default": None,
            "description": "",
        },
        "constraints",
    ),
    # Texte : longueur maximale de 1 à 1024, entière.
    *[
        (
            f"texte-longueur-{i}",
            {
                "type": "text",
                "constraints": c,
                "required": False,
                "default": None,
                "description": "",
            },
            "constraints.max_length",
        )
        for i, c in enumerate(
            quelconques(
                [
                    {},
                    {"max_length": None},
                    {"max_length": 0},
                    {"max_length": -1},
                    {"max_length": 1025},
                    {"max_length": True},
                    {"max_length": 10.0},
                    {"max_length": "10"},
                    {"max_length": [10]},
                ]
            )
        )
    ],
    # Entier : bornes entières, dans ±(2⁵³ − 1), minimum au plus égal au maximum.
    *[
        (
            f"entier-minimum-{i}",
            {**LIGNES, "default": None, "constraints": {"minimum": v}},
            "constraints.minimum",
        )
        for i, v in enumerate(
            quelconques([True, False, 1.5, 1.0, "1", [1], -SUR - 1, SUR + 1, 2**64])
        )
    ],
    *[
        (
            f"entier-maximum-{i}",
            {**LIGNES, "default": None, "constraints": {"maximum": v}},
            "constraints.maximum",
        )
        for i, v in enumerate(quelconques([True, 2.5, "9", {}, SUR + 1, -SUR - 1]))
    ],
    (
        "entier-bornes-inversees",
        {**LIGNES, "default": None, "constraints": {"minimum": 2, "maximum": 1}},
        "constraints.maximum",
    ),
    # Choix : de 1 à 50 valeurs distinctes, chacune de 1 à 128 caractères, sans contrôle.
    *[
        (
            f"choix-{i}",
            {
                "type": "choice",
                "constraints": {"choices": v},
                "required": False,
                "default": None,
                "description": "",
            },
            "constraints.choices",
        )
        for i, v in enumerate(
            quelconques(
                [
                    None,
                    "a",
                    [],
                    [f"c{i}" for i in range(51)],
                    ["a", "a"],
                    [""],
                    ["x" * 129],
                    [1],
                    [None],
                    [True],
                    [["a"]],
                    ["a\x00"],
                    ["a\nb"],
                    ["a\ud800"],
                    {},
                    {"a": 1},
                ]
            )
        )
    ],
    (
        "choix-sans-liste",
        {
            "type": "choice",
            "constraints": {},
            "required": False,
            "default": None,
            "description": "",
        },
        "constraints.choices",
    ),
    # Obligatoire : un booléen.
    *[
        (f"obligatoire-{i}", {**LIGNES, "required": v}, "required")
        for i, v in enumerate(quelconques([None, 0, 1, "true", "false", [], {}]))
    ],
    # Défaut : du type déclaré, dans ses contraintes.
    *[
        (f"defaut-entier-{i}", {**LIGNES, "default": v}, "default")
        for i, v in enumerate(quelconques([-1, 100001, True, False, 1.0, 5.5, "5000", [5000], {}]))
    ],
    *[
        (
            f"defaut-texte-{i}",
            {
                "type": "text",
                "constraints": {"max_length": 3},
                "required": False,
                "default": v,
                "description": "",
            },
            "default",
        )
        for i, v in enumerate(
            quelconques(["", "abcd", 1, True, "a\x00", "a\x1f", "\x7f", "a\ud800"])
        )
    ],
    *[
        (
            f"defaut-booleen-{i}",
            {
                "type": "boolean",
                "constraints": {},
                "required": False,
                "default": v,
                "description": "",
            },
            "default",
        )
        for i, v in enumerate(quelconques([0, 1, "true", "", []]))
    ],
    *[
        (f"defaut-choix-{i}", {**REGION, "default": v}, "default")
        for i, v in enumerate(quelconques(["us-east", "EU-WEST", "eu-west ", "", 1, True]))
    ],
    *[
        (f"defaut-identifiant-{i}", {**CATALOGUE, "default": v}, "default")
        for i, v in enumerate(
            quelconques(["", "1abc", "a-b", "a b", "a.b", "a" * 129, "é", "a;drop", 1, True, "a\n"])
        )
    ],
    # Description : un texte de 0 à 200 caractères, sans caractère de contrôle.
    *[
        (f"description-{i}", {**LIGNES, "description": v}, "description")
        for i, v in enumerate(
            quelconques(
                [None, 1, True, [], {}, "x" * 201, "a\nb", "\t", "a\x00", "a\ud800", "\x1b[31m"]
            )
        )
    ],
    # Plusieurs champs invalides : le premier dans l'ordre type, contraintes, obligatoire,
    # défaut, description.
    (
        "ordre-type",
        {"type": "x", "constraints": None, "required": None, "default": "x", "description": None},
        "type",
    ),
    (
        "ordre-contraintes",
        {**LIGNES, "constraints": None, "required": None, "description": None},
        "constraints",
    ),
    (
        "ordre-obligatoire",
        {**LIGNES, "required": None, "default": "x", "description": None},
        "required",
    ),
    ("ordre-defaut", {**LIGNES, "default": "x", "description": None}, "default"),
]

NOMS_INVALIDES: list[object] = [
    None,
    1,
    True,
    [],
    {},
    "",
    "A",
    "Nom",
    "1a",
    "_a",
    "a-b",
    "a.b",
    "a b",
    " a",
    "a ",
    "a\n",
    "é",
    "a" * 64,
    "a\x00",
    "a\ud800",
    SENTINELLE,
]


def cas_declaration() -> list[tuple[str, object, str]]:
    cas: list[tuple[str, object, str]] = [
        (f"illisible-{i}", contenu, "body") for i, contenu in enumerate(CORPS_ILLISIBLES)
    ]
    cas += [
        # Toutes les clés sont exigées : aucune n'est complétée en silence (P3). La première
        # manquante, dans l'ordre alphabétique, est nommée.
        ("vide", {}, "constraints"),
        *[(f"sans-{cle}", sans(NOUVEAU, cle), cle) for cle in sorted(NOUVEAU)],
        ("sans-defaut-ni-description", sans(sans(NOUVEAU, "default"), "description"), "default"),
        ("en-trop-valeur", {**NOUVEAU, "value": 1}, "body"),
        ("en-trop-auteur", {**NOUVEAU, "created_by": {"issuer": "i", "subject": "s"}}, "body"),
        ("en-trop-secret", {**NOUVEAU, "secret": True}, "body"),
        ("en-trop-sentinelle", {**NOUVEAU, SENTINELLE: 1}, "body"),
        ("en-trop-et-manquante", {**sans(NOUVEAU, "type"), "kind": "integer"}, "body"),
    ]
    cas += [(f"nom-{i}", {**NOUVEAU, "name": v}, "name") for i, v in enumerate(NOMS_INVALIDES)]
    # Le nom est contrôlé avant la déclaration.
    cas += [("nom-avant-type", {**NOUVEAU, "name": "A", "type": "x"}, "name")]
    cas += [
        (nom, {"name": "nouveau", **corps}, champ) for nom, corps, champ in DECLARATIONS_INVALIDES
    ]
    return cas


def cas_modification() -> list[tuple[str, object, str]]:
    corps = {k: v for k, v in NOUVEAU.items() if k != "name"}
    cas: list[tuple[str, object, str]] = [
        (f"illisible-{i}", contenu, "body") for i, contenu in enumerate(CORPS_ILLISIBLES)
    ]
    cas += [
        ("vide", {}, "constraints"),
        *[(f"sans-{cle}", sans(corps, cle), cle) for cle in sorted(corps)],
        ("en-trop-nom", {**corps, "name": "lignes"}, "body"),
        ("en-trop-sentinelle", {**corps, SENTINELLE: 1}, "body"),
    ]
    cas += DECLARATIONS_INVALIDES
    return cas


@pytest.mark.parametrize("profil", [ADMIN_GROUPE, PLATEFORME_SEULE], ids=lambda p: p.nom)
def test_declarations_invalides(droits: Monde, profil: Profil) -> None:
    verifier(droits, profil, "POST", BASE, cas_declaration())


@pytest.mark.parametrize("profil", [ADMIN_GROUPE, PLATEFORME_SEULE], ids=lambda p: p.nom)
def test_modifications_invalides(droits: Monde, profil: Profil) -> None:
    declarer(droits, "lignes", LIGNES)
    verifier(droits, profil, "PUT", f"{BASE}/lignes", cas_modification())


# --- Valeurs invalides : hors type, hors contraintes, `null`. --------------------------------

TYPES: dict[str, dict[str, Any]] = {
    "texte": {"type": "text", "constraints": {"max_length": 5}},
    "entier": {"type": "integer", "constraints": {"minimum": -3, "maximum": 3}},
    "entier_libre": {"type": "integer", "constraints": {}},
    "booleen": {"type": "boolean", "constraints": {}},
    "choix": {"type": "choice", "constraints": {"choices": ["eu-west", "eu-central"]}},
    "identifiant": {"type": "identifier", "constraints": {}},
}
VALEURS_INVALIDES: dict[str, list[object]] = {
    "texte": ["", "abcdef", 1, True, [], {}, "a\x00", "a\x1f", "\x7f", "a\ud800", "\udfff"],
    "entier": [-4, 4, True, False, 1.0, 0.5, "1", [1], {}, SUR],
    "entier_libre": [SUR + 1, -SUR - 1, 2**64, 1e3, float("inf"), "0", True],
    "booleen": [0, 1, "true", "True", "", [], {}],
    "choix": ["us-east", "EU-WEST", "eu-west ", " eu-west", "", 1, True, ["eu-west"]],
    "identifiant": ["", "1abc", "a-b", "a b", "a.b", "a" * 129, "é", "a;", "a\n", 1, True],
}
VALEURS_VALIDES: dict[str, list[object]] = {
    "texte": ["a", "abcde", "é" * 5, "\U0001f600" * 5, "a​b", " a "],
    "entier": [-3, 0, 3],
    "entier_libre": [SUR, -SUR, 0],
    "booleen": [True, False],
    "choix": ["eu-west", "eu-central"],
    "identifiant": ["a", "_", "A_1", "a" * 128, "Finance_DEV"],
}


@pytest.fixture
def types(droits: Monde) -> Monde:
    for nom, corps in TYPES.items():
        declarer(droits, nom, {**corps, "required": False, "default": None, "description": ""})
    return droits


@pytest.mark.parametrize("nom", sorted(TYPES))
def test_valeurs_hors_contraintes(types: Monde, nom: str) -> None:
    cas: list[tuple[str, object, str]] = [
        (f"{nom}-{i}", {"value": v}, "value") for i, v in enumerate(VALEURS_INVALIDES[nom])
    ]
    cas.append((f"{nom}-null", {"value": None}, "value"))
    verifier(types, ADMIN_GROUPE, "PUT", f"{BASE}/{nom}/values/DEV", cas)
    # Une valeur en place n'est pas touchée par un refus.
    [valide, *_] = VALEURS_VALIDES[nom]
    assert (
        envoyer(
            types, ADMIN_GROUPE, "PUT", f"{BASE}/{nom}/values/DEV", {"value": valide}
        ).status_code
        == 200
    )
    verifier(types, ADMIN_GROUPE, "PUT", f"{BASE}/{nom}/values/DEV", cas)
    assert etats(parametres(types))["DEV"][nom] == ("value", valide)


@pytest.mark.parametrize("nom", sorted(TYPES))
def test_valeurs_aux_bornes_acceptees(types: Monde, nom: str) -> None:
    for valeur in VALEURS_VALIDES[nom]:
        reponse = envoyer(
            types, ADMIN_GROUPE, "PUT", f"{BASE}/{nom}/values/TEST", {"value": valeur}
        )
        assert reponse.status_code == 200, (valeur, reponse.text)
        assert reponse.json()["value"] == valeur
        resolu = etats(parametres(types))["TEST"][nom]
        assert resolu == ("value", valeur)
        assert type(resolu[1]) is type(valeur)


def test_corps_de_valeur_invalides(types: Monde) -> None:
    cas: list[tuple[str, object, str]] = [
        (f"illisible-{i}", contenu, "body") for i, contenu in enumerate(CORPS_ILLISIBLES)
    ]
    cas += [
        ("vide", {}, "value"),
        ("autre-cle", {"valeur": 1}, "body"),
        ("en-trop", {"value": 1, "environment": "PROD"}, "body"),
        ("en-trop-sentinelle", {"value": 1, SENTINELLE: 1}, "body"),
        ("double", b'{"value": 1, "value": 2}', "body"),
        ("double-identique", b'{"value": 1, "value": 1}', "body"),
        ("double-echappe", b'{"value": 1, "\\u0076alue": 1}', "body"),
        ("trop-de-chiffres", b'{"value": ' + b"9" * 5000 + b"}", "body"),
        ("nan", b'{"value": NaN}', "value"),
        ("infini", b'{"value": -Infinity}', "value"),
        ("valeur-objet", {"value": {"a": 1}}, "value"),
        ("valeur-liste-double", b'{"value": {"a": 1, "a": 2}}', "body"),
    ]
    verifier(types, ADMIN_GROUPE, "PUT", f"{BASE}/entier_libre/values/DEV", cas)


def test_corps_a_la_taille_maximale(types: Monde) -> None:
    """64 Kio exactement : accepté ; un octet de plus : refusé, pour chaque route à corps."""
    for methode, chemin, corps, succes in (
        ("POST", BASE, NOUVEAU, 201),
        (
            "PUT",
            f"{BASE}/texte",
            {**TYPES["texte"], "required": True, "default": None, "description": ""},
            200,
        ),
        ("PUT", f"{BASE}/texte/values/DEV", {"value": "a"}, 200),
    ):
        avant = etat(types.moteur)
        trop = types.requete(ADMIN_GROUPE, methode, chemin, contenu=rembourre(corps, 64 * 1024 + 1))
        assert (trop.status_code, trop.json()) == (400, invalide("body")), chemin
        assert etat(types.moteur) == avant
        juste = types.requete(ADMIN_GROUPE, methode, chemin, contenu=rembourre(corps, 64 * 1024))
        assert juste.status_code == succes, (chemin, juste.text)


def test_cles_en_double_dans_une_declaration(droits: Monde) -> None:
    declarer(droits, "lignes", LIGNES)
    cas = [
        (
            "racine",
            b'{"name": "x", "name": "x", "type": "boolean", "constraints": {}, '
            b'"required": true, "default": null, "description": ""}',
            "body",
        ),
        (
            "contraintes",
            b'{"name": "x", "type": "integer", "constraints": {"minimum": 1, '
            b'"minimum": 2}, "required": true, "default": null, "description": ""}',
            "body",
        ),
        (
            "choix",
            b'{"name": "x", "type": "choice", "constraints": {"choices": ["a"], '
            b'"choices": ["b"]}, "required": true, "default": null, "description": ""}',
            "body",
        ),
    ]
    verifier(droits, ADMIN_GROUPE, "POST", BASE, cas)
    modification = [
        (
            "racine",
            b'{"type": "boolean", "type": "boolean", "constraints": {}, '
            b'"required": true, "default": null, "description": ""}',
            "body",
        ),
    ]
    verifier(droits, ADMIN_GROUPE, "PUT", f"{BASE}/lignes", modification)


def test_corps_lu_comme_json_quel_que_soit_l_en_tete(types: Monde) -> None:
    entetes = {
        "Cookie": f"__Host-sb_session={types.session(ADMIN_GROUPE)}",
        "Origin": "https://board.example.invalid",
    }
    formulaire = types.client.put(
        f"{BASE}/texte/values/DEV",
        content=b"value=abc",
        headers={**entetes, "Content-Type": "application/x-www-form-urlencoded"},
    )
    assert (formulaire.status_code, formulaire.json()) == (400, invalide("body"))
    texte = types.client.put(
        f"{BASE}/texte/values/DEV",
        content=b'{"value": "abc"}',
        headers={**entetes, "Content-Type": "text/plain"},
    )
    assert texte.status_code == 200


# --- Déclaration incompatible avec les valeurs existantes (P5). ----------------------------


@pytest.fixture
def trois_valeurs(droits: Monde) -> Monde:
    """`lignes` (entier de 0 à 100000) vaut 10 en DEV, 20 en TEST, 30 en PROD, posées de PROD à
    DEV : l'ordre du refus n'est pas celui des écritures."""
    declarer(droits, "lignes", LIGNES)
    for environnement, valeur in ((PROD, 30), (TEST, 20), (DEV, 10)):
        droits.magasin.set_value(
            A, "lignes", environnement, valeur, ADMIN_PERSONNE.ref, droits.horloge()
        )
    return droits


@pytest.mark.parametrize(
    "changement,refus",
    [
        ({"constraints": {"minimum": 0, "maximum": 5}}, ("DEV", "TEST", "PROD")),
        ({"constraints": {"minimum": 15, "maximum": 100000}}, ("DEV",)),
        ({"constraints": {"minimum": 0, "maximum": 15}}, ("TEST", "PROD")),
        ({"constraints": {"minimum": 15, "maximum": 25}}, ("DEV", "PROD")),
        ({"constraints": {"minimum": 0, "maximum": 29}}, ("PROD",)),
        (
            {"type": "text", "constraints": {"max_length": 10}, "default": None},
            ("DEV", "TEST", "PROD"),
        ),
        ({"type": "boolean", "constraints": {}, "default": None}, ("DEV", "TEST", "PROD")),
        (
            {"type": "choice", "constraints": {"choices": ["10"]}, "default": None},
            ("DEV", "TEST", "PROD"),
        ),
        ({"type": "identifier", "constraints": {}, "default": None}, ("DEV", "TEST", "PROD")),
    ],
    ids=[
        "tous",
        "dev",
        "test-prod",
        "dev-prod",
        "prod",
        "vers-texte",
        "vers-booleen",
        "vers-choix",
        "vers-identifiant",
    ],
)
def test_valeurs_incompatibles(
    trois_valeurs: Monde, changement: dict[str, Any], refus: tuple[str, ...]
) -> None:
    avant = etat(trois_valeurs.moteur)
    corps = {**LIGNES, "default": None, **changement}
    # La plateforme seule déclare : elle reçoit le même refus, sans droit sur les valeurs.
    for profil in (ADMIN_GROUPE, PLATEFORME_SEULE):
        reponse = trois_valeurs.requete(profil, "PUT", f"{BASE}/lignes", corps=corps)
        assert (reponse.status_code, reponse.json()) == (409, incompatibles(*refus))
    assert etat(trois_valeurs.moteur) == avant


def test_vider_d_abord_puis_modifier(trois_valeurs: Monde) -> None:
    """Le chemin documenté : vider les valeurs en cause, puis modifier la déclaration."""
    corps = {**LIGNES, "constraints": {"minimum": 0, "maximum": 15}, "default": None}
    reponse = trois_valeurs.requete(ADMIN_GROUPE, "PUT", f"{BASE}/lignes", corps=corps)
    assert reponse.json() == incompatibles("TEST", "PROD")
    # TEST vidé par un administrateur qui y déploie : PROD reste en cause.
    assert (
        trois_valeurs.requete(ADMIN_GROUPE, "DELETE", f"{BASE}/lignes/values/TEST").status_code
        == 204
    )
    reponse = trois_valeurs.requete(ADMIN_GROUPE, "PUT", f"{BASE}/lignes", corps=corps)
    assert reponse.json() == incompatibles("PROD")
    # Un défaut hors des nouvelles contraintes est un défaut invalide, pas une incompatibilité.
    hors = {**corps, "default": 5000}
    reponse = trois_valeurs.requete(ADMIN_GROUPE, "PUT", f"{BASE}/lignes", corps=hors)
    assert (reponse.status_code, reponse.json()) == (400, invalide("default"))
    assert (
        trois_valeurs.requete(ADMIN_PERSONNE, "DELETE", f"{BASE}/lignes/values/PROD").status_code
        == 204
    )
    reponse = trois_valeurs.requete(
        ADMIN_GROUPE, "PUT", f"{BASE}/lignes", corps={**corps, "default": 1}
    )
    assert reponse.status_code == 200
    assert etats(parametres(trois_valeurs))["DEV"]["lignes"] == ("value", 10)


def test_elargir_ou_rendre_obligatoire_permis(trois_valeurs: Monde) -> None:
    changements: list[dict[str, Any]] = [
        {"constraints": {}},
        {"constraints": {"minimum": 10, "maximum": 30}, "default": 30},
        {"required": True},
        {"description": "Autre"},
        {"default": None},
    ]
    for changement in changements:
        corps = {**LIGNES, **changement}
        reponse = trois_valeurs.requete(ADMIN_GROUPE, "PUT", f"{BASE}/lignes", corps=corps)
        assert reponse.status_code == 200, (changement, reponse.text)
    resolus = etats(parametres(trois_valeurs))
    assert [resolus[c]["lignes"] for c in ("DEV", "TEST", "PROD")] == [
        ("value", 10),
        ("value", 20),
        ("value", 30),
    ]


def test_choix_retire_d_une_valeur_en_place(droits: Monde) -> None:
    declarer(droits, "region", REGION)
    assert (
        envoyer(
            droits, ADMIN_GROUPE, "PUT", f"{BASE}/region/values/TEST", {"value": "eu-central"}
        ).status_code
        == 200
    )
    reponse = droits.requete(
        PLATEFORME_ADMIN,
        "PUT",
        f"{BASE}/region",
        corps={**REGION, "constraints": {"choices": ["eu-west"]}},
    )
    assert (reponse.status_code, reponse.json()) == (409, incompatibles("TEST"))
    # Ajouter un choix est permis.
    reponse = droits.requete(
        PLATEFORME_ADMIN,
        "PUT",
        f"{BASE}/region",
        corps={**REGION, "constraints": {"choices": ["eu-west", "eu-central", "eu-north"]}},
    )
    assert reponse.status_code == 200


# --- Mode local (P9). --------------------------------------------------------------------

ORIGINE_LOCALE = "http://127.0.0.1:5173"


@pytest.fixture
def local(service: CatalogService) -> Iterator[TestClient]:
    with TestClient(
        create_app(service),
        base_url="http://127.0.0.1:8000",
        headers={"Origin": ORIGINE_LOCALE},
        raise_server_exceptions=False,
    ) as client:
        yield client


LOCALES: list[tuple[str, str, bytes | None]] = [
    ("GET", "/parameters", None),
    ("POST", "/parameters", json.dumps(NOUVEAU).encode()),
    ("POST", "/parameters", b"{illisible"),
    ("POST", "/parameters", b'{"name": "A"}'),
    ("POST", "/parameters", b""),
    ("PUT", "/parameters/nouveau", json.dumps(LIGNES).encode()),
    ("PUT", "/parameters/HORS-FORMAT", b"[]"),
    ("DELETE", "/parameters/nouveau", None),
    ("DELETE", "/parameters/HORS-FORMAT", None),
    ("PUT", "/parameters/nouveau/values/DEV", b'{"value": 1}'),
    ("PUT", "/parameters/nouveau/values/PROD", b'{"value": null}'),
    ("PUT", "/parameters/nouveau/values/QA", b'{"value": 1}'),
    ("PUT", "/parameters/HORS-FORMAT/values/DEV", b"{illisible"),
    ("DELETE", "/parameters/nouveau/values/TEST", None),
    ("DELETE", "/parameters/nouveau/values/qa", None),
]


@pytest.mark.parametrize("methode,route,contenu", LOCALES)
def test_mode_local_refuse_toute_route(
    local: TestClient, methode: str, route: str, contenu: bytes | None
) -> None:
    """Sans base, les paramètres ne se gèrent pas, même avec un environnement, un nom ou un
    corps invalides : le mode local est dit avant tout le reste."""
    reponse = local.request(methode, f"/api/spaces/local{route}", content=contenu)
    assert (reponse.status_code, reponse.json()) == (409, MODE_LOCAL)


@pytest.mark.parametrize("methode,route,contenu", LOCALES)
def test_mode_local_autre_espace_introuvable(
    local: TestClient, methode: str, route: str, contenu: bytes | None
) -> None:
    reponse = local.request(methode, f"/api/spaces/finance{route}", content=contenu)
    assert (reponse.status_code, reponse.json()) == (404, {"error": {"code": "space_not_found"}})


@pytest.mark.parametrize(
    "methode,route,contenu", [e for e in LOCALES if e[0] != "GET"], ids=lambda v: str(v)[:20]
)
def test_mode_local_ecritures_hors_boucle_locale(
    service: CatalogService, methode: str, route: str, contenu: bytes | None
) -> None:
    with TestClient(create_app(service), base_url="http://127.0.0.1:8000") as client:
        for origine in (None, "null", "https://board.example.invalid", "http://192.168.1.10:5173"):
            entetes = {} if origine is None else {"Origin": origine}
            reponse = client.request(
                methode, f"/api/spaces/local{route}", content=contenu, headers=entetes
            )
            assert (reponse.status_code, reponse.json()) == (
                403,
                {"error": {"code": "origin_refused"}},
            )
