"""Qui consomme une analyse : route `consumers`, suppression d'une analyse consommée et
`DashboardConsumers` sur un vrai serveur (plan 19.2, B5).

Un dashboard consomme une analyse quand sa révision courante l'épingle (index des références).
La session voit les consommateurs que ses droits sur le dashboard lui montrent et ne reçoit que le
nombre des autres : aucun nom, aucun contenu, aucun identifiant d'un dashboard qu'elle ne voit pas.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from skifer_board.catalog import CatalogService
from skifer_board.content import ContentRepository
from skifer_board.content.dashboard_web import DashboardConsumers
from skifer_board.content.errors import ContentError
from skifer_board.content.index import DashboardIndex, DashboardRow, Reference
from skifer_board.content.repository import DASHBOARD_KIND
from skifer_board.content.web import Consumer, Dependents
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
from sqlalchemy.exc import OperationalError

from .monde import commit, init, new_id, repository
from .monde_dashboard import column, row, section, text, visual, with_components
from .serveur import CHEMIN, CHEMIN_TABLEAUX, Banc
from .test_index_dashboards import tableau

INCONNUE = "11111111-1111-4111-8111-111111111111"
SECRET = "marge_secrete_du_trimestre"
MEMBRES = (
    LECTEUR_GROUPE,
    LECTEUR_PERSONNE,
    PLATEFORME_LECTEUR,
    CREATEUR_GROUPE,
    CREATEUR_PERSONNE,
    ADMIN_GROUPE,
    ADMIN_PERSONNE,
)


def consommateurs(banc: Banc, profil: Profil, analyse: str) -> dict[str, Any]:
    reponse = banc.appel(profil, "GET", f"{CHEMIN}/{analyse}/consumers")
    assert reponse.status_code == 200, reponse.text
    corps: dict[str, Any] = reponse.json()
    assert corps["id"] == analyse
    return corps


def supprimer(banc: Banc, profil: Profil, analyse: str, revision: int = 1) -> Any:
    return banc.appel(
        profil, "DELETE", f"{CHEMIN}/{analyse}", params={"expected_revision": str(revision)}
    )


def nommes(corps: dict[str, Any]) -> list[str]:
    return [item["id"] for item in corps["consumers"]]


def analyse_partagee(banc: Banc, **changes: Any) -> str:
    return banc.creer_ok(CREATEUR_GROUPE, visibility="shared", **changes)


def publier(banc: Banc, proprietaire: Profil, ident: str, **changes: Any) -> None:
    """Révision suivante d'un dashboard publiée dans git sans passer par l'index : la ligne
    d'index reste celle d'avant."""
    stored = banc.depot.read(A, ident, kind=DASHBOARD_KIND)
    banc.depot.write(
        A,
        ident,
        {**stored.document, **changes},
        expected_revision=stored.revision.number,
        actor=proprietaire.ref,
        kind=DASHBOARD_KIND,
    )


def ligne_d_index(banc: Banc, ident: str) -> DashboardRow:
    ligne = banc.tableaux.get(A, ident)
    assert ligne is not None
    return ligne


# -- aucun consommateur ------------------------------------------------------------------------


def test_une_analyse_sans_consommateur(banc: Banc) -> None:
    analyse = analyse_partagee(banc)
    assert consommateurs(banc, CREATEUR_GROUPE, analyse) == {
        "id": analyse,
        "consumers": [],
        "others": 0,
    }
    assert supprimer(banc, CREATEUR_GROUPE, analyse).status_code == 204


def test_un_dashboard_qui_n_epingle_pas_l_analyse_ne_la_consomme_pas(banc: Banc) -> None:
    analyse, autre = analyse_partagee(banc), analyse_partagee(banc)
    banc.creer_tableau_ok(CREATEUR_GROUPE, visual(analysis_id=autre), text(), visibility="shared")
    assert consommateurs(banc, CREATEUR_GROUPE, analyse)["consumers"] == []
    assert nommes(consommateurs(banc, CREATEUR_GROUPE, autre)) != []


def test_sans_depot_l_exhaustivite_n_est_pas_etablie(banc: Banc) -> None:
    """Jamais une liste vide quand on ne peut pas lire git : l'appel lève."""
    analyse = analyse_partagee(banc)
    ouvert = DashboardConsumers(None, banc.tableaux)
    with pytest.raises(ContentError) as erreur:
        ouvert(A, analyse, CREATEUR_GROUPE.ref, None)
    assert (erreur.value.code, erreur.value.reason) == ("content_unavailable", "not_configured")
    assert not Dependents()


# -- visibilité des consommateurs ---------------------------------------------------------------


def test_un_dashboard_partage_est_nomme_pour_tout_lecteur(banc: Banc) -> None:
    analyse = analyse_partagee(banc, name=SECRET)
    tableau_ = banc.creer_tableau_ok(
        CREATEUR_PERSONNE, visual(analysis_id=analyse), visibility="shared", name=SECRET
    )
    for profil in MEMBRES:
        corps = consommateurs(banc, profil, analyse)
        assert corps == {
            "id": analyse,
            "consumers": [{"kind": "dashboard", "id": tableau_}],
            "others": 0,
        }, profil.nom


def test_un_dashboard_personnel_d_un_autre_est_compte_jamais_nomme(banc: Banc) -> None:
    analyse = analyse_partagee(banc)
    prive = banc.creer_tableau_ok(
        ADMIN_GROUPE, visual(analysis_id=analyse), visibility="personal", name=SECRET
    )
    for profil in (CREATEUR_GROUPE, CREATEUR_PERSONNE, LECTEUR_GROUPE, ADMIN_PERSONNE):
        reponse = banc.appel(profil, "GET", f"{CHEMIN}/{analyse}/consumers")
        assert reponse.status_code == 200
        assert reponse.json() == {"id": analyse, "consumers": [], "others": 1}, profil.nom
        assert prive not in reponse.text and SECRET not in reponse.text


def test_son_propre_dashboard_personnel_est_nomme(banc: Banc) -> None:
    analyse = analyse_partagee(banc)
    prive = banc.creer_tableau_ok(ADMIN_GROUPE, visual(analysis_id=analyse), visibility="personal")
    assert consommateurs(banc, ADMIN_GROUPE, analyse) == {
        "id": analyse,
        "consumers": [{"kind": "dashboard", "id": prive}],
        "others": 0,
    }


def test_une_analyse_personnelle_consommee_par_son_proprietaire(banc: Banc) -> None:
    analyse = banc.creer_ok(CREATEUR_GROUPE, visibility="personal")
    prive = banc.creer_tableau_ok(
        CREATEUR_GROUPE, visual(analysis_id=analyse), visibility="personal"
    )
    assert nommes(consommateurs(banc, CREATEUR_GROUPE, analyse)) == [prive]
    reponse = supprimer(banc, CREATEUR_GROUPE, analyse)
    assert reponse.status_code == 409
    assert reponse.json()["error"] == {
        "code": "analysis_in_use",
        "consumers": [{"kind": "dashboard", "id": prive}],
        "others": 0,
    }


def test_un_melange_de_dashboards_est_partage_entre_nommes_et_comptes(banc: Banc) -> None:
    analyse = analyse_partagee(banc)
    partage = banc.creer_tableau_ok(
        CREATEUR_PERSONNE, visual(analysis_id=analyse), visibility="shared", name=SECRET
    )
    de_cora = banc.creer_tableau_ok(
        CREATEUR_GROUPE, visual(analysis_id=analyse), visibility="personal"
    )
    d_ada = banc.creer_tableau_ok(
        ADMIN_GROUPE, visual(analysis_id=analyse), visibility="personal", name=SECRET
    )
    corps = consommateurs(banc, CREATEUR_GROUPE, analyse)
    assert nommes(corps) == sorted([partage, de_cora])
    assert corps["others"] == 1 and d_ada not in str(corps)
    corps = consommateurs(banc, LECTEUR_GROUPE, analyse)
    assert nommes(corps) == [partage] and corps["others"] == 2
    corps = consommateurs(banc, ADMIN_GROUPE, analyse)
    assert nommes(corps) == sorted([partage, d_ada]) and corps["others"] == 1
    # Un dashboard qui épingle l'analyse deux fois n'est rendu qu'une fois.
    deux = banc.creer_tableau_ok(
        CREATEUR_PERSONNE,
        visual(analysis_id=analyse),
        visual(analysis_id=analyse),
        visibility="shared",
    )
    assert nommes(consommateurs(banc, LECTEUR_GROUPE, analyse)).count(deux) == 1


def test_la_suppression_d_une_analyse_consommee_nomme_le_visible_et_compte_le_reste(
    banc: Banc,
) -> None:
    analyse = analyse_partagee(banc, name=SECRET)
    partage = banc.creer_tableau_ok(
        CREATEUR_PERSONNE, visual(analysis_id=analyse), visibility="shared", name=SECRET
    )
    de_cora = banc.creer_tableau_ok(
        CREATEUR_GROUPE, visual(analysis_id=analyse), visibility="personal"
    )
    d_ada = banc.creer_tableau_ok(
        ADMIN_GROUPE, visual(analysis_id=analyse), visibility="personal", name=SECRET
    )
    reponse = supprimer(banc, CREATEUR_GROUPE, analyse)
    assert reponse.status_code == 409
    erreur = reponse.json()["error"]
    assert erreur["code"] == "analysis_in_use" and erreur["others"] == 1
    assert erreur["consumers"] == sorted(
        [{"kind": "dashboard", "id": partage}, {"kind": "dashboard", "id": de_cora}],
        key=lambda item: item["id"],
    )
    assert d_ada not in reponse.text and SECRET not in reponse.text
    # L'administrateur supprime aussi une analyse partagée : il voit le sien, pas celui de Cora.
    reponse = supprimer(banc, ADMIN_GROUPE, analyse)
    erreur = reponse.json()["error"]
    assert reponse.status_code == 409 and erreur["others"] == 1
    assert sorted(item["id"] for item in erreur["consumers"]) == sorted([partage, d_ada])
    assert de_cora not in reponse.text
    # Rien n'a été retiré.
    assert banc.depot.read(A, analyse).revision.number == 1
    assert banc.index.get(A, analyse) is not None


def test_une_suppression_seulement_par_des_dashboards_personnels_d_autres_est_refusee(
    banc: Banc,
) -> None:
    """Le dashboard d'un autre empêche la suppression, sans être nommé."""
    analyse = analyse_partagee(banc)
    banc.creer_tableau_ok(ADMIN_GROUPE, visual(analysis_id=analyse), visibility="personal")
    reponse = supprimer(banc, CREATEUR_GROUPE, analyse)
    assert reponse.status_code == 409
    assert reponse.json() == {"error": {"code": "analysis_in_use", "consumers": [], "others": 1}}


def test_toute_revision_epinglee_compte(banc: Banc) -> None:
    analyse = analyse_partagee(banc)
    assert (
        banc.reviser(CREATEUR_GROUPE, analyse, 1, visibility="shared", name="Deux").status_code
        == 201
    )
    tableau_ = banc.creer_tableau_ok(
        CREATEUR_GROUPE, visual(analysis_id=analyse, revision=1), visibility="shared"
    )
    assert nommes(consommateurs(banc, LECTEUR_GROUPE, analyse)) == [tableau_]
    assert supprimer(banc, CREATEUR_GROUPE, analyse, 2).status_code == 409


# -- dashboards supprimés ou retirés du composant -----------------------------------------------


def test_un_dashboard_supprime_par_la_route_n_est_plus_un_consommateur(banc: Banc) -> None:
    analyse = analyse_partagee(banc)
    tableau_ = banc.creer_tableau_ok(
        CREATEUR_GROUPE, visual(analysis_id=analyse), visibility="shared"
    )
    assert supprimer(banc, CREATEUR_GROUPE, analyse).status_code == 409
    reponse = banc.appel(
        CREATEUR_GROUPE,
        "DELETE",
        f"{CHEMIN_TABLEAUX}/{tableau_}",
        params={"expected_revision": "1"},
    )
    assert reponse.status_code == 204, reponse.text
    assert consommateurs(banc, CREATEUR_GROUPE, analyse)["consumers"] == []
    assert supprimer(banc, CREATEUR_GROUPE, analyse).status_code == 204


@pytest.mark.parametrize("qui", [CREATEUR_GROUPE, CREATEUR_PERSONNE])
def test_un_dashboard_supprime_dans_git_dont_la_ligne_reste_n_est_pas_un_consommateur(
    banc: Banc, qui: Profil
) -> None:
    """La suppression n'est pas encore passée dans l'index : git fait foi, pour son propriétaire
    comme pour les autres."""
    analyse = analyse_partagee(banc)
    tableau_ = banc.creer_tableau_ok(
        CREATEUR_PERSONNE, visual(analysis_id=analyse), visibility="shared"
    )
    banc.depot.delete(
        A, tableau_, expected_revision=1, actor=CREATEUR_PERSONNE.ref, kind=DASHBOARD_KIND
    )
    assert ligne_d_index(banc, tableau_).revision == 1
    assert consommateurs(banc, qui, analyse) == {"id": analyse, "consumers": [], "others": 0}
    assert supprimer(banc, CREATEUR_GROUPE, analyse).status_code == 204


def test_une_ligne_d_un_dashboard_inconnu_de_git_n_est_pas_un_consommateur(banc: Banc) -> None:
    analyse = analyse_partagee(banc)
    fantome = new_id()
    banc.tableaux.upsert(
        tableau(
            A,
            fantome,
            references=(Reference(new_id(), analyse, 1),),
            owner=CREATEUR_PERSONNE.ref,
            visibility="shared",
        )
    )
    assert consommateurs(banc, CREATEUR_GROUPE, analyse) == {
        "id": analyse,
        "consumers": [],
        "others": 0,
    }
    assert supprimer(banc, CREATEUR_GROUPE, analyse).status_code == 204


def test_une_ligne_dont_le_depot_n_a_aucun_commit_n_est_pas_un_consommateur(
    banc: Banc, tmp_path: Path
) -> None:
    vide = repository(init(tmp_path / "vide"))
    analyse = new_id()
    banc.tableaux.upsert(
        tableau(A, new_id(), references=(Reference(new_id(), analyse, 1),), visibility="shared")
    )
    assert (
        DashboardConsumers(vide, banc.tableaux)(A, analyse, CREATEUR_GROUPE.ref, vide.head())
        == Dependents()
    )


def test_retirer_le_composant_libere_l_analyse(banc: Banc) -> None:
    analyse = analyse_partagee(banc)
    tableau_ = banc.creer_tableau_ok(
        CREATEUR_GROUPE, visual(analysis_id=analyse), visibility="shared"
    )
    assert nommes(consommateurs(banc, CREATEUR_GROUPE, analyse)) == [tableau_]
    assert (
        banc.reviser_tableau(CREATEUR_GROUPE, tableau_, 1, text(), visibility="shared").status_code
        == 201
    )
    assert consommateurs(banc, CREATEUR_GROUPE, analyse)["consumers"] == []


# -- ligne d'index obsolète : git fait foi ------------------------------------------------------


def test_un_dashboard_devenu_personnel_dans_git_n_est_plus_nomme(banc: Banc) -> None:
    analyse = analyse_partagee(banc)
    tableau_ = banc.creer_tableau_ok(
        CREATEUR_PERSONNE, visual(analysis_id=analyse), visibility="shared", name=SECRET
    )
    publier(banc, CREATEUR_PERSONNE, tableau_, visibility="personal")
    # L'index dit encore « partagé » : c'est git qui est jugé.
    assert ligne_d_index(banc, tableau_).visibility == "shared"
    pour_cora = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{analyse}/consumers")
    assert pour_cora.json() == {"id": analyse, "consumers": [], "others": 1}
    assert tableau_ not in pour_cora.text and SECRET not in pour_cora.text
    assert consommateurs(banc, LECTEUR_GROUPE, analyse)["others"] == 1
    assert consommateurs(banc, ADMIN_GROUPE, analyse)["others"] == 1
    assert nommes(consommateurs(banc, CREATEUR_PERSONNE, analyse)) == [tableau_]
    refus = supprimer(banc, CREATEUR_GROUPE, analyse)
    assert refus.status_code == 409 and tableau_ not in refus.text
    assert refus.json()["error"]["others"] == 1


def test_un_dashboard_devenu_partage_dans_git_est_nomme(banc: Banc) -> None:
    analyse = analyse_partagee(banc)
    tableau_ = banc.creer_tableau_ok(
        CREATEUR_PERSONNE, visual(analysis_id=analyse), visibility="personal"
    )
    assert consommateurs(banc, CREATEUR_GROUPE, analyse)["others"] == 1
    publier(banc, CREATEUR_PERSONNE, tableau_, visibility="shared")
    assert ligne_d_index(banc, tableau_).visibility == "personal"
    assert consommateurs(banc, CREATEUR_GROUPE, analyse) == {
        "id": analyse,
        "consumers": [{"kind": "dashboard", "id": tableau_}],
        "others": 0,
    }


def test_une_ligne_obsolete_dont_la_visibilite_n_a_pas_change_reste_jugee_de_meme(
    banc: Banc,
) -> None:
    analyse = analyse_partagee(banc)
    tableau_ = banc.creer_tableau_ok(
        CREATEUR_PERSONNE, visual(analysis_id=analyse), visibility="shared"
    )
    publier(banc, CREATEUR_PERSONNE, tableau_, name="Renommé")
    assert ligne_d_index(banc, tableau_).name != "Renommé"
    assert nommes(consommateurs(banc, LECTEUR_GROUPE, analyse)) == [tableau_]


def test_un_dashboard_a_jour_n_est_pas_relu_dans_git(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Une ligne dont le commit est le dernier du fichier est jugée sur l'index seul."""
    analyse = analyse_partagee(banc)
    banc.creer_tableau_ok(CREATEUR_PERSONNE, visual(analysis_id=analyse), visibility="shared")

    def interdit(*args: object, **kwargs: object) -> None:
        raise AssertionError("read")

    monkeypatch.setattr(ContentRepository, "read", interdit)
    ouvert = DashboardConsumers(banc.depot, banc.tableaux)
    assert len(ouvert(A, analyse, LECTEUR_GROUPE.ref, banc.depot.head()).visible) == 1


# -- dashboard abîmé ----------------------------------------------------------------------------


def test_un_dashboard_abime_compte_parmi_les_autres_pour_tous(banc: Banc) -> None:
    analyse = analyse_partagee(banc)
    abime = banc.creer_tableau_ok(
        CREATEUR_PERSONNE, visual(analysis_id=analyse), visibility="shared", name=SECRET
    )
    commit(banc.racine, {f"dashboards/{A}/{abime}.yaml": b"api_version: x\n"}, "intrus")
    for profil in (CREATEUR_GROUPE, LECTEUR_GROUPE, ADMIN_GROUPE):
        reponse = banc.appel(profil, "GET", f"{CHEMIN}/{analyse}/consumers")
        assert reponse.status_code == 200
        assert reponse.json() == {"id": analyse, "consumers": [], "others": 1}, profil.nom
        assert abime not in reponse.text and SECRET not in reponse.text
    # Son créateur non plus ne le retrouve : on ne sait pas ce qu'il épingle, d'où un compte.
    assert consommateurs(banc, CREATEUR_PERSONNE, analyse) == {
        "id": analyse,
        "consumers": [],
        "others": 1,
    }
    assert supprimer(banc, CREATEUR_GROUPE, analyse).json()["error"]["others"] == 1


def test_un_dashboard_abime_sans_createur_connu_est_compte_dans_le_doute(banc: Banc) -> None:
    analyse = analyse_partagee(banc)
    abime = new_id()
    commit(banc.racine, {f"dashboards/{A}/{abime}.yaml": b"api_version: x\n"}, "à la main")
    banc.tableaux.upsert(
        tableau(
            A,
            abime,
            references=(Reference(new_id(), analyse, 1),),
            owner=CREATEUR_PERSONNE.ref,
            visibility="shared",
        )
    )
    # Ni le coup d'œil ni la ligne d'index ne disent ce qu'il épingle : dans le doute, l'analyse
    # est tenue pour consommée (la ligne d'index est en retard sur git, git fait foi).
    assert consommateurs(banc, CREATEUR_PERSONNE, analyse) == {
        "id": analyse,
        "consumers": [],
        "others": 1,
    }


# -- droits de la route -------------------------------------------------------------------------


@pytest.mark.parametrize("profil", MEMBRES, ids=lambda profil: profil.nom)
def test_une_analyse_partagee_se_consulte_comme_elle_se_lit(banc: Banc, profil: Profil) -> None:
    analyse = analyse_partagee(banc)
    lecture = banc.appel(profil, "GET", f"{CHEMIN}/{analyse}")
    reponse = banc.appel(profil, "GET", f"{CHEMIN}/{analyse}/consumers")
    assert (reponse.status_code, lecture.status_code) == (200, 200)


@pytest.mark.parametrize(
    "profil", [p for p in MEMBRES if p is not CREATEUR_GROUPE], ids=lambda profil: profil.nom
)
def test_une_analyse_personnelle_d_un_autre_repond_comme_une_inconnue(
    banc: Banc, profil: Profil
) -> None:
    """Administrateurs compris, et même quand un dashboard la consomme."""
    analyse = banc.creer_ok(CREATEUR_GROUPE, visibility="personal", name=SECRET)
    banc.creer_tableau_ok(CREATEUR_GROUPE, visual(analysis_id=analyse), name=SECRET)
    reponse = banc.appel(profil, "GET", f"{CHEMIN}/{analyse}/consumers")
    inconnue = banc.appel(profil, "GET", f"{CHEMIN}/{INCONNUE}/consumers")
    assert reponse.status_code == inconnue.status_code == 404
    assert reponse.json() == inconnue.json()
    assert SECRET not in reponse.text and analyse not in reponse.text


def test_une_analyse_personnelle_se_consulte_par_son_proprietaire(banc: Banc) -> None:
    analyse = banc.creer_ok(CREATEUR_GROUPE, visibility="personal")
    assert consommateurs(banc, CREATEUR_GROUPE, analyse)["consumers"] == []


def test_un_identifiant_mal_forme_repond_comme_une_inconnue(banc: Banc) -> None:
    mal_forme = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/pas-un-identifiant/consumers")
    inconnue = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{INCONNUE}/consumers")
    assert mal_forme.status_code == inconnue.status_code == 404
    assert mal_forme.json() == inconnue.json()


@pytest.mark.parametrize(
    ("profil", "statut"),
    [(PLATEFORME_SEULE, 403), (NON_MEMBRE, 404)],
    ids=lambda v: getattr(v, "nom", str(v)),
)
def test_sans_role_dans_l_espace_la_route_refuse(banc: Banc, profil: Profil, statut: int) -> None:
    analyse = analyse_partagee(banc, name=SECRET)
    banc.creer_tableau_ok(CREATEUR_GROUPE, visual(analysis_id=analyse), visibility="shared")
    reponse = banc.appel(profil, "GET", f"{CHEMIN}/{analyse}/consumers")
    assert reponse.status_code == statut
    assert SECRET not in reponse.text and "consumers" not in reponse.text


def test_sans_session_la_route_est_refusee(banc: Banc) -> None:
    analyse = analyse_partagee(banc)
    assert banc.appel(None, "GET", f"{CHEMIN}/{analyse}/consumers").status_code == 401


def test_un_autre_espace_ne_voit_pas_l_analyse(banc: Banc) -> None:
    analyse = analyse_partagee(banc)
    voisin = CHEMIN.replace(A, "rh")
    for profil in (ADMIN_GROUPE, LECTEUR_GROUPE):
        assert banc.appel(profil, "GET", f"{voisin}/{analyse}/consumers").status_code == 404


def test_une_analyse_supprimee_n_a_plus_de_consommateurs_a_lire(banc: Banc) -> None:
    analyse = analyse_partagee(banc)
    assert supprimer(banc, CREATEUR_GROUPE, analyse).status_code == 204
    for profil in (CREATEUR_GROUPE, LECTEUR_GROUPE, ADMIN_GROUPE):
        reponse = banc.appel(profil, "GET", f"{CHEMIN}/{analyse}/consumers")
        inconnue = banc.appel(profil, "GET", f"{CHEMIN}/{INCONNUE}/consumers")
        assert reponse.status_code == inconnue.status_code == 404
        assert reponse.json() == inconnue.json()


def test_une_analyse_supprimee_dans_git_avec_ses_lignes_repond_404(banc: Banc) -> None:
    analyse = analyse_partagee(banc)
    banc.creer_tableau_ok(CREATEUR_GROUPE, visual(analysis_id=analyse), visibility="shared")
    banc.depot.delete(A, analyse, expected_revision=1, actor=CREATEUR_GROUPE.ref)
    for profil in (CREATEUR_GROUPE, LECTEUR_GROUPE):
        assert banc.appel(profil, "GET", f"{CHEMIN}/{analyse}/consumers").status_code == 404


def test_la_route_ne_modifie_rien(banc: Banc) -> None:
    analyse = analyse_partagee(banc)
    tableau_ = banc.creer_tableau_ok(
        CREATEUR_GROUPE, visual(analysis_id=analyse), visibility="shared"
    )
    tete = banc.depot.head()
    avant = (banc.index.rows(A), banc.tableaux.get(A, tableau_))
    for _ in range(2):
        consommateurs(banc, LECTEUR_GROUPE, analyse)
    assert banc.depot.head() == tete
    assert (banc.index.rows(A), banc.tableaux.get(A, tableau_)) == avant


def test_la_route_sans_depot_est_indisponible(banc_sans_depot: Banc) -> None:
    reponse = banc_sans_depot.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{INCONNUE}/consumers")
    assert reponse.json()["error"]["code"] == "content_unavailable"


def test_le_mode_local_refuse_la_route(service: CatalogService, tmp_path: Path) -> None:
    depot = repository(init(tmp_path / "contenus"))
    app = create_app(service, content_repository=depot)
    with TestClient(app, base_url="http://127.0.0.1", raise_server_exceptions=False) as client:
        reponse = client.get(f"/api/spaces/local/analyses/{INCONNUE}/consumers")
    assert reponse.status_code == 409
    assert reponse.json()["error"]["code"] == "local_mode"


# -- Dependents ---------------------------------------------------------------------------------


def test_dependents_se_comporte_comme_un_booleen_et_se_serialise() -> None:
    assert not Dependents()
    assert Dependents(others=2)
    assert Dependents((Consumer("dashboard", "x"),))
    assert Dependents().json() == {"consumers": [], "others": 0}
    assert Dependents((Consumer("dashboard", "x"), Consumer("dashboard", "y")), 3).json() == {
        "consumers": [{"kind": "dashboard", "id": "x"}, {"kind": "dashboard", "id": "y"}],
        "others": 3,
    }


# -- git fait foi : un index incomplet ne libère jamais une analyse consommée -------------------


def sans_ligne(banc: Banc, ident: str) -> None:
    """Le dashboard est publié dans git, mais l'écriture de l'index n'a pas eu lieu."""
    banc.tableaux.remove(A, ident, 1)
    assert banc.tableaux.get(A, ident) is None


def test_un_index_vide_ne_libere_pas_une_analyse_que_git_voit_consommee(banc: Banc) -> None:
    analyse = analyse_partagee(banc)
    tableau_ = banc.creer_tableau_ok(
        CREATEUR_PERSONNE, visual(analysis_id=analyse), visibility="shared"
    )
    sans_ligne(banc, tableau_)
    assert nommes(consommateurs(banc, LECTEUR_GROUPE, analyse)) == [tableau_]
    refus = supprimer(banc, CREATEUR_GROUPE, analyse)
    assert refus.status_code == 409
    assert refus.json() == {
        "error": {
            "code": "analysis_in_use",
            "consumers": [{"kind": "dashboard", "id": tableau_}],
            "others": 0,
        }
    }
    # L'analyse est toujours là.
    assert banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{analyse}").status_code == 200


def test_un_dashboard_personnel_absent_de_l_index_est_compte_sans_etre_nomme(banc: Banc) -> None:
    analyse = analyse_partagee(banc)
    tableau_ = banc.creer_tableau_ok(CREATEUR_PERSONNE, visual(analysis_id=analyse), name=SECRET)
    sans_ligne(banc, tableau_)
    reponse = supprimer(banc, CREATEUR_GROUPE, analyse)
    assert reponse.status_code == 409
    assert reponse.json()["error"]["others"] == 1 and reponse.json()["error"]["consumers"] == []
    assert tableau_ not in reponse.text and SECRET not in reponse.text


def test_une_ligne_perimee_qui_epingle_encore_l_analyse_ne_la_retient_plus(banc: Banc) -> None:
    """Git dit que la courante n'épingle plus l'analyse : la ligne en retard est ignorée."""
    analyse, autre = analyse_partagee(banc), analyse_partagee(banc)
    tableau_ = banc.creer_tableau_ok(
        CREATEUR_PERSONNE, visual(analysis_id=analyse), visibility="shared"
    )
    reviser = banc.depot.read(A, tableau_, kind=DASHBOARD_KIND)
    publier(
        banc,
        CREATEUR_PERSONNE,
        tableau_,
        layout={"sections": [section(row(column(visual(analysis_id=autre), span=12)))]},
    )
    assert reviser.revision.number == 1 and ligne_d_index(banc, tableau_).revision == 1
    assert consommateurs(banc, CREATEUR_GROUPE, analyse) == {
        "id": analyse,
        "consumers": [],
        "others": 0,
    }
    assert nommes(consommateurs(banc, CREATEUR_GROUPE, autre)) == [tableau_]
    assert supprimer(banc, CREATEUR_GROUPE, analyse).status_code == 204


def test_une_base_en_panne_refuse_la_suppression_et_la_consultation(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Sans index lisible, l'exhaustivité n'est pas établie : rien n'est supprimé."""
    analyse = analyse_partagee(banc)
    banc.creer_tableau_ok(CREATEUR_PERSONNE, visual(analysis_id=analyse), visibility="shared")

    def panne(*args: object, **kwargs: object) -> Any:
        raise OperationalError("select", {}, Exception("base indisponible"))

    monkeypatch.setattr(DashboardIndex, "rows", panne)
    refus = supprimer(banc, CREATEUR_GROUPE, analyse)
    assert refus.status_code == 503
    assert refus.json() == {"error": {"code": "content_unavailable"}}
    assert banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{analyse}/consumers").status_code == 503
    monkeypatch.undo()
    assert banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{analyse}").status_code == 200
    assert supprimer(banc, CREATEUR_GROUPE, analyse).status_code == 409


def test_un_depot_en_panne_refuse_la_suppression(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    analyse = analyse_partagee(banc)

    def panne(*args: object, **kwargs: object) -> Any:
        raise ContentError("content_unavailable", "git_failed")

    monkeypatch.setattr(ContentRepository, "latest", panne)
    assert supprimer(banc, CREATEUR_GROUPE, analyse).status_code == 503
    monkeypatch.undo()
    assert banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{analyse}").status_code == 200


# -- la tête ne bouge pas entre le jugement et la suppression -----------------------------------


def dashboard_pinning(ident: str, analyse: str) -> dict[str, Any]:
    owner = {"issuer": CREATEUR_PERSONNE.ref.issuer, "subject": CREATEUR_PERSONNE.ref.subject}
    return with_components(
        visual(analysis_id=analyse), dashboard_id=ident, visibility="shared", owner=owner
    )


def intercaler(
    banc: Banc, monkeypatch: pytest.MonkeyPatch, evenement: Any, fois: int | None = 1
) -> list[int]:
    """Après le jugement des consommateurs, `evenement()` publie dans git avant la suppression
    (au plus `fois` fois, `None` pour toujours)."""
    appels: list[int] = []
    juger = DashboardConsumers.__call__

    def espion(self: DashboardConsumers, *args: Any) -> Dependents:
        trouves = juger(self, *args)
        appels.append(1)
        if fois is None or len(appels) <= fois:
            evenement()
        return trouves

    monkeypatch.setattr(DashboardConsumers, "__call__", espion)
    return appels


def test_un_dashboard_publie_apres_le_jugement_empeche_la_suppression(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    """La tête a bougé : on juge une fois de plus, et l'analyse est alors consommée."""
    analyse = analyse_partagee(banc)
    nouveau = new_id()

    def publier_un_dashboard() -> None:
        banc.depot.write(
            A,
            nouveau,
            dashboard_pinning(nouveau, analyse),
            expected_revision=None,
            actor=CREATEUR_PERSONNE.ref,
            kind=DASHBOARD_KIND,
        )

    appels = intercaler(banc, monkeypatch, publier_un_dashboard)
    refus = supprimer(banc, CREATEUR_GROUPE, analyse)
    assert refus.status_code == 409
    assert refus.json()["error"]["code"] == "analysis_in_use"
    assert refus.json()["error"]["consumers"] == [{"kind": "dashboard", "id": nouveau}]
    assert len(appels) == 2
    assert banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{analyse}").status_code == 200


def test_une_publication_sans_rapport_fait_rejuger_une_fois_puis_supprime(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    analyse = analyse_partagee(banc)
    appels = intercaler(banc, monkeypatch, lambda: analyse_partagee(banc))
    assert supprimer(banc, CREATEUR_GROUPE, analyse).status_code == 204
    assert len(appels) == 2


def test_une_tete_qui_bouge_toujours_donne_un_conflit_sans_rien_supprimer(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    analyse = analyse_partagee(banc)
    appels = intercaler(banc, monkeypatch, lambda: analyse_partagee(banc), fois=None)
    refus = supprimer(banc, CREATEUR_GROUPE, analyse)
    assert refus.status_code == 409
    assert refus.json() == {"error": {"code": "revision_conflict", "reason": "stale"}}
    assert len(appels) == 2
    monkeypatch.undo()
    assert banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{analyse}").status_code == 200


def test_un_conflit_de_revision_est_dit_avant_tout_jugement(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    analyse = analyse_partagee(banc)
    appels = intercaler(banc, monkeypatch, lambda: None)
    assert supprimer(banc, CREATEUR_GROUPE, analyse, revision=2).status_code == 409
    assert appels == []


def test_une_panne_de_git_en_relisant_un_dashboard_refuse_la_suppression(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Ce n'est pas un dashboard abîmé : le dépôt est en panne, l'exhaustivité n'est pas établie."""
    analyse = analyse_partagee(banc)
    tableau_ = banc.creer_tableau_ok(
        CREATEUR_PERSONNE, visual(analysis_id=analyse), visibility="shared"
    )
    sans_ligne(banc, tableau_)
    lire = ContentRepository.read

    def panne(self: ContentRepository, *args: Any, **options: Any) -> Any:
        if options.get("kind") is DASHBOARD_KIND:
            raise ContentError("content_unavailable", "git_failed")
        return lire(self, *args, **options)

    monkeypatch.setattr(ContentRepository, "read", panne)
    refus = supprimer(banc, CREATEUR_GROUPE, analyse)
    assert (refus.status_code, refus.json()) == (503, {"error": {"code": "content_unavailable"}})
    monkeypatch.undo()
    assert banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN}/{analyse}").status_code == 200


def test_un_conflit_de_revision_sous_le_verrou_n_est_pas_rejoue(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Seul un conflit de tête est rejugé ; une révision attendue périmée est dite telle quelle."""
    analyse = analyse_partagee(banc)
    appels: list[int] = []

    def perimee(self: ContentRepository, *args: Any, **options: Any) -> Any:
        appels.append(1)
        raise ContentError("revision_conflict", "stale")

    monkeypatch.setattr(ContentRepository, "delete", perimee)
    refus = supprimer(banc, CREATEUR_GROUPE, analyse)
    assert (refus.status_code, refus.json()) == (
        409,
        {"error": {"code": "revision_conflict", "reason": "stale"}},
    )
    assert appels == [1]
