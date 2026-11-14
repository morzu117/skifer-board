"""Extraction et fermeture des références versionnées."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest
from skifer_board.content.composition import Dependencies, dependency_closure, extract_template
from skifer_board.content.structured_format import PAGE_TEMPLATE

from .monde_dashboard import (
    column,
    common_filter,
    container,
    dashboard,
    kpi,
    new_id,
    row,
    section,
    visual,
)

ROOT = Path(__file__).resolve().parents[4] / "contracts/components/fixtures/valid"


def make() -> tuple[dict[str, Any], dict[tuple[str, int], dict[str, Any]], str, str]:
    analysis_id, component_id = new_id(), new_id()
    shared = visual(analysis_id=analysis_id, title="Ventes")
    metric = kpi(analysis_id=analysis_id)
    approved: dict[str, Any] = {
        "id": new_id(),
        "type": "component",
        "component": {"component_id": component_id, "revision": 2},
    }
    component = json.loads((ROOT / "kpi.json").read_text())
    component["id"] = component_id
    component["analysis"] = {"analysis_id": analysis_id, "revision": 1}
    component["presentation"] = {"title": "Marge"}
    tree = {"sections": [section(row(column(shared, metric, approved, span=12), column(span=0)))]}
    tree["sections"][0]["rows"][0]["columns"].pop()  # une colonne, largeur 12
    data = dashboard(layout=tree, filters=[common_filter([shared["id"], approved["id"]])])
    data["theme"] = {"theme_id": new_id(), "revision": 3}
    data["template"] = {"template_id": new_id(), "revision": 1}
    return data, {(component_id, 2): component}, analysis_id, component_id


def test_extraction_et_sentinelle() -> None:
    source, components, analysis_id, component_id = make()
    before = copy.deepcopy(source)
    result = extract_template(source, new_id(), components)
    assert source == before
    nodes = result["layout"]["sections"][0]["rows"][0]["columns"][0]["children"]
    assert [(n["type"], n["expected"], n["label"]) for n in nodes] == [
        ("slot", "visual", "Ventes"),
        ("slot", "kpi", "KPI"),
        ("slot", "kpi", "Marge"),
    ]
    assert "targets" not in result["filters"][0]
    assert "theme" not in result and "template" not in result
    raw = PAGE_TEMPLATE.dumps(result).decode()
    assert analysis_id not in raw and component_id not in raw


def test_fermeture_et_absence() -> None:
    source, components, analysis_id, component_id = make()
    theme = source["theme"]["theme_id"]
    assert dependency_closure(source, components) == Dependencies(
        ((analysis_id, 1),), ((theme, 3),), ((component_id, 2),)
    )
    del source["theme"]
    assert dependency_closure(source, components).themes == ()
    with pytest.raises(ValueError, match="unresolved_component"):
        dependency_closure(source, {})
    with pytest.raises(ValueError, match="unresolved_component"):
        extract_template(source, new_id(), {})
    broken = copy.deepcopy(components)
    next(iter(broken.values()))["id"] = new_id()
    with pytest.raises(ValueError, match="component_id_mismatch"):
        dependency_closure(source, broken)


def test_nesting_et_libelle_borne() -> None:
    analysis = visual(title="x" * 120)
    wrapped = container(row(column(analysis)))
    data = dashboard(layout={"sections": [section(row(column(wrapped)))]})
    result = extract_template(data, new_id(), {})
    node = result["layout"]["sections"][0]["rows"][0]["columns"][0]["children"][0]["rows"][0][
        "columns"
    ][0]["children"][0]
    assert node["label"] == "x" * 80
    assert dependency_closure(data, {}).analyses == ((analysis["reference"]["analysis_id"], 1),)


def test_fermeture_graphe_tri_et_dedoublonnage() -> None:
    analysis_ids = [f"00000000-0000-4000-8000-{i:012x}" for i in range(1, 9)]
    component_ids = [f"10000000-0000-4000-8000-{i:012x}" for i in range(1, 9)]
    base = json.loads((ROOT / "kpi.json").read_text())
    components: dict[tuple[str, int], dict[str, Any]] = {}
    nodes = []
    for analysis_id, component_id in reversed(list(zip(analysis_ids, component_ids, strict=True))):
        content = copy.deepcopy(base)
        content["id"] = component_id
        content["analysis"] = {"analysis_id": analysis_id, "revision": 1}
        components[(component_id, 1)] = content
        nodes.extend(
            [
                visual(analysis_id=analysis_id, revision=1),
                {
                    "id": new_id(),
                    "type": "component",
                    "component": {"component_id": component_id, "revision": 1},
                },
            ]
        )
    duplicates = [
        visual(analysis_id=analysis_ids[0], revision=1),
        {
            "id": new_id(),
            "type": "component",
            "component": {"component_id": component_ids[0], "revision": 1},
        },
    ]
    source = dashboard(
        layout={"sections": [section(row(column(*nodes)), row(column(*duplicates)))]}
    )
    theme_id = "20000000-0000-4000-8000-000000000001"
    source["theme"] = {"theme_id": theme_id, "revision": 4}
    source["template"] = {"template_id": "30000000-0000-4000-8000-000000000001", "revision": 2}
    result = dependency_closure(source, components)
    assert result.analyses == tuple((ident, 1) for ident in analysis_ids)
    assert result.components == tuple((ident, 1) for ident in component_ids)
    assert result.themes == ((theme_id, 4),)
