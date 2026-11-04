"""Révisions 0007 à 0009 sur une base déjà peuplée en 0006."""

from __future__ import annotations

from datetime import UTC, datetime

from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from skifer_board.execution.model import Connector, IdentityMode
from skifer_board.execution.store import ConnectionStore
from skifer_board.spaces.model import Environment, GroupPrincipal, PersonRef
from skifer_board.spaces.store import SpaceStore
from skifer_board.state import current_revision, upgrade
from skifer_board.state.schema import (
    connection_bindings,
    connection_credentials,
    executions,
    logical_connections,
    metadata,
)
from spaces.test_migration import jusqu_a
from sqlalchemy import Engine, insert, select


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
    assert current_revision(engine) == "0009"
    assert store.get_space("finance") is not None
    with engine.connect() as connection:
        assert connection.execute(select(logical_connections)).all() == []
        assert connection.execute(select(connection_bindings)).all() == []
        assert connection.execute(select(connection_credentials)).all() == []
        assert connection.execute(select(executions)).all() == []
        assert compare_metadata(MigrationContext.configure(connection), metadata) == []


def test_revision_0009_garde_une_liaison_existante(engine: Engine) -> None:
    jusqu_a(engine, "0008")
    at = datetime(2026, 11, 3, tzinfo=UTC)
    actor = PersonRef("issuer", "subject")
    SpaceStore(engine).create_space(
        "finance", "Finance", "atlas", GroupPrincipal("admins"), actor, at
    )
    with engine.begin() as connection:
        connection.execute(
            insert(logical_connections).values(
                space_id="finance",
                name="source",
                created_at=at,
                created_by_issuer=actor.issuer,
                created_by_subject=actor.subject,
            )
        )
        connection.execute(
            insert(connection_bindings).values(
                space_id="finance",
                name="source",
                environment="DEV",
                connector="duckdb",
                endpoint_key="local",
                identity_mode="service",
                set_at=at,
                set_by_issuer=actor.issuer,
                set_by_subject=actor.subject,
            )
        )
    upgrade(engine)
    assert current_revision(engine) == "0009"
    binding = ConnectionStore(engine).get_binding("finance", "source", Environment.DEV)
    assert (binding.connector, binding.endpoint_key, binding.identity_mode) == (
        Connector.DUCKDB,
        "local",
        IdentityMode.SERVICE,
    )
    with engine.connect() as connection:
        assert connection.execute(select(executions)).all() == []
