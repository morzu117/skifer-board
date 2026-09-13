"""One targeted test per semantic code, on minimal documents built in Python."""

from typing import Any

from skifer_board.dashboard_spec import ValidationIssue, validate_document


def _tile(
    tile_id: str = "tile",
    *,
    x: int = 0,
    y: int = 0,
    w: int = 4,
    h: int = 3,
    query: dict[str, Any] | None = None,
    viz: dict[str, Any] | None = None,
    **extra: Any,
) -> dict[str, Any]:
    return {
        "id": tile_id,
        "position": {"x": x, "y": y, "w": w, "h": h},
        "query": query if query is not None else {"model": "sales.orders", "metrics": ["revenue"]},
        "viz": viz if viz is not None else {"kind": "kpi", "metric": "revenue"},
        **extra,
    }


def _document(
    tiles: list[dict[str, Any]],
    *,
    filters: list[dict[str, Any]] | None = None,
    layout: dict[str, Any] | None = None,
) -> dict[str, Any]:
    spec: dict[str, Any] = {"tiles": tiles}
    if filters is not None:
        spec["filters"] = filters
    if layout is not None:
        spec["layout"] = layout
    return {
        "apiVersion": "skifer-board/v1",
        "kind": "Dashboard",
        "metadata": {"slug": "semantic-test", "title": "Semantic test"},
        "spec": spec,
    }


def _found(issues: list[ValidationIssue]) -> list[tuple[str, str, str]]:
    return [(issue.layer, issue.code, issue.path) for issue in issues]


REGION = {"name": "region", "dimension": "region"}
PERIOD = {"name": "period", "kind": "period", "default": "last_12_months"}
REVENUE_BY_MONTH = {
    "model": "sales.orders",
    "metrics": ["revenue"],
    "group_by": ["order_month"],
}


def test_duplicate_tile_id_reported_on_each_later_occurrence() -> None:
    document = _document([_tile("kpi"), _tile("kpi", x=4), _tile("kpi", x=8)])
    assert _found(validate_document(document)) == [
        ("semantic", "DUPLICATE_TILE_ID", "/spec/tiles/1/id"),
        ("semantic", "DUPLICATE_TILE_ID", "/spec/tiles/2/id"),
    ]


def test_duplicate_filter_name() -> None:
    document = _document([_tile()], filters=[REGION, {"name": "region", "dimension": "country"}])
    assert _found(validate_document(document)) == [
        ("semantic", "DUPLICATE_FILTER_NAME", "/spec/filters/1/name"),
    ]


def test_tile_out_of_grid_with_declared_columns() -> None:
    document = _document([_tile(x=4, w=4)], layout={"columns": 6})
    assert _found(validate_document(document)) == [
        ("semantic", "TILE_OUT_OF_GRID", "/spec/tiles/0/position"),
    ]


def test_missing_layout_means_twelve_columns() -> None:
    assert validate_document(_document([_tile(x=8, w=4)])) == []
    assert _found(validate_document(_document([_tile(x=9, w=4)]))) == [
        ("semantic", "TILE_OUT_OF_GRID", "/spec/tiles/0/position"),
    ]


def test_layout_without_columns_means_twelve_columns() -> None:
    assert validate_document(_document([_tile(x=8, w=4)], layout={})) == []


def test_tile_overlap_reported_once_per_pair_on_later_tile() -> None:
    document = _document([_tile("a"), _tile("b", x=2, y=1), _tile("c", x=3, y=2)])
    assert _found(validate_document(document)) == [
        ("semantic", "TILE_OVERLAP", "/spec/tiles/1/position"),
        ("semantic", "TILE_OVERLAP", "/spec/tiles/2/position"),
        ("semantic", "TILE_OVERLAP", "/spec/tiles/2/position"),
    ]


def test_adjacent_tiles_do_not_overlap() -> None:
    document = _document([_tile("a"), _tile("b", x=4), _tile("c", y=3), _tile("d", x=4, y=3)])
    assert validate_document(document) == []


def test_empty_query() -> None:
    document = _document(
        [
            _tile(
                query={"model": "sales.orders", "metrics": [], "group_by": []},
                viz={"kind": "table"},
            )
        ]
    )
    assert _found(validate_document(document)) == [
        ("semantic", "EMPTY_QUERY", "/spec/tiles/0/query"),
    ]


def test_viz_x_not_in_group_by() -> None:
    viz = {"kind": "bar", "x": "region", "series": ["revenue"]}
    document = _document([_tile(query=REVENUE_BY_MONTH, viz=viz)])
    assert _found(validate_document(document)) == [
        ("semantic", "VIZ_X_NOT_IN_GROUP_BY", "/spec/tiles/0/viz/x"),
    ]


def test_viz_series_not_in_metrics() -> None:
    viz = {"kind": "line", "x": "order_month", "series": ["revenue", "order_count"]}
    document = _document([_tile(query=REVENUE_BY_MONTH, viz=viz)])
    assert _found(validate_document(document)) == [
        ("semantic", "VIZ_SERIES_NOT_IN_METRICS", "/spec/tiles/0/viz/series/1"),
    ]


def test_viz_two_series_not_in_metrics() -> None:
    viz = {
        "kind": "line",
        "x": "order_month",
        "series": ["order_count", "revenue", "margin"],
    }
    document = _document([_tile(query=REVENUE_BY_MONTH, viz=viz)])
    assert _found(validate_document(document)) == [
        ("semantic", "VIZ_SERIES_NOT_IN_METRICS", "/spec/tiles/0/viz/series/0"),
        ("semantic", "VIZ_SERIES_NOT_IN_METRICS", "/spec/tiles/0/viz/series/2"),
    ]


def test_unknown_filter_reference_and_binding_kind_mismatch_in_same_tile() -> None:
    query = {
        **REVENUE_BY_MONTH,
        "period": "$filters.inconnu",
        "filters": [{"column": "region", "operator": "eq", "value": "$filters.period"}],
    }
    document = _document([_tile(query=query, viz={"kind": "table"})], filters=[REGION, PERIOD])
    assert _found(validate_document(document)) == [
        ("semantic", "UNKNOWN_FILTER_REFERENCE", "/spec/tiles/0/query/period"),
        ("semantic", "BINDING_KIND_MISMATCH", "/spec/tiles/0/query/filters/0/value"),
    ]


def test_viz_kpi_metric_not_in_metrics() -> None:
    document = _document([_tile(viz={"kind": "kpi", "metric": "order_count"})])
    assert _found(validate_document(document)) == [
        ("semantic", "VIZ_KPI_METRIC_NOT_IN_METRICS", "/spec/tiles/0/viz/metric"),
    ]


def test_viz_table_column_unknown() -> None:
    viz = {"kind": "table", "columns": ["order_month", "region", "revenue"]}
    document = _document([_tile(query=REVENUE_BY_MONTH, viz=viz)])
    assert _found(validate_document(document)) == [
        ("semantic", "VIZ_TABLE_COLUMN_UNKNOWN", "/spec/tiles/0/viz/columns/1"),
    ]


def test_format_key_unknown() -> None:
    viz = {"kind": "table", "format": {"revenue": "currency_eur", "margin": "percent"}}
    document = _document([_tile(query=REVENUE_BY_MONTH, viz=viz)])
    assert _found(validate_document(document)) == [
        ("semantic", "FORMAT_KEY_UNKNOWN", "/spec/tiles/0/viz/format/margin"),
    ]


def test_format_key_with_unconstrained_name_passes_schema_and_is_reported_as_unknown() -> None:
    viz = {"kind": "table", "format": {"bad-key": "percent"}}
    document = _document([_tile(query=REVENUE_BY_MONTH, viz=viz)])
    assert _found(validate_document(document)) == [
        ("semantic", "FORMAT_KEY_UNKNOWN", "/spec/tiles/0/viz/format/bad-key"),
    ]


def test_format_key_with_slash_and_tilde_is_escaped_per_rfc6901() -> None:
    viz = {"kind": "table", "format": {"a/b~c": "percent"}}
    document = _document([_tile(query=REVENUE_BY_MONTH, viz=viz)])
    assert _found(validate_document(document)) == [
        ("semantic", "FORMAT_KEY_UNKNOWN", "/spec/tiles/0/viz/format/a~1b~0c"),
    ]


def test_unknown_filter_reference_in_period_value_and_ignore_filters() -> None:
    query = {
        **REVENUE_BY_MONTH,
        "period": "$filters.period",
        "filters": [{"column": "region", "operator": "eq", "value": "$filters.region"}],
    }
    document = _document([_tile(query=query, viz={"kind": "table"}, ignore_filters=["country"])])
    assert _found(validate_document(document)) == [
        ("semantic", "UNKNOWN_FILTER_REFERENCE", "/spec/tiles/0/query/period"),
        ("semantic", "UNKNOWN_FILTER_REFERENCE", "/spec/tiles/0/query/filters/0/value"),
        ("semantic", "UNKNOWN_FILTER_REFERENCE", "/spec/tiles/0/ignore_filters/0"),
    ]


def test_binding_kind_mismatch_in_period_and_value() -> None:
    query = {
        **REVENUE_BY_MONTH,
        "period": "$filters.region",
        "filters": [{"column": "region", "operator": "eq", "value": "$filters.period"}],
    }
    document = _document([_tile(query=query, viz={"kind": "table"})], filters=[REGION, PERIOD])
    assert _found(validate_document(document)) == [
        ("semantic", "BINDING_KIND_MISMATCH", "/spec/tiles/0/query/period"),
        ("semantic", "BINDING_KIND_MISMATCH", "/spec/tiles/0/query/filters/0/value"),
    ]


def test_literal_period_and_values_are_not_bindings() -> None:
    query = {
        **REVENUE_BY_MONTH,
        "period": "ytd",
        "filters": [{"column": "region", "operator": "in", "value": ["$filters.region", "EU"]}],
    }
    assert validate_document(_document([_tile(query=query, viz={"kind": "table"})])) == []


def test_valid_document_with_several_filters_and_ignore_filters() -> None:
    kpi_query = {
        "model": "sales.orders",
        "metrics": ["revenue"],
        "filters": [{"column": "region", "operator": "eq", "value": "$filters.region"}],
        "period": "$filters.period",
    }
    tiles = [
        _tile("kpi_revenue", query=kpi_query, viz={"kind": "kpi", "metric": "revenue"}),
        _tile(
            "revenue_by_month",
            x=4,
            w=8,
            h=4,
            query={**REVENUE_BY_MONTH, "period": "$filters.period"},
            viz={"kind": "line", "x": "order_month", "series": ["revenue"]},
            ignore_filters=["region", "channel"],
        ),
    ]
    filters = [REGION, PERIOD, {"name": "channel", "kind": "dimension", "dimension": "channel"}]
    assert validate_document(_document(tiles, filters=filters)) == []


def test_issues_follow_document_order() -> None:
    document = _document(
        [
            _tile("a", viz={"kind": "kpi", "metric": "order_count"}),
            _tile("a", x=2, query={"model": "sales.orders"}, viz={"kind": "table"}),
        ],
        filters=[REGION, REGION],
    )
    assert _found(validate_document(document)) == [
        ("semantic", "DUPLICATE_FILTER_NAME", "/spec/filters/1/name"),
        ("semantic", "VIZ_KPI_METRIC_NOT_IN_METRICS", "/spec/tiles/0/viz/metric"),
        ("semantic", "DUPLICATE_TILE_ID", "/spec/tiles/1/id"),
        ("semantic", "TILE_OVERLAP", "/spec/tiles/1/position"),
        ("semantic", "EMPTY_QUERY", "/spec/tiles/1/query"),
    ]
