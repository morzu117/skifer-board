"""pytest plugin of the skifer contract suite: target selection and the `skifer` client.

The target is either a running API (`--skifer-base-url`) or an ASGI app factory named by the
`skifer_contract_app` ini key (`"module:factory"`), exercised in process without any network.
"""

import importlib
import os
from collections.abc import Iterator

import httpx
import pytest

pytest.register_assert_rewrite("skifer_contract_tests.assertions")

API_PREFIX = "/api/v1"
BASE_URL_OPTION = "--skifer-base-url"
APP_INI_KEY = "skifer_contract_app"
TOKEN_ENV_VAR = "SKIFER_CONTRACT_TOKEN"
DEFAULT_TOKEN = "mock-token"


def pytest_addoption(parser: pytest.Parser) -> None:
    group = parser.getgroup("skifer-contract", "skifer API contract suite")
    group.addoption(
        BASE_URL_OPTION,
        dest="skifer_base_url",
        default=None,
        help="Root URL of the skifer API under test (routes are relative to /api/v1).",
    )
    parser.addini(
        APP_INI_KEY,
        help="ASGI app factory ('module:factory') used in process when no base URL is given.",
        type="string",
        default="",
    )


@pytest.fixture(scope="session")
def skifer_token() -> str:
    return os.environ.get(TOKEN_ENV_VAR, DEFAULT_TOKEN)


@pytest.fixture(scope="session")
def skifer(pytestconfig: pytest.Config) -> Iterator[httpx.Client]:
    """HTTP client whose base URL ends with `/api/v1`, carrying no credentials."""
    base_url = pytestconfig.getoption("skifer_base_url")
    if isinstance(base_url, str) and base_url:
        with httpx.Client(base_url=base_url.rstrip("/") + API_PREFIX) as client:
            yield client
        return

    app_spec = pytestconfig.getini(APP_INI_KEY)
    module_name, _, factory_name = str(app_spec).partition(":")
    if not module_name or not factory_name:
        pytest.fail(
            f"No skifer contract target: pass {BASE_URL_OPTION}=<url>, or set the ini key "
            f"{APP_INI_KEY} = 'module:factory' (got {app_spec!r}).",
            pytrace=False,
        )
    factory = getattr(importlib.import_module(module_name), factory_name)

    from fastapi.testclient import TestClient

    with TestClient(factory(), base_url="http://testserver" + API_PREFIX) as client:
        yield client
