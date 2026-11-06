"""Droits sur les analyses : rôle x visibilité x action, et absence de fuite (plan 18.2, A5).

Chaque cas crée une analyse neuve par son propriétaire (`cora`, créatrice), puis fait agir un
profil. Une analyse personnelle d'un autre se comporte, sur chaque route, comme une analyse
inexistante : même statut, même corps, et aucune trace de son nom dans la réponse.
"""

from __future__ import annotations

import pytest
from httpx2 import Response
from spaces.monde import (
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
    Profil,
)

from .monde import new_id
from .serveur import CHEMIN, Banc, corps

NOM = "Marge secrete du trimestre"
INCONNUE = "11111111-1111-4111-8111-111111111111"
LECTURES = ("read", "history", "revision", "diff")
ECRITURES = ("revise", "duplicate", "delete")


def agir(banc: Banc, profil: Profil, action: str, ident: str, visibilite: str) -> Response:
    base = f"{CHEMIN}/{ident}"
    if action == "read":
        return banc.appel(profil, "GET", base)
    if action == "history":
        return banc.appel(profil, "GET", f"{base}/revisions")
    if action == "revision":
        return banc.appel(profil, "GET", f"{base}/revisions/1")
    if action == "diff":
        return banc.appel(profil, "GET", f"{base}/diff", params={"base": "1", "other": "1"})
    if action == "revise":
        return banc.reviser(profil, ident, 1, visibility=visibilite, name="Révisée")
    if action == "duplicate":
        return banc.appel(profil, "POST", f"{base}/duplicate")
    assert action == "delete"
    return banc.appel(profil, "DELETE", base, params={"expected_revision": "1"})


# Statut de chaque écriture (réviser, dupliquer, supprimer) d'un membre qui n'est pas le
# propriétaire, sur une analyse partagée.
ECRITURES_PARTAGEE = {
    LECTEUR_GROUPE: (403, 403, 403),
    LECTEUR_PERSONNE: (403, 403, 403),
    PLATEFORME_LECTEUR: (403, 403, 403),
    CREATEUR_PERSONNE: (403, 201, 403),
    ADMIN_GROUPE: (201, 201, 204),
    ADMIN_PERSONNE: (201, 201, 204),
}
SANS_ROLE_ECRIRE = {LECTEUR_GROUPE, LECTEUR_PERSONNE, PLATEFORME_LECTEUR}
MEMBRES = (
    LECTEUR_GROUPE,
    LECTEUR_PERSONNE,
    PLATEFORME_LECTEUR,
    CREATEUR_PERSONNE,
    ADMIN_GROUPE,
    ADMIN_PERSONNE,
)


def dans_la_liste(banc: Banc, profil: Profil, ident: str) -> bool:
    reponse = banc.appel(profil, "GET", CHEMIN)
    assert reponse.status_code == 200, reponse.text
    return ident in {item["id"] for item in reponse.json()["analyses"]}


def test_le_proprietaire_fait_tout_de_ses_analyses(banc: Banc) -> None:
    for visibilite in ("personal", "shared"):
        attendus = {"revise": 201, "duplicate": 201, "delete": 204}
        for action in (*LECTURES, *ECRITURES):
            ident = banc.creer_ok(CREATEUR_GROUPE, visibility=visibilite, name=NOM)
            reponse = agir(banc, CREATEUR_GROUPE, action, ident, visibilite)
            assert reponse.status_code == attendus.get(action, 200), (action, reponse.text)
        ident = banc.creer_ok(CREATEUR_GROUPE, visibility=visibilite, name=NOM)
        assert dans_la_liste(banc, CREATEUR_GROUPE, ident)


@pytest.mark.parametrize("profil", MEMBRES, ids=lambda profil: profil.nom)
def test_une_analyse_personnelle_n_existe_pas_pour_les_autres(banc: Banc, profil: Profil) -> None:
    """Administrateurs compris : ni lecture, ni historique, ni écart, ni liste."""
    for action in (*LECTURES, *ECRITURES):
        ident = banc.creer_ok(CREATEUR_GROUPE, visibility="personal", name=NOM)
        reponse = agir(banc, profil, action, ident, "personal")
        inconnue = agir(banc, profil, action, INCONNUE, "personal")
        assert reponse.status_code == inconnue.status_code, action
        assert reponse.json() == inconnue.json(), action
        assert reponse.status_code == (
            403 if action in ECRITURES and profil in SANS_ROLE_ECRIRE else 404
        )
        assert "Marge" not in reponse.text and NOM not in reponse.text
        assert not dans_la_liste(banc, profil, ident)
    # Rien n'a été écrit pour autant.
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="personal", name=NOM)
    assert (
        banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions").json()["revisions"][0][
            "action"
        ]
        == "save"
    )
    assert (
        len(banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions").json()["revisions"])
        == 1
    )


@pytest.mark.parametrize("profil", MEMBRES, ids=lambda profil: profil.nom)
def test_une_analyse_partagee_selon_le_role(banc: Banc, profil: Profil) -> None:
    revisee, dupliquee, supprimee = ECRITURES_PARTAGEE[profil]
    attendus = {"revise": revisee, "duplicate": dupliquee, "delete": supprimee}
    for action in (*LECTURES, *ECRITURES):
        ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared", name=NOM)
        reponse = agir(banc, profil, action, ident, "shared")
        assert reponse.status_code == attendus.get(action, 200), (action, reponse.text)
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared", name=NOM)
    assert dans_la_liste(banc, profil, ident)


def test_un_refus_ne_change_rien(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared", name=NOM)
    for profil in (LECTEUR_GROUPE, CREATEUR_PERSONNE):
        assert agir(banc, profil, "revise", ident, "shared").status_code == 403
        assert agir(banc, profil, "delete", ident, "shared").status_code == 403
    historique = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/revisions").json()
    assert len(historique["revisions"]) == 1 and historique["deleted"] is False


def test_un_administrateur_ne_rend_pas_personnelle_une_analyse_partagee(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    refus = banc.reviser(ADMIN_GROUPE, ident, 1, visibility="personal")
    assert refus.status_code == 403
    assert refus.json() == {"error": {"code": "forbidden", "required": "owner"}}
    # Le propriétaire, lui, le peut : l'analyse devient la sienne seule.
    assert banc.reviser(CREATEUR_GROUPE, ident, 1, visibility="personal").status_code == 201
    assert banc.appel(ADMIN_GROUPE, "GET", f"{CHEMIN}/{ident}").status_code == 404


def test_un_proprietaire_devenu_lecteur_ne_revise_plus(banc: Banc) -> None:
    """Le rôle se recalcule à chaque requête : être propriétaire ne suffit pas."""
    ident = new_id()
    document = {
        "api_version": "board.analysis/v1",
        "id": ident,
        **corps(visibility="shared"),
        "owner": {"issuer": LECTEUR_GROUPE.ref.issuer, "subject": LECTEUR_GROUPE.ref.subject},
    }
    banc.depot.write(A, ident, document, expected_revision=None, actor=LECTEUR_GROUPE.ref)
    assert banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}").status_code == 200
    for action in ECRITURES:
        assert agir(banc, LECTEUR_GROUPE, action, ident, "shared").status_code == 403


def test_un_administrateur_proprietaire_garde_son_analyse_personnelle(banc: Banc) -> None:
    ident = banc.creer_ok(ADMIN_GROUPE, visibility="personal")
    assert banc.appel(ADMIN_GROUPE, "GET", f"{CHEMIN}/{ident}").status_code == 200
    assert banc.appel(ADMIN_PERSONNE, "GET", f"{CHEMIN}/{ident}").status_code == 404
    assert banc.reviser(ADMIN_PERSONNE, ident, 1).status_code == 404


@pytest.mark.parametrize(
    ("profil", "statut"),
    [
        (LECTEUR_GROUPE, 403),
        (LECTEUR_PERSONNE, 403),
        (PLATEFORME_LECTEUR, 403),
        (PLATEFORME_SEULE, 403),
        (NON_MEMBRE, 404),
        (CREATEUR_GROUPE, 201),
        (CREATEUR_PERSONNE, 201),
        (ADMIN_GROUPE, 201),
        (ADMIN_PERSONNE, 201),
    ],
    ids=lambda valeur: getattr(valeur, "nom", str(valeur)),
)
def test_creer_exige_createur_ou_administrateur(banc: Banc, profil: Profil, statut: int) -> None:
    reponse = banc.creer(profil, name=NOM)
    assert reponse.status_code == statut, reponse.text
    if statut == 201:
        # Le propriétaire est la session, jamais le corps.
        assert reponse.json()["analysis"]["owner"] == {
            "issuer": profil.ref.issuer,
            "subject": profil.ref.subject,
        }
        assert reponse.json()["permissions"]["owner"] is True
    else:
        assert "Marge" not in reponse.text
        assert banc.depot.analyses() == ()


@pytest.mark.parametrize("profil", [PLATEFORME_SEULE, NON_MEMBRE], ids=lambda profil: profil.nom)
def test_sans_role_dans_l_espace_toutes_les_routes_refusent(banc: Banc, profil: Profil) -> None:
    """Administrateur de la plateforme sans rôle : 403 ; étranger à l'espace : 404, comme
    un espace inexistant."""
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared", name=NOM)
    statut = 403 if profil is PLATEFORME_SEULE else 404
    for action in (*LECTURES, *ECRITURES):
        reponse = agir(banc, profil, action, ident, "shared")
        assert reponse.status_code == statut, action
        assert "Marge" not in reponse.text
    assert banc.appel(profil, "GET", CHEMIN).status_code == statut
    assert banc.appel(profil, "POST", CHEMIN, json=corps()).status_code == statut


def test_sans_session_l_acces_est_refuse(banc: Banc) -> None:
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    for methode, chemin in (
        ("GET", CHEMIN),
        ("GET", f"{CHEMIN}/{ident}"),
        ("GET", f"{CHEMIN}/{ident}/revisions"),
        ("POST", CHEMIN),
        ("DELETE", f"{CHEMIN}/{ident}"),
    ):
        assert banc.appel(None, methode, chemin).status_code == 401, (methode, chemin)


def test_un_autre_espace_ne_voit_pas_l_analyse(banc: Banc) -> None:
    """L'analyse est rangée par espace : le même identifiant dans l'espace voisin n'existe pas."""
    ident = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    voisin = CHEMIN.replace(A, "rh")
    for profil in (ADMIN_GROUPE, LECTEUR_GROUPE):
        assert banc.appel(profil, "GET", f"{voisin}/{ident}").status_code == 404
