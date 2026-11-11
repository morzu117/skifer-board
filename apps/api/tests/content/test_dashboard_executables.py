"""Composants exécutables d'un dashboard : chemins, ordre, imbrication, types retenus
(plan 19.2, B5)."""

from __future__ import annotations

from typing import Any

import pytest
from skifer_board.content.dashboard import Component, executables, validate

from .monde_dashboard import (
    column,
    container,
    dashboard,
    kpi,
    new_id,
    row,
    section,
    separator,
    text,
    visual,
    with_components,
    with_sections,
)

COLONNE = "/layout/sections/0/rows/0/columns/0/children"


def test_un_dashboard_sans_section_n_a_aucun_composant() -> None:
    assert executables(dashboard(layout={"sections": []})) == ()


def test_un_dashboard_sans_composant_executable_n_en_rend_aucun() -> None:
    assert executables(with_components(text(), separator())) == ()
    assert executables(dashboard(layout={"sections": [section()]})) == ()


def test_un_visuel_est_rendu_avec_son_chemin_sa_reference_et_sa_surcharge() -> None:
    ident, analyse = new_id(), new_id()
    document = with_components(visual(ident, analyse, 3, chart="line"))
    assert executables(document) == (
        Component(ident, "analysis", f"{COLONNE}/0", analyse, 3, "line"),
    )


def test_un_visuel_sans_surcharge_n_a_pas_de_graphique() -> None:
    ident, analyse = new_id(), new_id()
    (trouve,) = executables(with_components(visual(ident, analyse, 1)))
    assert trouve.chart is None


def test_un_kpi_est_retenu_sans_graphique() -> None:
    ident, analyse = new_id(), new_id()
    (trouve,) = executables(with_components(kpi(ident, analyse, 2)))
    assert trouve == Component(ident, "kpi", f"{COLONNE}/0", analyse, 2, None)


def test_un_kpi_dont_la_presentation_porte_un_graphique_le_garde() -> None:
    """`executables` ne juge pas la compatibilité : il rend ce que le document dit."""
    (trouve,) = executables(with_components(kpi(None, None, 1, chart="bars")))
    assert trouve.chart == "bars"


def test_les_textes_et_les_separateurs_sont_ignores_et_gardent_leur_rang_dans_les_chemins() -> None:
    a, b = new_id(), new_id()
    v1, v2 = new_id(), new_id()
    document = with_components(text(), visual(v1, a), separator(), kpi(v2, b, 4), text())
    assert [(c.id, c.path) for c in executables(document)] == [
        (v1, f"{COLONNE}/1"),
        (v2, f"{COLONNE}/3"),
    ]


def test_l_ordre_est_celui_du_document() -> None:
    """Sections, rangées, colonnes puis composants, dans l'ordre de lecture."""
    ids = [new_id() for _ in range(8)]
    document = with_sections(
        section(
            row(
                column(visual(ids[0]), kpi(ids[1]), span=6),
                column(visual(ids[2]), span=6),
            ),
            row(column(kpi(ids[3]))),
        ),
        section(row(column(visual(ids[4]), span=4), column(kpi(ids[5]), span=8))),
        section(row(column(visual(ids[6]))), row(column(kpi(ids[7])))),
    )
    assert [c.id for c in executables(document)] == ids


def test_les_chemins_sont_exacts_dans_les_sections_rangees_et_colonnes() -> None:
    ids = [new_id() for _ in range(4)]
    document = with_sections(
        section(row(column(visual(ids[0]), span=6), column(visual(ids[1]), span=6))),
        section(row(column(text())), row(column(separator(), kpi(ids[2]), visual(ids[3])))),
    )
    assert {c.id: c.path for c in executables(document)} == {
        ids[0]: "/layout/sections/0/rows/0/columns/0/children/0",
        ids[1]: "/layout/sections/0/rows/0/columns/1/children/0",
        ids[2]: "/layout/sections/1/rows/1/columns/0/children/1",
        ids[3]: "/layout/sections/1/rows/1/columns/0/children/2",
    }


def test_un_conteneur_est_parcouru_avec_son_chemin() -> None:
    dedans, dehors = new_id(), new_id()
    document = with_sections(
        section(
            row(
                column(container(row(column(text(), visual(dedans)))), span=6),
                column(kpi(dehors), span=6),
            )
        )
    )
    assert [(c.id, c.path) for c in executables(document)] == [
        (
            dedans,
            "/layout/sections/0/rows/0/columns/0/children/0/rows/0/columns/0/children/1",
        ),
        (dehors, "/layout/sections/0/rows/0/columns/1/children/0"),
    ]


def test_un_conteneur_a_plusieurs_rangees_et_colonnes_garde_l_ordre() -> None:
    ids = [new_id() for _ in range(4)]
    document = with_components(
        container(
            row(column(visual(ids[0]), span=6), column(kpi(ids[1]), span=6)),
            row(column(separator(), visual(ids[2]))),
            row(column(kpi(ids[3]))),
        )
    )
    base = f"{COLONNE}/0/rows"
    assert [(c.id, c.path) for c in executables(document)] == [
        (ids[0], f"{base}/0/columns/0/children/0"),
        (ids[1], f"{base}/0/columns/1/children/0"),
        (ids[2], f"{base}/1/columns/0/children/1"),
        (ids[3], f"{base}/2/columns/0/children/0"),
    ]


def test_un_conteneur_dans_un_conteneur_est_parcouru() -> None:
    profond = new_id()
    interieur = container(row(column(visual(profond))))
    milieu = container(row(column(interieur)))
    document = with_components(milieu)
    assert validate(document)  # le format admet ce niveau d'imbrication
    (trouve,) = executables(document)
    assert trouve.id == profond
    assert trouve.path == (f"{COLONNE}/0/rows/0/columns/0/children/0/rows/0/columns/0/children/0")


def test_un_conteneur_vide_ou_sans_composant_executable_n_en_rend_aucun() -> None:
    assert executables(with_components(container(row(column(text()))))) == ()
    assert executables(with_components(container())) == ()


def test_une_analyse_epinglee_plusieurs_fois_donne_un_composant_par_epinglage() -> None:
    analyse = new_id()
    a, b = new_id(), new_id()
    document = with_components(visual(a, analyse, 1), kpi(b, analyse, 2))
    assert [(c.id, c.analysis_id, c.revision) for c in executables(document)] == [
        (a, analyse, 1),
        (b, analyse, 2),
    ]


def test_le_resultat_est_un_tuple_de_composants_immuables() -> None:
    trouves = executables(with_components(visual()))
    assert isinstance(trouves, tuple)
    with pytest.raises(AttributeError):
        trouves[0].chart = "bars"  # type: ignore[misc]


def test_un_document_valide_se_lit_comme_un_document_brut() -> None:
    """Les composants d'un document validé sont ceux du document soumis."""
    ident, analyse = new_id(), new_id()
    brut: dict[str, Any] = with_components(visual(ident, analyse, 5, chart="grouped_bars"))
    assert executables(validate(brut)) == executables(brut)
