"""Télémétrie de Board (plan 11) : mesures brutes, jamais la personne ni une valeur."""

from .asgi import TelemetryMiddleware
from .model import (
    METHODS,
    OUTCOMES,
    REFUSAL_CODES,
    RETENTION,
    InvalidMeasure,
    Kind,
    Measure,
    OperationSummary,
    Summary,
    Window,
    outcome,
)
from .recorder import Recorder, configure_logging
from .store import TelemetryStore
from .web import TELEMETRY_PATH, install_telemetry

__all__ = [
    "METHODS",
    "OUTCOMES",
    "REFUSAL_CODES",
    "RETENTION",
    "TELEMETRY_PATH",
    "InvalidMeasure",
    "Kind",
    "Measure",
    "OperationSummary",
    "Recorder",
    "Summary",
    "TelemetryMiddleware",
    "TelemetryStore",
    "Window",
    "configure_logging",
    "install_telemetry",
    "outcome",
]
