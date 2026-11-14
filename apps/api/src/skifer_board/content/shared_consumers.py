"""Consommateurs visibles et masqués d'une révision de thème ou de composant."""

from __future__ import annotations

from sqlalchemy.exc import SQLAlchemyError

from ..spaces.model import PersonRef
from .consumer_rows import consumer_row
from .errors import CONTENT_UNAVAILABLE, DASHBOARD_NOT_FOUND, ContentError
from .index import DashboardIndex
from .repository import DAMAGED_REASONS, DASHBOARD_KIND, ContentRepository
from .web import Consumer, Dependents, visible_to


class SharedConsumers:
    """Git fait foi : relecture des index périmés, refus fermé si exhaustivité impossible."""

    def __init__(self, repository: ContentRepository | None, index: DashboardIndex) -> None:
        self._repository = repository
        self._index = index

    def __call__(
        self,
        space_id: str,
        kind: str,
        content_id: str,
        revision: int,
        actor: PersonRef,
        at: str | None,
    ) -> Dependents:
        if kind not in {"theme", "component"}:
            raise ValueError("Genre sans consommateurs")
        if self._repository is None:
            raise ContentError(CONTENT_UNAVAILABLE, "not_configured")
        try:
            known = {row.dashboard_id: row for row in self._index.rows(space_id)}
        except SQLAlchemyError:
            raise ContentError(CONTENT_UNAVAILABLE, "index_unavailable") from None
        newest = self._repository.latest(space_id, at=at, kind=DASHBOARD_KIND)
        visible: list[Consumer] = []
        others = 0
        for ident, commit in sorted(newest.items()):
            try:
                row = consumer_row(
                    self._repository, self._index, space_id, ident, commit, known.get(ident), at
                )
            except ContentError as error:
                if error.code == DASHBOARD_NOT_FOUND:
                    continue
                if error.code == CONTENT_UNAVAILABLE and error.reason in DAMAGED_REASONS:
                    others += 1
                    continue
                raise
            pins = (
                row.theme == (content_id, revision)
                if kind == "theme"
                else any(
                    (item.component_ref_id, item.revision) == (content_id, revision)
                    for item in row.components
                )
            )
            if not pins:
                continue
            if visible_to(row.owner, row.visibility, actor):
                visible.append(Consumer("dashboard", ident))
            else:
                others += 1
        return Dependents(tuple(visible), others)
