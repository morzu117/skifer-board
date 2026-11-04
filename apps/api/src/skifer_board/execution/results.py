"""Conversion des réponses de source en aperçu Arrow borné (plan 12.5b)."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import pyarrow as pa

from .runs import MAX_BYTES, MAX_ROWS


class ResultContractError(Exception):
    """Réponse de source illisible ou type non pris en charge, sans valeur recopiée."""


@dataclass(frozen=True)
class ArrowPreview:
    data: bytes = field(repr=False)
    rows: int
    size: int
    truncated: bool


_TYPES: dict[str, pa.DataType] = {
    "STRING": pa.string(),
    "BOOLEAN": pa.bool_(),
    "BYTE": pa.int8(),
    "SHORT": pa.int16(),
    "INT": pa.int32(),
    "LONG": pa.int64(),
    "FLOAT": pa.float32(),
    "DOUBLE": pa.float64(),
    "DATE": pa.date32(),
    "TIMESTAMP": pa.timestamp("us"),
}


def _type(column: dict[str, Any]) -> pa.DataType:
    name = column.get("type_name")
    if name == "DECIMAL":
        precision, scale = column.get("type_precision"), column.get("type_scale")
        if (
            type(precision) is not int
            or type(scale) is not int
            or not 1 <= precision <= 38
            or not 0 <= scale <= precision
        ):
            raise ResultContractError()
        return pa.decimal128(precision, scale)
    if name not in _TYPES:
        raise ResultContractError()
    return _TYPES[name]


def _value(value: str | None, kind: pa.DataType) -> Any:
    if value is None or kind == pa.string():
        return value
    if kind == pa.bool_():
        if value not in ("true", "false"):
            raise ResultContractError()
        return value == "true"
    if pa.types.is_integer(kind):
        return int(value)
    if pa.types.is_floating(kind):
        number = float(value)
        if not math.isfinite(number):
            raise ResultContractError()
        return number
    if pa.types.is_decimal(kind):
        return Decimal(value)
    if pa.types.is_date(kind):
        return date.fromisoformat(value)
    if pa.types.is_timestamp(kind):
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is not None:
            raise ResultContractError()
        return parsed
    raise ResultContractError()


def _databricks_table(raw: dict[str, Any]) -> tuple[pa.Table, bool]:
    manifest, rows = raw.get("manifest"), raw.get("data_array")
    if not isinstance(manifest, dict) or not isinstance(rows, list):
        raise ResultContractError()
    schema = manifest.get("schema")
    if (
        not isinstance(schema, dict)
        or manifest.get("total_chunk_count") != 1
        or type(manifest.get("truncated")) is not bool
    ):
        raise ResultContractError()
    columns = schema.get("columns")
    if (
        not isinstance(columns, list)
        or not columns
        or schema.get("column_count") != len(columns)
        or any(not isinstance(row, list) or len(row) != len(columns) for row in rows)
    ):
        raise ResultContractError()
    names: list[str] = []
    arrays: list[Any] = []
    try:
        for index, column in enumerate(columns):
            if not isinstance(column, dict):
                raise ResultContractError()
            name = column.get("name")
            if (
                not isinstance(name, str)
                or not name
                or name in names
                or column.get("position") != index
            ):
                raise ResultContractError()
            kind = _type(column)
            values = [row[index] for row in rows]
            if any(value is not None and not isinstance(value, str) for value in values):
                raise ResultContractError()
            names.append(name)
            arrays.append(pa.array([_value(value, kind) for value in values], type=kind))
        return pa.Table.from_arrays(arrays, names=names), manifest["truncated"]
    except (ValueError, TypeError, OverflowError, InvalidOperation, pa.ArrowException):
        raise ResultContractError() from None


def _serialize(table: pa.Table) -> bytes:
    sink = pa.BufferOutputStream()
    with pa.ipc.new_stream(sink, table.schema) as writer:
        writer.write_table(table)
    return sink.getvalue().to_pybytes()


def arrow_preview(raw: Any, *, source_truncated: bool = False) -> ArrowPreview:
    """Retourne un flux Arrow typé, sans jamais prétendre que l'aperçu est complet."""
    if isinstance(raw, pa.Table):
        table = raw
        truncated = source_truncated
    elif isinstance(raw, dict):
        table, truncated = _databricks_table(raw)
    else:
        raise ResultContractError()
    if table.num_rows > MAX_ROWS:
        table = table.slice(0, MAX_ROWS)
        truncated = True
    data = _serialize(table)
    if len(data) > MAX_BYTES:
        truncated = True
        low, high = 0, table.num_rows
        while low < high:
            middle = (low + high + 1) // 2
            if len(_serialize(table.slice(0, middle))) <= MAX_BYTES:
                low = middle
            else:
                high = middle - 1
        table = table.slice(0, low)
        data = _serialize(table)
        if len(data) > MAX_BYTES:
            raise ResultContractError()
    return ArrowPreview(data, table.num_rows, len(data), truncated)
