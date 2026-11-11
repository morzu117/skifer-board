"""Routes des dashboards sur un vrai serveur : cycle de vie, liste, historique, écart (plan 19.2).

Calquées sur celles des analyses (`test_routes_analyses.py`) : un vrai serveur, une base migrée,
un dépôt git jetable et le catalogue de test. Les droits par rôle et par visibilité sont dans
`test_routes_dashboards_droits.py`.
"""

from __future__ import annotations

import re
import shutil
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from skifer_board.catalog import CatalogService
from skifer_board.content.index import DashboardIndex, DashboardRow
from skifer_board.content.repository import DASHBOARD_KIND
from skifer_board.execution import ConnectionStore
from skifer_board.execution.semantic import describe_catalog
from skifer_board.server import create_app
from spaces.monde import (
    ADMIN_GROUPE,
    COOKIE,
    CREATEUR_GROUPE,
    CREATEUR_PERSONNE,
    LECTEUR_GROUPE,
    ORIGINE,
    A,
    Profil,
    espaces_en_base,
)
from sqlalchemy.exc import OperationalError

from .monde import commit, init, repository
from .monde_dashboard import column, row, section, separator, text, visual
from .serveur import CHEMIN_TABLEAUX, Banc, corps_tableau

INCONNUE = "11111111-1111-4111-8111-111111111111"
SHA = re.compile(r"[0-9a-f]{40}")
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
V1 = "aaaaaaaa-0000-4000-8000-000000000001"
V2 = "aaaaaaaa-0000-4000-8000-000000000002"
T1 = "bbbbbbbb-0000-4000-8000-000000000001"
C1 = "dddddddd-0000-4000-8000-000000000001"
R1 = "eeeeeeee-0000-4000-8000-000000000001"
S1 = "ffffffff-0000-4000-8000-000000000001"
FORME = {
    "id",
    "space_id",
    "revision",
    "current_revision",
    "commit",
    "committed_at",
    "revised_by",
    "state",
    "components",
    "permissions",
    "dashboard",
}
LIGNE = {
    "id",
    "name",
    "visibility",
    "owner",
    "is_owner",
    "revision",
    "commit",
    "committed_at",
    "state",
}


def lire(banc: Banc, ident: str, profil: Profil = CREATEUR_GROUPE) -> dict[str, Any]:
    reponse = banc.appel(profil, "GET", f"{CHEMIN_TABLEAUX}/{ident}")
    assert reponse.status_code == 200, reponse.text
    result: dict[str, Any] = reponse.json()
    return result


def lister(banc: Banc, profil: Profil = CREATEUR_GROUPE) -> dict[str, Any]:
    reponse = banc.appel(profil, "GET", CHEMIN_TABLEAUX)
    assert reponse.status_code == 200, reponse.text
    result: dict[str, Any] = reponse.json()
    return result


def analyse(banc: Banc, profil: Profil = CREATEUR_GROUPE, **changes: Any) -> str:
    """Analyse partagée, que n'importe quel dashboard de l'espace peut épingler."""
    return banc.creer_ok(profil, **{"visibility": "shared", **changes})


def fixe(*composants: dict[str, Any]) -> dict[str, Any]:
    """Mise en page à identifiants stables : deux corps identiques sont deux contenus identiques."""
    colonne = column(*composants, ident=C1)
    return {"layout": {"sections": [section(row(colonne, ident=R1), ident=S1)]}}


def tableau(banc: Banc, profil: Profil = CREATEUR_GROUPE, **changes: Any) -> str:
    """Dashboard partagé d'un seul composant texte (sans épingle), de l'auteur donné."""
    return banc.creer_tableau_ok(
        profil, **{"visibility": "shared", **fixe(text(ident=T1)), **changes}
    )


def reviser(
    banc: Banc,
    ident: str,
    revision: int,
    profil: Profil = CREATEUR_GROUPE,
    **changes: Any,
) -> Any:
    return banc.reviser_tableau(
        profil, ident, revision, **{"visibility": "shared", **fixe(text(ident=T1)), **changes}
    )


def suppression(banc: Banc, ident: str, revision: str, profil: Profil = CREATEUR_GROUPE) -> Any:
    return banc.appel(
        profil, "DELETE", f"{CHEMIN_TABLEAUX}/{ident}", params={"expected_revision": revision}
    )


def fichier_git(ident: str) -> str:
    return f"dashboards/{A}/{ident}.yaml"


# -- création -------------------------------------------------------------------------------


def test_creation_rend_la_revision_la_provenance_l_etat_et_les_droits(banc: Banc) -> None:
    ident_analyse = analyse(banc)
    reponse = banc.creer_tableau(
        CREATEUR_GROUPE, visual(V1, ident_analyse), text(ident=T1), visibility="shared"
    )
    assert reponse.status_code == 201
    vue = reponse.json()
    assert set(vue) == FORME
    assert UUID.fullmatch(vue["id"]) and vue["dashboard"]["id"] == vue["id"]
    assert vue["space_id"] == A and vue["revision"] == 1 and vue["current_revision"] == 1
    assert SHA.fullmatch(vue["commit"]) and vue["committed_at"].endswith("+00:00")
    assert vue["revised_by"] == {"issuer": CREATEUR_GROUPE.ref.issuer, "subject": "cora"}
    assert vue["state"] == "ready"
    # Seul le visuel est exécutable : le texte n'a pas d'état.
    assert vue["components"] == [{"id": V1, "state": "ready"}]
    assert vue["permissions"] == {"owner": True, "revise": True, "delete": True, "duplicate": True}
    # Le propriétaire est la session, jamais le corps ; le contenu est celui qui a été envoyé.
    assert vue["dashboard"]["owner"] == {
        "issuer": CREATEUR_GROUPE.ref.issuer,
        "subject": "cora",
    }
    assert vue["dashboard"]["visibility"] == "shared"
    # Ce qui est rendu est ce qui est dans git ; l'index suit.
    assert banc.depot.read(A, vue["id"], kind=DASHBOARD_KIND).document == vue["dashboard"]
    ligne = banc.tableaux.get(A, vue["id"])
    assert ligne is not None and (ligne.revision, ligne.commit) == (1, vue["commit"])
    assert (ligne.name, ligne.visibility) == ("Pilotage", "shared")


def test_la_reponse_ne_recopie_rien_de_la_requete_de_l_analyse(banc: Banc) -> None:
    ident_analyse = analyse(banc)
    reponse = banc.creer_tableau(CREATEUR_GROUPE, visual(V1, ident_analyse), visibility="shared")
    assert reponse.status_code == 201
    for fragment in ("revenue", "sales", "finance", '"query"', "metrics", "Sud"):
        assert fragment not in reponse.text.replace(A, "")
    assert "revenue" not in lire(banc, reponse.json()["id"]).__str__()


def test_les_identifiants_sont_generes_par_le_serveur(banc: Banc) -> None:
    identifiants = {tableau(banc) for _ in range(3)}
    assert len(identifiants) == 3 and all(UUID.fullmatch(item) for item in identifiants)


def test_un_dashboard_sans_composant_executable_est_pret(banc: Banc) -> None:
    ident = banc.creer_tableau_ok(CREATEUR_GROUPE, text(), separator(), visibility="shared")
    vue = lire(banc, ident)
    assert vue["state"] == "ready" and vue["components"] == []


@pytest.mark.parametrize("envoi", [b"", b"{", b"[]", b'"x"', b"null", b'{"a":1,"a":2}'], ids=repr)
def test_un_corps_qui_n_est_pas_un_objet_est_refuse(banc: Banc, envoi: bytes) -> None:
    reponse = banc.appel(CREATEUR_GROUPE, "POST", CHEMIN_TABLEAUX, content=envoi)
    assert reponse.status_code == 400
    assert reponse.json() == {"error": {"code": "invalid_request", "field": "body"}}
    assert banc.depot.dashboards() == ()


def test_un_corps_trop_gros_est_refuse_avant_toute_analyse(banc: Banc) -> None:
    gros = {**corps_tableau(text()), "description": "x" * (64 * 1024)}
    reponse = banc.appel(CREATEUR_GROUPE, "POST", CHEMIN_TABLEAUX, json=gros)
    assert reponse.status_code == 400
    assert reponse.json() == {"error": {"code": "invalid_request", "field": "body"}}
    assert banc.depot.dashboards() == ()


def test_un_document_au_dela_de_la_borne_du_depot_n_est_pas_publie(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    from skifer_board.content import repository as depot_module

    monkeypatch.setattr(depot_module, "MAX_DOCUMENT_BYTES", 10)
    reponse = banc.creer_tableau(CREATEUR_GROUPE, text(), visibility="shared")
    assert reponse.status_code == 422
    assert reponse.json()["error"]["code"] == "invalid_dashboard"
    assert reponse.json()["error"]["violations"] == [{"path": "", "rule": "out_of_bounds"}]
    assert banc.depot.dashboards() == ()


@pytest.mark.parametrize("champ", ["api_version", "id", "owner"])
def test_un_champ_reserve_au_serveur_est_refuse(banc: Banc, champ: str) -> None:
    envoi = {**corps_tableau(text()), champ: "x"}
    reponse = banc.appel(CREATEUR_GROUPE, "POST", CHEMIN_TABLEAUX, json=envoi)
    assert reponse.status_code == 422
    assert reponse.json()["error"]["code"] == "invalid_dashboard"
    assert reponse.json()["error"]["violations"] == [
        {"path": f"/{champ}", "rule": "field_not_allowed"}
    ]
    assert banc.depot.dashboards() == ()


def test_les_champs_reserves_sont_tous_rapportes_dans_l_ordre(banc: Banc) -> None:
    envoi = {**corps_tableau(text()), "owner": {}, "id": "x", "api_version": "y"}
    reponse = banc.appel(CREATEUR_GROUPE, "POST", CHEMIN_TABLEAUX, json=envoi)
    assert reponse.status_code == 422
    assert reponse.json()["error"]["violations"] == [
        {"path": "/api_version", "rule": "field_not_allowed"},
        {"path": "/id", "rule": "field_not_allowed"},
        {"path": "/owner", "rule": "field_not_allowed"},
    ]


def test_un_corps_hors_format_est_refuse_sans_rien_ecrire(banc: Banc) -> None:
    envoi = corps_tableau(text())
    del envoi["name"]
    reponse = banc.appel(CREATEUR_GROUPE, "POST", CHEMIN_TABLEAUX, json=envoi)
    assert reponse.status_code == 422
    assert reponse.json()["error"]["code"] == "invalid_dashboard"
    assert banc.depot.dashboards() == ()


# -- liste ----------------------------------------------------------------------------------


def test_la_liste_est_triee_et_porte_l_etat_de_l_index(banc: Banc) -> None:
    tableau(banc, name="banane")
    tableau(banc, name="Abricot", visibility="personal")
    tableau(banc, CREATEUR_PERSONNE, name="cerise")
    tableau(banc, CREATEUR_PERSONNE, name="date secrète", visibility="personal")
    vue = lister(banc)
    assert [item["name"] for item in vue["dashboards"]] == ["Abricot", "banane", "cerise"]
    assert vue["unreadable"] == 0
    premier = vue["dashboards"][0]
    assert set(premier) == LIGNE
    assert premier["state"] == "indexed" and premier["is_owner"] is True
    assert premier["visibility"] == "personal" and premier["revision"] == 1
    assert premier["owner"] == {"issuer": CREATEUR_GROUPE.ref.issuer, "subject": "cora"}
    assert SHA.fullmatch(premier["commit"]) and premier["committed_at"].endswith("+00:00")
    assert [item["is_owner"] for item in vue["dashboards"]] == [True, True, False]
    autre = lister(banc, LECTEUR_GROUPE)
    assert [item["name"] for item in autre["dashboards"]] == ["banane", "cerise"]
    assert [item["is_owner"] for item in autre["dashboards"]] == [False, False]


def test_a_nom_egal_la_liste_se_trie_par_identifiant(banc: Banc) -> None:
    identifiants = [tableau(banc, name="Même nom") for _ in range(3)]
    vue = lister(banc)
    assert [item["id"] for item in vue["dashboards"]] == sorted(identifiants)


def test_la_liste_vide(banc: Banc) -> None:
    assert lister(banc) == {"dashboards": [], "unreadable": 0}


def test_la_liste_sans_commit_dans_le_depot_est_vide(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Dépôt vierge : pas de tête, donc rien à comparer à l'index."""
    monkeypatch.setattr(banc.depot, "head", lambda: None)
    assert lister(banc) == {"dashboards": [], "unreadable": 0}


def test_la_liste_ne_contient_pas_les_analyses(banc: Banc) -> None:
    analyse(banc)
    assert lister(banc) == {"dashboards": [], "unreadable": 0}


def test_un_ecart_avec_git_est_signale_et_git_fait_foi(banc: Banc) -> None:
    ident = tableau(banc, name="Avant")
    courante = banc.depot.read(A, ident, kind=DASHBOARD_KIND).document
    # Une révision publiée dans git sans que l'index l'ait su (base indisponible, crash).
    banc.depot.write(
        A,
        ident,
        {**courante, "name": "Après"},
        expected_revision=1,
        actor=CREATEUR_GROUPE.ref,
        kind=DASHBOARD_KIND,
    )
    ligne = lister(banc, LECTEUR_GROUPE)["dashboards"][0]
    assert (ligne["name"], ligne["revision"], ligne["state"]) == ("Après", 2, "index_stale")
    lue = lire(banc, ident, LECTEUR_GROUPE)
    assert lue["state"] == "index_stale" and lue["dashboard"]["name"] == "Après"
    assert lue["revision"] == 2 and lue["current_revision"] == 2
    # Le contenu d'une révision plus ancienne n'est pas comparé à l'index.
    ancienne = banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{ident}/revisions/1").json()
    assert ancienne["state"] == "ready" and ancienne["current_revision"] == 2


def test_un_ecart_dont_le_contenu_est_devenu_personnel_disparait_de_la_liste(banc: Banc) -> None:
    ident = tableau(banc, name="Partagé")
    courante = banc.depot.read(A, ident, kind=DASHBOARD_KIND).document
    banc.depot.write(
        A,
        ident,
        {**courante, "visibility": "personal"},
        expected_revision=1,
        actor=CREATEUR_GROUPE.ref,
        kind=DASHBOARD_KIND,
    )
    # L'index dit encore « partagé » : git fait foi, et le propriétaire garde sa ligne.
    assert lister(banc, LECTEUR_GROUPE)["dashboards"] == []
    ligne = lister(banc)["dashboards"][0]
    assert (ligne["visibility"], ligne["state"]) == ("personal", "index_stale")


def test_un_dashboard_absent_de_l_index_se_lit_mais_n_est_pas_liste(banc: Banc) -> None:
    ident = tableau(banc)
    banc.tableaux.remove(A, ident, 1)
    assert lister(banc)["dashboards"] == []
    assert lire(banc, ident)["state"] == "index_stale"


def test_une_ligne_dont_le_dashboard_a_disparu_de_git_est_ignoree(banc: Banc) -> None:
    ident = tableau(banc)
    banc.depot.delete(A, ident, expected_revision=1, actor=CREATEUR_GROUPE.ref, kind=DASHBOARD_KIND)
    assert lister(banc) == {"dashboards": [], "unreadable": 0}


def test_un_dashboard_illisible_n_est_compte_que_pour_son_proprietaire(banc: Banc) -> None:
    partage = tableau(banc, name="Partagé")
    personnel = tableau(banc, name="Perso", visibility="personal")
    tableau(banc, name="Intact")
    for ident in (partage, personnel):
        commit(banc.racine, {fichier_git(ident): b"api_version: x\n"}, "intrus")
    vue = lister(banc)
    assert [item["name"] for item in vue["dashboards"]] == ["Intact"]
    assert vue["unreadable"] == 2
    # Un lecteur ne sait pas qu'un dashboard d'un autre est abîmé, partagé ou non.
    assert lister(banc, LECTEUR_GROUPE)["unreadable"] == 0
    reponse = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{partage}")
    assert reponse.status_code == 503
    assert reponse.json() == {"error": {"code": "content_unavailable"}}


# -- lecture --------------------------------------------------------------------------------


def test_la_lecture_courante_et_la_revision_numerotee_ont_la_meme_forme(banc: Banc) -> None:
    ident = tableau(banc, name="Un")
    assert reviser(banc, ident, 1, name="Deux").status_code == 201
    courante = lire(banc, ident)
    assert set(courante) == FORME
    assert courante["revision"] == 2 and courante["current_revision"] == 2
    assert courante["dashboard"]["name"] == "Deux" and courante["state"] == "ready"
    un = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{ident}/revisions/1")
    assert un.status_code == 200 and set(un.json()) == FORME
    assert un.json()["revision"] == 1 and un.json()["current_revision"] == 2
    assert un.json()["dashboard"]["name"] == "Un"
    assert un.json()["commit"] != courante["commit"]
    # La révision courante, demandée par son numéro, est celle de la lecture courante.
    assert (
        banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{ident}/revisions/2").json()
        == courante
    )


def test_un_dashboard_inconnu_ou_mal_nomme_n_existe_pas(banc: Banc) -> None:
    attendu = {"error": {"code": "dashboard_not_found"}}
    for ident in (INCONNUE, INCONNUE.upper(), "abc", "not-a-uuid", "a" * 200, f"{INCONNUE}%00"):
        base = f"{CHEMIN_TABLEAUX}/{ident}"
        for chemin in (base, f"{base}/revisions", f"{base}/revisions/1"):
            reponse = banc.appel(CREATEUR_GROUPE, "GET", chemin)
            assert reponse.status_code == 404 and reponse.json() == attendu, chemin
        diff = banc.appel(
            CREATEUR_GROUPE, "GET", f"{base}/diff", params={"base": "1", "other": "2"}
        )
        assert diff.status_code == 404 and diff.json() == attendu
        revise = banc.reviser_tableau(CREATEUR_GROUPE, ident, 1, text())
        assert revise.status_code == 404 and revise.json() == attendu
        copie = banc.appel(CREATEUR_GROUPE, "POST", f"{base}/duplicate")
        assert copie.status_code == 404 and copie.json() == attendu
        assert suppression(banc, ident, "1").status_code == 404
    assert banc.depot.dashboards() == ()


def test_une_analyse_n_est_pas_un_dashboard(banc: Banc) -> None:
    """Les deux genres ont leur propre répertoire : l'identifiant de l'un n'ouvre pas l'autre."""
    ident = analyse(banc)
    reponse = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{ident}")
    assert reponse.status_code == 404
    assert reponse.json() == {"error": {"code": "dashboard_not_found"}}


@pytest.mark.parametrize("numero", ["0", "-1", "abc", "1.5", "1e3", "٣", "1234567890", " 1", "01 "])
def test_un_numero_de_revision_invalide_est_refuse(banc: Banc, numero: str) -> None:
    ident = tableau(banc)
    reponse = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{ident}/revisions/{numero}")
    assert reponse.status_code == 400
    assert reponse.json()["error"]["code"] == "invalid_parameter"
    assert reponse.json()["error"]["parameter"] == "revision"


def test_une_revision_inexistante_n_existe_pas(banc: Banc) -> None:
    ident = tableau(banc)
    reponse = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{ident}/revisions/2")
    assert reponse.status_code == 404
    assert reponse.json() == {"error": {"code": "dashboard_not_found"}}


# -- historique -----------------------------------------------------------------------------


def test_historique_et_revisions_numerotees(banc: Banc) -> None:
    ident = tableau(banc, name="Un")
    deux = reviser(banc, ident, 1, ADMIN_GROUPE, name="Deux")
    assert deux.status_code == 201 and deux.json()["revision"] == 2
    reponse = banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{ident}/revisions")
    assert reponse.status_code == 200
    historique = reponse.json()
    assert set(historique) == {"id", "current_revision", "deleted", "revisions"}
    assert historique["id"] == ident
    assert historique["current_revision"] == 2 and historique["deleted"] is False
    assert [(item["revision"], item["action"]) for item in historique["revisions"]] == [
        (1, "save"),
        (2, "save"),
    ]
    assert [item["actor"]["subject"] for item in historique["revisions"]] == ["cora", "ada"]
    assert all(item["available"] is True for item in historique["revisions"])
    assert all(SHA.fullmatch(item["commit"]) for item in historique["revisions"])
    assert all(item["committed_at"].endswith("+00:00") for item in historique["revisions"])
    un = banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{ident}/revisions/1").json()
    assert un["dashboard"]["name"] == "Un" and un["current_revision"] == 2
    assert un["revision"] == 1 and un["permissions"]["revise"] is False
    assert lire(banc, ident)["dashboard"]["name"] == "Deux"


# -- écart ----------------------------------------------------------------------------------


def ecart(banc: Banc, ident: str, base: Any, autre: Any, profil: Profil = LECTEUR_GROUPE) -> Any:
    params = {nom: str(valeur) for nom, valeur in (("base", base), ("other", autre))}
    return banc.appel(profil, "GET", f"{CHEMIN_TABLEAUX}/{ident}/diff", params=params)


def test_ecart_structurel_entre_deux_revisions(banc: Banc) -> None:
    ident = tableau(banc, name="Un")
    modifiee = reviser(banc, ident, 1, name="Deux", **fixe(text(ident=T1), separator(V2)))
    assert modifiee.status_code == 201
    reponse = ecart(banc, ident, 1, 2)
    assert reponse.status_code == 200
    corps = reponse.json()
    assert set(corps) == {"id", "base", "other", "changes"}
    assert (corps["id"], corps["base"], corps["other"]) == (ident, 1, 2)
    assert all(
        set(item) == {"path", "kind", "node", "id", "before", "after"} for item in corps["changes"]
    )
    assert corps["changes"][0] == {
        "path": "/name",
        "kind": "modified",
        "node": "dashboard",
        "id": None,
        "before": "Un",
        "after": "Deux",
    }
    ajoute = [item for item in corps["changes"] if item["kind"] == "added"]
    assert [(item["node"], item["id"]) for item in ajoute] == [("separator", V2)]
    assert ajoute[0]["before"] is None
    # Dans l'autre sens, le séparateur est retiré ; deux fois la même révision : aucun écart.
    inverse = ecart(banc, ident, 2, 1).json()["changes"]
    assert [(item["kind"], item["node"], item["id"]) for item in inverse[1:]] == [
        ("removed", "separator", V2)
    ]
    assert ecart(banc, ident, 2, 2).json()["changes"] == []


def test_l_ecart_d_un_composant_modifie_donne_les_champs_qui_different(banc: Banc) -> None:
    ident_analyse = analyse(banc)
    ident = tableau(banc, **fixe(visual(V1, ident_analyse, chart="bars")))
    modifiee = reviser(banc, ident, 1, **fixe(visual(V1, ident_analyse, chart="line")))
    assert modifiee.status_code == 201
    changes = ecart(banc, ident, 1, 2).json()["changes"]
    assert len(changes) == 1
    assert changes[0]["kind"] == "modified"
    assert (changes[0]["node"], changes[0]["id"]) == ("analysis", V1)
    assert changes[0]["before"] == {"presentation": {"chart": "bars"}}
    assert changes[0]["after"] == {"presentation": {"chart": "line"}}


@pytest.mark.parametrize(
    "params",
    [{}, {"base": "1"}, {"other": "1"}, {"base": "0", "other": "1"}, {"base": "x", "other": "1"}],
)
def test_ecart_sans_numeros_valides(banc: Banc, params: dict[str, str]) -> None:
    ident = tableau(banc)
    reponse = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{ident}/diff", params=params)
    assert reponse.status_code == 400
    assert reponse.json()["error"]["code"] == "invalid_parameter"
    assert reponse.json()["error"]["parameter"] in {"base", "other"}


def test_ecart_avec_une_revision_absente(banc: Banc) -> None:
    ident = tableau(banc)
    for base, autre in ((1, 5), (5, 1)):
        reponse = ecart(banc, ident, base, autre, CREATEUR_GROUPE)
        assert reponse.status_code == 404
        assert reponse.json() == {"error": {"code": "dashboard_not_found"}}


# -- révision -------------------------------------------------------------------------------


@pytest.mark.parametrize("attendu", [None, 0, -1, "1", True, 1.0, 1_000_000_000, [1]], ids=repr)
def test_la_revision_attendue_est_obligatoire_et_precise(banc: Banc, attendu: Any) -> None:
    ident = tableau(banc)
    envoi = {**corps_tableau(text()), "expected_revision": attendu}
    if attendu is None:
        del envoi["expected_revision"]
    reponse = banc.appel(
        CREATEUR_GROUPE, "POST", f"{CHEMIN_TABLEAUX}/{ident}/revisions", json=envoi
    )
    assert reponse.status_code == 400
    assert reponse.json() == {"error": {"code": "invalid_request", "field": "expected_revision"}}
    assert len(banc.depot.history(A, ident, kind=DASHBOARD_KIND)) == 1


@pytest.mark.parametrize("envoi", [[], "x", 3, None])
def test_reviser_refuse_un_corps_qui_n_est_pas_un_objet(banc: Banc, envoi: Any) -> None:
    ident = tableau(banc)
    reponse = banc.appel(
        CREATEUR_GROUPE, "POST", f"{CHEMIN_TABLEAUX}/{ident}/revisions", json=envoi
    )
    assert reponse.status_code == 400
    assert reponse.json() == {"error": {"code": "invalid_request", "field": "body"}}


def test_reviser_publie_une_nouvelle_revision_et_met_l_index_a_jour(banc: Banc) -> None:
    ident = tableau(banc, name="Un")
    reponse = reviser(banc, ident, 1, ADMIN_GROUPE, name="Deux")
    assert reponse.status_code == 201
    vue = reponse.json()
    assert set(vue) == FORME
    assert (vue["revision"], vue["current_revision"], vue["state"]) == (2, 2, "ready")
    assert vue["revised_by"]["subject"] == "ada"
    # Le propriétaire reste celui de la première révision, jamais l'auteur de la suivante.
    assert vue["dashboard"]["owner"]["subject"] == "cora"
    assert vue["permissions"] == {
        "owner": False,
        "revise": True,
        "delete": True,
        "duplicate": True,
    }
    ligne = banc.tableaux.get(A, ident)
    assert ligne is not None and (ligne.revision, ligne.commit) == (2, vue["commit"])
    assert ligne.name == "Deux"
    assert len(banc.depot.history(A, ident, kind=DASHBOARD_KIND)) == 2


def test_une_revision_obsolete_est_un_conflit(banc: Banc) -> None:
    ident = tableau(banc)
    assert reviser(banc, ident, 1, name="Deux").status_code == 201
    obsolete = reviser(banc, ident, 1, ADMIN_GROUPE, name="Trois")
    assert obsolete.status_code == 409
    assert obsolete.json() == {"error": {"code": "revision_conflict", "reason": "stale"}}
    avance = reviser(banc, ident, 9, ADMIN_GROUPE, name="Trois")
    assert avance.status_code == 409
    assert lire(banc, ident)["dashboard"]["name"] == "Deux"
    assert len(banc.depot.history(A, ident, kind=DASHBOARD_KIND)) == 2


def test_deux_sauvegardes_simultanees_une_seule_l_emporte(banc: Banc) -> None:
    ident = tableau(banc)
    depart = threading.Barrier(2)

    def sauver(nom: str) -> int:
        depart.wait()
        return int(reviser(banc, ident, 1, ADMIN_GROUPE, name=nom).status_code)

    with ThreadPoolExecutor(2) as pool:
        statuts = sorted(pool.map(sauver, ["Alpha", "Beta"]))
    assert statuts == [201, 409]
    assert len(banc.depot.history(A, ident, kind=DASHBOARD_KIND)) == 2
    ligne = banc.tableaux.get(A, ident)
    assert ligne is not None and ligne.revision == 2


def test_un_conflit_decouvert_a_l_ecriture_est_le_meme_conflit(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Quelqu'un publie entre le contrôle de la révision attendue et l'écriture."""
    ident = tableau(banc)
    reel = describe_catalog
    fait: list[bool] = []

    def concurrent(dossier: Path) -> dict[str, Any]:
        if not fait:
            fait.append(True)
            courante = banc.depot.read(A, ident, kind=DASHBOARD_KIND).document
            banc.depot.write(
                A,
                ident,
                {**courante, "name": "Doublé"},
                expected_revision=1,
                actor=ADMIN_GROUPE.ref,
                kind=DASHBOARD_KIND,
            )
        return reel(dossier)

    monkeypatch.setattr("skifer_board.server.describe_catalog", concurrent)
    reponse = reviser(banc, ident, 1, name="Perdu")
    assert reponse.status_code == 409
    assert reponse.json() == {"error": {"code": "revision_conflict", "reason": "stale"}}
    assert banc.depot.read(A, ident, kind=DASHBOARD_KIND).document["name"] == "Doublé"


def test_une_revision_identique_n_enregistre_rien(banc: Banc) -> None:
    """Git, par fichier, tait un commit au contenu identique : pas de numéro fantôme, et 200."""
    ident = tableau(banc)
    reponse = reviser(banc, ident, 1)
    assert reponse.status_code == 200
    assert reponse.json()["revision"] == 1 and reponse.json()["current_revision"] == 1
    assert len(banc.depot.history(A, ident, kind=DASHBOARD_KIND)) == 1
    # La révision attendue reste la 1, et la suivante est bien la 2.
    suivante = reviser(banc, ident, 1, name="Autre")
    assert suivante.status_code == 201 and suivante.json()["revision"] == 2


def test_reviser_sans_catalogue_n_ecrit_rien(banc: Banc) -> None:
    ident = tableau(banc)
    (banc.dossier_modeles / "semantic_catalog.yaml").unlink()
    reponse = reviser(banc, ident, 1, name="Autre")
    assert reponse.status_code == 503
    assert reponse.json() == {"error": {"code": "engine_unavailable"}}
    assert len(banc.depot.history(A, ident, kind=DASHBOARD_KIND)) == 1


def test_reviser_un_corps_hors_format_est_refuse(banc: Banc) -> None:
    ident = tableau(banc)
    envoi = {**corps_tableau(text()), "expected_revision": 1, "id": INCONNUE}
    reponse = banc.appel(
        CREATEUR_GROUPE, "POST", f"{CHEMIN_TABLEAUX}/{ident}/revisions", json=envoi
    )
    assert reponse.status_code == 422
    assert reponse.json()["error"]["violations"] == [{"path": "/id", "rule": "field_not_allowed"}]


# -- duplication ----------------------------------------------------------------------------


def test_dupliquer_rend_une_copie_personnelle_a_soi(banc: Banc) -> None:
    ident_analyse = analyse(banc)
    ident = banc.creer_tableau_ok(
        CREATEUR_GROUPE,
        visual(V1, ident_analyse),
        text(ident=T1),
        name="Modèle",
        description="Pour copie.",
        defaults={"legend": "hidden"},
        visibility="shared",
    )
    reponse = banc.appel(CREATEUR_PERSONNE, "POST", f"{CHEMIN_TABLEAUX}/{ident}/duplicate")
    assert reponse.status_code == 201
    copie = reponse.json()
    assert set(copie) == FORME
    assert copie["id"] != ident and UUID.fullmatch(copie["id"])
    assert copie["dashboard"]["id"] == copie["id"]
    assert copie["dashboard"]["name"] == "Copie de Modèle"
    assert copie["dashboard"]["visibility"] == "personal"
    assert copie["dashboard"]["owner"]["subject"] == CREATEUR_PERSONNE.sujet
    assert (copie["revision"], copie["current_revision"]) == (1, 1)
    assert copie["revised_by"]["subject"] == CREATEUR_PERSONNE.sujet
    assert copie["permissions"] == {
        "owner": True,
        "revise": True,
        "delete": True,
        "duplicate": True,
    }
    assert copie["state"] == "ready" and copie["components"] == [{"id": V1, "state": "ready"}]
    source = lire(banc, ident)["dashboard"]
    for champ in ("description", "defaults", "filters", "layout"):
        assert copie["dashboard"][champ] == source[champ]
    # La source ne bouge pas ; la copie est dans git et dans l'index.
    assert len(banc.depot.history(A, ident, kind=DASHBOARD_KIND)) == 1
    assert banc.depot.read(A, copie["id"], kind=DASHBOARD_KIND).document == copie["dashboard"]
    assert banc.tableaux.get(A, copie["id"]) is not None
    # La copie est personnelle : le propriétaire de la source ne la voit pas.
    assert banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{copie['id']}").status_code == 404


def test_dupliquer_un_dashboard_personnel_est_possible_pour_son_proprietaire(banc: Banc) -> None:
    ident = tableau(banc, visibility="personal", name="Brouillon")
    reponse = banc.appel(CREATEUR_GROUPE, "POST", f"{CHEMIN_TABLEAUX}/{ident}/duplicate")
    assert reponse.status_code == 201
    assert reponse.json()["dashboard"]["name"] == "Copie de Brouillon"
    assert reponse.json()["dashboard"]["visibility"] == "personal"


def test_dupliquer_sous_un_nom_choisi(banc: Banc) -> None:
    ident = tableau(banc, name="Modèle")
    reponse = banc.appel(
        CREATEUR_GROUPE, "POST", f"{CHEMIN_TABLEAUX}/{ident}/duplicate", json={"name": "Mon nom"}
    )
    assert reponse.status_code == 201 and reponse.json()["dashboard"]["name"] == "Mon nom"
    invalide = banc.appel(
        CREATEUR_GROUPE, "POST", f"{CHEMIN_TABLEAUX}/{ident}/duplicate", json={"name": ""}
    )
    assert invalide.status_code == 422
    assert {"path": "/name", "rule": "out_of_bounds"} in invalide.json()["error"]["violations"]
    assert len(banc.depot.dashboards()) == 2


def test_le_nom_d_une_copie_reste_dans_les_limites(banc: Banc) -> None:
    ident = tableau(banc, name="n" * 120)
    reponse = banc.appel(CREATEUR_GROUPE, "POST", f"{CHEMIN_TABLEAUX}/{ident}/duplicate")
    assert reponse.status_code == 201
    assert reponse.json()["dashboard"]["name"] == ("Copie de " + "n" * 120)[:120]


@pytest.mark.parametrize("envoi", [{"sql": "x"}, {"name": "a", "owner": {}}, [], "x", 3])
def test_dupliquer_refuse_un_corps_inattendu(banc: Banc, envoi: Any) -> None:
    ident = tableau(banc)
    reponse = banc.appel(
        CREATEUR_GROUPE, "POST", f"{CHEMIN_TABLEAUX}/{ident}/duplicate", json=envoi
    )
    assert reponse.status_code == 400
    assert reponse.json() == {"error": {"code": "invalid_request", "field": "body"}}
    assert len(banc.depot.dashboards()) == 1


def test_dupliquer_revalide_ce_que_la_session_peut_lire(banc: Banc) -> None:
    """La copie est jugée comme une création de celui qui duplique : une analyse épinglée qu'il
    ne peut plus lire (devenue personnelle depuis) refuse la copie."""
    ident_analyse = analyse(banc)
    ident = tableau(banc, **fixe(visual(V1, ident_analyse)))
    courante = banc.depot.read(A, ident_analyse).document
    banc.depot.write(
        A,
        ident_analyse,
        {**courante, "visibility": "personal"},
        expected_revision=1,
        actor=CREATEUR_GROUPE.ref,
    )
    copie = banc.appel(CREATEUR_PERSONNE, "POST", f"{CHEMIN_TABLEAUX}/{ident}/duplicate")
    assert copie.status_code == 422
    assert copie.json()["error"]["code"] == "invalid_dashboard"
    assert copie.json()["error"]["violations"] == [
        {
            "path": "/layout/sections/0/rows/0/columns/0/children/0/reference",
            "rule": "analysis_unavailable",
        }
    ]
    assert len(banc.depot.dashboards()) == 1
    # Son propriétaire, qui lit toujours l'analyse, la duplique.
    assert (
        banc.appel(CREATEUR_GROUPE, "POST", f"{CHEMIN_TABLEAUX}/{ident}/duplicate").status_code
        == 201
    )


def test_dupliquer_sans_catalogue_n_ecrit_rien(banc: Banc) -> None:
    ident = tableau(banc)
    (banc.dossier_modeles / "semantic_catalog.yaml").unlink()
    copie = banc.appel(CREATEUR_GROUPE, "POST", f"{CHEMIN_TABLEAUX}/{ident}/duplicate")
    assert copie.status_code == 503
    assert copie.json() == {"error": {"code": "engine_unavailable"}}
    assert len(banc.depot.dashboards()) == 1


# -- suppression ----------------------------------------------------------------------------


def test_la_suppression_garde_l_historique(banc: Banc) -> None:
    ident = tableau(banc, name="À supprimer")
    reponse = suppression(banc, ident, "1")
    assert reponse.status_code == 204 and reponse.content == b""
    assert banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{ident}").status_code == 404
    assert lister(banc) == {"dashboards": [], "unreadable": 0}
    assert banc.tableaux.get(A, ident) is None
    historique = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{ident}/revisions").json()
    assert historique["deleted"] is True and historique["current_revision"] is None
    assert [item["action"] for item in historique["revisions"]] == ["save", "delete"]
    ancienne = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{ident}/revisions/1")
    assert ancienne.status_code == 200
    assert ancienne.json()["dashboard"]["name"] == "À supprimer"
    assert ancienne.json()["current_revision"] is None
    assert ancienne.json()["permissions"] == {
        "owner": True,
        "revise": False,
        "delete": False,
        "duplicate": False,
    }
    # Une révision supprimée n'est pas comparée à l'index : l'état ne dit rien d'un écart.
    assert ancienne.json()["state"] == "ready"
    assert ecart(banc, ident, 1, 1, CREATEUR_GROUPE).status_code == 200
    # Ni autrui, ni le propriétaire ne révisent, dupliquent ou suppriment ce qui n'existe plus.
    assert reviser(banc, ident, 1).status_code == 404
    copie = banc.appel(CREATEUR_GROUPE, "POST", f"{CHEMIN_TABLEAUX}/{ident}/duplicate")
    assert copie.status_code == 404
    assert suppression(banc, ident, "1").status_code == 404


def test_un_dashboard_supprime_n_est_plus_visible_que_de_son_proprietaire(banc: Banc) -> None:
    ident = tableau(banc, name="Marge secrete")
    assert suppression(banc, ident, "1").status_code == 204
    for profil in (ADMIN_GROUPE, LECTEUR_GROUPE, CREATEUR_PERSONNE):
        for chemin in (
            f"{CHEMIN_TABLEAUX}/{ident}",
            f"{CHEMIN_TABLEAUX}/{ident}/revisions",
            f"{CHEMIN_TABLEAUX}/{ident}/revisions/1",
        ):
            reponse = banc.appel(profil, "GET", chemin)
            assert reponse.status_code == 404 and "Marge" not in reponse.text
        assert ecart(banc, ident, 1, 1, profil).status_code == 404
        assert lister(banc, profil)["dashboards"] == []


@pytest.mark.parametrize("attendu", [None, "0", "x", "1.0", "-1", "1234567890", ""])
def test_la_suppression_exige_la_revision_attendue(banc: Banc, attendu: str | None) -> None:
    ident = tableau(banc)
    params = {} if attendu is None else {"expected_revision": attendu}
    reponse = banc.appel(CREATEUR_GROUPE, "DELETE", f"{CHEMIN_TABLEAUX}/{ident}", params=params)
    assert reponse.status_code == 400
    assert reponse.json() == {"error": {"code": "invalid_request", "field": "expected_revision"}}
    assert banc.depot.read(A, ident, kind=DASHBOARD_KIND).revision.number == 1


def test_la_suppression_sur_une_revision_obsolete_est_un_conflit(banc: Banc) -> None:
    ident = tableau(banc)
    assert reviser(banc, ident, 1, name="Deux").status_code == 201
    reponse = suppression(banc, ident, "1")
    assert reponse.status_code == 409
    assert reponse.json() == {"error": {"code": "revision_conflict", "reason": "stale"}}
    assert lire(banc, ident)["revision"] == 2
    assert suppression(banc, ident, "9").status_code == 409
    assert banc.tableaux.get(A, ident) is not None


def test_une_suppression_ne_touche_que_ce_dashboard(banc: Banc) -> None:
    ident_analyse = analyse(banc)
    garde = tableau(banc, **fixe(visual(V1, ident_analyse)))
    efface = tableau(banc)
    assert suppression(banc, efface, "1").status_code == 204
    assert [item["id"] for item in lister(banc)["dashboards"]] == [garde]
    assert lire(banc, garde)["state"] == "ready"
    # L'analyse épinglée reste, elle aussi : seule la suppression de l'analyse regarde les
    # consommateurs.
    assert banc.depot.read(A, ident_analyse).revision.number == 1


# -- panne de la base après la publication --------------------------------------------------


def panne(*_: Any, **__: Any) -> None:
    raise OperationalError("INSERT secret_dsn", {}, Exception("postgresql://user:motdepasse@h/db"))


def test_une_base_en_panne_ne_defait_pas_ce_qui_est_dans_git(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(DashboardIndex, "upsert", panne)
    reponse = banc.creer_tableau(CREATEUR_GROUPE, text(ident=T1), visibility="shared")
    assert reponse.status_code == 201 and "motdepasse" not in reponse.text
    ident = reponse.json()["id"]
    assert reponse.json()["state"] == "index_stale"
    assert banc.depot.read(A, ident, kind=DASHBOARD_KIND).revision.number == 1
    revisee = reviser(banc, ident, 1, name="Deux")
    assert revisee.status_code == 201 and revisee.json()["state"] == "index_stale"
    copie = banc.appel(CREATEUR_GROUPE, "POST", f"{CHEMIN_TABLEAUX}/{ident}/duplicate")
    assert copie.status_code == 201 and copie.json()["state"] == "index_stale"
    # La lecture suivante dit l'écart ; la liste, qui part de l'index, ne montre rien.
    assert lire(banc, ident)["state"] == "index_stale"
    assert lister(banc) == {"dashboards": [], "unreadable": 0}
    monkeypatch.setattr(DashboardIndex, "remove", panne)
    supprime = suppression(banc, ident, "2")
    assert supprime.status_code == 204 and "motdepasse" not in supprime.text
    assert banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{ident}").status_code == 404


def test_une_base_qui_ne_repond_plus_rend_un_etat_degrade_depuis_git(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Lectures et écritures de la base en panne ensemble : la réponse vient de git, le dashboard
    est `unverified`, jamais une erreur pour une révision déjà publiée."""
    existant = tableau(banc)
    for methode in ("upsert", "get", "remove", "rows"):
        monkeypatch.setattr(DashboardIndex, methode, panne)
    creation = banc.creer_tableau(CREATEUR_GROUPE, text(ident=T1), name="Nouveau")
    assert creation.status_code == 201 and "motdepasse" not in creation.text
    assert creation.json()["state"] == "unverified" and creation.json()["revision"] == 1
    assert creation.json()["dashboard"]["name"] == "Nouveau"
    revisee = reviser(banc, existant, 1, name="Deux")
    assert revisee.status_code == 201 and revisee.json()["state"] == "unverified"
    assert revisee.json()["revision"] == 2 and revisee.json()["current_revision"] == 2
    identique = reviser(banc, existant, 2, name="Deux")
    assert identique.status_code == 200 and identique.json()["state"] == "unverified"
    copie = banc.appel(CREATEUR_GROUPE, "POST", f"{CHEMIN_TABLEAUX}/{existant}/duplicate")
    assert copie.status_code == 201 and copie.json()["state"] == "unverified"
    assert lire(banc, existant)["state"] == "unverified"
    assert suppression(banc, existant, "2").status_code == 204
    # Ce qui est dans git y est, malgré la panne : l'historique, lui, se lit sans la base.
    assert len(banc.depot.history(A, existant, kind=DASHBOARD_KIND)) == 3
    assert len(banc.depot.dashboards()) == 2  # le nouveau et la copie ; le supprimé n'y est plus


def test_une_base_en_panne_pour_les_connexions_laisse_le_dashboard_non_verifie(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    ident = tableau(banc)
    reviser(banc, ident, 1, name="Deux")
    monkeypatch.setattr(ConnectionStore, "list", panne)
    ancienne = banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{ident}/revisions/1")
    assert ancienne.status_code == 200 and ancienne.json()["state"] == "unverified"
    assert ancienne.json()["dashboard"]["name"] != "Deux"


def test_deux_ecritures_dans_le_desordre_ne_ramenent_pas_l_index_en_arriere(banc: Banc) -> None:
    ident = tableau(banc)
    assert reviser(banc, ident, 1, name="Deux").status_code == 201
    banc.tableaux.upsert(DashboardRow.of(A, banc.depot.read(A, ident, 1, kind=DASHBOARD_KIND)))
    ligne = banc.tableaux.get(A, ident)
    assert ligne is not None and ligne.revision == 2


# -- dépôt, catalogue et mode local ---------------------------------------------------------


def test_sans_depot_configure_les_routes_disent_content_unavailable(banc_sans_depot: Banc) -> None:
    banc = banc_sans_depot
    attendu = {"error": {"code": "content_unavailable"}}
    envoi = {**corps_tableau(text()), "expected_revision": 1}
    base = f"{CHEMIN_TABLEAUX}/{INCONNUE}"
    for methode, chemin, options in (
        ("GET", CHEMIN_TABLEAUX, {}),
        ("POST", CHEMIN_TABLEAUX, {"json": corps_tableau(text())}),
        ("GET", base, {}),
        ("GET", f"{base}/revisions", {}),
        ("GET", f"{base}/revisions/1", {}),
        ("GET", f"{base}/diff", {"params": {"base": "1", "other": "2"}}),
        ("POST", f"{base}/revisions", {"json": envoi}),
        ("POST", f"{base}/duplicate", {}),
        ("DELETE", base, {"params": {"expected_revision": "1"}}),
    ):
        reponse = banc.appel(CREATEUR_GROUPE, methode, chemin, **options)
        assert reponse.status_code == 503 and reponse.json() == attendu, (methode, chemin)
    # Le droit se juge d'abord : un lecteur n'apprend pas l'état du dépôt par une écriture.
    assert banc.creer_tableau(LECTEUR_GROUPE, text()).status_code == 403


def test_un_depot_disparu_est_indisponible_sans_dire_pourquoi(banc: Banc) -> None:
    ident = tableau(banc)
    shutil.rmtree(banc.racine)
    for methode, chemin in (
        ("GET", CHEMIN_TABLEAUX),
        ("GET", f"{CHEMIN_TABLEAUX}/{ident}"),
        ("GET", f"{CHEMIN_TABLEAUX}/{ident}/revisions"),
    ):
        reponse = banc.appel(CREATEUR_GROUPE, methode, chemin)
        assert reponse.status_code == 503
        assert reponse.json() == {"error": {"code": "content_unavailable"}}
        assert str(banc.racine) not in reponse.text


def test_sans_catalogue_la_lecture_reste_possible_et_l_ecriture_est_refusee(banc: Banc) -> None:
    ident = tableau(banc)
    (banc.dossier_modeles / "semantic_catalog.yaml").unlink()
    lue = banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{ident}")
    assert lue.status_code == 200 and lue.json()["state"] == "unverified"
    for reponse in (
        banc.creer_tableau(CREATEUR_GROUPE, text()),
        reviser(banc, ident, 1, name="Autre"),
        banc.appel(CREATEUR_GROUPE, "POST", f"{CHEMIN_TABLEAUX}/{ident}/duplicate"),
    ):
        assert reponse.status_code == 503
        assert reponse.json() == {"error": {"code": "engine_unavailable"}}
    assert len(banc.depot.dashboards()) == 1


def test_sans_moteur_configure_aucune_ecriture(
    service: CatalogService, banc: Banc, tmp_path: Path
) -> None:
    """Serveur sans répertoire de modèles : il n'y a pas de catalogue du tout."""
    depot = repository(init(tmp_path / "autres-contenus"))
    app = create_app(
        service,
        banc.monde.runtime,
        espaces_en_base(banc.monde.moteur, banc.monde.horloge),
        content_repository=depot,
    )
    with TestClient(
        app, base_url=ORIGINE, follow_redirects=False, raise_server_exceptions=False
    ) as client:
        entetes = {
            "Origin": ORIGINE,
            "Cookie": f"{COOKIE}={banc.monde.session(CREATEUR_GROUPE)}",
        }
        reponse = client.post(CHEMIN_TABLEAUX, json=corps_tableau(text()), headers=entetes)
    assert reponse.status_code == 503
    assert reponse.json() == {"error": {"code": "engine_unavailable"}}
    assert depot.dashboards() == ()
