"""Contrat Board → skifer : identité, RLS, preuve et exécution bornée."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import duckdb
import pytest
import yaml
from skifer.semantic.evidence import hash_sql
from skifer.semantic.semantic import SemanticEngine
from skifer_board.execution.connectors import DuckDbEndpoint, DuckDbExecution, RunStatus
from skifer_board.execution.model import Binding, Connector, IdentityMode
from skifer_board.execution.semantic import (
    SemanticOutput,
    SemanticRefusal,
    SemanticRequest,
    VerifiedReader,
    certification_store_from_path,
    run_semantic,
)
from skifer_board.identity.model import Identity
from skifer_board.spaces.model import Environment, PersonRef


class RecordingConnector:
    def __init__(self, path: Path, states: tuple[str, ...] = ("SUCCEEDED",)) -> None:
        self.path = path
        self.states = iter(states)
        self.sql: list[str] = []
        self.table = None

    def execute(self, sql: str) -> RunStatus:
        self.sql.append(sql)
        with duckdb.connect(str(self.path), read_only=True) as connection:
            self.table = connection.sql(sql).to_arrow_table()
        return RunStatus(next(self.states, "SUCCEEDED"), "statement-1")

    def status(self, statement_id: str) -> RunStatus:
        return RunStatus(next(self.states, "SUCCEEDED"), statement_id)

    def cancel(self, statement_id: str) -> None:
        raise AssertionError("not used")

    def result(self, statement_id: str) -> Any:
        return self.table


def test_certification_store_requires_existing_absolute_file(tmp_path: Path) -> None:
    assert certification_store_from_path(None) is None
    for path in (Path("relative.db"), tmp_path / "missing.db"):
        with pytest.raises(ValueError):
            certification_store_from_path(path)
    path = tmp_path / "certifications.db"
    path.touch()
    store = certification_store_from_path(path)
    assert store is not None
    store.close()


def _model(tmp_path: Path, *, row_policy: bool = True) -> Path:
    directory = tmp_path / "models"
    directory.mkdir()
    model: dict[str, Any] = {
        "key": "orders",
        "name": "orders",
        "table": "main.orders",
        "base_filter": "active = true OR region = 'South'",
        "dimensions": [{"name": "region", "sql": "region", "type": "string"}],
        "metrics": [{"name": "revenue", "sql": "amount", "type": "sum"}],
    }
    if row_policy:
        model["row_policy"] = {"column": "tenant", "attribute": "tenant"}
    (directory / "orders.yaml").write_text(yaml.safe_dump({"models": [model]}))
    (directory / "semantic_catalog.yaml").write_text(
        yaml.safe_dump(
            {
                "models": [
                    {
                        "key": "orders",
                        "file": "orders.yaml",
                        "metrics": ["revenue"],
                        "dimensions": ["region"],
                    }
                ]
            }
        )
    )
    return directory


def _database(tmp_path: Path) -> Path:
    path = tmp_path / "orders.duckdb"
    with duckdb.connect(str(path)) as connection:
        connection.execute(
            "CREATE TABLE orders (tenant VARCHAR, region VARCHAR, amount INTEGER, active BOOLEAN)"
        )
        connection.execute(
            "INSERT INTO orders VALUES ('A', 'North', 12, true), "
            "('A', 'South', 5, false), ('B', 'North', 100, true), ('B', 'South', 7, false)"
        )
    return path


def _binding(
    connector: Connector = Connector.DUCKDB, mode: IdentityMode = IdentityMode.SERVICE
) -> Binding:
    return Binding(
        "space",
        "source",
        Environment.DEV,
        connector,
        "endpoint",
        mode,
        datetime(2026, 1, 1, tzinfo=UTC),
        PersonRef("issuer", "actor"),
    )


def _reader(subject: str, tenant: str, *, admin: bool = False) -> VerifiedReader:
    return VerifiedReader(
        Identity("issuer", subject, None, None, ("platform-admin",) if admin else ()),
        {"tenant": tenant},
    )


def _run(
    request: SemanticRequest,
    reader: VerifiedReader,
    binding: Binding,
    connector: RecordingConnector | DuckDbExecution,
    models_dir: Path,
    **kwargs: Any,
) -> SemanticOutput:
    return run_semantic(
        request,
        reader,
        binding,
        connector,
        models_dir=models_dir,
        certification_mode="off",
        **kwargs,
    )


@pytest.mark.parametrize("dialect", [Connector.DUCKDB, Connector.DATABRICKS])
def test_rls_two_readers_admin_filter_removed_and_evidence(
    tmp_path: Path, dialect: Connector
) -> None:
    models = _model(tmp_path)
    path = _database(tmp_path)
    connector = RecordingConnector(path)
    binding = _binding(dialect)
    request = SemanticRequest("orders", ("revenue",), ("region",))
    alice = _run(request, _reader("alice", "A"), binding, connector, models)
    bob = _run(request, _reader("bob", "B"), binding, connector, models)
    admin = _run(request, _reader("admin", "A", admin=True), binding, connector, models)
    filtered = _run(
        SemanticRequest(
            "orders",
            ("revenue",),
            ("region",),
            ({"column": "region", "operator": "eq", "value": "North"},),
        ),
        _reader("alice", "A"),
        binding,
        connector,
        models,
    )
    assert sorted((row["region"], row["revenue"]) for row in alice.rows.to_pylist()) == [
        ("North", 12),
        ("South", 5),
    ]
    assert sorted((row["region"], row["revenue"]) for row in bob.rows.to_pylist()) == [
        ("North", 100),
        ("South", 7),
    ]
    assert sorted(admin.rows.to_pylist(), key=lambda row: row["region"]) == sorted(
        alice.rows.to_pylist(), key=lambda row: row["region"]
    )
    assert filtered.rows.to_pylist() == [{"region": "North", "revenue": 12}]
    assert alice.evidence["sql_dialect"] == dialect.value
    assert alice.evidence["sql_hash"] != bob.evidence["sql_hash"]
    assert alice.evidence["policy"]["decision"] == "ALLOW"
    assert alice.evidence["evidence_id"]
    assert any(
        item.get("origin") == "policy" and item.get("operator") == "eq"
        for item in alice.evidence["normalized_filters"]
    )
    assert "'A'" not in str(alice.evidence)
    assert len(connector.sql) == 4


def test_real_duckdb_connector_and_identity_change(tmp_path: Path) -> None:
    models = _model(tmp_path)
    path = _database(tmp_path)
    result = _run(
        SemanticRequest("orders", ("revenue",)),
        _reader("alice", "A"),
        _binding(),
        DuckDbExecution(DuckDbEndpoint(path)),
        models,
    )
    assert result.rows.to_pylist() == [{"revenue": 17}]
    assert result.evidence["statement_id"]


@pytest.mark.parametrize("mode,code", [("enforce", "deny"), ("supervised", "require_human")])
def test_certification_refuses_before_connector(tmp_path: Path, mode: str, code: str) -> None:
    models = _model(tmp_path)
    connector = RecordingConnector(_database(tmp_path))
    with pytest.raises(SemanticRefusal) as error:
        run_semantic(
            SemanticRequest("orders", ("revenue",)),
            _reader("alice", "A"),
            _binding(),
            connector,
            models_dir=models,
            certification_mode=mode,
        )
    assert error.value.code == code
    assert connector.sql == []


def test_missing_rls_and_person_mode_refuse_before_connector(tmp_path: Path) -> None:
    models = _model(tmp_path, row_policy=False)
    connector = RecordingConnector(_database(tmp_path))
    for binding in (_binding(), _binding(mode=IdentityMode.PERSON)):
        with pytest.raises(SemanticRefusal) as error:
            _run(
                SemanticRequest("orders", ("revenue",)),
                _reader("alice", "A"),
                binding,
                connector,
                models,
            )
        assert error.value.code == "engine_unavailable"
    assert connector.sql == []


def test_missing_verified_policy_attribute_refuses_before_connector(tmp_path: Path) -> None:
    models = _model(tmp_path)
    connector = RecordingConnector(_database(tmp_path))
    with pytest.raises(SemanticRefusal) as error:
        _run(
            SemanticRequest("orders", ("revenue",)),
            VerifiedReader(Identity("issuer", "alice", None, None, ())),
            _binding(),
            connector,
            models,
        )
    assert error.value.code == "deny"
    assert connector.sql == []


def test_databricks_waits_for_terminal_status(tmp_path: Path) -> None:
    models = _model(tmp_path)
    connector = RecordingConnector(_database(tmp_path), ("PENDING", "RUNNING", "SUCCEEDED"))
    result = _run(
        SemanticRequest("orders", ("revenue",)),
        _reader("alice", "A"),
        _binding(Connector.DATABRICKS),
        connector,
        models,
        clock=lambda: 0.0,
        pause=lambda _: None,
    )
    assert result.rows.to_pylist() == [{"revenue": 17}]


def test_databricks_failure_or_timeout_never_returns_rows(tmp_path: Path) -> None:
    models = _model(tmp_path)
    path = _database(tmp_path)
    for states, expected, clock in (
        (("FAILED",), "execution_failed", lambda: 0.0),
        (("PENDING",), "execution_timed_out", iter((0.0, 0.0, 31.0)).__next__),
    ):
        with pytest.raises(SemanticRefusal) as error:
            _run(
                SemanticRequest("orders", ("revenue",)),
                _reader("alice", "A"),
                _binding(Connector.DATABRICKS),
                RecordingConnector(path, states),
                models,
                clock=clock,
                pause=lambda _: None,
            )
        assert error.value.code == expected


def test_statement_is_reported_and_cancelled_only_after_source_confirms(tmp_path: Path) -> None:
    class Cancellable(RecordingConnector):
        cancelled = False

        def cancel(self, statement_id: str) -> None:
            self.cancelled = True

    models = _model(tmp_path)
    connector = Cancellable(_database(tmp_path), ("PENDING", "RUNNING", "CANCELED"))
    seen: list[str] = []

    def note(statement_id: str) -> bool:
        seen.append(statement_id)
        return True

    with pytest.raises(SemanticRefusal, match="cancelled"):
        _run(
            SemanticRequest("orders", ("revenue",)),
            _reader("alice", "A"),
            _binding(Connector.DATABRICKS),
            connector,
            models,
            clock=lambda: 0.0,
            pause=lambda _: None,
            on_statement=note,
            cancel_requested=lambda: len(seen) > 0,
        )
    assert seen == ["statement-1"] and connector.cancelled


def test_cancel_before_submission_and_lost_owner_do_not_return_rows(tmp_path: Path) -> None:
    models = _model(tmp_path)
    connector = RecordingConnector(_database(tmp_path))
    with pytest.raises(SemanticRefusal, match="cancelled"):
        _run(
            SemanticRequest("orders", ("revenue",)),
            _reader("alice", "A"),
            _binding(),
            connector,
            models,
            cancel_requested=lambda: True,
        )
    assert connector.sql == []
    with pytest.raises(SemanticRefusal, match="execution_lost"):
        _run(
            SemanticRequest("orders", ("revenue",)),
            _reader("alice", "A"),
            _binding(),
            connector,
            models,
            on_statement=lambda _: False,
        )
    assert len(connector.sql) == 1


@pytest.mark.parametrize("slow_phase", ["execute", "result"])
def test_deadline_applies_to_synchronous_work(tmp_path: Path, slow_phase: str) -> None:
    models = _model(tmp_path)
    connector = RecordingConnector(_database(tmp_path))
    ticks = iter((0.0, 31.0) if slow_phase == "execute" else (0.0, 0.0, 31.0))
    with pytest.raises(SemanticRefusal, match="execution_timed_out"):
        _run(
            SemanticRequest("orders", ("revenue",)),
            _reader("alice", "A"),
            _binding(),
            connector,
            models,
            clock=ticks.__next__,
        )


@pytest.mark.parametrize(
    "catalog,document",
    [
        ({"models": []}, None),
        ({"models": [{"file": "../orders.yaml"}]}, None),
        ({"models": [{"file": "orders.yaml"}]}, {"models": []}),
        ({"models": [{"file": "missing.yaml"}]}, None),
        ({"wrong": []}, None),
    ],
)
def test_incomplete_catalog_never_calls_connector(
    tmp_path: Path, catalog: dict[str, Any], document: dict[str, Any] | None
) -> None:
    models = _model(tmp_path)
    (models / "semantic_catalog.yaml").write_text(yaml.safe_dump(catalog))
    if document is not None:
        (models / "orders.yaml").write_text(yaml.safe_dump(document))
    connector = RecordingConnector(_database(tmp_path))
    with pytest.raises(SemanticRefusal, match="engine_unavailable"):
        _run(
            SemanticRequest("orders", ("revenue",)),
            _reader("alice", "A"),
            _binding(),
            connector,
            models,
        )
    assert connector.sql == []


def test_invalid_binding_or_request_refuses_before_connector(tmp_path: Path) -> None:
    models = _model(tmp_path)
    connector = RecordingConnector(_database(tmp_path))
    request = SemanticRequest("orders", ("revenue",))
    reader = _reader("alice", "A")
    for binding, mode, timeout in (
        (_binding(mode=IdentityMode.PERSON), "off", 30.0),
        (_binding(Connector.DUCKDB), "unsupported", 30.0),
        (_binding(Connector.DUCKDB), "off", 0.0),
    ):
        with pytest.raises(SemanticRefusal, match="engine_unavailable"):
            run_semantic(
                request,
                reader,
                binding,
                connector,
                models_dir=models,
                certification_mode=mode,
                timeout_seconds=timeout,
            )
    with pytest.raises(SemanticRefusal, match="engine_unavailable"):
        _run(SemanticRequest("missing", ("revenue",)), reader, _binding(), connector, models)
    assert connector.sql == []


def test_status_identity_mismatch_is_refused(tmp_path: Path) -> None:
    class WrongStatus(RecordingConnector):
        def status(self, statement_id: str) -> RunStatus:
            return RunStatus("SUCCEEDED", "another-statement")

    models = _model(tmp_path)
    connector = WrongStatus(_database(tmp_path), ("PENDING",))
    with pytest.raises(SemanticRefusal, match="invalid_upstream"):
        _run(
            SemanticRequest("orders", ("revenue",)),
            _reader("alice", "A"),
            _binding(),
            connector,
            models,
            clock=lambda: 0.0,
            pause=lambda _: None,
        )


def test_connector_failure_retains_closed_source_code(tmp_path: Path) -> None:
    models = _model(tmp_path)
    connector = DuckDbExecution(DuckDbEndpoint(tmp_path / "missing.duckdb"))
    with pytest.raises(SemanticRefusal, match="connector_unavailable"):
        _run(
            SemanticRequest("orders", ("revenue",)),
            _reader("alice", "A"),
            _binding(),
            connector,
            models,
        )


@pytest.mark.parametrize(
    "field,value",
    [
        ("sql_hash", "other"),
        ("sql_dialect", "other"),
        ("execution_status", "pending"),
        ("policy", {"decision": "DENY"}),
        ("evidence_id", ""),
        ("sources", []),
        ("model_keys", []),
        ("normalized_filters", []),
    ],
)
def test_incoherent_evidence_is_never_a_success(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, field: str, value: Any
) -> None:
    models = _model(tmp_path)
    connector = RecordingConnector(_database(tmp_path))

    class CorruptRuntime:
        def __init__(self, backend: Any) -> None:
            self.backend = backend

        def query_with_evidence(self, query: Any, *, consumer_context: Any) -> Any:
            self.backend.execute_sql_with_metadata("SELECT 1")
            payload = {
                "sql_hash": hash_sql("SELECT 1"),
                "sql_dialect": "duckdb",
                "execution_status": "succeeded",
                "policy": {"decision": "ALLOW"},
                "evidence_id": "evidence-1",
                "sources": ["orders"],
                "model_keys": ["orders"],
                "normalized_filters": [
                    {
                        "model_key": "orders",
                        "origin": "policy",
                        "operator": "eq",
                        "value": "<redacted>",
                    }
                ],
            }
            payload[field] = value
            return SimpleNamespace(
                dataframe=connector.table,
                evidence=SimpleNamespace(to_dict=lambda: payload),
            )

    monkeypatch.setattr(
        SemanticEngine, "from_backend", lambda backend, **kwargs: CorruptRuntime(backend)
    )
    with pytest.raises(SemanticRefusal, match="evidence_invalid"):
        _run(
            SemanticRequest("orders", ("revenue",)),
            _reader("alice", "A"),
            _binding(),
            connector,
            models,
        )
