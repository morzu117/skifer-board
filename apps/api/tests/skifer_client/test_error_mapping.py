"""Pure translation from a decoded response to a typed error (SK-02.5, D14); no network."""

from typing import Any

import pytest
from skifer_board.skifer_client import (
    InvalidCursor,
    InvalidRequest,
    LimitExceeded,
    ResourceNotFound,
    ResourceUnavailable,
    ScopeDenied,
    SemanticAccessDenied,
    SemanticQueryError,
    SkiferClientError,
    Unauthenticated,
    UnexpectedResponse,
    error_from_response,
)


def test_base_error_keeps_its_two_positional_argument_constructor() -> None:
    error = SkiferClientError(404, {"detail": "x"})
    assert error.status_code == 404
    assert error.error_type == "SkiferClientError"
    assert error.message == "skifer API error 404: {'detail': 'x'}"
    assert str(error) == "SkiferClientError (404): skifer API error 404: {'detail': 'x'}"


@pytest.mark.parametrize(
    ("error_type", "expected_class"),
    [
        ("Unauthenticated", Unauthenticated),
        ("InvalidRequest", InvalidRequest),
        ("LimitExceeded", LimitExceeded),
        ("InvalidCursor", InvalidCursor),
        ("ScopeDenied", ScopeDenied),
        ("ResourceNotFound", ResourceNotFound),
        ("ResourceUnavailable", ResourceUnavailable),
    ],
)
def test_known_simple_types_map_to_their_class(
    error_type: str, expected_class: type[SkiferClientError]
) -> None:
    error = error_from_response(400, {"error": {"type": error_type, "message": "boom"}})
    assert type(error) is expected_class
    assert error.error_type == error_type
    assert error.message == "boom"
    assert error.status_code == 400
    assert str(error) == f"{error_type} (400): boom"


def test_limit_exceeded_and_invalid_cursor_are_invalid_requests() -> None:
    limit_exceeded = error_from_response(400, {"error": {"type": "LimitExceeded", "message": "x"}})
    invalid_cursor = error_from_response(400, {"error": {"type": "InvalidCursor", "message": "x"}})
    assert isinstance(limit_exceeded, InvalidRequest)
    assert isinstance(invalid_cursor, InvalidRequest)


def _sad_body(**overrides: object) -> dict[str, Any]:
    error: dict[str, Any] = {
        "type": "SemanticAccessDenied",
        "message": "The certification gate denies access.",
        "decision": "DENY",
        "reasons": ["EXPIRED"],
        "evaluated_at": "2026-09-13T00:00:00Z",
        "recommended_action": "Renew the certification.",
    }
    error.update(overrides)
    return {"error": error}


def test_semantic_access_denied_full_fields() -> None:
    error = error_from_response(403, _sad_body())
    assert isinstance(error, SemanticAccessDenied)
    assert error.decision == "DENY"
    assert error.reasons == ("EXPIRED",)
    assert error.evaluated_at == "2026-09-13T00:00:00Z"
    assert error.recommended_action == "Renew the certification."
    assert str(error) == "SemanticAccessDenied (403): The certification gate denies access."


def test_semantic_access_denied_require_human_without_recommended_action() -> None:
    error = error_from_response(403, _sad_body(decision="REQUIRE_HUMAN", recommended_action=None))
    assert isinstance(error, SemanticAccessDenied)
    assert error.decision == "REQUIRE_HUMAN"
    assert error.recommended_action is None


def test_semantic_access_denied_without_evaluated_at() -> None:
    body = _sad_body()
    del body["error"]["evaluated_at"]
    error = error_from_response(403, body)
    assert isinstance(error, SemanticAccessDenied)
    assert error.evaluated_at is None


def test_semantic_access_denied_missing_decision_becomes_unexpected_response() -> None:
    body = _sad_body()
    del body["error"]["decision"]
    error = error_from_response(403, body)
    assert isinstance(error, UnexpectedResponse)
    assert not isinstance(error, SemanticAccessDenied)


@pytest.mark.parametrize(
    "overrides",
    [
        {"decision": "ALLOW"},
        {"reasons": "EXPIRED"},
        {"reasons": ["EXPIRED", 3]},
        {"evaluated_at": 3},
        {"recommended_action": 3},
    ],
)
def test_semantic_access_denied_malformed_fields_become_unexpected_response(
    overrides: dict[str, object],
) -> None:
    error = error_from_response(403, _sad_body(**overrides))
    assert isinstance(error, UnexpectedResponse)
    assert not isinstance(error, SemanticAccessDenied)


def _sqe_body(**overrides: object) -> dict[str, Any]:
    error: dict[str, Any] = {
        "type": "SemanticQueryError",
        "message": "Unknown metric 'bogus'.",
        "suggestions": ["revenue", "order_count"],
    }
    error.update(overrides)
    return {"error": error}


def test_semantic_query_error_full_fields() -> None:
    error = error_from_response(422, _sqe_body())
    assert isinstance(error, SemanticQueryError)
    assert error.suggestions == ("revenue", "order_count")


def test_semantic_query_error_missing_suggestions_becomes_unexpected_response() -> None:
    body = _sqe_body()
    del body["error"]["suggestions"]
    error = error_from_response(422, body)
    assert isinstance(error, UnexpectedResponse)


def test_semantic_query_error_non_string_suggestion_becomes_unexpected_response() -> None:
    error = error_from_response(422, _sqe_body(suggestions=["ok", 1]))
    assert isinstance(error, UnexpectedResponse)


def test_unknown_error_type_in_4xx_becomes_unexpected_response() -> None:
    error = error_from_response(418, {"error": {"type": "Teapot", "message": "no"}})
    assert isinstance(error, UnexpectedResponse)
    assert error.status_code == 418


def test_plain_text_body_in_5xx_becomes_resource_unavailable() -> None:
    error = error_from_response(502, "Bad Gateway")
    assert isinstance(error, ResourceUnavailable)
    assert error.message == "Bad Gateway"


def test_empty_string_body_in_5xx_uses_fallback_message() -> None:
    error = error_from_response(500, "")
    assert isinstance(error, ResourceUnavailable)
    assert error.message == "the response body does not match a known skifer error shape."


def test_non_dict_non_str_body_in_5xx_becomes_resource_unavailable() -> None:
    error = error_from_response(500, [1, 2, 3])
    assert isinstance(error, ResourceUnavailable)
    assert error.message == "the response body does not match a known skifer error shape."


def test_body_without_error_key_in_4xx_becomes_unexpected_response() -> None:
    error = error_from_response(400, {"detail": "nope"})
    assert isinstance(error, UnexpectedResponse)
    assert error.message == "the response body does not match a known skifer error shape."


def test_error_field_not_a_mapping_becomes_unexpected_response() -> None:
    error = error_from_response(400, {"error": "boom"})
    assert isinstance(error, UnexpectedResponse)


def test_error_type_not_a_string_becomes_unexpected_response() -> None:
    error = error_from_response(400, {"error": {"type": 1, "message": "x"}})
    assert isinstance(error, UnexpectedResponse)


def test_error_message_not_a_string_becomes_unexpected_response() -> None:
    error = error_from_response(400, {"error": {"type": "InvalidRequest", "message": 1}})
    assert isinstance(error, UnexpectedResponse)


def test_str_and_repr_never_leak_unexpected_body_content() -> None:
    """`mock-token` sits in a field the translation never reads (`secret`, not `message`): it
    must never surface through `str()`/`repr()`, only through `.body` (kept for diagnostics)."""
    error = error_from_response(
        404,
        {
            "error": {
                "type": "ResourceNotFound",
                "message": "Unknown model.",
                "secret": "mock-token",
            }
        },
    )
    assert "mock-token" not in str(error)
    assert "mock-token" not in repr(error)
    assert "mock-token" in str(error.body)


def test_str_contains_bearer_like_text_only_when_it_is_the_server_message() -> None:
    """Unlike an unrelated field, skifer's own `message` legitimately surfaces in `str()`."""
    error = error_from_response(
        401, {"error": {"type": "Unauthenticated", "message": "bearer mock-token is invalid"}}
    )
    assert "mock-token" in str(error)
