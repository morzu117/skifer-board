"""Base migrée, magasin de télémétrie et mesures de référence (plan 11, 11.1)."""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from skifer_board.state.schema import telemetry
from skifer_board.telemetry import Kind, Measure, Recorder, TelemetryStore
from skifer_board.telemetry.recorder import LOGGER
from sqlalchemy import Engine, select
from state.conftest import migre as migre

# Instant de référence des fenêtres : « maintenant » pour le magasin.
MAINTENANT = datetime(2026, 11, 3, 12, tzinfo=UTC)


def http(**champs: Any) -> Measure:
    """Requête valide ; chaque champ peut être remplacé."""
    valeurs: dict[str, Any] = {
        "at": MAINTENANT,
        "kind": Kind.HTTP,
        "operation": "/api/spaces/{space_id}/members",
        "outcome": "ok",
        "duration_ms": 12.5,
        "method": "GET",
        "status": 200,
    }
    return Measure(**{**valeurs, **champs})


def atlas(**champs: Any) -> Measure:
    """Lecture d'Atlas valide : ni méthode ni statut."""
    valeurs: dict[str, Any] = {
        "at": MAINTENANT,
        "kind": Kind.ATLAS,
        "operation": "catalog.list",
        "outcome": "ok",
        "duration_ms": 3.0,
    }
    return Measure(**{**valeurs, **champs})


def avant(**duree: float) -> datetime:
    return MAINTENANT - timedelta(**duree)


def lignes(moteur: Engine) -> list[dict[str, Any]]:
    with moteur.connect() as connexion:
        return [
            dict(ligne)
            for ligne in connexion.execute(select(telemetry).order_by(telemetry.c.id)).mappings()
        ]


@pytest.fixture
def magasin(migre: Engine) -> TelemetryStore:
    return TelemetryStore(migre)


# --- Enregistreur et journal (plan 11, 11.2) ---------------------------------------------------


class Collecteur(Recorder):
    """Enregistreur sans base qui garde, en plus du journal, les mesures confiées et les pertes."""

    def __init__(self) -> None:
        super().__init__(None)
        self.mesures: list[Measure] = []
        self.pertes = 0

    def submit(self, measure: Measure) -> None:
        self.mesures.append(measure)
        super().submit(measure)

    def lose(self, count: int) -> None:
        self.pertes += count
        super().lose(count)

    def http(self) -> list[Measure]:
        return [mesure for mesure in self.mesures if mesure.kind is Kind.HTTP]


class Journal(logging.Handler):
    """Capture du journal `skifer_board.telemetry`, tel qu'il partirait sur la sortie standard."""

    def __init__(self) -> None:
        super().__init__(logging.DEBUG)
        self.enregistrements: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.enregistrements.append(record)

    def textes(self) -> list[str]:
        return [record.getMessage() for record in self.enregistrements]

    def mesures(self) -> list[dict[str, Any]]:
        """Lignes JSON des mesures, au niveau INFO."""
        return [
            json.loads(record.getMessage())
            for record in self.enregistrements
            if record.levelno == logging.INFO
        ]

    def avertissements(self) -> list[dict[str, Any]]:
        return [
            json.loads(record.getMessage())
            for record in self.enregistrements
            if record.levelno == logging.WARNING
        ]


@pytest.fixture
def journal() -> Iterator[Journal]:
    """Le journal de télémétrie, seul capteur de ses lignes ; rétabli après le test."""
    logger = logging.getLogger(LOGGER)
    handlers, niveau, propage = list(logger.handlers), logger.level, logger.propagate
    capture = Journal()
    logger.handlers = [capture]
    logger.setLevel(logging.INFO)
    try:
        yield capture
    finally:
        logger.handlers = handlers
        logger.setLevel(niveau)
        logger.propagate = propage


@pytest.fixture
def collecteur(journal: Journal) -> Collecteur:
    return Collecteur()
