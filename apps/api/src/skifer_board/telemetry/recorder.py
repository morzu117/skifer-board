"""Enregistreur de télémétrie (plan 11, T4 à T6).

Chaque mesure part en ligne JSON sur le journal `skifer_board.telemetry`, puis, s'il y a une
base, dans une file bornée vidée par lots par un fil d'écriture. Une requête n'attend jamais
la base : file pleine ou base indisponible, la mesure est perdue et la perte est journalisée,
au plus une fois par minute. Le même fil purge les mesures de plus de 90 jours, au plus une
fois par heure.
"""

from __future__ import annotations

import json
import logging
import queue
import sys
import threading
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from .model import RETENTION, Measure
from .store import TelemetryStore

LOGGER = "skifer_board.telemetry"
CAPACITY = 10_000
BATCH = 500
WARN_EVERY = timedelta(minutes=1)
PURGE_EVERY = timedelta(hours=1)


def _utc_now() -> datetime:
    return datetime.now(UTC)


def configure_logging() -> None:
    """Lignes JSON brutes sur la sortie standard, pour le collecteur de l'exploitation (T4)."""
    logger = logging.getLogger(LOGGER)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter("%(message)s"))
        logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False


class Recorder:
    def __init__(
        self,
        store: TelemetryStore | None,
        clock: Callable[[], datetime] = _utc_now,
        *,
        capacity: int = CAPACITY,
        batch: int = BATCH,
        wait: float = 1.0,
    ) -> None:
        self._store, self._clock, self._batch, self._wait = store, clock, batch, wait
        self._queue: queue.Queue[Measure] = queue.Queue(capacity)
        self._logger = logging.getLogger(LOGGER)
        self._lock = threading.Lock()
        self._dropped = 0
        self._warned: datetime | None = None
        self._purged: datetime | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._closed = False

    @property
    def store(self) -> TelemetryStore | None:
        """Magasin des mesures ; `None` en mode local, sans base."""
        return self._store

    @property
    def clock(self) -> Callable[[], datetime]:
        return self._clock

    def submit(self, measure: Measure) -> None:
        """Journalise la mesure et la confie au fil d'écriture ; ne bloque jamais."""
        self._logger.info(json.dumps(measure.to_json(), ensure_ascii=False))
        if self._store is None:
            return
        if self._closed:
            # Après l'arrêt, plus aucun fil ne vide la file : la mesure est perdue, et comptée.
            self._lose(1)
            return
        try:
            self._queue.put_nowait(measure)
        except queue.Full:
            self._lose(1)

    def start(self) -> None:
        if self._store is None or self._thread is not None:
            return
        self._stop.clear()
        self._closed = False
        self._thread = threading.Thread(target=self._run, name="telemetry", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        """Arrête le fil après avoir vidé la file ; une perte encore tue est journalisée."""
        if self._thread is not None:
            self._stop.set()
            self._thread.join()
            self._thread = None
            self._closed = True
        self._warn(force=True)

    def _run(self) -> None:
        while not self._stop.is_set():
            self.flush(block=True)
        # À l'arrêt, la file est vidée avant la fin du fil (T5).
        while not self._queue.empty():
            self.flush()

    def flush(self, *, block: bool = False) -> None:
        """Écrit un lot ; purge et avertissement si leur délai est passé."""
        measures: list[Measure] = []
        try:
            measures.append(
                self._queue.get(timeout=self._wait) if block else self._queue.get_nowait()
            )
            while len(measures) < self._batch:
                measures.append(self._queue.get_nowait())
        except queue.Empty:
            pass
        store = self._store
        if store is None:
            return
        if measures:
            try:
                store.record(measures)
            except Exception:
                self._lose(len(measures))
        now = self._clock()
        if self._purged is None or now - self._purged >= PURGE_EVERY:
            self._purged = now
            try:
                store.purge(now - RETENTION)
            except Exception:
                self._logger.warning(json.dumps({"telemetry": "purge_failed"}))
        self._warn()

    def lose(self, count: int) -> None:
        """Compte des mesures perdues avant d'être confiées : la perte est journalisée."""
        self._lose(count)

    def _lose(self, count: int) -> None:
        with self._lock:
            self._dropped += count
        self._warn()

    def _warn(self, *, force: bool = False) -> None:
        """Avertit des mesures perdues, au plus une fois par minute (T5)."""
        now = self._clock()
        with self._lock:
            if self._dropped == 0:
                return
            if not force and self._warned is not None and now - self._warned < WARN_EVERY:
                return
            dropped, self._dropped, self._warned = self._dropped, 0, now
        self._logger.warning(json.dumps({"telemetry": "measures_dropped", "count": dropped}))
