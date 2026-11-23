"""Références versionnées des dashboards vers les contenus du plan 20."""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

from skifer_board.content.index import DashboardIndex, DashboardRow, SharedReference
from skifer_board.content.repository import DASHBOARD_KIND
from skifer_board.state.schema import dashboard_component_references, dashboard_theme_references
from sqlalchemy import Engine, func, select

from .monde import ACTOR, init, new_id, repository

ROOT = Path(__file__).resolve().parents[4] / "contracts/dashboards/fixtures/extensions"


def test_references_dashboard_cycle_et_cascade(tmp_path: Path, migre: Engine) -> None:
    repo = repository(init(tmp_path / "contents"))
    document = json.loads((ROOT / "valid.json").read_text())
    document["id"] = new_id()
    stored = repo.write(
        "finance",
        document["id"],
        document,
        expected_revision=None,
        actor=ACTOR,
        kind=DASHBOARD_KIND,
    )
    row = DashboardRow.of("finance", stored)
    node = document["layout"]["sections"][0]["rows"][0]["columns"][0]["children"][0]
    assert row.theme == (document["theme"]["theme_id"], document["theme"]["revision"])
    assert row.components == (SharedReference(node["id"], node["component"]["component_id"], 1),)
    index = DashboardIndex(migre)
    index.upsert(row)
    assert index.get("finance", document["id"]) == row
    assert row.theme is not None
    loaded = index.get("finance", document["id"])
    assert loaded is not None and loaded.theme == row.theme
    index.upsert(replace(row, revision=0, theme=None, components=()))
    assert index.get("finance", document["id"]) == row
    index.upsert(replace(row, revision=2, theme=None, components=()))
    assert index.get("finance", document["id"]) == replace(
        row, revision=2, theme=None, components=()
    )
    index.upsert(replace(row, revision=3))
    index.remove("finance", document["id"], 3)
    with migre.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(dashboard_theme_references)) == 0
        assert (
            connection.scalar(select(func.count()).select_from(dashboard_component_references)) == 0
        )


def test_reference_composant_dans_conteneur(tmp_path: Path, migre: Engine) -> None:
    from .monde_dashboard import column, container, row, section

    repo = repository(init(tmp_path / "contents"))
    data = json.loads((ROOT / "valid.json").read_text())
    data["id"] = new_id()
    node = data["layout"]["sections"][0]["rows"][0]["columns"][0]["children"][0]
    data["layout"] = {"sections": [section(row(column(container(row(column(node))))))]}
    stored = repo.write(
        "finance", data["id"], data, expected_revision=None, actor=ACTOR, kind=DASHBOARD_KIND
    )
    record = DashboardRow.of("finance", stored)
    assert record.components == (SharedReference(node["id"], node["component"]["component_id"], 1),)
    index = DashboardIndex(migre)
    index.upsert(record)
    loaded = index.get("finance", data["id"])
    assert loaded is not None and loaded.components == record.components


def test_lecture_references_atomique_face_a_une_revision(migre: Engine, tmp_path: Path) -> None:
    from threading import Event, Thread
    from typing import Any

    from sqlalchemy import event

    repo = repository(init(tmp_path / "contents"))
    document = json.loads((ROOT / "valid.json").read_text())
    document["id"] = new_id()
    stored = repo.write(
        "finance",
        document["id"],
        document,
        expected_revision=None,
        actor=ACTOR,
        kind=DASHBOARD_KIND,
    )
    index = DashboardIndex(migre)
    first = DashboardRow.of("finance", stored)
    index.upsert(first)
    second = replace(first, revision=2, theme=None, components=())
    started, finished = Event(), Event()
    threads: list[Thread] = []

    def revise() -> None:
        started.set()
        index.upsert(second)
        finished.set()

    def apres_lecture(
        conn: Any, cursor: Any, statement: str, parameters: Any, context: Any, many: bool
    ) -> None:
        if "FOR SHARE" not in statement or threads:
            return
        worker = Thread(target=revise)
        threads.append(worker)
        worker.start()
        assert started.wait(5)
        assert not finished.wait(0.2)

    event.listen(migre, "after_cursor_execute", apres_lecture)
    try:
        observed = index.get("finance", document["id"])
    finally:
        event.remove(migre, "after_cursor_execute", apres_lecture)
    assert threads
    threads[0].join(timeout=5)
    assert finished.is_set()
    assert observed == first
    assert index.get("finance", document["id"]) == second
