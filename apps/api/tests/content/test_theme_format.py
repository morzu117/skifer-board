"""Contrat du thème, validations sémantiques et intégration au dépôt."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator
from skifer_board.content import THEME_KIND, ContentError, theme, token_catalog
from skifer_board.content.common import Change

from .monde import ACTOR, init, new_id, repository

ROOT = Path(__file__).resolve().parents[4] / "contracts/themes"
VALID = ROOT / "fixtures/valid/clair.json"


def sample() -> dict[str, Any]:
    return json.loads(VALID.read_text())  # type: ignore[no-any-return]


def test_schema_et_fixtures() -> None:
    schema = theme.schema()
    Draft202012Validator.check_schema(schema)
    assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"

    def check_closed(value: Any) -> None:
        if isinstance(value, dict):
            if value.get("type") == "object":
                assert value.get("additionalProperties") is False
            for child in value.values():
                check_closed(child)
        elif isinstance(value, list):
            for child in value:
                check_closed(child)

    check_closed(schema)
    for path in sorted((ROOT / "fixtures/valid").glob("*.json")):
        data = json.loads(path.read_text())
        assert theme.validate(data) == data
    for path in sorted((ROOT / "fixtures/invalid").glob("*.json")):
        with pytest.raises(ContentError) as error:
            theme.validate(json.loads(path.read_text()))
        assert error.value.code == "invalid_theme", path.name


@pytest.mark.parametrize(
    "name,rule",
    [
        ("mark_contrast", "token_not_admissible"),
        ("text_contrast", "token_not_admissible"),
        ("categorical_contrast", "token_not_admissible"),
        ("sequential_contrast", "token_not_admissible"),
        ("diverging_contrast", "token_not_admissible"),
        ("categorical_duplicate", "duplicate_item"),
        ("categorical_short", "out_of_bounds"),
        ("categorical_long", "out_of_bounds"),
        ("sequential_short", "out_of_bounds"),
        ("sequential_long", "out_of_bounds"),
        ("sequential_order", "not_monotone"),
        ("diverging_sides", "diverging_sides"),
        ("categorical_same_color", "duplicate_color"),
        ("sequential_equal", "not_monotone"),
        ("diverging_even", "even_diverging"),
        ("diverging_center", "non_neutral"),
        ("diverging_order", "not_monotone"),
        ("diverging_short", "out_of_bounds"),
        ("diverging_long", "out_of_bounds"),
        ("hex", "hex_color"),
    ],
)
def test_regles(name: str, rule: str) -> None:
    data = json.loads((ROOT / f"fixtures/invalid/{name}.json").read_text())
    with pytest.raises(ContentError) as error:
        theme.validate(data)
    assert rule in {v.rule for v in error.value.violations}
    assert error.value.reason == error.value.violations[0].rule


def test_sentinelle_hex_partout() -> None:
    data = sample()
    paths: list[tuple[Any, Any]] = []

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                if isinstance(child, str):
                    paths.append((value, key))
                else:
                    visit(child)
        elif isinstance(value, list):
            for i, child in enumerate(value):
                if isinstance(child, str):
                    paths.append((value, i))
                else:
                    visit(child)

    visit(data)
    validator = theme._validator()
    for parent, key in paths:
        original = parent[key]
        parent[key] = "#123aBc"
        with pytest.raises(ContentError):
            theme.validate(data)
        assert not validator.is_valid(data)
        parent[key] = original


def test_bornes_et_bases() -> None:
    data = sample()
    names = ["ink", "slate900", "slate700", "danger.fg", "ink2", "success.fg", "blue", "copper"]
    for n in (2, 8):
        data["categorical"] = names[:n]
        theme.validate(data)
    for n in (3, 7):
        data["sequential"] = [
            "seriesMuted",
            "seriesEdge",
            "copper",
            "blue",
            "link",
            "danger.fg",
            "slate900",
        ][:n]
        theme.validate(data)
    for palette in (
        ["blue", "neutral.bg", "copper"],
        ["ink", "blue", "neutral.bg", "blue", "ink"],
        ["ink", "blue", "seriesMuted", "neutral.bg", "copper", "blue", "ink"],
    ):
        data["diverging"] = palette
        theme.validate(data)
    data = sample()
    data["base"] = "skifer-ardoise"
    data["roles"]["marks"] = dict.fromkeys(data["roles"]["marks"], "onSlate")
    data["roles"]["text"] = dict.fromkeys(data["roles"]["text"], "onSlate")
    data["categorical"] = ["onSlate", "surface"]
    data["sequential"] = ["seriesEdge", "onSlate", "surface"]
    data["diverging"] = ["onSlate", "neutral.fg", "line"]
    theme.validate(data)
    data["sequential"] = list(reversed(data["sequential"]))
    with pytest.raises(ContentError) as error:
        theme.validate(data)
    assert any(v.rule == "not_monotone" and v.path == "/sequential" for v in error.value.violations)


def test_canonique_diff_et_depot(tmp_path: Path) -> None:
    data = sample()
    data["id"] = new_id()
    raw = theme.dumps(data)
    assert theme.loads(raw) == data
    assert theme.dumps(dict(reversed(list(data.items())))) == raw
    assert theme.brief(raw) == (
        data["owner"]["issuer"],
        data["owner"]["subject"],
        "personal",
        data["id"],
    )
    changed = copy.deepcopy(data)
    changed["roles"]["marks"]["series"] = "copper"
    assert theme.diff(data, changed) == (
        Change("/roles/marks/series", "modified", "blue", "copper"),
    )
    repo = repository(init(tmp_path / "repo"))
    space = new_id()
    repo.write(space, data["id"], data, expected_revision=None, actor=ACTOR, kind=THEME_KIND)
    repo.write(space, data["id"], changed, expected_revision=1, actor=ACTOR, kind=THEME_KIND)
    assert repo.read(space, data["id"], kind=THEME_KIND).document == changed
    assert repo.diff(space, data["id"], 1, 2, kind=THEME_KIND) == theme.diff(data, changed)


def test_neutres_et_couleurs_par_valeur() -> None:
    assert theme.NEUTRAL == frozenset({"neutral.fg", "neutral.bg"})
    for file, rule, path in (
        ("diverging_sides", "diverging_sides", "/diverging"),
        ("categorical_same_color", "duplicate_color", "/categorical"),
        ("sequential_equal", "not_monotone", "/sequential"),
    ):
        with pytest.raises(ContentError) as error:
            theme.validate(json.loads((ROOT / f"fixtures/invalid/{file}.json").read_text()))
        assert (path, rule) in {(v.path, v.rule) for v in error.value.violations}


def test_contraste_pas_minimum_partage() -> None:
    import re

    root = ROOT.parents[1]
    web = (root / "apps/web/src/themes/chartTheme.ts").read_text()
    match = re.search(r"export const MIN_STEP_RATIO = ([0-9.]+);", web)
    assert match is not None
    assert float(match.group(1)) == theme.MIN_STEP_RATIO == 1.1
    assert theme._increasing([1, 1.1])
    assert theme._increasing([1, 1.100001])
    assert not theme._increasing([1, 1.099999])
    assert not theme._increasing([1, 1])


def test_enumerations_reference_dashboard() -> None:
    for key in ("legend", "number_format", "tooltip"):
        assert theme.schema()["$defs"][key] == {
            "$ref": f"https://skifer-board.dev/schema/dashboard.v1.json#/$defs/{key}"
        }


def test_couleur_categorielle_ignore_la_casse_hex(monkeypatch: pytest.MonkeyPatch) -> None:
    tokens = copy.deepcopy(theme._json(token_catalog.TOKENS))
    tokens["color"]["ink"] = "#aBcDeF"
    tokens["color"]["ink2"] = "#AbCdEf"
    original = theme._json

    def catalog(path: Path) -> dict[str, Any]:
        return tokens if path == token_catalog.TOKENS else original(path)

    monkeypatch.setattr(theme, "_json", catalog)
    data = sample()
    data["categorical"] = ["ink", "ink2"]
    with pytest.raises(ContentError) as error:
        theme.validate(data)
    assert (error.value.code, error.value.reason) == ("invalid_theme", "duplicate_color")
    assert [(v.path, v.rule) for v in error.value.violations] == [
        ("/categorical", "duplicate_color")
    ]


@pytest.mark.parametrize(
    "name,path,rule",
    [
        ("sequential_last_under", "/sequential/2", "token_not_admissible"),
        ("sequential_contrast_order", "/sequential", "not_monotone"),
        ("diverging_endpoint_under", "/diverging/0", "token_not_admissible"),
        ("palette_unknown", "/sequential/1", "token_not_admissible"),
        ("diverging_unknown", "/diverging/0", "token_not_admissible"),
        ("sequential_equal", "/sequential", "not_monotone"),
        ("sequential_small_step", "/sequential", "not_monotone"),
        ("diverging_wing_equal", "/diverging", "not_monotone"),
        ("diverging_center_equal", "/diverging", "diverging_sides"),
    ],
)
def test_regles_contraste_palette(name: str, path: str, rule: str) -> None:
    data = json.loads((ROOT / f"fixtures/invalid/{name}.json").read_text())
    with pytest.raises(ContentError) as error:
        theme.validate(data)
    assert (path, rule) in {
        (violation.path, violation.rule) for violation in error.value.violations
    }


@pytest.mark.parametrize("palette,index", [("sequential", 1), ("diverging", 0)])
def test_semantique_ignore_la_monotonie_si_token_inconnu(palette: str, index: int) -> None:
    data = sample()
    data[palette][index] = "token_inconnu"

    violations = theme._semantic(data)

    assert [(item.path, item.rule) for item in violations] == [
        (f"/{palette}/{index}", "token_not_admissible")
    ]
    assert not {"not_monotone", "diverging_sides"} & {item.rule for item in violations}


def test_parite_web_palettes_a_jour() -> None:
    published = json.loads((ROOT / "fixtures/palette-parity.json").read_text())
    assert set(published) == {path.stem for path in (ROOT / "fixtures/invalid").glob("*.json")}
    for name, expected in published.items():
        data = json.loads((ROOT / f"fixtures/invalid/{name}.json").read_text())
        with pytest.raises(ContentError) as error:
            theme.validate(data)
        assert [{"path": v.path, "rule": v.rule} for v in error.value.violations] == expected, name
