"""Registre de connexions en PostgreSQL, sans secrets (plan 12, 12.1)."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import Engine, delete, insert, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError

from ..spaces.model import Environment, PersonRef
from ..state.schema import connection_bindings, logical_connections, space_events
from .model import Binding, Connector, IdentityMode, LogicalConnection


class ConnectionError(Exception):
    code = "connection_error"


class ConnectionExists(ConnectionError):
    code = "connection_exists"


class ConnectionNotFound(ConnectionError):
    code = "connection_not_found"


class BindingNotFound(ConnectionError):
    code = "connection_binding_not_found"


class ConnectionInUse(ConnectionError):
    code = "connection_in_use"


def _logical(row: object) -> LogicalConnection:
    data = row._mapping  # type: ignore[attr-defined]
    return LogicalConnection(
        data["space_id"],
        data["name"],
        data["created_at"].astimezone(UTC),
        PersonRef(data["created_by_issuer"], data["created_by_subject"]),
    )


def _binding(row: object) -> Binding:
    data = row._mapping  # type: ignore[attr-defined]
    return Binding(
        data["space_id"],
        data["name"],
        Environment(data["environment"]),
        Connector(data["connector"]),
        data["endpoint_key"],
        IdentityMode(data["identity_mode"]),
        data["set_at"].astimezone(UTC),
        PersonRef(data["set_by_issuer"], data["set_by_subject"]),
    )


class ConnectionStore:
    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    @staticmethod
    def _event(
        connection: object,
        space_id: str,
        actor: PersonRef,
        at: datetime,
        action: str,
        detail: dict[str, str],
    ) -> None:
        connection.execute(  # type: ignore[attr-defined]
            insert(space_events).values(
                space_id=space_id,
                actor_issuer=actor.issuer,
                actor_subject=actor.subject,
                at=at,
                action=action,
                detail=detail,
            )
        )

    def list(self, space_id: str) -> list[tuple[LogicalConnection, list[Binding]]]:
        with self._engine.connect() as connection:
            logical = connection.execute(
                select(logical_connections)
                .where(logical_connections.c.space_id == space_id)
                .order_by(logical_connections.c.name)
            ).all()
            bindings = connection.execute(
                select(connection_bindings)
                .where(connection_bindings.c.space_id == space_id)
                .order_by(connection_bindings.c.name, connection_bindings.c.environment)
            ).all()
        by_name: dict[str, list[Binding]] = {row.name: [] for row in logical}
        for row in bindings:
            by_name[row.name].append(_binding(row))
        return [(_logical(row), by_name[row.name]) for row in logical]

    def create(self, space_id: str, name: str, actor: PersonRef, at: datetime) -> LogicalConnection:
        try:
            with self._engine.begin() as connection:
                connection.execute(
                    insert(logical_connections).values(
                        space_id=space_id,
                        name=name,
                        created_at=at,
                        created_by_issuer=actor.issuer,
                        created_by_subject=actor.subject,
                    )
                )
                self._event(connection, space_id, actor, at, "connection_created", {"name": name})
        except IntegrityError:
            raise ConnectionExists(name) from None
        return LogicalConnection(space_id, name, at, actor)

    def bind(
        self,
        space_id: str,
        name: str,
        environment: Environment,
        connector: Connector,
        endpoint_key: str,
        identity_mode: IdentityMode,
        actor: PersonRef,
        at: datetime,
    ) -> Binding:
        with self._engine.begin() as connection:
            parent = connection.execute(
                select(logical_connections.c.name)
                .where(
                    logical_connections.c.space_id == space_id, logical_connections.c.name == name
                )
                .with_for_update()
            ).one_or_none()
            if parent is None:
                raise ConnectionNotFound(name)
            old = connection.execute(
                select(connection_bindings).where(
                    connection_bindings.c.space_id == space_id,
                    connection_bindings.c.name == name,
                    connection_bindings.c.environment == environment.value,
                )
            ).one_or_none()
            if old is not None and (old.connector, old.endpoint_key, old.identity_mode) == (
                connector.value,
                endpoint_key,
                identity_mode.value,
            ):
                return _binding(old)
            values = dict(
                connector=connector.value,
                endpoint_key=endpoint_key,
                identity_mode=identity_mode.value,
                set_at=at,
                set_by_issuer=actor.issuer,
                set_by_subject=actor.subject,
            )
            statement = pg_insert(connection_bindings).values(
                space_id=space_id, name=name, environment=environment.value, **values
            )
            connection.execute(
                statement.on_conflict_do_update(constraint="pk_connection_bindings", set_=values)
            )
            self._event(
                connection,
                space_id,
                actor,
                at,
                "connection_bound",
                {"name": name, "environment": environment.value},
            )
        return Binding(
            space_id, name, environment, connector, endpoint_key, identity_mode, at, actor
        )

    def unbind(
        self, space_id: str, name: str, environment: Environment, actor: PersonRef, at: datetime
    ) -> None:
        with self._engine.begin() as connection:
            parent = connection.execute(
                select(logical_connections.c.name)
                .where(
                    logical_connections.c.space_id == space_id,
                    logical_connections.c.name == name,
                )
                .with_for_update()
            ).one_or_none()
            if parent is None:
                raise ConnectionNotFound(name)
            removed = connection.execute(
                delete(connection_bindings).where(
                    connection_bindings.c.space_id == space_id,
                    connection_bindings.c.name == name,
                    connection_bindings.c.environment == environment.value,
                )
            )
            if removed.rowcount != 1:
                raise BindingNotFound(environment.value)
            self._event(
                connection,
                space_id,
                actor,
                at,
                "connection_unbound",
                {"name": name, "environment": environment.value},
            )

    def remove(self, space_id: str, name: str, actor: PersonRef, at: datetime) -> None:
        with self._engine.begin() as connection:
            parent = connection.execute(
                select(logical_connections.c.name)
                .where(
                    logical_connections.c.space_id == space_id,
                    logical_connections.c.name == name,
                )
                .with_for_update()
            ).one_or_none()
            if parent is None:
                raise ConnectionNotFound(name)
            in_use = connection.execute(
                select(connection_bindings.c.name)
                .where(
                    connection_bindings.c.space_id == space_id, connection_bindings.c.name == name
                )
                .limit(1)
            ).one_or_none()
            if in_use is not None:
                raise ConnectionInUse(name)
            connection.execute(
                delete(logical_connections).where(
                    logical_connections.c.space_id == space_id, logical_connections.c.name == name
                )
            )
            self._event(connection, space_id, actor, at, "connection_removed", {"name": name})
