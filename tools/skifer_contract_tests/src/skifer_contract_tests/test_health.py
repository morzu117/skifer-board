"""Contract: `GET /health` answers without authentication."""

import httpx


def test_health_without_bearer(skifer: httpx.Client) -> None:
    response = skifer.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
