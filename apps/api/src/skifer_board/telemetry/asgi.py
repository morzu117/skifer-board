"""Mesure de chaque requête de l'API (plan 11, T2 et T3).

L'opération est le gabarit de la route, résolu ici avant l'appel : une requête refusée par la
garde d'identité avant le routage garde son gabarit. Une requête qu'aucune route ne prend est
comptée sous `unmatched`, sans son chemin. Le code d'un refus est lu dans le corps JSON de la
réponse, puis le corps est oublié : seule l'issue normalisée est gardée.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable, Sequence
from datetime import datetime
from typing import Any

from starlette.routing import BaseRoute, Match
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from ..spaces.model import ENVIRONMENTS, SPACE_ID
from .model import METHODS, InvalidMeasure, Kind, Measure, outcome
from .recorder import Recorder

UNMATCHED = "unmatched"
# Un corps de refus plus long n'est pas lu : son code serait rangé sous `other` ou `error`.
ERROR_BODY_LIMIT = 16_384


def _template(routes: Sequence[BaseRoute], scope: Scope) -> tuple[str, dict[str, Any]]:
    """Gabarit de la route qui prend la requête, et ses paramètres ; `unmatched` sinon. Une
    route qui ne refuse que la méthode (405) donne aussi son gabarit."""
    partial: tuple[str, dict[str, Any]] | None = None
    for route in routes:
        match, child = route.matches(scope)
        path = getattr(route, "path", None)
        if match is Match.NONE or not isinstance(path, str):
            continue
        found = (path, dict(child.get("path_params", {})))
        if match is Match.FULL:
            return found
        partial = partial or found
    return partial or (UNMATCHED, {})


def _code(body: bytes) -> str | None:
    try:
        error = json.loads(body)["error"]["code"]
    except (ValueError, TypeError, KeyError):
        return None
    return error if isinstance(error, str) else None


class TelemetryMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        routes: Sequence[BaseRoute],
        recorder: Recorder,
        clock: Callable[[], datetime],
    ) -> None:
        self.app, self.routes, self.recorder, self.clock = app, routes, recorder, clock

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        at, started = self.clock(), time.perf_counter()
        operation, params = _template(self.routes, scope)
        state: dict[str, Any] = {"status": None, "size": 0, "json": False}
        body = bytearray()

        async def measured(message: Message) -> None:
            if message["type"] == "http.response.start":
                state["status"] = message["status"]
                headers = dict(message.get("headers", []))
                state["json"] = headers.get(b"content-type", b"").startswith(b"application/json")
            elif message["type"] == "http.response.body":
                chunk = message.get("body", b"")
                state["size"] += len(chunk)
                if state["status"] >= 400 and state["json"]:
                    # Un octet au-delà de la limite suffit à savoir que le corps est trop long.
                    body.extend(chunk[: ERROR_BODY_LIMIT + 1 - len(body)])
            await send(message)

        try:
            await self.app(scope, receive, measured)
        finally:
            # Une exception remontée ici devient un 500 hors de cet intergiciel.
            status: int = 500 if state["status"] is None else state["status"]
            code = _code(bytes(body)) if 0 < len(body) <= ERROR_BODY_LIMIT else None
            space = params.get("space_id")
            environment = params.get("environment")
            method = scope["method"]
            try:
                measure = Measure(
                    at=at,
                    kind=Kind.HTTP,
                    operation=operation,
                    outcome=outcome(status, code),
                    duration_ms=(time.perf_counter() - started) * 1000,
                    method=method if method in METHODS else "OTHER",
                    status=status,
                    space=space if isinstance(space, str) and SPACE_ID.fullmatch(space) else None,
                    environment=environment if environment in ENVIRONMENTS else None,
                    size=state["size"],
                )
            except InvalidMeasure:
                # Un gabarit hors format (adresse de retour OIDC configurée, par exemple) : la
                # mesure est perdue, et la perte journalisée ; la réponse n'en dépend pas.
                self.recorder.lose(1)
            else:
                self.recorder.submit(measure)
