"""Contract: `GET /models` pagination and `GET /models/{key}`."""

from typing import Any

import httpx

from skifer_contract_tests.assertions import assert_error

CATALOGUE_KEYS = {"sales.orders", "sales.customers", "finance.invoices"}
SUMMARY_KEYS = {"key", "description", "layer", "tags"}
VIEW_KEYS = SUMMARY_KEYS | {"dimensions", "metrics", "entities", "related_models"}
MAX_PAGES = 1000


def list_all_models(skifer: httpx.Client, auth_headers: dict[str, str]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    totals: set[int] = set()
    cursor: str | None = None
    for _ in range(MAX_PAGES):
        params: dict[str, str | int] = {"limit": 1}
        if cursor is not None:
            params["cursor"] = cursor
        response = skifer.get("/models", params=params, headers=auth_headers)
        assert response.status_code == 200, response.text
        page = response.json()
        assert set(page) == {"items", "next_cursor", "total"}
        assert len(page["items"]) <= 1
        items.extend(page["items"])
        totals.add(page["total"])
        cursor = page["next_cursor"]
        if cursor is None:
            break
        assert isinstance(cursor, str) and cursor
    else:
        raise AssertionError(f"pagination did not end after {MAX_PAGES} pages")
    assert len(totals) == 1
    assert totals.pop() == len(items)
    return items


def test_models_pagination_is_complete(skifer: httpx.Client, auth_headers: dict[str, str]) -> None:
    items = list_all_models(skifer, auth_headers)
    keys = [item["key"] for item in items]
    assert len(keys) == len(set(keys))
    assert CATALOGUE_KEYS <= set(keys)
    for item in items:
        assert set(item) == SUMMARY_KEYS
        assert isinstance(item["tags"], list)


def test_every_listed_model_can_be_read(skifer: httpx.Client, auth_headers: dict[str, str]) -> None:
    for item in list_all_models(skifer, auth_headers):
        response = skifer.get(f"/models/{item['key']}", headers=auth_headers)
        assert response.status_code == 200, response.text
        view = response.json()
        assert set(view) == VIEW_KEYS
        assert view["key"] == item["key"]
        for field in ("tags", "dimensions", "metrics", "entities", "related_models"):
            assert isinstance(view[field], list)
            assert all(isinstance(name, str) for name in view[field])


def test_related_models_of_the_catalogue(
    skifer: httpx.Client, auth_headers: dict[str, str]
) -> None:
    orders = skifer.get("/models/sales.orders", headers=auth_headers).json()
    customers = skifer.get("/models/sales.customers", headers=auth_headers).json()
    assert "sales.customers" in orders["related_models"]
    assert "sales.orders" in customers["related_models"]


def test_unknown_model_is_not_found(skifer: httpx.Client, auth_headers: dict[str, str]) -> None:
    response = skifer.get("/models/contract.unknown_model", headers=auth_headers)
    assert_error(response, 404, "ResourceNotFound")


def test_models_limit_exceeded_is_limit_exceeded(
    skifer: httpx.Client, auth_headers: dict[str, str]
) -> None:
    response = skifer.get("/models", params={"limit": 101}, headers=auth_headers)
    assert_error(response, 400, "LimitExceeded")


def test_models_invalid_cursor_is_invalid_cursor(
    skifer: httpx.Client, auth_headers: dict[str, str]
) -> None:
    response = skifer.get("/models", params={"cursor": "not-a-cursor"}, headers=auth_headers)
    assert_error(response, 400, "InvalidCursor")
