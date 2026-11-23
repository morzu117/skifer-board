"""Approbations : contrat, persistance et concurrence."""

import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator
from skifer_board.content import (
    ANALYSIS_KIND,
    COMPONENT_KIND,
    PAGE_TEMPLATE_KIND,
    THEME_KIND,
    ContentError,
    approvals,
)
from skifer_board.content.repository import Kind, StoredRevision
from skifer_board.spaces.model import PersonRef

from .monde import ACTOR, git, init, new_id, repository
from .test_concurrence import lancer

ROOT = Path(__file__).resolve().parents[4] / "contracts"


def test_fixtures() -> None:
    Draft202012Validator.check_schema(approvals.schema())
    valid = json.loads((ROOT / "approvals/fixtures/valid/base.json").read_text())
    assert approvals.loads(approvals.dumps(valid)) == valid
    bad = json.loads((ROOT / "approvals/fixtures/invalid/duplicate.json").read_text())
    with pytest.raises(ContentError, match="invalid_approvals") as error:
        approvals.validate(bad)
    assert error.value.reason == "not_increasing"
    for path in (ROOT / "approvals/fixtures/invalid").glob("*.json"):
        with pytest.raises(ContentError):
            approvals.validate(json.loads(path.read_text()))


@pytest.mark.parametrize(
    "kind,directory",
    [
        (THEME_KIND, "themes"),
        (PAGE_TEMPLATE_KIND, "page_templates"),
        (COMPONENT_KIND, "components"),
    ],
)
def test_cycle_et_concurrence(tmp_path: Path, kind: Kind, directory: str) -> None:
    root = init(tmp_path / "repo")
    repo = repository(root)
    space, ident = new_id(), new_id()
    data = json.loads(
        (
            ROOT
            / directory
            / "fixtures/valid"
            / ("clair.json" if directory == "themes" else "base.json")
        ).read_text()
    )
    data["id"] = ident
    repo.write(space, ident, data, expected_revision=None, actor=ACTOR, kind=kind)

    def run() -> StoredRevision:
        return repo.approve(space, ident, 1, expected_revision=1, actor=ACTOR, kind=kind)

    results = lancer([run, run])
    assert sum(not isinstance(item, ContentError) for item in results) == 1
    assert [(item.code, item.reason) for item in results if isinstance(item, ContentError)] == [
        ("already_approved", "already_approved")
    ]
    stored = repo.read_approvals(space, ident, kind=kind)
    assert stored.document["kind"] == kind.name
    assert stored.document["approvals"][0]["revision"] == 1
    assert stored.document["approvals"][0]["approver"] == {
        "issuer": ACTOR.issuer,
        "subject": ACTOR.subject,
    }
    assert stored.document["approvals"][0]["approved_at"].endswith("Z")
    assert [r.number for r in repo.approval_history(space, ident, kind=kind)] == [1]
    assert (
        git(root, "show", "--format=", "--name-only", "HEAD").strip()
        == f"approvals/{kind.name}/{space}/{ident}.yaml"
    )
    with pytest.raises(ContentError) as error:
        repo.approve(space, ident, 2, expected_revision=1, actor=ACTOR, kind=kind)
    assert error.value.reason == "missing_revision"
    repo.write(
        space, ident, {**data, "name": "nouveau"}, expected_revision=1, actor=ACTOR, kind=kind
    )
    with pytest.raises(ContentError) as error:
        repo.approve(space, ident, 2, expected_revision=1, actor=ACTOR, kind=kind)
    assert (error.value.code, error.value.reason) == ("revision_conflict", "stale")
    with pytest.raises(ContentError) as bad_actor:
        repo.approve(space, ident, 2, expected_revision=2, actor=PersonRef("", "x"), kind=kind)
    assert (bad_actor.value.code, bad_actor.value.reason) == (kind.invalid, "bad_actor")
    repo.approve(space, ident, 2, expected_revision=2, actor=ACTOR, kind=kind)
    assert [
        a["revision"] for a in repo.read_approvals(space, ident, kind=kind).document["approvals"]
    ] == [1, 2]
    fresh_repo = repository(root)
    reread = fresh_repo.read_approvals(space, ident, kind=kind)
    assert [item["revision"] for item in reread.document["approvals"]] == [1, 2]
    assert reread.revision.number == 2
    assert len(repo.approval_history(space, ident, kind=kind)) == 2
    assert len(repo.read_approvals(space, ident, 1, kind=kind).document["approvals"]) == 1
    with pytest.raises(TypeError):
        repo.approve(space, ident, 1, expected_revision=1, actor=ACTOR, kind=ANALYSIS_KIND)


def test_approbations_concurrentes_de_revisions_distinctes(tmp_path: Path) -> None:
    root = init(tmp_path / "repo")
    repo = repository(root)
    space, ident = new_id(), new_id()
    data = json.loads((ROOT / "themes/fixtures/valid/clair.json").read_text())
    data["id"] = ident
    repo.write(space, ident, data, expected_revision=None, actor=ACTOR, kind=THEME_KIND)
    repo.write(
        space, ident, {**data, "name": "Deux"}, expected_revision=1, actor=ACTOR, kind=THEME_KIND
    )
    results = lancer(
        [
            lambda: repo.approve(
                space, ident, 1, expected_revision=2, actor=ACTOR, kind=THEME_KIND
            ),
            lambda: repo.approve(
                space, ident, 2, expected_revision=2, actor=ACTOR, kind=THEME_KIND
            ),
        ]
    )
    assert all(not isinstance(result, ContentError) for result in results)
    assert [
        entry["revision"]
        for entry in repo.read_approvals(space, ident, kind=THEME_KIND).document["approvals"]
    ] == [1, 2]
    assert len(repo.approval_history(space, ident, kind=THEME_KIND)) == 2


def test_approbation_deux_puis_une_est_triee(tmp_path: Path) -> None:
    root = init(tmp_path / "repo")
    repo = repository(root)
    space, ident = new_id(), new_id()
    data = json.loads((ROOT / "themes/fixtures/valid/clair.json").read_text())
    data["id"] = ident
    repo.write(space, ident, data, expected_revision=None, actor=ACTOR, kind=THEME_KIND)
    repo.write(
        space, ident, {**data, "name": "Deux"}, expected_revision=1, actor=ACTOR, kind=THEME_KIND
    )
    repo.approve(space, ident, 2, expected_revision=2, actor=ACTOR, kind=THEME_KIND)
    repo.approve(space, ident, 1, expected_revision=2, actor=ACTOR, kind=THEME_KIND)
    assert [
        item["revision"]
        for item in repository(root)
        .read_approvals(space, ident, kind=THEME_KIND)
        .document["approvals"]
    ] == [1, 2]


@pytest.mark.parametrize("expected", [0, True, -1, "1"])
def test_approbation_refuse_revision_attendue_malformee(tmp_path: Path, expected: Any) -> None:
    repo = repository(init(tmp_path / "repo"))
    with pytest.raises(ContentError) as error:
        repo.approve(
            "finance", new_id(), 1, expected_revision=expected, actor=ACTOR, kind=THEME_KIND
        )
    assert (error.value.code, error.value.reason) == ("invalid_theme", "bad_revision")


@pytest.mark.parametrize("raw", [b"not: [yaml", b"api_version: board.theme/v1\nid: invalide\n"])
def test_approbation_refuse_revision_stockee_invalide(tmp_path: Path, raw: bytes) -> None:
    from skifer_board.content.repository import _message

    from .monde import commit

    root = init(tmp_path / "repo")
    space, ident = "finance", new_id()
    commit(
        root,
        {f"themes/{space}/{ident}.yaml": raw},
        _message(space, ident, 1, "save", ACTOR, THEME_KIND),
    )
    repo = repository(root)
    with pytest.raises(ContentError) as error:
        repo.approve(space, ident, 1, expected_revision=1, actor=ACTOR, kind=THEME_KIND)
    assert (error.value.code, error.value.reason) == ("content_unavailable", "stored_invalid")
    with pytest.raises(ContentError) as missing:
        repo.read_approvals(space, ident, kind=THEME_KIND)
    assert missing.value.code == "approvals_not_found"
