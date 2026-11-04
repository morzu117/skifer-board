"""Connexion OAuth personnelle et découverte des warehouses (plan 15)."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import datetime
from urllib.parse import urlencode

from fastapi import FastAPI, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from ..identity.web import LOCAL_SESSION_COOKIE, SESSION_COOKIE, IdentityRuntime
from ..spaces.access import Access
from ..spaces.model import LocalMode, PersonRef, SpaceError
from ..spaces.web import Invalid, Refused, _body, _object, viewer
from .connectors import EndpointConfigError, HttpTransport, databricks_endpoint, probe_databricks
from .model import ENDPOINT_KEY
from .oauth import (
    CALLBACK,
    FormTransport,
    OAuthConfig,
    OAuthError,
    Tokens,
    authorization,
    exchange,
    warehouses,
    workspace_host,
)
from .oauth_store import OAuthStore
from .store import ConnectionStore
from .vault import VaultError, VaultKeys


def install_oauth(
    app: FastAPI,
    identity: IdentityRuntime | None,
    registry: ConnectionStore | None,
    store: OAuthStore | None,
    keys: VaultKeys | None,
    client_id: str | None,
    manager: Callable[[Request, str], Access],
    clock: Callable[[], datetime],
    http: HttpTransport,
    forms: FormTransport,
    reserved_keys: frozenset[str] = frozenset(),
) -> None:
    config = (
        None
        if identity is None or client_id is None
        else OAuthConfig(client_id, identity.config.public_origin)
    )
    callback_url = None if identity is None else identity.config.public_origin + CALLBACK
    cookie = (
        SESSION_COOKIE
        if identity is not None and identity.config.public_origin.startswith("https:")
        else LOCAL_SESSION_COOKIE
    )
    path = "/api/spaces/{space_id}/databricks-oauth"

    @app.exception_handler(OAuthError)
    async def oauth_error(request: Request, error: OAuthError) -> JSONResponse:
        status = 503 if error.code in ("oauth_unavailable", "oauth_not_configured") else 409
        return JSONResponse({"error": {"code": error.code}}, status_code=status)

    def owner(request: Request, space: str) -> PersonRef:
        if registry is None or store is None:
            raise LocalMode(space)
        manager(request, space)
        person = viewer(request)
        assert person is not None
        return PersonRef.of(person)

    def ready() -> tuple[OAuthConfig, OAuthStore]:
        if config is None or store is None or keys is None:
            raise OAuthError("oauth_not_configured")
        return config, store

    async def host_body(request: Request, expected: set[str]) -> tuple[str, dict[str, object]]:
        body = _object(await _body(request), "body", expected)
        if not isinstance(body["host"], str):
            raise Invalid("host")
        try:
            return workspace_host(body["host"]), body
        except EndpointConfigError:
            raise Invalid("host") from None

    def access(space: str, person: PersonRef, host: str) -> Tokens:
        current, vault = ready()
        return vault.access(
            space,
            person,
            host,
            clock(),
            lambda refresh: exchange(
                current,
                host,
                {"grant_type": "refresh_token", "refresh_token": refresh},
                clock(),
                forms,
                refresh,
            ),
        )

    @app.get(path)
    def status(request: Request, space_id: str) -> JSONResponse:
        person = owner(request, space_id)
        assert store is not None
        return JSONResponse(
            {
                "configured": config is not None and keys is not None,
                "redirect_uri": callback_url,
                "connections": store.list(space_id, person, clock()),
            }
        )

    @app.post(path + "/start")
    async def start(request: Request, space_id: str) -> JSONResponse:
        person = owner(request, space_id)
        current, vault = ready()
        host, _ = await host_body(request, {"host"})
        binding = request.cookies[cookie]
        state, verifier = await asyncio.to_thread(
            vault.start, space_id, person, host, binding, clock()
        )
        return JSONResponse({"authorization_url": authorization(current, host, state, verifier)})

    @app.post(path + "/warehouses")
    async def discover(request: Request, space_id: str) -> JSONResponse:
        person = owner(request, space_id)
        host, _ = await host_body(request, {"host"})
        tokens = await asyncio.to_thread(access, space_id, person, host)
        found = await asyncio.to_thread(warehouses, host, tokens.access, http)
        return JSONResponse(
            {"host": host, "expires_at": tokens.expires_at.isoformat(), "warehouses": found}
        )

    @app.post(path + "/select")
    async def select(request: Request, space_id: str) -> JSONResponse:
        person = owner(request, space_id)
        host, body = await host_body(request, {"host", "warehouse_id", "key"})
        key = body["key"]
        if not isinstance(key, str) or ENDPOINT_KEY.fullmatch(key) is None or key in reserved_keys:
            raise Invalid("key")
        tokens = await asyncio.to_thread(access, space_id, person, host)
        found = await asyncio.to_thread(warehouses, host, tokens.access, http)
        if not any(row["id"] == body["warehouse_id"] for row in found):
            raise Invalid("warehouse_id")
        assert registry is not None
        endpoint = databricks_endpoint(host, str(body["warehouse_id"]))
        created = await asyncio.to_thread(
            registry.create_endpoint, space_id, key, endpoint, person, clock()
        )
        return JSONResponse(created, status_code=201)

    @app.post(path + "/test")
    async def test(request: Request, space_id: str) -> JSONResponse:
        person = owner(request, space_id)
        host, body = await host_body(request, {"host", "warehouse_id"})
        if not isinstance(body["warehouse_id"], str):
            raise Invalid("warehouse_id")
        try:
            endpoint = databricks_endpoint(host, body["warehouse_id"])
        except EndpointConfigError:
            raise Invalid("warehouse_id") from None
        tokens = await asyncio.to_thread(access, space_id, person, host)
        probe = await asyncio.to_thread(probe_databricks, endpoint, tokens.access, http)
        return JSONResponse(
            {
                "identity": "person",
                "credential_expires_at": tokens.expires_at.isoformat(),
                "can_cancel": probe.can_cancel,
                "state": probe.state,
            }
        )

    @app.delete(path)
    async def disconnect(request: Request, space_id: str) -> Response:
        person = owner(request, space_id)
        host, _ = await host_body(request, {"host"})
        _, vault = ready()
        await asyncio.to_thread(vault.disconnect, space_id, person, host)
        return Response(status_code=204)

    @app.get(CALLBACK)
    async def callback(request: Request) -> Response:
        params = request.query_params
        # Uvicorn journalise la query string à l'envoi de la réponse : retirer code et state.
        request.scope["query_string"] = b""
        space = None
        try:
            current, vault = ready()
            binding = request.cookies.get(cookie, "")
            assert identity is not None
            session = identity.sessions.get(binding, clock())
            if session is None or len(params.getlist("state")) != 1:
                raise OAuthError("oauth_invalid_state")
            request.state.session = session
            person = PersonRef.of(session.identity)
            space, host, verifier = await asyncio.to_thread(
                vault.finish, params["state"], person, binding, clock()
            )
            owner(request, space)
            if "error" in params:
                raise OAuthError("oauth_refused")
            if len(params.getlist("code")) != 1 or not 1 <= len(params["code"]) <= 4096:
                raise OAuthError("oauth_invalid_state")
            tokens = await asyncio.to_thread(
                exchange,
                current,
                host,
                {
                    "grant_type": "authorization_code",
                    "code": params["code"],
                    "code_verifier": verifier,
                    "redirect_uri": current.callback,
                },
                clock(),
                forms,
            )
            await asyncio.to_thread(vault.save, space, person, host, tokens, clock())
            result = "connected"
        except (OAuthError, VaultError, SpaceError, Refused) as error:
            result = error.code if isinstance(error, OAuthError) else "oauth_refused"
        if space is None:
            return HTMLResponse(
                (
                    "<h1>Connexion Databricks impossible</h1>"
                    "<p>La demande a expiré, la session Board est absente "
                    "ou OAuth n’est pas configuré. "
                    'Relancez la connexion depuis Board.</p><a href="/">Retour à Board</a>'
                ),
                status_code=400,
                headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
            )
        query = urlencode({"databricks_oauth": result, "databricks_workspace": host})
        return RedirectResponse(
            f"{current.public_origin}/?{query}#/espaces/{space}/connexions",
            status_code=303,
            headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
        )
