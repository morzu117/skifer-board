"""États de lecture des dashboards, sur un vrai serveur (plan 19.2, B4 et B7).

À la lecture, chaque composant exécutable est `ready`, `unavailable` (avec sa raison) ou
`unverified`, pour la personne qui lit ; l'état global suit la priorité du plan 18 :
`index_stale`, `unverified`, `unresolved_reference`, `ready`. La réponse ne recopie jamais rien
d'une analyse : le web les lira par les routes des analyses.
"""

from __future__ import annotations

from typing import Any

import pytest
from skifer_board.content.index import DashboardIndex
from skifer_board.content.repository import DASHBOARD_KIND
from skifer_board.execution import ConnectionStore
from skifer_board.spaces.model import Environment, PersonRef
from spaces.monde import (
    ADMIN_GROUPE,
    CREATEUR_GROUPE,
    CREATEUR_PERSONNE,
    LECTEUR_GROUPE,
    A,
    Profil,
)
from sqlalchemy.exc import OperationalError

from .aides_dashboards import (
    SECRET,
    STOCK,
    ajouter_stock,
    chemin_dashboard,
    cles_et_textes,
    restaurer_catalogue,
    sans_catalogue,
    seulement_stock,
    typer,
)
from .monde import commit, new_id
from .monde_dashboard import common_filter, kpi, text, visual, with_components
from .serveur import CHEMIN, CHEMIN_TABLEAUX, Banc, corps

C1 = "bbbbbbbb-0000-4000-8000-000000000001"
C2 = "bbbbbbbb-0000-4000-8000-000000000002"
C3 = "bbbbbbbb-0000-4000-8000-000000000003"
INDISPONIBLE = "analysis_unavailable"
NON_RESOLUE = "unresolved_reference"
FILTRE = "filter_incompatible"


def requete(**changes: Any) -> dict[str, Any]:
    return {**corps()["query"], **changes}


def analyse(banc: Banc, profil: Profil = CREATEUR_GROUPE, **changes: Any) -> str:
    changes.setdefault("visibility", "shared")
    return banc.creer_ok(profil, **changes)


def lire(
    banc: Banc, ident: str, profil: Profil = LECTEUR_GROUPE, suffixe: str = ""
) -> dict[str, Any]:
    reponse = banc.appel(profil, "GET", f"{CHEMIN_TABLEAUX}/{ident}{suffixe}")
    assert reponse.status_code == 200, reponse.text
    result: dict[str, Any] = reponse.json()
    return result


def etats(vue: dict[str, Any]) -> list[tuple[str, str, str | None]]:
    """Chaque composant exécutable : identifiant, état, raison."""
    return [(item["id"], item["state"], item.get("reason")) for item in vue["components"]]


def partage(banc: Banc, *composants: dict[str, Any], **changes: Any) -> str:
    changes.setdefault("visibility", "shared")
    return banc.creer_tableau_ok(CREATEUR_GROUPE, *composants, **changes)


def ecrire_hors_index(banc: Banc, ident: str, **changes: Any) -> None:
    """Une révision publiée dans git sans que l'index l'ait su."""
    stocke = banc.depot.read(A, ident, kind=DASHBOARD_KIND)
    banc.depot.write(
        A,
        ident,
        {**stocke.document, **changes},
        expected_revision=stocke.revision.number,
        actor=CREATEUR_GROUPE.ref,
        kind=DASHBOARD_KIND,
    )


def ecrire_sans_controle(banc: Banc, *composants: dict[str, Any], **changes: Any) -> str:
    """Un dashboard partagé écrit directement dans git, sans passer par les contrôles d'analyses."""
    ident = new_id()
    proprietaire = {"issuer": CREATEUR_GROUPE.ref.issuer, "subject": CREATEUR_GROUPE.ref.subject}
    document = with_components(
        *composants, **{"visibility": "shared", "owner": proprietaire, **changes}
    )
    document["id"] = ident
    banc.depot.write(
        A, ident, document, expected_revision=None, actor=CREATEUR_GROUPE.ref, kind=DASHBOARD_KIND
    )
    return ident


def panne(*_: Any, **__: Any) -> None:
    raise OperationalError("SELECT secret_dsn", {}, Exception("postgresql://user:motdepasse@h/db"))


# -- état de chaque composant ------------------------------------------------------------------


def test_chaque_composant_executable_est_pret_dans_l_ordre_du_document(banc: Banc) -> None:
    ventes, autre = analyse(banc), analyse(banc)
    ident = partage(
        banc,
        visual(ident=C2, analysis_id=ventes),
        text(),
        kpi(ident=C1, analysis_id=analyse(banc, **valeur())),
        visual(ident=C3, analysis_id=autre),
    )
    vue = lire(banc, ident)
    assert vue["state"] == "ready"
    assert vue["components"] == [
        {"id": C2, "state": "ready"},
        {"id": C1, "state": "ready"},
        {"id": C3, "state": "ready"},
    ]
    assert set(vue) == {
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
    assert vue["id"] == ident and vue["space_id"] == A
    assert vue["revision"] == vue["current_revision"] == 1
    assert vue["revised_by"] == {"issuer": CREATEUR_GROUPE.ref.issuer, "subject": "cora"}


def valeur() -> dict[str, Any]:
    """Analyse sans dimension dont le graphique est `value` : ce qu'un KPI épingle."""
    return {
        "query": requete(dimensions=[], filters=[]),
        "contextual": [],
        "presentation": {"chart": "value"},
    }


def test_un_dashboard_sans_composant_executable_est_pret(banc: Banc) -> None:
    ident = partage(banc, text())
    vue = lire(banc, ident)
    assert (vue["state"], vue["components"]) == ("ready", [])


def test_une_analyse_que_le_lecteur_ne_voit_pas_est_indisponible_pour_lui_seul(
    banc: Banc,
) -> None:
    """Partagée en révision 1, rendue personnelle en révision 2 : cora la voit toujours, lea non."""
    cachee, visible = analyse(banc, name=SECRET), analyse(banc)
    ident = partage(
        banc, visual(ident=C1, analysis_id=cachee), visual(ident=C2, analysis_id=visible)
    )
    assert (
        banc.reviser(CREATEUR_GROUPE, cachee, 1, visibility="personal", name=SECRET).status_code
        == 201
    )
    pour_lea = lire(banc, ident)
    assert etats(pour_lea) == [(C1, "unavailable", INDISPONIBLE), (C2, "ready", None)]
    assert pour_lea["state"] == "unresolved_reference"
    pour_cora = lire(banc, ident, CREATEUR_GROUPE)
    assert etats(pour_cora) == [(C1, "ready", None), (C2, "ready", None)]
    assert pour_cora["state"] == "ready"
    assert SECRET not in str(pour_lea)


def test_inexistante_invisible_ou_supprimee_se_lisent_de_la_meme_facon(banc: Banc) -> None:
    """Rien ne dit, au lecteur, si l'analyse est invisible, supprimée ou n'a jamais existé."""
    invisible = analyse(banc, name=SECRET)
    assert banc.reviser(CREATEUR_GROUPE, invisible, 1, visibility="personal").status_code == 201
    supprimee = analyse(banc, name=SECRET)
    banc.depot.delete(A, supprimee, expected_revision=1, actor=CREATEUR_GROUPE.ref)
    revision_absente = analyse(banc)
    cas = {
        "invisible": visual(ident=C1, analysis_id=invisible),
        "supprimee": visual(ident=C1, analysis_id=supprimee),
        "inexistante": visual(ident=C1, analysis_id=new_id()),
        "revision absente": visual(ident=C1, analysis_id=revision_absente, revision=9),
    }
    vues = []
    for composant in cas.values():
        vue = lire(banc, ecrire_sans_controle(banc, composant))
        vues.append(vue["components"])
        assert vue["state"] == "index_stale"
    attendu = [{"id": C1, "state": "unavailable", "reason": INDISPONIBLE}]
    assert vues == [attendu] * len(cas)


def test_la_supprimee_reste_une_analyse_indisponible_pour_son_proprietaire(banc: Banc) -> None:
    """Même cora ne référence plus une analyse supprimée."""
    supprimee = analyse(banc)
    ident = ecrire_sans_controle(banc, visual(ident=C1, analysis_id=supprimee))
    banc.depot.delete(A, supprimee, expected_revision=1, actor=CREATEUR_GROUPE.ref)
    assert etats(lire(banc, ident, CREATEUR_GROUPE)) == [(C1, "unavailable", INDISPONIBLE)]


@pytest.mark.parametrize(
    ("cause", "tuile_stock"),
    [
        # `redefinir` réécrit le catalogue de test : le modèle `stock` n'y est plus.
        ("metrique", "unavailable"),
        ("dimension", "unavailable"),
        ("modele", "ready"),
        ("connexion", "unavailable"),
    ],
)
def test_une_reference_disparue_apres_la_sauvegarde_rend_la_tuile_non_resolue(
    banc: Banc, cause: str, tuile_stock: str
) -> None:
    ajouter_stock(banc)
    ventes = analyse(banc)
    stock = analyse(banc, query=requete(model=STOCK), contextual=[])
    ident = partage(banc, visual(ident=C1, analysis_id=ventes), visual(ident=C2, analysis_id=stock))
    assert lire(banc, ident)["state"] == "ready"
    if cause == "metrique":
        banc.redefinir(["orders"], ["region", "channel"])
    elif cause == "dimension":
        banc.redefinir(["revenue"], ["channel"])
    elif cause == "modele":
        seulement_stock(banc)
    else:
        moteur, acteur = banc.monde.moteur, PersonRef.of(ADMIN_GROUPE.identite)
        registre = ConnectionStore(moteur)
        registre.unbind(A, "finance", Environment.DEV, acteur, banc.monde.horloge())
        registre.remove(A, "finance", acteur, banc.monde.horloge())
    vue = lire(banc, ident)
    assert vue["state"] == "unresolved_reference"
    raison = None if tuile_stock == "ready" else NON_RESOLUE
    assert etats(vue) == [(C1, "unavailable", NON_RESOLUE), (C2, tuile_stock, raison)]
    # Le contenu, lui, est toujours servi tel qu'il est dans git.
    assert vue["dashboard"] == banc.depot.read(A, ident, kind=DASHBOARD_KIND).document


def test_un_filtre_commun_devenu_incompatible_rend_la_tuile_indisponible(banc: Banc) -> None:
    ciblee, libre = analyse(banc), analyse(banc)
    ident = partage(
        banc,
        visual(ident=C1, analysis_id=ciblee),
        visual(ident=C2, analysis_id=libre),
        filters=[common_filter([C1], dimension="channel")],
    )
    assert lire(banc, ident)["state"] == "ready"
    banc.redefinir(["revenue"], ["region"])
    vue = lire(banc, ident)
    assert etats(vue) == [(C1, "unavailable", FILTRE), (C2, "ready", None)]
    assert vue["state"] == "unresolved_reference"


@pytest.mark.parametrize(
    ("filtre", "changement"),
    [
        ({"dimension": "region"}, lambda banc: typer(banc, "region", "date")),
        ({"dimension": "year", "default": 2024}, lambda banc: typer(banc, "year", "boolean")),
    ],
    ids=["operateur", "valeur"],
)
def test_le_type_d_une_dimension_qui_change_rend_le_filtre_incompatible(
    banc: Banc, filtre: dict[str, Any], changement: Any
) -> None:
    ident = partage(
        banc,
        visual(
            ident=C1,
            analysis_id=analyse(
                banc, query=requete(dimensions=["year"], filters=[]), contextual=[]
            ),
        ),
        filters=[common_filter([C1], **filtre)],
    )
    changement(banc)
    assert etats(lire(banc, ident)) == [(C1, "unavailable", FILTRE)]


def test_une_reference_disparue_l_emporte_sur_un_filtre_incompatible(banc: Banc) -> None:
    ident = partage(
        banc,
        visual(ident=C1, analysis_id=analyse(banc)),
        filters=[common_filter([C1], dimension="channel")],
    )
    banc.redefinir(["orders"], ["region"])
    assert etats(lire(banc, ident)) == [(C1, "unavailable", NON_RESOLUE)]


def test_une_analyse_indisponible_l_emporte_sur_toute_autre_raison(banc: Banc) -> None:
    cachee = analyse(banc)
    ident = partage(
        banc,
        visual(ident=C1, analysis_id=cachee),
        filters=[common_filter([C1], dimension="channel")],
    )
    banc.reviser(CREATEUR_GROUPE, cachee, 1, visibility="personal")
    banc.redefinir(["orders"], ["region"])
    sans_catalogue(banc)
    vue = lire(banc, ident)
    assert etats(vue) == [(C1, "unavailable", INDISPONIBLE)]
    assert vue["state"] == "unverified"


# -- état invérifiable -------------------------------------------------------------------------


def test_sans_catalogue_les_tuiles_lisibles_sont_non_verifiees(banc: Banc) -> None:
    cachee = analyse(banc)
    ident = partage(
        banc, visual(ident=C1, analysis_id=analyse(banc)), visual(ident=C2, analysis_id=cachee)
    )
    banc.reviser(CREATEUR_GROUPE, cachee, 1, visibility="personal")
    sans_catalogue(banc)
    vue = lire(banc, ident)
    assert vue["state"] == "unverified"
    assert etats(vue) == [(C1, "unverified", None), (C2, "unavailable", INDISPONIBLE)]


def test_une_base_qui_ne_repond_pas_pour_les_connexions_laisse_les_tuiles_non_verifiees(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    ident = partage(banc, visual(ident=C1, analysis_id=analyse(banc)))
    monkeypatch.setattr(ConnectionStore, "list", panne)
    vue = lire(banc, ident)
    assert (vue["state"], etats(vue)) == ("unverified", [(C1, "unverified", None)])
    assert "motdepasse" not in str(vue)


def test_une_base_qui_ne_repond_pas_pour_l_index_laisse_le_dashboard_non_verifie(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    ident = partage(banc, visual(ident=C1, analysis_id=analyse(banc)))
    monkeypatch.setattr(DashboardIndex, "get", panne)
    vue = lire(banc, ident)
    assert (vue["state"], etats(vue)) == ("unverified", [(C1, "unverified", None)])
    # Une écriture publiée ne dépend pas de la lecture de l'index : elle est seulement non vérifiée.
    revisee = banc.reviser_tableau(
        CREATEUR_GROUPE, ident, 1, visual(ident=C1, analysis_id=analyse(banc)), visibility="shared"
    )
    assert revisee.status_code == 201 and revisee.json()["state"] == "unverified"


def test_une_base_en_panne_apres_la_publication_ne_defait_rien(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Publiée dans git, la révision reste ; l'index en retard est dit à la lecture suivante."""
    ident = analyse(banc)
    with monkeypatch.context() as contexte:
        contexte.setattr(DashboardIndex, "upsert", panne)
        creation = banc.creer_tableau(
            CREATEUR_GROUPE, visual(ident=C1, analysis_id=ident), visibility="shared"
        )
    assert creation.status_code == 201 and "motdepasse" not in creation.text
    nouveau = creation.json()["id"]
    assert creation.json()["state"] == "index_stale"
    assert banc.tableaux.get(A, nouveau) is None
    assert lire(banc, nouveau)["state"] == "index_stale"
    with monkeypatch.context() as contexte:
        contexte.setattr(DashboardIndex, "upsert", panne)
        contexte.setattr(DashboardIndex, "get", panne)
        revision = banc.reviser_tableau(
            CREATEUR_GROUPE,
            nouveau,
            1,
            visual(ident=C1, analysis_id=ident),
            name="Deux",
            visibility="shared",
        )
        copie = banc.appel(CREATEUR_GROUPE, "POST", f"{CHEMIN_TABLEAUX}/{nouveau}/duplicate")
    assert revision.status_code == 201 and revision.json()["state"] == "unverified"
    assert copie.status_code == 201 and copie.json()["state"] == "unverified"
    assert len(banc.depot.history(A, nouveau, kind=DASHBOARD_KIND)) == 2
    assert len(banc.depot.dashboards()) == 2


# -- priorité de l'état global -----------------------------------------------------------------


def test_l_etat_global_suit_la_priorite_a_chaque_transition(banc: Banc) -> None:
    """`ready`, `unresolved_reference`, `unverified`, `index_stale`, et le retour à `ready`."""
    ident = partage(banc, visual(ident=C1, analysis_id=analyse(banc)))

    def etat(profil: Profil = LECTEUR_GROUPE) -> str:
        return str(lire(banc, ident, profil)["state"])

    assert etat() == "ready"
    banc.redefinir(["orders"], ["region"])
    assert etat() == "unresolved_reference"
    sans_catalogue(banc)
    assert etat() == "unverified"
    restaurer_catalogue(banc)
    assert etat() == "ready"
    banc.redefinir(["orders"], ["region"])
    # Un écart d'index l'emporte sur les deux autres, quelle que soit la personne qui lit.
    ecrire_hors_index(banc, ident, name="Écrit hors index")
    assert etat() == "index_stale" and etat(CREATEUR_GROUPE) == "index_stale"
    sans_catalogue(banc)
    assert etat() == "index_stale"
    restaurer_catalogue(banc)
    assert etat() == "index_stale"
    # Une sauvegarde par l'API remet l'index à jour : le dashboard est de nouveau prêt.
    revisee = banc.reviser_tableau(
        CREATEUR_GROUPE, ident, 2, visual(ident=C1, analysis_id=analyse(banc)), visibility="shared"
    )
    assert revisee.status_code == 201 and revisee.json()["state"] == "ready"
    assert etat() == "ready"


def test_un_dashboard_absent_de_l_index_est_perime(banc: Banc) -> None:
    ident = partage(banc, visual(ident=C1, analysis_id=analyse(banc)))
    assert lire(banc, ident)["state"] == "ready"
    banc.tableaux.remove(A, ident, 1)
    assert lire(banc, ident)["state"] == "index_stale"


def test_une_revision_ancienne_n_est_pas_comparee_a_l_index(banc: Banc) -> None:
    ident = partage(banc, visual(ident=C1, analysis_id=analyse(banc)))
    revisee = banc.reviser_tableau(
        CREATEUR_GROUPE, ident, 1, visual(ident=C1, analysis_id=analyse(banc)), visibility="shared"
    )
    assert revisee.status_code == 201
    ecrire_hors_index(banc, ident, name="Hors index")
    ancienne = lire(banc, ident, suffixe="/revisions/1")
    assert (ancienne["revision"], ancienne["current_revision"]) == (1, 3)
    assert ancienne["state"] == "ready"
    assert lire(banc, ident)["state"] == "index_stale"
    banc.redefinir(["orders"], ["region"])
    assert lire(banc, ident, suffixe="/revisions/1")["state"] == "unresolved_reference"


def test_un_dashboard_supprime_se_lit_par_ses_revisions_sans_ecart_d_index(banc: Banc) -> None:
    ident = partage(banc, visual(ident=C1, analysis_id=analyse(banc)))
    suppression = banc.appel(
        CREATEUR_GROUPE, "DELETE", f"{CHEMIN_TABLEAUX}/{ident}", params={"expected_revision": "1"}
    )
    assert suppression.status_code == 204
    vue = lire(banc, ident, CREATEUR_GROUPE, "/revisions/1")
    assert vue["current_revision"] is None and vue["state"] == "ready"
    assert vue["permissions"] == {
        "owner": True,
        "revise": False,
        "delete": False,
        "duplicate": False,
    }
    assert etats(vue) == [(C1, "ready", None)]


def test_chaque_personne_voit_l_etat_de_ses_propres_droits(banc: Banc) -> None:
    """L'état d'une même révision dépend de qui lit : l'analyse que cora seule voit est
    indisponible pour cyril, mais lea et lui voient la même chose."""
    cachee = analyse(banc)
    ident = partage(banc, visual(ident=C1, analysis_id=cachee))
    banc.reviser(CREATEUR_GROUPE, cachee, 1, visibility="personal")
    assert lire(banc, ident, CREATEUR_GROUPE)["state"] == "ready"
    for profil in (LECTEUR_GROUPE, CREATEUR_PERSONNE, ADMIN_GROUPE):
        assert lire(banc, ident, profil)["state"] == "unresolved_reference", profil.nom


# -- ni requête, ni valeur, ni nom -------------------------------------------------------------


def test_la_reponse_ne_recopie_rien_d_une_analyse(banc: Banc) -> None:
    secret_filtre = f"{SECRET}_filtre"
    analyse_secrete = analyse(
        banc,
        name=SECRET,
        description=SECRET,
        query=requete(filters=[{"column": "region", "operator": "eq", "value": secret_filtre}]),
    )
    ident = partage(
        banc,
        visual(ident=C1, analysis_id=analyse_secrete),
        kpi(ident=C2, analysis_id=analyse(banc, **valeur())),
        name="Pilotage",
    )
    reponses: list[Any] = [lire(banc, ident), lire(banc, ident, suffixe="/revisions/1")]
    reponses.append(
        banc.appel(LECTEUR_GROUPE, "GET", CHEMIN_TABLEAUX).json(),
    )
    creation = banc.creer_tableau(
        CREATEUR_GROUPE, visual(ident=C1, analysis_id=analyse_secrete), visibility="shared"
    )
    reponses.append(creation.json())
    banc.redefinir(["orders"], ["region"])
    reponses.append(lire(banc, ident))
    sans_catalogue(banc)
    reponses.append(lire(banc, ident))
    for reponse in reponses:
        mots = set(cles_et_textes(reponse))
        assert not mots & {"query", "sql", "contextual", "metrics", "dimensions", "connection"}
        assert not {item for item in mots if SECRET in item or "revenue" in item or "sales" in item}
        assert not {item for item in mots if "SELECT" in item.upper()}


# -- liste et droits ---------------------------------------------------------------------------


def test_la_liste_est_triee_et_ne_montre_que_le_visible(banc: Banc) -> None:
    banc.creer_tableau_ok(CREATEUR_GROUPE, text(), visibility="shared", name="banane")
    banc.creer_tableau_ok(CREATEUR_GROUPE, text(), visibility="personal", name="Abricot")
    banc.creer_tableau_ok(CREATEUR_PERSONNE, text(), visibility="shared", name="cerise")
    banc.creer_tableau_ok(CREATEUR_PERSONNE, text(), visibility="personal", name="date secrète")
    vue = banc.appel(CREATEUR_GROUPE, "GET", CHEMIN_TABLEAUX).json()
    assert [item["name"] for item in vue["dashboards"]] == ["Abricot", "banane", "cerise"]
    assert vue["unreadable"] == 0
    assert set(vue["dashboards"][0]) == {
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
    assert [item["is_owner"] for item in vue["dashboards"]] == [True, True, False]
    assert {item["state"] for item in vue["dashboards"]} == {"indexed"}
    autre = banc.appel(LECTEUR_GROUPE, "GET", CHEMIN_TABLEAUX).json()
    assert [item["name"] for item in autre["dashboards"]] == ["banane", "cerise"]


def test_la_liste_d_un_depot_vide_est_vide(banc: Banc) -> None:
    reponse = banc.appel(CREATEUR_GROUPE, "GET", CHEMIN_TABLEAUX)
    assert reponse.status_code == 200
    assert reponse.json() == {"dashboards": [], "unreadable": 0}


def test_la_liste_juge_une_ligne_perimee_sur_git(banc: Banc) -> None:
    ident = banc.creer_tableau_ok(CREATEUR_GROUPE, text(), visibility="shared", name="Avant")
    ecrire_hors_index(banc, ident, name="Après")
    ligne = banc.appel(LECTEUR_GROUPE, "GET", CHEMIN_TABLEAUX).json()["dashboards"][0]
    assert (ligne["name"], ligne["revision"], ligne["state"]) == ("Après", 2, "index_stale")
    # Rendu personnel dans git sans que l'index le sache : le lecteur ne le voit plus.
    ecrire_hors_index(banc, ident, name="Après", visibility="personal")
    assert banc.appel(LECTEUR_GROUPE, "GET", CHEMIN_TABLEAUX).json()["dashboards"] == []
    proprietaire = banc.appel(CREATEUR_GROUPE, "GET", CHEMIN_TABLEAUX).json()["dashboards"]
    assert [item["state"] for item in proprietaire] == ["index_stale"]


def test_la_liste_ignore_ce_qui_a_disparu_de_git(banc: Banc) -> None:
    ident = banc.creer_tableau_ok(CREATEUR_GROUPE, text(), visibility="shared")
    banc.depot.delete(A, ident, expected_revision=1, actor=CREATEUR_GROUPE.ref, kind=DASHBOARD_KIND)
    assert banc.appel(CREATEUR_GROUPE, "GET", CHEMIN_TABLEAUX).json() == {
        "dashboards": [],
        "unreadable": 0,
    }


def test_un_dashboard_illisible_n_est_compte_que_pour_son_proprietaire(banc: Banc) -> None:
    partagee = banc.creer_tableau_ok(CREATEUR_GROUPE, text(), visibility="shared", name="Partagé")
    personnelle = banc.creer_tableau_ok(CREATEUR_GROUPE, text(), name="Perso")
    banc.creer_tableau_ok(CREATEUR_GROUPE, text(), visibility="shared", name="Intact")
    for ident in (partagee, personnelle):
        commit(banc.racine, {chemin_dashboard(ident): b"api_version: x\n"}, "intrus")
    vue = banc.appel(CREATEUR_GROUPE, "GET", CHEMIN_TABLEAUX).json()
    assert [item["name"] for item in vue["dashboards"]] == ["Intact"]
    assert vue["unreadable"] == 2
    assert banc.appel(LECTEUR_GROUPE, "GET", CHEMIN_TABLEAUX).json()["unreadable"] == 0
    lecture = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{partagee}")
    assert lecture.status_code == 503
    assert lecture.json() == {"error": {"code": "content_unavailable"}}


@pytest.mark.parametrize(
    ("profil", "droits"),
    [
        (CREATEUR_GROUPE, (True, True, True, True)),
        (ADMIN_GROUPE, (False, True, True, True)),
        (CREATEUR_PERSONNE, (False, False, False, True)),
        (LECTEUR_GROUPE, (False, False, False, False)),
    ],
    ids=lambda valeur: valeur.nom if isinstance(valeur, Profil) else "",
)
def test_les_droits_d_un_dashboard_partage_dependent_du_role_et_de_la_propriete(
    banc: Banc, profil: Profil, droits: tuple[bool, bool, bool, bool]
) -> None:
    ident = partage(banc, text())
    permissions = lire(banc, ident, profil)["permissions"]
    assert tuple(permissions[cle] for cle in ("owner", "revise", "delete", "duplicate")) == droits
    assert set(permissions) == {"owner", "revise", "delete", "duplicate"}


def test_un_dashboard_personnel_n_est_lisible_que_de_son_proprietaire(banc: Banc) -> None:
    ident = banc.creer_tableau_ok(CREATEUR_GROUPE, text(), visibility="personal")
    assert lire(banc, ident, CREATEUR_GROUPE)["permissions"]["owner"] is True
    inconnu = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{new_id()}")
    for profil in (ADMIN_GROUPE, LECTEUR_GROUPE, CREATEUR_PERSONNE):
        reponse = banc.appel(profil, "GET", f"{CHEMIN_TABLEAUX}/{ident}")
        assert reponse.status_code == 404
        assert reponse.json() == inconnu.json() == {"error": {"code": "dashboard_not_found"}}


# -- consommateurs d'une analyse ---------------------------------------------------------------


def consommateurs(banc: Banc, ident: str, profil: Profil) -> dict[str, Any]:
    reponse = banc.appel(profil, "GET", f"{CHEMIN}/{ident}/consumers")
    assert reponse.status_code == 200, reponse.text
    result: dict[str, Any] = reponse.json()
    return result


def nommes(vue: dict[str, Any]) -> set[str]:
    assert {item["kind"] for item in vue["consumers"]} <= {"dashboard"}
    return {item["id"] for item in vue["consumers"]}


def test_les_consommateurs_d_une_analyse_sont_nommes_selon_ce_que_la_personne_voit(
    banc: Banc,
) -> None:
    ident = analyse(banc)
    partage = partage_de(banc, ident)
    personnel = banc.creer_tableau_ok(
        CREATEUR_PERSONNE, visual(ident=C1, analysis_id=ident), name=SECRET
    )
    sans = consommateurs(banc, analyse(banc), LECTEUR_GROUPE)
    assert sans == {"id": sans["id"], "consumers": [], "others": 0}
    pour_lea = consommateurs(banc, ident, LECTEUR_GROUPE)
    assert (nommes(pour_lea), pour_lea["others"]) == ({partage}, 1)
    pour_cyril = consommateurs(banc, ident, CREATEUR_PERSONNE)
    assert (nommes(pour_cyril), pour_cyril["others"]) == ({partage, personnel}, 0)
    assert set(pour_lea) == {"id", "consumers", "others"} and pour_lea["id"] == ident
    assert SECRET not in str(pour_lea)


def partage_de(banc: Banc, ident: str) -> str:
    return partage(banc, visual(ident=C1, analysis_id=ident))


def test_une_ligne_d_index_perimee_est_jugee_sur_git_pour_les_consommateurs(banc: Banc) -> None:
    """Rendu personnel, supprimé ou abîmé dans git sans que l'index le sache : git fait foi."""
    ident = analyse(banc)
    rendu_personnel, supprime, abime, intact = (partage_de(banc, ident) for _ in range(4))
    perso_d_autrui = banc.creer_tableau_ok(CREATEUR_PERSONNE, visual(ident=C1, analysis_id=ident))
    ecrire_hors_index(banc, rendu_personnel, visibility="personal")
    banc.depot.delete(
        A, supprime, expected_revision=1, actor=CREATEUR_GROUPE.ref, kind=DASHBOARD_KIND
    )
    commit(banc.racine, {chemin_dashboard(abime): b"api_version: x\n"}, "intrus")
    pour_lea = consommateurs(banc, ident, LECTEUR_GROUPE)
    assert (nommes(pour_lea), pour_lea["others"]) == ({intact}, 3)
    pour_cora = consommateurs(banc, ident, CREATEUR_GROUPE)
    # Le supprimé n'est plus un consommateur ; l'abîmé, dont on ne sait pas ce qu'il épingle, est
    # compté parmi les autres pour tout le monde, son propriétaire compris.
    assert (nommes(pour_cora), pour_cora["others"]) == ({rendu_personnel, intact}, 2)
    pour_cyril = consommateurs(banc, ident, CREATEUR_PERSONNE)
    assert (nommes(pour_cyril), pour_cyril["others"]) == ({intact, perso_d_autrui}, 2)


def test_les_consommateurs_d_une_analyse_invisible_ou_inexistante_se_ressemblent(
    banc: Banc,
) -> None:
    personnelle = analyse(banc, visibility="personal")
    attendu = {"error": {"code": "analysis_not_found"}}
    for ident in (personnelle, new_id(), "pas-un-identifiant"):
        reponse = banc.appel(LECTEUR_GROUPE, "GET", f"{CHEMIN}/{ident}/consumers")
        assert reponse.status_code == 404 and reponse.json() == attendu, ident


def test_un_identifiant_qui_n_en_est_pas_un_n_existe_pas(banc: Banc) -> None:
    """Même réponse pour un dashboard inexistant et pour un identifiant mal formé."""
    inconnu = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{new_id()}")
    for ident in ("abc", "not-a-uuid", "a" * 200):
        reponse = banc.appel(CREATEUR_GROUPE, "GET", f"{CHEMIN_TABLEAUX}/{ident}")
        assert reponse.status_code == 404 and reponse.json() == inconnu.json()
