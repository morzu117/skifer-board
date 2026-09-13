"""Shared fixtures of the skifer_client tests: the contract mock in process, no network (I2)."""

from collections.abc import AsyncIterator

import httpx
import pytest
from skifer_board.skifer_client import SkiferClient
from skifer_mock.app import create_contract_app


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
async def client() -> AsyncIterator[SkiferClient]:
    async with SkiferClient(
        "http://testserver",
        "mock-token",
        transport=httpx.ASGITransport(app=create_contract_app()),
    ) as skifer:
        yield skifer
