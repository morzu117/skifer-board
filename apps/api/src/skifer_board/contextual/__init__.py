"""Couche de calcul contextuel du Board (plan de développement, §4.6)."""

from .contract import Completeness, ContextualResult, ResultContract
from .rules import Additivity, Aggregation, AvgComponents, ContractError, MetricRule

__all__ = [
    "Additivity",
    "Aggregation",
    "AvgComponents",
    "Completeness",
    "ContextualResult",
    "ContractError",
    "MetricRule",
    "ResultContract",
]
