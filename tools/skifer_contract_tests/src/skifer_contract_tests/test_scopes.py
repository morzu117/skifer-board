"""Contract: scopes exposed by `/me` and enforced on `POST /query` (D15)."""

import httpx

from skifer_contract_tests.assertions import assert_error


def test_readonly_token_has_no_query_scope(
    skifer: httpx.Client, readonly_headers: dict[str, str]
) -> None:
    response = skifer.get("/me", headers=readonly_headers)
    assert response.status_code == 200, response.text
    assert "query:execute" not in response.json()["scopes"]


def test_readonly_token_can_list_models(
    skifer: httpx.Client, readonly_headers: dict[str, str]
) -> None:
    response = skifer.get("/models", params={"limit": 1}, headers=readonly_headers)
    assert response.status_code == 200, response.text


def test_readonly_token_cannot_query(
    skifer: httpx.Client, readonly_headers: dict[str, str]
) -> None:
    body = {"model": "sales.orders", "metrics": ["revenue"]}
    response = skifer.post("/query", json=body, headers=readonly_headers)
    assert_error(response, 403, "ScopeDenied")
