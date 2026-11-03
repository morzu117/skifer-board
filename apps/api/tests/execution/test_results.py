"""Aperçu Arrow : types, bornes, troncature et réponses de source invalides."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

import pyarrow as pa
import pytest
from skifer_board.execution.results import ResultContractError, _value, arrow_preview
from skifer_board.execution.runs import MAX_BYTES, MAX_ROWS


def _rows(preview: Any) -> pa.Table:
    return pa.ipc.open_stream(preview.data).read_all()


def _source(
    columns: list[Any], rows: list[list[Any]], *, truncated: bool = False
) -> dict[str, Any]:
    return {
        "manifest": {
            "total_chunk_count": 1,
            "truncated": truncated,
            "schema": {"column_count": len(columns), "columns": columns},
        },
        "data_array": rows,
    }


def _column(name: str, kind: str, position: int, **extra: Any) -> dict[str, Any]:
    return {"name": name, "type_name": kind, "position": position, **extra}


def test_databricks_json_preserves_scalar_types_and_nulls() -> None:
    columns = [
        _column("label", "STRING", 0),
        _column("ok", "BOOLEAN", 1),
        _column("small", "BYTE", 2),
        _column("short", "SHORT", 3),
        _column("count", "INT", 4),
        _column("large", "LONG", 5),
        _column("ratio", "FLOAT", 6),
        _column("price", "DOUBLE", 7),
        _column("exact", "DECIMAL", 8, type_precision=18, type_scale=2),
        _column("day", "DATE", 9),
        _column("at", "TIMESTAMP", 10),
    ]
    values = [
        "A",
        "true",
        "1",
        "2",
        "3",
        "4",
        "0.5",
        "1.25",
        "12.30",
        "2026-11-04",
        "2026-11-04 12:30:00",
    ]
    preview = arrow_preview(_source(columns, [values, [None] * len(columns)], truncated=True))
    table = _rows(preview)
    assert preview.rows == 2 and preview.size == len(preview.data) and preview.truncated
    assert table.to_pylist() == [
        {
            "label": "A",
            "ok": True,
            "small": 1,
            "short": 2,
            "count": 3,
            "large": 4,
            "ratio": 0.5,
            "price": 1.25,
            "exact": Decimal("12.30"),
            "day": date(2026, 11, 4),
            "at": datetime(2026, 11, 4, 12, 30),
        },
        dict.fromkeys([column["name"] for column in columns]),
    ]


def test_arrow_input_is_bounded_by_rows_and_bytes() -> None:
    many = pa.table({"n": list(range(MAX_ROWS + 5))})
    preview = arrow_preview(many)
    assert preview.rows == MAX_ROWS and preview.truncated
    assert _rows(preview).column("n")[-1].as_py() == MAX_ROWS - 1
    huge = pa.table({"text": ["x" * (MAX_BYTES // 2)] * 3})
    bounded = arrow_preview(huge)
    assert bounded.rows < 3 and bounded.size <= MAX_BYTES and bounded.truncated
    assert not arrow_preview(pa.table({"n": [1]})).truncated
    assert arrow_preview(pa.table({"n": [1]}), source_truncated=True).truncated


@pytest.mark.parametrize(
    "raw",
    [
        None,
        {},
        {"manifest": {}, "data_array": []},
        _source([], []),
        _source([_column("n", "LONG", 0)], [["1", "2"]]),
        _source([_column("n", "LONG", 0)], [[1]]),
        _source([_column("n", "UNKNOWN", 0)], [["1"]]),
        _source([_column("n", "DECIMAL", 0, type_precision=0, type_scale=0)], [["1"]]),
        _source([_column("n", "BOOLEAN", 0)], [["maybe"]]),
        _source([_column("n", "DOUBLE", 0)], [["NaN"]]),
        _source([_column("n", "LONG", 0)], [["abc"]]),
        _source([_column("n", "DATE", 0)], [["bad"]]),
        _source([_column("n", "TIMESTAMP", 0)], [["2026-11-04T12:30:00+01:00"]]),
        _source([_column("n", "LONG", 1)], [["1"]]),
        _source([_column("", "LONG", 0)], [["1"]]),
        _source([_column("n", "LONG", 0), _column("n", "LONG", 1)], [["1", "2"]]),
        _source([{"name": "n", "type_name": "LONG", "position": 0}, None], []),
    ],
)
def test_bad_source_data_is_refused_without_copying_values(raw: Any) -> None:
    with pytest.raises(ResultContractError) as error:
        arrow_preview(raw)
    assert "abc" not in str(error.value)


def test_schema_itself_over_the_byte_limit_is_refused() -> None:
    with pytest.raises(ResultContractError):
        arrow_preview(pa.table({"n" * MAX_BYTES: [1]}))


def test_unhandled_internal_arrow_type_is_refused() -> None:
    with pytest.raises(ResultContractError):
        _value("binary", pa.binary())
