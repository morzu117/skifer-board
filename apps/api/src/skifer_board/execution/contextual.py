"""Contrat figé et calculs contextuels sur l'aperçu Arrow autorisé."""

from __future__ import annotations

import math
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import pyarrow as pa
import pyarrow.compute as pc

from ..contextual import (
    Additivity,
    Aggregation,
    Completeness,
    ContextualResult,
    ContractError,
    Derived,
    GrainError,
    MetricRule,
    ResultContract,
    Scope,
    Unavailable,
    aggregate,
    share_of_total,
)
from ..spaces.web import Invalid
from .semantic import SemanticRequest


def figer(request: SemanticRequest, catalog: dict[str, Any]) -> dict[str, Any]:
    """Copie les seules règles utiles, indépendamment des futures versions du catalogue."""
    model = next(item for item in catalog["models"] if item["name"] == request.model)
    metrics = {item["name"]: item for item in model["metrics"]}
    return {
        "dimensions": list(request.dimensions),
        "metrics": [
            {
                "name": name,
                "aggregation": metrics[name]["aggregation"],
                "additivity": metrics[name]["additivity"],
            }
            for name in request.metrics
        ],
    }


def contrat(snapshot: dict[str, Any], truncated: bool) -> dict[str, Any]:
    return {**snapshot, "completeness": "truncated" if truncated else "complete"}


def _nombre(value: Any) -> Any:
    if isinstance(value, Decimal):
        return {"type": "decimal", "value": format(value, "f")}
    if type(value) is float and not math.isfinite(value):
        raise OverflowError("Résultat non fini")
    if type(value) is int and abs(value) > 2**53:
        return {"type": "integer", "value": str(value)}
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if value is not None and type(value) not in (str, int, float, bool):
        raise TypeError("Type de résultat non pris en charge")
    return value


def calculer(
    data: bytes, snapshot: dict[str, Any] | None, truncated: bool, evidence_id: str, body: Any
) -> dict[str, Any]:
    """Calcule localement ou rend une indisponibilité fermée."""
    if not isinstance(body, dict) or set(body) != {
        "operation",
        "metric",
        "group_by",
        "selection",
        "scope",
        "denominator",
    }:
        raise Invalid("body")
    operation, metric, groups = body["operation"], body["metric"], body["group_by"]
    selection, scope, denominator = body["selection"], body["scope"], body["denominator"]
    if operation not in ("aggregate", "share") or not isinstance(metric, str):
        raise Invalid("body")
    if (
        not isinstance(groups, list)
        or len(groups) > 32
        or any(not isinstance(x, str) for x in groups)
        or len(set(groups)) != len(groups)
    ):
        raise Invalid("group_by")
    if selection is not None:
        if not isinstance(selection, dict) or not selection or len(selection) > 32:
            raise Invalid("selection")
        for key, values in selection.items():
            if (
                not isinstance(key, str)
                or not isinstance(values, list)
                or not values
                or len(values) > 100
            ):
                raise Invalid("selection")
            if any(
                type(v) not in (str, int, float, bool)
                or (type(v) is float and not math.isfinite(v))
                or (type(v) is str and (len(v) > 1024 or "\x00" in v))
                for v in values
            ):
                raise Invalid("selection")
    if scope not in (None, "filtered_perimeter") or (selection is not None and scope is not None):
        raise Invalid("scope")
    if operation == "share" and scope is not None:
        raise Invalid("scope")
    if operation == "aggregate" and denominator is not None:
        raise Invalid("denominator")
    if operation == "share" and denominator not in (
        "selection",
        "loaded_result",
        "filtered_perimeter",
    ):
        raise Invalid("denominator")
    if denominator == "selection" and selection is None:
        raise Invalid("denominator")
    if operation == "share" and (metric == "share" or "share" in groups):
        raise Invalid("group_by")
    if snapshot is None:
        return {
            "status": "unavailable",
            "reason": "contract_unavailable",
            "engine_request": {
                "metric": metric,
                "group_by": groups,
                "selection": selection,
                "scope": scope or ("selection" if selection is not None else "loaded_result"),
            },
        }
    if metric not in [m["name"] for m in snapshot["metrics"]]:
        raise Invalid("metric")
    dimensions = snapshot["dimensions"]
    if not set(groups).issubset(dimensions):
        raise Invalid("group_by")
    if selection is not None and not set(selection).issubset(dimensions):
        raise Invalid("selection")

    def unavailable(reason: str) -> dict[str, Any]:
        return {
            "status": "unavailable",
            "reason": reason,
            "engine_request": {
                "metric": metric,
                "group_by": groups,
                "selection": selection,
                "scope": scope or ("selection" if selection is not None else "loaded_result"),
            },
        }

    try:
        table = pa.ipc.open_stream(data).read_all()
    except (pa.ArrowException, ValueError, TypeError):
        return unavailable("result_unreadable")
    if any(table.schema.get_field_index(name) < 0 for name in dimensions):
        return unavailable("result_unreadable")
    try:
        prepared_selection: dict[str, list[Any]] | None = None
        if selection is not None:
            prepared_selection = {}
            for key, values in selection.items():
                kind = table.schema.field(key).type
                prepared_selection[key] = []
                for value in values:
                    if pa.types.is_boolean(kind):
                        valid = type(value) is bool
                    elif pa.types.is_integer(kind):
                        valid = type(value) is int
                    elif pa.types.is_floating(kind):
                        valid = type(value) in (int, float)
                    elif pa.types.is_string(kind) or pa.types.is_large_string(kind):
                        valid = type(value) is str
                    elif pa.types.is_date(kind):
                        valid = type(value) is str
                        if valid:
                            value = date.fromisoformat(value)
                    elif pa.types.is_timestamp(kind):
                        valid = type(value) is str
                        if valid:
                            value = datetime.fromisoformat(value)
                    elif pa.types.is_decimal(kind):
                        valid = type(value) is str
                        if valid:
                            value = Decimal(value)
                    else:
                        valid = False
                    if not valid:
                        raise Invalid("selection")
                    prepared_selection[key].append(value)
                pa.array(prepared_selection[key], type=kind)
    except (pa.ArrowException, ValueError, TypeError, OverflowError, InvalidOperation):
        raise Invalid("selection") from None
    try:
        if truncated and (scope == "filtered_perimeter" or denominator == "filtered_perimeter"):
            return {
                "status": "unavailable",
                "reason": "incomplete_result",
                "engine_request": {
                    "metric": metric,
                    "group_by": [] if denominator == "filtered_perimeter" else groups,
                    "selection": None if denominator == "filtered_perimeter" else selection,
                    "scope": "filtered_perimeter",
                },
            }
        selected = next(m for m in snapshot["metrics"] if m["name"] == metric)
        if selected["aggregation"] is None:
            return {
                "status": "unavailable",
                "reason": "unknown_aggregation",
                "engine_request": {
                    "metric": metric,
                    "group_by": groups,
                    "selection": selection,
                    "scope": scope or ("selection" if selection is not None else "loaded_result"),
                },
            }
        rules = tuple(
            MetricRule(
                name=m["name"],
                aggregation=Aggregation(m["aggregation"]),
                additivity=Additivity.NON_ADDITIVE
                if m["additivity"] == "semi_additive"
                else Additivity(m["additivity"]),
            )
            for m in snapshot["metrics"]
            if m["aggregation"] is not None
        )
        contract = ResultContract(
            tuple(dimensions),
            rules,
            Completeness.TRUNCATED if truncated else Completeness.COMPLETE,
            evidence_id,
        )
        widened: set[str] = set()
        decimal_scales: dict[str, int] = {}
        for rule in rules:
            index = table.schema.get_field_index(rule.name)
            if index >= 0 and rule.aggregation in (Aggregation.SUM, Aggregation.COUNT):
                kind = table.schema.field(index).type
                if pa.types.is_integer(kind):
                    table = table.set_column(
                        index, rule.name, table.column(index).cast(pa.decimal128(38, 0))
                    )
                    widened.add(rule.name)
                elif pa.types.is_decimal128(kind):
                    decimal_scales[rule.name] = kind.scale
                    table = table.set_column(
                        index, rule.name, table.column(index).cast(pa.decimal256(76, kind.scale))
                    )
        result = ContextualResult(table, contract)
        selected_rows = table
        if prepared_selection is not None:
            mask: Any = None
            for key, values in prepared_selection.items():
                condition = pc.is_in(table[key], value_set=pa.array(values, type=table[key].type))
                mask = condition if mask is None else pc.and_(mask, condition)
            selected_rows = table.filter(mask)
            if selected_rows.num_rows == 0:
                return unavailable("empty_selection")
        if operation == "aggregate":
            output = aggregate(
                result,
                metric,
                group_by=groups,
                selection=prepared_selection,
                scope=None if scope is None else Scope(scope),
            )
        else:
            output = share_of_total(
                result,
                metric,
                group_by=groups,
                selection=prepared_selection,
                denominator=Scope(denominator),
            )
    except GrainError:
        return unavailable("grain_not_unique")
    except (
        ContractError,
        pa.ArrowException,
        ValueError,
        TypeError,
        OverflowError,
        InvalidOperation,
    ):
        return unavailable("result_unreadable")
    if isinstance(output, Unavailable):
        req = output.engine_request
        return {
            "status": "unavailable",
            "reason": output.reason.value,
            "engine_request": {
                "metric": req.metric,
                "group_by": list(req.group_by),
                "selection": {
                    key: [_nombre(value) for value in values] for key, values in req.selection
                }
                if selection is not None
                else None,
                "scope": req.scope.value,
            },
        }
    assert isinstance(output, Derived)
    try:
        rows = []
        for row in output.table.to_pylist():
            for key, scale in decimal_scales.items():
                if key in row and row[key] is not None:
                    pa.array([row[key]], type=pa.decimal128(38, scale))
            rows.append(
                {
                    key: _nombre(int(value) if key in widened and value is not None else value)
                    for key, value in row.items()
                }
            )
    except (OverflowError, pa.ArrowException, TypeError, ValueError) as error:
        return {
            "status": "unavailable",
            "reason": "numeric_overflow"
            if isinstance(error, (OverflowError, pa.ArrowException))
            else "unsupported_value",
            "engine_request": {
                "metric": metric,
                "group_by": groups,
                "selection": selection,
                "scope": scope or ("selection" if selection is not None else "loaded_result"),
            },
        }
    return {
        "status": "derived",
        "rows": rows,
        "row_count": selected_rows.num_rows,
        "scope": "loaded_result" if truncated else output.scope.value,
        "rule": output.rule,
        "partial": truncated or output.partial,
        "source_evidence_id": output.source_evidence_id,
        "denominator": None if output.denominator_scope is None else output.denominator_scope.value,
        "notes": list(output.notes),
    }
