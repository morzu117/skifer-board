"""Références de contenus partagés épinglées par un dashboard."""

from __future__ import annotations

import copy
from collections.abc import Iterator
from typing import Any

from ..spaces.model import PersonRef
from .errors import ContentError, Violation
from .repository import COMPONENT_KIND, THEME_KIND, ContentRepository, Kind

REFERENCE_RULES = frozenset({"theme_not_found", "component_not_found"})


def references(document: dict[str, Any]) -> Iterator[tuple[str, str, Kind, str, int]]:
    if "theme" in document:
        theme = document["theme"]
        yield "/theme", "theme", THEME_KIND, theme["theme_id"], theme["revision"]

    def rows(items: list[dict[str, Any]], base: str) -> Iterator[tuple[str, str, Kind, str, int]]:
        for row_index, row in enumerate(items):
            for column_index, column in enumerate(row["columns"]):
                for index, child in enumerate(column["children"]):
                    path = f"{base}/{row_index}/columns/{column_index}/children/{index}"
                    if child["type"] == "container":
                        yield from rows(child["rows"], path + "/rows")
                    elif child["type"] == "component":
                        ref = child["component"]
                        yield (
                            path,
                            child["id"],
                            COMPONENT_KIND,
                            ref["component_id"],
                            ref["revision"],
                        )

    for index, section in enumerate(document["layout"]["sections"]):
        yield from rows(section["rows"], f"/layout/sections/{index}/rows")


def validate_references(
    repository: ContentRepository, space_id: str, document: dict[str, Any], tip: str | None
) -> tuple[list[Violation], list[str]]:
    violations: list[Violation] = []
    unapproved: list[str] = []
    owner = PersonRef(document["owner"]["issuer"], document["owner"]["subject"])
    for path, _, kind, ident, revision in references(document):
        missing = True
        approved = False
        if tip is not None:
            glance = repository.glance(space_id, ident, at=tip, kind=kind)
            if glance.owner is not None and not glance.deleted:
                try:
                    saved = repository.read_approvals(space_id, ident, kind=kind, at=tip)
                    approved = any(
                        item["revision"] == revision for item in saved.document["approvals"]
                    )
                except ContentError as error:
                    if error.code != "approvals_not_found":
                        raise
                if approved or glance.owner == owner:
                    try:
                        repository.read(space_id, ident, revision, at=tip, kind=kind)
                        missing = False
                    except ContentError as error:
                        if error.code != kind.not_found:
                            raise
        if missing:
            violations.append(Violation(path, kind.not_found))
        elif document["visibility"] == "shared" and not approved:
            unapproved.append(path)
    return violations, unapproved


def resolve_references(
    repository: ContentRepository,
    space_id: str,
    document: dict[str, Any],
    tip: str | None,
    *,
    blocked: frozenset[str] = frozenset(),
) -> dict[str, Any]:
    result: dict[str, Any] = {"components": {}}
    if tip is None:
        return result
    for path, node, kind, ident, revision in references(document):
        if path in blocked:
            continue
        try:
            glance = repository.glance(space_id, ident, at=tip, kind=kind)
            if glance.owner is None or glance.deleted:
                continue
            found = repository.read(space_id, ident, revision, at=tip, kind=kind).document
        except ContentError:
            continue
        if kind is THEME_KIND:
            result["theme"] = found
        else:
            result["components"][node] = found
    return result


def execution_view(
    document: dict[str, Any], resolved: dict[str, Any], blocked: set[str]
) -> tuple[dict[str, Any], set[str]]:
    """Projette les composants référencés en tuiles sans modifier le dashboard enregistré."""
    result = copy.deepcopy(document)
    unavailable: set[str] = set()

    def rows(items: list[dict[str, Any]], base: str) -> None:
        for row_index, row in enumerate(items):
            for column_index, column in enumerate(row["columns"]):
                for index, child in enumerate(column["children"]):
                    path = f"{base}/{row_index}/columns/{column_index}/children/{index}"
                    if child["type"] == "container":
                        rows(child["rows"], path + "/rows")
                    elif child["type"] == "component":
                        definition = resolved.get(child["id"])
                        if definition is None or path in blocked:
                            unavailable.add(child["id"])
                            definition = {
                                "kind": "visual",
                                "analysis": {"analysis_id": child["id"], "revision": 1},
                                "presentation": {},
                            }
                        column["children"][index] = {
                            "id": child["id"],
                            "type": "analysis" if definition["kind"] == "visual" else "kpi",
                            "reference": definition["analysis"],
                            "presentation": definition["presentation"],
                        }

    for index, section in enumerate(result["layout"]["sections"]):
        rows(section["rows"], f"/layout/sections/{index}/rows")
    return result, unavailable
