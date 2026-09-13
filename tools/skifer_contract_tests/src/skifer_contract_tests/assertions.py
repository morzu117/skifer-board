"""Assertions shared by the contract tests."""

from typing import Any

import httpx


def assert_error(response: httpx.Response, status_code: int, error_type: str) -> dict[str, Any]:
    """Check an error response `{"error": {"type", "message", ...}}` and return its `error`."""
    assert response.status_code == status_code, response.text
    payload = response.json()
    assert set(payload) == {"error"}
    error = payload["error"]
    assert error["type"] == error_type
    assert isinstance(error["message"], str) and error["message"]
    return dict(error)
