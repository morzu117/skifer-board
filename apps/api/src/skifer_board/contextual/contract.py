"""Contrat d'un résultat reçu du moteur : grain, règles des métriques, complétude."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from enum import StrEnum

import pyarrow as pa
import pyarrow.compute as pc

from .rules import ContractError, MetricRule


class GrainError(ContractError):
    """Le résultat ne respecte pas l'unicité du grain déclaré."""


class Completeness(StrEnum):
    """Ce que le résultat chargé couvre du périmètre filtré."""

    COMPLETE = "complete"
    TRUNCATED = "truncated"
    TOP_N = "top_n"


@dataclass(frozen=True)
class ResultContract:
    """Grain d'un résultat (ses dimensions), règles de ses métriques et complétude."""

    dimensions: tuple[str, ...]
    metrics: tuple[MetricRule, ...]
    completeness: Completeness
    evidence_id: str | None = None

    def __post_init__(self) -> None:
        if not all(isinstance(name, str) and name for name in self.dimensions):
            raise ContractError("Dimension names must be non-empty strings.")
        if len(set(self.dimensions)) != len(self.dimensions):
            raise ContractError("Dimension names must be unique.")
        if not self.metrics:
            raise ContractError("A result contract needs at least one metric.")
        names = [rule.name for rule in self.metrics]
        if len(set(names)) != len(names):
            raise ContractError("Metric names must be unique.")
        clash = set(names) & set(self.dimensions)
        if clash:
            raise ContractError(f"Names used both as dimension and metric: {sorted(clash)}.")

    def rule(self, metric: str) -> MetricRule:
        for rule in self.metrics:
            if rule.name == metric:
                return rule
        raise ContractError(f"Unknown metric '{metric}'.")

    def numeric_columns(self) -> Iterator[str]:
        """Colonnes de métriques et de composantes, qui doivent être numériques."""
        for rule in self.metrics:
            yield rule.name
            if rule.components is not None:
                yield rule.components.sum_column
                yield rule.components.count_column


def _is_numeric(data_type: pa.DataType) -> bool:
    return bool(
        pa.types.is_integer(data_type)
        or pa.types.is_floating(data_type)
        or pa.types.is_decimal(data_type)
    )


@dataclass(frozen=True)
class ContextualResult:
    """Un résultat déjà autorisé, en colonnaire, avec son contrat."""

    table: pa.Table
    contract: ResultContract

    def __post_init__(self) -> None:
        schema = self.table.schema
        required = [*self.contract.dimensions, *self.contract.numeric_columns()]
        missing = [name for name in required if schema.get_field_index(name) < 0]
        if missing:
            raise ContractError(f"Result is missing columns: {missing}.")
        for name in self.contract.numeric_columns():
            if not _is_numeric(schema.field(name).type):
                raise ContractError(f"Column '{name}' must be numeric.")
        self._check_single_grain()

    def _check_single_grain(self) -> None:
        """Deux lignes de même clé signalent une ligne de sous-total ou un doublon (P8)."""
        if self.table.num_rows <= 1:
            return
        if not self.contract.dimensions:
            raise GrainError("A result without dimensions must have at most one row.")
        counts = self.table.group_by(list(self.contract.dimensions)).aggregate([([], "count_all")])
        if pc.max(counts["count_all"]).as_py() > 1:
            raise GrainError(
                "Result is not at a single grain: several rows share the same dimension key."
            )
