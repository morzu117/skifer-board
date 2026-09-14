"""Contract: `POST /query`, nominal path, invalid body and certification denial."""

import re
from datetime import date
from typing import Any

import httpx

from skifer_contract_tests.assertions import assert_error

EVIDENCE_KEYS = {
    "schema_version",
    "evidence_id",
    "trace_id",
    "model_keys",
    "metrics",
    "dimensions",
    "normalized_filters",
    "sources",
    "policy",
    "sql_hash",
    "statement_id",
    "compiled_at",
    "executed_at",
    "execution_status",
    "execution_duration_seconds",
    "execution_error_type",
}
METRIC_EVIDENCE_KEYS = {"name", "model_key", "definition_hash", "source_columns", "lineage_status"}
SOURCE_EVIDENCE_KEYS = {
    "dataset",
    "contract_id",
    "contract_version",
    "definition_hash",
    "certification_status",
    "certified_at",
    "load_age_seconds",
    "data_age_seconds",
    "certification_run_id",
}
LOGICAL_TYPES = {"string", "date", "integer", "decimal"}
SQL_HASH = re.compile(r"sha256:v1:[0-9a-f]{64}")

SIMPLE_QUERY = {"model": "sales.orders", "metrics": ["revenue"], "group_by": ["region"]}
JOIN_QUERY = {"model": "sales.orders", "metrics": ["revenue"], "group_by": ["segment"]}
MULTI_ROW_QUERY = {
    "model": "sales.orders",
    "metrics": ["revenue"],
    "group_by": ["region", "channel"],
}
DENIED_QUERY = {"model": "finance.invoices", "metrics": ["invoiced_amount"], "group_by": ["status"]}


def post_query(
    skifer: httpx.Client,
    auth_headers: dict[str, str],
    body: dict[str, Any],
    limit: int | None = None,
) -> httpx.Response:
    params = {} if limit is None else {"limit": limit}
    return skifer.post("/query", json=body, params=params, headers=auth_headers)


def assert_value_matches(value: Any, logical_type: str) -> None:
    if value is None:
        return
    if logical_type == "string":
        assert isinstance(value, str)
    elif logical_type == "date":
        assert isinstance(value, str)
        date.fromisoformat(value)
    elif logical_type == "integer":
        assert isinstance(value, int) and not isinstance(value, bool)
    else:
        assert isinstance(value, int | float) and not isinstance(value, bool)


def assert_query_result(payload: dict[str, Any], body: dict[str, Any]) -> None:
    assert set(payload) == {"columns", "rows", "evidence", "truncated"}
    names = [column["name"] for column in payload["columns"]]
    assert names == [*body.get("group_by", []), *body["metrics"]]
    types = {}
    for column in payload["columns"]:
        assert set(column) == {"name", "logical_type"}
        assert column["logical_type"] in LOGICAL_TYPES
        types[column["name"]] = column["logical_type"]
    assert isinstance(payload["rows"], list)
    for row in payload["rows"]:
        assert set(row) == set(names)
        for name in names:
            assert_value_matches(row[name], types[name])
    assert isinstance(payload["truncated"], bool)

    evidence = payload["evidence"]
    assert set(evidence) == EVIDENCE_KEYS
    assert SQL_HASH.fullmatch(evidence["sql_hash"])
    assert set(evidence["policy"]) == {"decision", "reasons", "evaluated_at"}
    assert evidence["policy"]["decision"] in {"ALLOW", "WARN"}
    assert body["model"] in evidence["model_keys"]
    assert [metric["name"] for metric in evidence["metrics"]] == body["metrics"]
    for metric in evidence["metrics"]:
        assert set(metric) == METRIC_EVIDENCE_KEYS
    assert evidence["dimensions"] == body.get("group_by", [])
    assert evidence["sources"]
    for source in evidence["sources"]:
        assert set(source) == SOURCE_EVIDENCE_KEYS


def test_simple_query(skifer: httpx.Client, auth_headers: dict[str, str]) -> None:
    response = post_query(skifer, auth_headers, SIMPLE_QUERY)
    assert response.status_code == 200, response.text
    assert_query_result(response.json(), SIMPLE_QUERY)


def test_query_with_join(skifer: httpx.Client, auth_headers: dict[str, str]) -> None:
    response = post_query(skifer, auth_headers, JOIN_QUERY)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert_query_result(payload, JOIN_QUERY)
    assert {"sales.orders", "sales.customers"} <= set(payload["evidence"]["model_keys"])


def test_same_query_twice_is_stable(skifer: httpx.Client, auth_headers: dict[str, str]) -> None:
    first = post_query(skifer, auth_headers, SIMPLE_QUERY).json()
    second = post_query(skifer, auth_headers, SIMPLE_QUERY).json()
    assert first["evidence"]["sql_hash"] == second["evidence"]["sql_hash"]
    assert first["rows"] == second["rows"]


def test_limit_truncates(skifer: httpx.Client, auth_headers: dict[str, str]) -> None:
    response = post_query(skifer, auth_headers, MULTI_ROW_QUERY, limit=1)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert_query_result(payload, MULTI_ROW_QUERY)
    assert payload["truncated"] is True
    assert len(payload["rows"]) == 1


def test_unknown_body_field_is_invalid_request(
    skifer: httpx.Client, auth_headers: dict[str, str]
) -> None:
    body = {**SIMPLE_QUERY, "sql": "SELECT 1"}
    assert_error(post_query(skifer, auth_headers, body), 400, "InvalidRequest")


def test_denied_model_is_semantic_access_denied_without_rows(
    skifer: httpx.Client, auth_headers: dict[str, str]
) -> None:
    response = post_query(skifer, auth_headers, DENIED_QUERY)
    error = assert_error(response, 403, "SemanticAccessDenied")
    assert error["decision"] == "DENY"
    assert "EXPIRED" in error["reasons"]
    assert isinstance(error["evaluated_at"], str) and error["evaluated_at"]
    assert "recommended_action" in error
    assert "rows" not in response.json()
    assert "rows" not in error


def test_query_limit_exceeded_is_limit_exceeded(
    skifer: httpx.Client, auth_headers: dict[str, str]
) -> None:
    response = post_query(skifer, auth_headers, SIMPLE_QUERY, limit=1001)
    assert_error(response, 400, "LimitExceeded")


def test_unknown_metric_is_semantic_query_error_with_suggestions(
    skifer: httpx.Client, auth_headers: dict[str, str]
) -> None:
    body = {"model": "sales.orders", "metrics": ["not_a_metric"]}
    error = assert_error(post_query(skifer, auth_headers, body), 422, "SemanticQueryError")
    assert isinstance(error["suggestions"], list) and error["suggestions"]
    assert all(isinstance(name, str) for name in error["suggestions"])
    assert any("revenue" in name for name in error["suggestions"])
