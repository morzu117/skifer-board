"""Couche de calcul contextuel du Board (plan de développement, §4.6)."""

from .contract import Completeness, ContextualResult, ResultContract
from .operations import (
    Derived,
    EngineRequest,
    Reason,
    Scope,
    Unavailable,
    aggregate,
    share_of_total,
)
from .rules import Additivity, Aggregation, AvgComponents, ContractError, MetricRule

__all__ = [
    "Additivity",
    "Aggregation",
    "AvgComponents",
    "Completeness",
    "ContextualResult",
    "ContractError",
    "Derived",
    "EngineRequest",
    "MetricRule",
    "Reason",
    "ResultContract",
    "Scope",
    "Unavailable",
    "aggregate",
    "share_of_total",
]
