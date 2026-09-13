"""`create_app` wires a single service-scoped `SkiferClient`; `/api/me` never leaks it (D14)."""

import httpx
import pytest
from fastapi.testclient import TestClient
from skifer_board.app import create_app
from skifer_board.identity.settings import SKIFER_TOKEN_ENV, BoardConfigurationError, BoardSettings
from skifer_mock.app import create_contract_app


def _settings(token: str = "mock-token") -> BoardSettings:
    return BoardSettings(skifer_base_url="http://skifer.test", skifer_token=token)


def test_health_does_not_call_skifer() -> None:
    app = create_app(_settings())
    with TestClient(app) as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_me_returns_local_and_skifer_identity() -> None:
    transport = httpx.ASGITransport(app=create_contract_app())
    app = create_app(_settings(), skifer_transport=transport)
    with TestClient(app) as client:
        response = client.get("/api/me")
    assert response.status_code == 200
    body = response.json()
    assert "query:execute" in body["skifer"]["scopes"]
    assert body["subject"]
    assert body["consumer_class"] == "dashboard"


def test_create_app_without_token_in_environ_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(SKIFER_TOKEN_ENV, raising=False)
    with pytest.raises(BoardConfigurationError):
        create_app()


def test_bad_service_token_returns_502_without_leaking_the_body() -> None:
    transport = httpx.ASGITransport(app=create_contract_app())
    app = create_app(_settings(token="wrong-token"), skifer_transport=transport)
    with TestClient(app) as client:
        response = client.get("/api/me")
    assert response.status_code == 502
    body = response.json()
    assert body == {
        "error": {
            "type": "Unauthenticated",
            "message": "A valid bearer token is required.",
        }
    }
    assert "wrong-token" not in response.text
