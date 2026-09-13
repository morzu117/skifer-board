"""Nominal path of `SkiferClient` against the contract mock (SK-02.1-02.3, D14)."""

import re

import pytest
from skifer_board.skifer_client import QueryRequest, SkiferClient

SQL_HASH = re.compile(r"sha256:v1:[0-9a-f]{64}")

pytestmark = pytest.mark.anyio


async def test_health(client: SkiferClient) -> None:
    assert await client.health() is True


async def test_me_has_query_execute_scope(client: SkiferClient) -> None:
    identity = await client.me()
    assert "query:execute" in identity.scopes


async def test_list_models_and_iter_models_agree(client: SkiferClient) -> None:
    manual_keys: list[str] = []
    totals: set[int] = set()
    cursor: str | None = None
    while True:
        page = await client.list_models(cursor=cursor, limit=1)
        manual_keys.extend(item.key for item in page.items)
        totals.add(page.total)
        if page.next_cursor is None:
            break
        cursor = page.next_cursor

    iterated_keys = [item.key async for item in client.iter_models(limit=1)]

    assert iterated_keys == manual_keys
    assert len(manual_keys) == len(set(manual_keys))
    assert totals == {len(manual_keys)}


async def test_get_model(client: SkiferClient) -> None:
    view = await client.get_model("sales.orders")
    assert view.key == "sales.orders"
    assert "sales.customers" in view.related_models


async def test_simple_query(client: SkiferClient) -> None:
    request = QueryRequest(model="sales.orders", metrics=("revenue",), group_by=("region",))
    result = await client.query(request)
    assert [column.name for column in result.columns] == ["region", "revenue"]
    assert SQL_HASH.fullmatch(result.evidence.sql_hash)
    assert result.evidence.policy.decision == "ALLOW"


async def test_query_with_join(client: SkiferClient) -> None:
    request = QueryRequest(model="sales.orders", metrics=("revenue",), group_by=("segment",))
    result = await client.query(request)
    assert {"sales.orders", "sales.customers"} <= set(result.evidence.model_keys)


async def test_query_truncated(client: SkiferClient) -> None:
    request = QueryRequest(
        model="sales.orders", metrics=("revenue",), group_by=("region", "channel")
    )
    result = await client.query(request, limit=1)
    assert result.truncated is True
    assert len(result.rows) == 1


async def test_same_query_twice_is_stable(client: SkiferClient) -> None:
    request = QueryRequest(model="sales.orders", metrics=("revenue",), group_by=("region",))
    first = await client.query(request)
    second = await client.query(request)
    assert first.evidence.sql_hash == second.evidence.sql_hash


async def test_warn_model_returns_result_with_warn_decision(client: SkiferClient) -> None:
    request = QueryRequest(model="ops.stale_orders", metrics=("revenue",))
    result = await client.query(request)
    assert result.evidence.policy.decision == "WARN"
