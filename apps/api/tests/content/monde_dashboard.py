"""Documents d'exemple `board.dashboard/v1` pour les tests du format et du dépôt (plan 19.1)."""

from __future__ import annotations

import copy
import uuid
from typing import Any

from .monde import ACTOR

ESPACE = "finance"


def new_id() -> str:
    return str(uuid.uuid4())


def segment(text: str, **flags: bool) -> dict[str, Any]:
    return {"text": text, **flags}


def paragraph(*texts: str) -> dict[str, Any]:
    return {"type": "paragraph", "content": [segment(text) for text in texts]}


def text(*blocks: dict[str, Any], ident: str | None = None) -> dict[str, Any]:
    return {"id": ident or new_id(), "type": "text", "blocks": list(blocks) or [paragraph("x")]}


def separator(ident: str | None = None) -> dict[str, Any]:
    return {"id": ident or new_id(), "type": "separator"}


def visual(
    ident: str | None = None,
    analysis_id: str | None = None,
    revision: Any = 1,
    **presentation: Any,
) -> dict[str, Any]:
    return {
        "id": ident or new_id(),
        "type": "analysis",
        "reference": {"analysis_id": analysis_id or new_id(), "revision": revision},
        "presentation": presentation,
    }


def kpi(
    ident: str | None = None,
    analysis_id: str | None = None,
    revision: Any = 1,
    **presentation: Any,
) -> dict[str, Any]:
    return {**visual(ident, analysis_id, revision, **presentation), "type": "kpi"}


def container(*rows: dict[str, Any], ident: str | None = None) -> dict[str, Any]:
    return {"id": ident or new_id(), "type": "container", "rows": list(rows)}


def column(*children: dict[str, Any], span: Any = 12, ident: str | None = None) -> dict[str, Any]:
    return {"id": ident or new_id(), "span": span, "children": list(children)}


def row(*columns: dict[str, Any], ident: str | None = None) -> dict[str, Any]:
    return {"id": ident or new_id(), "columns": list(columns)}


def section(
    *rows: dict[str, Any], title: str | None = None, ident: str | None = None
) -> dict[str, Any]:
    value: dict[str, Any] = {"id": ident or new_id()}
    if title is not None:
        value["title"] = title
    value["rows"] = list(rows)
    return value


def common_filter(
    targets: list[str], *, dimension: str = "region", operator: str = "eq", **extra: Any
) -> dict[str, Any]:
    return {
        "id": new_id(),
        "label": "Région",
        "dimension": dimension,
        "operator": operator,
        "targets": targets,
        **extra,
    }


def dashboard(dashboard_id: str | None = None, **changes: Any) -> dict[str, Any]:
    """Un dashboard minimal valide : une section, une rangée, une colonne de visuel."""
    value: dict[str, Any] = {
        "api_version": "board.dashboard/v1",
        "id": dashboard_id or new_id(),
        "name": "Pilotage",
        "description": "Suivi.",
        "visibility": "personal",
        "owner": {"issuer": ACTOR.issuer, "subject": ACTOR.subject},
        "defaults": {},
        "filters": [],
        "layout": {"sections": [section(row(column(visual())))]},
    }
    value.update(copy.deepcopy(changes))
    return value


def with_sections(*sections: dict[str, Any], **changes: Any) -> dict[str, Any]:
    return dashboard(**{"layout": {"sections": list(sections)}, **changes})


def with_components(*components: dict[str, Any], **changes: Any) -> dict[str, Any]:
    """Un dashboard dont l'unique colonne porte ces composants (au plus 16 par colonne)."""
    return with_sections(section(row(column(*components))), **changes)


def flat(components: list[dict[str, Any]], **changes: Any) -> dict[str, Any]:
    """Autant de colonnes de largeur 1 que nécessaire : 12 par rangée, 24 rangées par section."""
    rows = [
        row(*(column(item, span=1) for item in components[start : start + 12]))
        for start in range(0, len(components), 12)
    ]
    sections = [section(*rows[start : start + 24]) for start in range(0, max(len(rows), 1), 24)]
    return dashboard(**{"layout": {"sections": sections}, **changes})
