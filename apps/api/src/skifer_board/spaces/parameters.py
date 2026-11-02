"""Paramètres de déploiement d'un espace (plan 10, P2 à P5) : modèle pur.

Une déclaration nomme un paramètre, fixe son type parmi cinq types fermés et ses contraintes,
dit s'il est obligatoire et peut porter une valeur par défaut. Chaque environnement peut avoir
sa valeur propre. Une valeur est une donnée typée, jamais un fragment de requête : Board ne la
substitue dans aucun texte (P2).
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any, TypeGuard

from .model import ENVIRONMENTS, Environment, PersonRef, SpaceError

PARAMETER_NAME = re.compile(r"[a-z][a-z0-9_]{0,62}")
IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,127}")
TEXT_MAX = 1024
# Entiers exacts dans le navigateur (P2).
SAFE_INTEGER = 2**53 - 1
CHOICES_MAX = 50
CHOICE_MAX = 128
DESCRIPTION_MAX = 200
PARAMETERS_LIMIT = 100

Value = str | int | bool


class ParameterType(StrEnum):
    TEXT = "text"
    INTEGER = "integer"
    BOOLEAN = "boolean"
    CHOICE = "choice"
    IDENTIFIER = "identifier"


class State(StrEnum):
    """État résolu d'un paramètre dans un environnement (P4)."""

    VALUE = "value"
    DEFAULT = "default"
    MISSING = "missing"
    ABSENT = "absent"


class InvalidParameter(ValueError):
    """Déclaration ou valeur refusée ; `field` nomme le champ en cause, jamais sa valeur."""

    def __init__(self, field: str) -> None:
        super().__init__(field)
        self.field = field


class ParameterNotFound(SpaceError):
    code = "parameter_not_found"


class ParameterExists(SpaceError):
    code = "parameter_exists"


class ParameterLimit(SpaceError):
    """Au plus `PARAMETERS_LIMIT` paramètres par espace (P3)."""

    code = "parameter_limit"


class ValuesIncompatible(SpaceError):
    """Une déclaration qui rendrait invalides des valeurs existantes est refusée (P5)."""

    code = "values_incompatible"

    def __init__(self, environments: tuple[Environment, ...]) -> None:
        super().__init__(", ".join(environments))
        self.environments = environments


def same_value(left: Value | None, right: Value | None) -> bool:
    """Égalité typée : `True` n'est pas `1`."""
    return type(left) is type(right) and left == right


def _is_int(value: object) -> TypeGuard[int]:
    # `bool` dérive de `int` en Python, et un nombre à virgule n'est pas un entier.
    return type(value) is int


def _plain(text: str) -> bool:
    """Sans caractère de contrôle ni demi-paire de substitution (que la base refuserait)."""
    return all(unicodedata.category(char) not in ("Cc", "Cs") for char in text)


def _bounded_text(value: object, maximum: int) -> TypeGuard[str]:
    return isinstance(value, str) and 1 <= len(value) <= maximum and _plain(value)


def check_name(value: object) -> str:
    if not isinstance(value, str) or PARAMETER_NAME.fullmatch(value) is None:
        raise InvalidParameter("name")
    return value


@dataclass(frozen=True)
class Constraints:
    """Contraintes d'un type ; seules celles du type déclaré sont renseignées."""

    max_length: int | None = None
    minimum: int | None = None
    maximum: int | None = None
    choices: tuple[str, ...] = ()


_KEYS: dict[ParameterType, frozenset[str]] = {
    ParameterType.TEXT: frozenset({"max_length"}),
    ParameterType.INTEGER: frozenset({"minimum", "maximum"}),
    ParameterType.BOOLEAN: frozenset(),
    ParameterType.CHOICE: frozenset({"choices"}),
    ParameterType.IDENTIFIER: frozenset(),
}


def _safe_bound(raw: Mapping[str, object], key: str) -> int | None:
    value = raw.get(key)
    if value is None:
        return None
    if not _is_int(value) or abs(value) > SAFE_INTEGER:
        raise InvalidParameter(f"constraints.{key}")
    return value


def parse_constraints(kind: ParameterType, raw: object) -> Constraints:
    if not isinstance(raw, Mapping) or not set(raw) <= _KEYS[kind]:
        raise InvalidParameter("constraints")
    if kind is ParameterType.TEXT:
        length = raw.get("max_length")
        if not _is_int(length) or not 1 <= length <= TEXT_MAX:
            raise InvalidParameter("constraints.max_length")
        return Constraints(max_length=length)
    if kind is ParameterType.INTEGER:
        minimum = _safe_bound(raw, "minimum")
        maximum = _safe_bound(raw, "maximum")
        if minimum is not None and maximum is not None and minimum > maximum:
            raise InvalidParameter("constraints.maximum")
        return Constraints(minimum=minimum, maximum=maximum)
    if kind is ParameterType.CHOICE:
        choices = raw.get("choices")
        if (
            not isinstance(choices, list)
            or not 1 <= len(choices) <= CHOICES_MAX
            or not all(_bounded_text(choice, CHOICE_MAX) for choice in choices)
            or len(set(choices)) != len(choices)
        ):
            raise InvalidParameter("constraints.choices")
        return Constraints(choices=tuple(choices))
    return Constraints()


def constraints_json(kind: ParameterType, constraints: Constraints) -> dict[str, Any]:
    if kind is ParameterType.TEXT:
        return {"max_length": constraints.max_length}
    if kind is ParameterType.INTEGER:
        return {"minimum": constraints.minimum, "maximum": constraints.maximum}
    if kind is ParameterType.CHOICE:
        return {"choices": list(constraints.choices)}
    return {}


def _valid(value: object, kind: ParameterType, constraints: Constraints) -> TypeGuard[Value]:
    if kind is ParameterType.TEXT:
        assert constraints.max_length is not None, "longueur d'un texte"
        return _bounded_text(value, constraints.max_length)
    if kind is ParameterType.INTEGER:
        if not _is_int(value) or abs(value) > SAFE_INTEGER:
            return False
        low = constraints.minimum
        high = constraints.maximum
        return (low is None or value >= low) and (high is None or value <= high)
    if kind is ParameterType.BOOLEAN:
        return isinstance(value, bool)
    if kind is ParameterType.CHOICE:
        return isinstance(value, str) and value in constraints.choices
    return isinstance(value, str) and IDENTIFIER.fullmatch(value) is not None


@dataclass(frozen=True)
class Declaration:
    """Ce qu'un administrateur déclare d'un paramètre, sans son nom, immuable (P3)."""

    type: ParameterType
    constraints: Constraints
    required: bool
    default: Value | None
    description: str

    @classmethod
    def parse(
        cls,
        kind: object,
        constraints: object,
        required: object,
        default: object,
        description: object,
    ) -> Declaration:
        """Déclaration validée, ou `InvalidParameter` sur le premier champ en cause."""
        if not isinstance(kind, str) or kind not in {member.value for member in ParameterType}:
            raise InvalidParameter("type")
        parsed_kind = ParameterType(kind)
        parsed = parse_constraints(parsed_kind, constraints)
        if not isinstance(required, bool):
            raise InvalidParameter("required")
        checked: Value | None = None
        if default is not None:
            if not _valid(default, parsed_kind, parsed):
                raise InvalidParameter("default")
            checked = default
        if (
            not isinstance(description, str)
            or len(description) > DESCRIPTION_MAX
            or not _plain(description)
        ):
            raise InvalidParameter("description")
        return cls(parsed_kind, parsed, required, checked, description)

    def check(self, value: object) -> Value:
        """La valeur, si elle respecte le type et les contraintes ; sinon `InvalidParameter`."""
        if not self.accepts(value):
            raise InvalidParameter("value")
        return value

    def accepts(self, value: object) -> TypeGuard[Value]:
        return _valid(value, self.type, self.constraints)

    def same_as(self, other: Declaration) -> bool:
        return self == other and same_value(self.default, other.default)

    def to_json(self) -> dict[str, Any]:
        return {
            "type": self.type.value,
            "constraints": constraints_json(self.type, self.constraints),
            "required": self.required,
            "default": self.default,
            "description": self.description,
        }

    def resolve(self, own: Value | None) -> Resolved:
        """Valeur propre, sinon valeur par défaut (P4)."""
        if own is not None:
            return Resolved(State.VALUE, own)
        if self.default is not None:
            return Resolved(State.DEFAULT, self.default)
        return Resolved(State.MISSING if self.required else State.ABSENT, None)

    def incompatible(self, values: Mapping[Environment, Value]) -> tuple[Environment, ...]:
        """Environnements dont la valeur propre serait invalide sous cette déclaration (P5),
        dans l'ordre de promotion."""
        return tuple(
            environment
            for environment in ENVIRONMENTS
            if environment in values and not self.accepts(values[environment])
        )


@dataclass(frozen=True)
class Resolved:
    state: State
    value: Value | None


@dataclass(frozen=True)
class Parameter:
    space_id: str
    name: str
    declaration: Declaration
    created_at: datetime
    created_by: PersonRef
    updated_at: datetime
    updated_by: PersonRef


@dataclass(frozen=True)
class ParameterValue:
    """Valeur propre d'un paramètre dans un environnement."""

    space_id: str
    name: str
    environment: Environment
    value: Value
    set_at: datetime
    set_by: PersonRef


@dataclass(frozen=True)
class Configuration:
    """Déclarations d'un espace, par nom, et leurs valeurs propres, lues ensemble."""

    parameters: tuple[Parameter, ...]
    values: tuple[ParameterValue, ...]

    def own(self, name: str, environment: Environment) -> ParameterValue | None:
        return next(
            (
                found
                for found in self.values
                if found.name == name and found.environment is environment
            ),
            None,
        )

    def resolved(self, environment: Environment) -> tuple[tuple[Parameter, Resolved], ...]:
        resolved = []
        for parameter in self.parameters:
            own = self.own(parameter.name, environment)
            value = None if own is None else own.value
            resolved.append((parameter, parameter.declaration.resolve(value)))
        return tuple(resolved)

    def missing(self, environment: Environment) -> tuple[str, ...]:
        """Paramètres obligatoires sans valeur ni défaut : l'environnement est incomplet (P4)."""
        return tuple(
            parameter.name
            for parameter, resolved in self.resolved(environment)
            if resolved.state is State.MISSING
        )

    def complete(self, environment: Environment) -> bool:
        return not self.missing(environment)


def values_by_environment(values: Iterable[ParameterValue]) -> dict[Environment, Value]:
    return {found.environment: found.value for found in values}
