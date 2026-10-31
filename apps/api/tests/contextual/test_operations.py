from decimal import Decimal
from typing import Any

import pyarrow as pa
import pytest
from skifer_board.contextual import (
    Additivity,
    Aggregation,
    AvgComponents,
    Completeness,
    ContextualResult,
    ContractError,
    Derived,
    EngineRequest,
    MetricRule,
    Reason,
    ResultContract,
    Scope,
    Unavailable,
    aggregate,
    share_of_total,
)

RULES = (
    MetricRule("revenue", Aggregation.SUM),
    MetricRule("orders", Aggregation.COUNT),
    MetricRule("customers", Aggregation.COUNT_DISTINCT),
    MetricRule(
        "stock",
        Aggregation.SUM,
        Additivity.SEMI_ADDITIVE,
        non_additive_dimensions=frozenset({"month"}),
    ),
    MetricRule("margin_rate", Aggregation.SUM, Additivity.NON_ADDITIVE),
    MetricRule("basket", Aggregation.AVG, components=AvgComponents("b_sum", "b_count")),
    MetricRule("basket_plain", Aggregation.AVG),
    MetricRule("low", Aggregation.MIN),
    MetricRule("high", Aggregation.MAX),
)


def sales(completeness: Completeness = Completeness.COMPLETE) -> ContextualResult:
    money = pa.decimal128(10, 2)
    table = pa.table(
        {
            "region": ["n", "n", "s", "s", "e"],
            "month": ["01", "02", "01", "02", "01"],
            "revenue": pa.array(
                [Decimal("10.10"), Decimal("20.20"), Decimal("30.30"), Decimal("40.40"), None],
                money,
            ),
            "orders": [1, 2, 3, 4, 5],
            "customers": [1, 2, 3, 4, 5],
            "stock": [100, 110, 200, 210, 300],
            "margin_rate": [0.1, 0.2, 0.3, 0.4, 0.5],
            "basket": [10.0, 10.0, 30.0, 30.0, 5.0],
            "b_sum": [10.0, 20.0, 90.0, 120.0, 5.0],
            "b_count": [1, 2, 3, 4, 1],
            "basket_plain": [10.0, 10.0, 30.0, 30.0, 5.0],
            "low": [5, 4, 3, 2, 1],
            "high": [5, 6, 7, 8, 9],
        }
    )
    return ContextualResult(
        table, ResultContract(("region", "month"), RULES, completeness, "ev-42")
    )


def derived(outcome: Derived | Unavailable) -> Derived:
    assert isinstance(outcome, Derived), outcome
    return outcome


def unavailable(outcome: Derived | Unavailable) -> Unavailable:
    assert isinstance(outcome, Unavailable), outcome
    return outcome


def column(outcome: Derived | Unavailable, name: str) -> list[Any]:
    return derived(outcome).table[name].to_pylist()


# --- Sommes compatibles ---------------------------------------------------------------


def test_sums_a_compatible_selection_exactly_without_a_query() -> None:
    outcome = derived(aggregate(sales(), "revenue", selection={"region": ["n", "s"]}))
    assert outcome.table["revenue"].to_pylist() == [Decimal("101.00")]
    assert pa.types.is_decimal(outcome.table.schema.field("revenue").type)
    assert (outcome.scope, outcome.rule, outcome.partial) == (Scope.SELECTION, "sum", False)
    assert outcome.source_evidence_id == "ev-42"
    assert outcome.group_by == ()


def test_subtotals_by_region_keep_sql_null_semantics() -> None:
    outcome = aggregate(sales(), "revenue", group_by=["region"])
    assert column(outcome, "region") == ["e", "n", "s"]
    assert column(outcome, "revenue") == [None, Decimal("30.30"), Decimal("70.70")]


def test_counts_are_additive() -> None:
    outcome = aggregate(sales(), "orders", group_by=["month"])
    assert column(outcome, "orders") == [9, 6]
    assert derived(outcome).rule == "sum"


def test_min_and_max_reaggregate_by_min_and_max() -> None:
    assert column(aggregate(sales(), "low", group_by=["region"]), "low") == [1, 4, 2]
    assert column(aggregate(sales(), "high", group_by=["region"]), "high") == [9, 6, 8]
    assert derived(aggregate(sales(), "high", group_by=["region"])).rule == "max"


def test_an_empty_selection_has_a_null_total() -> None:
    outcome = derived(aggregate(sales(), "revenue", selection={"region": []}))
    assert outcome.table["revenue"].to_pylist() == [None]
    assert outcome.scope is Scope.SELECTION


# --- Identité : rien n'est regroupé, toute métrique passe (P6) --------------------------


def test_regrouping_nothing_is_always_allowed() -> None:
    outcome = derived(aggregate(sales(), "customers", group_by=["region", "month"]))
    assert outcome.rule == "identity"
    assert outcome.table["region"].to_pylist() == ["e", "n", "n", "s", "s"]
    assert outcome.table["customers"].to_pylist() == [5, 1, 2, 3, 4]


def test_a_single_selected_row_is_an_identity_even_for_a_non_additive_metric() -> None:
    outcome = derived(
        aggregate(sales(), "margin_rate", selection={"region": ["s"], "month": ["02"]})
    )
    assert (outcome.rule, outcome.table["margin_rate"].to_pylist()) == ("identity", [0.4])


def test_identity_label_is_kept_for_a_min_metric() -> None:
    outcome = derived(aggregate(sales(), "low", group_by=["month", "region"]))
    assert outcome.rule == "identity"


# --- Refus et retour au moteur ----------------------------------------------------------


def test_refuses_to_add_distinct_counts_and_says_what_to_ask_the_engine() -> None:
    outcome = unavailable(aggregate(sales(), "customers", group_by=["region"]))
    assert outcome.reason is Reason.COUNT_DISTINCT_NOT_SUMMABLE
    assert outcome.engine_request == EngineRequest(
        "customers", ("region",), (), Scope.LOADED_RESULT
    )


def test_distinct_count_wins_over_a_declared_additivity() -> None:
    # skifer defaults additivity to "additive": the aggregation type must prevail (P5).
    assert RULES[2].additivity is Additivity.ADDITIVE
    outcome = unavailable(aggregate(sales(), "customers", selection={"region": ["n"]}))
    assert outcome.engine_request.selection == (("region", ("n",)),)
    assert outcome.engine_request.scope is Scope.SELECTION


def test_refuses_to_sum_a_stock_over_time() -> None:
    outcome = unavailable(aggregate(sales(), "stock", group_by=["region"]))
    assert outcome.reason is Reason.NON_ADDITIVE_DIMENSION
    assert "['month']" in outcome.detail


def test_sums_a_stock_across_regions_within_a_month() -> None:
    assert column(aggregate(sales(), "stock", group_by=["month"]), "stock") == [600, 320]


def test_sums_a_stock_over_a_selection_that_spans_a_single_month() -> None:
    outcome = aggregate(sales(), "stock", selection={"month": ["01"]})
    assert column(outcome, "stock") == [600]


def test_refuses_a_non_additive_metric() -> None:
    outcome = unavailable(aggregate(sales(), "margin_rate", group_by=["region"]))
    assert outcome.reason is Reason.NON_ADDITIVE


def test_refuses_to_average_averages() -> None:
    outcome = unavailable(aggregate(sales(), "basket_plain", group_by=["region"]))
    assert outcome.reason is Reason.COMPONENTS_MISSING


def test_recomputes_a_weighted_average_from_its_components() -> None:
    selection = {"region": ["n", "s"]}
    outcome = derived(aggregate(sales(), "basket", selection=selection))
    # (10 + 20 + 90 + 120) / (1 + 2 + 3 + 4) = 24, not the mean of the four averages (20).
    assert outcome.table["basket"].to_pylist() == [24.0]
    assert outcome.rule == "weighted_average"
    by_region = aggregate(sales(), "basket", group_by=["region"])
    assert column(by_region, "basket") == [5.0, 10.0, 30.0]


def test_a_weighted_average_over_a_zero_count_is_null() -> None:
    table = (
        pa.table({"region": ["n", "n"], "month": ["01", "02"], "basket": [0.0, 0.0]})
        .append_column("b_sum", pa.array([0.0, 0.0]))
        .append_column("b_count", pa.array([0, 0]))
    )
    rule = MetricRule("basket", Aggregation.AVG, components=AvgComponents("b_sum", "b_count"))
    result = ContextualResult(
        table, ResultContract(("region", "month"), (rule,), Completeness.COMPLETE)
    )
    assert column(aggregate(result, "basket"), "basket") == [None]


# --- Complétude et périmètres -----------------------------------------------------------


def test_a_total_of_a_truncated_result_is_labelled_partial() -> None:
    outcome = derived(aggregate(sales(Completeness.TRUNCATED), "revenue"))
    assert (outcome.scope, outcome.partial) == (Scope.LOADED_RESULT, True)


def test_a_selection_total_of_a_truncated_result_is_exact_for_the_selection() -> None:
    outcome = derived(aggregate(sales(Completeness.TOP_N), "revenue", selection={"region": ["n"]}))
    assert outcome.partial is False


def test_the_filtered_perimeter_total_of_an_incomplete_result_comes_from_the_engine() -> None:
    outcome = unavailable(
        aggregate(sales(Completeness.TOP_N), "revenue", scope=Scope.FILTERED_PERIMETER)
    )
    assert outcome.reason is Reason.INCOMPLETE_RESULT
    assert "top_n" in outcome.detail
    assert outcome.engine_request.scope is Scope.FILTERED_PERIMETER


def test_the_filtered_perimeter_total_of_a_complete_result_is_served_locally() -> None:
    outcome = derived(aggregate(sales(), "revenue", scope=Scope.FILTERED_PERIMETER))
    assert (outcome.scope, outcome.partial) == (Scope.FILTERED_PERIMETER, False)
    assert outcome.table["revenue"].to_pylist() == [Decimal("101.00")]


# --- Parts du total ---------------------------------------------------------------------


def test_share_of_the_loaded_result_by_region() -> None:
    outcome = derived(share_of_total(sales(), "revenue", group_by=["region"]))
    shares = outcome.table["share"].to_pylist()
    assert shares[0] is None
    assert shares[1:] == pytest.approx([0.3, 0.7])
    assert (outcome.rule, outcome.denominator_scope) == ("share", Scope.LOADED_RESULT)


def test_share_denominator_is_explicit() -> None:
    selection = {"region": ["n"]}
    within = derived(share_of_total(sales(), "revenue", group_by=["region"], selection=selection))
    assert within.table["share"].to_pylist() == [1.0]
    assert within.denominator_scope is Scope.SELECTION
    of_loaded = derived(
        share_of_total(
            sales(),
            "revenue",
            group_by=["region"],
            selection=selection,
            denominator=Scope.LOADED_RESULT,
        )
    )
    assert of_loaded.table["share"].to_pylist() == pytest.approx([0.3])


def test_share_of_an_incomplete_perimeter_comes_from_the_engine() -> None:
    outcome = unavailable(
        share_of_total(
            sales(Completeness.TRUNCATED),
            "revenue",
            group_by=["region"],
            denominator=Scope.FILTERED_PERIMETER,
        )
    )
    assert outcome.reason is Reason.INCOMPLETE_RESULT


def test_share_of_a_truncated_loaded_result_is_partial() -> None:
    outcome = derived(share_of_total(sales(Completeness.TRUNCATED), "orders", group_by=["month"]))
    assert outcome.partial is True
    assert outcome.table["share"].to_pylist() == pytest.approx([0.6, 0.4])


def test_share_is_undefined_for_an_average() -> None:
    outcome = unavailable(share_of_total(sales(), "basket", group_by=["region"]))
    assert outcome.reason is Reason.SHARE_UNDEFINED
    assert outcome.engine_request == EngineRequest("basket", ("region",), (), Scope.LOADED_RESULT)


def test_share_passes_a_numerator_refusal_through() -> None:
    outcome = unavailable(share_of_total(sales(), "stock", group_by=["region"]))
    assert outcome.reason is Reason.NON_ADDITIVE_DIMENSION


def test_share_passes_a_denominator_refusal_through() -> None:
    outcome = unavailable(share_of_total(sales(), "stock", group_by=["region", "month"]))
    assert outcome.reason is Reason.NON_ADDITIVE_DIMENSION
    assert outcome.engine_request.group_by == ()


@pytest.mark.parametrize("values", [[0, 0], [None, None]])
def test_share_over_a_zero_or_null_denominator_is_null(values: list[int | None]) -> None:
    table = pa.table({"region": ["n", "s"], "orders": pa.array(values, pa.int64())})
    result = ContextualResult(
        table, ResultContract(("region",), (RULES[1],), Completeness.COMPLETE)
    )
    outcome = derived(share_of_total(result, "orders", group_by=["region"]))
    assert outcome.table["share"].to_pylist() == [None, None]
    assert outcome.notes == ("zero_or_null_denominator",)


# --- Erreurs d'appel ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"group_by": ["revenue"]}, "non-dimension columns"),
        ({"group_by": ["region", "region"]}, "must not repeat"),
        ({"selection": {"revenue": [1]}}, "only target dimensions"),
        (
            {"selection": {"region": ["n"]}, "scope": Scope.LOADED_RESULT},
            "scoped to the selection",
        ),
        ({"scope": Scope.SELECTION}, "requires a selection"),
    ],
)
def test_rejects_invalid_calls(kwargs: dict[str, Any], message: str) -> None:
    with pytest.raises(ContractError, match=message):
        aggregate(sales(), "revenue", **kwargs)


def test_rejects_an_unknown_metric() -> None:
    with pytest.raises(ContractError, match="Unknown metric"):
        aggregate(sales(), "profit")


def test_share_validates_its_arguments_even_when_undefined() -> None:
    with pytest.raises(ContractError, match="non-dimension columns"):
        share_of_total(sales(), "basket", group_by=["basket"])
