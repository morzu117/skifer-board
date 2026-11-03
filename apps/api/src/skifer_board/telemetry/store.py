"""Mesures de télémétrie dans la base d'état (plan 11, T4, T6, T7).

Les requêtes sont construites avec SQLAlchemy Core, jamais écrites en texte. Les centiles sont
calculés par la base (`percentile_cont`) ; l'ordre des opérations est fixé ici, sans dépendre de
la collation de la base.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import ColumnElement, Engine, and_, delete, func, insert, or_, select

from ..state.schema import telemetry
from .model import Kind, Measure, OperationSummary, Summary, Window


def _utc(instant: datetime | None) -> datetime | None:
    """Instant relu en UTC : la base le rend dans le fuseau de sa session, quel qu'il soit."""
    return None if instant is None else instant.astimezone(UTC)


def _aware(instant: datetime, field: str) -> None:
    """Un instant sans fuseau serait lu dans celui de la session de la base : refusé."""
    if instant.tzinfo is None:
        raise ValueError(field)


def _median(column: ColumnElement[float] | ColumnElement[int]) -> ColumnElement[float]:
    return func.percentile_cont(0.5).within_group(column)


class TelemetryStore:
    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def record(self, measures: Sequence[Measure]) -> None:
        """Enregistre un lot de mesures en une transaction."""
        if not measures:
            return
        rows = [
            {
                "at": measure.at,
                "kind": measure.kind.value,
                "operation": measure.operation,
                "method": measure.method,
                "status": measure.status,
                "outcome": measure.outcome,
                "space_id": measure.space,
                "environment": measure.environment,
                "duration_ms": measure.duration_ms,
                "rows": measure.rows,
                "size": measure.size,
            }
            for measure in measures
        ]
        with self._engine.begin() as connection:
            connection.execute(insert(telemetry), rows)

    def purge(self, before: datetime) -> int:
        """Retire les mesures antérieures à `before` (T6) ; rend leur nombre."""
        _aware(before, "before")
        with self._engine.begin() as connection:
            return connection.execute(delete(telemetry).where(telemetry.c.at < before)).rowcount

    def summary(self, window: Window, now: datetime) -> Summary:
        """Résumé des mesures de `[now - fenêtre, now]` par genre, opération et méthode (T7)."""
        _aware(now, "now")
        start = now - window.span
        within = and_(telemetry.c.at >= start, telemetry.c.at <= now)
        # Une erreur : un 5xx, ou une lecture d'Atlas qui n'a pas abouti. Un refus : un 4xx.
        error = or_(
            telemetry.c.status >= 500,
            and_(telemetry.c.status.is_(None), telemetry.c.outcome != "ok"),
        )
        refusal = and_(telemetry.c.status >= 400, telemetry.c.status < 500)
        grouped = (
            select(
                telemetry.c.kind,
                telemetry.c.operation,
                telemetry.c.method,
                func.count().label("measures"),
                func.count().filter(error).label("errors"),
                func.count().filter(refusal).label("refusals"),
                _median(telemetry.c.duration_ms).label("duration_p50"),
                func.percentile_cont(0.95)
                .within_group(telemetry.c.duration_ms)
                .label("duration_p95"),
                func.max(telemetry.c.duration_ms).label("duration_max"),
                _median(telemetry.c.size).label("size_p50"),
                func.max(telemetry.c.size).label("size_max"),
                _median(telemetry.c.rows).label("rows_p50"),
                func.max(telemetry.c.rows).label("rows_max"),
            )
            .where(within)
            .group_by(telemetry.c.kind, telemetry.c.operation, telemetry.c.method)
        )
        bounds = select(func.min(telemetry.c.at), func.max(telemetry.c.at)).where(within)
        with self._engine.connect() as connection:
            rows = connection.execute(grouped).all()
            oldest, newest = connection.execute(bounds).one()
        operations = [
            OperationSummary(
                kind=Kind(row.kind),
                operation=row.operation,
                method=row.method,
                count=row.measures,
                errors=row.errors,
                refusals=row.refusals,
                duration_p50=row.duration_p50,
                duration_p95=row.duration_p95,
                duration_max=row.duration_max,
                size_p50=row.size_p50,
                size_max=row.size_max,
                rows_p50=row.rows_p50,
                rows_max=row.rows_max,
            )
            for row in rows
        ]
        # Les plus lentes d'abord ; à p95 égal, un ordre stable et indépendant de la base.
        operations.sort(
            key=lambda found: (
                -found.duration_p95,
                found.kind.value,
                found.operation,
                found.method or "",
            )
        )
        return Summary(window, start, now, _utc(oldest), _utc(newest), tuple(operations))
