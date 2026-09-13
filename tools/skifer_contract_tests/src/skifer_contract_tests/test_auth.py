"""Contract: bearer authentication and `GET /me`."""

import httpx

from skifer_contract_tests.assertions import assert_error


def test_me_without_bearer_is_unauthenticated(skifer: httpx.Client) -> None:
    assert_error(skifer.get("/me"), 401, "Unauthenticated")


def test_me_with_invalid_bearer_is_unauthenticated(skifer: httpx.Client) -> None:
    response = skifer.get("/me", headers={"Authorization": "Bearer not-the-contract-token"})
    assert_error(response, 401, "Unauthenticated")


def test_me_with_bearer(skifer: httpx.Client, auth_headers: dict[str, str]) -> None:
    response = skifer.get("/me", headers=auth_headers)
    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {"subject", "consumer_class", "scopes"}
    assert isinstance(payload["subject"], str) and payload["subject"]
    assert isinstance(payload["consumer_class"], str) and payload["consumer_class"]
    assert isinstance(payload["scopes"], list)
    assert all(isinstance(scope, str) for scope in payload["scopes"])
