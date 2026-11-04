"""Paramètres de déploiement par les routes (plan 10, 10.2 ; P3 à P5, P7) : lecture, déclaration,
modification, retrait, valeurs, états résolus, journal et isolation.

Serveur réel sur une base migrée, profils de `monde`. Les administrateurs de A reçoivent le
droit de déployer en DEV et en TEST par leur groupe ; Axel, administrateur par une liaison de
personne, en PROD seulement. Les refus et les droits par profil sont dans
`test_routes_parametres_acces.py`, les corps et valeurs refusés dans
`test_routes_parametres_valeurs.py`.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from identity.conftest import cles as cles
from identity.conftest import config as config
from identity.conftest import fournisseur as fournisseur
from identity.conftest import horloge as horloge
from skifer_board.spaces import (
    PARAMETERS_LIMIT,
    Declaration,
    DeployGrant,
    Environment,
    GroupPrincipal,
    PersonRef,
    Principal,
)
from skifer_board.state.schema import (
    deploy_grants,
    deploy_parameters,
    parameter_values,
    space_environments,
)
from sqlalchemy import Engine, create_engine, select
from state.conftest import migre as migre

from spaces.monde import (
    ADMIN_B,
    ADMIN_GROUPE,
    ADMIN_PERSONNE,
    CREATEUR_GROUPE,
    CREATEUR_PERSONNE,
    EMETTEUR,
    PLATEFORME,
    PLATEFORME_SEULE,
    A,
    B,
    Monde,
    Profil,
    instantane,
)
from spaces.monde import config_plateforme as config_plateforme
from spaces.monde import monde as monde

DEV, TEST, PROD = Environment.DEV, Environment.TEST, Environment.PROD
CODES = ("DEV", "TEST", "PROD")
INTROUVABLE = {"error": {"code": "space_not_found"}}
PARAMETRE_INCONNU = {"error": {"code": "parameter_not_found"}}
PARAMETRE_EXISTANT = {"error": {"code": "parameter_exists"}}
LIMITE = {"error": {"code": "parameter_limit"}}
MODE_LOCAL = {"error": {"code": "local_mode"}}
# Administrateur de la plateforme et administrateur de A par son groupe.
PLATEFORME_ADMIN = Profil("plateforme-admin", "pablo", (PLATEFORME, "finance-admins"))

CATALOGUE: dict[str, Any] = {
    "type": "identifier",
    "constraints": {},
    "required": True,
    "default": None,
    "description": "Catalogue des tables publiées",
}
LIGNES: dict[str, Any] = {
    "type": "integer",
    "constraints": {"minimum": 0, "maximum": 100000},
    "required": False,
    "default": 5000,
    "description": "",
}
REGION: dict[str, Any] = {
    "type": "choice",
    "constraints": {"choices": ["eu-west", "eu-central"]},
    "required": True,
    "default": None,
    "description": "Région de calcul",
}


def interdit(requis: str, environnement: str | None = None) -> dict[str, Any]:
    erreur = {"code": "forbidden", "required": requis}
    if environnement is not None:
        erreur["environment"] = environnement
    return {"error": erreur}


def invalide(champ: str) -> dict[str, Any]:
    return {"error": {"code": "invalid_request", "field": champ}}


def incompatibles(*codes: str) -> dict[str, Any]:
    return {"error": {"code": "values_incompatible", "environments": list(codes)}}


def ref_json(profil: Profil) -> dict[str, str]:
    return {"issuer": EMETTEUR, "subject": profil.sujet}


def personne_json(profil: Profil) -> dict[str, str]:
    """Nom et adresse d'une personne connue, tels que `monde` les enregistre."""
    return {"name": f"Nom {profil.sujet}", "email": f"{profil.sujet}@example.invalid"}


def accorder(monde: Monde, espace: str, environnement: Environment, qui: Principal) -> DeployGrant:
    """Accord posé par le magasin, comme l'aurait fait la plateforme."""
    return monde.magasin.grant(espace, environnement, qui, PLATEFORME_SEULE.ref, monde.horloge())


def declarer(
    monde: Monde, nom: str, corps: dict[str, Any], espace: str = A, auteur: Profil = ADMIN_GROUPE
) -> None:
    """Déclaration posée par le magasin, sans passer par les routes."""
    declaration = Declaration.parse(
        corps["type"],
        corps["constraints"],
        corps["required"],
        corps["default"],
        corps["description"],
    )
    monde.magasin.declare(espace, nom, declaration, auteur.ref, monde.horloge())


def etat(moteur: Engine) -> dict[str, list[tuple[Any, ...]]]:
    """Tables des espaces, accords, environnements, déclarations et valeurs : un refus n'y
    écrit rien."""
    contenu = instantane(moteur)
    temoin = create_engine(moteur.url)
    try:
        with temoin.connect() as connexion:
            for table in (deploy_grants, space_environments, deploy_parameters, parameter_values):
                lignes = connexion.execute(select(table)).all()
                contenu[table.name] = sorted((tuple(ligne) for ligne in lignes), key=repr)
    finally:
        temoin.dispose()
    return contenu


def parametres(monde: Monde, profil: Profil = ADMIN_GROUPE, espace: str = A) -> dict[str, Any]:
    reponse = monde.requete(profil, "GET", f"/api/spaces/{espace}/parameters")
    assert reponse.status_code == 200, reponse.text
    corps: dict[str, Any] = reponse.json()
    assert set(corps) == {"parameters", "environments"}
    assert [e["code"] for e in corps["environments"]] == list(CODES)
    return corps


def par_environnement(corps: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {e["code"]: e for e in corps["environments"]}


def etats(corps: dict[str, Any]) -> dict[str, dict[str, tuple[str, Any]]]:
    """État résolu et valeur de chaque paramètre, par environnement."""
    return {
        e["code"]: {v["name"]: (v["state"], v["value"]) for v in e["values"]}
        for e in corps["environments"]
    }


def evenements(monde: Monde, espace: str = A, profil: Profil = ADMIN_GROUPE) -> list[Any]:
    reponse = monde.requete(profil, "GET", f"/api/spaces/{espace}/events")
    assert reponse.status_code == 200
    resultat: list[Any] = reponse.json()["events"]
    return resultat


def poser(
    monde: Monde, nom: str, environnement: str, valeur: object, profil: Profil = ADMIN_GROUPE
) -> Any:
    return monde.requete(
        profil,
        "PUT",
        f"/api/spaces/{A}/parameters/{nom}/values/{environnement}",
        corps={"value": valeur},
    )


def vider(monde: Monde, nom: str, environnement: str, profil: Profil = ADMIN_GROUPE) -> Any:
    return monde.requete(
        profil, "DELETE", f"/api/spaces/{A}/parameters/{nom}/values/{environnement}"
    )


@pytest.fixture
def droits(monde: Monde) -> Monde:
    """Administrateurs de A : DEV et TEST par leur groupe ; Axel : PROD par sa personne."""
    monde.magasin.record_login(PLATEFORME_ADMIN.identite, monde.horloge())
    accorder(monde, A, DEV, GroupPrincipal("finance-admins"))
    accorder(monde, A, TEST, GroupPrincipal("finance-admins"))
    accorder(monde, A, PROD, ADMIN_PERSONNE.ref)
    accorder(monde, A, DEV, GroupPrincipal("finance-createurs"))
    accorder(monde, A, PROD, CREATEUR_PERSONNE.ref)
    accorder(monde, A, PROD, GroupPrincipal("finance-lecteurs"))
    accorder(monde, A, PROD, GroupPrincipal(PLATEFORME))
    accorder(monde, B, DEV, GroupPrincipal("rh-admins"))
    return monde


# --- Lecture d'un espace sans paramètre. ----------------------------------------------------


def test_espace_sans_parametre(droits: Monde) -> None:
    assert parametres(droits) == {
        "parameters": [],
        "environments": [
            {"code": "DEV", "can_set": True, "complete": True, "missing": [], "values": []},
            {"code": "TEST", "can_set": True, "complete": True, "missing": [], "values": []},
            {"code": "PROD", "can_set": False, "complete": True, "missing": [], "values": []},
        ],
    }


# --- Déclarer, modifier, retirer. -------------------------------------------------------


def test_declarer_rend_la_declaration_complete(droits: Monde) -> None:
    avant = droits.horloge()
    reponse = droits.requete(
        ADMIN_GROUPE,
        "POST",
        f"/api/spaces/{A}/parameters",
        corps={"name": "catalogue", **CATALOGUE},
    )
    assert reponse.status_code == 201
    attendu = {
        "name": "catalogue",
        **CATALOGUE,
        "created_at": avant.isoformat(),
        "created_by": ref_json(ADMIN_GROUPE),
        "created_by_person": personne_json(ADMIN_GROUPE),
        "updated_at": avant.isoformat(),
        "updated_by": ref_json(ADMIN_GROUPE),
        "updated_by_person": personne_json(ADMIN_GROUPE),
    }
    assert reponse.json() == attendu
    # La lecture rend la même déclaration, sans la recalculer.
    assert parametres(droits)["parameters"] == [attendu]


@pytest.mark.parametrize(
    "corps,contraintes",
    [
        ({"type": "text", "constraints": {"max_length": 1}}, {"max_length": 1}),
        ({"type": "text", "constraints": {"max_length": 1024}}, {"max_length": 1024}),
        ({"type": "integer", "constraints": {}}, {"minimum": None, "maximum": None}),
        (
            {"type": "integer", "constraints": {"minimum": None, "maximum": None}},
            {"minimum": None, "maximum": None},
        ),
        (
            {"type": "integer", "constraints": {"minimum": -(2**53 - 1)}},
            {"minimum": -(2**53 - 1), "maximum": None},
        ),
        (
            {"type": "integer", "constraints": {"maximum": 2**53 - 1}},
            {"minimum": None, "maximum": 2**53 - 1},
        ),
        (
            {"type": "integer", "constraints": {"minimum": 3, "maximum": 3}},
            {"minimum": 3, "maximum": 3},
        ),
        ({"type": "boolean", "constraints": {}}, {}),
        ({"type": "choice", "constraints": {"choices": ["x"]}}, {"choices": ["x"]}),
        (
            {"type": "choice", "constraints": {"choices": [f"c{i}" for i in range(50)]}},
            {"choices": [f"c{i}" for i in range(50)]},
        ),
        ({"type": "identifier", "constraints": {}}, {}),
    ],
    ids=[
        "texte-1",
        "texte-1024",
        "entier-libre",
        "entier-bornes-nulles",
        "entier-minimum-exact",
        "entier-maximum-exact",
        "entier-point",
        "booleen",
        "choix-1",
        "choix-50",
        "identifiant",
    ],
)
def test_declarer_chaque_type_a_ses_bornes(
    droits: Monde, corps: dict[str, Any], contraintes: dict[str, Any]
) -> None:
    envoi = {"name": "p", "required": False, "default": None, "description": "", **corps}
    reponse = droits.requete(ADMIN_GROUPE, "POST", f"/api/spaces/{A}/parameters", corps=envoi)
    assert reponse.status_code == 201, reponse.text
    # Les contraintes sont rendues sous la forme fermée du type, bornes absentes comprises.
    assert reponse.json()["constraints"] == contraintes
    assert parametres(droits)["parameters"][0]["constraints"] == contraintes


def test_declarer_aux_limites_du_nom_et_de_la_description(droits: Monde) -> None:
    for nom in ("a", "a" * 63, "a0_", "z_9"):
        corps = {**CATALOGUE, "name": nom, "description": "é" * 200}
        reponse = droits.requete(ADMIN_GROUPE, "POST", f"/api/spaces/{A}/parameters", corps=corps)
        assert reponse.status_code == 201, (nom, reponse.text)
        assert reponse.json()["description"] == "é" * 200


def test_parametre_existant(droits: Monde) -> None:
    corps = {"name": "catalogue", **CATALOGUE}
    assert droits.requete(
        ADMIN_GROUPE, "POST", f"/api/spaces/{A}/parameters", corps=corps
    ).is_success
    avant = etat(droits.moteur)
    # Même nom, autre déclaration, autre auteur : déjà déclaré ; rien n'est remplacé.
    for profil, envoi in (
        (ADMIN_GROUPE, corps),
        (PLATEFORME_SEULE, {**corps, **LIGNES}),
    ):
        reponse = droits.requete(profil, "POST", f"/api/spaces/{A}/parameters", corps=envoi)
        assert (reponse.status_code, reponse.json()) == (409, PARAMETRE_EXISTANT)
    assert etat(droits.moteur) == avant


def test_limite_de_cent_parametres(droits: Monde) -> None:
    for i in range(PARAMETERS_LIMIT - 1):
        declarer(droits, f"p{i:03d}", LIGNES)
    centieme = {"name": "dernier", **LIGNES}
    reponse = droits.requete(ADMIN_GROUPE, "POST", f"/api/spaces/{A}/parameters", corps=centieme)
    assert reponse.status_code == 201
    avant = etat(droits.moteur)
    reponse = droits.requete(
        ADMIN_GROUPE, "POST", f"/api/spaces/{A}/parameters", corps={**centieme, "name": "encore"}
    )
    assert (reponse.status_code, reponse.json()) == (409, LIMITE)
    # À la limite, un nom déjà pris reste « existant », et un corps invalide reste invalide.
    reponse = droits.requete(ADMIN_GROUPE, "POST", f"/api/spaces/{A}/parameters", corps=centieme)
    assert (reponse.status_code, reponse.json()) == (409, PARAMETRE_EXISTANT)
    reponse = droits.requete(
        ADMIN_GROUPE,
        "POST",
        f"/api/spaces/{A}/parameters",
        corps={**centieme, "name": "encore", "type": "secret"},
    )
    assert (reponse.status_code, reponse.json()) == (400, invalide("type"))
    assert etat(droits.moteur) == avant
    assert len(parametres(droits)["parameters"]) == PARAMETERS_LIMIT
    # La limite est par espace : B en déclare encore.
    reponse = droits.requete(
        ADMIN_B, "POST", f"/api/spaces/{B}/parameters", corps={**centieme, "name": "encore"}
    )
    assert reponse.status_code == 201
    # Un retrait libère une place.
    assert droits.requete(ADMIN_GROUPE, "DELETE", f"/api/spaces/{A}/parameters/p000").is_success
    reponse = droits.requete(
        ADMIN_GROUPE, "POST", f"/api/spaces/{A}/parameters", corps={**centieme, "name": "encore"}
    )
    assert reponse.status_code == 201


def test_modifier_une_declaration(droits: Monde) -> None:
    declarer(droits, "region", REGION, auteur=ADMIN_PERSONNE)
    cree = droits.horloge()
    droits.horloge.instant = cree + timedelta(minutes=5)
    corps = {**REGION, "default": "eu-west", "description": "Autre", "required": False}
    reponse = droits.requete(
        PLATEFORME_SEULE, "PUT", f"/api/spaces/{A}/parameters/region", corps=corps
    )
    assert reponse.status_code == 200
    attendu = {
        "name": "region",
        **corps,
        "created_at": cree.isoformat(),
        "created_by": ref_json(ADMIN_PERSONNE),
        "created_by_person": personne_json(ADMIN_PERSONNE),
        "updated_at": droits.horloge().isoformat(),
        "updated_by": ref_json(PLATEFORME_SEULE),
        "updated_by_person": personne_json(PLATEFORME_SEULE),
    }
    assert reponse.json() == attendu
    assert parametres(droits)["parameters"] == [attendu]


def test_modification_sans_changement_ni_journal(droits: Monde) -> None:
    declarer(droits, "region", REGION, auteur=ADMIN_PERSONNE)
    cree = droits.horloge()
    droits.horloge.instant = cree + timedelta(minutes=5)
    journal = evenements(droits)
    avant = etat(droits.moteur)
    reponse = droits.requete(
        ADMIN_GROUPE, "PUT", f"/api/spaces/{A}/parameters/region", corps=REGION
    )
    assert reponse.status_code == 200
    # Rien n'a changé : l'auteur et la date de la dernière modification restent.
    assert reponse.json()["updated_at"] == cree.isoformat()
    assert reponse.json()["updated_by"] == ref_json(ADMIN_PERSONNE)
    assert etat(droits.moteur) == avant
    assert evenements(droits) == journal


def test_le_nom_ne_se_change_pas_par_la_modification(droits: Monde) -> None:
    """Le nom est dans le chemin ; un corps qui le porte est refusé (clé inconnue)."""
    declarer(droits, "region", REGION)
    avant = etat(droits.moteur)
    reponse = droits.requete(
        ADMIN_GROUPE,
        "PUT",
        f"/api/spaces/{A}/parameters/region",
        corps={"name": "zone", **REGION},
    )
    assert (reponse.status_code, reponse.json()) == (400, invalide("body"))
    assert etat(droits.moteur) == avant


def test_retirer_un_parametre_et_ses_valeurs(droits: Monde) -> None:
    declarer(droits, "lignes", LIGNES)
    declarer(droits, "region", REGION)
    assert poser(droits, "lignes", "DEV", 1).status_code == 200
    assert poser(droits, "lignes", "PROD", 2, ADMIN_PERSONNE).status_code == 200
    reponse = droits.requete(PLATEFORME_SEULE, "DELETE", f"/api/spaces/{A}/parameters/lignes")
    assert reponse.status_code == 204
    assert reponse.content == b""
    corps = parametres(droits)
    assert [p["name"] for p in corps["parameters"]] == ["region"]
    assert etats(corps) == {code: {"region": ("missing", None)} for code in CODES}
    # Plus de valeur en base pour ce nom ; un second retrait ne trouve rien.
    assert [v.name for v in droits.magasin.configuration(A).values] == []
    encore = droits.requete(PLATEFORME_SEULE, "DELETE", f"/api/spaces/{A}/parameters/lignes")
    assert (encore.status_code, encore.json()) == (404, PARAMETRE_INCONNU)
    # Redéclaré sous le même nom, il repart sans valeur.
    declarer(droits, "lignes", LIGNES)
    assert etats(parametres(droits))["PROD"]["lignes"] == ("default", 5000)


# --- Poser et vider une valeur. -----------------------------------------------------------


def test_poser_une_valeur(droits: Monde) -> None:
    declarer(droits, "catalogue", CATALOGUE)
    droits.horloge.instant += timedelta(minutes=1)
    reponse = poser(droits, "catalogue", "DEV", "finance_dev")
    assert reponse.status_code == 200
    attendu = {
        "name": "catalogue",
        "environment": "DEV",
        "value": "finance_dev",
        "set_at": droits.horloge().isoformat(),
        "set_by": ref_json(ADMIN_GROUPE),
        "set_by_person": personne_json(ADMIN_GROUPE),
    }
    assert reponse.json() == attendu
    [dev] = par_environnement(parametres(droits))["DEV"]["values"]
    assert dev == {
        "name": "catalogue",
        "state": "value",
        "value": "finance_dev",
        "set_at": attendu["set_at"],
        "set_by": attendu["set_by"],
        "set_by_person": attendu["set_by_person"],
    }


def test_valeur_remplacee_puis_inchangee(droits: Monde) -> None:
    declarer(droits, "catalogue", CATALOGUE)
    premier = droits.horloge()
    assert poser(droits, "catalogue", "PROD", "finance", ADMIN_PERSONNE).status_code == 200
    droits.horloge.instant = premier + timedelta(minutes=3)
    # La même valeur, par un autre administrateur qui peut déployer en PROD : rien ne change,
    # et la réponse dit qui l'a posée, et quand (E12).
    assert droits.requete(
        ADMIN_GROUPE,
        "POST",
        f"/api/spaces/{A}/deploy-grants",
        corps={"environment": "PROD", "principal": {"kind": "group", "name": "finance-admins"}},
    ).is_success
    journal = evenements(droits)
    avant = etat(droits.moteur)
    reponse = poser(droits, "catalogue", "PROD", "finance")
    assert reponse.status_code == 200
    assert reponse.json()["set_at"] == premier.isoformat()
    assert reponse.json()["set_by"] == ref_json(ADMIN_PERSONNE)
    assert etat(droits.moteur) == avant
    assert evenements(droits) == journal
    # Une autre valeur la remplace, avec son auteur et sa date.
    reponse = poser(droits, "catalogue", "PROD", "finance_v2")
    assert reponse.status_code == 200
    assert reponse.json()["set_at"] == droits.horloge().isoformat()
    assert reponse.json()["set_by"] == ref_json(ADMIN_GROUPE)
    assert etats(parametres(droits))["PROD"]["catalogue"] == ("value", "finance_v2")


def test_vider_une_valeur(droits: Monde) -> None:
    declarer(droits, "lignes", LIGNES)
    assert poser(droits, "lignes", "TEST", 7).status_code == 200
    reponse = vider(droits, "lignes", "TEST")
    assert reponse.status_code == 204
    assert reponse.content == b""
    assert etats(parametres(droits))["TEST"]["lignes"] == ("default", 5000)
    # Vider une valeur absente : sans effet, sans journal, toujours 204.
    journal = evenements(droits)
    avant = etat(droits.moteur)
    for _ in range(2):
        encore = vider(droits, "lignes", "TEST")
        assert encore.status_code == 204
    assert etat(droits.moteur) == avant
    assert evenements(droits) == journal


# --- États résolus et complétude (P4). ----------------------------------------------------


def test_etats_resolus_sur_toutes_les_combinaisons(droits: Monde) -> None:
    """Obligatoire ou facultatif, avec ou sans défaut, avec ou sans valeur propre."""
    entier = {"type": "integer", "constraints": {}, "description": ""}
    for nom, requis, defaut in (
        ("obl_defaut", True, 10),
        ("obl_sans", True, None),
        ("fac_defaut", False, 20),
        ("fac_sans", False, None),
    ):
        declarer(droits, nom, {**entier, "required": requis, "default": defaut})
    # DEV : une valeur propre partout ; TEST : aucune ; PROD : une seule, sur `obl_sans`.
    for nom, valeur in (("obl_defaut", 1), ("obl_sans", 2), ("fac_defaut", 3), ("fac_sans", 4)):
        assert poser(droits, nom, "DEV", valeur).status_code == 200
    assert poser(droits, "obl_sans", "PROD", 5, ADMIN_PERSONNE).status_code == 200
    corps = parametres(droits)
    assert etats(corps) == {
        "DEV": {
            "fac_defaut": ("value", 3),
            "fac_sans": ("value", 4),
            "obl_defaut": ("value", 1),
            "obl_sans": ("value", 2),
        },
        "TEST": {
            "fac_defaut": ("default", 20),
            "fac_sans": ("absent", None),
            "obl_defaut": ("default", 10),
            "obl_sans": ("missing", None),
        },
        "PROD": {
            "fac_defaut": ("default", 20),
            "fac_sans": ("absent", None),
            "obl_defaut": ("default", 10),
            "obl_sans": ("value", 5),
        },
    }
    environnements = par_environnement(corps)
    # Un facultatif absent ne rend pas l'environnement incomplet ; un obligatoire manquant, si.
    assert [(e["code"], e["complete"], e["missing"]) for e in corps["environments"]] == [
        ("DEV", True, []),
        ("TEST", False, ["obl_sans"]),
        ("PROD", True, []),
    ]
    # Seule une valeur propre dit qui l'a posée.
    for code, environnement in environnements.items():
        for valeur in environnement["values"]:
            propre = valeur["state"] == "value"
            assert (valeur["set_at"] is not None) is propre, (code, valeur)
            assert (valeur["set_by"] is not None) is propre, (code, valeur)
            assert (valeur["set_by_person"] is not None) is propre, (code, valeur)
            assert set(valeur) == {"name", "state", "value", "set_at", "set_by", "set_by_person"}
    assert environnements["PROD"]["values"][3]["set_by"] == ref_json(ADMIN_PERSONNE)
    # Vider la valeur de PROD rend PROD incomplet ; la poser de nouveau le complète.
    assert vider(droits, "obl_sans", "PROD", ADMIN_PERSONNE).status_code == 204
    prod = par_environnement(parametres(droits))["PROD"]
    assert (prod["complete"], prod["missing"]) == (False, ["obl_sans"])


def test_valeurs_fausses_sont_des_valeurs(droits: Monde) -> None:
    """`0` et `False` sont des valeurs, pas des absences ; un défaut `0` ou `False` aussi."""
    declarer(
        droits,
        "seuil",
        {"type": "integer", "constraints": {}, "required": True, "default": 0, "description": ""},
    )
    declarer(
        droits,
        "actif",
        {
            "type": "boolean",
            "constraints": {},
            "required": True,
            "default": False,
            "description": "",
        },
    )
    declarer(
        droits,
        "compte",
        {
            "type": "integer",
            "constraints": {},
            "required": True,
            "default": None,
            "description": "",
        },
    )
    declarer(
        droits,
        "drapeau",
        {
            "type": "boolean",
            "constraints": {},
            "required": True,
            "default": None,
            "description": "",
        },
    )
    assert poser(droits, "compte", "DEV", 0).json()["value"] == 0
    assert poser(droits, "drapeau", "DEV", False).json()["value"] is False
    assert poser(droits, "seuil", "DEV", 0).status_code == 200
    assert poser(droits, "actif", "TEST", True).status_code == 200
    corps = parametres(droits)
    resolus = etats(corps)
    assert resolus["DEV"] == {
        "actif": ("default", False),
        "compte": ("value", 0),
        "drapeau": ("value", False),
        "seuil": ("value", 0),
    }
    assert resolus["TEST"] == {
        "actif": ("value", True),
        "compte": ("missing", None),
        "drapeau": ("missing", None),
        "seuil": ("default", 0),
    }
    # Typés : `False` n'est pas `0`, ni l'inverse.
    dev = {v["name"]: v["value"] for v in par_environnement(corps)["DEV"]["values"]}
    assert dev["drapeau"] is False and type(dev["compte"]) is int
    assert [(e["code"], e["complete"]) for e in corps["environments"]] == [
        ("DEV", True),
        ("TEST", False),
        ("PROD", False),
    ]


def test_texte_vide_impossible(droits: Monde) -> None:
    """Un texte vide n'est ni une valeur ni un défaut : vider est un acte distinct."""
    texte = {"type": "text", "constraints": {"max_length": 10}, "required": True, "description": ""}
    reponse = droits.requete(
        ADMIN_GROUPE,
        "POST",
        f"/api/spaces/{A}/parameters",
        corps={"name": "libelle", **texte, "default": ""},
    )
    assert (reponse.status_code, reponse.json()) == (400, invalide("default"))
    declarer(droits, "libelle", {**texte, "default": None})
    avant = etat(droits.moteur)
    for valeur in ("", None):
        reponse = poser(droits, "libelle", "DEV", valeur)
        assert (reponse.status_code, reponse.json()) == (400, invalide("value"))
    assert etat(droits.moteur) == avant
    assert etats(parametres(droits))["DEV"]["libelle"] == ("missing", None)


def test_parametres_tries_par_nom_a_l_octet(droits: Monde) -> None:
    """Ordre par Python, pas par la collation de la base : `_` vient avant les lettres."""
    for nom in ("b", "aa", "a_z", "a0", "a_"):
        declarer(droits, nom, LIGNES)
    corps = parametres(droits)
    attendu = ["a0", "a_", "a_z", "aa", "b"]
    assert [p["name"] for p in corps["parameters"]] == attendu
    for environnement in corps["environments"]:
        assert [v["name"] for v in environnement["values"]] == attendu


def test_entiers_exacts_aux_bornes(droits: Monde) -> None:
    declarer(
        droits,
        "grand",
        {
            "type": "integer",
            "constraints": {},
            "required": False,
            "default": None,
            "description": "",
        },
    )
    assert poser(droits, "grand", "DEV", 2**53 - 1).json()["value"] == 2**53 - 1
    assert poser(droits, "grand", "TEST", -(2**53 - 1)).json()["value"] == -(2**53 - 1)
    resolus = etats(parametres(droits))
    assert resolus["DEV"]["grand"] == ("value", 2**53 - 1)
    assert resolus["TEST"]["grand"] == ("value", -(2**53 - 1))


def test_rendre_obligatoire_rend_incomplet(droits: Monde) -> None:
    """Permis même avec des environnements sans valeur : l'écran le dit (P5)."""
    facultatif = {**CATALOGUE, "required": False}
    declarer(droits, "catalogue", facultatif)
    assert poser(droits, "catalogue", "DEV", "finance_dev").status_code == 200
    assert all(e["complete"] for e in parametres(droits)["environments"])
    reponse = droits.requete(
        ADMIN_GROUPE, "PUT", f"/api/spaces/{A}/parameters/catalogue", corps=CATALOGUE
    )
    assert reponse.status_code == 200
    assert [
        (e["code"], e["complete"], e["missing"]) for e in parametres(droits)["environments"]
    ] == [
        ("DEV", True, []),
        ("TEST", False, ["catalogue"]),
        ("PROD", False, ["catalogue"]),
    ]


def test_un_defaut_change_la_resolution_sans_toucher_aux_valeurs(droits: Monde) -> None:
    declarer(droits, "lignes", LIGNES)
    assert poser(droits, "lignes", "DEV", 1).status_code == 200
    reponse = droits.requete(
        ADMIN_GROUPE, "PUT", f"/api/spaces/{A}/parameters/lignes", corps={**LIGNES, "default": 9}
    )
    assert reponse.status_code == 200
    resolus = etats(parametres(droits))
    assert [resolus[code]["lignes"] for code in CODES] == [
        ("value", 1),
        ("default", 9),
        ("default", 9),
    ]


# --- Journal (P7). -----------------------------------------------------------------------


def test_journal_raconte_declarations_et_valeurs(droits: Monde) -> None:
    debut = len(evenements(droits))
    instants = []

    def tic() -> str:
        droits.horloge.instant += timedelta(minutes=1)
        instants.append(droits.horloge().isoformat())
        return instants[-1]

    tic()
    corps = {"name": "lignes", **LIGNES}
    assert droits.requete(
        ADMIN_GROUPE, "POST", f"/api/spaces/{A}/parameters", corps=corps
    ).is_success
    tic()
    assert poser(droits, "lignes", "DEV", 10).status_code == 200
    tic()
    assert poser(droits, "lignes", "DEV", 10).status_code == 200  # inchangée : rien
    assert poser(droits, "lignes", "DEV", 0).status_code == 200
    tic()
    assert poser(droits, "lignes", "PROD", 30, ADMIN_PERSONNE).status_code == 200
    tic()
    assert vider(droits, "lignes", "DEV").status_code == 204
    assert vider(droits, "lignes", "DEV").status_code == 204  # déjà vide : rien
    tic()
    change = {**LIGNES, "required": True, "description": "Plafond"}
    assert droits.requete(
        PLATEFORME_SEULE, "PUT", f"/api/spaces/{A}/parameters/lignes", corps=change
    ).is_success
    assert droits.requete(  # inchangée : rien
        PLATEFORME_SEULE, "PUT", f"/api/spaces/{A}/parameters/lignes", corps=change
    ).is_success
    tic()
    assert droits.requete(
        PLATEFORME_SEULE, "DELETE", f"/api/spaces/{A}/parameters/lignes"
    ).is_success
    journal = evenements(droits, profil=PLATEFORME_SEULE)
    nouveaux = journal[: len(journal) - debut]
    declaration = {
        "type": "integer",
        "constraints": {"minimum": 0, "maximum": 100000},
        "required": False,
        "default": 5000,
        "description": "",
    }
    apres = {**declaration, "required": True, "description": "Plafond"}
    attendus = [
        (
            instants[6],
            PLATEFORME_SEULE,
            "parameter_removed",
            {"name": "lignes", "declaration": apres, "values": {"PROD": 30}},
        ),
        (
            instants[5],
            PLATEFORME_SEULE,
            "parameter_changed",
            {"name": "lignes", "before": declaration, "after": apres},
        ),
        (
            instants[4],
            ADMIN_GROUPE,
            "value_cleared",
            {"name": "lignes", "environment": "DEV", "before": 0},
        ),
        (
            instants[3],
            ADMIN_PERSONNE,
            "value_set",
            {"name": "lignes", "environment": "PROD", "before": None, "after": 30},
        ),
        (
            instants[2],
            ADMIN_GROUPE,
            "value_set",
            {"name": "lignes", "environment": "DEV", "before": 10, "after": 0},
        ),
        (
            instants[1],
            ADMIN_GROUPE,
            "value_set",
            {"name": "lignes", "environment": "DEV", "before": None, "after": 10},
        ),
        (
            instants[0],
            ADMIN_GROUPE,
            "parameter_declared",
            {"name": "lignes", "declaration": declaration},
        ),
    ]
    assert len(nouveaux) == len(attendus)
    for evenement, (instant, acteur, action, detail) in zip(nouveaux, attendus, strict=True):
        assert set(evenement) == {
            "id",
            "at",
            "actor",
            "actor_person",
            "action",
            "detail",
            "principal_person",
        }
        assert evenement["at"] == instant
        assert evenement["actor"] == ref_json(acteur)
        assert evenement["actor_person"] == personne_json(acteur)
        assert evenement["action"] == action
        assert evenement["detail"] == detail
        # Aucune personne visée par un paramètre.
        assert evenement["principal_person"] is None
    # Les valeurs typées passent telles quelles : `0` reste un entier, pas `False`.
    assert type(nouveaux[2]["detail"]["before"]) is int


def test_journal_des_valeurs_typees(droits: Monde) -> None:
    declarer(
        droits,
        "actif",
        {
            "type": "boolean",
            "constraints": {},
            "required": False,
            "default": None,
            "description": "",
        },
    )
    assert poser(droits, "actif", "DEV", False).status_code == 200
    assert poser(droits, "actif", "DEV", True).status_code == 200
    [dernier, premier] = evenements(droits)[:2]
    assert premier["detail"] == {
        "name": "actif",
        "environment": "DEV",
        "before": None,
        "after": False,
    }
    assert dernier["detail"] == {
        "name": "actif",
        "environment": "DEV",
        "before": False,
        "after": True,
    }
    assert premier["detail"]["after"] is False


def test_un_refus_n_est_pas_journalise(droits: Monde) -> None:
    declarer(droits, "lignes", LIGNES)
    assert poser(droits, "lignes", "DEV", 10).status_code == 200
    journal = evenements(droits)
    for reponse in (
        poser(droits, "lignes", "DEV", -1),
        poser(droits, "lignes", "PROD", 1),
        poser(droits, "inconnu", "DEV", 1),
        droits.requete(
            ADMIN_GROUPE,
            "PUT",
            f"/api/spaces/{A}/parameters/lignes",
            corps={**LIGNES, "constraints": {"maximum": 5}},
        ),
        droits.requete(
            ADMIN_GROUPE, "POST", f"/api/spaces/{A}/parameters", corps={"name": "lignes", **LIGNES}
        ),
    ):
        assert reponse.status_code >= 400
    assert evenements(droits) == journal


# --- Isolation de deux espaces. ----------------------------------------------------------


def test_meme_nom_dans_deux_espaces(droits: Monde) -> None:
    corps = {"name": "catalogue", **CATALOGUE}
    assert droits.requete(
        ADMIN_GROUPE, "POST", f"/api/spaces/{A}/parameters", corps=corps
    ).is_success
    # Le même nom dans B, une autre déclaration : aucun conflit.
    autre = {**corps, "required": False, "default": "rh"}
    assert droits.requete(ADMIN_B, "POST", f"/api/spaces/{B}/parameters", corps=autre).is_success
    assert poser(droits, "catalogue", "DEV", "finance_dev").status_code == 200
    reponse = droits.requete(
        ADMIN_B,
        "PUT",
        f"/api/spaces/{B}/parameters/catalogue/values/DEV",
        corps={"value": "rh_dev"},
    )
    assert reponse.status_code == 200
    assert etats(parametres(droits))["DEV"]["catalogue"] == ("value", "finance_dev")
    assert etats(parametres(droits, ADMIN_B, B))["DEV"]["catalogue"] == ("value", "rh_dev")
    assert etats(parametres(droits, ADMIN_B, B))["TEST"]["catalogue"] == ("default", "rh")
    # Une modification ou un retrait dans A ne touche pas B.
    assert vider(droits, "catalogue", "DEV").status_code == 204
    assert droits.requete(
        ADMIN_GROUPE, "DELETE", f"/api/spaces/{A}/parameters/catalogue"
    ).is_success
    assert parametres(droits)["parameters"] == []
    rh = parametres(droits, ADMIN_B, B)
    assert [p["name"] for p in rh["parameters"]] == ["catalogue"]
    assert rh["parameters"][0]["default"] == "rh"
    assert etats(rh)["DEV"]["catalogue"] == ("value", "rh_dev")
    # Les journaux restent séparés.
    assert all(
        e["action"]
        in {"space_created", "binding_added", "deploy_granted", "parameter_declared", "value_set"}
        for e in evenements(droits, B, ADMIN_B)
    )
    assert [e["detail"].get("after") for e in evenements(droits, B, ADMIN_B)[:1]] == ["rh_dev"]


def test_un_administrateur_ne_touche_pas_l_autre_espace(droits: Monde) -> None:
    declarer(droits, "catalogue", CATALOGUE)
    declarer(droits, "catalogue", CATALOGUE, espace=B, auteur=ADMIN_B)
    avant = etat(droits.moteur)
    for profil, espace_vise in ((ADMIN_B, A), (ADMIN_GROUPE, B), (CREATEUR_GROUPE, B)):
        base = f"/api/spaces/{espace_vise}/parameters"
        for methode, chemin, corps in (
            ("GET", base, None),
            ("POST", base, {"name": "autre", **CATALOGUE}),
            ("PUT", f"{base}/catalogue", CATALOGUE),
            ("DELETE", f"{base}/catalogue", None),
            ("PUT", f"{base}/catalogue/values/DEV", {"value": "x"}),
            ("DELETE", f"{base}/catalogue/values/DEV", None),
        ):
            reponse = droits.requete(profil, methode, chemin, corps=corps)
            assert (reponse.status_code, reponse.json()) == (404, INTROUVABLE), (
                profil.nom,
                methode,
                chemin,
            )
    assert etat(droits.moteur) == avant


# --- Aucune réponse existante ne change de forme (rayon d'impact). ---------------------


def test_reponses_existantes_inchangees(droits: Monde) -> None:
    def formes() -> dict[str, Any]:
        liste = droits.requete(ADMIN_GROUPE, "GET", "/api/spaces").json()
        seul = droits.requete(ADMIN_GROUPE, "GET", f"/api/spaces/{A}").json()
        membres = droits.requete(ADMIN_GROUPE, "GET", f"/api/spaces/{A}/members").json()
        accords = droits.requete(ADMIN_GROUPE, "GET", f"/api/spaces/{A}/deploy-grants").json()
        return {"liste": liste, "seul": seul, "membres": membres, "accords": accords}

    avant = formes()
    assert set(avant["seul"]) == {
        "id",
        "name",
        "atlas",
        "created_at",
        "created_by",
        "role",
        "implicit",
        "environments",
    }
    assert avant["seul"]["environments"] == [
        {"code": "DEV", "deploy": True},
        {"code": "TEST", "deploy": True},
        {"code": "PROD", "deploy": False},
    ]
    declarer(droits, "catalogue", CATALOGUE)
    assert poser(droits, "catalogue", "DEV", "finance_dev").status_code == 200
    # Déclarations et valeurs ne fuient dans aucune autre réponse.
    assert formes() == avant


def test_droit_de_deployer_et_can_set_coincident_pour_un_administrateur(droits: Monde) -> None:
    for profil in (ADMIN_GROUPE, ADMIN_PERSONNE, PLATEFORME_ADMIN):
        espace_vu = droits.requete(profil, "GET", f"/api/spaces/{A}").json()
        deploie = [e["deploy"] for e in espace_vu["environments"]]
        peut = [e["can_set"] for e in parametres(droits, profil)["environments"]]
        assert deploie == peut, profil.nom


def test_lecture_par_un_moteur_externe_identique(droits: Monde) -> None:
    """La lecture des routes et celle du magasin disent la même chose."""
    declarer(droits, "catalogue", CATALOGUE)
    declarer(droits, "lignes", LIGNES)
    assert poser(droits, "lignes", "PROD", 1, ADMIN_PERSONNE).status_code == 200
    configuration = droits.magasin.configuration(A)
    corps = parametres(droits)
    assert [p["name"] for p in corps["parameters"]] == [p.name for p in configuration.parameters]
    for environnement in (DEV, TEST, PROD):
        assert par_environnement(corps)[environnement.value]["missing"] == list(
            configuration.missing(environnement)
        )


def test_auteurs_inconnus_de_board(droits: Monde) -> None:
    """Un auteur que Board ne connaît pas : sa référence est rendue, sa personne vaut `null`."""
    inconnu = PersonRef(EMETTEUR, "parti")
    declaration = Declaration.parse("boolean", {}, True, None, "")
    droits.magasin.declare(A, "actif", declaration, inconnu, droits.horloge())
    droits.magasin.set_value(A, "actif", PROD, True, inconnu, droits.horloge())
    corps = parametres(droits)
    [parametre] = corps["parameters"]
    assert parametre["created_by"] == {"issuer": EMETTEUR, "subject": "parti"}
    assert parametre["created_by_person"] is None
    assert parametre["updated_by_person"] is None
    [prod] = par_environnement(corps)["PROD"]["values"]
    assert prod["set_by"] == {"issuer": EMETTEUR, "subject": "parti"}
    assert prod["set_by_person"] is None
    [journal, *_] = evenements(droits)
    assert (journal["action"], journal["actor_person"]) == ("value_set", None)
