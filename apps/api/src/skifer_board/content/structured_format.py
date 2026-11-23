"""Formats de modèle et composant, réutilisant les définitions du dashboard.

Les références externes du schéma sont résolues depuis le contrat local, sans réseau.
Le coup d'œil `personal` est une valeur technique, sans décision d'approbation.
"""

from __future__ import annotations

import copy
import json
import re
from functools import cached_property
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from . import dashboard
from .common import HEADER_MAX, Change, Dumper, Loader, header, plain, schema_violations, walk
from .errors import (
    CONTENT_UNAVAILABLE,
    INVALID_COMPONENT,
    INVALID_PAGE_TEMPLATE,
    ContentError,
    Violation,
)

ROOT = Path(__file__).resolve().parents[5] / "contracts"
DASHBOARD_ID = "https://skifer-board.dev/schema/dashboard.v1.json"
_ORDER = (
    "api_version",
    "id",
    "name",
    "description",
    "owner",
    "issuer",
    "subject",
    "defaults",
    "filters",
    "layout",
    "kind",
    "analysis",
    "presentation",
    "sections",
    "title",
    "type",
    "expected",
    "label",
    "dimension",
    "operator",
    "default",
    "allowed",
    "rows",
    "columns",
    "span",
    "children",
    "analysis_id",
    "revision",
    "chart",
    "legend",
    "number_format",
    "threshold",
    "tooltip",
    "value",
    "blocks",
    "level",
    "ordered",
    "content",
    "items",
    "text",
    "emphasis",
    "strong",
)
_RANK = {key: i for i, key in enumerate(_ORDER)}


class StructuredFormat:
    """Schéma fermé et opérations canoniques pour un des deux genres."""

    def __init__(self, name: str, directory: str, marker: str) -> None:
        self.name, self.directory, self.marker = name, directory, marker

    @cached_property
    def schema(self) -> dict[str, Any]:
        try:
            result: dict[str, Any] = json.loads(
                (ROOT / self.directory / f"{self.name}.v1.json").read_text(encoding="utf-8")
            )
            return result
        except (OSError, ValueError):
            raise ContentError(CONTENT_UNAVAILABLE, "schema_unavailable") from None

    @cached_property
    def validator(self) -> Draft202012Validator:
        registry = Registry().with_resource(
            DASHBOARD_ID, Resource.from_contents(dashboard.schema())
        )
        return Draft202012Validator(self.schema, registry=registry)

    def refuse(self, violations: list[Violation]) -> ContentError:
        found = tuple(sorted(set(violations), key=lambda v: (v.path, v.rule)))
        return ContentError(
            INVALID_PAGE_TEMPLATE if self.name == "page_template" else INVALID_COMPONENT,
            found[0].rule,
            found,
        )

    def validate(self, data: Any) -> dict[str, Any]:
        violations = plain(data, dashboard.MAX_DEPTH)
        if not violations:
            violations = schema_violations(self.validator, data)
        if violations:
            raise self.refuse(violations)
        result: dict[str, Any] = copy.deepcopy(data)
        if self.name == "page_template":
            scan = dashboard._Scan()
            for i, section in enumerate(result["layout"]["sections"]):
                path = f"/layout/sections/{i}"
                scan.claim(section["id"], "section", f"{path}/id")
                scan.node(path)
                dashboard._rows(scan, section["rows"], f"{path}/rows", 1)
            result["filters"] = [
                dashboard._filter(scan, item, f"/filters/{i}", targets_required=False)
                for i, item in enumerate(result["filters"])
            ]
            violations = scan.violations
        elif type(result["analysis"]["revision"]) is not int:
            violations = [Violation("/analysis/revision", "wrong_type")]
        if violations:
            raise self.refuse(violations)
        return result

    def loads(self, raw: bytes) -> dict[str, Any]:
        try:
            data = yaml.load(raw.decode("utf-8"), Loader=Loader)
        except (UnicodeDecodeError, yaml.YAMLError, RecursionError):
            raise self.refuse([Violation("", "unreadable_document")]) from None
        return self.validate(data)

    def dumps(self, data: dict[str, Any]) -> bytes:
        valid = self.validate(data)

        def ordered(value: Any) -> Any:
            if isinstance(value, dict):
                return {
                    k: ordered(value[k])
                    for k in sorted(value, key=lambda k: (_RANK.get(k, len(_RANK)), k))
                }
            if isinstance(value, list):
                return [ordered(v) for v in value]
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
        if self.loads(raw) != valid:
            raise self.refuse([Violation("", "not_representable")])
        return raw

    def brief(self, raw: bytes) -> tuple[str, str, str, str]:
        marker = (self.marker + ":").encode()
        found = re.search(rb"^" + re.escape(marker), raw[: HEADER_MAX + len(marker)], re.MULTILINE)
        if found is None:
            raise self.refuse([Violation("", "unreadable_document")])
        result = header(raw[: found.start()] + b"visibility: personal\n" + marker + b"\n", marker)
        if result is None:
            raise self.refuse([Violation("", "unreadable_document")])
        return result

    def diff(self, before: dict[str, Any], after: dict[str, Any]) -> tuple[Change, ...]:
        changes: list[Change] = []
        walk("", before, after, changes, _RANK)
        return tuple(changes)


PAGE_TEMPLATE = StructuredFormat("page_template", "page_templates", "defaults")
COMPONENT = StructuredFormat("component", "components", "kind")
