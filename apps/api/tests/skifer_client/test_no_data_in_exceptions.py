"""Sub-task 6.5 (D21): no content of a received 2xx body leaks through a `SkiferClient` exception.

Counter-proof: on the parent commit, `query`'s frame still binds `result` (and the full response
body) while raising on `DENY`/`REQUIRE_HUMAN`, and `_parse` still puts the whole 2xx body (or
`response.text`) into `UnexpectedResponse.body` and chains the raw `ValidationError`, whose
`str()` echoes an `input_value` snippet of the offending field — all of which would surface the
sentinel used below.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx
import pytest
import skifer_board
from skifer_board.skifer_client import QueryRequest, SkiferClient
from skifer_board.skifer_client.errors import (
    SemanticAccessDenied,
    SkiferClientError,
    UnexpectedResponse,
)

pytestmark = pytest.mark.anyio

SENTINEL = "ROW-SENTINEL-6-5"
_PACKAGE_ROOT = Path(skifer_board.__file__).resolve().parent


def _is_package_file(filename: str) -> bool:
    try:
        return Path(filename).resolve().is_relative_to(_PACKAGE_ROOT)
    except OSError:
        return False


def _chain(error: BaseException) -> list[BaseException]:
    chained: list[BaseException] = []
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        chained.append(current)
        current = current.__cause__ or current.__context__
    return chained


def _assert_sentinel_absent(error: SkiferClientError) -> None:
    assert SENTINEL not in str(error)
    assert SENTINEL not in repr(error)
    assert SENTINEL not in repr(error.args)
    assert SENTINEL not in repr(error.body)

    for exc in _chain(error):
        assert SENTINEL not in str(exc), f"leaked via str({type(exc).__name__})"
        assert SENTINEL not in repr(exc), f"leaked via repr({type(exc).__name__})"

        traceback = exc.__traceback__
        while traceback is not None:
            frame = traceback.tb_frame
            if _is_package_file(frame.f_code.co_filename):
                assert SENTINEL not in repr(frame.f_locals), (
                    f"leaked via locals of {frame.f_code.co_name} in "
                    f"{frame.f_code.co_filename}:{frame.f_lineno}"
                )
            traceback = traceback.tb_next


def _deny_query_body() -> dict[str, Any]:
    return {
        "columns": [{"name": "revenue", "logical_type": "decimal"}],
        "rows": [{"revenue": SENTINEL}],
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
                "decision": "DENY",
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


async def test_query_deny_leaves_no_row_data_anywhere_in_the_exception() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_deny_query_body())

    async with SkiferClient(
        "http://testserver", "mock-token", transport=httpx.MockTransport(handler)
    ) as client:
        with pytest.raises(SemanticAccessDenied) as excinfo:
            await client.query(QueryRequest(model="sales.orders", metrics=("revenue",)))

    error = excinfo.value
    assert error.body == {"evidence": _deny_query_body()["evidence"]}
    _assert_sentinel_absent(error)


async def test_parse_validation_error_leaves_no_body_content_in_the_exception() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"subject": SENTINEL, "consumer_class": "dashboard"})

    async with SkiferClient(
        "http://testserver", "mock-token", transport=httpx.MockTransport(handler)
    ) as client:
        with pytest.raises(UnexpectedResponse) as excinfo:
            await client.me()

    error = excinfo.value
    assert error.body == {"keys": ["consumer_class", "subject"]}
    assert "Identity" in error.message
    _assert_sentinel_absent(error)


async def test_parse_non_json_body_leaves_no_body_content_in_the_exception() -> None:
    content = SENTINEL.encode()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=content, headers={"content-type": "text/plain"})

    async with SkiferClient(
        "http://testserver", "mock-token", transport=httpx.MockTransport(handler)
    ) as client:
        with pytest.raises(UnexpectedResponse) as excinfo:
            await client.me()

    error = excinfo.value
    assert error.body == {"length": len(content)}
    assert "Identity" in error.message
    _assert_sentinel_absent(error)
