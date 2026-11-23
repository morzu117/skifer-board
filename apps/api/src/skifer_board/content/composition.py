"""Extraction de squelettes et fermeture des dépendances, sans accès au dépôt."""

from __future__ import annotations

import copy
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from . import dashboard
from .structured_format import COMPONENT, PAGE_TEMPLATE

Pin = tuple[str, int]
Components = Mapping[Pin, dict[str, Any]]


def component_analysis(document: dict[str, Any]) -> Pin:
    """Épingle d'analyse d'un composant déjà validé."""
    reference = document["analysis"]
    return (reference["analysis_id"], reference["revision"])


def _component(reference: dict[str, Any], components: Components) -> dict[str, Any]:
    pin = (reference["component_id"], reference["revision"])
    if pin not in components:
        raise ValueError("unresolved_component")
    document = COMPONENT.validate(components[pin])
    if document["id"] != pin[0]:
        raise ValueError("component_id_mismatch")
    return document


def _children(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [child for row in rows for column in row["columns"] for child in column["children"]]


def _nodes(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for node in _children(rows):
        if node["type"] == "container":
            result.extend(_nodes(node["rows"]))
        else:
            result.append(node)
    return result


def extract_template(
    document: dict[str, Any], template_id: str, components: Components
) -> dict[str, Any]:
    """Copie la structure ; les composants référencés sont fournis par l'appelant."""
    source = dashboard.validate(document)
    layout = copy.deepcopy(source["layout"])
    for section in layout["sections"]:
        for node in _nodes(section["rows"]):
            kind = node["type"]
            if kind not in ("analysis", "kpi", "component"):
                continue
            presentation = node.get("presentation", {})
            if kind == "component":
                resolved = _component(node["component"], components)
                expected = resolved["kind"]
                presentation = resolved["presentation"]
            else:
                expected = "visual" if kind == "analysis" else "kpi"
            label = presentation.get("title") or ("Visuel" if expected == "visual" else "KPI")
            label = label[:80]  # Le libellé de slot est borné à 80 caractères.
            ident = node["id"]
            node.clear()
            node.update({"id": ident, "type": "slot", "expected": expected, "label": label})
    result = {
        "api_version": "board.page_template/v1",
        "id": template_id,
        "name": source["name"],
        "description": source["description"],
        "owner": source["owner"],
        "defaults": source["defaults"],
        "filters": [
            {k: v for k, v in item.items() if k != "targets"} for item in source["filters"]
        ],
        "layout": layout,
    }
    return PAGE_TEMPLATE.validate(result)


@dataclass(frozen=True)
class Dependencies:
    """Épingles triées et dédoublonnées ; l'absence d'une dépendance ne passe pas en silence."""

    analyses: tuple[Pin, ...]
    themes: tuple[Pin, ...]
    components: tuple[Pin, ...]


def dependency_closure(document: dict[str, Any], components: Components) -> Dependencies:
    """Fermeture d'un dashboard ; une référence de composant non résolue est une erreur."""
    source = dashboard.validate(document)
    analyses: set[Pin] = set()
    referenced: set[Pin] = set()
    themes: set[Pin] = set()
    if "theme" in source:
        themes.add((source["theme"]["theme_id"], source["theme"]["revision"]))
    for section in source["layout"]["sections"]:
        for node in _nodes(section["rows"]):
            kind = node["type"]
            if kind in ("analysis", "kpi"):
                ref = node["reference"]
                analyses.add((ref["analysis_id"], ref["revision"]))
            elif kind == "component":
                ref = node["component"]
                referenced.add((ref["component_id"], ref["revision"]))
                analyses.add(component_analysis(_component(ref, components)))
    return Dependencies(tuple(sorted(analyses)), tuple(sorted(themes)), tuple(sorted(referenced)))
