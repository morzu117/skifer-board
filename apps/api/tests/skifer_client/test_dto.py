"""DTO shape and serialization guarantees (SK-02.2, D14)."""

import pytest
from pydantic import ValidationError
from skifer_board.skifer_client import Evidence, QueryFilter, QueryRequest

EVIDENCE_PAYLOAD = {
    "schema_version": "1",
    "evidence_id": "evid-1",
    "trace_id": "trace-1",
    "model_keys": ["sales.orders"],
    "metrics": [
        {
            "name": "revenue",
            "model_key": "sales.orders",
            "definition_hash": "sha256:v1:" + "0" * 64,
            "source_columns": ["amount"],
            "lineage_status": "resolved",
        }
    ],
    "dimensions": ["region"],
    "normalized_filters": [],
    "sources": [
        {
            "dataset": "gold.sales_orders",
            "contract_id": "sales_orders",
            "contract_version": "1.0.0",
            "definition_hash": "sha256:v1:" + "1" * 64,
            "certification_status": "CERTIFIED",
            "certified_at": "2026-09-13T00:00:00Z",
            "load_age_seconds": 3600.0,
            "data_age_seconds": 7200.0,
            "certification_run_id": "run-1",
        }
    ],
    "policy": {"decision": "ALLOW", "reasons": [], "evaluated_at": "2026-09-13T00:00:00Z"},
    "sql_hash": "sha256:v1:" + "2" * 64,
    "statement_id": "stmt-1",
    "compiled_at": "2026-09-13T00:00:00Z",
    "executed_at": "2026-09-13T00:00:00Z",
    "execution_status": "succeeded",
    "execution_duration_seconds": 0.042,
    "execution_error_type": None,
}


def test_query_request_rejects_sql_field() -> None:
    with pytest.raises(ValidationError):
        QueryRequest.model_validate(
            {"model": "sales.orders", "metrics": ["revenue"], "sql": "SELECT 1"}
        )


def test_query_request_rejects_limit_field() -> None:
    with pytest.raises(ValidationError):
        QueryRequest.model_validate({"model": "sales.orders", "metrics": ["revenue"], "limit": 10})


def test_query_filter_rejects_unknown_operator() -> None:
    with pytest.raises(ValidationError):
        QueryFilter.model_validate({"column": "region", "operator": "not_an_operator"})


def test_evidence_tolerates_unknown_field() -> None:
    evidence = Evidence.model_validate({**EVIDENCE_PAYLOAD, "future_field": "x"})
    assert evidence.sql_hash == EVIDENCE_PAYLOAD["sql_hash"]


def test_query_request_serialization_omits_none() -> None:
    request = QueryRequest(model="sales.orders", metrics=("revenue",))
    body = request.model_dump(mode="json", exclude_none=True)
    assert "date_from" not in body
    assert "date_to" not in body
    assert "period" not in body
