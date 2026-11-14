"""Index et reconstruction des trois genres du plan 20."""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest
from skifer_board.content import COMPONENT_KIND, PAGE_TEMPLATE_KIND, THEME_KIND
from skifer_board.content.index import AnalysisIndex, DashboardIndex, DashboardRow
from skifer_board.content.reindex import reindex
from skifer_board.content.repository import DASHBOARD_KIND, Kind
from skifer_board.content.shared_consumers import SharedConsumers
from skifer_board.content.shared_index import SharedIndex, SharedRow
from skifer_board.spaces.model import PersonRef
from sqlalchemy import Engine

from .monde import ACTOR, OTHER, init, new_id, repository

ROOT = Path(__file__).resolve().parents[4] / "contracts"


@pytest.mark.parametrize(
    "kind,directory,file",
    [
        (THEME_KIND, "themes", "clair.json"),
        (PAGE_TEMPLATE_KIND, "page_templates", "base.json"),
        (COMPONENT_KIND, "components", "base.json"),
    ],
)
def test_crud_par_genre(
    migre: Engine, tmp_path: Path, kind: Kind, directory: str, file: str
) -> None:
    repo = repository(init(tmp_path / "repo"))
    ident = new_id()
    data = json.loads((ROOT / directory / "fixtures/valid" / file).read_text())
    data["id"] = ident
    stored = repo.write("finance", ident, data, expected_revision=None, actor=ACTOR, kind=kind)
    row = SharedRow.of(kind, "finance", stored)
    index = SharedIndex(migre)
    assert index.get(kind.name, "finance", ident) is None
    index.upsert(row)
    assert index.get(kind.name, "finance", ident) == row
    assert index.rows(kind.name, "finance") == [row]
    assert index.rows(kind.name, "autre") == []
    for other in ("theme", "page_template", "component"):
        if other != kind.name:
            assert index.rows(other, "finance") == []
    index.upsert(replace(row, revision=2, name="Deux"))
    index.upsert(row)
    assert index.get(kind.name, "finance", ident) == replace(row, revision=2, name="Deux")
    index.remove(kind.name, "finance", ident, 1)
    assert index.get(kind.name, "finance", ident) is not None
    index.remove(kind.name, "finance", ident, 2)
    assert index.get(kind.name, "finance", ident) is None
    assert index.approvals(kind.name, "finance", ident) == []


def test_reindexation_approbations_et_idempotence(migre: Engine, tmp_path: Path) -> None:
    repo = repository(init(tmp_path / "repo"))
    shared = SharedIndex(migre)
    index, boards = AnalysisIndex(migre), DashboardIndex(migre)
    ids = []
    for kind, directory, filename in (
        (THEME_KIND, "themes", "clair.json"),
        (PAGE_TEMPLATE_KIND, "page_templates", "base.json"),
        (COMPONENT_KIND, "components", "base.json"),
    ):
        data = json.loads((ROOT / directory / "fixtures/valid" / filename).read_text())
        ident = new_id()
        ids.append((kind, ident))
        data["id"] = ident
        repo.write("finance", ident, data, expected_revision=None, actor=ACTOR, kind=kind)
        repo.approve("finance", ident, 1, expected_revision=1, actor=OTHER, kind=kind)
    report = reindex(repo, index, boards)
    assert report.shared == 3
    for kind, ident in ids:
        found = shared.get(kind.name, "finance", ident)
        assert found is not None and found.approved_revision == 1
        approval = shared.approvals(kind.name, "finance", ident)
        assert len(approval) == 1 and approval[0].revision == 1 and approval[0].approver == OTHER
    assert reindex(repo, index, boards) == report
    shared.remove("theme", "finance", ids[0][1], 0)
    assert len(shared.approvals("theme", "finance", ids[0][1])) == 1
    shared.remove("theme", "finance", ids[0][1], 1)
    assert shared.approvals("theme", "finance", ids[0][1]) == []
    assert reindex(repo, index, boards) == report
    repo.delete("finance", ids[0][1], expected_revision=1, actor=ACTOR, kind=ids[0][0])
    assert reindex(repo, index, boards).shared == 2
    assert shared.get("theme", "finance", ids[0][1]) is None
    assert shared.approvals("theme", "finance", ids[0][1]) == []


def test_consommateurs_visibles_et_masques(migre: Engine, tmp_path: Path) -> None:
    repo = repository(init(tmp_path / "repo"))
    index = DashboardIndex(migre)
    original = json.loads((ROOT / "dashboards/fixtures/extensions/valid.json").read_text())
    theme = original["theme"]
    component = original["layout"]["sections"][0]["rows"][0]["columns"][0]["children"][0][
        "component"
    ]
    ids = []
    for owner, visibility in ((ACTOR, "personal"), (OTHER, "personal"), (OTHER, "shared")):
        data = json.loads(json.dumps(original))
        data["id"] = new_id()
        data["owner"] = {"issuer": owner.issuer, "subject": owner.subject}
        data["visibility"] = visibility
        stored = repo.write(
            "finance", data["id"], data, expected_revision=None, actor=owner, kind=DASHBOARD_KIND
        )
        index.upsert(DashboardRow.of("finance", stored))
        ids.append(data["id"])
    consumer = SharedConsumers(repo, index)
    for kind, pin in (
        ("theme", (theme["theme_id"], theme["revision"])),
        ("component", (component["component_id"], component["revision"])),
    ):
        found = consumer("finance", kind, pin[0], pin[1], ACTOR, repo.head())
        assert {item.id for item in found.visible} == {ids[0], ids[2]}
        assert found.others == 1
        assert not consumer("finance", kind, pin[0], pin[1] + 1, ACTOR, repo.head())
    other = consumer(
        "finance", "theme", theme["theme_id"], theme["revision"], PersonRef("x", "y"), repo.head()
    )
    assert [item.id for item in other.visible] == [ids[2]]
    assert other.others == 2


def test_isolation_des_trois_genres(migre: Engine, tmp_path: Path) -> None:
    repo = repository(init(tmp_path / "repo"))
    index = SharedIndex(migre)
    rows = []
    for kind, directory, filename in (
        (THEME_KIND, "themes", "clair.json"),
        (PAGE_TEMPLATE_KIND, "page_templates", "base.json"),
        (COMPONENT_KIND, "components", "base.json"),
    ):
        data = json.loads((ROOT / directory / "fixtures/valid" / filename).read_text())
        data["id"] = new_id()
        rows.append(
            SharedRow.of(
                kind,
                "finance",
                repo.write(
                    "finance", data["id"], data, expected_revision=None, actor=ACTOR, kind=kind
                ),
            )
        )
    for row in rows:
        index.upsert(row)
    index.upsert(replace(rows[0], name="révisé", revision=2))
    assert index.get(rows[1].kind, "finance", rows[1].content_id) == rows[1]
    assert index.get(rows[2].kind, "finance", rows[2].content_id) == rows[2]
    with pytest.raises(TypeError):
        SharedRow.of(
            DASHBOARD_KIND, "finance", repo.read("finance", rows[0].content_id, kind=THEME_KIND)
        )


def test_consommateurs_relisent_index_perime_et_refusent_pannes(
    migre: Engine, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from skifer_board.content import ContentError
    from skifer_board.content.repository import ContentRepository
    from sqlalchemy.exc import SQLAlchemyError

    repo = repository(init(tmp_path / "repo"))
    index = DashboardIndex(migre)
    data = json.loads((ROOT / "dashboards/fixtures/extensions/valid.json").read_text())
    data["id"] = new_id()
    data["visibility"] = "shared"
    stored = repo.write(
        "finance", data["id"], data, expected_revision=None, actor=ACTOR, kind=DASHBOARD_KIND
    )
    theme = data["theme"]
    component = data["layout"]["sections"][0]["rows"][0]["columns"][0]["children"][0]["component"]
    consumers = SharedConsumers(repo, index)
    for kind, ident, revision in [
        ("theme", theme["theme_id"], 1),
        ("component", component["component_id"], 1),
    ]:
        assert [
            x.id for x in consumers("finance", kind, ident, revision, ACTOR, repo.head()).visible
        ] == [data["id"]]
        assert not consumers("finance", kind, ident, revision + 1, ACTOR, repo.head())
    index.upsert(DashboardRow.of("finance", stored))
    with pytest.raises(ValueError):
        consumers("finance", "page_template", new_id(), 1, ACTOR, repo.head())
    with pytest.raises(ContentError, match="content_unavailable"):
        SharedConsumers(None, index)("finance", "theme", new_id(), 1, ACTOR, None)
    with monkeypatch.context() as patch:
        patch.setattr(index, "rows", lambda _: (_ for _ in ()).throw(SQLAlchemyError()))
        with pytest.raises(ContentError) as error:
            consumers("finance", "theme", theme["theme_id"], 1, ACTOR, repo.head())
        assert error.value.reason == "index_unavailable"
    # Forcer la relecture en retirant l'index ; absence, dommage et panne restent distincts.
    index.remove("finance", data["id"], 1)
    for code, reason, expected in [
        ("dashboard_not_found", "missing", 0),
        ("content_unavailable", "stored_invalid", 1),
    ]:
        with monkeypatch.context() as patch:

            def fail(
                *args: object, _code: str = code, _reason: str = reason, **kwargs: object
            ) -> object:
                raise ContentError(_code, _reason)

            patch.setattr(ContentRepository, "read", fail)
            assert (
                consumers("finance", "theme", theme["theme_id"], 1, ACTOR, repo.head()).others
                == expected
            )
    with monkeypatch.context() as patch:

        def unavailable(*args: object, **kwargs: object) -> object:
            raise ContentError("content_unavailable", "git_failed")

        patch.setattr(ContentRepository, "read", unavailable)
        with pytest.raises(ContentError) as error:
            consumers("finance", "theme", theme["theme_id"], 1, ACTOR, repo.head())
        assert error.value.reason == "git_failed"


def test_reindex_approbations_absentes_et_endommagees(
    migre: Engine, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from skifer_board.content import ContentError
    from skifer_board.content.repository import ContentRepository

    repo = repository(init(tmp_path / "repo"))
    data = json.loads((ROOT / "themes/fixtures/valid/clair.json").read_text())
    data["id"] = new_id()
    repo.write("finance", data["id"], data, expected_revision=None, actor=ACTOR, kind=THEME_KIND)
    index, boards = AnalysisIndex(migre), DashboardIndex(migre)
    assert reindex(repo, index, boards).shared == 1
    row = SharedIndex(migre).get("theme", "finance", data["id"])
    assert row is not None and row.approved_revision is None
    with monkeypatch.context() as patch:

        def bad_approval(*args: object, **kwargs: object) -> object:
            raise ContentError("content_unavailable", "stored_invalid")

        patch.setattr(ContentRepository, "read_approvals", bad_approval)
        report = reindex(repo, index, boards)
        assert report.shared == 0
        assert report.shared_unreadable == (("finance", data["id"], "stored_invalid"),)
    with monkeypatch.context() as patch:

        def fail(*args: object, **kwargs: object) -> object:
            raise ContentError("content_unavailable", "git_failed")

        patch.setattr(ContentRepository, "read_approvals", fail)
        with pytest.raises(ContentError) as error:
            reindex(repo, index, boards)
        assert error.value.reason == "git_failed"
    with monkeypatch.context() as patch:
        original = ContentRepository.read

        def disappeared(self: ContentRepository, *args: object, **kwargs: object) -> object:
            if kwargs.get("kind") is THEME_KIND:
                raise ContentError("theme_not_found", "missing")
            return original(self, *args, **kwargs)  # type: ignore[arg-type]

        patch.setattr(ContentRepository, "read", disappeared)
        assert reindex(repo, index, boards).shared == 0


def test_commande_rapporte_contenu_illisible_et_indexe_les_autres(
    database_url: object, migre: Engine, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    from sqlalchemy.engine import URL

    from .monde import commit
    from .test_reindex import environ, lancer

    assert isinstance(database_url, URL)
    root = init(tmp_path / "repo")
    repo = repository(root)
    data = json.loads((ROOT / "themes/fixtures/valid/clair.json").read_text())
    good, bad = new_id(), new_id()
    for ident in (good, bad):
        data["id"] = ident
        repo.write("finance", ident, data, expected_revision=None, actor=ACTOR, kind=THEME_KIND)
    commit(root, {f"themes/finance/{bad}.yaml": b"invalid: x\n"}, "intrus")
    code, out, err = lancer(environ(database_url, root), capsys)
    assert code == 1
    assert "1 contenu(s) partagé(s) indexé(s)." in out
    assert f"Illisible : contenu finance/{bad} (history_inconsistent)." in err
    assert SharedIndex(migre).get("theme", "finance", good) is not None


def test_reindex_echec_n_ecrit_aucun_index(
    migre: Engine, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = repository(init(tmp_path / "repo"))
    data = json.loads((ROOT / "themes/fixtures/valid/clair.json").read_text())
    data["id"] = new_id()
    repo.write("finance", data["id"], data, expected_revision=None, actor=ACTOR, kind=THEME_KIND)
    analyses, dashboards, shared = AnalysisIndex(migre), DashboardIndex(migre), SharedIndex(migre)
    reindex(repo, analyses, dashboards)
    before = shared.get("theme", "finance", data["id"])
    repo.write(
        "finance",
        data["id"],
        {**data, "name": "Deux"},
        expected_revision=1,
        actor=ACTOR,
        kind=THEME_KIND,
    )

    def fail(*args: object, **kwargs: object) -> None:
        raise RuntimeError("échec")

    monkeypatch.setattr(SharedIndex, "replace_in", fail)
    with pytest.raises(RuntimeError):
        reindex(repo, analyses, dashboards)
    assert shared.get("theme", "finance", data["id"]) == before
