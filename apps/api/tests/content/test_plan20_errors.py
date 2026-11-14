"""Refus et pannes de lecture des formats du plan 20."""

from __future__ import annotations

import copy
import json
import runpy
import sys
from pathlib import Path
from typing import Any

import pytest
from skifer_board.content import THEME_KIND, ContentError, approvals, theme, token_catalog
from skifer_board.content import repository as repository_module
from skifer_board.content.composition import dependency_closure, extract_template
from skifer_board.content.structured_format import COMPONENT, PAGE_TEMPLATE, StructuredFormat
from skifer_board.spaces.model import PersonRef

from .monde import ACTOR, init, new_id, repository
from .test_composition_plan20 import make

ROOT = Path(__file__).resolve().parents[4] / "contracts"


def test_fichiers_indisponibles(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    approvals.schema.cache_clear()
    monkeypatch.setattr(approvals, "SCHEMA_PATH", tmp_path / "missing")
    with pytest.raises(ContentError, match="content_unavailable"):
        approvals.schema()
    approvals.schema.cache_clear()
    fmt = StructuredFormat("missing", "missing", "kind")
    with pytest.raises(ContentError, match="content_unavailable"):
        _ = fmt.schema
    with pytest.raises(ContentError, match="content_unavailable"):
        theme._json(tmp_path / "missing")


def test_refus_lecture_et_structure(monkeypatch: pytest.MonkeyPatch) -> None:
    for fmt in (PAGE_TEMPLATE, COMPONENT):
        for raw in (b"\xff", b"["):
            with pytest.raises(ContentError):
                fmt.loads(raw)
        for raw in (b"aucun marqueur", b"bad: x\n" + (fmt.marker + ":\n").encode()):
            with pytest.raises(ContentError):
                fmt.brief(raw)
        with pytest.raises(ContentError):
            fmt.validate({"bad": float("nan")})
    for raw in (b"\xff", b"["):
        with pytest.raises(ContentError):
            approvals.loads(raw)
        with pytest.raises(ContentError):
            theme.loads(raw)
    for raw in (b"aucun marqueur", b"bad: x\nbase:\n"):
        with pytest.raises(ContentError):
            theme.brief(raw)
    with pytest.raises(ContentError):
        approvals.validate({"bad": float("nan")})
    with pytest.raises(ContentError):
        theme.validate({"bad": float("nan")})
    with pytest.raises(ContentError):
        theme.validate({"bad": 42})
    data = json.loads((ROOT / "approvals/fixtures/valid/base.json").read_text())
    assert approvals.diff(data, {**data, "kind": "component"})
    # Un aller-retour YAML divergent est fermé, même si le sérialiseur est défectueux.
    monkeypatch.setattr(approvals, "loads", lambda raw: {})
    with pytest.raises(ContentError, match="invalid_approvals"):
        approvals.dumps(data)
    monkeypatch.setattr(theme, "loads", lambda raw: {})
    theme_data = json.loads((ROOT / "themes/fixtures/valid/clair.json").read_text())
    with pytest.raises(ContentError, match="invalid_theme"):
        theme.dumps(theme_data)
    with monkeypatch.context() as patch:
        patch.setattr(COMPONENT, "loads", lambda raw: {})
        document = json.loads((ROOT / "components/fixtures/valid/base.json").read_text())
        with pytest.raises(ContentError, match="invalid_component"):
            COMPONENT.dumps(document)


def test_generateur(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source = token_catalog.TOKENS
    target = tmp_path / "tokens.json"
    monkeypatch.setattr(token_catalog, "CONTRACT", target)
    token_catalog.main()
    assert json.loads(target.read_text()) == token_catalog.catalog(json.loads(source.read_text()))
    # Intercepter tout accès en écriture, y compris celui du module exécuté par runpy.
    writes: list[tuple[Path, str]] = []
    directories: list[Path] = []

    def capture(path: Path, text: str, **kwargs: Any) -> int:
        writes.append((path, text))
        return len(text)

    def capture_mkdir(path: Path, **kwargs: Any) -> None:
        directories.append(path)

    with monkeypatch.context() as patch:
        patch.delitem(sys.modules, "skifer_board.content.token_catalog", raising=False)
        patch.setattr(Path, "mkdir", capture_mkdir)
        patch.setattr(Path, "write_text", capture)
        runpy.run_module("skifer_board.content.token_catalog", run_name="__main__")
    assert directories == [source.parents[2] / "contracts/themes"]
    assert writes == [
        (
            source.parents[2] / "contracts/themes/tokens.v1.json",
            json.dumps(
                token_catalog.catalog(json.loads(source.read_text())),
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
            + "\n",
        )
    ]


def test_contenus_non_executables_dans_composition() -> None:
    source, components, _, _ = make()
    data = copy.deepcopy(source)
    children = data["layout"]["sections"][0]["rows"][0]["columns"][0]["children"]
    children.append({"id": new_id(), "type": "separator"})
    assert extract_template(data, new_id(), components)["layout"]["sections"]
    assert dependency_closure(data, components).analyses


def test_approbations_refus_et_historique(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = repository(init(tmp_path / "repo"))
    space, ident = new_id(), new_id()
    for action in (
        lambda: repo.read_approvals(space, ident, kind=THEME_KIND),
        lambda: repo.approval_history(space, ident, kind=THEME_KIND),
    ):
        with pytest.raises(ContentError, match="approvals_not_found"):
            action()
    data: dict[str, Any] = json.loads((ROOT / "themes/fixtures/valid/clair.json").read_text())
    data["id"] = ident
    repo.write(space, ident, data, expected_revision=None, actor=ACTOR, kind=THEME_KIND)
    with pytest.raises(ContentError):
        repo.approve(
            space, ident, 1, expected_revision=1, actor=PersonRef("", "x"), kind=THEME_KIND
        )
    with monkeypatch.context() as patch:
        patch.setattr(
            approvals, "dumps", lambda data: b"x" * (repository_module.MAX_DOCUMENT_BYTES + 1)
        )
        with pytest.raises(ContentError):
            repo.approve(space, ident, 1, expected_revision=1, actor=ACTOR, kind=THEME_KIND)
    repo.approve(space, ident, 1, expected_revision=1, actor=ACTOR, kind=THEME_KIND)
    with pytest.raises(ContentError, match="approvals_not_found"):
        repo.read_approvals(space, ident, 2, kind=THEME_KIND)
    # Un fichier d'un genre copié dans le chemin d'un autre ne devient pas une approbation valide.
    invalid = {
        "api_version": "board.approvals/v1",
        "kind": "component",
        "id": ident,
        "approvals": [],
    }
    with pytest.raises(ContentError, match="invalid_approvals"):
        repository_module._THEME_APPROVAL.loads(approvals.dumps(invalid))


@pytest.mark.parametrize("max_depth", [8, 48])
def test_profondeur_plain_limite(max_depth: int) -> None:
    from skifer_board.content.common import plain

    value: Any = {}
    for _ in range(max_depth):
        value = {"x": value}
    assert plain(value, max_depth) == []
    value = {"x": value}
    assert any(v.rule == "out_of_bounds" for v in plain(value, max_depth))


def test_codes_fermes() -> None:
    from skifer_board.content import errors

    assert errors.THEME_CODES == {"invalid_theme", "theme_not_found"}
    assert errors.PAGE_TEMPLATE_CODES == {"invalid_page_template", "page_template_not_found"}
    assert errors.COMPONENT_CODES == {"invalid_component", "component_not_found"}
    assert errors.APPROVAL_CODES == {"already_approved", "invalid_approvals", "approvals_not_found"}
    assert errors.THEME_RULES == {
        "token_not_admissible",
        "not_monotone",
        "even_diverging",
        "non_neutral",
        "hex_color",
        "diverging_sides",
        "duplicate_color",
    }


@pytest.mark.parametrize(
    "format_name,limit", [("approvals", 8), ("theme", 48), ("template", 48), ("component", 48)]
)
def test_limite_plain_des_formats(format_name: str, limit: int) -> None:
    validate = {
        "approvals": approvals.validate,
        "theme": theme.validate,
        "template": PAGE_TEMPLATE.validate,
        "component": COMPONENT.validate,
    }[format_name]

    def nested(depth: int) -> dict[str, Any]:
        value: dict[str, Any] = {}
        for _ in range(depth):
            value = {"x": value}
        return value

    with pytest.raises(ContentError) as at_limit:
        validate(nested(limit))
    assert all(v.rule != "out_of_bounds" for v in at_limit.value.violations)
    with pytest.raises(ContentError) as beyond:
        validate(nested(limit + 1))
    assert any(v.rule == "out_of_bounds" for v in beyond.value.violations)
