"""Typed errors of `SkiferClient` against the mock (SK-02.5, D14): one raised type per scenario.

`MOCK_SCENARIOS` is imported straight from the mock, not copied, so a scenario the mock adds
later fails this suite's parametrization or its completeness check instead of going untested.
"""

from collections.abc import Callable

import httpx
import pytest
from skifer_board.skifer_client import (
    InvalidCursor,
    LimitExceeded,
    QueryRequest,
    ResourceNotFound,
    ResourceUnavailable,
    ScopeDenied,
    SemanticAccessDenied,
    SemanticQueryError,
    SkiferClient,
    SkiferClientError,
    Unauthenticated,
    UnexpectedResponse,
)
from skifer_mock.app import MOCK_SCENARIOS, SCENARIO_HEADER, create_contract_app

pytestmark = pytest.mark.anyio

QUERY_REQUEST = QueryRequest(model="sales.orders", metrics=("revenue",))


class ScenarioTransport(httpx.AsyncBaseTransport):
    """Test-only transport: forces `X-Mock-Scenario` on every request (no production knob for
    this exists on `SkiferClient`, by design)."""

    def __init__(self, inner: httpx.AsyncBaseTransport, scenario: str) -> None:
        self._inner = inner
        self._scenario = scenario

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        request.headers[SCENARIO_HEADER] = self._scenario
        return await self._inner.handle_async_request(request)


def _scenario_client(scenario: str, token: str = "mock-token") -> SkiferClient:
    transport = ScenarioTransport(httpx.ASGITransport(app=create_contract_app()), scenario)
    return SkiferClient("http://testserver", token, transport=transport)


def _assert_deny_expired(error: SkiferClientError) -> None:
    assert isinstance(error, SemanticAccessDenied)
    assert error.decision == "DENY"
    assert "EXPIRED" in error.reasons


def _assert_require_human(error: SkiferClientError) -> None:
    assert isinstance(error, SemanticAccessDenied)
    assert error.decision == "REQUIRE_HUMAN"


def _assert_unknown_metric(error: SkiferClientError) -> None:
    assert isinstance(error, SemanticQueryError)
    assert error.suggestions


def _assert_scope_denied(error: SkiferClientError) -> None:
    assert isinstance(error, ScopeDenied)


def _assert_unavailable(error: SkiferClientError) -> None:
    assert isinstance(error, ResourceUnavailable)


def _assert_limit_exceeded(error: SkiferClientError) -> None:
    assert isinstance(error, LimitExceeded)


def _assert_invalid_cursor(error: SkiferClientError) -> None:
    assert isinstance(error, InvalidCursor)


SCENARIO_ASSERTIONS: dict[str, Callable[[SkiferClientError], None]] = {
    "deny_expired": _assert_deny_expired,
    "require_human": _assert_require_human,
    "limit_exceeded": _assert_limit_exceeded,
    "invalid_cursor": _assert_invalid_cursor,
    "unknown_metric": _assert_unknown_metric,
    "scope_denied": _assert_scope_denied,
    "unavailable": _assert_unavailable,
}


def test_all_mock_scenarios_are_covered() -> None:
    assert set(SCENARIO_ASSERTIONS) | {"warn_stale"} == set(MOCK_SCENARIOS)


@pytest.mark.parametrize("scenario", MOCK_SCENARIOS)
async def test_scenario_produces_the_expected_outcome(scenario: str) -> None:
    async with _scenario_client(scenario) as client:
        if scenario == "warn_stale":
            result = await client.query(QUERY_REQUEST)
            assert result.evidence.policy.decision == "WARN"
            return
        with pytest.raises(SkiferClientError) as excinfo:
            if scenario == "invalid_cursor":
                await client.list_models()
            else:
                await client.query(QUERY_REQUEST)
        SCENARIO_ASSERTIONS[scenario](excinfo.value)


async def test_invalid_bearer_is_unauthenticated() -> None:
    async with SkiferClient(
        "http://testserver",
        "not-the-contract-token",
        transport=httpx.ASGITransport(app=create_contract_app()),
    ) as client:
        with pytest.raises(Unauthenticated):
            await client.me()


async def test_read_only_bearer_cannot_query() -> None:
    async with SkiferClient(
        "http://testserver",
        "mock-read-token",
        transport=httpx.ASGITransport(app=create_contract_app()),
    ) as client:
        with pytest.raises(ScopeDenied):
            await client.query(QUERY_REQUEST)


async def test_unknown_model_is_resource_not_found() -> None:
    async with SkiferClient(
        "http://testserver",
        "mock-token",
        transport=httpx.ASGITransport(app=create_contract_app()),
    ) as client:
        with pytest.raises(ResourceNotFound):
            await client.get_model("contract.unknown_model")


async def test_non_json_error_body_becomes_resource_unavailable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, content=b"not json", headers={"content-type": "text/plain"})

    async with SkiferClient(
        "http://testserver", "mock-token", transport=httpx.MockTransport(handler)
    ) as client:
        with pytest.raises(ResourceUnavailable) as excinfo:
            await client.health()
    assert excinfo.value.message == "not json"


async def test_2xx_body_failing_dto_validation_becomes_unexpected_response() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"subject": "u"})

    async with SkiferClient(
        "http://testserver", "mock-token", transport=httpx.MockTransport(handler)
    ) as client:
        with pytest.raises(UnexpectedResponse):
            await client.me()


async def test_finance_invoices_is_denied_without_a_result() -> None:
    async with SkiferClient(
        "http://testserver",
        "mock-token",
        transport=httpx.ASGITransport(app=create_contract_app()),
    ) as client:
        request = QueryRequest(model="finance.invoices", metrics=("invoiced_amount",))
        with pytest.raises(SemanticAccessDenied) as excinfo:
            await client.query(request)
    assert excinfo.value.decision == "DENY"
