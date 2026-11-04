"""Identité dans le serveur HTTP : routes de connexion, garde de `/api`, contrôle d'origine
(plan 06, I1, I6, I7, I8).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from urllib.parse import urlencode, urlsplit

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse

from .config import OidcConfig, is_loopback
from .flow import LoginFlow, LoginRefusal, LoginRequests
from .keys import Http, ProviderError, ProviderKeys
from .model import Identity, is_platform_admin
from .sessions import MemorySessionStore, Session, SessionStore

SESSION_COOKIE = "__Host-sb_session"
LOGIN_COOKIE = "__Host-sb_login"
LOGIN_PATH = "/auth/login"
LOGOUT_PATH = "/auth/logout"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


@dataclass(frozen=True)
class IdentityRuntime:
    config: OidcConfig
    keys: ProviderKeys
    flow: LoginFlow
    sessions: SessionStore
    clock: Callable[[], datetime]
    # Appelé à chaque connexion réussie : Board y enregistre la personne (plan 08, E5).
    on_login: Callable[[Identity, datetime], None] | None = None


def _error(status: int, code: str, **fields: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, **fields}}, status_code=status)


def _identity_json(identity: Identity) -> dict[str, Any]:
    return {
        "issuer": identity.issuer,
        "subject": identity.subject,
        "name": identity.name,
        "email": identity.email,
        "groups": list(identity.groups),
    }


def _set_cookie(response: Response, name: str, value: str, max_age: int) -> None:
    response.set_cookie(
        name, value, max_age=max_age, path="/", secure=True, httponly=True, samesite="lax"
    )


def _clear_cookie(response: Response, name: str) -> None:
    response.delete_cookie(name, path="/", secure=True, httponly=True, samesite="lax")


def _origin_allowed(request: Request, runtime: IdentityRuntime | None) -> bool:
    origin = request.headers.get("origin")
    if runtime is not None:
        return origin == runtime.config.public_origin
    if origin is None:
        return False
    # Mode local : seule une page servie depuis la boucle locale peut modifier.
    try:
        host = urlsplit(origin).hostname or ""
    except ValueError:
        # Origine illisible (`http://[::1`) : refusée comme toute origine inconnue.
        return False
    return is_loopback(host)


def install_identity(app: FastAPI, runtime: IdentityRuntime | None) -> None:
    """Pose la garde et les routes d'identité. Sans OIDC : mode local, sans identité."""

    def current(request: Request) -> Session | None:
        if runtime is None:
            return None
        token = request.cookies.get(SESSION_COOKIE)
        return None if token is None else runtime.sessions.get(token, runtime.clock())

    @app.middleware("http")
    async def guard(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if request.method not in SAFE_METHODS and not _origin_allowed(request, runtime):
            return _error(403, "origin_refused")
        if runtime is not None and request.url.path.startswith("/api/"):
            session = current(request)
            if session is None:
                return _error(401, "unauthenticated", login_url=LOGIN_PATH)
            request.state.session = session
        return await call_next(request)

    @app.get("/api/me")
    def me(request: Request) -> JSONResponse:
        if runtime is None:
            return JSONResponse({"established": False})
        session: Session = request.state.session
        return JSONResponse(
            {
                "established": True,
                "identity": _identity_json(session.identity),
                "expires_at": session.expires_at.isoformat(),
                # Crée les espaces et gère leurs membres ; aucun rôle ni donnée (plan 08, E6).
                "platform_admin": is_platform_admin(session.identity, runtime.config.admin_group),
            }
        )

    if runtime is None:
        return

    callback_path = urlsplit(runtime.config.redirect_uri).path

    def back_to_app(refusal: LoginRefusal | None) -> RedirectResponse:
        target = "/" if refusal is None else f"/?{urlencode({'login_error': refusal.value})}"
        response = RedirectResponse(target, status_code=303)
        _clear_cookie(response, LOGIN_COOKIE)
        return response

    @app.get(LOGIN_PATH)
    def login() -> Response:
        try:
            started = runtime.flow.start()
        except ProviderError:
            return back_to_app(LoginRefusal.PROVIDER_UNAVAILABLE)
        response = RedirectResponse(started.redirect_url, status_code=303)
        _set_cookie(response, LOGIN_COOKIE, started.binding, max_age=600)
        return response

    @app.get(callback_path)
    def callback(request: Request) -> Response:
        params = dict(request.query_params)
        found = runtime.flow.finish(params, request.cookies.get(LOGIN_COOKIE))
        if isinstance(found, LoginRefusal):
            return back_to_app(found)
        now = runtime.clock()
        if runtime.on_login is not None:
            runtime.on_login(found, now)
        token = runtime.sessions.create(found, now)
        response = back_to_app(None)
        _set_cookie(
            response,
            SESSION_COOKIE,
            token,
            max_age=int(runtime.config.session_absolute.total_seconds()),
        )
        return response

    @app.post(LOGOUT_PATH)
    def logout(request: Request) -> JSONResponse:
        token = request.cookies.get(SESSION_COOKIE)
        if token is not None:
            runtime.sessions.delete(token)
        response = JSONResponse({"redirect": "/"})
        _clear_cookie(response, SESSION_COOKIE)
        return response


def build_runtime(
    config: OidcConfig,
    http: Http,
    clock: Callable[[], datetime],
    sessions: SessionStore | None = None,
    requests: LoginRequests | None = None,
    on_login: Callable[[Identity, datetime], None] | None = None,
) -> IdentityRuntime:
    """Assemble fournisseur, parcours et magasins d'une configuration. Sans magasins fournis,
    ils sont en mémoire : un seul processus, ce que le serveur n'admet que dans les tests
    (plan 07, P5)."""
    keys = ProviderKeys(config, http, clock)
    return IdentityRuntime(
        config=config,
        keys=keys,
        flow=LoginFlow(config, keys, http, clock, requests),
        sessions=(
            MemorySessionStore(config.session_absolute, config.session_idle)
            if sessions is None
            else sessions
        ),
        clock=clock,
        on_login=on_login,
    )
