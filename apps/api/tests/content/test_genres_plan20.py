"""Isolation et cycle git des genres provisoires du plan 20."""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import pytest
from skifer_board.content import (
    ANALYSIS_KIND,
    DASHBOARD_KIND,
    KINDS,
    ContentError,
)

from .monde import ACTOR, document, git, init, new_id, repository
from .monde_dashboard import dashboard


def test_isolation_et_historique(tmp_path: Path) -> None:
    root = init(tmp_path / "contents")
    repo = repository(root)
    space, ident = new_id(), new_id()
    theme_path = Path(__file__).resolve().parents[4] / "contracts/themes/fixtures/valid/clair.json"
    theme = {**json.loads(theme_path.read_text()), "id": ident}
    contract_root = Path(__file__).resolve().parents[4] / "contracts"
    template = {
        **json.loads((contract_root / "page_templates/fixtures/valid/base.json").read_text()),
        "id": ident,
    }
    component = {
        **json.loads((contract_root / "components/fixtures/valid/base.json").read_text()),
        "id": ident,
    }
    documents = [document(ident), dashboard(ident), theme, template, component]
    for kind, data in zip(KINDS, documents, strict=True):
        before = {
            other: repo.history(space, ident, kind=other)
            for other in KINDS
            if other is not kind and other in KINDS[: KINDS.index(kind)]
        }
        repo.write(space, ident, data, expected_revision=None, actor=ACTOR, kind=kind)
        assert git(root, "show", "--format=", "--name-only", "HEAD").split() == [
            f"{kind.directory}/{space}/{ident}.yaml"
        ]
        assert all(
            repo.history(space, ident, kind=other) == history for other, history in before.items()
        )
    for kind, data in zip(KINDS, documents, strict=True):
        previous = {
            other: repo.history(space, ident, kind=other) for other in KINDS if other is not kind
        }
        revised = {**data, "name": "Second"}
        repo.write(space, ident, revised, expected_revision=1, actor=ACTOR, kind=kind)
        assert repo.read(space, ident, 1, kind=kind).document == kind.validate(data)
        assert [r.number for r in repo.history(space, ident, kind=kind)] == [1, 2]
        assert repo.diff(space, ident, 1, 2, kind=kind)[0].path == "/name"
        assert git(root, "log", "-1", "--format=%s").strip() == (
            f"{kind.name} {space}/{ident}: save r2"
        )
        for other in KINDS:
            if other is not kind:
                assert repo.history(space, ident, kind=other) == previous[other]
                assert repo.read(space, ident, 1, kind=other).document == other.validate(
                    documents[KINDS.index(other)]
                )
        with pytest.raises(TypeError):
            repo.contents(kind=dataclasses.replace(kind))
        with pytest.raises(ContentError):
            repo.write(
                space,
                ident,
                {**data, "api_version": "wrong"},
                expected_revision=2,
                actor=ACTOR,
                kind=kind,
            )
    assert ANALYSIS_KIND is KINDS[0] and DASHBOARD_KIND is KINDS[1]
