"""Unit tests of the skifer mock catalogue, identity and authentication routes."""

import pytest
from fastapi.testclient import TestClient
from skifer_mock.app import create_app, encode_cursor
from skifer_mock.catalog import CATALOG, MONTHS

AUTH = {"Authorization": "Bearer mock-token"}


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def test_catalogue_matches_plan_section_4() -> None:
    assert sorted(CATALOG) == ["finance.invoices", "sales.customers", "sales.orders"]
    orders = CATALOG["sales.orders"]
    assert [dimension.name for dimension in orders.dimensions] == [
        "order_date",
        "order_month",
        "region",
        "channel",
        "customer_id",
    ]
    assert [metric.name for metric in orders.metrics] == ["revenue", "order_count", "avg_basket"]
    assert orders.periods == ("last_12_months", "ytd", "previous_year")
    assert orders.related_models == ("sales.customers",)
    assert CATALOG["sales.customers"].related_models == ("sales.orders",)
    assert CATALOG["finance.invoices"].source.certification_status == "EXPIRED"
    assert CATALOG["finance.invoices"].decision == "DENY"
    assert MONTHS[0] == "2025-10" and MONTHS[-1] == "2026-09" and len(MONTHS) == 12


def test_health_needs_no_bearer(client: TestClient) -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.parametrize(
    "headers",
    [{}, {"Authorization": "Bearer wrong"}, {"Authorization": "Basic mock-token"}],
)
def test_me_rejects_missing_or_invalid_bearer(client: TestClient, headers: dict[str, str]) -> None:
    response = client.get("/api/v1/me", headers=headers)
    assert response.status_code == 401
    assert response.json() == {
        "error": {"type": "Unauthenticated", "message": "A valid bearer token is required."}
    }


def test_me_returns_the_mock_identity(client: TestClient) -> None:
    response = client.get("/api/v1/me", headers=AUTH)
    assert response.status_code == 200
    assert response.json() == {
        "subject": "mock-user",
        "consumer_class": "dashboard",
        "scopes": ["models:read", "query:execute"],
    }


def test_custom_token() -> None:
    client = TestClient(create_app(token="other"))
    assert client.get("/api/v1/me", headers=AUTH).status_code == 401
    assert client.get("/api/v1/me", headers={"Authorization": "Bearer other"}).status_code == 200


def test_models_default_page_lists_everything(client: TestClient) -> None:
    payload = client.get("/api/v1/models", headers=AUTH).json()
    assert payload["total"] == 3
    assert payload["next_cursor"] is None
    assert payload["items"][0] == {
        "key": "finance.invoices",
        "description": "Issued invoices and their payment status.",
        "layer": "gold",
        "tags": ["finance"],
    }


def test_models_pagination_follows_cursors(client: TestClient) -> None:
    keys: list[str] = []
    cursor: str | None = None
    for _ in range(3):
        params: dict[str, str | int] = {"limit": 1}
        if cursor is not None:
            params["cursor"] = cursor
        payload = client.get("/api/v1/models", params=params, headers=AUTH).json()
        keys.extend(item["key"] for item in payload["items"])
        cursor = payload["next_cursor"]
    assert keys == ["finance.invoices", "sales.customers", "sales.orders"]
    assert cursor is None


@pytest.mark.parametrize("cursor", ["not-a-cursor!", encode_cursor(3), encode_cursor(-1)])
def test_invalid_cursor_is_invalid_request(client: TestClient, cursor: str) -> None:
    response = client.get("/api/v1/models", params={"cursor": cursor}, headers=AUTH)
    assert response.status_code == 400
    assert response.json()["error"]["type"] == "InvalidCursor"


@pytest.mark.parametrize("limit", [0, 101])
def test_models_limit_out_of_bounds_is_invalid_request(client: TestClient, limit: int) -> None:
    response = client.get("/api/v1/models", params={"limit": limit}, headers=AUTH)
    assert response.status_code == 400
    assert response.json()["error"]["type"] == "LimitExceeded"


def test_model_view(client: TestClient) -> None:
    response = client.get("/api/v1/models/sales.customers", headers=AUTH)
    assert response.status_code == 200
    assert response.json() == {
        "key": "sales.customers",
        "description": "Customers, joined to orders through customer_id.",
        "layer": "gold",
        "tags": ["sales"],
        "dimensions": ["customer_id", "segment", "country"],
        "metrics": ["customer_count"],
        "entities": ["customer"],
        "related_models": ["sales.orders"],
    }


def test_unknown_model_view_is_not_found(client: TestClient) -> None:
    response = client.get("/api/v1/models/sales.unknown", headers=AUTH)
    assert response.status_code == 404
    assert response.json() == {
        "error": {"type": "ResourceNotFound", "message": "Unknown model 'sales.unknown'."}
    }


def test_unimplemented_routes_are_not_exposed(client: TestClient) -> None:
    assert client.get("/api/v1/contracts/sales_orders/1.0.0", headers=AUTH).status_code == 404
    assert client.get("/openapi.json", headers=AUTH).status_code == 404
