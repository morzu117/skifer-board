"""Révisions 0007 et 0008 sur une base déjà peuplée en 0006."""

from __future__ import annotations

from datetime import UTC, datetime

from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from skifer_board.spaces.model import GroupPrincipal, PersonRef
from skifer_board.spaces.store import SpaceStore
from skifer_board.state import current_revision, upgrade
from skifer_board.state.schema import (
    connection_bindings,
    connection_credentials,
    logical_connections,
    metadata,
)
from spaces.test_migration import jusqu_a
from sqlalchemy import Engine, select


def test_revision_0007_garde_les_espaces_et_part_vide(engine: Engine) -> None:
    jusqu_a(engine, "0006")
    store = SpaceStore(engine)
    actor = PersonRef("issuer", "subject")
    store.create_space(
        "finance",
        "Finance",
        "atlas",
        GroupPrincipal("admins"),
        actor,
        datetime(2026, 11, 3, tzinfo=UTC),
    )
    assert current_revision(engine) == "0006"
    jusqu_a(engine, "0007")
    assert current_revision(engine) == "0007"
    upgrade(engine)
    assert current_revision(engine) == "0008"
    assert store.get_space("finance") is not None
    with engine.connect() as connection:
        assert connection.execute(select(logical_connections)).all() == []
        assert connection.execute(select(connection_bindings)).all() == []
        assert connection.execute(select(connection_credentials)).all() == []
        assert compare_metadata(MigrationContext.configure(connection), metadata) == []
