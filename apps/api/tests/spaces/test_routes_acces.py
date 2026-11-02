"""Matrice d'accès des routes d'espaces (plan 08, 8.2 ; E2, E6, E7, E9).

Chaque route est appelée par chaque profil sur le serveur réel : lecteur, créateur et
administrateur de l'espace (chacun par un groupe et par une liaison de personne), non-membre,
administrateur de la plateforme sans rôle, et administrateur de la plateforme qui est aussi
lecteur. Statuts et corps sont comparés exactement.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import Mock

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
from skifer_board.spaces import Role
from state.conftest import migre as migre

from spaces.monde import (
    ADMIN_B,
    ADMIN_GROUPE,
    ADMIN_PERSONNE,
    ATLAS,
    COOKIE,
    CREATEUR_GROUPE,
    CREATEUR_PERSONNE,
    LECTEUR_GROUPE,
    LECTEUR_PERSONNE,
    NON_MEMBRE,
    ORIGINE,
    PLATEFORME_LECTEUR,
    PLATEFORME_SEULE,
    A,
    B,
    Monde,
    Profil,
    appel_brut,
    instantane,
)
from spaces.monde import config_plateforme as config_plateforme
from spaces.monde import monde as monde

INTROUVABLE = {"error": {"code": "space_not_found"}}
PROFILS_MATRICE = (
    LECTEUR_GROUPE,
    LECTEUR_PERSONNE,
    CREATEUR_GROUPE,
    CREATEUR_PERSONNE,
    ADMIN_GROUPE,
    ADMIN_PERSONNE,
    NON_MEMBRE,
    PLATEFORME_SEULE,
    PLATEFORME_LECTEUR,
)
# Rôle de chaque profil dans A, et s'il administre la plateforme.
ROLES: dict[str, Role | None] = {
    LECTEUR_GROUPE.nom: Role.READER,
    LECTEUR_PERSONNE.nom: Role.READER,
    CREATEUR_GROUPE.nom: Role.CREATOR,
    CREATEUR_PERSONNE.nom: Role.CREATOR,
    ADMIN_GROUPE.nom: Role.ADMIN,
    ADMIN_PERSONNE.nom: Role.ADMIN,
    NON_MEMBRE.nom: None,
    PLATEFORME_SEULE.nom: None,
    PLATEFORME_LECTEUR.nom: Role.READER,
}
PLATEFORME = {PLATEFORME_SEULE.nom, PLATEFORME_LECTEUR.nom}
CATALOGUE = (
    "/catalog",
    "/catalog/revenu-net",
    "/catalog/revenu-net/versions",
    "/catalog/revenu-net/diff?base=1&other=2",
)


def interdit(requis: str) -> dict[str, Any]:
    return {"error": {"code": "forbidden", "required": requis}}


def espace_json(monde: Monde, espace: str, nom: str, role: Role | None) -> dict[str, Any]:
    return {
        "id": espace,
        "name": nom,
        "atlas": ATLAS,
        "created_at": monde.horloge().isoformat(),
        "created_by": {"issuer": PLATEFORME_SEULE.ref.issuer, "subject": "pia"},
        "role": None if role is None else role.value,
        "implicit": False,
    }


def reference_catalogue(service: CatalogService) -> dict[str, tuple[int, Any]]:
    """Réponses du catalogue en mode local : celles qu'un lecteur doit recevoir dans A."""
    with TestClient(create_app(service)) as local:
        return {
            route: (reponse.status_code, reponse.json())
            for route in CATALOGUE
            for reponse in [local.get(f"/api/spaces/local{route}")]
        }


@pytest.mark.parametrize("profil", PROFILS_MATRICE, ids=lambda p: p.nom)
def test_matrice_des_routes(monde: Monde, service: CatalogService, profil: Profil) -> None:
    role = ROLES[profil.nom]
    plateforme = profil.nom in PLATEFORME
    membre = role is not None
    gere = plateforme or role is Role.ADMIN
    references = reference_catalogue(service)
    liaisons_a = monde.liaison_ids(A)
    ecarts: list[str] = []

    def verifier(
        methode: str,
        chemin: str,
        statut: int,
        corps: object,
        envoi: object = None,
    ) -> Any:
        reponse = monde.requete(profil, methode, chemin, corps=envoi)
        obtenu = None if statut == 204 else reponse.json()
        if reponse.status_code != statut or (corps is not ... and obtenu != corps):
            ecarts.append(f"{methode} {chemin} : {reponse.status_code} {reponse.text}")
        if statut == 204 and reponse.status_code == 204:
            assert reponse.content == b""
        return obtenu

    # GET /api/spaces : ses espaces avec son rôle ; tous pour la plateforme (8.2).
    visibles = []
    if membre or plateforme:
        visibles.append(espace_json(monde, A, "Finance", role))
    if plateforme:
        visibles.append(espace_json(monde, B, "Ressources humaines", None))
    verifier("GET", "/api/spaces", 200, {"spaces": visibles, "platform_admin": plateforme})

    # GET /api/spaces/{A} : l'espace et le rôle ; 404 pour un non-membre (E7).
    vu = membre or plateforme
    verifier(
        "GET",
        f"/api/spaces/{A}",
        200 if vu else 404,
        espace_json(monde, A, "Finance", role) if vu else INTROUVABLE,
    )

    # Membres et journal : administrateurs de l'espace et de la plateforme.
    for route in ("members", "events"):
        if gere:
            obtenu = verifier("GET", f"/api/spaces/{A}/{route}", 200, ...)
            if route == "members" and isinstance(obtenu, dict):
                assert {m["id"] for m in obtenu["members"]} == liaisons_a
            if route == "events" and isinstance(obtenu, dict):
                assert len(obtenu["events"]) == 2 + 6
                assert {e["action"] for e in obtenu["events"]} == {
                    "space_created",
                    "binding_added",
                }
        else:
            verifier(
                "GET",
                f"/api/spaces/{A}/{route}",
                403 if vu else 404,
                interdit("admin") if vu else INTROUVABLE,
            )

    # Recherche de personnes : administrateurs d'au moins un espace, ou de la plateforme.
    if gere:
        trouve = verifier("GET", "/api/people?q=Nom%20ines", 200, ...)
        if isinstance(trouve, dict) and "people" in trouve:
            assert [personne["subject"] for personne in trouve["people"]] == ["ines"]
    else:
        verifier("GET", "/api/people?q=Nom%20ines", 403, interdit("admin"))

    # Catalogue : lecteur et au-delà ; jamais la plateforme seule (E6, E9).
    for route in CATALOGUE:
        chemin = f"/api/spaces/{A}{route}"
        if membre:
            statut, corps = references[route]
            verifier("GET", chemin, statut, corps)
        elif plateforme:
            verifier("GET", chemin, 403, interdit("reader"))
        else:
            verifier("GET", chemin, 404, INTROUVABLE)

    # Écritures, en dernier : ajout puis retrait d'une liaison, puis création d'un espace.
    avant = instantane(monde.moteur)
    ajout = {"principal": {"kind": "group", "name": "finance-invites"}, "role": "reader"}
    if gere:
        cree = verifier("POST", f"/api/spaces/{A}/members", 200, ..., ajout)
        if isinstance(cree, dict):
            assert cree["principal"] == ajout["principal"]
            assert cree["role"] == "reader"
            assert cree["created_by"] == {"issuer": profil.ref.issuer, "subject": profil.sujet}
        verifier("DELETE", f"/api/spaces/{A}/members/{monde.liaisons['a-stagiaires']}", 204, None)
        assert monde.liaisons["a-stagiaires"] not in monde.liaison_ids(A)
    else:
        statut, refus = (403, interdit("admin")) if vu else (404, INTROUVABLE)
        verifier("POST", f"/api/spaces/{A}/members", statut, refus, ajout)
        cible = monde.liaisons["a-stagiaires"]
        verifier("DELETE", f"/api/spaces/{A}/members/{cible}", statut, refus)
        assert instantane(monde.moteur) == avant

    creation = {
        "id": "nouveau",
        "name": "Nouveau",
        "first_admin": {"kind": "group", "name": "nouveau-admins"},
    }
    if plateforme:
        cree = verifier("POST", "/api/spaces", 201, ..., creation)
        if isinstance(cree, dict):
            assert cree == {
                **espace_json(monde, "nouveau", "Nouveau", None),
                "created_by": {"issuer": profil.ref.issuer, "subject": profil.sujet},
            }
    else:
        avant = instantane(monde.moteur)
        verifier("POST", "/api/spaces", 403, interdit("platform_admin"), creation)
        assert instantane(monde.moteur) == avant

    assert ecarts == []


# --- Même réponse pour un espace inconnu et un espace dont on n'est pas membre (E7). --------

HORS_FORMAT = (
    "Finance",
    "FINANCE",
    "%2E%2E",
    "a" * 41,
    "f",
    "-finance",
    "finance-",
    "fin_ance",
    "fin%20ance",
    "%C3%A9t%C3%A9",
    "finance%00",
    "finance%0A",
)
DESIGNATIONS = (A, B, "%66inance", "inconnu", "a" * 40, *HORS_FORMAT)


def routes_d_espace(monde: Monde, espace: str) -> list[tuple[str, str, object]]:
    liaison = monde.liaisons["a-axel"]
    valide = {"principal": {"kind": "group", "name": "intrus"}, "role": "admin"}
    return [
        ("GET", f"/api/spaces/{espace}", None),
        ("GET", f"/api/spaces/{espace}/members", None),
        ("POST", f"/api/spaces/{espace}/members", valide),
        ("POST", f"/api/spaces/{espace}/members", {"inattendu": True}),
        ("POST", f"/api/spaces/{espace}/members", b"{illisible"),
        ("DELETE", f"/api/spaces/{espace}/members/{liaison}", None),
        ("DELETE", f"/api/spaces/{espace}/members/inconnue", None),
        ("GET", f"/api/spaces/{espace}/events", None),
        *[("GET", f"/api/spaces/{espace}{route}", None) for route in CATALOGUE],
    ]


def empreinte(
    monde: Monde, profil: Profil, methode: str, chemin: str, envoi: object
) -> tuple[int, bytes, dict[str, str]]:
    if isinstance(envoi, bytes):
        reponse = monde.requete(profil, methode, chemin, contenu=envoi)
    else:
        reponse = monde.requete(profil, methode, chemin, corps=envoi)
    entetes = {
        cle: valeur for cle, valeur in reponse.headers.items() if cle not in ("date", "server")
    }
    return reponse.status_code, reponse.content, entetes


def test_non_membre_ne_distingue_aucun_espace(monde: Monde) -> None:
    avant = instantane(monde.moteur)
    empreintes = {
        (methode, route, repr(envoi)): empreinte(monde, NON_MEMBRE, methode, route, envoi)
        for designation in DESIGNATIONS
        for methode, route, envoi in routes_d_espace(monde, designation)
    }
    assert len(empreintes) == len(DESIGNATIONS) * len(routes_d_espace(monde, A))
    attendu = (404, b'{"error":{"code":"space_not_found"}}')
    for cle, (statut, contenu, entetes) in empreintes.items():
        assert (statut, contenu) == attendu, cle
        assert entetes == {"content-length": str(len(contenu)), "content-type": "application/json"}
    assert instantane(monde.moteur) == avant


@pytest.mark.parametrize(
    "profil", [ADMIN_GROUPE, PLATEFORME_SEULE, LECTEUR_GROUPE, ADMIN_B], ids=lambda p: p.nom
)
def test_espace_inconnu_ou_hors_format_meme_reponse_pour_tous(monde: Monde, profil: Profil) -> None:
    """Même un administrateur de la plateforme ne distingue pas un identifiant hors format
    d'un espace inconnu ; un administrateur de B ne voit pas A."""
    designations = ["inconnu", "a" * 40, *HORS_FORMAT]
    if profil is ADMIN_B:
        designations.append(A)
    for designation in designations:
        for methode, route, envoi in routes_d_espace(monde, designation):
            statut, contenu, _ = empreinte(monde, profil, methode, route, envoi)
            assert (statut, contenu) == (404, b'{"error":{"code":"space_not_found"}}'), route


@pytest.mark.parametrize(
    "chemin",
    ["/api/spaces/..", "/api/spaces/../members", "/api/spaces/./catalog", "/api/spaces/../events"],
)
def test_segments_point_bruts(monde: Monde, chemin: str) -> None:
    """Un `..` reçu tel quel, sans normalisation par un client, ne désigne aucun espace."""
    statut, entetes, corps = appel_brut(
        monde.app, "GET", chemin, {"cookie": f"{COOKIE}={monde.session(PLATEFORME_SEULE)}"}
    )
    assert (statut, corps) == (404, b'{"error":{"code":"space_not_found"}}')
    assert entetes["content-type"] == "application/json"


def test_designation_encodee_vaut_l_identifiant(monde: Monde) -> None:
    """`%66inance` est décodé en `finance` avant la décision : même rôle, même refus."""
    assert monde.requete(LECTEUR_GROUPE, "GET", "/api/spaces/%66inance").json()["role"] == "reader"
    reponse = monde.requete(LECTEUR_GROUPE, "GET", "/api/spaces/%66inance/members")
    assert (reponse.status_code, reponse.json()) == (403, interdit("admin"))


# --- Administrateur de la plateforme sans rôle : aucun catalogue (E6). ----------------------


def test_plateforme_sans_role_ne_lit_aucun_catalogue(
    monde: Monde, service: CatalogService, monkeypatch: pytest.MonkeyPatch
) -> None:
    for nom in ("list", "get", "versions", "diff"):
        monkeypatch.setattr(service, nom, Mock(side_effect=AssertionError("service appelé")))
    for designation in (A, B):
        for route in CATALOGUE:
            reponse = monde.requete(PLATEFORME_SEULE, "GET", f"/api/spaces/{designation}{route}")
            assert reponse.status_code == 403
            assert reponse.json() == interdit("reader")
    # Il gère pourtant les membres de ces espaces.
    assert monde.requete(PLATEFORME_SEULE, "GET", f"/api/spaces/{B}/members").status_code == 200


def test_non_lecteur_n_atteint_jamais_le_service(
    monde: Monde, service: CatalogService, monkeypatch: pytest.MonkeyPatch
) -> None:
    for nom in ("list", "get", "versions", "diff"):
        monkeypatch.setattr(service, nom, Mock(side_effect=AssertionError("service appelé")))
    for profil, designation in ((NON_MEMBRE, A), (ADMIN_GROUPE, B), (LECTEUR_GROUPE, "inconnu")):
        for route in CATALOGUE:
            reponse = monde.requete(profil, "GET", f"/api/spaces/{designation}{route}")
            assert (reponse.status_code, reponse.json()) == (404, INTROUVABLE)


# --- Aucun rôle reçu du navigateur n'est cru (E7). -----------------------------------------


def test_role_annonce_par_le_navigateur_ignore(monde: Monde) -> None:
    entetes = {
        "Cookie": f"{COOKIE}={monde.session(LECTEUR_GROUPE)}; role=admin; platform_admin=true",
        "Origin": ORIGINE,
        "X-Role": "admin",
        "X-Platform-Admin": "true",
        "X-Forwarded-User": ADMIN_GROUPE.sujet,
        "X-Groups": "finance-admins,board-admins",
    }
    for methode, chemin in (
        ("GET", f"/api/spaces/{A}/members?role=admin&platform_admin=true"),
        ("GET", f"/api/spaces/{A}/events?role=admin"),
        ("GET", "/api/people?q=Nom&role=admin"),
        ("DELETE", f"/api/spaces/{A}/members/{monde.liaisons['a-stagiaires']}?role=admin"),
    ):
        reponse = monde.client.request(methode, chemin, headers=entetes)
        assert (reponse.status_code, reponse.json()) == (403, interdit("admin")), chemin
    corps = {"id": "pirate", "name": "Pirate", "first_admin": {"kind": "group", "name": "x"}}
    reponse = monde.client.post("/api/spaces?platform_admin=true", json={**corps}, headers=entetes)
    assert (reponse.status_code, reponse.json()) == (403, interdit("platform_admin"))
    vu = monde.client.get(f"/api/spaces/{A}", headers=entetes).json()
    assert vu["role"] == "reader"
    assert monde.client.get("/api/spaces", headers=entetes).json()["platform_admin"] is False


# --- Les anciennes routes du catalogue ont disparu, avec ou sans session (E9). --------------


@pytest.mark.parametrize(
    "route",
    [
        "/api/catalog",
        "/api/catalog/revenu-net",
        "/api/catalog/revenu-net/versions",
        "/api/catalog/revenu-net/diff?base=1&other=2",
    ],
)
@pytest.mark.parametrize("profil", [ADMIN_GROUPE, PLATEFORME_LECTEUR], ids=lambda p: p.nom)
def test_anciennes_routes_du_catalogue_avec_session(
    monde: Monde, profil: Profil, route: str
) -> None:
    reponse = monde.requete(profil, "GET", route)
    assert (reponse.status_code, reponse.json()) == (404, {"error": {"code": "route_not_found"}})
    # Sans session, la garde répond d'abord, comme pour toute route `/api`.
    anonyme = monde.requete(None, "GET", route)
    assert anonyme.status_code == 401
