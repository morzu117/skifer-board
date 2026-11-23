"""Approbations par objet, dans `approvals/<genre>/<espace>/<id>.yaml`."""

from __future__ import annotations

import copy
import json
from datetime import datetime
from functools import cache
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from . import dashboard
from .common import Change, Dumper, Loader, plain, schema_violations, walk
from .errors import CONTENT_UNAVAILABLE, INVALID_APPROVALS, ContentError, Violation
from .structured_format import DASHBOARD_ID

SCHEMA_PATH = Path(__file__).resolve().parents[5] / "contracts/approvals/approvals.v1.json"


@cache
def schema() -> dict[str, Any]:
    try:
        result: dict[str, Any] = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        return result
    except (OSError, ValueError):
        raise ContentError(CONTENT_UNAVAILABLE, "schema_unavailable") from None


@cache
def _validator() -> Draft202012Validator:
    registry = Registry().with_resource(DASHBOARD_ID, Resource.from_contents(dashboard.schema()))
    return Draft202012Validator(schema(), registry=registry)


def _refuse(items: list[Violation]) -> ContentError:
    found = tuple(sorted(set(items), key=lambda v: (v.path, v.rule)))
    return ContentError(INVALID_APPROVALS, found[0].rule, found)


def validate(data: Any) -> dict[str, Any]:
    violations = plain(data, 8)
    if not violations:
        violations = schema_violations(_validator(), data)
    if not violations:
        previous = 0
        for index, item in enumerate(data["approvals"]):
            revision = item["revision"]
            if type(revision) is not int:
                violations.append(Violation(f"/approvals/{index}/revision", "wrong_type"))
            elif revision <= previous:
                violations.append(Violation(f"/approvals/{index}/revision", "not_increasing"))
            previous = revision
            try:
                datetime.fromisoformat(item["approved_at"].replace("Z", "+00:00"))
            except ValueError:
                violations.append(Violation(f"/approvals/{index}/approved_at", "bad_format"))
    if violations:
        raise _refuse(violations)
    result: dict[str, Any] = copy.deepcopy(data)
    return result


def loads(raw: bytes) -> dict[str, Any]:
    try:
        data = yaml.load(raw.decode("utf-8"), Loader=Loader)
    except (UnicodeDecodeError, yaml.YAMLError, RecursionError):
        raise _refuse([Violation("", "unreadable_document")]) from None
    return validate(data)


def dumps(data: dict[str, Any]) -> bytes:
    valid = validate(data)
    text: str = yaml.dump(
        valid,
        Dumper=Dumper,
        sort_keys=True,
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
    walk("", before, after, changes, {})
    return tuple(changes)
