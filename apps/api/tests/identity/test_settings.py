"""`BoardSettings` is fail-closed on a missing service token, and never prints it (D14)."""

import pytest
from skifer_board.identity.settings import (
    DEFAULT_SKIFER_BASE_URL,
    SKIFER_TOKEN_ENV,
    SKIFER_URL_ENV,
    BoardConfigurationError,
    load_settings,
)


def test_missing_token_raises_and_names_the_variable() -> None:
    with pytest.raises(BoardConfigurationError, match=SKIFER_TOKEN_ENV):
        load_settings({})


def test_empty_token_raises_and_names_the_variable() -> None:
    with pytest.raises(BoardConfigurationError, match=SKIFER_TOKEN_ENV):
        load_settings({SKIFER_TOKEN_ENV: ""})


def test_default_base_url() -> None:
    settings = load_settings({SKIFER_TOKEN_ENV: "service-token"})
    assert settings.skifer_base_url == DEFAULT_SKIFER_BASE_URL


def test_base_url_read_from_environ() -> None:
    settings = load_settings(
        {SKIFER_TOKEN_ENV: "service-token", SKIFER_URL_ENV: "http://skifer.internal:9000"}
    )
    assert settings.skifer_base_url == "http://skifer.internal:9000"


def test_repr_masks_the_token() -> None:
    settings = load_settings({SKIFER_TOKEN_ENV: "super-secret-token"})
    assert "super-secret-token" not in repr(settings)
