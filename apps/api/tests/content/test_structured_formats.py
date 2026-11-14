"""Modèles et composants : contrats, bornes, diff et dépôt."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator
from skifer_board.content import COMPONENT_KIND, PAGE_TEMPLATE_KIND, ContentError, dashboard
from skifer_board.content.common import Change
from skifer_board.content.structured_format import COMPONENT, PAGE_TEMPLATE, StructuredFormat

from .monde import ACTOR, init, new_id, repository
from .monde_dashboard import column, container, row, section

ROOT = Path(__file__).resolve().parents[4] / "contracts"


def example(fmt: StructuredFormat) -> dict[str, Any]:
    data: dict[str, Any] = json.loads(
        (ROOT / fmt.directory / "fixtures/valid/base.json").read_text()
    )
    return data


@pytest.mark.parametrize("fmt", [PAGE_TEMPLATE, COMPONENT])
def test_contrat_et_fixtures(fmt: StructuredFormat) -> None:
    Draft202012Validator.check_schema(fmt.schema)
    assert fmt.schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    for path in (ROOT / fmt.directory / "fixtures/valid").glob("*.json"):
        data = json.loads(path.read_text())
        assert fmt.validate(data) == data
    for path in (ROOT / fmt.directory / "fixtures/invalid").glob("*.json"):
        with pytest.raises(ContentError) as error:
            fmt.validate(json.loads(path.read_text()))
        assert error.value.code == f"invalid_{fmt.name}", path


@pytest.mark.parametrize("fmt", [PAGE_TEMPLATE, COMPONENT])
def test_sentinelle_champs_interdits(fmt: StructuredFormat) -> None:
    data = example(fmt)

    def scan(value: Any) -> None:
        if isinstance(value, dict):
            for key in ("sql", "query", "request"):
                clone = copy.deepcopy(data)
                # Muter l'objet visé en place puis le restaurer, pour parcourir tous les niveaux.
                value[key] = "SELECT 1"
                with pytest.raises(ContentError):
                    fmt.validate(data)
                del value[key]
                assert data == clone
            for child in list(value.values()):
                scan(child)
        elif isinstance(value, list):
            for child in value:
                scan(child)

    scan(data)


def slot() -> dict[str, Any]:
    return {"id": new_id(), "type": "slot", "expected": "kpi", "label": "KPI"}


def test_modeles_bornes_et_regles_structurelles() -> None:
    data = example(PAGE_TEMPLATE)

    def set_rows(rows: list[dict[str, Any]]) -> None:
        data["layout"]["sections"] = [section(*rows)]

    children = [slot() for _ in range(dashboard.MAX_COMPONENTS + 1)]

    def rows(n: int) -> list[dict[str, Any]]:
        return [
            row(*(column(child, span=1) for child in children[i : min(i + 12, n)]))
            for i in range(0, n, 12)
        ]

    set_rows(rows(64))
    PAGE_TEMPLATE.validate(data)
    set_rows(rows(65))
    with pytest.raises(ContentError) as err:
        PAGE_TEMPLATE.validate(data)
    assert any(v.rule == "out_of_bounds" for v in err.value.violations)
    set_rows([row(column(container(row(column(container(row(column(slot()))))))))])
    PAGE_TEMPLATE.validate(data)
    set_rows(
        [
            row(
                column(
                    container(row(column(container(row(column(container(row(column(slot())))))))))
                )
            )
        ]
    )
    with pytest.raises(ContentError) as err:
        PAGE_TEMPLATE.validate(data)
    assert any(v.rule == "too_deep" for v in err.value.violations)
    set_rows([row(column(slot(), span=6), column(slot(), span=6))])
    PAGE_TEMPLATE.validate(data)
    data["layout"]["sections"][0]["rows"][0]["columns"][1]["span"] = 7
    with pytest.raises(ContentError) as err:
        PAGE_TEMPLATE.validate(data)
    assert any(v.rule == "row_overflow" for v in err.value.violations)
    data = example(PAGE_TEMPLATE)
    data["filters"][0]["default"] = "est"
    data["filters"][0]["allowed"] = ["ouest"]
    with pytest.raises(ContentError) as err:
        PAGE_TEMPLATE.validate(data)
    assert any(v.rule == "default_not_allowed" for v in err.value.violations)


def test_composant_genre_et_revision() -> None:
    data = example(COMPONENT)
    for revision in (1, 999_999_999):
        data["analysis"]["revision"] = revision
        COMPONENT.validate(data)
    for bad_revision in (0, 1_000_000_000, 1.0):
        data["analysis"]["revision"] = bad_revision
        with pytest.raises(ContentError):
            COMPONENT.validate(data)
    data["analysis"]["revision"] = 1
    data["kind"] = "kpi"
    data["presentation"] = {"number_format": "integer"}
    COMPONENT.validate(data)
    data["presentation"]["chart"] = "bars"
    with pytest.raises(ContentError):
        COMPONENT.validate(data)


@pytest.mark.parametrize(
    "fmt,kind", [(PAGE_TEMPLATE, PAGE_TEMPLATE_KIND), (COMPONENT, COMPONENT_KIND)]
)
def test_canonique_diff_et_depot(tmp_path: Path, fmt: StructuredFormat, kind: Any) -> None:
    data = example(fmt)
    data["id"] = new_id()
    raw = fmt.dumps(data)
    assert fmt.loads(raw) == data
    assert fmt.dumps(dict(reversed(list(data.items())))) == raw
    assert fmt.brief(raw) == (
        data["owner"]["issuer"],
        data["owner"]["subject"],
        "personal",
        data["id"],
    )
    changed = {**data, "name": "Second"}
    assert fmt.diff(data, changed) == (Change("/name", "modified", "Exemple", "Second"),)
    repo = repository(init(tmp_path / "repo"))
    space = new_id()
    repo.write(space, data["id"], data, expected_revision=None, actor=ACTOR, kind=kind)
    repo.write(space, data["id"], changed, expected_revision=1, actor=ACTOR, kind=kind)
    assert repo.read(space, data["id"], kind=kind).document == changed
    assert repo.diff(space, data["id"], 1, 2, kind=kind) == fmt.diff(data, changed)


def test_bornes_noeuds_texte_et_filtres() -> None:
    data = example(PAGE_TEMPLATE)

    def many_rows() -> list[dict[str, Any]]:
        return [row(*(column(span=1) for _ in range(12))) for _ in range(23)]

    data["layout"]["sections"] = [section(*many_rows()), section(*many_rows())]
    PAGE_TEMPLATE.validate(data)  # deux sections et 46 × (une rangée + 12 colonnes) = 600
    data["layout"]["sections"][1]["rows"].append(row())
    with pytest.raises(ContentError) as err:
        PAGE_TEMPLATE.validate(data)
    assert any(v.rule == "out_of_bounds" for v in err.value.violations)
    text: dict[str, Any] = {
        "id": new_id(),
        "type": "text",
        "blocks": [{"type": "paragraph", "content": [{"text": "x" * 1000} for _ in range(5)]}],
    }
    data["layout"]["sections"] = [section(row(column(text)))]
    PAGE_TEMPLATE.validate(data)
    text["blocks"][0]["content"].append({"text": "x"})
    with pytest.raises(ContentError) as err:
        PAGE_TEMPLATE.validate(data)
    assert any(v.rule == "out_of_bounds" for v in err.value.violations)
    data = example(PAGE_TEMPLATE)
    original = data["filters"][0]
    data["filters"] = [{**original, "id": new_id()} for _ in range(32)]
    PAGE_TEMPLATE.validate(data)
    data["filters"].append({**original, "id": new_id()})
    with pytest.raises(ContentError):
        PAGE_TEMPLATE.validate(data)


def test_diff_structurel_des_champs_imbriques() -> None:
    template = example(PAGE_TEMPLATE)
    changed = copy.deepcopy(template)
    changed["layout"]["sections"][0]["rows"][0]["columns"][0]["children"][0]["label"] = "Marge"
    assert PAGE_TEMPLATE.diff(template, changed) == (
        Change(
            "/layout/sections/0/rows/0/columns/0/children/0/label", "modified", "Ventes", "Marge"
        ),
    )
    component = example(COMPONENT)
    changed = copy.deepcopy(component)
    changed["presentation"]["legend"] = "hidden"
    assert COMPONENT.diff(component, changed) == (
        Change("/presentation/legend", "modified", "auto", "hidden"),
    )


@pytest.mark.parametrize("kind", ["analysis", "kpi", "component"])
def test_modele_refuse_composant_executable(kind: str) -> None:
    data = example(PAGE_TEMPLATE)
    child = data["layout"]["sections"][0]["rows"][0]["columns"][0]["children"][0]
    child["type"] = kind
    with pytest.raises(ContentError):
        PAGE_TEMPLATE.validate(data)
