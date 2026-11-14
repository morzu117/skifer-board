"""Format `board.theme/v1` : validation, YAML canonique et diff structurel.

Le centre divergent est explicitement un des tokens `neutral.fg` et `neutral.bg` du
catalogue de design, sous réserve de contraste. Chaque aile est strictement monotone.
Le dépôt utilise `personal` comme indication technique de coup d'œil : ce n'est pas une
approbation ni une décision de visibilité, qui seront établies à l'étape 20.2.
"""

from __future__ import annotations

import copy
import json
import re
from functools import cache
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from . import dashboard
from .analysis import RULES as ANALYSIS_RULES
from .common import (
    HEADER_MAX,
    Change,
    Dumper,
    Loader,
    field,
    header,
    plain,
    schema_violations,
    walk,
)
from .errors import (
    CONTENT_UNAVAILABLE,
    DIVERGING_SIDES,
    DUPLICATE_COLOR,
    INVALID_THEME,
    THEME_RULES,
    ContentError,
    Violation,
)
from .token_catalog import CONTRACT, TOKENS

SCHEMA_PATH = Path(__file__).resolve().parents[5] / "contracts/themes/theme.v1.json"
NEUTRAL = frozenset({"neutral.fg", "neutral.bg"})
RULES = ANALYSIS_RULES | THEME_RULES
_ORDER = (
    "api_version",
    "id",
    "name",
    "description",
    "owner",
    "issuer",
    "subject",
    "base",
    "roles",
    "marks",
    "text",
    "series",
    "secondary",
    "selected",
    "threshold",
    "positive",
    "negative",
    "total",
    "textStrong",
    "textMuted",
    "thresholdLabel",
    "categorical",
    "sequential",
    "diverging",
    "typography",
    "sans",
    "mono",
    "scale",
    "density",
    "formats",
    "number",
    "date",
    "chart_defaults",
    "value",
    "bars",
    "line",
    "grouped_bars",
    "legend",
    "number_format",
    "tooltip",
)
_RANK = {key: index for index, key in enumerate(_ORDER)}
_HEX = re.compile(r"#[0-9a-fA-F]{6}")


@cache
def _json(path: Path) -> dict[str, Any]:
    try:
        data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        return data
    except (OSError, ValueError):
        raise ContentError(CONTENT_UNAVAILABLE, "schema_unavailable") from None


def schema() -> dict[str, Any]:
    return _json(SCHEMA_PATH)


@cache
def _validator() -> Draft202012Validator:
    registry = Registry().with_resource(
        dashboard.schema()["$id"], Resource.from_contents(dashboard.schema())
    )
    return Draft202012Validator(schema(), registry=registry)


def _refuse(violations: list[Violation]) -> ContentError:
    found = tuple(sorted(set(violations), key=lambda item: (item.path, item.rule)))
    return ContentError(INVALID_THEME, found[0].rule, found)


def _hex_violations(data: Any, path: str = "") -> list[Violation]:
    if isinstance(data, str):
        return [Violation(path, "hex_color")] if _HEX.search(data) else []
    if isinstance(data, dict):
        return [v for k, value in data.items() for v in _hex_violations(value, field(path, k))]
    if isinstance(data, list):
        return [v for i, value in enumerate(data) for v in _hex_violations(value, f"{path}/{i}")]
    return []


def _monotone(values: list[float]) -> bool:
    return all(a < b for a, b in zip(values, values[1:], strict=False)) or all(
        a > b for a, b in zip(values, values[1:], strict=False)
    )


def _semantic(data: dict[str, Any]) -> list[Violation]:
    tokens = _json(CONTRACT)
    base = tokens["bases"][data["base"]]
    lights = tokens["luminance"]
    violations: list[Violation] = []
    for role, category in (("marks", "mark"), ("text", "text")):
        for name, token in data["roles"][role].items():
            if token not in base[category]:
                violations.append(Violation(f"/roles/{role}/{name}", "token_not_admissible"))
    for palette in ("categorical", "sequential", "diverging"):
        for i, token in enumerate(data[palette]):
            if token not in base["mark"]:
                violations.append(Violation(f"/{palette}/{i}", "token_not_admissible"))
    colors: dict[str, str] = {}

    def collect(values: dict[str, Any], prefix: str = "") -> None:
        for key, value in values.items():
            name = f"{prefix}.{key}" if prefix else key
            if isinstance(value, dict):
                collect(value, name)
            else:
                colors[name] = value.lower()

    collect(_json(TOKENS)["color"])
    categorical = [colors[token] for token in data["categorical"]]
    if len(set(categorical)) != len(categorical):
        violations.append(Violation("/categorical", DUPLICATE_COLOR))
    sequential = [lights[name] for name in data["sequential"]]
    if not _monotone(sequential):
        violations.append(Violation("/sequential", "not_monotone"))
    divergent = data["diverging"]
    if len(divergent) % 2 == 0:
        violations.append(Violation("/diverging", "even_diverging"))
    else:
        mid = len(divergent) // 2
        if divergent[mid] not in NEUTRAL:
            violations.append(Violation(f"/diverging/{mid}", "non_neutral"))
        values = [lights[name] for name in divergent]
        if (values[0] - values[mid]) * (values[-1] - values[mid]) <= 0:
            violations.append(Violation("/diverging", DIVERGING_SIDES))
        if not _monotone(values[: mid + 1]) or not _monotone(values[mid:]):
            violations.append(Violation("/diverging", "not_monotone"))
    return violations


def validate(data: Any) -> dict[str, Any]:
    violations = plain(data, 48)
    if not violations:
        violations = _hex_violations(data)
    if not violations:
        violations = schema_violations(_validator(), data)
    if not violations:
        violations = _semantic(data)
    if violations:
        raise _refuse(violations)
    return copy.deepcopy(data)


def loads(raw: bytes) -> dict[str, Any]:
    try:
        data = yaml.load(raw.decode("utf-8"), Loader=Loader)
    except (UnicodeDecodeError, yaml.YAMLError, RecursionError):
        raise _refuse([Violation("", "unreadable_document")]) from None
    return validate(data)


def brief(raw: bytes) -> tuple[str, str, str, str]:
    marker = re.search(rb"^base:", raw[: HEADER_MAX + len(b"base:")], re.MULTILINE)
    if marker is None:
        raise _refuse([Violation("", "unreadable_document")])
    # Le dépôt partage son interface de coup d'œil avec les analyses à visibilité explicite.
    found = header(raw[: marker.start()] + b"visibility: personal\nbase:\n", b"base:")
    if found is None:
        raise _refuse([Violation("", "unreadable_document")])
    return found


def dumps(document: dict[str, Any]) -> bytes:
    valid = validate(document)

    def ordered(value: Any) -> Any:
        if isinstance(value, dict):
            return {
                k: ordered(value[k])
                for k in sorted(value, key=lambda k: (_RANK.get(k, len(_RANK)), k))
            }
        if isinstance(value, list):
            return [ordered(item) for item in value]
        return value

    text: str = yaml.dump(
        ordered(valid),
        Dumper=Dumper,
        sort_keys=False,
        allow_unicode=True,
        default_flow_style=False,
        width=1_000_000,
        indent=2,
    )
    raw = text.encode("utf-8")
    if loads(raw) != valid:
        raise _refuse([Violation("", "not_representable")])
    return raw


def diff(before: dict[str, Any], after: dict[str, Any]) -> tuple[Change, ...]:
    changes: list[Change] = []
    walk("", before, after, changes, _RANK)
    return tuple(changes)
