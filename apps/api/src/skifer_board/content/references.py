"""Références d'une analyse au catalogue déclaré et règles des calculs contextuels (plan 18, A6).

Une analyse sauvegardée est une requête que l'Explorateur aurait acceptée : ses noms et ses
filtres sont validés contre le catalogue par le code de la soumission (`valider`, E3 du plan
17). Un calcul contextuel ne porte que sur une métrique de la requête ; sa réagrégation est
refusée à la sauvegarde quand le catalogue suffit à dire que la route 17.3 ne pourrait pas la
servir, avec la raison que cette route rendrait. À la réouverture, seules les références sont
revérifiées : un champ disparu rend l'analyse `unresolved_reference`, jamais exécutée par
approximation. Rien ici ne produit ni ne lit de SQL.
"""

from __future__ import annotations

from collections.abc import Collection
from typing import Any

from ..execution.query_validation import valider
from ..execution.semantic import SemanticRequest
from ..spaces.web import Invalid
from .analysis import Document
from .errors import INVALID_ANALYSIS, ContentError, Violation

# Références disparues ou refusées par le catalogue : elles bloquent aussi la réouverture.
REFERENCE_RULES = frozenset(
    {
        "unknown_model",
        "unknown_metric",
        "unknown_dimension",
        "unknown_connection",
        "filter_not_allowed",
    }
)
# Réagrégations que la route 17.3 refuserait, avec ses propres raisons (`contextual.Reason`),
# plus l'agrégation que le catalogue ne déclare pas.
CONTEXTUAL_RULES = frozenset(
    {
        "unknown_aggregation",
        "share_undefined",
        "count_distinct_not_summable",
        "non_additive",
        "components_missing",
    }
)
# Règles des violations rendues à la sauvegarde en plus de celles du format (`RULES`).
CATALOG_RULES = REFERENCE_RULES | CONTEXTUAL_RULES

_NON_ADDITIVE = frozenset({"non_additive", "semi_additive"})


def refusal(violations: Collection[Violation]) -> ContentError:
    """Refus `invalid_analysis` : violations triées, première règle comme raison."""
    ordered = tuple(sorted(set(violations), key=lambda item: (item.path, item.rule)))
    return ContentError(INVALID_ANALYSIS, ordered[0].rule, ordered)


def _model(catalog: dict[str, Any], name: str) -> dict[str, Any] | None:
    return next((item for item in catalog["models"] if item["name"] == name), None)


def reference_violations(
    document: Document, catalog: dict[str, Any], connections: Collection[str]
) -> list[Violation]:
    """Noms de la requête absents du catalogue ou de la liste des connexions de l'espace."""
    query = document["query"]
    violations: list[Violation] = []
    if query["connection"] not in connections:
        violations.append(Violation("/query/connection", "unknown_connection"))
    model = _model(catalog, query["model"])
    if model is None:
        violations.append(Violation("/query/model", "unknown_model"))
        return violations
    metrics = {item["name"] for item in model["metrics"]}
    dimensions = {item["name"] for item in model["dimensions"]}
    violations += [
        Violation(f"/query/metrics/{index}", "unknown_metric")
        for index, name in enumerate(query["metrics"])
        if name not in metrics
    ]
    violations += [
        Violation(f"/query/dimensions/{index}", "unknown_dimension")
        for index, name in enumerate(query["dimensions"])
        if name not in dimensions
    ]
    for index, item in enumerate(query["filters"]):
        try:
            valider(SemanticRequest(query["model"], (), (), (item,)), catalog)
        except Invalid:
            violations.append(Violation(f"/query/filters/{index}", "filter_not_allowed"))
    return violations


def contextual_violations(document: Document, catalog: dict[str, Any]) -> list[Violation]:
    """Réagrégations connues pour être refusées par la route 17.3.

    Seules les métriques résolues sont examinées (les autres sont déjà des références
    disparues). Réagréger retire des dimensions de la requête : `aggregate` retire celles que
    son `group_by` ne garde pas, `share` retire toutes les dimensions pour son dénominateur.
    Sans dimension retirée, la valeur du moteur est reprise telle quelle et rien n'est refusé.
    L'ordre des raisons est celui de la route : somme impossible d'un compte distinct, métrique
    non additive (la semi-additivité y est traitée comme telle), moyenne sans composantes.
    """
    query = document["query"]
    model = _model(catalog, query["model"])
    if model is None:
        return []
    known = {item["name"]: item for item in model["metrics"]}
    dimensions = set(query["dimensions"])
    violations: list[Violation] = []
    for index, operation in enumerate(document["contextual"]):
        metric = known.get(operation["metric"])
        if metric is None:
            continue
        path = f"/contextual/{index}/metric"
        aggregation, additivity = metric["aggregation"], metric["additivity"]
        if aggregation is None:
            violations.append(Violation(path, "unknown_aggregation"))
            continue
        if operation["operation"] == "share":
            removed = dimensions
            if aggregation not in ("sum", "count"):
                violations.append(Violation(path, "share_undefined"))
                continue
        else:
            removed = dimensions - set(operation["group_by"])
        if not removed:
            continue
        if aggregation == "count_distinct":
            violations.append(Violation(path, "count_distinct_not_summable"))
        elif additivity in _NON_ADDITIVE:
            violations.append(Violation(path, "non_additive"))
        elif aggregation == "avg":
            violations.append(Violation(path, "components_missing"))
    return violations
