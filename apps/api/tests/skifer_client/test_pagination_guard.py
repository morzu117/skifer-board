"""`iter_models` stops instead of looping forever when `next_cursor` does not progress."""

from typing import Any

import httpx
import pytest
from skifer_board.skifer_client import SkiferClient
from skifer_board.skifer_client.errors import UnexpectedResponse

pytestmark = pytest.mark.anyio


def _page(key: str, next_cursor: str | None) -> dict[str, Any]:
    return {
        "items": [{"key": key, "description": "d", "layer": None, "tags": []}],
        "next_cursor": next_cursor,
        "total": 3,
    }


async def test_repeated_next_cursor_stops_after_the_repeating_page() -> None:
    calls: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        cursor = request.url.params.get("cursor")
        calls.append(cursor)
        key = "m1" if cursor is None else "m2"
        return httpx.Response(200, json=_page(key, "c1"))

    collected: list[str] = []
    async with SkiferClient(
        "http://testserver", "mock-token", transport=httpx.MockTransport(handler)
    ) as client:
        with pytest.raises(UnexpectedResponse):
            async for item in client.iter_models(limit=50):
                collected.append(item.key)

    assert collected == ["m1", "m2"]
    assert calls == [None, "c1"]


async def test_normal_progression_yields_every_item_across_pages() -> None:
    pages = [_page("m1", "c1"), _page("m2", "c2"), _page("m3", None)]
    state = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        response = httpx.Response(200, json=pages[state["n"]])
        state["n"] += 1
        return response

    async with SkiferClient(
        "http://testserver", "mock-token", transport=httpx.MockTransport(handler)
    ) as client:
        items = [item.key async for item in client.iter_models(limit=50)]

    assert items == ["m1", "m2", "m3"]
    assert state["n"] == 3
