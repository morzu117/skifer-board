"""Mesures de télémétrie (plan 11, T1 à T3, T7).

Une mesure ne porte qu'une liste fermée de champs : ni personne, ni chemin brut, ni valeur, ni
corps. L'opération d'une requête est le gabarit de sa route ; son issue est normalisée sur une
liste fermée de codes. On mesure Board, pas les personnes qui s'en servent.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any

from ..spaces.model import ENVIRONMENTS, SPACE_ID

RETENTION = timedelta(days=90)

# Gabarit de route (`/api/spaces/{space_id}/members`), opération fixe (`unmatched`) ou lecture
# nommée (`catalog.list`) : jamais d'espace, de point d'interrogation ni de caractère d'un chemin
# brut qui porterait une valeur.
OPERATION = re.compile(r"[A-Za-z0-9_./{}-]{1,200}")
# Une méthode hors de cette liste (requête d'un robot, par exemple) est comptée sous `OTHER`.
METHODS = frozenset({"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "OTHER"})

# Codes de refus et d'erreur que l'API rend ; tout autre code est rangé sous `other` (T3).
REFUSAL_CODES = frozenset(
    {
        "binding_not_found",
        "catalog_unavailable",
        "connection_binding_not_found",
        "connection_exists",
        "connection_in_use",
        "connection_not_found",
        "credential_not_allowed",
        "credential_not_found",
        "diff_not_supported",
        "diff_unavailable",
        "document_not_found",
        "forbidden",
        "grant_not_found",
        "history_unavailable",
        "http_error",
        "internal_error",
        "invalid_parameter",
        "invalid_request",
        "last_admin",
        "local_mode",
        "method_not_allowed",
        "origin_refused",
        "parameter_exists",
        "parameter_limit",
        "parameter_not_found",
        "route_not_found",
        "space_exists",
        "space_not_found",
        "unauthenticated",
        "unknown_person",
        "values_incompatible",
        "vault_unavailable",
        "version_not_found",
    }
)
OUTCOMES = REFUSAL_CODES | {"ok", "error", "other"}


class Kind(StrEnum):
    HTTP = "http"
    ATLAS = "atlas"


class Window(StrEnum):
    DAY = "24h"
    WEEK = "7d"
    MONTH = "30d"

    @property
    def span(self) -> timedelta:
        return _SPANS[self]


_SPANS = {
    Window.DAY: timedelta(days=1),
    Window.WEEK: timedelta(days=7),
    Window.MONTH: timedelta(days=30),
}


class InvalidMeasure(ValueError):
    """Mesure hors de la liste fermée des champs : elle n'est pas enregistrée."""


def outcome(status: int | None, code: str | None) -> str:
    """Issue normalisée : `ok`, un code de refus connu, sinon `error` (5xx) ou `other`."""
    if status is not None and status < 400:
        return "ok"
    if code in REFUSAL_CODES:
        return code
    return "error" if status is None or status >= 500 else "other"


@dataclass(frozen=True)
class Measure:
    at: datetime
    kind: Kind
    operation: str
    outcome: str
    duration_ms: float
    method: str | None = None
    status: int | None = None
    space: str | None = None
    environment: str | None = None
    rows: int | None = None
    size: int | None = None

    def __post_init__(self) -> None:
        if self.at.tzinfo is None:
            raise InvalidMeasure("at")
        if not isinstance(self.kind, Kind):
            raise InvalidMeasure("kind")
        if OPERATION.fullmatch(self.operation) is None:
            raise InvalidMeasure("operation")
        if self.outcome not in OUTCOMES:
            raise InvalidMeasure("outcome")
        if not math.isfinite(self.duration_ms) or self.duration_ms < 0:
            raise InvalidMeasure("duration_ms")
        # Une requête a une méthode et un statut ; une lecture d'Atlas n'a ni l'un ni l'autre.
        http = self.kind is Kind.HTTP
        if (self.method is not None) != http or (
            self.method is not None and self.method not in METHODS
        ):
            raise InvalidMeasure("method")
        if (self.status is not None) != http or (
            self.status is not None
            and (type(self.status) is not int or not 100 <= self.status <= 599)
        ):
            raise InvalidMeasure("status")
        if self.space is not None and SPACE_ID.fullmatch(self.space) is None:
            raise InvalidMeasure("space")
        if self.environment is not None and self.environment not in ENVIRONMENTS:
            raise InvalidMeasure("environment")
        for field, count in (("rows", self.rows), ("size", self.size)):
            # Un entier exact : un booléen ou un nombre à virgule serait arrondi par la base.
            if count is not None and (type(count) is not int or count < 0):
                raise InvalidMeasure(field)

    def to_json(self) -> dict[str, Any]:
        """Ligne JSON de la sortie standard (T4) : les mêmes champs que la table, rien de plus."""
        return {
            "at": self.at.astimezone(UTC).isoformat(),
            "kind": self.kind.value,
            "operation": self.operation,
            "method": self.method,
            "status": self.status,
            "outcome": self.outcome,
            "space": self.space,
            "environment": self.environment,
            "duration_ms": self.duration_ms,
            "rows": self.rows,
            "size": self.size,
        }


@dataclass(frozen=True)
class OperationSummary:
    """Une opération sur la fenêtre : nombres exacts, centiles calculés par la base (T7)."""

    kind: Kind
    operation: str
    method: str | None
    count: int
    errors: int
    refusals: int
    duration_p50: float
    duration_p95: float
    duration_max: float
    size_p50: float | None
    size_max: int | None
    rows_p50: float | None
    rows_max: int | None

    def to_json(self) -> dict[str, Any]:
        return {
            "kind": self.kind.value,
            "operation": self.operation,
            "method": self.method,
            "count": self.count,
            "errors": self.errors,
            "refusals": self.refusals,
            "duration_ms": {
                "p50": self.duration_p50,
                "p95": self.duration_p95,
                "max": self.duration_max,
            },
            "size": {"p50": self.size_p50, "max": self.size_max},
            "rows": {"p50": self.rows_p50, "max": self.rows_max},
        }


@dataclass(frozen=True)
class Summary:
    window: Window
    start: datetime
    end: datetime
    oldest: datetime | None
    newest: datetime | None
    operations: tuple[OperationSummary, ...]

    def to_json(self) -> dict[str, Any]:
        """Réponse de lecture (T7) : la fenêtre demandée et la période réellement couverte."""
        return {
            "window": self.window.value,
            "start": self.start.astimezone(UTC).isoformat(),
            "end": self.end.astimezone(UTC).isoformat(),
            "oldest": None if self.oldest is None else self.oldest.astimezone(UTC).isoformat(),
            "newest": None if self.newest is None else self.newest.astimezone(UTC).isoformat(),
            "operations": [operation.to_json() for operation in self.operations],
        }
