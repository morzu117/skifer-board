"""Index des analyses en base (plan 18, A4) : liste rapide, jamais source d'un contenu.

Une ligne par analyse existante. Elle porte de quoi lister (nom, propriétaire, visibilité,
modèle, métriques) et de quoi repérer un écart avec git (révision et commit courants). Elle ne
porte ni requête, ni filtre, ni calcul : tout contenu servi vient de git. Une ligne qui n'est
plus le dernier commit du fichier est `index_stale` ; `skifer-board-reindex` la reconstruit.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Engine, delete, insert, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..spaces.model import PersonRef
from ..state.schema import analysis_index
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
        self, rows: Iterable[IndexRow], before_commit: Callable[[], None] | None = None
    ) -> int:
        """Remplace tout l'index par ces lignes, en une transaction : un lecteur voit l'ancien
        index ou le nouveau, jamais un index à moitié reconstruit.

        `before_commit` s'exécute dans la transaction, juste avant le commit ; s'il lève, la
        transaction est annulée et l'index garde son contenu d'avant."""
        at = self._clock()
        values = [_values(row, at) for row in rows]
        with self._engine.begin() as connection:
            connection.execute(delete(analysis_index))
            if values:
                connection.execute(insert(analysis_index), values)
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
