"""Relecture cohérente d'un dashboard consommateur sur la tête choisie."""

from sqlalchemy.exc import SQLAlchemyError

from .errors import CONTENT_UNAVAILABLE, ContentError
from .index import DashboardIndex, DashboardRow
from .repository import DASHBOARD_KIND, ContentRepository


def consumer_row(
    repository: ContentRepository,
    index: DashboardIndex,
    space_id: str,
    ident: str,
    commit: str,
    known: DashboardRow | None,
    at: str | None,
) -> DashboardRow:
    """Préfère l'index cohérent, puis relit Git à la tête de la consultation."""
    if known is not None and known.commit == commit:
        try:
            row = index.get(space_id, ident)
        except SQLAlchemyError:
            raise ContentError(CONTENT_UNAVAILABLE, "index_unavailable") from None
        if row is not None and row.commit == commit:
            return row
    return DashboardRow.of(space_id, repository.read(space_id, ident, at=at, kind=DASHBOARD_KIND))
