"""État durable des exécutions, sans SQL ni identifiant de source (plan 12.5a)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import uuid4

from sqlalchemy import Engine, insert, select, update

from ..spaces.model import Environment, PersonRef
from ..state.schema import connection_bindings, executions, logical_connections
from .model import Binding, Connector, IdentityMode


class ExecutionState(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    DENIED = "denied"
    FAILED = "failed"
    TIMED_OUT = "timed_out"
    CANCELLED = "cancelled"


TERMINAL = frozenset(
    {
        ExecutionState.SUCCEEDED,
        ExecutionState.DENIED,
        ExecutionState.FAILED,
        ExecutionState.TIMED_OUT,
        ExecutionState.CANCELLED,
    }
)
MAX_ROWS = 1_000
MAX_BYTES = 1024 * 1024


class ExecutionUnavailable(Exception):
    """Liaison modifiée ou retirée pendant la soumission."""


@dataclass(frozen=True)
class ExecutionRecord:
    id: str
    space_id: str
    environment: Environment
    reader: PersonRef
    connection_name: str
    request_hash: str
    connector: Connector
    endpoint_key: str
    identity_mode: IdentityMode
    binding_set_at: datetime
    state: ExecutionState
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    deadline_at: datetime
    lease_until: datetime
    owner_id: str
    connector_run_id: str | None
    cancel_requested: bool
    error_code: str | None
    evidence: dict[str, Any] | None
    row_count: int | None
    byte_count: int | None
    truncated: bool | None


def _utc(value: datetime | None) -> datetime | None:
    return None if value is None else value.astimezone(UTC)


def _record(row: Any) -> ExecutionRecord:
    data = row._mapping
    return ExecutionRecord(
        id=data["id"],
        space_id=data["space_id"],
        environment=Environment(data["environment"]),
        reader=PersonRef(data["issuer"], data["subject"]),
        connection_name=data["connection_name"],
        request_hash=data["request_hash"],
        connector=Connector(data["connector"]),
        endpoint_key=data["endpoint_key"],
        identity_mode=IdentityMode(data["identity_mode"]),
        binding_set_at=data["binding_set_at"].astimezone(UTC),
        state=ExecutionState(data["state"]),
        created_at=data["created_at"].astimezone(UTC),
        started_at=_utc(data["started_at"]),
        finished_at=_utc(data["finished_at"]),
        deadline_at=data["deadline_at"].astimezone(UTC),
        lease_until=data["lease_until"].astimezone(UTC),
        owner_id=data["owner_id"],
        connector_run_id=data["connector_run_id"],
        cancel_requested=data["cancel_requested"],
        error_code=data["error_code"],
        evidence=data["evidence"],
        row_count=data["row_count"],
        byte_count=data["byte_count"],
        truncated=data["truncated"],
    )


class ExecutionStore:
    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def create(
        self,
        binding: Binding,
        reader: PersonRef,
        request_hash: str,
        at: datetime,
        deadline_at: datetime,
        lease_until: datetime,
        owner_id: str,
    ) -> ExecutionRecord:
        execution_id = str(uuid4())
        with self._engine.begin() as connection:
            # Même verrou que ConnectionStore.bind/unbind : la liaison est figée dans la ligne.
            parent = connection.execute(
                select(logical_connections.c.name)
                .where(
                    logical_connections.c.space_id == binding.space_id,
                    logical_connections.c.name == binding.name,
                )
                .with_for_update()
            ).one_or_none()
            current = connection.execute(
                select(connection_bindings).where(
                    connection_bindings.c.space_id == binding.space_id,
                    connection_bindings.c.name == binding.name,
                    connection_bindings.c.environment == binding.environment.value,
                )
            ).one_or_none()
            if (
                parent is None
                or current is None
                or (
                    current.connector,
                    current.endpoint_key,
                    current.identity_mode,
                    current.set_at,
                )
                != (
                    binding.connector.value,
                    binding.endpoint_key,
                    binding.identity_mode.value,
                    binding.set_at,
                )
            ):
                raise ExecutionUnavailable() from None
            connection.execute(
                insert(executions).values(
                    id=execution_id,
                    space_id=binding.space_id,
                    environment=binding.environment.value,
                    issuer=reader.issuer,
                    subject=reader.subject,
                    connection_name=binding.name,
                    request_hash=request_hash,
                    connector=binding.connector.value,
                    endpoint_key=binding.endpoint_key,
                    identity_mode=binding.identity_mode.value,
                    binding_set_at=binding.set_at,
                    state=ExecutionState.QUEUED.value,
                    created_at=at,
                    deadline_at=deadline_at,
                    lease_until=lease_until,
                    owner_id=owner_id,
                    cancel_requested=False,
                )
            )
            row = connection.execute(
                select(executions).where(executions.c.id == execution_id)
            ).one()
        return _record(row)

    def get(
        self, space_id: str, execution_id: str, reader: PersonRef, *, manages: bool = False
    ) -> ExecutionRecord | None:
        query = select(executions).where(
            executions.c.space_id == space_id, executions.c.id == execution_id
        )
        if not manages:
            query = query.where(
                executions.c.issuer == reader.issuer, executions.c.subject == reader.subject
            )
        with self._engine.connect() as connection:
            row = connection.execute(query).one_or_none()
        return None if row is None else _record(row)

    def list(
        self, space_id: str, reader: PersonRef, *, manages: bool = False, limit: int = 50
    ) -> list[ExecutionRecord]:
        query = select(executions).where(executions.c.space_id == space_id)
        if not manages:
            query = query.where(
                executions.c.issuer == reader.issuer, executions.c.subject == reader.subject
            )
        query = query.order_by(executions.c.created_at.desc(), executions.c.id.desc()).limit(limit)
        with self._engine.connect() as connection:
            rows = connection.execute(query).all()
        return [_record(row) for row in rows]

    def result(self, space_id: str, execution_id: str, reader: PersonRef) -> bytes | None:
        with self._engine.connect() as connection:
            return connection.execute(
                select(executions.c.result).where(
                    executions.c.space_id == space_id,
                    executions.c.id == execution_id,
                    executions.c.issuer == reader.issuer,
                    executions.c.subject == reader.subject,
                    executions.c.state == ExecutionState.SUCCEEDED.value,
                )
            ).scalar_one_or_none()

    def start(self, execution_id: str, owner_id: str, at: datetime) -> bool:
        with self._engine.begin() as connection:
            changed = connection.execute(
                update(executions)
                .where(
                    executions.c.id == execution_id,
                    executions.c.owner_id == owner_id,
                    executions.c.state == ExecutionState.QUEUED.value,
                    executions.c.lease_until > at,
                )
                .values(state=ExecutionState.RUNNING.value, started_at=at)
            )
        return changed.rowcount == 1

    def note_statement(self, execution_id: str, owner_id: str, statement_id: str) -> bool:
        with self._engine.begin() as connection:
            changed = connection.execute(
                update(executions)
                .where(
                    executions.c.id == execution_id,
                    executions.c.owner_id == owner_id,
                    executions.c.state == ExecutionState.RUNNING.value,
                )
                .values(connector_run_id=statement_id)
            )
        return changed.rowcount == 1

    def cancellation_requested(self, execution_id: str, owner_id: str) -> bool:
        with self._engine.connect() as connection:
            return bool(
                connection.execute(
                    select(executions.c.cancel_requested).where(
                        executions.c.id == execution_id,
                        executions.c.owner_id == owner_id,
                        executions.c.state == ExecutionState.RUNNING.value,
                    )
                ).scalar_one_or_none()
            )

    def request_cancel(
        self,
        space_id: str,
        execution_id: str,
        reader: PersonRef,
        at: datetime,
        *,
        manages: bool = False,
    ) -> ExecutionRecord | None:
        with self._engine.begin() as connection:
            query = (
                select(executions)
                .where(executions.c.id == execution_id, executions.c.space_id == space_id)
                .with_for_update()
            )
            if not manages:
                query = query.where(
                    executions.c.issuer == reader.issuer, executions.c.subject == reader.subject
                )
            row = connection.execute(query).one_or_none()
            if row is None:
                return None
            if row.connector != Connector.DATABRICKS.value or row.state in {
                s.value for s in TERMINAL
            }:
                return _record(row)
            values: dict[str, Any] = {"cancel_requested": True}
            if row.state == ExecutionState.QUEUED.value:
                values.update(
                    state=ExecutionState.CANCELLED.value, finished_at=at, error_code="cancelled"
                )
            connection.execute(
                update(executions).where(executions.c.id == execution_id).values(**values)
            )
            updated = connection.execute(
                select(executions).where(executions.c.id == execution_id)
            ).one()
        return _record(updated)

    def finish(
        self,
        execution_id: str,
        owner_id: str,
        state: ExecutionState,
        at: datetime,
        *,
        error_code: str | None = None,
        evidence: dict[str, Any] | None = None,
        result: bytes | None = None,
        row_count: int | None = None,
        byte_count: int | None = None,
        truncated: bool | None = None,
    ) -> bool:
        if state not in TERMINAL or (state is ExecutionState.SUCCEEDED) != (
            evidence is not None
            and result is not None
            and row_count is not None
            and byte_count is not None
            and truncated is not None
        ):
            raise ValueError("Incoherent terminal execution state.")
        if state is ExecutionState.SUCCEEDED and error_code is not None:
            raise ValueError("Successful execution cannot have an error code.")
        if state is not ExecutionState.SUCCEEDED and result is not None:
            raise ValueError("Failed execution cannot retain result bytes.")
        if state is ExecutionState.SUCCEEDED and (
            not isinstance(evidence, dict)
            or not evidence.get("evidence_id")
            or not evidence.get("sql_hash")
            or evidence.get("execution_status") != "succeeded"
            or "sql_text" in evidence
        ):
            raise ValueError("Successful execution requires redacted provenance.")
        if evidence is not None and "sql_text" in evidence:
            raise ValueError("Execution provenance must not contain SQL.")
        if state is ExecutionState.SUCCEEDED and (
            type(result) is not bytes
            or type(row_count) is not int
            or not 0 <= row_count <= MAX_ROWS
            or type(byte_count) is not int
            or not 0 <= byte_count <= MAX_BYTES
            or len(result) != byte_count
            or type(truncated) is not bool
        ):
            raise ValueError("Execution result exceeds its contract.")
        with self._engine.begin() as connection:
            changed = connection.execute(
                update(executions)
                .where(
                    executions.c.id == execution_id,
                    executions.c.owner_id == owner_id,
                    executions.c.state == ExecutionState.RUNNING.value,
                )
                .values(
                    state=state.value,
                    finished_at=at,
                    error_code=error_code,
                    evidence=evidence,
                    result=result,
                    row_count=row_count,
                    byte_count=byte_count,
                    truncated=truncated,
                )
            )
        return changed.rowcount == 1

    def recover_stale(self, at: datetime) -> int:
        """Seuls les baux expirés échouent ; un autre serveur peut encore travailler."""
        with self._engine.begin() as connection:
            changed = connection.execute(
                update(executions)
                .where(
                    executions.c.state.in_(
                        (ExecutionState.QUEUED.value, ExecutionState.RUNNING.value)
                    ),
                    executions.c.lease_until <= at,
                )
                .values(
                    state=ExecutionState.FAILED.value,
                    finished_at=at,
                    error_code="server_restarted",
                )
            )
        return changed.rowcount
