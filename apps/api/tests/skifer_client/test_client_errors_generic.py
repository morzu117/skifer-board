"""Generic error path of `SkiferClient`: non-2xx and malformed 2xx bodies.

Typed errors per SK-02.5 (`SemanticAccessDenied`, `ScopeDenied`, ...) arrive in 4.2; here every
failure surfaces as the same `SkiferClientError` carrying the status code and the decoded body.
"""

import httpx
import pytest
from skifer_board.skifer_client import QueryRequest, SkiferClient, SkiferClientError
from skifer_mock.app import create_contract_app

pytestmark = pytest.mark.anyio


async def test_unknown_model_is_client_error_404(client: SkiferClient) -> None:
    with pytest.raises(SkiferClientError) as excinfo:
        await client.get_model("contract.unknown_model")
    assert excinfo.value.status_code == 404


async def test_denied_model_raises_without_result(client: SkiferClient) -> None:
    request = QueryRequest(model="finance.invoices", metrics=("invoiced_amount",))
    with pytest.raises(SkiferClientError) as excinfo:
        await client.query(request)
    assert excinfo.value.status_code == 403


async def test_invalid_bearer_is_client_error_401() -> None:
    async with SkiferClient(
        "http://testserver",
        "not-the-contract-token",
        transport=httpx.ASGITransport(app=create_contract_app()),
    ) as skifer:
        with pytest.raises(SkiferClientError) as excinfo:
            await skifer.me()
    assert excinfo.value.status_code == 401


async def test_malformed_2xx_body_is_client_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b'{"subject": "u", "consumer_class": "x"')

    async with SkiferClient(
        "http://testserver", "mock-token", transport=httpx.MockTransport(handler)
    ) as skifer:
        with pytest.raises(SkiferClientError):
            await skifer.me()
