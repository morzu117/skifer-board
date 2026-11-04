from typing import Any

import pytest
from skifer_board.contextual import (
    Additivity,
    Aggregation,
    AvgComponents,
    ContractError,
    MetricRule,
)


def test_reads_a_minimal_skifer_metric_with_skifer_defaults() -> None:
    rule = MetricRule.from_skifer_metric({"name": "revenue", "type": "SUM", "sql": "amount"})
    assert rule == MetricRule("revenue", Aggregation.SUM, Additivity.ADDITIVE)
    assert rule.non_additive_dimensions == frozenset()
    assert rule.components is None


def test_reads_a_semi_additive_skifer_metric() -> None:
    rule = MetricRule.from_skifer_metric(
        {
            "name": "stock",
            "type": "sum",
            "additivity": "semi_additive",
            "non_additive_dimensions": ["month"],
            "filters": [{"sql": "x > 0"}],
        }
    )
    assert rule.additivity is Additivity.SEMI_ADDITIVE
    assert rule.non_additive_dimensions == frozenset({"month"})


def test_attaches_avg_components() -> None:
    components = AvgComponents("basket_sum", "basket_count")
    rule = MetricRule.from_skifer_metric({"name": "basket", "type": "avg"}, components=components)
    assert rule.components == components


@pytest.mark.parametrize(
    ("metric", "message"),
    [
        ({"type": "sum"}, "non-empty 'name'"),
        ({"name": "", "type": "sum"}, "non-empty 'name'"),
        ({"name": "m", "type": "median"}, "unsupported type"),
        ({"name": "m"}, "unsupported type"),
        ({"name": "m", "type": "sum", "additivity": "sometimes"}, "invalid additivity"),
        (
            {"name": "m", "type": "sum", "additivity": "semi_additive"},
            "requires non_additive_dimensions",
        ),
        (
            {"name": "m", "type": "sum", "non_additive_dimensions": ["month"]},
            "only valid for semi_additive",
        ),
        (
            {"name": "m", "type": "sum", "non_additive_dimensions": "month"},
            "must be a list of names",
        ),
        (
            {"name": "m", "type": "sum", "non_additive_dimensions": ["month", ""]},
            "must be a list of names",
        ),
    ],
)
def test_rejects_invalid_skifer_metrics(metric: dict[str, Any], message: str) -> None:
    with pytest.raises(ContractError, match=message):
        MetricRule.from_skifer_metric(metric)


def test_rejects_an_empty_rule_name() -> None:
    with pytest.raises(ContractError, match="non-empty string"):
        MetricRule("", Aggregation.SUM)


def test_rejects_components_on_a_non_avg_metric() -> None:
    with pytest.raises(ContractError, match="only valid for avg"):
        MetricRule("m", Aggregation.SUM, components=AvgComponents("s", "c"))


def test_rejects_a_component_that_is_the_metric_itself() -> None:
    with pytest.raises(ContractError, match="metric column itself"):
        MetricRule("m", Aggregation.AVG, components=AvgComponents("m", "c"))


@pytest.mark.parametrize(
    ("sum_column", "count_column", "message"),
    [("", "c", "non-empty string"), ("s", "s", "distinct columns")],
)
def test_rejects_invalid_components(sum_column: str, count_column: str, message: str) -> None:
    with pytest.raises(ContractError, match=message):
        AvgComponents(sum_column, count_column)
