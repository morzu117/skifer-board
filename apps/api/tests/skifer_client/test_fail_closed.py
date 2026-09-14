"""Fail-closed (I3): a `DENY`/`REQUIRE_HUMAN` policy decision never becomes a `QueryResult`,
even on a 2xx response that carries rows by mistake. `WARN` still does."""

from typing import Any

import httpx
import pytest
from skifer_board.skifer_client import QueryRequest, SkiferClient
from skifer_board.skifer_client.errors import SemanticAccessDenied

pytestmark = pytest.mark.anyio

QUERY_REQUEST = QueryRequest(model="sales.orders", metrics=("revenue",))


def _query_result_body(decision: str) -> dict[str, Any]:
    return {
        "columns": [{"name": "revenue", "logical_type": "decimal"}],
        "rows": [{"revenue": 42.0}],
        "evidence": {
            "schema_version": "1",
            "evidence_id": "evi-1",
            "trace_id": "trace-1",
            "model_keys": ["sales.orders"],
            "metrics": [],
            "dimensions": [],
            "normalized_filters": [],
            "sources": [],
            "policy": {
                "decision": decision,
                "reasons": ["X"],
                "evaluated_at": "2026-09-13T00:00:00Z",
            },
            "sql_hash": "sha256:v1:" + "0" * 64,
            "statement_id": "stmt-1",
            "compiled_at": "2026-09-13T00:00:00Z",
            "executed_at": "2026-09-13T00:00:00Z",
            "execution_status": "succeeded",
            "execution_duration_seconds": 0.01,
            "execution_error_type": None,
        },
        "truncated": False,
    }


def _client_for(decision: str) -> SkiferClient:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_query_result_body(decision))

    return SkiferClient("http://testserver", "mock-token", transport=httpx.MockTransport(handler))


async def test_deny_decision_raises_despite_2xx_rows() -> None:
    async with _client_for("DENY") as client:
        with pytest.raises(SemanticAccessDenied) as excinfo:
            await client.query(QUERY_REQUEST)
    assert excinfo.value.decision == "DENY"
    assert excinfo.value.reasons == ("X",)
    assert excinfo.value.recommended_action is None


async def test_require_human_decision_raises_despite_2xx_rows() -> None:
    async with _client_for("REQUIRE_HUMAN") as client:
        with pytest.raises(SemanticAccessDenied) as excinfo:
            await client.query(QUERY_REQUEST)
    assert excinfo.value.decision == "REQUIRE_HUMAN"


async def test_warn_decision_returns_a_query_result() -> None:
    async with _client_for("WARN") as client:
        result = await client.query(QUERY_REQUEST)
    assert result.evidence.policy.decision == "WARN"
    assert result.rows == ({"revenue": 42.0},)


SENTINEL_ROW_VALUE = "ROW-SENTINEL-6-3"


def _query_result_body_with_sentinel_row(decision: str) -> dict[str, Any]:
    body = _query_result_body(decision)
    body["rows"] = [{"revenue": SENTINEL_ROW_VALUE}]
    return body


def _client_with_sentinel_row(decision: str) -> SkiferClient:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_query_result_body_with_sentinel_row(decision))

    return SkiferClient("http://testserver", "mock-token", transport=httpx.MockTransport(handler))


def _assert_denied_body_has_no_rows(error: SemanticAccessDenied, decision: str) -> None:
    expected_evidence = _query_result_body_with_sentinel_row(decision)["evidence"]
    assert error.body == {"evidence": expected_evidence}
    assert SENTINEL_ROW_VALUE not in str(error)
    assert SENTINEL_ROW_VALUE not in repr(error)
    assert SENTINEL_ROW_VALUE not in repr(error.body)
    assert SENTINEL_ROW_VALUE not in repr(error.args)


async def test_deny_decision_body_carries_only_evidence_no_rows() -> None:
    async with _client_with_sentinel_row("DENY") as client:
        with pytest.raises(SemanticAccessDenied) as excinfo:
            await client.query(QUERY_REQUEST)
    _assert_denied_body_has_no_rows(excinfo.value, "DENY")


async def test_require_human_decision_body_carries_only_evidence_no_rows() -> None:
    async with _client_with_sentinel_row("REQUIRE_HUMAN") as client:
        with pytest.raises(SemanticAccessDenied) as excinfo:
            await client.query(QUERY_REQUEST)
    _assert_denied_body_has_no_rows(excinfo.value, "REQUIRE_HUMAN")
