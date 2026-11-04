"""Travail de fond borné et résultat réellement suivi en base (plan 12.5b)."""

from __future__ import annotations

import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import duckdb
import pyarrow as pa
import pytest
import yaml
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from identity.conftest import cles as cles
from identity.conftest import config as config
from identity.conftest import fournisseur as fournisseur
from identity.conftest import horloge as horloge
from skifer_board.execution.connectors import DuckDbEndpoint, DuckDbExecution, RunStatus
from skifer_board.execution.model import Binding, Connector, IdentityMode
from skifer_board.execution.runs import ExecutionRecord, ExecutionState, ExecutionStore
from skifer_board.execution.semantic import SemanticRequest, VerifiedReader
from skifer_board.execution.store import ConnectionStore
from skifer_board.execution.worker import ExecutionBusy, ExecutionWorkerPool
from skifer_board.identity.model import Identity
from skifer_board.spaces.model import Environment, PersonRef
from spaces.monde import A, Monde
from spaces.monde import config_plateforme as config_plateforme
from spaces.monde import monde as monde
from state.conftest import migre as migre

NOW = datetime(2026, 11, 4, 1, tzinfo=UTC)
OWNER = "11111111-1111-1111-1111-111111111111"
ACTOR = PersonRef("issuer", "alice")
READER = VerifiedReader(Identity("issuer", "alice", None, None, ()), {"tenant": "A"})
REQUEST = SemanticRequest("orders", ("revenue",))


def _models(tmp_path: Path) -> Path:
    directory = tmp_path / "models"
    directory.mkdir()
    (directory / "orders.yaml").write_text(
        yaml.safe_dump(
            {
                "models": [
                    {
                        "key": "orders",
                        "name": "orders",
                        "table": "main.orders",
                        "row_policy": {"column": "tenant", "attribute": "tenant"},
                        "metrics": [{"name": "revenue", "sql": "amount", "type": "sum"}],
                    }
                ]
            }
        )
    )
    (directory / "semantic_catalog.yaml").write_text(
        yaml.safe_dump(
            {
                "models": [
                    {
                        "key": "orders",
                        "file": "orders.yaml",
                        "metrics": ["revenue"],
                        "dimensions": [],
                    }
                ]
            }
        )
    )
    return directory


def _database(tmp_path: Path) -> Path:
    path = tmp_path / "orders.duckdb"
    with duckdb.connect(str(path)) as connection:
        connection.execute("CREATE TABLE orders (tenant VARCHAR, amount INTEGER)")
        connection.execute("INSERT INTO orders VALUES ('A', 12), ('B', 100)")
    return path


def _stores(monde: Monde, connector: Connector) -> tuple[ExecutionStore, Binding]:
    registry = ConnectionStore(monde.moteur)
    registry.create(A, "source", ACTOR, NOW)
    binding = registry.bind(
        A, "source", Environment.DEV, connector, "endpoint", IdentityMode.SERVICE, ACTOR, NOW
    )
    return ExecutionStore(monde.moteur), binding


def _create(store: ExecutionStore, binding: Binding) -> ExecutionRecord:
    return store.create(
        binding,
        ACTOR,
        "sha256:request",
        NOW,
        NOW + timedelta(seconds=30),
        NOW + timedelta(seconds=40),
        OWNER,
    )


class SimulatedConnector:
    def __init__(self, result: Any = None) -> None:
        self.started = threading.Event()
        self.cancelled = False
        self.sql: list[str] = []
        self._result = pa.table({"revenue": [12]}) if result is None else result

    def execute(self, sql: str) -> RunStatus:
        self.sql.append(sql)
        self.started.set()
        return RunStatus("PENDING", "12345678-1234-1234-1234-123456789abc")

    def status(self, statement_id: str) -> RunStatus:
        return RunStatus("CANCELED" if self.cancelled else "SUCCEEDED", statement_id)

    def cancel(self, statement_id: str) -> None:
        self.cancelled = True

    def result(self, statement_id: str) -> Any:
        return self._result


def test_real_duckdb_job_finishes_with_arrow_and_proof(monde: Monde, tmp_path: Path) -> None:
    store, binding = _stores(monde, Connector.DUCKDB)
    measurements: list[tuple[Any, ...]] = []
    pool = ExecutionWorkerPool(
        store,
        _models(tmp_path),
        certification_mode="off",
        clock=lambda: NOW,
        on_finish=lambda *items: measurements.append(items),
    )
    record = pool.submit(
        lambda: _create(store, binding),
        REQUEST,
        READER,
        binding,
        DuckDbExecution(DuckDbEndpoint(_database(tmp_path))),
    )
    pool.close()
    done = store.get(A, record.id, ACTOR)
    assert done is not None and done.state is ExecutionState.SUCCEEDED
    assert done.evidence is not None and done.evidence["sql_hash"]
    assert done.row_count == 1 and done.byte_count is not None and done.byte_count > 0
    assert done.truncated is False and done.connector_run_id
    data = store.result(A, record.id, ACTOR)
    assert data is not None
    assert pa.ipc.open_stream(data).read_all().to_pylist() == [{"revenue": 12}]
    assert len(measurements) == 1 and measurements[0][1] is ExecutionState.SUCCEEDED
    with pytest.raises(ExecutionBusy):
        pool.submit(lambda: _create(store, binding), REQUEST, READER, binding, SimulatedConnector())


def test_certification_denial_stops_before_connector(monde: Monde, tmp_path: Path) -> None:
    store, binding = _stores(monde, Connector.DATABRICKS)
    connector = SimulatedConnector()
    pool = ExecutionWorkerPool(store, _models(tmp_path), clock=lambda: NOW)
    record = pool.submit(lambda: _create(store, binding), REQUEST, READER, binding, connector)
    pool.close()
    done = store.get(A, record.id, ACTOR)
    assert done is not None and done.state is ExecutionState.DENIED and done.error_code == "deny"
    assert connector.sql == [] and store.result(A, record.id, ACTOR) is None


def test_cancel_ack_requires_terminal_source_state(monde: Monde, tmp_path: Path) -> None:
    class WaitingForCancellation(SimulatedConnector):
        release = threading.Event()

        def status(self, statement_id: str) -> RunStatus:
            assert self.release.wait(5)
            return (
                super().status(statement_id)
                if self.cancelled
                else RunStatus("PENDING", statement_id)
            )

    store, binding = _stores(monde, Connector.DATABRICKS)
    connector = WaitingForCancellation()
    pool = ExecutionWorkerPool(
        store, _models(tmp_path), certification_mode="off", clock=lambda: NOW
    )
    record = pool.submit(lambda: _create(store, binding), REQUEST, READER, binding, connector)
    assert connector.started.wait(5)
    requested = store.request_cancel(A, record.id, ACTOR, NOW)
    assert requested is not None and requested.state is ExecutionState.RUNNING
    connector.release.set()
    pool.close()
    done = store.get(A, record.id, ACTOR)
    assert done is not None and done.state is ExecutionState.CANCELLED
    assert done.error_code == "cancelled" and connector.cancelled


def test_invalid_source_result_fails_without_result(monde: Monde, tmp_path: Path) -> None:
    store, binding = _stores(monde, Connector.DATABRICKS)
    pool = ExecutionWorkerPool(
        store, _models(tmp_path), certification_mode="off", clock=lambda: NOW
    )
    record = pool.submit(
        lambda: _create(store, binding), REQUEST, READER, binding, SimulatedConnector({})
    )
    pool.close()
    done = store.get(A, record.id, ACTOR)
    assert done is not None and done.state is ExecutionState.FAILED
    assert done.error_code == "invalid_upstream" and store.result(A, record.id, ACTOR) is None


def test_expired_before_start_is_timed_out(monde: Monde, tmp_path: Path) -> None:
    store, binding = _stores(monde, Connector.DUCKDB)
    pool = ExecutionWorkerPool(
        store,
        _models(tmp_path),
        certification_mode="off",
        clock=lambda: NOW + timedelta(seconds=31),
    )
    record = pool.submit(
        lambda: _create(store, binding), REQUEST, READER, binding, SimulatedConnector()
    )
    pool.close()
    done = store.get(A, record.id, ACTOR)
    assert done is not None and done.state is ExecutionState.TIMED_OUT
    assert done.error_code == "execution_timed_out"


def test_pool_capacity_rejects_without_creating_record(monde: Monde, tmp_path: Path) -> None:
    class Waiting(SimulatedConnector):
        release = threading.Event()

        def execute(self, sql: str) -> RunStatus:
            self.started.set()
            assert self.release.wait(5)
            return super().execute(sql)

    store, binding = _stores(monde, Connector.DATABRICKS)
    connector = Waiting()
    pool = ExecutionWorkerPool(
        store,
        _models(tmp_path),
        certification_mode="off",
        clock=lambda: NOW,
        workers=1,
        capacity=1,
    )
    try:
        pool.submit(lambda: _create(store, binding), REQUEST, READER, binding, connector)
        assert connector.started.wait(5)
        with pytest.raises(ExecutionBusy):
            pool.submit(
                lambda: pytest.fail("no second record"),
                REQUEST,
                READER,
                binding,
                SimulatedConnector(),
            )
    finally:
        connector.release.set()
        pool.close()
    assert len(store.list(A, ACTOR)) == 1


def test_failed_dispatch_and_measure_do_not_fake_success(
    monde: Monde, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store, binding = _stores(monde, Connector.DUCKDB)
    with pytest.raises(ValueError):
        ExecutionWorkerPool(store, _models(tmp_path), workers=0)
    pool = ExecutionWorkerPool(store, tmp_path / "models", clock=lambda: NOW)
    with pytest.raises(RuntimeError):
        pool.submit(
            lambda: (_ for _ in ()).throw(RuntimeError()),
            REQUEST,
            READER,
            binding,
            SimulatedConnector(),
        )
    monkeypatch.setattr(
        pool._executor, "submit", lambda *args: (_ for _ in ()).throw(RuntimeError())
    )
    with pytest.raises(ExecutionBusy):
        pool.submit(lambda: _create(store, binding), REQUEST, READER, binding, SimulatedConnector())
    pool.close()
    assert store.list(A, ACTOR)[0].error_code == "worker_unavailable"


def test_measure_failure_does_not_change_success(monde: Monde, tmp_path: Path) -> None:
    store, binding = _stores(monde, Connector.DUCKDB)

    def fail_measure(*items: Any) -> None:
        raise RuntimeError("telemetry down")

    pool = ExecutionWorkerPool(
        store,
        _models(tmp_path),
        certification_mode="off",
        clock=lambda: NOW,
        on_finish=fail_measure,
    )
    record = pool.submit(
        lambda: _create(store, binding),
        REQUEST,
        READER,
        binding,
        DuckDbExecution(DuckDbEndpoint(_database(tmp_path))),
    )
    pool.close()
    done = store.get(A, record.id, ACTOR)
    assert done is not None and done.state is ExecutionState.SUCCEEDED


def test_cancelled_queue_is_not_started(
    monde: Monde, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store, binding = _stores(monde, Connector.DATABRICKS)
    monkeypatch.setattr(store, "start", lambda *args: False)
    connector = SimulatedConnector()
    pool = ExecutionWorkerPool(
        store, _models(tmp_path), certification_mode="off", clock=lambda: NOW
    )
    record = pool.submit(lambda: _create(store, binding), REQUEST, READER, binding, connector)
    pool.close()
    assert connector.sql == []
    queued = store.get(A, record.id, ACTOR)
    assert queued is not None and queued.state is ExecutionState.QUEUED


def test_unexpected_connector_failure_is_closed(
    monde: Monde, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import skifer_board.execution.worker as worker

    def broken(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("source detail must stay private")

    monkeypatch.setattr(worker, "run_semantic", broken)
    store, binding = _stores(monde, Connector.DUCKDB)
    pool = ExecutionWorkerPool(
        store, _models(tmp_path), certification_mode="off", clock=lambda: NOW
    )
    record = pool.submit(
        lambda: _create(store, binding), REQUEST, READER, binding, SimulatedConnector()
    )
    pool.close()
    done = store.get(A, record.id, ACTOR)
    assert done is not None and done.state is ExecutionState.FAILED
    assert done.error_code == "connector_unavailable"
