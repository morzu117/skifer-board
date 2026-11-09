"""Contrôles purs d'un dashboard contre les analyses épinglées et le catalogue (plan 19.2, B4, B7).

Aucune base, aucun dépôt : `dashboard_checks` reçoit des documents déjà lus et un catalogue écrit à
la main, et rend des violations à chemin ou des états de tuiles.
"""

from __future__ import annotations

from typing import Any

import pytest
from skifer_board.content.dashboard_checks import (
    ANALYSIS_UNAVAILABLE,
    CHECK_RULES,
    FILTER_INCOMPATIBLE,
    MAX_TILE_FILTERS,
    READY,
    REASONS,
    UNAVAILABLE,
    UNRESOLVED_REFERENCE,
    UNVERIFIED,
    Tile,
    chart_compatible,
    filter_problem,
    kpi_compatible,
    personal_components,
    save_violations,
    tiles,
)
from skifer_board.content.errors import Violation

from .monde import document as analysis_document
from .monde import new_id
from .monde_dashboard import column as column_
from .monde_dashboard import common_filter, container, kpi, row, section, text, visual
from .monde_dashboard import dashboard as dashboard_

BASE = "/layout/sections/0/rows/0/columns/0/children"


def dimension(nom: str, genre: str) -> dict[str, Any]:
    return {"name": nom, "type": genre}


def modele(nom: str, *dimensions: dict[str, Any]) -> dict[str, Any]:
    return {"name": nom, "metrics": [{"name": "revenue"}], "dimensions": list(dimensions)}


# `sales` : un type par famille d'opérateurs ; `autre` : `region` y est un nombre, `year` absent.
# (sert aux contrôles de type et d'exposition)
SALES = modele(
    "sales",
    dimension("region", "string"),
    dimension("year", "number"),
    dimension("day", "date"),
    dimension("moment", "timestamp"),
    dimension("active", "boolean"),
    dimension("inconnue", "unknown"),
)
AUTRE = modele("autre", dimension("region", "number"))
CATALOGUE: dict[str, Any] = {"models": [SALES, AUTRE]}
CONNEXIONS = {"finance"}


def analyse(
    *,
    chart: str = "bars",
    dimensions: tuple[str, ...] = ("region",),
    filters: int | list[dict[str, Any]] = 0,
    visibility: str = "shared",
    model: str = "sales",
    connection: str = "finance",
    metrics: tuple[str, ...] = ("revenue",),
) -> dict[str, Any]:
    """Analyse minimale, avec ce que les contrôles lisent (graphique, requête, visibilité)."""
    if isinstance(filters, int):
        filters = [{"column": "region", "operator": "eq", "value": "Sud"}] * filters
    return analysis_document(
        new_id(),
        visibility=visibility,
        presentation={"chart": chart},
        query={
            "connection": connection,
            "model": model,
            "metrics": list(metrics),
            "dimensions": list(dimensions),
            "filters": filters,
        },
    )


def tableau(*composants: dict[str, Any], filtres: list[dict[str, Any]] | None = None) -> Any:
    """Dashboard dont l'unique colonne porte ces composants."""
    return dashboard_(
        layout={"sections": [section(row(column_(*composants)))]}, filters=filtres or []
    )


def epingles(*paires: tuple[dict[str, Any], dict[str, Any] | None]) -> dict[str, Any]:
    """Analyses lues, par identifiant de composant."""
    return {composant["id"]: lue for composant, lue in paires}


# -- chart_compatible ----------------------------------------------------------------------


@pytest.mark.parametrize("dimensions", [0, 1, 2, 3])
@pytest.mark.parametrize(
    ("graphique", "attendu"),
    [("bars", None), ("line", None), ("grouped_bars", None), ("value", 0)],
)
def test_un_graphique_surcharge_convient_a_la_forme_de_l_analyse(
    graphique: str, attendu: int | None, dimensions: int
) -> None:
    """Seul `value` est contraint : il exige une requête sans dimension."""
    assert chart_compatible(graphique, dimensions) is (attendu is None or dimensions == attendu)


# -- filter_problem ------------------------------------------------------------------------


def filtre(dimension_: str, operateur: str = "eq", **extra: Any) -> dict[str, Any]:
    return {"dimension": dimension_, "operator": operateur, **extra}


def test_un_modele_absent_n_expose_aucune_dimension() -> None:
    assert filter_problem(filtre("region"), None) == "dimension_not_exposed"


def test_une_dimension_que_le_modele_n_expose_pas() -> None:
    assert filter_problem(filtre("pays"), SALES) == "dimension_not_exposed"
    # Un modèle sans aucune dimension n'en expose pas non plus.
    assert filter_problem(filtre("region"), modele("vide")) == "dimension_not_exposed"


@pytest.mark.parametrize(
    ("dimension_", "operateur"),
    [
        ("region", "gt"),
        ("region", "between"),
        ("year", "like"),
        ("active", "in"),
        ("active", "gte"),
        ("inconnue", "in"),
        ("inconnue", "lt"),
        # Les dates et horodatages n'admettent aucun opérateur (même table que la soumission).
        ("day", "eq"),
        ("day", "between"),
        ("moment", "eq"),
    ],
)
def test_un_operateur_que_le_type_ne_permet_pas(dimension_: str, operateur: str) -> None:
    assert filter_problem(filtre(dimension_, operateur), SALES) == "operator_not_allowed"


@pytest.mark.parametrize(
    ("dimension_", "operateur", "extra"),
    [
        ("region", "eq", {}),
        ("region", "ne", {"default": "Sud"}),
        ("region", "in", {"default": ["Sud", "Nord"], "allowed": ["Sud", "Nord", "Est"]}),
        ("region", "eq", {"allowed": ["Sud"]}),
        ("year", "gt", {"default": 2020}),
        ("year", "between", {"default": [2020, 2024]}),
        ("year", "between", {"default": [2020, 2020]}),
        ("year", "in", {"default": [2020, 2021], "allowed": [2020, 2021, 2022]}),
        ("year", "lte", {"default": 1.5, "allowed": [1, 2.5]}),
        ("active", "eq", {"default": True}),
        ("active", "ne", {"default": False, "allowed": [True, False]}),
        ("inconnue", "eq", {"default": "n'importe quoi", "allowed": [1, "x"]}),
        ("inconnue", "ne", {}),
    ],
)
def test_un_filtre_qui_s_applique(dimension_: str, operateur: str, extra: dict[str, Any]) -> None:
    assert filter_problem(filtre(dimension_, operateur, **extra), SALES) is None


@pytest.mark.parametrize(
    ("dimension_", "operateur", "extra"),
    [
        # Valeur par défaut d'un autre type que la dimension.
        ("region", "eq", {"default": 3}),
        ("region", "in", {"default": [1, 2]}),
        ("year", "eq", {"default": "2020"}),
        ("year", "gt", {"default": True}),
        ("year", "between", {"default": ["a", "b"]}),
        ("active", "eq", {"default": "oui"}),
        ("active", "ne", {"default": 1}),
        # Bornes inversées : la soumission les refuse.
        ("year", "between", {"default": [2024, 2020]}),
        # Valeurs autorisées d'un autre type, jugées une à une comme des égalités.
        ("region", "eq", {"allowed": ["Sud", 7]}),
        ("year", "in", {"allowed": ["2020"]}),
        ("active", "eq", {"allowed": [True, "faux"]}),
        # Une valeur par défaut valide ne sauve pas des valeurs autorisées invalides.
        ("region", "eq", {"default": "Sud", "allowed": [1]}),
    ],
)
def test_une_valeur_incompatible_avec_le_type(
    dimension_: str, operateur: str, extra: dict[str, Any]
) -> None:
    assert filter_problem(filtre(dimension_, operateur, **extra), SALES) == (
        "filter_value_incompatible"
    )


def test_le_modele_juge_le_filtre_pas_le_nom_de_la_dimension() -> None:
    """`region` est une chaîne dans `sales` et un nombre dans `autre`."""
    assert filter_problem(filtre("region", "gt", default=3), AUTRE) is None
    assert filter_problem(filtre("region", "gt", default=3), SALES) == "operator_not_allowed"
    assert filter_problem(filtre("region", "eq", default="Sud"), AUTRE) == (
        "filter_value_incompatible"
    )


# -- save_violations : une analyse indisponible --------------------------------------------


def test_les_regles_de_sauvegarde_forment_un_ensemble_ferme() -> None:
    assert CHECK_RULES == {
        "analysis_unavailable",
        "kpi_requires_value",
        "chart_incompatible",
        "dimension_not_exposed",
        "filter_type_mismatch",
        "operator_not_allowed",
        "filter_value_incompatible",
        "too_many_filters",
    }
    assert REASONS == (ANALYSIS_UNAVAILABLE, UNRESOLVED_REFERENCE, FILTER_INCOMPATIBLE)
    assert MAX_TILE_FILTERS == 32


def test_un_dashboard_sans_composant_executable_n_a_rien_a_signaler() -> None:
    assert save_violations(tableau(text()), {}, CATALOGUE) == []
    assert save_violations(tableau(), {}, CATALOGUE) == []


def test_une_analyse_indisponible_donne_une_seule_violation_sans_autre_controle() -> None:
    """Un KPI et un graphique surchargé sans analyse lisible : on ne devine rien de leur contenu."""
    chiffre = kpi()
    graphique = visual(chart="value")
    document_ = tableau(chiffre, graphique, text(), visual())
    lues = epingles(
        (chiffre, None),
        (graphique, None),
        (document_["layout"]["sections"][0]["rows"][0]["columns"][0]["children"][3], None),
    )
    assert save_violations(document_, lues, CATALOGUE) == [
        Violation(f"{BASE}/0/reference", ANALYSIS_UNAVAILABLE),
        Violation(f"{BASE}/1/reference", ANALYSIS_UNAVAILABLE),
        Violation(f"{BASE}/3/reference", ANALYSIS_UNAVAILABLE),
    ]


def test_un_dashboard_dont_toutes_les_analyses_conviennent_est_valide() -> None:
    chiffre = kpi()
    graphique = visual(chart="line")
    simple = visual()
    document_ = tableau(chiffre, graphique, simple, text())
    lues = epingles(
        (chiffre, analyse(chart="value", dimensions=())),
        (graphique, analyse(dimensions=("region", "year"))),
        (simple, analyse()),
    )
    assert save_violations(document_, lues, CATALOGUE) == []


# -- save_violations : KPI et graphique surchargé ------------------------------------------


@pytest.mark.parametrize("graphique", ["bars", "line", "grouped_bars"])
def test_un_kpi_exige_une_analyse_dont_le_graphique_est_value(graphique: str) -> None:
    chiffre = kpi()
    assert save_violations(
        tableau(chiffre), epingles((chiffre, analyse(chart=graphique))), CATALOGUE
    ) == [Violation(f"{BASE}/0/reference", "kpi_requires_value")]


@pytest.mark.parametrize("dimensions", [("region",), ("region", "year")])
def test_un_kpi_exige_aussi_une_requete_sans_dimension(dimensions: tuple[str, ...]) -> None:
    """Plus strict que l'Explorateur : un dashboard ne garantit pas une seule ligne, seule la forme
    de la requête le fait. Une analyse `value` avec dimensions n'est donc pas un KPI."""
    chiffre = kpi()
    lues = epingles((chiffre, analyse(chart="value", dimensions=dimensions)))
    assert save_violations(tableau(chiffre), lues, CATALOGUE) == [
        Violation(f"{BASE}/0/reference", "kpi_requires_value")
    ]


def test_un_kpi_sur_une_analyse_value_sans_dimension_convient() -> None:
    chiffre = kpi()
    lues = epingles((chiffre, analyse(chart="value", dimensions=())))
    assert save_violations(tableau(chiffre), lues, CATALOGUE) == []


@pytest.mark.parametrize(
    ("chart", "dimensions", "attendu"),
    [
        ("value", (), True),
        ("value", ("region",), False),
        ("bars", (), False),
        ("line", ("region",), False),
        ("grouped_bars", ("region", "year"), False),
    ],
)
def test_kpi_compatible_demande_value_et_aucune_dimension(
    chart: str, dimensions: tuple[str, ...], attendu: bool
) -> None:
    assert kpi_compatible(analyse(chart=chart, dimensions=dimensions)) is attendu


def test_un_kpi_en_defaut_ne_declenche_pas_le_controle_du_graphique_surcharge() -> None:
    """La violation du KPI remplace celle du graphique : une seule par composant."""
    chiffre = kpi(chart="value")
    assert save_violations(
        tableau(chiffre), epingles((chiffre, analyse(dimensions=("region",)))), CATALOGUE
    ) == [Violation(f"{BASE}/0/reference", "kpi_requires_value")]


def test_un_graphique_value_surcharge_exige_une_analyse_sans_dimension() -> None:
    sans, avec, deux = visual(chart="value"), visual(chart="value"), visual(chart="value")
    lues = epingles(
        (sans, analyse(dimensions=())),
        (avec, analyse(dimensions=("region",))),
        (deux, analyse(dimensions=("region", "year"))),
    )
    assert save_violations(tableau(sans, avec, deux), lues, CATALOGUE) == [
        Violation(f"{BASE}/1/presentation/chart", "chart_incompatible"),
        Violation(f"{BASE}/2/presentation/chart", "chart_incompatible"),
    ]


@pytest.mark.parametrize("graphique", ["bars", "line", "grouped_bars"])
def test_les_autres_graphiques_surcharges_conviennent_a_toute_forme(graphique: str) -> None:
    composants = [visual(chart=graphique) for _ in range(3)]
    lues = epingles(
        *(
            (composant, analyse(dimensions=dimensions))
            for composant, dimensions in zip(
                composants, [(), ("region",), ("region", "year")], strict=True
            )
        )
    )
    assert save_violations(tableau(*composants), lues, CATALOGUE) == []


def test_un_visuel_sans_surcharge_n_est_jamais_incompatible() -> None:
    simple = visual()
    lues = epingles((simple, analyse(chart="value", dimensions=("region", "year"))))
    assert save_violations(tableau(simple), lues, CATALOGUE) == []


def test_les_violations_suivent_l_ordre_du_document_dans_les_conteneurs() -> None:
    premier = visual(chart="value")
    dedans = kpi()
    dernier = visual()
    document_ = dashboard_(
        layout={
            "sections": [
                section(row(column_(premier))),
                section(
                    row(
                        column_(),
                        column_(
                            container(
                                row(column_(text(), column=None) if False else column_(dedans))
                            )
                        ),
                    ),
                    row(column_(dernier)),
                ),
            ]
        }
    )
    lues = epingles(
        (premier, analyse(dimensions=("region",))),
        (dedans, analyse()),
        (dernier, None),
    )
    assert save_violations(document_, lues, CATALOGUE) == [
        Violation(
            "/layout/sections/0/rows/0/columns/0/children/0/presentation/chart",
            "chart_incompatible",
        ),
        Violation(
            "/layout/sections/1/rows/0/columns/1/children/0/rows/0/columns/0/children/0/reference",
            "kpi_requires_value",
        ),
        Violation("/layout/sections/1/rows/1/columns/0/children/0/reference", ANALYSIS_UNAVAILABLE),
    ]


# -- save_violations : filtres communs -----------------------------------------------------


def test_un_filtre_qui_s_applique_a_toutes_ses_cibles() -> None:
    a, b = visual(), kpi()
    item = common_filter([a["id"], b["id"]], operator="eq", default="Sud", allowed=["Sud", "Nord"])
    lues = epingles((a, analyse()), (b, analyse(chart="value", dimensions=())))
    assert save_violations(tableau(a, b, filtres=[item]), lues, CATALOGUE) == []


def test_un_modele_qui_n_expose_pas_la_dimension() -> None:
    a, b = visual(), visual()
    item = common_filter([a["id"], b["id"]], dimension="year")
    lues = epingles((a, analyse()), (b, analyse(model="autre")))
    assert save_violations(tableau(a, b, filtres=[item]), lues, CATALOGUE) == [
        Violation("/filters/0/targets/1", "dimension_not_exposed")
    ]


def test_un_modele_absent_du_catalogue_n_expose_pas_la_dimension() -> None:
    a = visual()
    item = common_filter([a["id"]])
    lues = epingles((a, analyse(model="disparu")))
    assert save_violations(tableau(a, filtres=[item]), lues, CATALOGUE) == [
        Violation("/filters/0/targets/0", "dimension_not_exposed")
    ]


def test_un_operateur_que_le_type_de_la_cible_ne_permet_pas() -> None:
    a, b = visual(), visual()
    item = common_filter([a["id"], b["id"]], dimension="year", operator="gt", default=3)
    lues = epingles((a, analyse()), (b, analyse()))
    assert save_violations(tableau(a, b, filtres=[item]), lues, CATALOGUE) == []
    item = common_filter([a["id"], b["id"]], dimension="active", operator="gt", default=3)
    assert save_violations(tableau(a, b, filtres=[item]), lues, CATALOGUE) == [
        Violation("/filters/0/targets/0", "operator_not_allowed"),
        Violation("/filters/0/targets/1", "operator_not_allowed"),
    ]


def test_une_valeur_incompatible_avec_le_type_de_la_cible() -> None:
    a, b = visual(), visual()
    # Une chaîne pour `region` convient à `sales`, pas à `autre` (nombre).
    item = common_filter([a["id"], b["id"]], default="Sud", allowed=["Sud"])
    lues = epingles((a, analyse()), (b, analyse(model="autre")))
    assert save_violations(tableau(a, b, filtres=[item]), lues, CATALOGUE) == [
        Violation("/filters/0/targets/1", "filter_value_incompatible")
    ]


def test_un_filtre_dont_les_cibles_ont_des_types_differents() -> None:
    a, b, c = visual(), visual(), visual()
    item = common_filter([a["id"], b["id"], c["id"]])
    lues = epingles((a, analyse()), (b, analyse(model="autre")), (c, analyse()))
    # Comparé à la première cible valide : la deuxième (nombre) diffère, la troisième la suit.
    assert save_violations(tableau(a, b, c, filtres=[item]), lues, CATALOGUE) == [
        Violation("/filters/0/targets/1", "filter_type_mismatch")
    ]


def test_le_type_de_reference_est_celui_de_la_premiere_cible_valide() -> None:
    a, b, c = visual(), visual(), visual()
    item = common_filter([a["id"], b["id"], c["id"]])
    # La première cible ne convient pas (modèle absent) : la deuxième, valide, fait référence.
    lues = epingles((a, analyse(model="disparu")), (b, analyse(model="autre")), (c, analyse()))
    assert save_violations(tableau(a, b, c, filtres=[item]), lues, CATALOGUE) == [
        Violation("/filters/0/targets/0", "dimension_not_exposed"),
        Violation("/filters/0/targets/2", "filter_type_mismatch"),
    ]


def test_une_cible_en_defaut_ne_fixe_pas_le_type_de_reference() -> None:
    """Une cible au filtre incompatible est signalée, sans jamais être comparée aux autres."""
    a, b = visual(), visual()
    item = common_filter([a["id"], b["id"]], operator="gt", default=1)
    # `gt` est refusé pour `region` chaîne (a), permis pour `region` nombre (b).
    lues = epingles((a, analyse()), (b, analyse(model="autre")))
    assert save_violations(tableau(a, b, filtres=[item]), lues, CATALOGUE) == [
        Violation("/filters/0/targets/0", "operator_not_allowed")
    ]


def test_les_cibles_sans_analyse_sont_ignorees_par_les_filtres() -> None:
    a, b = visual(), visual()
    item = common_filter([a["id"], b["id"]], dimension="year")
    lues = epingles((a, None), (b, analyse()))
    assert save_violations(tableau(a, b, filtres=[item]), lues, CATALOGUE) == [
        Violation(f"{BASE}/0/reference", ANALYSIS_UNAVAILABLE)
    ]
    # Même sans autre cible, la seule violation est celle de l'analyse indisponible.
    seul = common_filter([a["id"]], dimension="pays")
    assert save_violations(tableau(a, filtres=[seul]), epingles((a, None)), CATALOGUE) == [
        Violation(f"{BASE}/0/reference", ANALYSIS_UNAVAILABLE)
    ]


def test_les_violations_des_filtres_suivent_l_ordre_des_filtres_puis_des_cibles() -> None:
    a, b = visual(), visual()
    premier = common_filter([a["id"], b["id"]], dimension="pays")
    second = common_filter([b["id"]], operator="gt", default=1)
    lues = epingles((a, analyse()), (b, analyse()))
    assert save_violations(tableau(a, b, filtres=[premier, second]), lues, CATALOGUE) == [
        Violation("/filters/0/targets/0", "dimension_not_exposed"),
        Violation("/filters/0/targets/1", "dimension_not_exposed"),
        Violation("/filters/1/targets/0", "operator_not_allowed"),
    ]


def test_les_violations_des_composants_precedent_celles_des_filtres() -> None:
    a, b = visual(chart="value"), visual()
    item = common_filter([b["id"]], dimension="pays")
    lues = epingles((a, analyse()), (b, analyse()))
    assert save_violations(tableau(a, b, filtres=[item]), lues, CATALOGUE) == [
        Violation(f"{BASE}/0/presentation/chart", "chart_incompatible"),
        Violation("/filters/0/targets/0", "dimension_not_exposed"),
    ]


# -- save_violations : too_many_filters ----------------------------------------------------


@pytest.mark.parametrize(
    ("propres", "communs", "attendu"),
    [
        (0, 0, False),
        (31, 1, False),
        (32, 0, False),
        (30, 2, False),
        (32, 1, True),
        (31, 2, True),
        (33, 0, True),
        (0, 33, True),
        (0, 32, False),
    ],
)
def test_une_tuile_ne_depasse_pas_trente_deux_filtres(
    propres: int, communs: int, attendu: bool
) -> None:
    """Filtres de l'analyse plus filtres communs ciblés : 32 passent, 33 sont refusés."""
    a = visual()
    items = [common_filter([a["id"]]) for _ in range(communs)]
    lues = epingles((a, analyse(filters=propres)))
    assert save_violations(tableau(a, filtres=items), lues, CATALOGUE) == (
        [Violation(BASE + "/0", "too_many_filters")] if attendu else []
    )


def test_seuls_les_filtres_qui_ciblent_la_tuile_comptent() -> None:
    a, b = visual(), visual()
    items = [common_filter([a["id"]]), common_filter([b["id"]]), common_filter([a["id"], b["id"]])]
    lues = epingles((a, analyse(filters=30)), (b, analyse(filters=31)))
    # a : 30 + 2 = 32 ; b : 31 + 2 = 33.
    assert save_violations(tableau(a, b, filtres=items), lues, CATALOGUE) == [
        Violation(BASE + "/1", "too_many_filters")
    ]


def test_un_filtre_incompatible_compte_quand_meme_pour_la_tuile() -> None:
    a = visual()
    item = common_filter([a["id"]], dimension="pays")
    lues = epingles((a, analyse(filters=32)))
    assert save_violations(tableau(a, filtres=[item]), lues, CATALOGUE) == [
        Violation("/filters/0/targets/0", "dimension_not_exposed"),
        Violation(BASE + "/0", "too_many_filters"),
    ]


def test_une_analyse_indisponible_n_est_pas_comptee_pour_ses_filtres() -> None:
    a, b = visual(), visual()
    items = [common_filter([a["id"], b["id"]]) for _ in range(40)]
    lues = epingles((a, None), (b, analyse()))
    assert save_violations(tableau(a, b, filtres=items), lues, CATALOGUE) == [
        Violation(f"{BASE}/0/reference", ANALYSIS_UNAVAILABLE),
        Violation(BASE + "/1", "too_many_filters"),
    ]


def test_les_violations_ne_sont_que_des_chemins_et_des_regles_fermees() -> None:
    a, b = visual(chart="value"), kpi()
    item = common_filter([a["id"], b["id"]], dimension="pays")
    lues = epingles((a, analyse(filters=33)), (b, analyse()))
    violations = save_violations(tableau(a, b, filtres=[item]), lues, CATALOGUE)
    assert {violation.rule for violation in violations} <= CHECK_RULES
    assert {violation.rule for violation in violations} == {
        "chart_incompatible",
        "kpi_requires_value",
        "dimension_not_exposed",
        "too_many_filters",
    }


# -- personal_components -------------------------------------------------------------------


def test_les_composants_dont_l_analyse_n_est_pas_partagee() -> None:
    a, b, c, d = visual(), kpi(), visual(), visual()
    lues = epingles(
        (a, analyse(visibility="personal")),
        (b, analyse(visibility="shared")),
        (c, analyse(visibility="personal")),
        (d, analyse(visibility="shared")),
    )
    document_ = tableau(a, b, text(), c, d)
    assert personal_components(document_, lues) == [a["id"], c["id"]]


def test_aucun_composant_personnel_dans_un_dashboard_sans_analyse_personnelle() -> None:
    a = visual()
    assert personal_components(tableau(a), epingles((a, analyse()))) == []
    assert personal_components(tableau(text()), {}) == []


def test_un_composant_sans_analyse_n_est_pas_signale_comme_personnel() -> None:
    """L'appelant a déjà refusé les analyses indisponibles ; la fonction ne les devine pas."""
    a, b = visual(), visual()
    lues = epingles((a, None), (b, analyse(visibility="personal")))
    assert personal_components(tableau(a, b), lues) == [b["id"]]


# -- Tile ----------------------------------------------------------------------------------


def test_une_tuile_se_serialise_avec_sa_raison_si_elle_en_a_une() -> None:
    assert Tile("c1", READY).json() == {"id": "c1", "state": "ready"}
    assert Tile("c1", UNVERIFIED).json() == {"id": "c1", "state": "unverified"}
    assert Tile("c2", UNAVAILABLE, FILTER_INCOMPATIBLE).json() == {
        "id": "c2",
        "state": "unavailable",
        "reason": "filter_incompatible",
    }


def test_une_tuile_est_immuable_et_comparable() -> None:
    tuile = Tile("c1", READY)
    assert tuile == Tile("c1", READY, None)
    assert tuile != Tile("c1", UNVERIFIED)
    with pytest.raises(AttributeError):
        tuile.state = UNAVAILABLE  # type: ignore[misc]


# -- tiles ---------------------------------------------------------------------------------


def test_aucune_tuile_sans_composant_executable() -> None:
    assert tiles(tableau(text()), {}, CATALOGUE, CONNEXIONS) == []
    assert tiles(tableau(text()), {}, None, ()) == []


def test_une_analyse_lisible_dont_les_references_tiennent_est_prete() -> None:
    a, b = visual(), kpi()
    lues = epingles((a, analyse()), (b, analyse(chart="value", dimensions=())))
    assert tiles(tableau(a, b), lues, CATALOGUE, CONNEXIONS) == [
        Tile(a["id"], READY),
        Tile(b["id"], READY),
    ]


def test_une_analyse_indisponible_ne_dit_rien_de_son_contenu() -> None:
    a = visual()
    # Même sans catalogue lisible, l'analyse absente est `unavailable` et non `unverified`.
    for catalogue in (CATALOGUE, None):
        assert tiles(tableau(a), epingles((a, None)), catalogue, CONNEXIONS) == [
            Tile(a["id"], UNAVAILABLE, ANALYSIS_UNAVAILABLE)
        ]


def test_sans_catalogue_une_analyse_lisible_reste_non_verifiee() -> None:
    a, b = visual(), visual()
    # Les références ne sont pas jugées : même une connexion absente ne change rien.
    lues = epingles((a, analyse()), (b, analyse(connection="disparue")))
    assert tiles(tableau(a, b), lues, None, CONNEXIONS) == [
        Tile(a["id"], UNVERIFIED),
        Tile(b["id"], UNVERIFIED),
    ]


@pytest.mark.parametrize(
    "lue",
    [
        analyse(connection="disparue"),
        analyse(model="disparu"),
        analyse(metrics=("disparue",)),
        analyse(dimensions=("disparue",)),
        analyse(filters=[{"column": "region", "operator": "gt", "value": "Sud"}]),
    ],
    ids=["connexion", "modele", "metrique", "dimension", "filtre-de-l-analyse"],
)
def test_une_reference_disparue_rend_la_tuile_non_resolue(lue: dict[str, Any]) -> None:
    a = visual()
    assert tiles(tableau(a), epingles((a, lue)), CATALOGUE, CONNEXIONS) == [
        Tile(a["id"], UNAVAILABLE, UNRESOLVED_REFERENCE)
    ]


def test_une_connexion_hors_de_la_liste_de_l_espace_rend_la_tuile_non_resolue() -> None:
    a = visual()
    lues = epingles((a, analyse()))
    assert tiles(tableau(a), lues, CATALOGUE, set()) == [
        Tile(a["id"], UNAVAILABLE, UNRESOLVED_REFERENCE)
    ]


def test_un_filtre_commun_devenu_incompatible_rend_la_tuile_incompatible() -> None:
    a = visual()
    item = common_filter([a["id"]], operator="gt", default=3)
    assert tiles(tableau(a, filtres=[item]), epingles((a, analyse())), CATALOGUE, CONNEXIONS) == [
        Tile(a["id"], UNAVAILABLE, FILTER_INCOMPATIBLE)
    ]


def test_un_filtre_est_juge_pour_les_seules_tuiles_qu_il_cible() -> None:
    a, b, c = visual(), visual(), visual()
    # Incompatible avec le modèle `sales` de `a`, valide pour le modèle `autre` de `b`, hors de `c`.
    item = common_filter([a["id"], b["id"]], operator="gt", default=3)
    lues = epingles((a, analyse()), (b, analyse(model="autre")), (c, analyse()))
    assert tiles(tableau(a, b, c, filtres=[item]), lues, CATALOGUE, CONNEXIONS) == [
        Tile(a["id"], UNAVAILABLE, FILTER_INCOMPATIBLE),
        Tile(b["id"], READY),
        Tile(c["id"], READY),
    ]


def test_des_types_differents_entre_les_cibles_rendent_la_tuile_incompatible() -> None:
    """`region` devenu numérique dans un modèle, restée textuelle dans l'autre : un filtre `eq` sans
    valeur est valide pour chaque cible prise seule, mais plus pour l'ensemble. La lecture juge
    comme la sauvegarde : la tuile qui s'écarte du type de la première cible est incompatible."""
    a, b, c = visual(), visual(), visual()
    item = common_filter([a["id"], b["id"], c["id"]])
    lues = epingles((a, analyse()), (b, analyse(model="autre")), (c, analyse()))
    document_ = tableau(a, b, c, filtres=[item])
    assert [violation.rule for violation in save_violations(document_, lues, CATALOGUE)] == [
        "filter_type_mismatch"
    ]
    assert tiles(document_, lues, CATALOGUE, CONNEXIONS) == [
        Tile(a["id"], READY),
        Tile(b["id"], UNAVAILABLE, FILTER_INCOMPATIBLE),
        Tile(c["id"], READY),
    ]


def test_des_types_identiques_entre_les_cibles_laissent_les_tuiles_pretes() -> None:
    a, b = visual(), visual()
    item = common_filter([a["id"], b["id"]])
    lues = epingles((a, analyse()), (b, analyse()))
    assert tiles(tableau(a, b, filtres=[item]), lues, CATALOGUE, CONNEXIONS) == [
        Tile(a["id"], READY),
        Tile(b["id"], READY),
    ]


def test_un_filtre_compatible_laisse_la_tuile_prete() -> None:
    a = visual()
    item = common_filter([a["id"]], default="Sud", allowed=["Sud", "Nord"])
    assert tiles(tableau(a, filtres=[item]), epingles((a, analyse())), CATALOGUE, CONNEXIONS) == [
        Tile(a["id"], READY)
    ]


def test_priorite_indisponible_puis_non_verifiee_puis_non_resolue_puis_filtre_puis_prete() -> None:
    indisponible, lisible, non_resolue, incompatible, prete = (
        visual(),
        visual(),
        visual(),
        visual(),
        visual(),
    )
    # Un filtre incompatible cible aussi les tuiles déjà indisponibles ou non résolues.
    item = common_filter(
        [indisponible["id"], non_resolue["id"], incompatible["id"]], operator="gt", default=1
    )
    document_ = tableau(indisponible, non_resolue, incompatible, prete, filtres=[item])
    lues = epingles(
        (indisponible, None),
        (non_resolue, analyse(model="disparu")),
        (incompatible, analyse()),
        (prete, analyse()),
    )
    assert tiles(document_, lues, CATALOGUE, CONNEXIONS) == [
        Tile(indisponible["id"], UNAVAILABLE, ANALYSIS_UNAVAILABLE),
        Tile(non_resolue["id"], UNAVAILABLE, UNRESOLVED_REFERENCE),
        Tile(incompatible["id"], UNAVAILABLE, FILTER_INCOMPATIBLE),
        Tile(prete["id"], READY),
    ]
    # Sans catalogue, seule l'indisponibilité de l'analyse l'emporte sur `unverified`.
    assert tiles(document_, lues, None, CONNEXIONS) == [
        Tile(indisponible["id"], UNAVAILABLE, ANALYSIS_UNAVAILABLE),
        Tile(non_resolue["id"], UNVERIFIED),
        Tile(incompatible["id"], UNVERIFIED),
        Tile(prete["id"], UNVERIFIED),
    ]
    assert lisible["id"] not in {tuile.id for tuile in tiles(document_, lues, None, ())}


def test_les_tuiles_suivent_l_ordre_du_document_dans_les_conteneurs() -> None:
    a, b, c, d = visual(), kpi(), visual(), visual()
    document_ = dashboard_(
        layout={
            "sections": [
                section(
                    row(column_(a), column_(container(row(column_(b)), row(column_(c))))),
                ),
                section(row(column_(text(), d))),
            ]
        }
    )
    lues = epingles(
        (a, analyse()),
        (b, None),
        (c, analyse(model="disparu")),
        (d, analyse()),
    )
    assert tiles(document_, lues, CATALOGUE, CONNEXIONS) == [
        Tile(a["id"], READY),
        Tile(b["id"], UNAVAILABLE, ANALYSIS_UNAVAILABLE),
        Tile(c["id"], UNAVAILABLE, UNRESOLVED_REFERENCE),
        Tile(d["id"], READY),
    ]


def test_les_tuiles_ne_recopient_rien_de_l_analyse() -> None:
    a = visual()
    lue = analyse(model="disparu")
    lue["name"] = "Marge secrete"
    rendu = [tuile.json() for tuile in tiles(tableau(a), epingles((a, lue)), CATALOGUE, CONNEXIONS)]
    assert rendu == [{"id": a["id"], "state": "unavailable", "reason": "unresolved_reference"}]
    assert "Marge" not in repr(rendu) and "disparu" not in repr(rendu)
