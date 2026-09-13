"""Typed errors of `SkiferClient`, one per skifer error type (SK-02.5, D14).

`error_from_response` is the single, pure translation point from a decoded HTTP response to one
of the exceptions below; `SkiferClient` raises what it returns, never a bare `SkiferClientError`.
Every instance carries `error_type` and `message`; `str()` renders
`"<error_type> (<status_code>): <message>"` from those two and `status_code` only, never from the
raw `body` — the bearer token, which never enters `message`, therefore never leaks through `str()`
or the default `repr()`. The raw body stays available on `body` for diagnostics.
"""

from typing import Literal

Decision = Literal["DENY", "REQUIRE_HUMAN"]


class SkiferClientError(Exception):
    """Any non-2xx response from skifer, or a 2xx body that does not match the DTO."""

    def __init__(self, status_code: int, body: object, *, message: str | None = None) -> None:
        self.status_code = status_code
        self.body = body
        self.error_type = type(self).__name__
        self.message = (
            message if message is not None else f"skifer API error {status_code}: {body!r}"
        )
        super().__init__(str(self))

    def __str__(self) -> str:
        return f"{self.error_type} ({self.status_code}): {self.message}"


class Unauthenticated(SkiferClientError):
    """The bearer is missing or invalid."""


class InvalidRequest(SkiferClientError):
    """The request itself is malformed, independently of authentication or policy."""


class LimitExceeded(InvalidRequest):
    """The requested `limit` is out of the bounds skifer allows."""


class InvalidCursor(InvalidRequest):
    """The pagination cursor is unreadable or out of range."""


class ScopeDenied(SkiferClientError):
    """The bearer authenticates, but lacks the scope the endpoint requires."""


class ResourceNotFound(SkiferClientError):
    """The requested model or resource does not exist in the catalogue."""


class ResourceUnavailable(SkiferClientError):
    """skifer reported a 5xx: never treated as success (plan01 roadmap, risk register §7)."""


class SemanticAccessDenied(SkiferClientError):
    """The certification gate returned DENY or REQUIRE_HUMAN (I3): never a `QueryResult`."""

    def __init__(
        self,
        status_code: int,
        body: object,
        *,
        message: str,
        decision: Decision,
        reasons: tuple[str, ...],
        evaluated_at: str | None,
        recommended_action: str | None,
    ) -> None:
        super().__init__(status_code, body, message=message)
        self.decision = decision
        self.reasons = reasons
        self.evaluated_at = evaluated_at
        self.recommended_action = recommended_action


class SemanticQueryError(SkiferClientError):
    """An unknown metric, dimension or period; `suggestions` lists the valid names."""

    def __init__(
        self,
        status_code: int,
        body: object,
        *,
        message: str,
        suggestions: tuple[str, ...],
    ) -> None:
        super().__init__(status_code, body, message=message)
        self.suggestions = suggestions


class UnexpectedResponse(SkiferClientError):
    """A malformed body, an unknown error type, or an incoherent pagination step."""


_SIMPLE_TYPES: dict[str, type[SkiferClientError]] = {
    "Unauthenticated": Unauthenticated,
    "InvalidRequest": InvalidRequest,
    "LimitExceeded": LimitExceeded,
    "InvalidCursor": InvalidCursor,
    "ScopeDenied": ScopeDenied,
    "ResourceNotFound": ResourceNotFound,
    "ResourceUnavailable": ResourceUnavailable,
}


def _error_envelope(body: object) -> tuple[str, str, dict[str, object]] | None:
    """Return `(type, message, details)` when `body` is `{"error": {"type", "message", ...}}`."""
    if not isinstance(body, dict):
        return None
    error = body.get("error")
    if not isinstance(error, dict):
        return None
    error_type = error.get("type")
    message = error.get("message")
    if not isinstance(error_type, str) or not isinstance(message, str):
        return None
    return error_type, message, error


def _string_tuple(value: object) -> tuple[str, ...] | None:
    if not isinstance(value, list):
        return None
    if not all(isinstance(item, str) for item in value):
        return None
    return tuple(value)


def _fallback_message(body: object) -> str:
    if isinstance(body, str) and body:
        return body
    return "the response body does not match a known skifer error shape."


def _semantic_access_denied(
    status_code: int, body: object, message: str, details: dict[str, object]
) -> SkiferClientError:
    raw_decision = details.get("decision")
    if raw_decision == "DENY":
        decision: Decision = "DENY"
    elif raw_decision == "REQUIRE_HUMAN":
        decision = "REQUIRE_HUMAN"
    else:
        return UnexpectedResponse(status_code, body, message=message)

    reasons = _string_tuple(details.get("reasons"))
    if reasons is None:
        return UnexpectedResponse(status_code, body, message=message)

    raw_evaluated_at = details.get("evaluated_at")
    if isinstance(raw_evaluated_at, str):
        evaluated_at: str | None = raw_evaluated_at
    elif raw_evaluated_at is None:
        evaluated_at = None
    else:
        return UnexpectedResponse(status_code, body, message=message)

    raw_recommended_action = details.get("recommended_action")
    if isinstance(raw_recommended_action, str):
        recommended_action: str | None = raw_recommended_action
    elif raw_recommended_action is None:
        recommended_action = None
    else:
        return UnexpectedResponse(status_code, body, message=message)

    return SemanticAccessDenied(
        status_code,
        body,
        message=message,
        decision=decision,
        reasons=reasons,
        evaluated_at=evaluated_at,
        recommended_action=recommended_action,
    )


def _semantic_query_error(
    status_code: int, body: object, message: str, details: dict[str, object]
) -> SkiferClientError:
    suggestions = _string_tuple(details.get("suggestions"))
    if suggestions is None:
        return UnexpectedResponse(status_code, body, message=message)
    return SemanticQueryError(status_code, body, message=message, suggestions=suggestions)


def error_from_response(status_code: int, body: object) -> SkiferClientError:
    """Translate a decoded response into its typed error; pure, no I/O, never returns success.

    The `type` of the `error` envelope drives the mapping, not the HTTP status: a 5xx without a
    recognized envelope becomes `ResourceUnavailable` (plan01 roadmap §7), anything else
    unrecognized becomes `UnexpectedResponse`.
    """
    envelope = _error_envelope(body)
    if envelope is not None:
        error_type, message, details = envelope
        if error_type == "SemanticAccessDenied":
            return _semantic_access_denied(status_code, body, message, details)
        if error_type == "SemanticQueryError":
            return _semantic_query_error(status_code, body, message, details)
        known = _SIMPLE_TYPES.get(error_type)
        if known is not None:
            return known(status_code, body, message=message)
    if status_code >= 500:
        return ResourceUnavailable(status_code, body, message=_fallback_message(body))
    return UnexpectedResponse(status_code, body, message=_fallback_message(body))
