"""Droits sur les dashboards : rôle x visibilité x action, et absence de fuite (plan 19.2, B4 à B7).

Mêmes règles que pour les analyses (A5). Chaque cas crée un dashboard neuf par son propriétaire
(`cora`, créatrice), puis fait agir un profil. Un dashboard personnel d'un autre, supprimé ou
inexistant se comporte, sur chaque route, de la même façon : mêmes statut, corps et en-têtes, et
aucune trace de son nom dans la réponse.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from httpx2 import Response
from skifer_board.catalog import CatalogService
from skifer_board.content import ContentRepository
from skifer_board.content.repository import DASHBOARD_KIND
from skifer_board.server import create_app
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

from .monde import init, repository
from .monde_dashboard import text
from .serveur import CHEMIN_TABLEAUX, Banc, corps_tableau

NOM = "Marge secrete du trimestre"
PUBLIC = "Version publiee"
INCONNUE = "11111111-1111-4111-8111-111111111111"
LECTURES = ("read", "history", "revision", "diff")
ECRITURES = ("revise", "duplicate", "delete")
# Statut de chaque écriture (réviser, dupliquer, supprimer) d'un membre qui n'est pas le
# propriétaire, sur un dashboard partagé.
ECRITURES_PARTAGE = {
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
MASQUEE = {"revision": 1, "available": False}


def creer(banc: Banc, visibilite: str, profil: Profil = CREATEUR_GROUPE, nom: str = NOM) -> str:
    return banc.creer_tableau_ok(profil, text(), visibility=visibilite, name=nom)


def agir(banc: Banc, profil: Profil, action: str, ident: str, visibilite: str) -> Response:
    base = f"{CHEMIN_TABLEAUX}/{ident}"
    if action == "read":
        return banc.appel(profil, "GET", base)
    if action == "history":
        return banc.appel(profil, "GET", f"{base}/revisions")
    if action == "revision":
        return banc.appel(profil, "GET", f"{base}/revisions/1")
    if action == "diff":
        return banc.appel(profil, "GET", f"{base}/diff", params={"base": "1", "other": "1"})
    if action == "revise":
        return banc.reviser_tableau(profil, ident, 1, text(), visibility=visibilite, name="Révisée")
    if action == "duplicate":
        return banc.appel(profil, "POST", f"{base}/duplicate")
    assert action == "delete"
    return banc.appel(profil, "DELETE", base, params={"expected_revision": "1"})


def empreinte(reponse: Response) -> tuple[int, bytes, dict[str, str]]:
    """Ce que voit un client : statut, octets du corps et en-têtes, hors l'horodatage."""
    entetes = {nom: valeur for nom, valeur in reponse.headers.items() if nom.lower() != "date"}
    return reponse.status_code, reponse.content, entetes


def dans_la_liste(banc: Banc, profil: Profil, ident: str) -> bool:
    reponse = banc.appel(profil, "GET", CHEMIN_TABLEAUX)
    assert reponse.status_code == 200, reponse.text
    return ident in {item["id"] for item in reponse.json()["dashboards"]}


# -- propriétaire ---------------------------------------------------------------------------


def test_le_proprietaire_fait_tout_de_ses_dashboards(banc: Banc) -> None:
    for visibilite in ("personal", "shared"):
        attendus = {"revise": 201, "duplicate": 201, "delete": 204}
        for action in (*LECTURES, *ECRITURES):
            ident = creer(banc, visibilite)
            reponse = agir(banc, CREATEUR_GROUPE, action, ident, visibilite)
            assert reponse.status_code == attendus.get(action, 200), (action, reponse.text)
        ident = creer(banc, visibilite)
        assert dans_la_liste(banc, CREATEUR_GROUPE, ident)


def test_un_administrateur_proprietaire_garde_son_dashboard_personnel(banc: Banc) -> None:
    ident = creer(banc, "personal", ADMIN_GROUPE)
    assert banc.appel(ADMIN_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{ident}").status_code == 200
    assert dans_la_liste(banc, ADMIN_GROUPE, ident)
    # Un autre administrateur de l'espace n'y a aucun droit.
    assert banc.appel(ADMIN_PERSONNE, "GET", f"{CHEMIN_TABLEAUX}/{ident}").status_code == 404
    assert banc.reviser_tableau(ADMIN_PERSONNE, ident, 1, text()).status_code == 404
    assert not dans_la_liste(banc, ADMIN_PERSONNE, ident)


def test_un_proprietaire_devenu_lecteur_ne_revise_plus(banc: Banc) -> None:
    """Le rôle se recalcule à chaque requête : être propriétaire ne suffit pas."""
    ident = "22222222-2222-4222-8222-222222222222"
    document = {
        **corps_tableau(text(), visibility="shared"),
        "api_version": "board.dashboard/v1",
        "id": ident,
        "owner": {"issuer": LECTEUR_GROUPE.ref.issuer, "subject": LECTEUR_GROUPE.ref.subject},
    }
    banc.depot.write(
        A, ident, document, expected_revision=None, actor=LECTEUR_GROUPE.ref, kind=DASHBOARD_KIND
    )
    lue = banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{ident}")
    assert lue.status_code == 200
    assert lue.json()["permissions"] == {
        "owner": True,
        "revise": False,
        "delete": False,
        "duplicate": False,
    }
    for action in ECRITURES:
        assert agir(banc, LECTEUR_GROUPE, action, ident, "shared").status_code == 403


# -- membres ---------------------------------------------------------------------------------


@pytest.mark.parametrize("profil", MEMBRES, ids=lambda profil: profil.nom)
def test_un_dashboard_personnel_n_existe_pas_pour_les_autres(banc: Banc, profil: Profil) -> None:
    """Administrateurs compris : ni lecture, ni historique, ni écart, ni liste ; et la réponse
    est octet pour octet celle d'un dashboard inexistant."""
    for action in (*LECTURES, *ECRITURES):
        ident = creer(banc, "personal")
        reponse = agir(banc, profil, action, ident, "personal")
        inconnue = agir(banc, profil, action, INCONNUE, "personal")
        assert empreinte(reponse) == empreinte(inconnue), action
        assert reponse.status_code == (
            403 if action in ECRITURES and profil in SANS_ROLE_ECRIRE else 404
        )
        assert "Marge" not in reponse.text and NOM not in reponse.text
        assert not dans_la_liste(banc, profil, ident)
    # Rien n'a été écrit pour autant.
    ident = creer(banc, "personal")
    historique = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{ident}/revisions").json()
    assert [item["action"] for item in historique["revisions"]] == ["save"]
    assert historique["deleted"] is False


@pytest.mark.parametrize("profil", MEMBRES, ids=lambda profil: profil.nom)
def test_un_dashboard_partage_selon_le_role(banc: Banc, profil: Profil) -> None:
    revise, duplique, supprime = ECRITURES_PARTAGE[profil]
    attendus = {"revise": revise, "duplicate": duplique, "delete": supprime}
    for action in (*LECTURES, *ECRITURES):
        ident = creer(banc, "shared")
        reponse = agir(banc, profil, action, ident, "shared")
        assert reponse.status_code == attendus.get(action, 200), (action, reponse.text)
    ident = creer(banc, "shared")
    assert dans_la_liste(banc, profil, ident)


@pytest.mark.parametrize("profil", MEMBRES, ids=lambda profil: profil.nom)
def test_les_droits_rendus_a_la_lecture_sont_ceux_qui_s_appliquent(
    banc: Banc, profil: Profil
) -> None:
    ident = creer(banc, "shared")
    revise, duplique, supprime = ECRITURES_PARTAGE[profil]
    droits = banc.appel(profil, "GET", f"{CHEMIN_TABLEAUX}/{ident}").json()["permissions"]
    assert droits == {
        "owner": False,
        "revise": revise == 201,
        "delete": supprime == 204,
        "duplicate": duplique == 201,
    }


def test_les_refus_disent_le_role_ou_la_propriete_qui_manque(banc: Banc) -> None:
    ident = creer(banc, "shared")
    lecteur = agir(banc, LECTEUR_GROUPE, "revise", ident, "shared")
    assert lecteur.status_code == 403
    assert lecteur.json() == {"error": {"code": "forbidden", "required": "creator"}}
    autre = agir(banc, CREATEUR_PERSONNE, "revise", ident, "shared")
    assert autre.status_code == 403
    assert autre.json() == {"error": {"code": "forbidden", "required": "owner"}}
    supprime = agir(banc, CREATEUR_PERSONNE, "delete", ident, "shared")
    assert supprime.status_code == 403
    assert supprime.json() == {"error": {"code": "forbidden", "required": "owner"}}


def test_un_refus_ne_change_rien(banc: Banc) -> None:
    ident = creer(banc, "shared")
    for profil in (LECTEUR_GROUPE, CREATEUR_PERSONNE):
        assert agir(banc, profil, "revise", ident, "shared").status_code == 403
        assert agir(banc, profil, "delete", ident, "shared").status_code == 403
    historique = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{ident}/revisions").json()
    assert len(historique["revisions"]) == 1 and historique["deleted"] is False
    assert len(banc.depot.dashboards()) == 1


def test_un_administrateur_ne_rend_pas_personnel_un_dashboard_partage(banc: Banc) -> None:
    ident = creer(banc, "shared")
    refus = banc.reviser_tableau(ADMIN_GROUPE, ident, 1, text(), visibility="personal")
    assert refus.status_code == 403
    assert refus.json() == {"error": {"code": "forbidden", "required": "owner"}}
    assert banc.depot.read(A, ident, kind=DASHBOARD_KIND).revision.number == 1
    # Le propriétaire, lui, le peut : le dashboard devient le sien seul.
    rendu = banc.reviser_tableau(CREATEUR_GROUPE, ident, 1, text(), visibility="personal")
    assert rendu.status_code == 201
    assert banc.appel(ADMIN_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{ident}").status_code == 404


def test_un_administrateur_revise_un_dashboard_partage_sans_en_devenir_proprietaire(
    banc: Banc,
) -> None:
    ident = creer(banc, "shared")
    reponse = banc.reviser_tableau(ADMIN_GROUPE, ident, 1, text(), visibility="shared", name="Ada")
    assert reponse.status_code == 201
    assert reponse.json()["dashboard"]["owner"]["subject"] == "cora"
    assert reponse.json()["revised_by"]["subject"] == "ada"
    assert reponse.json()["permissions"]["owner"] is False


def test_la_liste_ne_donne_a_chacun_que_ce_qu_il_voit(banc: Banc) -> None:
    perso = creer(banc, "personal", CREATEUR_GROUPE, "Perso de cora")
    partage = creer(banc, "shared", CREATEUR_GROUPE, "Partagé de cora")
    perso_admin = creer(banc, "personal", ADMIN_GROUPE, "Perso d'ada")
    attendus = {
        CREATEUR_GROUPE: {perso, partage},
        ADMIN_GROUPE: {partage, perso_admin},
        LECTEUR_GROUPE: {partage},
        CREATEUR_PERSONNE: {partage},
        PLATEFORME_LECTEUR: {partage},
    }
    for profil, ids in attendus.items():
        reponse = banc.appel(profil, "GET", CHEMIN_TABLEAUX)
        assert reponse.status_code == 200
        assert {item["id"] for item in reponse.json()["dashboards"]} == ids, profil.nom
        assert reponse.json()["unreadable"] == 0
        if profil is not CREATEUR_GROUPE:
            assert "Perso de cora" not in reponse.text


# -- créer -----------------------------------------------------------------------------------


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
    reponse = banc.creer_tableau(profil, text(), name=NOM)
    assert reponse.status_code == statut, reponse.text
    if statut == 201:
        # Le propriétaire est la session, jamais le corps.
        assert reponse.json()["dashboard"]["owner"] == {
            "issuer": profil.ref.issuer,
            "subject": profil.ref.subject,
        }
        assert reponse.json()["permissions"]["owner"] is True
    else:
        assert "Marge" not in reponse.text
        assert banc.depot.dashboards() == ()


@pytest.mark.parametrize("profil", [CREATEUR_PERSONNE, ADMIN_GROUPE], ids=lambda p: p.nom)
def test_dupliquer_rend_la_copie_au_demandeur(banc: Banc, profil: Profil) -> None:
    ident = creer(banc, "shared")
    reponse = banc.appel(profil, "POST", f"{CHEMIN_TABLEAUX}/{ident}/duplicate")
    assert reponse.status_code == 201
    copie = reponse.json()
    assert copie["dashboard"]["owner"]["subject"] == profil.sujet
    assert copie["dashboard"]["visibility"] == "personal"
    assert copie["permissions"]["owner"] is True and copie["revised_by"]["subject"] == profil.sujet
    # Personnelle : ni la source, ni un autre membre ne la voit.
    for autre in (CREATEUR_GROUPE, LECTEUR_GROUPE):
        assert banc.appel(autre, "GET", f"{CHEMIN_TABLEAUX}/{copie['id']}").status_code == 404
        assert not dans_la_liste(banc, autre, copie["id"])
    assert dans_la_liste(banc, profil, copie["id"])


# -- sans rôle, sans session, autre espace, mode local ----------------------------------------


@pytest.mark.parametrize("profil", [PLATEFORME_SEULE, NON_MEMBRE], ids=lambda profil: profil.nom)
def test_sans_role_dans_l_espace_toutes_les_routes_refusent(banc: Banc, profil: Profil) -> None:
    """Administrateur de la plateforme sans rôle : 403 ; étranger à l'espace : 404, comme
    un espace inexistant."""
    ident = creer(banc, "shared")
    statut = 403 if profil is PLATEFORME_SEULE else 404
    for action in (*LECTURES, *ECRITURES):
        reponse = agir(banc, profil, action, ident, "shared")
        assert reponse.status_code == statut, action
        assert "Marge" not in reponse.text
    assert banc.appel(profil, "GET", CHEMIN_TABLEAUX).status_code == statut
    assert banc.creer_tableau(profil, text()).status_code == statut
    assert len(banc.depot.dashboards()) == 1


def test_un_espace_inconnu_est_refuse_comme_un_espace_etranger(banc: Banc) -> None:
    ident = creer(banc, "shared")
    inconnu = "/api/spaces/inexistant/dashboards"
    etranger = banc.appel(NON_MEMBRE, "GET", f"{CHEMIN_TABLEAUX}/{ident}")
    for profil in (NON_MEMBRE, ADMIN_GROUPE, CREATEUR_GROUPE):
        reponse = banc.appel(profil, "GET", f"{inconnu}/{ident}")
        assert reponse.status_code == 404
        assert "Marge" not in reponse.text
        assert reponse.json() == etranger.json()
    assert banc.appel(ADMIN_GROUPE, "GET", inconnu).status_code == 404
    assert banc.creer_tableau(ADMIN_GROUPE, text()).status_code == 201
    envoi = {**corps_tableau(text()), "expected_revision": 1}
    assert banc.appel(ADMIN_GROUPE, "POST", inconnu, json=corps_tableau(text())).status_code == 404
    assert (
        banc.appel(ADMIN_GROUPE, "POST", f"{inconnu}/{ident}/revisions", json=envoi).status_code
        == 404
    )


def test_sans_session_l_acces_est_refuse(banc: Banc) -> None:
    ident = creer(banc, "shared")
    for methode, chemin in (
        ("GET", CHEMIN_TABLEAUX),
        ("GET", f"{CHEMIN_TABLEAUX}/{ident}"),
        ("GET", f"{CHEMIN_TABLEAUX}/{ident}/revisions"),
        ("GET", f"{CHEMIN_TABLEAUX}/{ident}/diff"),
        ("POST", CHEMIN_TABLEAUX),
        ("POST", f"{CHEMIN_TABLEAUX}/{ident}/duplicate"),
        ("DELETE", f"{CHEMIN_TABLEAUX}/{ident}"),
    ):
        assert banc.appel(None, methode, chemin).status_code == 401, (methode, chemin)


def test_un_autre_espace_ne_voit_pas_le_dashboard(banc: Banc) -> None:
    """Le dashboard est rangé par espace : le même identifiant dans l'espace voisin n'existe pas."""
    ident = creer(banc, "shared")
    voisin = CHEMIN_TABLEAUX.replace(A, "rh")
    for profil in (ADMIN_GROUPE, LECTEUR_GROUPE):
        assert banc.appel(profil, "GET", f"{voisin}/{ident}").status_code == 404
    assert not dans_la_liste(banc, LECTEUR_GROUPE, "inconnu")


def test_le_mode_local_refuse_comme_les_analyses(service: CatalogService, tmp_path: Path) -> None:
    depot: ContentRepository = repository(init(tmp_path / "contenus"))
    app = create_app(service, content_repository=depot)
    with TestClient(app, base_url="http://127.0.0.1", raise_server_exceptions=False) as client:
        entetes = {"Origin": "http://127.0.0.1"}
        base = "/api/spaces/local/dashboards"
        envoi = {**corps_tableau(text()), "expected_revision": 1}
        appels: list[Callable[[], Any]] = [
            lambda: client.get(base),
            lambda: client.post(base, json=corps_tableau(text()), headers=entetes),
            lambda: client.get(f"{base}/{INCONNUE}"),
            lambda: client.get(f"{base}/{INCONNUE}/revisions"),
            lambda: client.get(f"{base}/{INCONNUE}/revisions/1"),
            lambda: client.get(f"{base}/{INCONNUE}/diff?base=1&other=2"),
            lambda: client.post(f"{base}/{INCONNUE}/revisions", json=envoi, headers=entetes),
            lambda: client.post(f"{base}/{INCONNUE}/duplicate", headers=entetes),
            lambda: client.delete(f"{base}/{INCONNUE}?expected_revision=1", headers=entetes),
        ]
        for appel in appels:
            reponse = appel()
            assert reponse.status_code == 409
            assert reponse.json()["error"]["code"] == "local_mode"
    assert depot.dashboards() == ()


# -- invisible, supprimé et inexistant sont indiscernables ------------------------------------


@pytest.mark.parametrize("profil", MEMBRES, ids=lambda profil: profil.nom)
def test_personnel_supprime_et_inexistant_donnent_la_meme_reponse(
    banc: Banc, profil: Profil
) -> None:
    personnel = creer(banc, "personal")
    supprime = creer(banc, "shared")
    assert (
        banc.appel(
            CREATEUR_GROUPE,
            "DELETE",
            f"{CHEMIN_TABLEAUX}/{supprime}",
            params={"expected_revision": "1"},
        ).status_code
        == 204
    )
    for action in (*LECTURES, *ECRITURES):
        attendue = empreinte(agir(banc, profil, action, INCONNUE, "shared"))
        for ident in (personnel, supprime):
            assert empreinte(agir(banc, profil, action, ident, "shared")) == attendue, action


def test_un_identifiant_mal_forme_donne_la_reponse_d_un_inexistant(banc: Banc) -> None:
    attendue = empreinte(banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{INCONNUE}"))
    for ident in ("abc", INCONNUE.upper(), "a" * 200):
        assert (
            empreinte(banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{ident}")) == attendue
        )


def test_un_dashboard_supprime_n_est_visible_que_de_son_proprietaire(banc: Banc) -> None:
    ident = creer(banc, "shared")
    assert agir(banc, CREATEUR_GROUPE, "delete", ident, "shared").status_code == 204
    for profil in MEMBRES:
        for action in LECTURES:
            reponse = agir(banc, profil, action, ident, "shared")
            assert reponse.status_code == 404, (profil.nom, action)
            assert "Marge" not in reponse.text
        assert not dans_la_liste(banc, profil, ident)
    # Le propriétaire relit son historique, mais ne modifie plus rien.
    assert agir(banc, CREATEUR_GROUPE, "history", ident, "shared").status_code == 200
    assert agir(banc, CREATEUR_GROUPE, "revision", ident, "shared").status_code == 200
    for action in ECRITURES:
        assert agir(banc, CREATEUR_GROUPE, action, ident, "shared").status_code == 404


# -- visibilité révision par révision -----------------------------------------------------------

AUTRES = [
    ADMIN_GROUPE,
    ADMIN_PERSONNE,
    LECTEUR_GROUPE,
    LECTEUR_PERSONNE,
    CREATEUR_PERSONNE,
    PLATEFORME_LECTEUR,
]


def personnel_puis_partage(banc: Banc) -> str:
    """Révision 1 personnelle (secrète), puis 2 et 3 partagées."""
    ident = creer(banc, "personal", nom=NOM)
    for numero, nom in ((1, PUBLIC), (2, f"{PUBLIC} bis")):
        reponse = banc.reviser_tableau(
            CREATEUR_GROUPE, ident, numero, text(), name=nom, visibility="shared"
        )
        assert reponse.status_code == 201
    return ident


def partage_puis_personnel(banc: Banc) -> str:
    """Révision 1 partagée, puis 2 personnelle : le dashboard est retiré du partage."""
    ident = creer(banc, "shared", nom=PUBLIC)
    retire = banc.reviser_tableau(
        CREATEUR_GROUPE, ident, 1, text(), name=NOM, visibility="personal"
    )
    assert retire.status_code == 201
    return ident


def lire(banc: Banc, profil: Profil, ident: str, suite: str) -> Response:
    return banc.appel(profil, "GET", f"{CHEMIN_TABLEAUX}/{ident}{suite}")


def ecart(banc: Banc, profil: Profil, ident: str, base: int, autre: int) -> Response:
    return banc.appel(
        profil,
        "GET",
        f"{CHEMIN_TABLEAUX}/{ident}/diff",
        params={"base": str(base), "other": str(autre)},
    )


def le_meme_que(reponse: Response, inexistante: Response) -> None:
    assert reponse.status_code == inexistante.status_code == 404
    assert reponse.json() == inexistante.json() == {"error": {"code": "dashboard_not_found"}}
    assert empreinte(reponse) == empreinte(inexistante)


def test_le_proprietaire_voit_toutes_ses_revisions(banc: Banc) -> None:
    ident = personnel_puis_partage(banc)
    historique = lire(banc, CREATEUR_GROUPE, ident, "/revisions").json()
    assert [item["revision"] for item in historique["revisions"]] == [1, 2, 3]
    assert all(item["available"] is True for item in historique["revisions"])
    un = lire(banc, CREATEUR_GROUPE, ident, "/revisions/1")
    assert un.status_code == 200 and un.json()["dashboard"]["name"] == NOM
    assert un.json()["permissions"]["owner"] is True
    changes = ecart(banc, CREATEUR_GROUPE, ident, 1, 2)
    assert changes.status_code == 200
    assert {
        "path": "/name",
        "kind": "modified",
        "node": "dashboard",
        "id": None,
        "before": NOM,
        "after": PUBLIC,
    } in changes.json()["changes"]


@pytest.mark.parametrize("profil", AUTRES, ids=lambda profil: profil.nom)
def test_une_revision_qui_a_ete_personnelle_n_est_servie_qu_a_son_proprietaire(
    banc: Banc, profil: Profil
) -> None:
    ident = personnel_puis_partage(banc)
    inexistante = lire(banc, profil, ident, "/revisions/9")
    # Le dashboard partagé se lit, ses révisions partagées aussi.
    assert lire(banc, profil, ident, "").json()["dashboard"]["name"] == f"{PUBLIC} bis"
    deux = lire(banc, profil, ident, "/revisions/2")
    assert deux.status_code == 200 and deux.json()["dashboard"]["name"] == PUBLIC
    # La révision 1 : mêmes statut, corps et en-têtes qu'une révision qui n'existe pas.
    le_meme_que(lire(banc, profil, ident, "/revisions/1"), inexistante)
    # L'écart : aucun des deux côtés ne peut être une révision masquée.
    ailleurs = ecart(banc, profil, ident, 2, 9)
    for base, autre in ((1, 2), (2, 1), (1, 1), (1, 3), (3, 1)):
        le_meme_que(ecart(banc, profil, ident, base, autre), ailleurs)
    visible = ecart(banc, profil, ident, 2, 3)
    assert visible.status_code == 200 and visible.json()["changes"][0]["before"] == PUBLIC
    assert ecart(banc, profil, ident, 3, 3).json()["changes"] == []


@pytest.mark.parametrize("profil", AUTRES, ids=lambda profil: profil.nom)
def test_l_historique_ne_donne_aucune_metadonnee_d_une_revision_masquee(
    banc: Banc, profil: Profil
) -> None:
    ident = personnel_puis_partage(banc)
    reponse = lire(banc, profil, ident, "/revisions")
    assert reponse.status_code == 200
    corps = reponse.json()
    assert corps["current_revision"] == 3 and corps["deleted"] is False
    premiere, *suite = corps["revisions"]
    # Le numéro seul : ni empreinte, ni date, ni auteur, ni action.
    assert premiere == MASQUEE
    assert [(item["revision"], item["available"]) for item in suite] == [(2, True), (3, True)]
    assert all({"commit", "committed_at", "actor", "action"} <= set(item) for item in suite)
    assert NOM not in reponse.text


def test_un_dashboard_devenu_personnel_disparait_pour_les_autres(banc: Banc) -> None:
    ident = partage_puis_personnel(banc)
    for profil in AUTRES:
        inconnu = lire(banc, profil, INCONNUE, "")
        for suite in ("", "/revisions", "/revisions/1", "/revisions/2"):
            le_meme_que(lire(banc, profil, ident, suite), inconnu)
        for base, autre in ((1, 1), (1, 2), (2, 2)):
            reponse = ecart(banc, profil, ident, base, autre)
            assert reponse.status_code == 404
            assert NOM not in reponse.text and PUBLIC not in reponse.text
        assert not dans_la_liste(banc, profil, ident)
    historique = lire(banc, CREATEUR_GROUPE, ident, "/revisions").json()
    assert [item["available"] for item in historique["revisions"]] == [True, True]
    ancienne = lire(banc, CREATEUR_GROUPE, ident, "/revisions/1")
    assert ancienne.json()["dashboard"]["name"] == PUBLIC
    assert ecart(banc, CREATEUR_GROUPE, ident, 1, 2).status_code == 200


def test_un_dashboard_supprime_reste_celui_de_son_proprietaire(banc: Banc) -> None:
    ident = personnel_puis_partage(banc)
    supprime = banc.appel(
        CREATEUR_GROUPE,
        "DELETE",
        f"{CHEMIN_TABLEAUX}/{ident}",
        params={"expected_revision": "3"},
    )
    assert supprime.status_code == 204
    for profil in AUTRES:
        for suite in ("/revisions", "/revisions/1", "/revisions/2"):
            assert lire(banc, profil, ident, suite).status_code == 404
    historique = lire(banc, CREATEUR_GROUPE, ident, "/revisions").json()
    assert historique["deleted"] is True and historique["current_revision"] is None
    assert [(item["revision"], item["action"]) for item in historique["revisions"]] == [
        (1, "save"),
        (2, "save"),
        (3, "save"),
        (3, "delete"),
    ]
    assert all(item["available"] is True for item in historique["revisions"])
    premiere = lire(banc, CREATEUR_GROUPE, ident, "/revisions/1")
    assert premiere.json()["dashboard"]["name"] == NOM


def test_le_second_controle_de_visibilite_refuse_ce_que_le_premier_aurait_laisse_passer(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Défense en profondeur : si l'en-tête lu d'abord disait « partagé » d'un dashboard que le
    contenu lu ensuite dit personnel, la lecture, la révision, la copie et la suppression le
    refusent comme un dashboard inexistant."""
    ident = creer(banc, "personal")
    inconnu = lire(banc, CREATEUR_PERSONNE, INCONNUE, "")
    original = ContentRepository.glance

    def trompeur(self: ContentRepository, *args: Any, **options: Any) -> Any:
        vu = original(self, *args, **options)
        return type(vu)(vu.owner, "shared", vu.deleted)

    monkeypatch.setattr(ContentRepository, "glance", trompeur)
    for action in (*LECTURES, *ECRITURES):
        reponse = agir(banc, CREATEUR_PERSONNE, action, ident, "personal")
        assert reponse.status_code == 404 and NOM not in reponse.text, action
        if action == "read":
            le_meme_que(reponse, inconnu)
    assert banc.depot.read(A, ident, kind=DASHBOARD_KIND).revision.number == 1


# -- aucun secret dans un refus ----------------------------------------------------------------


def test_aucun_refus_ne_contient_de_secret(banc: Banc) -> None:
    secret = "valeur_confidentielle_42"
    personnel = creer(banc, "personal", nom=secret)
    partage = creer(banc, "shared", nom=secret)
    rendu_personnel = creer(banc, "shared", nom=secret)
    banc.reviser_tableau(
        CREATEUR_GROUPE, rendu_personnel, 1, text(), name=secret, visibility="personal"
    )
    for profil in (*MEMBRES, NON_MEMBRE, PLATEFORME_SEULE):
        for ident in (personnel, rendu_personnel):
            for action in (*LECTURES, *ECRITURES):
                reponse = agir(banc, profil, action, ident, "personal")
                assert secret not in reponse.text, (profil.nom, action)
                assert secret not in str(dict(reponse.headers)), (profil.nom, action)
        for action in ECRITURES:
            reponse = agir(banc, profil, action, partage, "shared")
            if reponse.status_code >= 400:
                assert secret not in reponse.text, (profil.nom, action)
