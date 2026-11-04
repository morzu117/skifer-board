"""File bornée des lectures sémantiques et arbitrage des états terminaux (12.5b)."""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .connectors import ExecutionConnector
from .model import Binding
from .results import ResultContractError, arrow_preview
from .runs import ExecutionRecord, ExecutionState, ExecutionStore
from .semantic import SemanticRefusal, SemanticRequest, VerifiedReader, run_semantic


class ExecutionBusy(Exception):
    """La file locale est pleine ; rien n'est soumis au connecteur."""


MeasureFinish = Callable[
    [ExecutionRecord, ExecutionState, str | None, float, int | None, int | None], None
]


class ExecutionWorkerPool:
    def __init__(
        self,
        store: ExecutionStore,
        models_dir: Path,
        *,
        certification_store: Any = None,
        certification_mode: str = "enforce",
        workers: int = 4,
        capacity: int = 16,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        timer: Callable[[], float] = time.monotonic,
        on_finish: MeasureFinish | None = None,
    ) -> None:
        if workers < 1 or capacity < workers:
            raise ValueError("Invalid execution worker capacity.")
        self.store = store
        self.models_dir = models_dir
        self.certification_store = certification_store
        self.certification_mode = certification_mode
        self.clock = clock
        self.timer = timer
        self.on_finish = on_finish
        self._slots = threading.BoundedSemaphore(capacity)
        self._executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="semantic")
        self._closed = False
        self.store.recover_stale(self.clock())

    def submit(
        self,
        create: Callable[[], ExecutionRecord],
        request: SemanticRequest,
        reader: VerifiedReader,
        binding: Binding,
        connector: ExecutionConnector,
    ) -> ExecutionRecord:
        if self._closed or not self._slots.acquire(blocking=False):
            raise ExecutionBusy()
        try:
            record = create()
        except Exception:
            self._slots.release()
            raise
        try:
            self._executor.submit(self._run, record, request, reader, binding, connector)
        except RuntimeError:
            self.store.fail_queued(record.id, record.owner_id, self.clock())
            self._slots.release()
            raise ExecutionBusy() from None
        return record

    def _run(
        self,
        record: ExecutionRecord,
        request: SemanticRequest,
        reader: VerifiedReader,
        binding: Binding,
        connector: ExecutionConnector,
    ) -> None:
        started = self.timer()
        at = self.clock()
        try:
            if not self.store.start(record.id, record.owner_id, at):
                return
            state = ExecutionState.FAILED
            code: str | None = "execution_failed"
            rows: int | None = None
            size: int | None = None
            try:
                remaining = (record.deadline_at - at).total_seconds()
                if remaining <= 0:
                    raise SemanticRefusal("execution_timed_out")
                output = run_semantic(
                    request,
                    reader,
                    binding,
                    connector,
                    models_dir=self.models_dir,
                    certification_store=self.certification_store,
                    certification_mode=self.certification_mode,
                    timeout_seconds=remaining,
                    on_statement=lambda statement_id: self.store.note_statement(
                        record.id, record.owner_id, statement_id
                    ),
                    cancel_requested=lambda: self.store.cancellation_requested(
                        record.id, record.owner_id
                    ),
                )
                preview = arrow_preview(
                    output.rows, source_truncated=bool(getattr(connector, "truncated", False))
                )
                state, code = ExecutionState.SUCCEEDED, None
                rows, size = preview.rows, preview.size
                changed = self.store.finish(
                    record.id,
                    record.owner_id,
                    state,
                    self.clock(),
                    evidence=output.evidence,
                    result=preview.data,
                    row_count=preview.rows,
                    byte_count=preview.size,
                    truncated=preview.truncated,
                )
            except SemanticRefusal as error:
                code = error.code
                state = {
                    "deny": ExecutionState.DENIED,
                    "require_human": ExecutionState.DENIED,
                    "cancelled": ExecutionState.CANCELLED,
                    "execution_timed_out": ExecutionState.TIMED_OUT,
                }.get(code, ExecutionState.FAILED)
                changed = self.store.finish(
                    record.id, record.owner_id, state, self.clock(), error_code=code
                )
            except ResultContractError:
                code = "invalid_upstream"
                changed = self.store.finish(
                    record.id, record.owner_id, state, self.clock(), error_code=code
                )
            except Exception:
                code = "connector_unavailable"
                changed = self.store.finish(
                    record.id, record.owner_id, state, self.clock(), error_code=code
                )
            if changed and self.on_finish is not None:
                try:
                    self.on_finish(
                        record, state, code, max(0.0, self.timer() - started), rows, size
                    )
                except Exception:
                    # Une panne de mesure ne change jamais l'état de l'exécution.
                    pass
        finally:
            self._slots.release()

    def close(self) -> None:
        self._closed = True
        self._executor.shutdown(wait=True, cancel_futures=False)
