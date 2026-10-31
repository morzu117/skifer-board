"""Règles de réagrégation d'une métrique, lues dans la forme du modèle sémantique skifer.

Aucun import de skifer : la forme d'une métrique (``name``, ``type``, ``additivity``,
``non_additive_dimensions``) est lue comme un dictionnaire (plan 01, P4).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class ContractError(ValueError):
    """Un contrat de résultat ou une règle de métrique est invalide."""


class Aggregation(StrEnum):
    """Types d'agrégation d'une métrique skifer (``semantic/validator.py``)."""

    SUM = "sum"
    COUNT = "count"
    COUNT_DISTINCT = "count_distinct"
    AVG = "avg"
    MIN = "min"
    MAX = "max"


class Additivity(StrEnum):
    """Additivité déclarée d'une métrique skifer (``semantic/domain.py``)."""

    ADDITIVE = "additive"
    SEMI_ADDITIVE = "semi_additive"
    NON_ADDITIVE = "non_additive"


@dataclass(frozen=True)
class AvgComponents:
    """Colonnes de somme et d'effectif qui permettent de recalculer une moyenne (SK-11)."""

    sum_column: str
    count_column: str

    def __post_init__(self) -> None:
        for column in (self.sum_column, self.count_column):
            if not isinstance(column, str) or not column:
                raise ContractError("A component column must be a non-empty string.")
        if self.sum_column == self.count_column:
            raise ContractError("Sum and count components must be distinct columns.")


@dataclass(frozen=True)
class MetricRule:
    """Ce que Board a le droit de faire d'une métrique déjà calculée par le moteur."""

    name: str
    aggregation: Aggregation
    additivity: Additivity = Additivity.ADDITIVE
    non_additive_dimensions: frozenset[str] = field(default_factory=frozenset)
    components: AvgComponents | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.name, str) or not self.name:
            raise ContractError("A metric name must be a non-empty string.")
        if self.additivity is Additivity.SEMI_ADDITIVE and not self.non_additive_dimensions:
            raise ContractError(
                f"Metric '{self.name}': semi_additive requires non_additive_dimensions."
            )
        if self.additivity is not Additivity.SEMI_ADDITIVE and self.non_additive_dimensions:
            raise ContractError(
                f"Metric '{self.name}': non_additive_dimensions is only valid for semi_additive."
            )
        if self.components is not None:
            if self.aggregation is not Aggregation.AVG:
                raise ContractError(f"Metric '{self.name}': components are only valid for avg.")
            if self.name in (self.components.sum_column, self.components.count_column):
                raise ContractError(
                    f"Metric '{self.name}': a component cannot be the metric column itself."
                )

    @classmethod
    def from_skifer_metric(
        cls, metric: Mapping[str, Any], *, components: AvgComponents | None = None
    ) -> MetricRule:
        """Lit une métrique telle qu'elle figure dans un modèle sémantique skifer.

        Les clés inconnues sont ignorées ; rien d'absent n'est déduit, sauf l'additivité
        ``additive`` qui est le défaut de skifer.
        """
        name = metric.get("name")
        if not isinstance(name, str) or not name:
            raise ContractError("A skifer metric must have a non-empty 'name'.")
        raw_type = metric.get("type")
        try:
            aggregation = Aggregation(str(raw_type).lower())
        except ValueError:
            raise ContractError(f"Metric '{name}': unsupported type {raw_type!r}.") from None
        raw_additivity = metric.get("additivity", Additivity.ADDITIVE.value)
        try:
            additivity = Additivity(raw_additivity)
        except ValueError:
            raise ContractError(
                f"Metric '{name}': invalid additivity {raw_additivity!r}."
            ) from None
        raw_dimensions = metric.get("non_additive_dimensions") or []
        if not isinstance(raw_dimensions, list) or not all(
            isinstance(dimension, str) and dimension for dimension in raw_dimensions
        ):
            raise ContractError(
                f"Metric '{name}': non_additive_dimensions must be a list of names."
            )
        return cls(
            name=name,
            aggregation=aggregation,
            additivity=additivity,
            non_additive_dimensions=frozenset(raw_dimensions),
            components=components,
        )
