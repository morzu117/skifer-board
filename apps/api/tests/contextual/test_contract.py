import pyarrow as pa
import pytest
from skifer_board.contextual import (
    Aggregation,
    AvgComponents,
    Completeness,
    ContextualResult,
    ContractError,
    MetricRule,
    ResultContract,
)

REVENUE = MetricRule("revenue", Aggregation.SUM)


def contract(*dimensions: str, metrics: tuple[MetricRule, ...] = (REVENUE,)) -> ResultContract:
    return ResultContract(dimensions, metrics, Completeness.COMPLETE, "ev-1")


def test_accepts_a_single_grain_result() -> None:
    table = pa.table({"region": ["n", "s"], "revenue": [1, 2]})
    result = ContextualResult(table, contract("region"))
    assert result.contract.rule("revenue") is REVENUE


def test_accepts_a_single_row_without_dimensions() -> None:
    ContextualResult(pa.table({"revenue": [3]}), contract())


def test_unknown_metric_is_a_contract_error() -> None:
    with pytest.raises(ContractError, match="Unknown metric 'margin'"):
        contract("region").rule("margin")


@pytest.mark.parametrize(
    ("dimensions", "metrics", "message"),
    [
        (("",), (REVENUE,), "non-empty strings"),
        (("region", "region"), (REVENUE,), "must be unique"),
        (("region",), (), "at least one metric"),
        (("region",), (REVENUE, REVENUE), "Metric names must be unique"),
        (("revenue",), (REVENUE,), "both as dimension and metric"),
    ],
)
def test_rejects_invalid_contracts(
    dimensions: tuple[str, ...], metrics: tuple[MetricRule, ...], message: str
) -> None:
    with pytest.raises(ContractError, match=message):
        ResultContract(dimensions, metrics, Completeness.COMPLETE)


def test_rejects_missing_columns_including_components() -> None:
    basket = MetricRule("basket", Aggregation.AVG, components=AvgComponents("b_sum", "b_count"))
    table = pa.table({"region": ["n"], "basket": [1.5], "b_sum": [3.0]})
    with pytest.raises(ContractError, match=r"missing columns: \['b_count'\]"):
        ContextualResult(table, contract("region", metrics=(basket,)))


def test_rejects_a_non_numeric_metric_column() -> None:
    table = pa.table({"region": ["n"], "revenue": ["12"]})
    with pytest.raises(ContractError, match="'revenue' must be numeric"):
        ContextualResult(table, contract("region"))


def test_rejects_a_result_with_a_subtotal_row() -> None:
    table = pa.table({"region": ["n", "s", "n"], "revenue": [1, 2, 3]})
    with pytest.raises(ContractError, match="single grain"):
        ContextualResult(table, contract("region"))


def test_rejects_several_rows_without_dimensions() -> None:
    with pytest.raises(ContractError, match="at most one row"):
        ContextualResult(pa.table({"revenue": [1, 2]}), contract())
