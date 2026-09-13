"""Minimal FastAPI app (plan01-5.1): identity only, no data routes.

The `SkiferClient` is built once per app from `BoardSettings`, never from an incoming request
(D14, F1.5): the bearer sent to skifer is always the board's own service token, read from the
server's own environment. No route in this module reads an authorization header, a cookie, or a
query parameter from the incoming request.
"""

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from skifer_board.identity.local import local_identity
from skifer_board.identity.settings import BoardSettings, load_settings
from skifer_board.skifer_client import SkiferClient, SkiferClientError


def create_app(
    settings: BoardSettings | None = None,
    *,
    skifer_transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    resolved_settings = settings if settings is not None else load_settings(os.environ)
    client = SkiferClient(
        resolved_settings.skifer_base_url,
        resolved_settings.skifer_token,
        transport=skifer_transport,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            await client.aclose()

    app = FastAPI(lifespan=lifespan)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/me", response_model=None)
    async def me() -> dict[str, Any] | JSONResponse:
        local = local_identity()
        try:
            identity = await client.me()
        except SkiferClientError as error:
            return JSONResponse(
                status_code=502,
                content={"error": {"type": error.error_type, "message": error.message}},
            )
        return {
            "subject": local.subject,
            "consumer_class": local.consumer_class,
            "skifer": {
                "subject": identity.subject,
                "consumer_class": identity.consumer_class,
                "scopes": list(identity.scopes),
            },
        }

    return app
