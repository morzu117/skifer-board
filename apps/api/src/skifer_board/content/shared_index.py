"""Index reconstructible des thèmes, modèles et composants (plan 20.2)."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Connection, Engine, delete, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..spaces.model import PersonRef
from ..state.schema import content_approvals, shared_content_index
from .repository import COMPONENT_KIND, PAGE_TEMPLATE_KIND, THEME_KIND, Kind, StoredRevision


@dataclass(frozen=True)
class SharedRow:
    kind: str
    space_id: str
    content_id: str
    name: str
    owner: PersonRef
    revision: int
    commit: str
    committed_at: datetime
    approved_revision: int | None = None
    component_kind: str | None = None
    analysis_id: str | None = None
    analysis_revision: int | None = None

    @classmethod
    def of(
        cls, kind: Kind, space_id: str, stored: StoredRevision, approved: int | None = None
    ) -> SharedRow:
        if not any(
            kind is candidate for candidate in (THEME_KIND, PAGE_TEMPLATE_KIND, COMPONENT_KIND)
        ):
            raise TypeError("Genre non indexable")
        data = stored.document
        owner = data["owner"]
        component = kind is COMPONENT_KIND
        return cls(
            kind.name,
            space_id,
            data["id"],
            data["name"],
            PersonRef(owner["issuer"], owner["subject"]),
            stored.revision.number,
            stored.revision.commit,
            stored.revision.committed_at,
            approved,
            data["kind"] if component else None,
            data["analysis"]["analysis_id"] if component else None,
            data["analysis"]["revision"] if component else None,
        )


@dataclass(frozen=True)
class ApprovalRow:
    kind: str
    space_id: str
    content_id: str
    revision: int
    approver: PersonRef
    approved_at: datetime


def _values(row: SharedRow, at: datetime) -> dict[str, Any]:
    return {
        "kind": row.kind,
        "space_id": row.space_id,
        "content_id": row.content_id,
        "name": row.name,
        "owner_issuer": row.owner.issuer,
        "owner_subject": row.owner.subject,
        "revision": row.revision,
        "commit": row.commit,
        "committed_at": row.committed_at,
        "approved_revision": row.approved_revision,
        "component_kind": row.component_kind,
        "analysis_id": row.analysis_id,
        "analysis_revision": row.analysis_revision,
        "indexed_at": at,
    }


def _row(item: Any) -> SharedRow:
    return SharedRow(
        item.kind,
        item.space_id,
        item.content_id,
        item.name,
        PersonRef(item.owner_issuer, item.owner_subject),
        item.revision,
        item.commit,
        item.committed_at.astimezone(UTC),
        item.approved_revision,
        item.component_kind,
        item.analysis_id,
        item.analysis_revision,
    )


def _approval_values(row: ApprovalRow) -> dict[str, Any]:
    return {
        "kind": row.kind,
        "space_id": row.space_id,
        "content_id": row.content_id,
        "revision": row.revision,
        "issuer": row.approver.issuer,
        "subject": row.approver.subject,
        "approved_at": row.approved_at,
    }


class SharedIndex:
    def __init__(
        self, engine: Engine, clock: Callable[[], datetime] = lambda: datetime.now(UTC)
    ) -> None:
        self._engine = engine
        self._clock = clock

    def upsert(self, row: SharedRow) -> None:
        values = _values(row, self._clock())
        statement = pg_insert(shared_content_index).values(values)
        statement = statement.on_conflict_do_update(
            index_elements=["kind", "space_id", "content_id"],
            set_={
                key: (
                    func.greatest(shared_content_index.c.approved_revision, statement.excluded[key])
                    if key == "approved_revision"
                    else statement.excluded[key]
                )
                for key in values
                if key not in {"kind", "space_id", "content_id"}
            },
            where=shared_content_index.c.revision <= statement.excluded.revision,
        )
        with self._engine.begin() as connection:
            connection.execute(statement)

    def remove(self, kind: str, space_id: str, content_id: str, revision: int) -> None:
        with self._engine.begin() as connection:
            removed = connection.execute(
                delete(shared_content_index)
                .where(
                    shared_content_index.c.kind == kind,
                    shared_content_index.c.space_id == space_id,
                    shared_content_index.c.content_id == content_id,
                    shared_content_index.c.revision <= revision,
                )
                .returning(shared_content_index.c.content_id)
            ).first()
            if removed is not None:
                connection.execute(
                    delete(content_approvals).where(
                        content_approvals.c.kind == kind,
                        content_approvals.c.space_id == space_id,
                        content_approvals.c.content_id == content_id,
                    )
                )

    def get(self, kind: str, space_id: str, content_id: str) -> SharedRow | None:
        with self._engine.connect() as connection:
            item = connection.execute(
                select(shared_content_index).where(
                    shared_content_index.c.kind == kind,
                    shared_content_index.c.space_id == space_id,
                    shared_content_index.c.content_id == content_id,
                )
            ).first()
        return None if item is None else _row(item)

    def rows(self, kind: str, space_id: str) -> list[SharedRow]:
        with self._engine.connect() as connection:
            found = connection.execute(
                select(shared_content_index)
                .where(
                    shared_content_index.c.kind == kind, shared_content_index.c.space_id == space_id
                )
                .order_by(shared_content_index.c.content_id)
            ).all()
        return [_row(item) for item in found]

    def approvals(self, kind: str, space_id: str, content_id: str) -> list[ApprovalRow]:
        with self._engine.connect() as connection:
            found = connection.execute(
                select(content_approvals)
                .where(
                    content_approvals.c.kind == kind,
                    content_approvals.c.space_id == space_id,
                    content_approvals.c.content_id == content_id,
                )
                .order_by(content_approvals.c.revision)
            ).all()
        return [
            ApprovalRow(
                item.kind,
                item.space_id,
                item.content_id,
                item.revision,
                PersonRef(item.issuer, item.subject),
                item.approved_at.astimezone(UTC),
            )
            for item in found
        ]

    def record_approvals(
        self,
        kind: str,
        space_id: str,
        content_id: str,
        expected_revision: int,
        approvals: Iterable[ApprovalRow],
    ) -> bool:
        """Complète l'index sous verrou sans écraser une approbation concurrente."""
        approved = list(approvals)
        with self._engine.begin() as connection:
            key = (
                shared_content_index.c.kind == kind,
                shared_content_index.c.space_id == space_id,
                shared_content_index.c.content_id == content_id,
            )
            current = connection.execute(
                select(shared_content_index.c.revision, shared_content_index.c.approved_revision)
                .where(*key)
                .with_for_update()
            ).first()
            if current is None or current.revision < expected_revision:
                return False
            for row in approved:
                stmt = pg_insert(content_approvals).values(_approval_values(row))
                connection.execute(stmt.on_conflict_do_nothing())
            latest = max((row.revision for row in approved), default=0)
            latest = max(latest, current.approved_revision or 0)
            connection.execute(
                update(shared_content_index)
                .where(*key)
                .values(approved_revision=latest or None, indexed_at=self._clock())
            )
        return True

    def replace_in(
        self, connection: Connection, rows: Iterable[SharedRow], approvals: Iterable[ApprovalRow]
    ) -> None:
        listed = list(rows)
        approved = list(approvals)
        connection.execute(delete(content_approvals))
        connection.execute(delete(shared_content_index))
        if listed:
            connection.execute(
                insert(shared_content_index), [_values(row, self._clock()) for row in listed]
            )
        if approved:
            connection.execute(
                insert(content_approvals), [_approval_values(row) for row in approved]
            )
