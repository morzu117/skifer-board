"""Unit tests of the mock's `X-Mock-Scenario` header (D15, plan 01 §5 3.2): one per scenario."""

from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from skifer_mock.app import MOCK_SCENARIOS, create_app
from skifer_mock.catalog import FROZEN_AT

AUTH = {"Authorization": "Bearer mock-token"}
QUERY_BODY = {"model": "sales.orders", "metrics": ["revenue"], "group_by": ["region"]}


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def post_query(client: TestClient, scenario: str) -> httpx.Response:
    response: httpx.Response = client.post(
        "/api/v1/query", json=QUERY_BODY, headers={**AUTH, "X-Mock-Scenario": scenario}
    )
    return response


def test_deny_expired_denies_query_without_rows(client: TestClient) -> None:
    response = post_query(client, "deny_expired")
    assert response.status_code == 403
    payload = response.json()
    error = payload["error"]
    assert error["type"] == "SemanticAccessDenied"
    assert error["decision"] == "DENY"
    assert "EXPIRED" in error["reasons"]
    assert error["evaluated_at"] == FROZEN_AT
    assert "recommended_action" in error
    assert "rows" not in payload


def test_warn_stale_returns_rows_with_warn_policy(client: TestClient) -> None:
    response = post_query(client, "warn_stale")
    assert response.status_code == 200
    payload = response.json()
    assert payload["rows"]
    assert payload["evidence"]["policy"] == {
        "decision": "WARN",
        "reasons": ["STALE"],
        "evaluated_at": FROZEN_AT,
    }


def test_require_human_denies_query_without_rows(client: TestClient) -> None:
    response = post_query(client, "require_human")
    assert response.status_code == 403
    payload = response.json()
    error = payload["error"]
    assert error["type"] == "SemanticAccessDenied"
    assert error["decision"] == "REQUIRE_HUMAN"
    assert "MISSING" in error["reasons"]
    assert error["evaluated_at"] == FROZEN_AT
    assert "recommended_action" in error
    assert "rows" not in payload


def test_limit_exceeded(client: TestClient) -> None:
    response = post_query(client, "limit_exceeded")
    assert response.status_code == 400
    assert response.json()["error"]["type"] == "LimitExceeded"


def test_invalid_cursor(client: TestClient) -> None:
    response = post_query(client, "invalid_cursor")
    assert response.status_code == 400
    assert response.json()["error"]["type"] == "InvalidCursor"


def test_unknown_metric_has_suggestions(client: TestClient) -> None:
    response = post_query(client, "unknown_metric")
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["type"] == "SemanticQueryError"
    assert error["suggestions"]


def test_scope_denied(client: TestClient) -> None:
    response = post_query(client, "scope_denied")
    assert response.status_code == 403
    assert response.json()["error"]["type"] == "ScopeDenied"


def test_unavailable(client: TestClient) -> None:
    response = post_query(client, "unavailable")
    assert response.status_code == 503
    assert response.json()["error"]["type"] == "ResourceUnavailable"


def test_query_only_scenario_has_no_effect_on_other_routes(client: TestClient) -> None:
    response = client.get("/api/v1/models", headers={**AUTH, "X-Mock-Scenario": "deny_expired"})
    assert response.status_code == 200


def test_unknown_scenario_names_admitted_values(client: TestClient) -> None:
    response = post_query(client, "not-a-scenario")
    assert response.status_code == 400
    error = response.json()["error"]
    assert error["type"] == "InvalidRequest"
    for scenario in MOCK_SCENARIOS:
        assert scenario in error["message"]


def test_health_ignores_scenario(client: TestClient) -> None:
    response = client.get("/api/v1/health", headers={"X-Mock-Scenario": "unavailable"})
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_scenario_without_bearer_is_unauthenticated(client: TestClient) -> None:
    response = client.post(
        "/api/v1/query", json=QUERY_BODY, headers={"X-Mock-Scenario": "unavailable"}
    )
    assert response.status_code == 401
    assert response.json()["error"]["type"] == "Unauthenticated"


def test_contract_suite_never_sends_the_scenario_header() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    contract_src = repo_root / "tools" / "skifer_contract_tests" / "src"
    assert contract_src.is_dir()
    offenders: list[Path] = [
        path
        for path in contract_src.rglob("*.py")
        if "X-Mock-Scenario" in path.read_text(encoding="utf-8")
    ]
    assert offenders == []
