"""Isolation de deux espaces et révocation à la requête suivante (plan 08, E3, E4, E7, 8.2).

Un administrateur de A ne lit ni ne modifie rien de B, même en passant l'identifiant d'une
liaison de B dans une route de A. Retirer ou abaisser une liaison change la réponse de la
requête suivante, sur la même session, sans reconnexion.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from fastapi.testclient import TestClient
from identity.conftest import Cles, Fournisseur
from identity.conftest import claims as claims
from identity.conftest import cles as cles
from identity.conftest import config as config
from identity.conftest import fournisseur as fournisseur
from identity.conftest import horloge as horloge
from identity.test_web import connecter
from skifer_board.identity.model import Identity
from skifer_board.spaces import GroupPrincipal, Role
from state.conftest import migre as migre

from spaces.monde import (
    ADMIN_B,
    ADMIN_GROUPE,
    ADMIN_PERSONNE,
    EMETTEUR,
    LECTEUR_GROUPE,
    ORIGINE,
    PLATEFORME_SEULE,
    A,
    B,
    Monde,
    Profil,
    instantane,
)
from spaces.monde import config_plateforme as config_plateforme
from spaces.monde import monde as monde

INTROUVABLE = {"error": {"code": "space_not_found"}}
INTERDIT_ADMIN = {"error": {"code": "forbidden", "required": "admin"}}
ROUTES_LECTURE = (
    "",
    "/members",
    "/events",
    "/catalog",
    "/catalog/revenu-net",
    "/catalog/revenu-net/versions",
    "/catalog/revenu-net/diff?base=1&other=2",
)


def evenements(monde: Monde, espace: str) -> list[tuple[str, dict[str, Any]]]:
    return [(e.action, e.detail) for e in monde.magasin.events(espace)]


# --- B. Isolation de deux espaces ----------------------------------------------------------


def test_administrateur_de_a_ne_lit_rien_de_b(monde: Monde) -> None:
    for route in ROUTES_LECTURE:
        reponse = monde.requete(ADMIN_GROUPE, "GET", f"/api/spaces/{B}{route}")
        assert (reponse.status_code, reponse.json()) == (404, INTROUVABLE), route
    liste = monde.requete(ADMIN_GROUPE, "GET", "/api/spaces").json()
    assert [espace["id"] for espace in liste["spaces"]] == [A]
    # Le journal et les membres de A ne contiennent rien de B.
    membres = monde.requete(ADMIN_GROUPE, "GET", f"/api/spaces/{A}/members").json()["members"]
    assert {m["id"] for m in membres} == monde.liaison_ids(A)
    assert not {m["id"] for m in membres} & monde.liaison_ids(B)
    journal = monde.requete(ADMIN_GROUPE, "GET", f"/api/spaces/{A}/events").json()["events"]
    assert "rh-" not in str(journal)
    assert "Ressources humaines" not in str(journal)


def test_administrateur_de_a_ne_modifie_rien_de_b(monde: Monde) -> None:
    avant = instantane(monde.moteur)
    for liaison in ("b-lecteurs", "b-admins", "b-invitee"):
        identifiant = monde.liaisons[liaison]
        # Par l'adresse de B : B n'existe pas pour lui.
        reponse = monde.requete(ADMIN_GROUPE, "DELETE", f"/api/spaces/{B}/members/{identifiant}")
        assert (reponse.status_code, reponse.json()) == (404, INTROUVABLE)
        # Par l'adresse de A, avec l'identifiant d'une liaison de B : inconnue dans A.
        reponse = monde.requete(ADMIN_GROUPE, "DELETE", f"/api/spaces/{A}/members/{identifiant}")
        assert reponse.status_code == 404
        assert reponse.json() == {"error": {"code": "binding_not_found"}}
        # L'identifiant d'une liaison d'un autre espace n'est pas renvoyé.
        assert identifiant not in reponse.text
    for corps in (
        {"principal": {"kind": "group", "name": "finance-admins"}, "role": "admin"},
        {"principal": {"kind": "group", "name": "rh-lecteurs"}, "role": "reader"},
    ):
        reponse = monde.requete(ADMIN_GROUPE, "POST", f"/api/spaces/{B}/members", corps=corps)
        assert (reponse.status_code, reponse.json()) == (404, INTROUVABLE)
    assert instantane(monde.moteur) == avant


@pytest.mark.parametrize("profil", [PLATEFORME_SEULE, ADMIN_B], ids=lambda p: p.nom)
def test_liaison_d_un_autre_espace_inconnue_meme_pour_qui_gere_les_deux(
    monde: Monde, profil: Profil
) -> None:
    """La plateforme gère A et B : une liaison de A passée dans une route de B reste
    introuvable, et n'est pas retirée de A."""
    avant = instantane(monde.moteur)
    for liaison in ("a-stagiaires", "a-axel", "a-admins"):
        identifiant = monde.liaisons[liaison]
        reponse = monde.requete(profil, "DELETE", f"/api/spaces/{B}/members/{identifiant}")
        assert reponse.status_code == 404
        assert reponse.json() == {"error": {"code": "binding_not_found"}}
        # L'identifiant d'une liaison d'un autre espace n'est pas renvoyé.
        assert identifiant not in reponse.text
    assert instantane(monde.moteur) == avant


def test_modifier_une_liaison_de_a_ne_touche_pas_b(monde: Monde) -> None:
    journal_b = evenements(monde, B)
    liaisons_b = monde.magasin.bindings(B)
    # Le groupe `rh-lecteurs` est lié dans B ; le lier dans A crée une liaison distincte.
    corps = {"principal": {"kind": "group", "name": "rh-lecteurs"}, "role": "creator"}
    reponse = monde.requete(ADMIN_GROUPE, "POST", f"/api/spaces/{A}/members", corps=corps)
    assert reponse.status_code == 200
    assert reponse.json()["id"] not in {liaison.id for liaison in liaisons_b}
    retrait = monde.requete(
        ADMIN_GROUPE, "DELETE", f"/api/spaces/{A}/members/{reponse.json()['id']}"
    )
    assert retrait.status_code == 204
    assert monde.magasin.bindings(B) == liaisons_b
    assert evenements(monde, B) == journal_b


def test_un_groupe_lie_dans_a_ne_donne_rien_dans_b(monde: Monde) -> None:
    corps = {"principal": {"kind": "group", "name": "nouvelle-equipe"}, "role": "admin"}
    ajout = monde.requete(PLATEFORME_SEULE, "POST", f"/api/spaces/{A}/members", corps=corps)
    assert ajout.status_code == 200
    membre = Profil("nouvelle-equipe", "noe", ("nouvelle-equipe",))
    assert monde.requete(membre, "GET", f"/api/spaces/{A}").json()["role"] == "admin"
    assert monde.requete(membre, "GET", f"/api/spaces/{A}/members").status_code == 200
    for route in ROUTES_LECTURE:
        reponse = monde.requete(membre, "GET", f"/api/spaces/{B}{route}")
        assert (reponse.status_code, reponse.json()) == (404, INTROUVABLE), route
    assert [e["id"] for e in monde.requete(membre, "GET", "/api/spaces").json()["spaces"]] == [A]
    # Un lecteur de A par son groupe ne voit pas davantage B.
    for route in ROUTES_LECTURE:
        reponse = monde.requete(LECTEUR_GROUPE, "GET", f"/api/spaces/{B}{route}")
        assert (reponse.status_code, reponse.json()) == (404, INTROUVABLE), route


def test_meme_sujet_chez_un_autre_emetteur_n_est_pas_membre(monde: Monde) -> None:
    """La liaison d'Axel désigne son émetteur et son sujet ; le même sujet ailleurs n'est
    personne dans A (E3)."""
    sosie = Identity("https://autre.example.invalid", ADMIN_PERSONNE.sujet, None, None, ())
    jeton = monde.runtime.sessions.create(sosie, monde.horloge())
    entetes = {"Cookie": f"__Host-sb_session={jeton}"}
    for route in ROUTES_LECTURE:
        reponse = monde.client.get(f"/api/spaces/{A}{route}", headers=entetes)
        assert (reponse.status_code, reponse.json()) == (404, INTROUVABLE), route
    assert sosie.issuer != EMETTEUR


# --- C. Révocation à la requête suivante, sur la même session (E4) --------------------------


@pytest.fixture
def navigateur(monde: Monde) -> Iterator[TestClient]:
    """Un second navigateur sur le même serveur, connecté par le fournisseur simulé."""
    with TestClient(monde.app, base_url=ORIGINE, follow_redirects=False) as client:
        yield client


def connecter_comme(
    navigateur: TestClient,
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
    sujet: str,
    groupes: list[str],
) -> str:
    connecter(navigateur, fournisseur, cles, {**claims, "sub": sujet, "groups": groupes})
    return navigateur.cookies["__Host-sb_session"]


def test_retrait_d_une_liaison_de_groupe_effectif_a_la_requete_suivante(
    monde: Monde,
    navigateur: TestClient,
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
) -> None:
    jeton = connecter_comme(navigateur, fournisseur, cles, claims, "lea", ["finance-lecteurs"])
    assert navigateur.get(f"/api/spaces/{A}/catalog").status_code == 200
    assert navigateur.get(f"/api/spaces/{A}").json()["role"] == "reader"
    retrait = monde.requete(
        ADMIN_GROUPE, "DELETE", f"/api/spaces/{A}/members/{monde.liaisons['a-lecteurs']}"
    )
    assert retrait.status_code == 204
    # Même session, sans reconnexion : plus aucun accès, et A n'est plus listé.
    assert navigateur.cookies["__Host-sb_session"] == jeton
    for route in ROUTES_LECTURE:
        reponse = navigateur.get(f"/api/spaces/{A}{route}")
        assert (reponse.status_code, reponse.json()) == (404, INTROUVABLE), route
    assert navigateur.get("/api/spaces").json() == {"spaces": [], "platform_admin": False}
    assert navigateur.get("/api/me").status_code == 200


def test_abaissement_et_elevation_effectifs_a_la_requete_suivante(
    monde: Monde,
    navigateur: TestClient,
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
) -> None:
    connecter_comme(navigateur, fournisseur, cles, claims, "lea", ["finance-lecteurs"])
    groupe = {"kind": "group", "name": "finance-lecteurs"}
    attendus = (
        ("admin", 200, "admin"),
        ("creator", 403, "creator"),
        ("reader", 403, "reader"),
        ("admin", 200, "admin"),
    )
    for role, statut_membres, role_vu in attendus:
        reponse = monde.requete(
            PLATEFORME_SEULE,
            "POST",
            f"/api/spaces/{A}/members",
            corps={"principal": groupe, "role": role},
        )
        assert reponse.status_code == 200
        assert navigateur.get(f"/api/spaces/{A}").json()["role"] == role_vu
        membres = navigateur.get(f"/api/spaces/{A}/members")
        assert membres.status_code == statut_membres
        if statut_membres == 403:
            assert membres.json() == INTERDIT_ADMIN
        assert navigateur.get(f"/api/spaces/{A}/catalog").status_code == 200


def test_abaissement_d_un_administrateur_par_personne(monde: Monde) -> None:
    """Axel administre A par une liaison de personne ; abaissé, il perd la gestion dès sa
    requête suivante, et l'écriture qu'il tente est refusée sans rien changer."""
    assert monde.requete(ADMIN_PERSONNE, "GET", f"/api/spaces/{A}/members").status_code == 200
    principal = {"kind": "person", "issuer": EMETTEUR, "subject": ADMIN_PERSONNE.sujet}
    abaisse = monde.requete(
        ADMIN_GROUPE,
        "POST",
        f"/api/spaces/{A}/members",
        corps={"principal": principal, "role": "reader"},
    )
    assert abaisse.status_code == 200
    assert abaisse.json()["role"] == "reader"
    avant = instantane(monde.moteur)
    for methode, chemin, corps in (
        ("GET", f"/api/spaces/{A}/members", None),
        ("GET", f"/api/spaces/{A}/events", None),
        ("GET", "/api/people?q=Nom", None),
        (
            "POST",
            f"/api/spaces/{A}/members",
            {"principal": principal, "role": "admin"},
        ),
        ("DELETE", f"/api/spaces/{A}/members/{monde.liaisons['a-admins']}", None),
    ):
        reponse = monde.requete(ADMIN_PERSONNE, methode, chemin, corps=corps)
        assert (reponse.status_code, reponse.json()) == (403, INTERDIT_ADMIN), chemin
    assert instantane(monde.moteur) == avant
    assert monde.requete(ADMIN_PERSONNE, "GET", f"/api/spaces/{A}").json()["role"] == "reader"
    # Retirée, la liaison de personne ne laisse plus rien voir.
    retrait = monde.requete(
        ADMIN_GROUPE, "DELETE", f"/api/spaces/{A}/members/{monde.liaisons['a-axel']}"
    )
    assert retrait.status_code == 204
    reponse = monde.requete(ADMIN_PERSONNE, "GET", f"/api/spaces/{A}")
    assert (reponse.status_code, reponse.json()) == (404, INTROUVABLE)


def test_role_le_plus_eleve_des_liaisons_restantes(monde: Monde) -> None:
    """Groupe lecteur et personne administrateur : retirer la liaison de personne laisse le
    rôle du groupe, à la requête suivante (E3, E4)."""
    double = Profil("double", ADMIN_PERSONNE.sujet, ("finance-lecteurs",))
    assert monde.requete(double, "GET", f"/api/spaces/{A}").json()["role"] == "admin"
    monde.requete(ADMIN_GROUPE, "DELETE", f"/api/spaces/{A}/members/{monde.liaisons['a-axel']}")
    assert monde.requete(double, "GET", f"/api/spaces/{A}").json()["role"] == "reader"
    monde.magasin.set_binding(
        A, GroupPrincipal("finance-lecteurs"), Role.CREATOR, PLATEFORME_SEULE.ref, monde.horloge()
    )
    assert monde.requete(double, "GET", f"/api/spaces/{A}").json()["role"] == "creator"
