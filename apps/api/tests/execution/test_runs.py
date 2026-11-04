"""État durable des exécutions : isolation, transitions et baux (plan 12.5a)."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from identity.conftest import cles as cles
from identity.conftest import config as config
from identity.conftest import fournisseur as fournisseur
from identity.conftest import horloge as horloge
from skifer_board.execution.model import Connector, IdentityMode
from skifer_board.execution.runs import (
    ExecutionRecord,
    ExecutionState,
    ExecutionStore,
    ExecutionUnavailable,
)
from skifer_board.execution.store import ConnectionInUse, ConnectionStore
from skifer_board.spaces.model import Environment, PersonRef
from spaces.monde import A, B, Monde
from spaces.monde import config_plateforme as config_plateforme
from spaces.monde import monde as monde
from state.conftest import migre as migre

NOW = datetime(2026, 11, 3, 20, tzinfo=UTC)
OWNER = "11111111-1111-1111-1111-111111111111"
ALICE = PersonRef("issuer", "alice")
BOB = PersonRef("issuer", "bob")
EVIDENCE = {"evidence_id": "ev", "sql_hash": "sha256:n1:abc", "execution_status": "succeeded"}


def _stores(
    monde: Monde, *, connector: Connector = Connector.DATABRICKS
) -> tuple[ConnectionStore, ExecutionStore]:
    connections = ConnectionStore(monde.moteur)
    connections.create(A, "source", ALICE, NOW)
    connections.bind(
        A, "source", Environment.DEV, connector, "endpoint", IdentityMode.SERVICE, ALICE, NOW
    )
    return connections, ExecutionStore(monde.moteur)


def _create(
    connections: ConnectionStore, store: ExecutionStore, reader: PersonRef = ALICE
) -> ExecutionRecord:
    binding = connections.get_binding(A, "source", Environment.DEV)
    return store.create(
        binding,
        reader,
        "sha256:request",
        NOW,
        NOW + timedelta(seconds=30),
        NOW + timedelta(seconds=40),
        OWNER,
    )


def test_creation_isolation_result_and_complete(monde: Monde) -> None:
    connections, store = _stores(monde)
    run = _create(connections, store)
    assert run.state is ExecutionState.QUEUED
    assert run.reader == ALICE and run.connection_name == "source"
    assert run.created_at == NOW and run.binding_set_at == NOW
    assert run.evidence is None and run.row_count is None
    assert store.get(A, run.id, ALICE) == run
    assert store.get(A, run.id, BOB) is None
    assert store.get(B, run.id, ALICE, manages=True) is None
    assert store.get(A, run.id, BOB, manages=True) == run
    assert store.list(A, ALICE) == [run]
    assert store.list(A, BOB) == []
    assert store.list(A, BOB, manages=True, limit=1) == [run]
    assert store.result(A, run.id, ALICE) is None
    assert not store.start(run.id, "wrong-owner", NOW)
    assert store.start(run.id, OWNER, NOW)
    assert not store.start(run.id, OWNER, NOW)
    assert not store.note_statement(run.id, "wrong-owner", "stmt")
    assert store.note_statement(run.id, OWNER, "stmt")
    assert not store.cancellation_requested(run.id, OWNER)
    assert store.finish(
        run.id,
        OWNER,
        ExecutionState.SUCCEEDED,
        NOW + timedelta(seconds=2),
        evidence=EVIDENCE,
        result=b"arrow",
        row_count=1,
        byte_count=5,
        truncated=False,
    )
    done = store.get(A, run.id, ALICE)
    assert done is not None
    assert done.state is ExecutionState.SUCCEEDED
    assert done.started_at == NOW and done.finished_at == NOW + timedelta(seconds=2)
    assert done.connector_run_id == "stmt" and done.evidence == EVIDENCE
    assert done.row_count == 1 and done.byte_count == 5 and done.truncated is False
    assert store.result(A, run.id, ALICE) == b"arrow"
    assert store.result(A, run.id, BOB) is None
    assert store.result(B, run.id, ALICE) is None
    assert not store.finish(run.id, OWNER, ExecutionState.FAILED, NOW, error_code="late")
    assert not store.note_statement(run.id, OWNER, "late")


def test_stale_binding_is_refused_and_active_binding_cannot_be_changed(monde: Monde) -> None:
    connections, store = _stores(monde)
    binding = connections.get_binding(A, "source", Environment.DEV)
    with pytest.raises(ExecutionUnavailable):
        store.create(replace(binding, endpoint_key="other"), ALICE, "hash", NOW, NOW, NOW, OWNER)
    run = _create(connections, store)
    # L'écriture identique est idempotente ; changer ou retirer attend la fin.
    assert (
        connections.bind(
            A,
            "source",
            Environment.DEV,
            Connector.DATABRICKS,
            "endpoint",
            IdentityMode.SERVICE,
            ALICE,
            NOW,
        )
        == binding
    )
    with pytest.raises(ConnectionInUse):
        connections.bind(
            A,
            "source",
            Environment.DEV,
            Connector.DATABRICKS,
            "changed",
            IdentityMode.SERVICE,
            ALICE,
            NOW,
        )
    with pytest.raises(ConnectionInUse):
        connections.unbind(A, "source", Environment.DEV, ALICE, NOW)
    assert store.start(run.id, OWNER, NOW)
    assert store.finish(run.id, OWNER, ExecutionState.DENIED, NOW, error_code="deny")
    connections.unbind(A, "source", Environment.DEV, ALICE, NOW)


def test_cancellation_queued_running_and_terminal(monde: Monde) -> None:
    connections, store = _stores(monde)
    first = _create(connections, store)
    assert store.request_cancel(A, first.id, BOB, NOW) is None
    assert store.request_cancel(B, first.id, ALICE, NOW, manages=True) is None
    cancelled = store.request_cancel(A, first.id, ALICE, NOW)
    assert cancelled is not None and cancelled.state is ExecutionState.CANCELLED
    assert cancelled.cancel_requested and cancelled.error_code == "cancelled"
    assert not store.start(first.id, OWNER, NOW)
    assert store.request_cancel(A, first.id, ALICE, NOW) == cancelled

    second = _create(connections, store, BOB)
    assert store.start(second.id, OWNER, NOW)
    requested = store.request_cancel(A, second.id, ALICE, NOW, manages=True)
    assert requested is not None and requested.state is ExecutionState.RUNNING
    assert requested.cancel_requested and store.cancellation_requested(second.id, OWNER)
    assert store.finish(second.id, OWNER, ExecutionState.CANCELLED, NOW, error_code="cancelled")
    assert store.request_cancel(A, second.id, ALICE, NOW, manages=True) is not None


def test_duckdb_is_not_cancellable(monde: Monde) -> None:
    connections, store = _stores(monde, connector=Connector.DUCKDB)
    run = _create(connections, store)
    unchanged = store.request_cancel(A, run.id, ALICE, NOW)
    assert unchanged == run
    assert store.start(run.id, OWNER, NOW)


def test_recovery_does_not_touch_another_server_live_lease(monde: Monde) -> None:
    connections, first_server = _stores(monde)
    second_server = ExecutionStore(monde.moteur)
    run = _create(connections, first_server)
    assert first_server.start(run.id, OWNER, NOW)
    assert second_server.recover_stale(NOW + timedelta(seconds=39)) == 0
    assert second_server.get(A, run.id, ALICE).state is ExecutionState.RUNNING  # type: ignore[union-attr]
    assert second_server.recover_stale(NOW + timedelta(seconds=40)) == 1
    recovered = second_server.get(A, run.id, ALICE)
    assert recovered is not None and recovered.state is ExecutionState.FAILED
    assert recovered.error_code == "server_restarted"
    assert not first_server.finish(
        run.id,
        OWNER,
        ExecutionState.SUCCEEDED,
        NOW,
        evidence=EVIDENCE,
        result=b"x",
        row_count=1,
        byte_count=1,
        truncated=False,
    )
    assert second_server.recover_stale(NOW + timedelta(seconds=41)) == 0


def test_expired_queued_job_cannot_start(monde: Monde) -> None:
    connections, store = _stores(monde)
    run = _create(connections, store)
    assert not store.start(run.id, OWNER, NOW + timedelta(seconds=40))
    assert store.recover_stale(NOW + timedelta(seconds=40)) == 1


def test_terminal_payload_must_be_coherent(monde: Monde) -> None:
    connections, store = _stores(monde)
    run = _create(connections, store)
    assert store.start(run.id, OWNER, NOW)
    for state, fields in (
        (ExecutionState.RUNNING, {}),
        (ExecutionState.SUCCEEDED, {}),
        (ExecutionState.FAILED, {"result": b"x"}),
        (
            ExecutionState.SUCCEEDED,
            {
                "evidence": {},
                "result": b"x",
                "row_count": 1,
                "byte_count": 1,
                "truncated": False,
                "error_code": "bad",
            },
        ),
        (
            ExecutionState.SUCCEEDED,
            {"evidence": {}, "result": b"x", "row_count": 1, "byte_count": 1, "truncated": False},
        ),
        (
            ExecutionState.SUCCEEDED,
            {
                "evidence": {**EVIDENCE, "sql_text": "secret"},
                "result": b"x",
                "row_count": 1,
                "byte_count": 1,
                "truncated": False,
            },
        ),
        (
            ExecutionState.FAILED,
            {"evidence": {"sql_text": "secret"}},
        ),
        (
            ExecutionState.SUCCEEDED,
            {
                "evidence": EVIDENCE,
                "result": b"x",
                "row_count": 1001,
                "byte_count": 1,
                "truncated": False,
            },
        ),
        (
            ExecutionState.SUCCEEDED,
            {
                "evidence": EVIDENCE,
                "result": b"x",
                "row_count": 1,
                "byte_count": 2,
                "truncated": False,
            },
        ),
    ):
        with pytest.raises(ValueError):
            store.finish(run.id, OWNER, state, NOW, **fields)
    assert store.finish(
        run.id, OWNER, ExecutionState.FAILED, NOW, error_code="connector_unavailable"
    )
    assert store.result(A, run.id, ALICE) is None


def test_cancel_finish_race_has_one_terminal_outcome(monde: Monde) -> None:
    connections, store = _stores(monde)
    run = _create(connections, store)
    assert store.start(run.id, OWNER, NOW)
    with ThreadPoolExecutor(max_workers=2) as pool:
        cancel = pool.submit(store.request_cancel, A, run.id, ALICE, NOW)
        finish = pool.submit(
            store.finish,
            run.id,
            OWNER,
            ExecutionState.SUCCEEDED,
            NOW,
            evidence=EVIDENCE,
            result=b"x",
            row_count=1,
            byte_count=1,
            truncated=False,
        )
        cancel.result()
        assert finish.result()
    final = store.get(A, run.id, ALICE)
    assert final is not None and final.state is ExecutionState.SUCCEEDED
