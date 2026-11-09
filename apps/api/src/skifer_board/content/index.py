"""Index des analyses et des dashboards en base (plans 18, A4, et 19, B5) : liste rapide, jamais
source d'un contenu.

Une ligne par analyse existante. Elle porte de quoi lister (nom, propriétaire, visibilité,
modèle, métriques) et de quoi repérer un écart avec git (révision et commit courants). Elle ne
porte ni requête, ni filtre, ni calcul : tout contenu servi vient de git. Une ligne qui n'est
plus le dernier commit du fichier est `index_stale` ; `skifer-board-reindex` la reconstruit.

Un dashboard a la même ligne, sans modèle ni métriques, et ses références : pour sa révision
courante, les couples (analyse, révision) et l'identifiant du composant qui les épingle. Elles
servent à répondre à « qui consomme cette analyse ? » et ne sont jamais la source d'un contenu.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Connection, Engine, delete, insert, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..spaces.model import PersonRef
from ..state.schema import analysis_index, dashboard_index, dashboard_references
from .dashboard import executables
from .repository import StoredRevision

INDEXED = "indexed"


@dataclass(frozen=True)
class IndexRow:
    space_id: str
    analysis_id: str
    name: str
    owner: PersonRef
    visibility: str
    revision: int
    commit: str
    committed_at: datetime
    model: str
    metrics: tuple[str, ...]
    state: str = INDEXED

    @classmethod
    def of(cls, space_id: str, stored: StoredRevision) -> IndexRow:
        document = stored.document
        owner = document["owner"]
        return cls(
            space_id,
            document["id"],
            document["name"],
            PersonRef(owner["issuer"], owner["subject"]),
            document["visibility"],
            stored.revision.number,
            stored.revision.commit,
            stored.revision.committed_at,
            document["query"]["model"],
            tuple(document["query"]["metrics"]),
        )


def _values(row: IndexRow, at: datetime) -> dict[str, Any]:
    return {
        "space_id": row.space_id,
        "analysis_id": row.analysis_id,
        "name": row.name,
        "owner_issuer": row.owner.issuer,
        "owner_subject": row.owner.subject,
        "visibility": row.visibility,
        "revision": row.revision,
        "commit": row.commit,
        "committed_at": row.committed_at,
        "model": row.model,
        "metrics": list(row.metrics),
        "state": row.state,
        "indexed_at": at,
    }


class AnalysisIndex:
    def __init__(
        self, engine: Engine, clock: Callable[[], datetime] = lambda: datetime.now(UTC)
    ) -> None:
        self._engine = engine
        self._clock = clock

    def upsert(self, row: IndexRow) -> None:
        """Pose la ligne si elle n'est pas plus ancienne que celle en place : deux écritures
        qui se terminent dans le désordre ne ramènent pas l'index en arrière."""
        values = _values(row, self._clock())
        statement = pg_insert(analysis_index).values(values)
        statement = statement.on_conflict_do_update(
            index_elements=["space_id", "analysis_id"],
            set_={
                key: statement.excluded[key]
                for key in values
                if key not in {"space_id", "analysis_id"}
            },
            where=analysis_index.c.revision <= statement.excluded.revision,
        )
        with self._engine.begin() as connection:
            connection.execute(statement)

    def remove(self, space_id: str, analysis_id: str, revision: int) -> None:
        """Retire la ligne d'une analyse supprimée (jamais une ligne plus récente que celle-ci)."""
        with self._engine.begin() as connection:
            connection.execute(
                delete(analysis_index).where(
                    analysis_index.c.space_id == space_id,
                    analysis_index.c.analysis_id == analysis_id,
                    analysis_index.c.revision <= revision,
                )
            )

    def get(self, space_id: str, analysis_id: str) -> IndexRow | None:
        with self._engine.connect() as connection:
            found = connection.execute(
                select(analysis_index).where(
                    analysis_index.c.space_id == space_id,
                    analysis_index.c.analysis_id == analysis_id,
                )
            ).first()
        return None if found is None else _row(found)

    def rows(self, space_id: str) -> list[IndexRow]:
        with self._engine.connect() as connection:
            found = connection.execute(
                select(analysis_index)
                .where(analysis_index.c.space_id == space_id)
                .order_by(analysis_index.c.analysis_id)
            ).all()
        return [_row(item) for item in found]

    def replace(
        self,
        rows: Iterable[IndexRow],
        before_commit: Callable[[], None] | None = None,
        inside: Callable[[Connection], None] | None = None,
    ) -> int:
        """Remplace tout l'index par ces lignes, en une transaction : un lecteur voit l'ancien
        index ou le nouveau, jamais un index à moitié reconstruit.

        `inside` s'exécute dans la même transaction, avec sa connexion (l'index des dashboards
        s'y reconstruit, pour que les deux genres changent ensemble ou pas du tout).
        `before_commit` s'exécute ensuite, juste avant le commit ; s'il lève, la transaction est
        annulée et l'index garde son contenu d'avant."""
        at = self._clock()
        values = [_values(row, at) for row in rows]
        with self._engine.begin() as connection:
            connection.execute(delete(analysis_index))
            if values:
                connection.execute(insert(analysis_index), values)
            if inside is not None:
                inside(connection)
            if before_commit is not None:
                before_commit()
        return len(values)


def _row(found: Any) -> IndexRow:
    return IndexRow(
        found.space_id,
        found.analysis_id,
        found.name,
        PersonRef(found.owner_issuer, found.owner_subject),
        found.visibility,
        found.revision,
        found.commit,
        found.committed_at.astimezone(UTC),
        found.model,
        tuple(found.metrics),
        found.state,
    )


@dataclass(frozen=True)
class Reference:
    """Une analyse épinglée par un composant exécutable d'un dashboard."""

    component_id: str
    analysis_id: str
    analysis_revision: int


@dataclass(frozen=True)
class DashboardRow:
    space_id: str
    dashboard_id: str
    name: str
    owner: PersonRef
    visibility: str
    revision: int
    commit: str
    committed_at: datetime
    references: tuple[Reference, ...] = ()
    state: str = INDEXED

    @classmethod
    def of(cls, space_id: str, stored: StoredRevision) -> DashboardRow:
        document = stored.document
        owner = document["owner"]
        return cls(
            space_id,
            document["id"],
            document["name"],
            PersonRef(owner["issuer"], owner["subject"]),
            document["visibility"],
            stored.revision.number,
            stored.revision.commit,
            stored.revision.committed_at,
            tuple(
                Reference(item.id, item.analysis_id, item.revision)
                for item in executables(document)
            ),
        )


def _dashboard_values(row: DashboardRow, at: datetime) -> dict[str, Any]:
    return {
        "space_id": row.space_id,
        "dashboard_id": row.dashboard_id,
        "name": row.name,
        "owner_issuer": row.owner.issuer,
        "owner_subject": row.owner.subject,
        "visibility": row.visibility,
        "revision": row.revision,
        "commit": row.commit,
        "committed_at": row.committed_at,
        "state": row.state,
        "indexed_at": at,
    }


def _reference_values(row: DashboardRow) -> list[dict[str, Any]]:
    return [
        {
            "space_id": row.space_id,
            "dashboard_id": row.dashboard_id,
            "component_id": item.component_id,
            "analysis_id": item.analysis_id,
            "analysis_revision": item.analysis_revision,
        }
        for item in row.references
    ]


class DashboardIndex:
    def __init__(
        self, engine: Engine, clock: Callable[[], datetime] = lambda: datetime.now(UTC)
    ) -> None:
        self._engine = engine
        self._clock = clock

    def upsert(self, row: DashboardRow) -> None:
        """Pose la ligne et ses références, en une transaction, si elle n'est pas plus ancienne
        que celle en place : deux écritures qui se terminent dans le désordre ne ramènent pas
        l'index en arrière, et les références restent celles de la ligne qui est en place."""
        values = _dashboard_values(row, self._clock())
        insertion = pg_insert(dashboard_index).values(values)
        statement = insertion.on_conflict_do_update(
            index_elements=["space_id", "dashboard_id"],
            set_={
                key: insertion.excluded[key]
                for key in values
                if key not in {"space_id", "dashboard_id"}
            },
            where=dashboard_index.c.revision <= insertion.excluded.revision,
        ).returning(dashboard_index.c.dashboard_id)
        with self._engine.begin() as connection:
            if connection.execute(statement).first() is None:
                return
            connection.execute(
                delete(dashboard_references).where(
                    dashboard_references.c.space_id == row.space_id,
                    dashboard_references.c.dashboard_id == row.dashboard_id,
                )
            )
            if row.references:
                connection.execute(insert(dashboard_references), _reference_values(row))

    def remove(self, space_id: str, dashboard_id: str, revision: int) -> None:
        """Retire la ligne d'un dashboard supprimé, et ses références avec elle (jamais une ligne
        plus récente que celle-ci)."""
        with self._engine.begin() as connection:
            connection.execute(
                delete(dashboard_index).where(
                    dashboard_index.c.space_id == space_id,
                    dashboard_index.c.dashboard_id == dashboard_id,
                    dashboard_index.c.revision <= revision,
                )
            )

    def get(self, space_id: str, dashboard_id: str) -> DashboardRow | None:
        with self._engine.connect() as connection:
            found = connection.execute(
                select(dashboard_index).where(
                    dashboard_index.c.space_id == space_id,
                    dashboard_index.c.dashboard_id == dashboard_id,
                )
            ).first()
            if found is None:
                return None
            references = connection.execute(
                select(dashboard_references)
                .where(
                    dashboard_references.c.space_id == space_id,
                    dashboard_references.c.dashboard_id == dashboard_id,
                )
                .order_by(dashboard_references.c.component_id)
            ).all()
        return _dashboard_row(found, references)

    def rows(self, space_id: str) -> list[DashboardRow]:
        """Lignes de l'espace, sans leurs références (la liste n'en a pas besoin)."""
        with self._engine.connect() as connection:
            found = connection.execute(
                select(dashboard_index)
                .where(dashboard_index.c.space_id == space_id)
                .order_by(dashboard_index.c.dashboard_id)
            ).all()
        return [_dashboard_row(item, ()) for item in found]

    def consumers(self, space_id: str, analysis_id: str) -> list[DashboardRow]:
        """Dashboards dont la révision courante épingle l'analyse (une révision quelconque),
        triés par identifiant, sans leurs références."""
        with self._engine.connect() as connection:
            found = connection.execute(
                select(dashboard_index)
                .where(
                    dashboard_index.c.space_id == space_id,
                    dashboard_index.c.dashboard_id.in_(
                        select(dashboard_references.c.dashboard_id).where(
                            dashboard_references.c.space_id == space_id,
                            dashboard_references.c.analysis_id == analysis_id,
                        )
                    ),
                )
                .order_by(dashboard_index.c.dashboard_id)
            ).all()
        return [_dashboard_row(item, ()) for item in found]

    def replace_in(self, connection: Connection, rows: Iterable[DashboardRow]) -> None:
        """Remplace tous les dashboards indexés dans la transaction de la connexion donnée
        (celle de `AnalysisIndex.replace`) : les références suivent leurs lignes."""
        at = self._clock()
        listed = list(rows)
        connection.execute(delete(dashboard_references))
        connection.execute(delete(dashboard_index))
        if listed:
            connection.execute(insert(dashboard_index), [_dashboard_values(r, at) for r in listed])
            references = [value for row in listed for value in _reference_values(row)]
            if references:
                connection.execute(insert(dashboard_references), references)


def _dashboard_row(found: Any, references: Iterable[Any]) -> DashboardRow:
    return DashboardRow(
        found.space_id,
        found.dashboard_id,
        found.name,
        PersonRef(found.owner_issuer, found.owner_subject),
        found.visibility,
        found.revision,
        found.commit,
        found.committed_at.astimezone(UTC),
        tuple(Reference(r.component_id, r.analysis_id, r.analysis_revision) for r in references),
        found.state,
    )
