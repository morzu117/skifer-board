"""Shared fixtures of the skifer contract suite; the `skifer` client comes from `plugin.py`."""

import pytest


@pytest.fixture(scope="session")
def auth_headers(skifer_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {skifer_token}"}
