"""Droits sur les paramètres de déploiement, par les routes (plan 10, 10.2 ; P6, P8, P9).

Chaque route est appelée par chaque profil sur le serveur réel. Lire et déclarer : les
administrateurs de l'espace et de la plateforme. Poser ou vider une valeur : rôle
administrateur dans l'espace **et** droit de déployer dans l'environnement ; la plateforme
seule n'y suffit pas. `can_set` est recalculé à chaque requête. Chaque refus a son statut et
son corps exacts, et n'écrit rien.

Ordre des contrôles constaté (documenté par les tests de la dernière section) : origine, puis
session, puis espace (404, identique pour un non-membre), puis mode local, puis rôle de gestion
(`forbidden`, `admin`) ; pour une valeur, ensuite l'environnement du chemin, puis le rôle
administrateur dans l'espace, puis le droit de déployer ; puis le format du nom (404
`parameter_not_found`), puis le corps, puis l'existence du paramètre, puis la valeur.
"""

from __future__ import annotations

import itertools
from typing import Any

import pytest
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from identity.conftest import cles as cles
from identity.conftest import config as config
from identity.conftest import fournisseur as fournisseur
from identity.conftest import horloge as horloge
from skifer_board.spaces import GroupPrincipal
from state.conftest import migre as migre

from spaces.monde import (
    ADMIN_B,
    ADMIN_GROUPE,
    ADMIN_PERSONNE,
    CREATEUR_GROUPE,
    CREATEUR_PERSONNE,
    LECTEUR_GROUPE,
    LECTEUR_PERSONNE,
    NON_MEMBRE,
    PLATEFORME_LECTEUR,
    PLATEFORME_SEULE,
    A,
    Monde,
    Profil,
)
from spaces.monde import config_plateforme as config_plateforme
from spaces.monde import monde as monde
from spaces.test_routes_ecritures import ORIGINES_REFUSEES, SENTINELLE, sans_trace
from spaces.test_routes_parametres import (
    CATALOGUE,
    DEV,
    INTROUVABLE,
    LIGNES,
    PARAMETRE_INCONNU,
    PLATEFORME_ADMIN,
    PROD,
    TEST,
    accorder,
    declarer,
    etat,
    interdit,
    invalide,
    parametres,
)
from spaces.test_routes_parametres import droits as droits

BASE = f"/api/spaces/{A}/parameters"
NOUVEAU = {"name": "nouveau", **LIGNES}


def routes() -> list[tuple[str, str, str, object]]:
    """(identifiant, méthode, chemin, corps) de chaque route des paramètres, sur A, avec le
    paramètre `catalogue` déclaré."""
    resultat: list[tuple[str, str, str, object]] = [
        ("lire", "GET", BASE, None),
        ("declarer", "POST", BASE, NOUVEAU),
        ("modifier", "PUT", f"{BASE}/catalogue", {**CATALOGUE, "description": "Autre"}),
        ("retirer", "DELETE", f"{BASE}/catalogue", None),
    ]
    for code in ("DEV", "TEST", "PROD"):
        chemin = f"{BASE}/catalogue/values/{code}"
        resultat.append((f"poser-{code}", "PUT", chemin, {"value": "finance"}))
        resultat.append((f"vider-{code}", "DELETE", chemin, None))
    return resultat


ROUTES = routes()
SUCCES = {"GET": 200, "POST": 201, "PUT": 200, "DELETE": 204}
# Environnements où chaque profil peut poser une valeur dans A, avec les accords de `droits`.
POSE: dict[str, set[str]] = {
    ADMIN_GROUPE.nom: {"DEV", "TEST"},
    ADMIN_PERSONNE.nom: {"PROD"},
    # Administrateur par son groupe, et un accord en PROD au groupe de la plateforme.
    PLATEFORME_ADMIN.nom: {"DEV", "TEST", "PROD"},
    PLATEFORME_SEULE.nom: set(),
    PLATEFORME_LECTEUR.nom: set(),
}
GESTIONNAIRES = set(POSE)
# Rôle insuffisant pour gérer, même avec le droit de déployer (créateurs).
SANS_GESTION = {
    LECTEUR_GROUPE.nom,
    LECTEUR_PERSONNE.nom,
    CREATEUR_GROUPE.nom,
    CREATEUR_PERSONNE.nom,
}
CACHES = {NON_MEMBRE.nom, ADMIN_B.nom}
PROFILS = (
    LECTEUR_GROUPE,
    LECTEUR_PERSONNE,
    CREATEUR_GROUPE,
    CREATEUR_PERSONNE,
    ADMIN_GROUPE,
    ADMIN_PERSONNE,
    NON_MEMBRE,
    PLATEFORME_SEULE,
    PLATEFORME_LECTEUR,
    PLATEFORME_ADMIN,
    ADMIN_B,
)


def attendu(profil: Profil, route: str, methode: str) -> tuple[int, Any]:
    """Statut et corps attendus ; `None` pour un corps de succès vérifié à part."""
    if profil.nom in CACHES:
        return 404, INTROUVABLE
    if profil.nom in SANS_GESTION:
        return 403, interdit("admin")
    code = route.rsplit("-", 1)[-1] if route.startswith(("poser", "vider")) else None
    if code is None:
        return SUCCES[methode], None
    if profil.nom in {PLATEFORME_SEULE.nom, PLATEFORME_LECTEUR.nom}:
        # La plateforme lit et déclare ; elle ne pose aucune valeur, même avec un accord.
        return 403, interdit("admin")
    if code not in POSE[profil.nom]:
        return 403, interdit("deploy", code)
    return SUCCES[methode], None


@pytest.fixture
def declare(droits: Monde) -> Monde:
    declarer(droits, "catalogue", CATALOGUE)
    # Une valeur en place dans chaque environnement : vider a quelque chose à vider.
    for environnement in (DEV, TEST, PROD):
        droits.magasin.set_value(
            A, "catalogue", environnement, "avant", ADMIN_GROUPE.ref, droits.horloge()
        )
    return droits


@pytest.mark.parametrize("profil", PROFILS, ids=lambda p: p.nom)
@pytest.mark.parametrize("route,methode,chemin,corps", ROUTES, ids=[r[0] for r in ROUTES])
def test_matrice_des_droits(
    declare: Monde, profil: Profil, route: str, methode: str, chemin: str, corps: object
) -> None:
    avant = etat(declare.moteur)
    reponse = declare.requete(profil, methode, chemin, corps=corps)
    statut, refus = attendu(profil, route, methode)
    assert reponse.status_code == statut, reponse.text
    if refus is not None:
        assert reponse.json() == refus
        sans_trace(reponse.text)
        assert etat(declare.moteur) == avant
        return
    if methode == "DELETE":
        assert reponse.content == b""
    if methode == "GET":
        assert etat(declare.moteur) == avant
    else:
        assert etat(declare.moteur) != avant


@pytest.mark.parametrize("route,methode,chemin,corps", ROUTES, ids=[r[0] for r in ROUTES])
def test_non_membre_comme_espace_inconnu(
    declare: Monde, route: str, methode: str, chemin: str, corps: object
) -> None:
    """Un non-membre reçoit exactement la réponse d'un espace inconnu, même pour un
    administrateur de l'espace qui demande un espace qui n'existe pas."""
    avant = etat(declare.moteur)
    cache = declare.requete(NON_MEMBRE, methode, chemin, corps=corps)
    for profil, espace_inconnu in itertools.product(
        (ADMIN_GROUPE, PLATEFORME_SEULE, NON_MEMBRE), ("inconnu", "Finance", "a" * 41, "x")
    ):
        autre = declare.requete(
            profil, methode, chemin.replace(f"/{A}/", f"/{espace_inconnu}/"), corps=corps
        )
        assert (autre.status_code, autre.json()) == (cache.status_code, cache.json())
        assert autre.headers.get("content-type") == cache.headers.get("content-type")
    assert (cache.status_code, cache.json()) == (404, INTROUVABLE)
    assert etat(declare.moteur) == avant


@pytest.mark.parametrize("route,methode,chemin,corps", ROUTES, ids=[r[0] for r in ROUTES])
def test_sans_session(declare: Monde, route: str, methode: str, chemin: str, corps: object) -> None:
    avant = etat(declare.moteur)
    reponse = declare.requete(None, methode, chemin, corps=corps)
    assert reponse.status_code == 401
    assert reponse.json() == {"error": {"code": "unauthenticated", "login_url": "/auth/login"}}
    assert etat(declare.moteur) == avant


# --- `can_set` par environnement, recalculé à chaque requête (P6). --------------------------


@pytest.mark.parametrize(
    "profil", [p for p in PROFILS if p.nom in GESTIONNAIRES], ids=lambda p: p.nom
)
def test_can_set_par_profil(declare: Monde, profil: Profil) -> None:
    corps = parametres(declare, profil)
    assert {e["code"]: e["can_set"] for e in corps["environments"]} == {
        code: code in POSE[profil.nom] for code in ("DEV", "TEST", "PROD")
    }
    # Le reste de la lecture ne dépend pas de la session.
    assert [{**e, "can_set": None} for e in corps["environments"]] == [
        {**e, "can_set": None} for e in parametres(declare, ADMIN_GROUPE)["environments"]
    ]


def test_can_set_suit_le_retrait_d_un_accord(declare: Monde) -> None:
    accords = declare.requete(ADMIN_GROUPE, "GET", f"/api/spaces/{A}/deploy-grants").json()
    [dev] = [
        g["id"]
        for g in accords["grants"]
        if g["environment"] == "DEV"
        and g["principal"] == {"kind": "group", "name": "finance-admins"}
    ]
    assert (
        declare.requete(
            ADMIN_GROUPE, "PUT", f"{BASE}/catalogue/values/DEV", corps={"value": "un"}
        ).status_code
        == 200
    )
    retrait = declare.requete(ADMIN_GROUPE, "DELETE", f"/api/spaces/{A}/deploy-grants/{dev}")
    assert retrait.status_code == 204
    # Même session, requête suivante : le droit est tombé.
    envs = parametres(declare)["environments"]
    assert [e["can_set"] for e in envs] == [False, True, False]
    avant = etat(declare.moteur)
    for methode, corps in (("PUT", {"value": "deux"}), ("DELETE", None)):
        reponse = declare.requete(
            ADMIN_GROUPE, methode, f"{BASE}/catalogue/values/DEV", corps=corps
        )
        assert (reponse.status_code, reponse.json()) == (403, interdit("deploy", "DEV"))
    assert etat(declare.moteur) == avant
    # TEST reste permis.
    assert (
        declare.requete(
            ADMIN_GROUPE, "PUT", f"{BASE}/catalogue/values/TEST", corps={"value": "deux"}
        ).status_code
        == 200
    )
    # Un nouvel accord rend le droit à la requête suivante.
    accorder(declare, A, DEV, GroupPrincipal("finance-admins"))
    assert [e["can_set"] for e in parametres(declare)["environments"]] == [True, True, False]


def test_can_set_suit_le_role(declare: Monde) -> None:
    """Axel, administrateur avec un accord en PROD, rabaissé à créateur : il garde le droit de
    déployer, perd celui de lire et de poser ; relevé, il retrouve les deux."""
    liaison = {
        "principal": {
            "kind": "person",
            "issuer": ADMIN_PERSONNE.identite.issuer,
            "subject": ADMIN_PERSONNE.sujet,
        },
        "role": "creator",
    }
    chemin = f"{BASE}/catalogue/values/PROD"
    assert declare.requete(ADMIN_PERSONNE, "PUT", chemin, corps={"value": "un"}).status_code == 200
    assert (
        declare.requete(ADMIN_GROUPE, "POST", f"/api/spaces/{A}/members", corps=liaison).status_code
        == 200
    )
    vu = declare.requete(ADMIN_PERSONNE, "GET", f"/api/spaces/{A}").json()
    assert (vu["role"], vu["environments"][2]) == ("creator", {"code": "PROD", "deploy": True})
    avant = etat(declare.moteur)
    for methode, route, corps in (
        ("GET", BASE, None),
        ("PUT", chemin, {"value": "deux"}),
        ("DELETE", chemin, None),
    ):
        reponse = declare.requete(ADMIN_PERSONNE, methode, route, corps=corps)
        assert (reponse.status_code, reponse.json()) == (403, interdit("admin")), (methode, route)
    assert etat(declare.moteur) == avant
    liaison["role"] = "admin"
    assert (
        declare.requete(ADMIN_GROUPE, "POST", f"/api/spaces/{A}/members", corps=liaison).status_code
        == 200
    )
    assert [e["can_set"] for e in parametres(declare, ADMIN_PERSONNE)["environments"]] == [
        False,
        False,
        True,
    ]
    assert (
        declare.requete(ADMIN_PERSONNE, "PUT", chemin, corps={"value": "deux"}).status_code == 200
    )


def test_can_set_suit_les_groupes_de_la_session(declare: Monde) -> None:
    """Une session dont les groupes ne portent plus `finance-admins` : ni rôle ni droit."""
    sans_groupe = Profil("admin-sans-groupe", ADMIN_GROUPE.sujet, ())
    reponse = declare.requete(sans_groupe, "GET", BASE)
    assert (reponse.status_code, reponse.json()) == (404, INTROUVABLE)
    # Le même sujet, rattaché à la plateforme : il lit, sans rien pouvoir poser.
    plateforme = Profil("admin-devenu-plateforme", ADMIN_GROUPE.sujet, ("board-admins",))
    assert [e["can_set"] for e in parametres(declare, plateforme)["environments"]] == [
        False,
        False,
        False,
    ]


def test_plateforme_avec_un_accord_ne_pose_rien(declare: Monde) -> None:
    """Un accord au groupe de la plateforme reste sans effet sans rôle administrateur (P6) :
    `forbidden` `admin`, et non `deploy`, dans tous les environnements."""
    accorder(declare, A, DEV, GroupPrincipal("board-admins"))
    accorder(declare, A, TEST, GroupPrincipal("board-admins"))
    avant = etat(declare.moteur)
    for profil, code in itertools.product(
        (PLATEFORME_SEULE, PLATEFORME_LECTEUR), ("DEV", "TEST", "PROD")
    ):
        for methode, corps in (("PUT", {"value": "x"}), ("DELETE", None)):
            reponse = declare.requete(
                profil, methode, f"{BASE}/catalogue/values/{code}", corps=corps
            )
            assert (reponse.status_code, reponse.json()) == (403, interdit("admin"))
        assert all(not e["can_set"] for e in parametres(declare, profil)["environments"])
    assert etat(declare.moteur) == avant


# --- Ordre des contrôles. ----------------------------------------------------------------


def test_espace_avant_tout_le_reste(declare: Monde) -> None:
    """Espace inconnu : 404 `space_not_found`, quels que soient l'environnement, le nom et le
    corps."""
    for chemin, corps in (
        ("/api/spaces/inconnu/parameters/catalogue/values/QA", {"value": None}),
        ("/api/spaces/inconnu/parameters/HORS-FORMAT/values/DEV", "illisible"),
        ("/api/spaces/inconnu/parameters/HORS-FORMAT", {SENTINELLE: 1}),
    ):
        for profil in (ADMIN_GROUPE, NON_MEMBRE, PLATEFORME_SEULE):
            for methode in ("PUT", "DELETE"):
                reponse = declare.requete(profil, methode, chemin, corps=corps)
                assert (reponse.status_code, reponse.json()) == (404, INTROUVABLE), chemin
    # Non-membre de A : même réponse, avant l'environnement et le nom.
    reponse = declare.requete(NON_MEMBRE, "PUT", f"{BASE}/HORS/values/QA", corps={})
    assert (reponse.status_code, reponse.json()) == (404, INTROUVABLE)


def test_role_de_gestion_avant_environnement_nom_et_corps(declare: Monde) -> None:
    """Un lecteur ou un créateur ne découvre ni l'environnement valide, ni le nom, ni le corps
    attendu."""
    for profil in (LECTEUR_GROUPE, CREATEUR_GROUPE, CREATEUR_PERSONNE):
        for methode, chemin, corps in (
            ("PUT", f"{BASE}/catalogue/values/QA", {"value": "x"}),
            ("PUT", f"{BASE}/HORS-FORMAT/values/DEV", {"value": "x"}),
            ("PUT", f"{BASE}/inconnu/values/DEV", {SENTINELLE: 1}),
            ("DELETE", f"{BASE}/inconnu/values/qa", None),
            ("PUT", f"{BASE}/HORS-FORMAT", {SENTINELLE: 1}),
            ("PUT", f"{BASE}/inconnu", CATALOGUE),
            ("DELETE", f"{BASE}/inconnu", None),
            ("POST", BASE, {SENTINELLE: 1}),
        ):
            reponse = declare.requete(profil, methode, chemin, corps=corps)
            assert (reponse.status_code, reponse.json()) == (403, interdit("admin")), (
                profil.nom,
                methode,
                chemin,
            )


def test_environnement_invalide_avant_le_droit(declare: Monde) -> None:
    """Pour un gestionnaire, l'environnement du chemin est validé avant le rôle administrateur
    et le droit de déployer : la plateforme seule reçoit `invalid_request`, pas `forbidden`."""
    avant = etat(declare.moteur)
    for profil in (ADMIN_GROUPE, ADMIN_PERSONNE, PLATEFORME_SEULE, PLATEFORME_LECTEUR):
        for code in ("QA", "dev", "Dev", "PROD ", "DEV,TEST", "*", "%2A", SENTINELLE):
            for methode, corps in (("PUT", {"value": "x"}), ("DELETE", None)):
                chemin = f"{BASE}/catalogue/values/{code}"
                reponse = declare.requete(profil, methode, chemin, corps=corps)
                assert (reponse.status_code, reponse.json()) == (400, invalide("environment")), (
                    profil.nom,
                    code,
                )
                sans_trace(reponse.text)
    assert etat(declare.moteur) == avant


def test_role_administrateur_avant_le_droit_de_deployer(declare: Monde) -> None:
    """La plateforme seule, sans accord : `admin`, pas `deploy` ; un administrateur sans accord :
    `deploy` avec l'environnement."""
    reponse = declare.requete(
        PLATEFORME_SEULE, "PUT", f"{BASE}/catalogue/values/DEV", corps={"value": "x"}
    )
    assert (reponse.status_code, reponse.json()) == (403, interdit("admin"))
    reponse = declare.requete(
        ADMIN_GROUPE, "PUT", f"{BASE}/catalogue/values/PROD", corps={"value": "x"}
    )
    assert (reponse.status_code, reponse.json()) == (403, interdit("deploy", "PROD"))


def test_droit_de_deployer_avant_le_nom_et_le_corps(declare: Monde) -> None:
    """Sans droit en PROD, un nom inconnu ou hors format, un corps invalide ou une valeur hors
    contraintes donnent tous `forbidden` `deploy`."""
    avant = etat(declare.moteur)
    for methode, nom, corps in (
        ("PUT", "inconnu", {"value": "x"}),
        ("PUT", "HORS-FORMAT", {"value": "x"}),
        ("PUT", "catalogue", {SENTINELLE: 1}),
        ("PUT", "catalogue", {"value": "1 invalide"}),
        ("PUT", "catalogue", {"value": None}),
        ("DELETE", "inconnu", None),
        ("DELETE", "HORS-FORMAT", None),
    ):
        chemin = f"{BASE}/{nom}/values/PROD"
        reponse = declare.requete(ADMIN_GROUPE, methode, chemin, corps=corps)
        assert (reponse.status_code, reponse.json()) == (403, interdit("deploy", "PROD")), (
            methode,
            nom,
        )
    assert etat(declare.moteur) == avant


def test_nom_hors_format_avant_le_corps(declare: Monde) -> None:
    """Un nom hors format ne désigne aucun paramètre : 404 avant même de lire le corps."""
    for methode, chemin in (
        ("PUT", f"{BASE}/HORS-FORMAT/values/DEV"),
        ("PUT", f"{BASE}/HORS-FORMAT"),
    ):
        reponse = declare.requete(ADMIN_GROUPE, methode, chemin, contenu=b"{illisible")
        assert (reponse.status_code, reponse.json()) == (404, PARAMETRE_INCONNU), chemin


def test_corps_avant_l_existence_du_parametre(declare: Monde) -> None:
    """Un nom au bon format mais inconnu : le corps est validé d'abord (400), puis l'existence
    (404) ; une valeur hors contraintes sur un nom inconnu donne 404, la valeur ne pouvant être
    jugée sans déclaration."""
    for chemin in (f"{BASE}/inconnu/values/DEV", f"{BASE}/inconnu"):
        reponse = declare.requete(ADMIN_GROUPE, "PUT", chemin, contenu=b"{illisible")
        assert (reponse.status_code, reponse.json()) == (400, invalide("body")), chemin
    reponse = declare.requete(
        ADMIN_GROUPE, "PUT", f"{BASE}/inconnu/values/DEV", corps={"value": None}
    )
    assert (reponse.status_code, reponse.json()) == (404, PARAMETRE_INCONNU)
    reponse = declare.requete(ADMIN_GROUPE, "PUT", f"{BASE}/inconnu", corps=CATALOGUE)
    assert (reponse.status_code, reponse.json()) == (404, PARAMETRE_INCONNU)


# --- Paramètre inconnu, nom hors format dans le chemin. ----------------------------------

NOMS_HORS_FORMAT = [
    "Catalogue",
    "CATALOGUE",
    "1catalogue",
    "_catalogue",
    "catalogue-x",
    "catalogue.x",
    "a" * 64,
    "caté",
    "cat%C3%A9",
    "catalogue%20",
    "%20catalogue",
    "catalogue%0A",
    "cata%00logue",
    "cata%09logue",
    "%2E%2E",
    "%2E",
    "catalogue%3F",
    SENTINELLE,
]


@pytest.mark.parametrize("nom", NOMS_HORS_FORMAT)
def test_nom_hors_format_introuvable_sans_trace(declare: Monde, nom: str) -> None:
    avant = etat(declare.moteur)
    for methode, chemin, corps in (
        ("PUT", f"{BASE}/{nom}", CATALOGUE),
        ("DELETE", f"{BASE}/{nom}", None),
        ("PUT", f"{BASE}/{nom}/values/DEV", {"value": "x"}),
        ("DELETE", f"{BASE}/{nom}/values/DEV", None),
    ):
        for profil in (ADMIN_GROUPE, PLATEFORME_ADMIN):
            reponse = declare.requete(profil, methode, chemin, corps=corps)
            assert (reponse.status_code, reponse.json()) == (404, PARAMETRE_INCONNU), (
                methode,
                chemin,
            )
            sans_trace(reponse.text)
    assert etat(declare.moteur) == avant


def test_nom_encode_au_bon_format_designe_le_parametre(declare: Monde) -> None:
    """Le chemin est décodé avant d'être lu : `%63atalogue` est `catalogue`."""
    reponse = declare.requete(
        ADMIN_GROUPE, "PUT", f"{BASE}/%63atalogue/values/DEV", corps={"value": "encode"}
    )
    assert reponse.status_code == 200
    assert reponse.json()["name"] == "catalogue"
    reponse = declare.requete(
        ADMIN_GROUPE, "PUT", f"{BASE}/catalogue/values/%44EV", corps={"value": "encode2"}
    )
    assert (reponse.status_code, reponse.json()["environment"]) == (200, "DEV")


@pytest.mark.parametrize("nom", ["inconnu", "a", "a" * 63, "catalogue_", "catalogu"])
def test_nom_au_bon_format_mais_inconnu(declare: Monde, nom: str) -> None:
    avant = etat(declare.moteur)
    for profil in (ADMIN_GROUPE, PLATEFORME_SEULE, PLATEFORME_ADMIN):
        for methode, chemin, corps in (
            ("PUT", f"{BASE}/{nom}", CATALOGUE),
            ("DELETE", f"{BASE}/{nom}", None),
        ):
            reponse = declare.requete(profil, methode, chemin, corps=corps)
            assert (reponse.status_code, reponse.json()) == (404, PARAMETRE_INCONNU)
    for methode, corps in (("PUT", {"value": "x"}), ("DELETE", None)):
        reponse = declare.requete(ADMIN_GROUPE, methode, f"{BASE}/{nom}/values/DEV", corps=corps)
        assert (reponse.status_code, reponse.json()) == (404, PARAMETRE_INCONNU)
    assert etat(declare.moteur) == avant


def test_parametre_d_un_autre_espace_inconnu_ici(declare: Monde) -> None:
    declarer(declare, "propre_a_b", LIGNES, espace="rh", auteur=ADMIN_B)
    for methode, chemin, corps in (
        ("PUT", f"{BASE}/propre_a_b", LIGNES),
        ("DELETE", f"{BASE}/propre_a_b", None),
        ("PUT", f"{BASE}/propre_a_b/values/DEV", {"value": 1}),
        ("DELETE", f"{BASE}/propre_a_b/values/DEV", None),
    ):
        reponse = declare.requete(ADMIN_GROUPE, methode, chemin, corps=corps)
        assert (reponse.status_code, reponse.json()) == (404, PARAMETRE_INCONNU), (methode, chemin)


# --- Contrôle d'origine des écritures (plan 06, I8). -------------------------------------


def test_ecritures_hors_origine_refusees(declare: Monde) -> None:
    avant = etat(declare.moteur)
    ecritures = [(m, c, b) for _, m, c, b in ROUTES if m != "GET"]
    ecritures.append(("PUT", "/api/spaces/inconnu/parameters/x/values/QA", {"invalide": True}))
    for origine, profil, (methode, chemin, corps) in itertools.product(
        ORIGINES_REFUSEES, (PLATEFORME_ADMIN, None), ecritures
    ):
        reponse = declare.requete(profil, methode, chemin, corps=corps, origine=origine)
        assert (reponse.status_code, reponse.json()) == (
            403,
            {"error": {"code": "origin_refused"}},
        ), (origine, methode, chemin)
    assert etat(declare.moteur) == avant


def test_lecture_sans_origine_permise(declare: Monde) -> None:
    assert declare.requete(ADMIN_GROUPE, "GET", BASE, origine=None).status_code == 200
    assert (
        declare.requete(
            PLATEFORME_SEULE, "GET", BASE, origine="https://autre.example.invalid"
        ).status_code
        == 200
    )


def test_barre_encodee_dans_le_nom_suit_la_route_decodee(declare: Monde) -> None:
    """Constat : le chemin est décodé avant le routage, si bien que
    `/parameters/catalogue%2Fvalues%2FPROD` atteint la route des valeurs de PROD, et non le
    retrait d'un paramètre au nom hors format. Les droits restent ceux de la route atteinte :
    sans droit de déployer en PROD, refus `deploy`, et rien n'est retiré."""
    avant = etat(declare.moteur)
    chemin = f"{BASE}/catalogue%2Fvalues%2FPROD"
    reponse = declare.requete(ADMIN_GROUPE, "DELETE", chemin)
    assert (reponse.status_code, reponse.json()) == (403, interdit("deploy", "PROD"))
    assert etat(declare.moteur) == avant
    # Avec le droit, c'est bien la valeur de PROD qui est vidée, la déclaration reste.
    assert declare.requete(ADMIN_PERSONNE, "DELETE", chemin).status_code == 204
    corps = parametres(declare)
    assert [p["name"] for p in corps["parameters"]] == ["catalogue"]
    assert corps["environments"][2]["values"][0]["state"] == "missing"
