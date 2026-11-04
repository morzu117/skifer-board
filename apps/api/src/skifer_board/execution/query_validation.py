"""Validation déclarative des champs et filtres d'exploration."""

from __future__ import annotations

import math
import unicodedata
from typing import Any

from ..spaces.web import Invalid
from .semantic import SemanticRequest

OPERATEURS = {
    "string": frozenset({"eq", "ne", "in"}),
    "number": frozenset({"eq", "ne", "gt", "gte", "lt", "lte", "in", "between"}),
    "date": frozenset(),
    "timestamp": frozenset(),
    "boolean": frozenset({"eq", "ne"}),
    "unknown": frozenset({"eq", "ne"}),
}


def _scalaire(value: Any) -> bool:
    return (
        type(value) in (str, int, float, bool)
        and (type(value) is not int or -(2**63) <= value <= 2**63 - 1)
        and (type(value) is not float or math.isfinite(value))
        and (
            type(value) is not str
            or (
                len(value) <= 1024
                and all(
                    unicodedata.category(char)[0] in {"L", "N"} or char in " _.,:/@&+()"
                    for char in value
                )
            )
        )
    )


def filtre(column: Any, operator: Any, value: Any) -> dict[str, Any]:
    """Vérifie la forme et rend la liste canonique."""
    if not isinstance(operator, str) or operator not in {
        "eq",
        "ne",
        "gt",
        "gte",
        "lt",
        "lte",
        "in",
        "between",
    }:
        raise Invalid("filters")
    if operator in {"in", "between"}:
        if (
            not isinstance(value, list)
            or not value
            or len(value) > 100
            or (operator == "between" and len(value) != 2)
        ):
            raise Invalid("filters")
        if any(
            not _scalaire(item) or (operator == "in" and type(item) is not type(value[0]))
            for item in value
        ):
            raise Invalid("filters")
        if operator == "in":
            if len(set(value)) != len(value):
                raise Invalid("filters")
            value = sorted(value)
    elif not _scalaire(value):
        raise Invalid("filters")
    return {"column": column, "operator": operator, "value": value}


def _valeur(value: Any, kind: str) -> Any:
    if kind == "number":
        if type(value) not in (int, float):
            raise Invalid("filters")
    elif kind == "boolean":
        if type(value) is not bool:
            raise Invalid("filters")
    elif kind == "string" and not isinstance(value, str):
        raise Invalid("filters")
    return value


def valider(request: SemanticRequest, catalog: dict[str, Any]) -> SemanticRequest:
    """Refuse les noms et valeurs hors du catalogue avant tout connecteur."""
    model = next((item for item in catalog["models"] if item["name"] == request.model), None)
    if model is None:
        raise Invalid("model")
    metrics = {item["name"] for item in model["metrics"]}
    dimensions = {item["name"]: item["type"] for item in model["dimensions"]}
    if not set(request.metrics).issubset(metrics):
        raise Invalid("metrics")
    if not set(request.dimensions).issubset(dimensions):
        raise Invalid("dimensions")
    expanded: list[dict[str, Any]] = []
    for item in request.filters:
        column, operator, value = item["column"], item["operator"], item["value"]
        if column not in dimensions or operator not in OPERATEURS[dimensions[column]]:
            raise Invalid("filters")
        values = value if operator in {"in", "between"} else [value]
        parsed = [_valeur(part, dimensions[column]) for part in values]
        if operator == "between":
            if parsed[0] > parsed[1]:
                raise Invalid("filters")
            expanded.extend(
                {"column": column, "operator": op, "value": bound}
                for op, bound in zip(("gte", "lte"), value, strict=True)
            )
        else:
            expanded.append(dict(item))
    return SemanticRequest(request.model, request.metrics, request.dimensions, tuple(expanded))
