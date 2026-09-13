"""Unit tests of `POST /query` on the skifer mock."""

import re
import uuid
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from skifer_mock.app import EVIDENCE_NAMESPACE, canonical_json, create_app
from skifer_mock.catalog import FROZEN_AT

AUTH = {"Authorization": "Bearer mock-token"}

EVIDENCE_KEYS = [
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
]
SOURCE_KEYS = [
    "dataset",
    "contract_id",
    "contract_version",
    "definition_hash",
    "certification_status",
    "certified_at",
    "load_age_seconds",
    "data_age_seconds",
    "certification_run_id",
]
METRIC_KEYS = ["name", "model_key", "definition_hash", "source_columns", "lineage_status"]


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def post_query(
    client: TestClient, body: dict[str, Any], limit: int | None = None
) -> httpx.Response:
    params = {} if limit is None else {"limit": limit}
    response: httpx.Response = client.post("/api/v1/query", json=body, params=params, headers=AUTH)
    return response


def test_identical_requests_are_byte_identical(client: TestClient) -> None:
    body = {"model": "sales.orders", "metrics": ["revenue", "order_count"], "group_by": ["region"]}
    first = post_query(client, body)
    second = post_query(client, body)
    other_app = post_query(TestClient(create_app()), body)
    assert first.status_code == 200
    assert first.content == second.content == other_app.content


def test_rows_are_the_cartesian_product_in_group_by_order(client: TestClient) -> None:
    body = {"model": "sales.orders", "metrics": ["order_count"], "group_by": ["region", "channel"]}
    payload = post_query(client, body).json()
    assert [(row["region"], row["channel"]) for row in payload["rows"]] == [
        ("EMEA", "web"),
        ("EMEA", "store"),
        ("NA", "web"),
        ("NA", "store"),
        ("APAC", "web"),
        ("APAC", "store"),
    ]
    assert payload["columns"] == [
        {"name": "region", "logical_type": "string"},
        {"name": "channel", "logical_type": "string"},
        {"name": "order_count", "logical_type": "integer"},
    ]
    assert payload["truncated"] is False
    assert all(list(row) == ["region", "channel", "order_count"] for row in payload["rows"])


def test_query_without_group_by_returns_one_row(client: TestClient) -> None:
    payload = post_query(client, {"model": "sales.orders", "metrics": ["revenue"]}).json()
    assert len(payload["rows"]) == 1
    assert list(payload["rows"][0]) == ["revenue"]


def test_date_dimension_has_date_logical_type(client: TestClient) -> None:
    body = {"model": "sales.orders", "metrics": ["revenue"], "group_by": ["order_date"]}
    payload = post_query(client, body).json()
    assert payload["columns"][0] == {"name": "order_date", "logical_type": "date"}
    assert payload["rows"][0]["order_date"] == "2025-10-01"
    assert len(payload["rows"]) == 12


def test_metric_values_are_typed_by_logical_type(client: TestClient) -> None:
    body = {
        "model": "sales.orders",
        "metrics": ["order_count", "revenue", "avg_basket"],
        "group_by": ["order_month"],
    }
    for row in post_query(client, body).json()["rows"]:
        assert isinstance(row["order_count"], int)
        for name in ("revenue", "avg_basket"):
            assert isinstance(row[name], float)
            assert round(row[name], 2) == row[name]


def test_limit_truncates_rows(client: TestClient) -> None:
    body = {"model": "sales.orders", "metrics": ["revenue"], "group_by": ["region", "channel"]}
    truncated = post_query(client, body, limit=5).json()
    assert truncated["truncated"] is True
    assert len(truncated["rows"]) == 5
    exact = post_query(client, body, limit=6).json()
    assert exact["truncated"] is False
    assert len(exact["rows"]) == 6
    assert exact["rows"][:5] == truncated["rows"]


@pytest.mark.parametrize(
    ("query_filter", "expected"),
    [
        ({"column": "region", "operator": "eq", "value": "NA"}, ["NA"]),
        ({"column": "region", "operator": "neq", "value": "NA"}, ["EMEA", "APAC"]),
        ({"column": "region", "operator": "in", "value": ["APAC", "EMEA"]}, ["EMEA", "APAC"]),
        ({"column": "region", "operator": "gt", "value": "NA"}, ["EMEA", "NA", "APAC"]),
    ],
)
def test_filters_on_group_by_dimensions(
    client: TestClient, query_filter: dict[str, Any], expected: list[str]
) -> None:
    body = {
        "model": "sales.orders",
        "metrics": ["revenue"],
        "group_by": ["region"],
        "filters": [query_filter],
    }
    payload = post_query(client, body).json()
    assert [row["region"] for row in payload["rows"]] == expected


def test_filter_outside_group_by_keeps_rows_but_changes_the_query(client: TestClient) -> None:
    body: dict[str, Any] = {"model": "sales.orders", "metrics": ["revenue"], "group_by": ["region"]}
    filtered = {**body, "filters": [{"column": "channel", "operator": "eq", "value": "web"}]}
    plain_payload = post_query(client, body).json()
    filtered_payload = post_query(client, filtered).json()
    assert [row["region"] for row in filtered_payload["rows"]] == ["EMEA", "NA", "APAC"]
    assert filtered_payload["evidence"]["sql_hash"] != plain_payload["evidence"]["sql_hash"]
    assert filtered_payload["evidence"]["normalized_filters"] == [
        {"column": "channel", "operator": "eq", "value": "<redacted>"}
    ]


def test_evidence_is_complete_with_exact_keys(client: TestClient) -> None:
    body = {"model": "sales.orders", "metrics": ["revenue"], "group_by": ["region"]}
    evidence = post_query(client, body).json()["evidence"]
    assert list(evidence) == EVIDENCE_KEYS
    assert evidence["schema_version"] == "1"
    assert evidence["model_keys"] == ["sales.orders"]
    assert [list(metric) for metric in evidence["metrics"]] == [METRIC_KEYS]
    assert evidence["metrics"][0]["definition_hash"].startswith("sha256:v1:")
    assert evidence["dimensions"] == ["region"]
    assert evidence["normalized_filters"] == []
    assert [list(source) for source in evidence["sources"]] == [SOURCE_KEYS]
    assert evidence["sources"][0]["certification_status"] == "CERTIFIED"
    assert evidence["policy"] == {"decision": "ALLOW", "reasons": [], "evaluated_at": FROZEN_AT}
    assert re.fullmatch(r"sha256:v1:[0-9a-f]{64}", evidence["sql_hash"])
    assert evidence["compiled_at"] == evidence["executed_at"] == FROZEN_AT
    assert evidence["execution_status"] == "succeeded"
    assert evidence["execution_error_type"] is None
    normalized = {
        "model": "sales.orders",
        "metrics": ["revenue"],
        "group_by": ["region"],
        "filters": [],
        "date_from": None,
        "date_to": None,
        "period": None,
    }
    assert evidence["evidence_id"] == str(
        uuid.uuid5(EVIDENCE_NAMESPACE, canonical_json(normalized))
    )


def test_sql_hash_is_stable_and_distinguishes_queries(client: TestClient) -> None:
    body = {"model": "sales.orders", "metrics": ["revenue"], "group_by": ["region"]}
    other = {**body, "period": "ytd"}
    first = post_query(client, body).json()["evidence"]["sql_hash"]
    again = post_query(client, body).json()["evidence"]["sql_hash"]
    different = post_query(client, other).json()["evidence"]["sql_hash"]
    assert first == again
    assert first != different


def test_join_through_related_model(client: TestClient) -> None:
    body = {"model": "sales.orders", "metrics": ["revenue"], "group_by": ["segment"]}
    response = post_query(client, body)
    assert response.status_code == 200
    payload = response.json()
    assert [row["segment"] for row in payload["rows"]] == ["smb", "enterprise"]
    assert payload["evidence"]["model_keys"] == ["sales.orders", "sales.customers"]
    assert [source["dataset"] for source in payload["evidence"]["sources"]] == [
        "gold.sales_orders",
        "gold.sales_customers",
    ]


def test_denied_model_returns_403_without_rows(client: TestClient) -> None:
    body = {"model": "finance.invoices", "metrics": ["invoiced_amount"], "group_by": ["status"]}
    response = post_query(client, body)
    assert response.status_code == 403
    payload = response.json()
    assert list(payload) == ["error"]
    assert payload["error"] == {
        "type": "SemanticAccessDenied",
        "message": "The certification gate denies access to 'finance.invoices'.",
        "decision": "DENY",
        "reasons": ["EXPIRED"],
        "evaluated_at": FROZEN_AT,
        "recommended_action": (
            "Renew the certification of gold.finance_invoices before querying it."
        ),
    }
    assert b"rows" not in response.content


@pytest.mark.parametrize(
    "body",
    [
        {"model": "sales.orders", "metrics": ["revenue"], "sql": "SELECT 1"},
        {"model": "sales.orders", "metrics": "revenue"},
        {"model": "sales.orders", "metrics": ["revenue"], "limit": 10},
        {"model": "sales.orders", "metrics": ["revenue"], "filters": [{"column": "region"}]},
        {"metrics": ["revenue"]},
    ],
)
def test_non_conforming_body_is_invalid_request(client: TestClient, body: dict[str, Any]) -> None:
    response = post_query(client, body)
    assert response.status_code == 400
    assert response.json()["error"]["type"] == "InvalidRequest"


@pytest.mark.parametrize("limit", [0, 1001])
def test_query_limit_out_of_bounds_is_invalid_request(client: TestClient, limit: int) -> None:
    response = post_query(client, {"model": "sales.orders", "metrics": ["revenue"]}, limit=limit)
    assert response.status_code == 400
    assert response.json()["error"]["type"] == "LimitExceeded"


def test_unknown_model_is_not_found(client: TestClient) -> None:
    response = post_query(client, {"model": "sales.unknown", "metrics": ["revenue"]})
    assert response.status_code == 404
    assert response.json()["error"]["type"] == "ResourceNotFound"


def test_unknown_metric_is_a_semantic_query_error_with_suggestions(client: TestClient) -> None:
    response = post_query(client, {"model": "sales.orders", "metrics": ["margin"]})
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["type"] == "SemanticQueryError"
    assert error["suggestions"] == ["avg_basket", "customer_count", "order_count", "revenue"]


def test_query_requires_bearer(client: TestClient) -> None:
    response = client.post("/api/v1/query", json={"model": "sales.orders", "metrics": ["x"]})
    assert response.status_code == 401
    assert response.json()["error"]["type"] == "Unauthenticated"
