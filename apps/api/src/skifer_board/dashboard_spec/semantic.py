"""Semantic layer: cross-field rules of Dashboard as YAML v1.

The codes and their meaning are defined in `docs/dashboard_yaml_spec.md`. These rules run only
on a document that already satisfies the JSON Schema, and rely on the structure it guarantees.

Issues come out in document order: global filters first (`DUPLICATE_FILTER_NAME`), then each
tile in turn, and within a tile the rules in the order of the specification table.
"""

import re
from typing import Any

from skifer_board.dashboard_spec.issues import ValidationIssue, json_pointer

DEFAULT_COLUMNS = 12
BINDING_PATTERN = re.compile(r"^\$filters\.([a-z][a-z0-9_]*)$")
CHART_KINDS = {"bar", "line"}

Segments = list[str | int]


def _issue(code: str, parts: Segments, message: str) -> ValidationIssue:
    return ValidationIssue(layer="semantic", code=code, path=json_pointer(parts), message=message)


def semantic_issues(document: Any) -> list[ValidationIssue]:
    """Return the cross-field rule violations of a structurally valid `document`."""
    spec: dict[str, Any] = document["spec"]
    filters: list[dict[str, Any]] = spec.get("filters", [])
    tiles: list[dict[str, Any]] = spec["tiles"]
    columns: int = spec.get("layout", {}).get("columns", DEFAULT_COLUMNS)

    issues: list[ValidationIssue] = []
    filter_kinds: dict[str, str] = {}
    for index, global_filter in enumerate(filters):
        name: str = global_filter["name"]
        if name in filter_kinds:
            issues.append(
                _issue(
                    "DUPLICATE_FILTER_NAME",
                    ["spec", "filters", index, "name"],
                    f"global filter name '{name}' is already used by an earlier filter",
                )
            )
            continue
        filter_kinds[name] = global_filter.get("kind", "dimension")

    tile_ids: set[str] = set()
    for index, tile in enumerate(tiles):
        tile_path: Segments = ["spec", "tiles", index]
        tile_id: str = tile["id"]
        if tile_id in tile_ids:
            issues.append(
                _issue(
                    "DUPLICATE_TILE_ID",
                    [*tile_path, "id"],
                    f"tile id '{tile_id}' is already used by an earlier tile",
                )
            )
        tile_ids.add(tile_id)
        issues.extend(_grid_issues(tiles, index, columns))
        issues.extend(_query_issues(tile, tile_path))
        issues.extend(_viz_issues(tile, tile_path))
        issues.extend(_filter_reference_issues(tile, tile_path, filter_kinds))
    return issues


def _overlaps(first: dict[str, int], second: dict[str, int]) -> bool:
    return (
        first["x"] < second["x"] + second["w"]
        and second["x"] < first["x"] + first["w"]
        and first["y"] < second["y"] + second["h"]
        and second["y"] < first["y"] + first["h"]
    )


def _grid_issues(tiles: list[dict[str, Any]], index: int, columns: int) -> list[ValidationIssue]:
    tile = tiles[index]
    position: dict[str, int] = tile["position"]
    position_path: Segments = ["spec", "tiles", index, "position"]
    issues: list[ValidationIssue] = []
    right_edge = position["x"] + position["w"]
    if right_edge > columns:
        issues.append(
            _issue(
                "TILE_OUT_OF_GRID",
                position_path,
                f"tile '{tile['id']}' ends at column {right_edge}, "
                f"beyond the {columns}-column grid",
            )
        )
    for earlier_index in range(index):
        earlier = tiles[earlier_index]
        if _overlaps(earlier["position"], position):
            issues.append(
                _issue(
                    "TILE_OVERLAP",
                    position_path,
                    f"tile '{tile['id']}' overlaps tile '{earlier['id']}' "
                    f"(/spec/tiles/{earlier_index})",
                )
            )
    return issues


def _query_issues(tile: dict[str, Any], tile_path: Segments) -> list[ValidationIssue]:
    query: dict[str, Any] = tile["query"]
    if query.get("metrics") or query.get("group_by"):
        return []
    return [
        _issue(
            "EMPTY_QUERY",
            [*tile_path, "query"],
            f"tile '{tile['id']}' query declares neither metrics nor group_by",
        )
    ]


def _viz_issues(tile: dict[str, Any], tile_path: Segments) -> list[ValidationIssue]:
    query: dict[str, Any] = tile["query"]
    viz: dict[str, Any] = tile["viz"]
    metrics: list[str] = query.get("metrics", [])
    group_by: list[str] = query.get("group_by", [])
    known = set(metrics) | set(group_by)
    viz_path: Segments = [*tile_path, "viz"]
    kind: str = viz["kind"]
    issues: list[ValidationIssue] = []

    if kind in CHART_KINDS and viz["x"] not in group_by:
        issues.append(
            _issue(
                "VIZ_X_NOT_IN_GROUP_BY",
                [*viz_path, "x"],
                f"viz.x '{viz['x']}' is not in query.group_by",
            )
        )
    if kind in CHART_KINDS:
        for series_index, series in enumerate(viz["series"]):
            if series not in metrics:
                issues.append(
                    _issue(
                        "VIZ_SERIES_NOT_IN_METRICS",
                        [*viz_path, "series", series_index],
                        f"viz.series entry '{series}' is not in query.metrics",
                    )
                )
    if kind == "kpi" and viz["metric"] not in metrics:
        issues.append(
            _issue(
                "VIZ_KPI_METRIC_NOT_IN_METRICS",
                [*viz_path, "metric"],
                f"viz.metric '{viz['metric']}' is not in query.metrics",
            )
        )
    if kind == "table":
        for column_index, column in enumerate(viz.get("columns", [])):
            if column not in known:
                issues.append(
                    _issue(
                        "VIZ_TABLE_COLUMN_UNKNOWN",
                        [*viz_path, "columns", column_index],
                        f"viz.columns entry '{column}' is in neither query.metrics "
                        "nor query.group_by",
                    )
                )
    for key in viz.get("format", {}):
        if key not in known:
            issues.append(
                _issue(
                    "FORMAT_KEY_UNKNOWN",
                    [*viz_path, "format", key],
                    f"viz.format key '{key}' is in neither query.metrics nor query.group_by",
                )
            )
    return issues


def _filter_reference_issues(
    tile: dict[str, Any], tile_path: Segments, filter_kinds: dict[str, str]
) -> list[ValidationIssue]:
    query: dict[str, Any] = tile["query"]
    unknown: list[ValidationIssue] = []
    mismatched: list[ValidationIssue] = []

    def check_binding(value: Any, parts: Segments, expected_kind: str) -> None:
        if not isinstance(value, str):
            return
        match = BINDING_PATTERN.fullmatch(value)
        if match is None:
            return
        name = match.group(1)
        if name not in filter_kinds:
            unknown.append(
                _issue(
                    "UNKNOWN_FILTER_REFERENCE",
                    parts,
                    f"binding '{value}' references no global filter",
                )
            )
        elif filter_kinds[name] != expected_kind:
            mismatched.append(
                _issue(
                    "BINDING_KIND_MISMATCH",
                    parts,
                    f"binding '{value}' must reference a {expected_kind} filter, "
                    f"'{name}' is a {filter_kinds[name]} filter",
                )
            )

    check_binding(query.get("period"), [*tile_path, "query", "period"], "period")
    for filter_index, query_filter in enumerate(query.get("filters", [])):
        check_binding(
            query_filter.get("value"),
            [*tile_path, "query", "filters", filter_index, "value"],
            "dimension",
        )
    for name_index, name in enumerate(tile.get("ignore_filters", [])):
        if name not in filter_kinds:
            unknown.append(
                _issue(
                    "UNKNOWN_FILTER_REFERENCE",
                    [*tile_path, "ignore_filters", name_index],
                    f"ignore_filters entry '{name}' references no global filter",
                )
            )
    return unknown + mismatched
