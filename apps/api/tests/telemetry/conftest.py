"""Base migrée, magasin de télémétrie et mesures de référence (plan 11, 11.1)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from skifer_board.state.schema import telemetry
from skifer_board.telemetry import Kind, Measure, TelemetryStore
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
