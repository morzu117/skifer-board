"""Opérations contextuelles sur un résultat déjà autorisé (plan de développement, §4.6).

Chaque opération rend soit un résultat dérivé, soit une indisponibilité qui dit pourquoi et
quelle requête le moteur devrait recevoir à la place (plan 01, P7). Aucune approximation.
Les calculs passent par l'API de calcul d'Arrow, jamais par du SQL (plan 01, P3).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Literal

import pyarrow as pa
import pyarrow.compute as pc

from .contract import Completeness, ContextualResult
from .rules import Additivity, Aggregation, ContractError, MetricRule

Selection = Mapping[str, Sequence[Any]]

_ROWS = "count_all"
_SHARE = "share"
_Function = Literal["sum", "min", "max"]
_REAGGREGATION: dict[Aggregation, _Function] = {
    Aggregation.SUM: "sum",
    Aggregation.COUNT: "sum",
    Aggregation.MIN: "min",
    Aggregation.MAX: "max",
}


class Scope(StrEnum):
    """Périmètre sur lequel porte un chiffre dérivé."""

    SELECTION = "selection"
    LOADED_RESULT = "loaded_result"
    FILTERED_PERIMETER = "filtered_perimeter"


class Reason(StrEnum):
    """Raisons fermées pour lesquelles un calcul ne peut pas être fait localement."""

    COUNT_DISTINCT_NOT_SUMMABLE = "count_distinct_not_summable"
    NON_ADDITIVE = "non_additive"
    NON_ADDITIVE_DIMENSION = "non_additive_dimension"
    COMPONENTS_MISSING = "components_missing"
    INCOMPLETE_RESULT = "incomplete_result"
    SHARE_UNDEFINED = "share_undefined"


@dataclass(frozen=True)
class EngineRequest:
    """Ce qu'il faudrait demander au moteur pour obtenir le chiffre exact."""

    metric: str
    group_by: tuple[str, ...]
    selection: tuple[tuple[str, tuple[Any, ...]], ...]
    scope: Scope


@dataclass(frozen=True)
class Unavailable:
    """Calcul local impossible, avec sa raison et la requête de repli."""

    metric: str
    reason: Reason
    detail: str
    engine_request: EngineRequest


@dataclass(frozen=True)
class Derived:
    """Chiffre calculé localement, avec son périmètre et la règle appliquée.

    ``table`` contient les colonnes de ``group_by`` puis la colonne de la métrique (et
    ``share`` pour une part). ``partial`` est vrai quand le chiffre porte sur un résultat
    chargé incomplet : il ne peut pas être présenté comme un total complet.
    """

    table: pa.Table
    metric: str
    group_by: tuple[str, ...]
    scope: Scope
    rule: str
    partial: bool
    source_evidence_id: str | None
    denominator_scope: Scope | None = None
    notes: tuple[str, ...] = ()


def aggregate(
    result: ContextualResult,
    metric: str,
    *,
    group_by: Sequence[str] = (),
    selection: Selection | None = None,
    scope: Scope | None = None,
) -> Derived | Unavailable:
    """Réagrège ``metric`` au grain ``group_by``, sur la sélection ou le résultat chargé.

    - total de sélection : ``group_by`` vide et ``selection`` ;
    - sous-total : ``group_by`` plus court que le grain du résultat ;
    - total du périmètre filtré : ``scope=Scope.FILTERED_PERIMETER``, servi seulement si le
      résultat chargé est complet.
    """
    rule = result.contract.rule(metric)
    keys = _check_group_by(result, group_by)
    normalized = _check_selection(result, selection)
    effective_scope = _resolve_scope(selection, scope)
    request = EngineRequest(metric, keys, normalized, effective_scope)

    completeness = result.contract.completeness
    if effective_scope is Scope.FILTERED_PERIMETER and completeness is not Completeness.COMPLETE:
        return Unavailable(
            metric,
            Reason.INCOMPLETE_RESULT,
            f"The loaded result is {completeness.value}: the total of the filtered perimeter "
            "must come from the engine.",
            request,
        )

    rows = _apply_selection(result.table, selection)
    partial = effective_scope is Scope.LOADED_RESULT and completeness is not Completeness.COMPLETE
    removed = [name for name in result.contract.dimensions if name not in keys]

    checks: list[Any] = [([], _ROWS)]
    checks += [
        (name, "count_distinct", pc.CountOptions(mode="all"))
        for name in sorted(rule.non_additive_dimensions)
        if name in removed
    ]
    grouped = rows.group_by(list(keys)).aggregate(checks)
    identity = not removed or _max(grouped[_ROWS]) <= 1
    if identity:
        values = rows.group_by(list(keys)).aggregate([(metric, "min")])
        return _derived(result, rule, keys, values, "min", "identity", effective_scope, partial)

    refusal = _refusal(rule, grouped, removed, request)
    if refusal is not None:
        return refusal

    if rule.aggregation is Aggregation.AVG:
        return _weighted_average(result, rule, keys, rows, effective_scope, partial)
    function = _REAGGREGATION[rule.aggregation]
    values = rows.group_by(list(keys)).aggregate([(metric, function)])
    return _derived(result, rule, keys, values, function, function, effective_scope, partial)


def share_of_total(
    result: ContextualResult,
    metric: str,
    *,
    group_by: Sequence[str],
    selection: Selection | None = None,
    denominator: Scope | None = None,
) -> Derived | Unavailable:
    """Part de chaque groupe dans un total dont le périmètre est explicite.

    Le numérateur porte sur la sélection si elle est donnée, sinon sur le résultat chargé.
    Le dénominateur porte par défaut sur le même périmètre ; il peut être élargi au
    résultat chargé ou au périmètre filtré. Les restrictions de sécurité ne sont jamais
    retirées : elles ont été appliquées par le moteur avant que le résultat n'arrive ici.
    """
    rule = result.contract.rule(metric)
    if rule.aggregation not in (Aggregation.SUM, Aggregation.COUNT):
        keys = _check_group_by(result, group_by)
        normalized = _check_selection(result, selection)
        return Unavailable(
            metric,
            Reason.SHARE_UNDEFINED,
            f"A share of total is only defined for sum and count metrics, "
            f"not {rule.aggregation.value}.",
            EngineRequest(metric, keys, normalized, _resolve_scope(selection, None)),
        )
    numerator = aggregate(result, metric, group_by=group_by, selection=selection)
    if isinstance(numerator, Unavailable):
        return numerator
    denominator_scope = denominator or numerator.scope
    total = aggregate(
        result,
        metric,
        selection=selection if denominator_scope is Scope.SELECTION else None,
        scope=denominator_scope,
    )
    if isinstance(total, Unavailable):
        return total

    total_value = total.table[metric][0].as_py()
    notes: tuple[str, ...] = ()
    values = pc.cast(numerator.table[metric], pa.float64())
    shares: pa.Array[Any] | pa.ChunkedArray[Any]
    if total_value is None or total_value == 0:
        shares = pa.nulls(len(values), pa.float64())
        notes = ("zero_or_null_denominator",)
    else:
        shares = pc.divide(values, pa.scalar(float(total_value), pa.float64()))
    return Derived(
        table=numerator.table.append_column(_SHARE, shares),
        metric=metric,
        group_by=numerator.group_by,
        scope=numerator.scope,
        rule="share",
        partial=numerator.partial or total.partial,
        source_evidence_id=result.contract.evidence_id,
        denominator_scope=denominator_scope,
        notes=notes,
    )


def _check_group_by(result: ContextualResult, group_by: Sequence[str]) -> tuple[str, ...]:
    keys = tuple(group_by)
    unknown = [name for name in keys if name not in result.contract.dimensions]
    if unknown:
        raise ContractError(f"Cannot group by non-dimension columns: {unknown}.")
    if len(set(keys)) != len(keys):
        raise ContractError("group_by must not repeat a dimension.")
    return keys


def _check_selection(
    result: ContextualResult, selection: Selection | None
) -> tuple[tuple[str, tuple[Any, ...]], ...]:
    if selection is None:
        return ()
    unknown = [name for name in selection if name not in result.contract.dimensions]
    if unknown:
        raise ContractError(f"A selection can only target dimensions, not {unknown}.")
    return tuple((name, tuple(selection[name])) for name in sorted(selection))


def _resolve_scope(selection: Selection | None, scope: Scope | None) -> Scope:
    if selection is not None:
        if scope not in (None, Scope.SELECTION):
            raise ContractError("A calculation on a selection is scoped to the selection.")
        return Scope.SELECTION
    if scope is Scope.SELECTION:
        raise ContractError("Scope.SELECTION requires a selection.")
    return scope or Scope.LOADED_RESULT


def _apply_selection(table: pa.Table, selection: Selection | None) -> pa.Table:
    if not selection:
        return table
    mask: Any = None
    for name, values in selection.items():
        column = table[name]
        condition = pc.is_in(column, value_set=pa.array(list(values), type=column.type))
        mask = condition if mask is None else pc.and_(mask, condition)
    return table.filter(mask)


def _max(column: pa.ChunkedArray[Any]) -> int:
    value = pc.max(column).as_py()
    return 0 if value is None else int(value)


def _refusal(
    rule: MetricRule, grouped: pa.Table, removed: list[str], request: EngineRequest
) -> Unavailable | None:
    """Règles du §4.6. Le type d'agrégation prime sur l'additivité déclarée (plan 01, P5)."""
    if rule.aggregation is Aggregation.COUNT_DISTINCT:
        return Unavailable(
            rule.name,
            Reason.COUNT_DISTINCT_NOT_SUMMABLE,
            "Distinct counts of several groups cannot be added: the same member may appear "
            "in several groups.",
            request,
        )
    if rule.additivity is Additivity.NON_ADDITIVE:
        return Unavailable(
            rule.name,
            Reason.NON_ADDITIVE,
            f"The metric is declared non additive: it cannot be re-aggregated across {removed}.",
            request,
        )
    spanning = [
        name
        for name in sorted(rule.non_additive_dimensions)
        if name in removed and _max(grouped[f"{name}_count_distinct"]) > 1
    ]
    if spanning:
        return Unavailable(
            rule.name,
            Reason.NON_ADDITIVE_DIMENSION,
            f"The metric is not additive along {spanning}, and the requested groups span "
            "several of their values.",
            request,
        )
    if rule.aggregation is Aggregation.AVG and rule.components is None:
        return Unavailable(
            rule.name,
            Reason.COMPONENTS_MISSING,
            "An average cannot be averaged again: its sum and count components are needed.",
            request,
        )
    return None


def _weighted_average(
    result: ContextualResult,
    rule: MetricRule,
    keys: tuple[str, ...],
    rows: pa.Table,
    scope: Scope,
    partial: bool,
) -> Derived:
    components = rule.components
    assert components is not None  # guaranteed by _refusal
    sums = rows.group_by(list(keys)).aggregate(
        [(components.sum_column, "sum"), (components.count_column, "sum")]
    )
    numerator = pc.cast(sums[f"{components.sum_column}_sum"], pa.float64())
    count = pc.cast(sums[f"{components.count_column}_sum"], pa.float64())
    safe_count = pc.if_else(pc.equal(count, pa.scalar(0.0)), pa.scalar(None, pa.float64()), count)
    averages = pc.divide(numerator, safe_count)
    table = sums.select(list(keys)).append_column(rule.name, averages)
    return _finish(result, rule.name, keys, table, scope, "weighted_average", partial)


def _derived(
    result: ContextualResult,
    rule: MetricRule,
    keys: tuple[str, ...],
    values: pa.Table,
    function: str,
    applied: str,
    scope: Scope,
    partial: bool,
) -> Derived:
    column = f"{rule.name}_{function}"
    table = values.select([*keys, column]).rename_columns([*keys, rule.name])
    return _finish(result, rule.name, keys, table, scope, applied, partial)


def _finish(
    result: ContextualResult,
    metric: str,
    keys: tuple[str, ...],
    table: pa.Table,
    scope: Scope,
    applied: str,
    partial: bool,
) -> Derived:
    if keys:
        table = table.sort_by([(name, "ascending") for name in keys])
    return Derived(
        table=table,
        metric=metric,
        group_by=keys,
        scope=scope,
        rule=applied,
        partial=partial,
        source_evidence_id=result.contract.evidence_id,
    )
