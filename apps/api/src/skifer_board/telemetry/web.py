"""Lecture de la télémétrie (plan 11, T7) : administration de la plateforme seule.

Sans base, le mode local n'a rien à lire : `409 local_mode`. Le droit est vérifié avant la
fenêtre, si bien qu'une personne sans ce droit n'apprend rien de la route.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from ..identity.model import Identity
from ..spaces.web import viewer
from .model import Window
from .store import TelemetryStore

TELEMETRY_PATH = "/api/telemetry"


def install_telemetry(
    app: FastAPI,
    store: TelemetryStore | None,
    platform_admin: Callable[[Identity | None], bool],
    clock: Callable[[], datetime],
) -> None:
    @app.get(TELEMETRY_PATH)
    def read_telemetry(request: Request) -> JSONResponse:
        if store is None:
            return JSONResponse({"error": {"code": "local_mode"}}, 409)
        if not platform_admin(viewer(request)):
            return JSONResponse({"error": {"code": "forbidden", "required": "platform_admin"}}, 403)
        # Une seule fenêtre, parmi les trois connues : rien n'est choisi à la place de l'appelant.
        windows = request.query_params.getlist("window")
        if len(windows) != 1 or windows[0] not in {window.value for window in Window}:
            return JSONResponse({"error": {"code": "invalid_request", "field": "window"}}, 400)
        return JSONResponse(store.summary(Window(windows[0]), clock()).to_json())
