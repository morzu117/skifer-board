"""The dedicated D14/F1.5 test: nothing in an incoming request can reach the identity path.

`/api/me` only ever sends the board's own service bearer to skifer, and only ever returns the
board's own local identity plus what skifer resolves for that bearer — regardless of what a
caller forges in headers, cookies, or the query string.
"""

import httpx
from fastapi.testclient import TestClient
from skifer_board.app import create_app
from skifer_board.identity.local import local_identity
from skifer_board.identity.settings import BoardSettings
from skifer_mock.app import create_contract_app

FORGED_HEADERS = {
    "Authorization": "Bearer evil-token",
    "X-Consumer-Class": "admin",
    "X-Scopes": "query:execute,admin",
}


class _SpyTransport(httpx.AsyncBaseTransport):
    """Records every outgoing request before delegating to the wrapped transport."""

    def __init__(self, wrapped: httpx.AsyncBaseTransport) -> None:
        self._wrapped = wrapped
        self.requests: list[httpx.Request] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return await self._wrapped.handle_async_request(request)


def test_no_request_element_can_forge_the_identity() -> None:
    spy = _SpyTransport(httpx.ASGITransport(app=create_contract_app()))
    settings = BoardSettings(skifer_base_url="http://skifer.test", skifer_token="mock-token")
    app = create_app(settings, skifer_transport=spy)

    with TestClient(app) as client:
        baseline = client.get("/api/me")
        client.cookies.set("scopes", "admin")
        forged = client.get(
            "/api/me?consumer_class=admin&subject=root",
            headers=FORGED_HEADERS,
        )

    assert baseline.status_code == forged.status_code == 200
    assert baseline.content == forged.content

    assert len(spy.requests) == 2
    for outgoing in spy.requests:
        assert outgoing.headers["authorization"] == "Bearer mock-token"
        assert "x-consumer-class" not in outgoing.headers
        assert "x-scopes" not in outgoing.headers
        assert "cookie" not in outgoing.headers

    local = local_identity()
    body = forged.json()
    assert body["subject"] == local.subject
    assert body["consumer_class"] == local.consumer_class
