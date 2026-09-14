"""Server-only configuration (D14): the bearer the board presents to skifer.

`load_settings` is the single place environment variables enter the process; nothing in this
module ever reads from an incoming request (F1.5).
"""

from collections.abc import Mapping
from dataclasses import dataclass, field

SKIFER_URL_ENV = "SKIFER_BOARD_SKIFER_URL"
SKIFER_TOKEN_ENV = "SKIFER_BOARD_SKIFER_TOKEN"
DEFAULT_SKIFER_BASE_URL = "http://127.0.0.1:8000"


class BoardConfigurationError(Exception):
    """A required server-side setting is missing or empty."""


@dataclass(frozen=True)
class BoardSettings:
    skifer_base_url: str
    skifer_token: str = field(repr=False)


def load_settings(environ: Mapping[str, str]) -> BoardSettings:
    """Read `BoardSettings` from `environ`; fail-closed if the service token is missing."""
    token = environ.get(SKIFER_TOKEN_ENV, "")
    if not token:
        raise BoardConfigurationError(f"{SKIFER_TOKEN_ENV} is required and must not be empty.")
    base_url = environ.get(SKIFER_URL_ENV, DEFAULT_SKIFER_BASE_URL)
    return BoardSettings(skifer_base_url=base_url, skifer_token=token)
