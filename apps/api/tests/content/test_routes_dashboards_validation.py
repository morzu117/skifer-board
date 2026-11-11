"""Validation à la sauvegarde des dashboards, sur un vrai serveur (plan 19.2, B4 et B7).

Chaque violation d'`invalid_dashboard` arrive avec son chemin et sa règle exacts, par la création
comme par la révision ; la duplication les rencontre quand le catalogue ou les analyses ont changé
depuis la sauvegarde de la source. Un dashboard partagé qui épingle une révision d'analyse non
partagée est refusé à part (`personal_reference`). Les refus ne citent ni nom ni valeur de filtre.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from httpx2 import Response
from skifer_board.content.errors import CONTENT_UNAVAILABLE, ContentError
from skifer_board.content.repository import DASHBOARD_KIND, ContentRepository
from spaces.monde import ADMIN_GROUPE, CREATEUR_GROUPE, CREATEUR_PERSONNE, LECTEUR_GROUPE, A

from .aides_dashboards import (
    SECRET,
    STOCK,
    ajouter_stock,
    chemin,
    chemin_dashboard,
    refus_invalide,
    sans_catalogue,
    typer,
)
from .monde import commit, new_id
from .monde_dashboard import (
    column,
    common_filter,
    container,
    kpi,
    row,
    section,
    text,
    visual,
    with_sections,
)
from .serveur import CHEMIN_TABLEAUX, Banc, corps, corps_tableau

COMPOSANT = "aaaaaaaa-0000-4000-8000-000000000001"
AUTRE = "aaaaaaaa-0000-4000-8000-000000000002"
TROISIEME = "aaaaaaaa-0000-4000-8000-000000000003"


@pytest.fixture(params=["creation", "revision"])
def voie(request: pytest.FixtureRequest) -> str:
    """Les deux chemins qui sauvegardent un document : la création et la révision."""
    return str(request.param)


def envoyer(
    banc: Banc,
    voie: str,
    *composants: dict[str, Any],
    profil: Any = CREATEUR_GROUPE,
    **changes: Any,
) -> Response:
    """Sauvegarde ces composants par la création ou par la révision d'un dashboard de texte."""
    if voie == "creation":
        return banc.creer_tableau(profil, *composants, **changes)
    base = banc.creer_tableau_ok(profil, text(), visibility=changes.get("visibility", "personal"))
    return banc.reviser_tableau(profil, base, 1, *composants, **changes)


def requete(**changes: Any) -> dict[str, Any]:
    return {**corps()["query"], **changes}


def analyse(banc: Banc, profil: Any = CREATEUR_GROUPE, **changes: Any) -> str:
    """Une analyse partagée par défaut (la forme de `corps()` : une dimension, `bars`)."""
    changes.setdefault("visibility", "shared")
    return banc.creer_ok(profil, **changes)


def analyse_valeur(banc: Banc, **changes: Any) -> str:
    """Une analyse sans dimension dont le graphique est `value` : ce qu'un KPI épingle."""
    return analyse(
        banc,
        query=requete(dimensions=[], filters=[]),
        contextual=[],
        presentation={"chart": "value"},
        **changes,
    )


def rien_d_ecrit(banc: Banc) -> None:
    assert banc.depot.dashboards() == ()
    assert banc.tableaux.rows(A) == []


# -- analysis_unavailable ----------------------------------------------------------------------


def test_une_analyse_indisponible_se_confond_avec_une_analyse_absente(
    banc: Banc, voie: str
) -> None:
    """Inexistante, révision inexistante, personnelle d'un autre, supprimée : une réponse unique,
    à une seule violation, sans rien qui dise laquelle des quatre."""
    propre = analyse(banc)
    perso_d_un_autre = analyse(banc, CREATEUR_PERSONNE, visibility="personal", name=SECRET)
    supprimee = analyse(banc, name=SECRET)
    banc.depot.delete(A, supprimee, expected_revision=1, actor=CREATEUR_GROUPE.ref)
    cas = {
        "inexistante": (new_id(), 1),
        "revision inexistante": (propre, 9),
        "personnelle d'un autre": (perso_d_un_autre, 1),
        "supprimee": (supprimee, 1),
    }
    reponses = {
        nom: envoyer(banc, voie, visual(ident=COMPOSANT, analysis_id=ident, revision=revision))
        for nom, (ident, revision) in cas.items()
    }
    attendu = {
        "error": {
            "code": "invalid_dashboard",
            "reason": "analysis_unavailable",
            "violations": [{"path": f"{chemin()}/reference", "rule": "analysis_unavailable"}],
        }
    }
    for nom, reponse in reponses.items():
        assert reponse.status_code == 422, nom
        assert reponse.json() == attendu, nom
        assert SECRET not in reponse.text and perso_d_un_autre not in reponse.text, nom
    if voie == "creation":
        rien_d_ecrit(banc)


def test_chaque_composant_indisponible_a_sa_violation_et_les_autres_controles_sont_ignores(
    banc: Banc,
) -> None:
    """Un composant dont l'analyse est illisible n'est contrôlé que par cette règle : ni son type de
    graphique ni ses filtres communs ne sont jugés sur ce qu'on ne peut pas lire."""
    bonne = analyse(banc)
    reponse = banc.creer_tableau(
        CREATEUR_GROUPE,
        kpi(ident=COMPOSANT, analysis_id=new_id()),
        visual(ident=AUTRE, analysis_id=bonne, revision=1, chart="value"),
        visual(ident=TROISIEME, analysis_id=new_id(), chart="value"),
        filters=[common_filter([COMPOSANT, TROISIEME], dimension="fantome")],
    )
    refus_invalide(
        reponse,
        (f"{chemin(0)}/reference", "analysis_unavailable"),
        (f"{chemin(1)}/presentation/chart", "chart_incompatible"),
        (f"{chemin(2)}/reference", "analysis_unavailable"),
    )


def test_une_analyse_abimee_est_indisponible_pour_son_auteur(banc: Banc) -> None:
    ident = analyse(banc)
    commit(banc.racine, {f"analyses/{A}/{ident}.yaml": b"api_version: x\n"}, "intrus")
    reponse = banc.creer_tableau(CREATEUR_GROUPE, visual(ident=COMPOSANT, analysis_id=ident))
    refus_invalide(reponse, (f"{chemin()}/reference", "analysis_unavailable"))


def test_une_panne_du_depot_n_est_pas_une_analyse_indisponible(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    ident = analyse(banc)

    def panne(*_: Any, **__: Any) -> None:
        raise ContentError(CONTENT_UNAVAILABLE, "git_failed")

    monkeypatch.setattr(ContentRepository, "read", panne)
    reponse = banc.creer_tableau(CREATEUR_GROUPE, visual(ident=COMPOSANT, analysis_id=ident))
    assert reponse.status_code == 503
    assert reponse.json() == {"error": {"code": "content_unavailable"}}
    monkeypatch.undo()
    rien_d_ecrit(banc)


def test_la_lecture_d_une_analyse_est_faite_une_fois_par_revision(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Deux composants sur la même révision d'analyse : une seule lecture pour toute la requête (la
    validation et l'état de la réponse partagent les mêmes analyses épinglées, lues sur la même
    tête), jamais une par composant ni une par passe."""
    ident = analyse(banc)
    lues: list[int] = []
    lire = ContentRepository.read

    def compter(self: ContentRepository, *args: Any, **options: Any) -> Any:
        if options.get("kind") is None:
            lues.append(1)
        return lire(self, *args, **options)

    monkeypatch.setattr(ContentRepository, "read", compter)
    reponse = banc.creer_tableau(
        CREATEUR_GROUPE,
        visual(ident=COMPOSANT, analysis_id=ident),
        visual(ident=AUTRE, analysis_id=ident),
    )
    assert reponse.status_code == 201, reponse.text
    assert len(lues) == 1


# -- kpi_requires_value et chart_incompatible ---------------------------------------------------


def test_un_kpi_exige_une_analyse_dont_le_graphique_est_value(banc: Banc, voie: str) -> None:
    barres = analyse(banc)
    refus = envoyer(banc, voie, kpi(ident=COMPOSANT, analysis_id=barres))
    refus_invalide(refus, (f"{chemin()}/reference", "kpi_requires_value"))
    valeur = analyse_valeur(banc)
    accepte = envoyer(banc, voie, kpi(ident=COMPOSANT, analysis_id=valeur))
    assert accepte.status_code == 201, accepte.text
    assert accepte.json()["components"] == [{"id": COMPOSANT, "state": "ready"}]


def test_un_kpi_est_juge_sur_la_revision_epinglee(banc: Banc) -> None:
    """La révision 1 est un graphique en barres ; la 2 est `value` : seule la 2 convient."""
    ident = analyse(banc)
    revisee = banc.reviser(
        CREATEUR_GROUPE,
        ident,
        1,
        visibility="shared",
        query=requete(dimensions=[], filters=[]),
        contextual=[],
        presentation={"chart": "value"},
    )
    assert revisee.status_code == 201, revisee.text
    ancienne = banc.creer_tableau(CREATEUR_GROUPE, kpi(ident=COMPOSANT, analysis_id=ident))
    refus_invalide(ancienne, (f"{chemin()}/reference", "kpi_requires_value"))
    courante = banc.creer_tableau(
        CREATEUR_GROUPE, kpi(ident=COMPOSANT, analysis_id=ident, revision=2)
    )
    assert courante.status_code == 201, courante.text


@pytest.mark.parametrize(
    ("graphique", "dimensions", "accepte"),
    [
        ("value", 0, True),
        ("value", 1, False),
        ("bars", 0, True),
        ("bars", 1, True),
        ("line", 0, True),
        ("line", 1, True),
        ("grouped_bars", 0, True),
        ("grouped_bars", 1, True),
        (None, 1, True),
    ],
)
def test_le_graphique_surcharge_doit_convenir_a_la_forme_de_l_analyse(
    banc: Banc, graphique: str | None, dimensions: int, accepte: bool
) -> None:
    ident = (
        analyse(banc)
        if dimensions
        else analyse(banc, query=requete(dimensions=[], filters=[]), contextual=[])
    )
    presentation = {} if graphique is None else {"chart": graphique}
    reponse = banc.creer_tableau(
        CREATEUR_GROUPE, visual(ident=COMPOSANT, analysis_id=ident, **presentation)
    )
    if accepte:
        assert reponse.status_code == 201, reponse.text
    else:
        refus_invalide(reponse, (f"{chemin()}/presentation/chart", "chart_incompatible"))
        rien_d_ecrit(banc)


def test_un_graphique_incompatible_est_refuse_aussi_par_la_revision(banc: Banc) -> None:
    ident = analyse(banc)
    reponse = envoyer(banc, "revision", visual(ident=COMPOSANT, analysis_id=ident, chart="value"))
    refus_invalide(reponse, (f"{chemin()}/presentation/chart", "chart_incompatible"))


def test_le_chemin_d_un_composant_suit_sa_place_dans_la_mise_en_page(banc: Banc) -> None:
    ident = analyse(banc)
    imbrique = container(
        row(column(visual(ident=AUTRE, analysis_id=ident, chart="value"), span=6)),
        ident=new_id(),
    )
    document = with_sections(
        section(row(column(text(), span=6), column(imbrique, span=6))),
    )
    for nom in ("api_version", "id", "owner"):
        del document[nom]
    reponse = banc.appel(CREATEUR_GROUPE, "POST", CHEMIN_TABLEAUX, json=document)
    base = "/layout/sections/0/rows/0/columns/1/children/0/rows/0/columns/0/children/0"
    refus_invalide(reponse, (f"{base}/presentation/chart", "chart_incompatible"))


# -- filtres communs ---------------------------------------------------------------------------


def test_une_dimension_non_exposee_par_le_modele_est_refusee(banc: Banc, voie: str) -> None:
    ident = analyse(banc)
    cible = visual(ident=COMPOSANT, analysis_id=ident)
    refus = envoyer(banc, voie, cible, filters=[common_filter([COMPOSANT], dimension="fantome")])
    refus_invalide(refus, ("/filters/0/targets/0", "dimension_not_exposed"))
    # Exposée par le modèle de l'analyse sans y figurer : acceptée.
    accepte = envoyer(banc, voie, cible, filters=[common_filter([COMPOSANT], dimension="channel")])
    assert accepte.status_code == 201, accepte.text


def test_la_dimension_doit_etre_exposee_pour_chaque_cible(banc: Banc, voie: str) -> None:
    ajouter_stock(banc)
    ident = analyse(banc)
    stock = analyse(banc, query=requete(model=STOCK, dimensions=["region"]), contextual=[])
    cibles = (
        visual(ident=COMPOSANT, analysis_id=ident),
        visual(ident=AUTRE, analysis_id=stock),
    )
    # `channel` n'existe que dans `sales`.
    refus = envoyer(
        banc, voie, *cibles, filters=[common_filter([COMPOSANT, AUTRE], dimension="channel")]
    )
    refus_invalide(refus, ("/filters/0/targets/1", "dimension_not_exposed"))


@pytest.mark.parametrize(
    ("dimension", "operateur"),
    [("day", "eq"), ("region", "between"), ("active", "in"), ("region", "between")],
)
def test_un_operateur_non_permis_pour_le_type_est_refuse(
    banc: Banc, voie: str, dimension: str, operateur: str
) -> None:
    ident = analyse(banc)
    reponse = envoyer(
        banc,
        voie,
        visual(ident=COMPOSANT, analysis_id=ident),
        filters=[common_filter([COMPOSANT], dimension=dimension, operator=operateur)],
    )
    refus_invalide(reponse, ("/filters/0/targets/0", "operator_not_allowed"))


@pytest.mark.parametrize(
    "extra",
    [
        {"default": SECRET},
        {"default": SECRET, "allowed": [SECRET]},
        {"allowed": [SECRET, "autre"]},
    ],
    ids=["defaut", "defaut et autorisees", "autorisees"],
)
def test_une_valeur_de_filtre_du_mauvais_type_est_refusee_sans_etre_citee(
    banc: Banc, voie: str, extra: dict[str, Any]
) -> None:
    """`year` est un nombre : un texte ne convient ni par défaut ni parmi les valeurs autorisées."""
    ident = analyse(banc)
    reponse = envoyer(
        banc,
        voie,
        visual(ident=COMPOSANT, analysis_id=ident),
        filters=[common_filter([COMPOSANT], dimension="year", operator="eq", **extra)],
        name=SECRET,
    )
    refus_invalide(reponse, ("/filters/0/targets/0", "filter_value_incompatible"))


@pytest.mark.parametrize(
    ("dimension", "operateur", "extra"),
    [
        ("active", "eq", {"default": "oui"}),
        ("region", "eq", {"default": 12}),
        ("year", "eq", {"allowed": [2024, 2025], "default": 2024}),
        ("year", "in", {"default": [2024, 2025]}),
    ],
    ids=["booleen", "texte", "nombre autorise", "nombres"],
)
def test_les_valeurs_de_filtre_du_bon_type_sont_acceptees_ou_refusees_selon_la_dimension(
    banc: Banc, dimension: str, operateur: str, extra: dict[str, Any]
) -> None:
    ident = analyse(banc)
    reponse = banc.creer_tableau(
        CREATEUR_GROUPE,
        visual(ident=COMPOSANT, analysis_id=ident),
        filters=[common_filter([COMPOSANT], dimension=dimension, operator=operateur, **extra)],
    )
    if dimension in {"active", "region"}:
        refus_invalide(reponse, ("/filters/0/targets/0", "filter_value_incompatible"))
    else:
        assert reponse.status_code == 201, reponse.text


def test_une_valeur_autorisee_se_juge_comme_une_egalite(banc: Banc) -> None:
    """Un filtre `in` sur un texte, de valeurs autorisées textuelles : accepté ; chaque valeur
    autorisée est jugée comme une égalité, `in` n'a pas à être permis pour le type."""
    ident = analyse(banc)
    reponse = banc.creer_tableau(
        CREATEUR_GROUPE,
        visual(ident=COMPOSANT, analysis_id=ident),
        filters=[
            common_filter(
                [COMPOSANT],
                dimension="active",
                operator="eq",
                allowed=[True, False],
                default=True,
            )
        ],
    )
    assert reponse.status_code == 201, reponse.text


def test_une_dimension_de_types_differents_selon_les_cibles_est_refusee(
    banc: Banc, voie: str
) -> None:
    """`year` est un nombre dans `sales` et un texte dans `stock` : la première cible fait foi."""
    ajouter_stock(banc)
    ventes = analyse(banc)
    stock = analyse(banc, query=requete(model=STOCK), contextual=[])
    cibles = (
        visual(ident=COMPOSANT, analysis_id=ventes),
        visual(ident=AUTRE, analysis_id=stock),
    )
    refus = envoyer(
        banc, voie, *cibles, filters=[common_filter([COMPOSANT, AUTRE], dimension="year")]
    )
    refus_invalide(refus, ("/filters/0/targets/1", "filter_type_mismatch"))
    inverse = envoyer(
        banc, voie, *cibles, filters=[common_filter([AUTRE, COMPOSANT], dimension="year")]
    )
    refus_invalide(inverse, ("/filters/0/targets/1", "filter_type_mismatch"))
    # Même type partout : accepté.
    meme = envoyer(
        banc, voie, *cibles, filters=[common_filter([COMPOSANT, AUTRE], dimension="region")]
    )
    assert meme.status_code == 201, meme.text


def test_une_premiere_cible_en_defaut_ne_pose_pas_de_type_de_reference(banc: Banc) -> None:
    """`channel` n'existe que dans `sales` : la cible `stock` est en défaut, et ce défaut est la
    seule violation (la cible `sales` n'est pas comparée à un type qu'on n'a pas)."""
    ajouter_stock(banc)
    stock = analyse(banc, query=requete(model=STOCK), contextual=[])
    ventes = analyse(banc)
    reponse = banc.creer_tableau(
        CREATEUR_GROUPE,
        visual(ident=COMPOSANT, analysis_id=stock),
        visual(ident=AUTRE, analysis_id=ventes),
        filters=[common_filter([COMPOSANT, AUTRE], dimension="channel")],
    )
    refus_invalide(reponse, ("/filters/0/targets/0", "dimension_not_exposed"))


# -- too_many_filters --------------------------------------------------------------------------


def filtres_d_analyse(nombre: int) -> list[dict[str, Any]]:
    return [{"column": "region", "operator": "eq", "value": f"v{rang}"} for rang in range(nombre)]


@pytest.mark.parametrize(
    ("de_l_analyse", "communs", "accepte"),
    [(31, 1, True), (32, 1, False), (30, 2, True), (31, 2, False), (32, 0, True)],
)
def test_une_tuile_porte_au_plus_32_filtres(
    banc: Banc, voie: str, de_l_analyse: int, communs: int, accepte: bool
) -> None:
    """Les filtres de l'analyse plus les filtres communs qui la ciblent : 32 passent, 33 non."""
    ident = analyse(banc, query=requete(filters=filtres_d_analyse(de_l_analyse)))
    reponse = envoyer(
        banc,
        voie,
        visual(ident=COMPOSANT, analysis_id=ident),
        filters=[common_filter([COMPOSANT]) for _ in range(communs)],
    )
    if accepte:
        assert reponse.status_code == 201, reponse.text
    else:
        refus_invalide(reponse, (chemin(), "too_many_filters"))


def test_les_filtres_d_une_autre_tuile_ne_comptent_pas(banc: Banc) -> None:
    ident = analyse(banc, query=requete(filters=filtres_d_analyse(32)))
    autre = analyse(banc)
    reponse = banc.creer_tableau(
        CREATEUR_GROUPE,
        visual(ident=COMPOSANT, analysis_id=ident),
        visual(ident=AUTRE, analysis_id=autre),
        filters=[common_filter([AUTRE]), common_filter([AUTRE])],
    )
    assert reponse.status_code == 201, reponse.text


# -- personal_reference ------------------------------------------------------------------------


def test_un_dashboard_partage_ne_peut_pas_epingler_une_analyse_personnelle(
    banc: Banc, voie: str
) -> None:
    personnelle = analyse(banc, visibility="personal", name=SECRET)
    partagee = analyse(banc)
    autre = analyse(banc, visibility="personal")
    # Les composants sont dans l'ordre du document, qui n'est pas celui des identifiants.
    reponse = envoyer(
        banc,
        voie,
        visual(ident=TROISIEME, analysis_id=personnelle),
        visual(ident=AUTRE, analysis_id=partagee),
        visual(ident=COMPOSANT, analysis_id=autre),
        visibility="shared",
        name=SECRET,
    )
    assert reponse.status_code == 422, reponse.text
    assert reponse.json() == {
        "error": {"code": "personal_reference", "components": [TROISIEME, COMPOSANT]}
    }
    assert SECRET not in reponse.text
    if voie == "creation":
        rien_d_ecrit(banc)


def test_un_dashboard_personnel_peut_epingler_une_analyse_personnelle(banc: Banc) -> None:
    personnelle = analyse(banc, visibility="personal")
    reponse = banc.creer_tableau(
        CREATEUR_GROUPE, visual(ident=COMPOSANT, analysis_id=personnelle), visibility="personal"
    )
    assert reponse.status_code == 201, reponse.text
    assert reponse.json()["state"] == "ready"


def test_rendre_partage_un_dashboard_personnel_est_refuse_s_il_epingle_du_personnel(
    banc: Banc,
) -> None:
    personnelle = analyse(banc, visibility="personal")
    ident = banc.creer_tableau_ok(
        CREATEUR_GROUPE, visual(ident=COMPOSANT, analysis_id=personnelle), visibility="personal"
    )
    reponse = banc.reviser_tableau(
        CREATEUR_GROUPE,
        ident,
        1,
        visual(ident=COMPOSANT, analysis_id=personnelle),
        visibility="shared",
    )
    assert reponse.status_code == 422
    assert reponse.json() == {"error": {"code": "personal_reference", "components": [COMPOSANT]}}
    assert banc.depot.read(A, ident, kind=DASHBOARD_KIND).revision.number == 1


def test_la_revision_epinglee_fait_foi_pas_la_visibilite_courante_de_l_analyse(
    banc: Banc,
) -> None:
    """Personnelle en révision 1, partagée en révision 2 : seule la 2 se partage."""
    ident = analyse(banc, visibility="personal")
    assert banc.reviser(CREATEUR_GROUPE, ident, 1, visibility="shared").status_code == 201
    ancienne = banc.creer_tableau(
        CREATEUR_GROUPE,
        visual(ident=COMPOSANT, analysis_id=ident, revision=1),
        visibility="shared",
    )
    assert ancienne.status_code == 422
    assert ancienne.json()["error"] == {"code": "personal_reference", "components": [COMPOSANT]}
    courante = banc.creer_tableau(
        CREATEUR_GROUPE,
        visual(ident=COMPOSANT, analysis_id=ident, revision=2),
        visibility="shared",
    )
    assert courante.status_code == 201, courante.text


def test_les_violations_passent_avant_personal_reference(banc: Banc) -> None:
    """`personal_reference` suppose des analyses lisibles : une violation l'emporte."""
    personnelle = analyse(banc, visibility="personal")
    reponse = banc.creer_tableau(
        CREATEUR_GROUPE,
        visual(ident=COMPOSANT, analysis_id=personnelle),
        visual(ident=AUTRE, analysis_id=new_id()),
        visibility="shared",
    )
    refus_invalide(reponse, (f"{chemin(1)}/reference", "analysis_unavailable"))


def test_un_administrateur_ne_depasse_pas_la_regle_du_partage(banc: Banc) -> None:
    """Un dashboard partagé de cora, révisé par l'administrateur avec une analyse personnelle de
    l'administrateur : refus du partage, pas d'exception pour son rôle."""
    partagee = analyse(banc)
    ident = banc.creer_tableau_ok(
        CREATEUR_GROUPE, visual(ident=COMPOSANT, analysis_id=partagee), visibility="shared"
    )
    personnelle_admin = analyse(banc, ADMIN_GROUPE, visibility="personal")
    reponse = banc.reviser_tableau(
        ADMIN_GROUPE,
        ident,
        1,
        visual(ident=COMPOSANT, analysis_id=personnelle_admin),
        visibility="shared",
    )
    assert reponse.status_code == 422
    assert reponse.json() == {"error": {"code": "personal_reference", "components": [COMPOSANT]}}


# -- plusieurs violations ----------------------------------------------------------------------


def test_les_violations_sont_triees_par_chemin_puis_par_regle(banc: Banc) -> None:
    ident = analyse(banc)
    reponse = banc.creer_tableau(
        CREATEUR_GROUPE,
        kpi(ident=COMPOSANT, analysis_id=ident),
        visual(ident=AUTRE, analysis_id=ident, chart="value"),
        filters=[
            common_filter([COMPOSANT], dimension="fantome"),
            common_filter([AUTRE], dimension="day"),
        ],
        name=SECRET,
    )
    refus_invalide(
        reponse,
        (f"{chemin(0)}/reference", "kpi_requires_value"),
        (f"{chemin(1)}/presentation/chart", "chart_incompatible"),
        ("/filters/0/targets/0", "dimension_not_exposed"),
        ("/filters/1/targets/0", "operator_not_allowed"),
    )


def test_un_corps_invalide_au_format_est_refuse_avant_tout_controle_des_analyses(
    banc: Banc,
) -> None:
    """Un champ inconnu et une analyse absente : seule la violation du format est rendue."""
    envoi = {**corps_tableau(visual(analysis_id=new_id())), "sql": "SELECT 1"}
    reponse = banc.appel(CREATEUR_GROUPE, "POST", CHEMIN_TABLEAUX, json=envoi)
    refus_invalide(reponse, ("/sql", "unknown_field"))
    rien_d_ecrit(banc)


# -- moteur indisponible -----------------------------------------------------------------------


def test_sans_catalogue_rien_n_est_sauvegarde(banc: Banc) -> None:
    ident = analyse(banc)
    existant = banc.creer_tableau_ok(CREATEUR_GROUPE, text(), visibility="personal")
    sans_catalogue(banc)
    attendu = {"error": {"code": "engine_unavailable"}}
    creation = banc.creer_tableau(CREATEUR_GROUPE, visual(ident=COMPOSANT, analysis_id=ident))
    revision = banc.reviser_tableau(
        CREATEUR_GROUPE, existant, 1, visual(ident=COMPOSANT, analysis_id=ident)
    )
    duplication = banc.appel(CREATEUR_GROUPE, "POST", f"{CHEMIN_TABLEAUX}/{existant}/duplicate")
    for reponse in (creation, revision, duplication):
        assert reponse.status_code == 503 and reponse.json() == attendu
    assert len(banc.depot.dashboards()) == 1
    assert banc.depot.history(A, existant, kind=DASHBOARD_KIND)[-1].number == 1


# -- duplication -------------------------------------------------------------------------------


def dupliquer(banc: Banc, identifiant: str, profil: Any = CREATEUR_GROUPE) -> Response:
    return banc.appel(profil, "POST", f"{CHEMIN_TABLEAUX}/{identifiant}/duplicate")


def test_dupliquer_un_dashboard_dont_une_analyse_n_est_plus_lisible_est_refuse(
    banc: Banc,
) -> None:
    """Partagée en révision 1, rendue personnelle en révision 2 : pour cyril, la révision épinglée
    n'existe plus ; pour cora, qui reste propriétaire, la copie est possible."""
    ident = analyse(banc)
    source = banc.creer_tableau_ok(
        CREATEUR_GROUPE, visual(ident=COMPOSANT, analysis_id=ident), visibility="shared"
    )
    assert dupliquer(banc, source, CREATEUR_PERSONNE).status_code == 201
    assert banc.reviser(CREATEUR_GROUPE, ident, 1, visibility="personal").status_code == 201
    refus = dupliquer(banc, source, CREATEUR_PERSONNE)
    refus_invalide(refus, (f"{chemin()}/reference", "analysis_unavailable"))
    assert dupliquer(banc, source).status_code == 201


def test_dupliquer_rend_toujours_une_copie_personnelle_qui_peut_epingler_du_personnel(
    banc: Banc,
) -> None:
    personnelle = analyse(banc, visibility="personal")
    source = banc.creer_tableau_ok(
        CREATEUR_GROUPE, visual(ident=COMPOSANT, analysis_id=personnelle), visibility="personal"
    )
    copie = dupliquer(banc, source)
    assert copie.status_code == 201, copie.text
    assert copie.json()["dashboard"]["visibility"] == "personal"
    partagee = analyse(banc)
    partage = banc.creer_tableau_ok(
        CREATEUR_GROUPE, visual(ident=AUTRE, analysis_id=partagee), visibility="shared"
    )
    deuxieme = dupliquer(banc, partage, LECTEUR_GROUPE)
    assert deuxieme.status_code == 403


def avec_filtre(banc: Banc, **filtre: Any) -> tuple[str, str]:
    """Un dashboard personnel d'un visuel et d'un filtre commun sur `year` (nombre) ; rend son
    identifiant et celui de l'analyse."""
    ident = analyse(banc)
    source = banc.creer_tableau_ok(
        CREATEUR_GROUPE,
        visual(ident=COMPOSANT, analysis_id=ident),
        filters=[common_filter([COMPOSANT], **{"dimension": "year", **filtre})],
    )
    return source, ident


Changement = Callable[[Banc], None]


@pytest.mark.parametrize(
    ("filtre", "changement", "regle"),
    [
        (
            {"dimension": "channel"},
            lambda banc: banc.redefinir(["revenue"], ["region"]),
            "dimension_not_exposed",
        ),
        (
            {"dimension": "region"},
            lambda banc: typer(banc, "region", "date"),
            "operator_not_allowed",
        ),
        (
            {"operator": "eq", "default": 2024},
            lambda banc: typer(banc, "year", "boolean"),
            "filter_value_incompatible",
        ),
    ],
    ids=["dimension retiree", "type sans l'operateur", "valeur du mauvais type"],
)
def test_dupliquer_juge_les_filtres_sur_le_catalogue_d_aujourd_hui(
    banc: Banc, filtre: dict[str, Any], changement: Changement, regle: str
) -> None:
    source, _ = avec_filtre(banc, **filtre)
    changement(banc)
    refus_invalide(dupliquer(banc, source), ("/filters/0/targets/0", regle))
    assert len(banc.depot.dashboards()) == 1


def test_dupliquer_voit_un_type_devenu_different_d_une_cible_a_l_autre(banc: Banc) -> None:
    ajouter_stock(banc)
    typer(banc, "year", "string")
    ventes, stock = analyse(banc), analyse(banc, query=requete(model=STOCK), contextual=[])
    source = banc.creer_tableau_ok(
        CREATEUR_GROUPE,
        visual(ident=COMPOSANT, analysis_id=ventes),
        visual(ident=AUTRE, analysis_id=stock),
        filters=[common_filter([COMPOSANT, AUTRE], dimension="year")],
    )
    typer(banc, "year", "number")
    refus_invalide(dupliquer(banc, source), ("/filters/0/targets/1", "filter_type_mismatch"))


def test_les_chemins_du_depot_des_dashboards_sont_ceux_du_genre(banc: Banc) -> None:
    ident = banc.creer_tableau_ok(CREATEUR_GROUPE, text())
    assert chemin_dashboard(ident) == f"dashboards/{A}/{ident}.yaml"
    assert banc.depot.dashboards() == ((A, ident),)
