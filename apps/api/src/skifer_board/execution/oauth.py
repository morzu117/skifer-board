"""OAuth utilisateur Databricks et découverte sans SQL (plan 15)."""

from __future__ import annotations

import base64
import hashlib
import json
import re
import ssl
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPSHandler, ProxyHandler, Request, build_opener

from .connectors import (
    MAX_RESPONSE,
    STATES,
    WAREHOUSE_ID,
    HttpResponse,
    HttpTransport,
    _NoRedirect,
    databricks_endpoint,
)

CLIENT_VARIABLE = "SKIFER_BOARD_DATABRICKS_OAUTH_CLIENT_ID"
CALLBACK = "/auth/databricks/callback"
SCOPES = "sql offline_access"


class OAuthConfigError(ValueError):
    pass


def validate_client_id(value: str | None) -> str | None:
    if value is not None and re.fullmatch(r"[A-Za-z0-9._-]{1,255}", value) is None:
        raise OAuthConfigError(f"{CLIENT_VARIABLE} : Client ID OAuth invalide.")
    return value


class OAuthError(Exception):
    def __init__(self, code: str = "oauth_unavailable") -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class OAuthConfig:
    client_id: str
    public_origin: str

    @property
    def callback(self) -> str:
        return self.public_origin + CALLBACK


class FormTransport(Protocol):
    def post(self, url: str, fields: dict[str, str]) -> HttpResponse: ...


class OAuthFormTransport:
    def post(self, url: str, fields: dict[str, str]) -> HttpResponse:
        opener = build_opener(
            ProxyHandler({}), HTTPSHandler(context=ssl.create_default_context()), _NoRedirect()
        )
        request = Request(
            url,
            data=urlencode(fields).encode(),
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
            method="POST",
        )
        try:
            with opener.open(request, timeout=5) as response:
                return HttpResponse(
                    response.status,
                    response.read(MAX_RESPONSE + 1),
                    response.headers.get_content_type(),
                )
        except HTTPError as error:
            return HttpResponse(error.code, b"", "")
        except (URLError, OSError, ValueError):
            raise OAuthError() from None


def response_object(response: HttpResponse) -> dict[str, Any]:
    if response.status in (400, 401, 403):
        raise OAuthError("oauth_refused")
    if response.status != 200:
        raise OAuthError()
    if response.content_type != "application/json" or len(response.body) > MAX_RESPONSE:
        raise OAuthError("oauth_invalid_response")
    try:
        data = json.loads(response.body)
    except (ValueError, UnicodeError):
        raise OAuthError("oauth_invalid_response") from None
    if not isinstance(data, dict):
        raise OAuthError("oauth_invalid_response")
    return data


def workspace_host(value: str) -> str:
    return databricks_endpoint(value, "discovery").host


def authorization(config: OAuthConfig, host: str, state: str, verifier: str) -> str:
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    )
    return (
        host
        + "/oidc/v1/authorize?"
        + urlencode(
            {
                "client_id": config.client_id,
                "redirect_uri": config.callback,
                "response_type": "code",
                "scope": SCOPES,
                "state": state,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        )
    )


@dataclass(frozen=True)
class Tokens:
    access: str = field(repr=False)
    refresh: str = field(repr=False)
    expires_at: datetime

    def payload(self) -> dict[str, str]:
        return {
            "access": self.access,
            "refresh": self.refresh,
            "expires_at": self.expires_at.isoformat(),
        }


def exchange(
    config: OAuthConfig,
    host: str,
    fields: dict[str, str],
    now: datetime,
    transport: FormTransport,
    previous_refresh: str = "",
) -> Tokens:
    data = response_object(
        transport.post(
            host + "/oidc/v1/token", {"client_id": config.client_id, "scope": SCOPES, **fields}
        )
    )
    access, refresh, seconds = (
        data.get("access_token"),
        data.get("refresh_token", previous_refresh),
        data.get("expires_in"),
    )
    if (
        not isinstance(access, str)
        or not 1 <= len(access) <= 16384
        or not isinstance(refresh, str)
        or not 1 <= len(refresh) <= 16384
        or type(seconds) is not int
        or not 1 <= seconds <= 86400
        or str(data.get("token_type", "")).lower() != "bearer"
    ):
        raise OAuthError("oauth_invalid_response")
    return Tokens(access, refresh, now + timedelta(seconds=seconds))


def warehouses(host: str, token: str, transport: HttpTransport) -> list[dict[str, str]]:
    data = response_object(transport.get(host + "/api/2.0/sql/warehouses", token))
    items = data.get("warehouses")
    if not isinstance(items, list) or len(items) > 5000:
        raise OAuthError("oauth_invalid_response")
    found: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            raise OAuthError("oauth_invalid_response")
        key, name, state = item.get("id"), item.get("name"), item.get("state")
        if (
            not isinstance(key, str)
            or WAREHOUSE_ID.fullmatch(key) is None
            or key in seen
            or not isinstance(name, str)
            or not 1 <= len(name.strip()) <= 512
            or not isinstance(state, str)
            or state not in STATES
        ):
            raise OAuthError("oauth_invalid_response")
        seen.add(key)
        found.append({"id": key, "name": name, "state": state})
    return sorted(found, key=lambda row: (row["name"].casefold(), row["id"]))
