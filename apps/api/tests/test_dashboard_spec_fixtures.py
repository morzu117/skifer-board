"""Fixture-driven checks for the Dashboard as YAML v1 JSON Schema.

Validates the schema itself against the draft 2020-12 metaschema, and every fixture under
`packages/dashboard-spec/fixtures/` against the schema and its `.expected.json` sidecar.
"""

import json
from pathlib import Path
from typing import Any

import pytest
import yaml
from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

REPO_ROOT = Path(__file__).resolve().parents[3]
SCHEMA_PATH = REPO_ROOT / "packages" / "dashboard-spec" / "schema" / "dashboard.v1.json"
FIXTURES_DIR = REPO_ROOT / "packages" / "dashboard-spec" / "fixtures"

STRUCTURAL_CODES = {"SCHEMA_VIOLATION"}
SEMANTIC_CODES = {
    "DUPLICATE_TILE_ID",
    "DUPLICATE_FILTER_NAME",
    "TILE_OUT_OF_GRID",
    "TILE_OVERLAP",
    "EMPTY_QUERY",
    "VIZ_X_NOT_IN_GROUP_BY",
    "VIZ_SERIES_NOT_IN_METRICS",
    "VIZ_KPI_METRIC_NOT_IN_METRICS",
    "VIZ_TABLE_COLUMN_UNKNOWN",
    "FORMAT_KEY_UNKNOWN",
    "UNKNOWN_FILTER_REFERENCE",
    "BINDING_KIND_MISMATCH",
    "BINDING_IN_LIST",
}


def _load_schema() -> dict[str, Any]:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))  # type: ignore[no-any-return]


def _load_yaml(path: Path) -> Any:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _load_expected(fixture_path: Path) -> dict[str, Any]:
    expected_path = fixture_path.with_suffix("").with_suffix(".expected.json")
    return json.loads(expected_path.read_text(encoding="utf-8"))  # type: ignore[no-any-return]


def _pointer(error: ValidationError) -> str:
    return "/" + "/".join(str(part) for part in error.absolute_path)


VALID_FIXTURES = sorted((FIXTURES_DIR / "valid").glob("*.yaml"))
INVALID_FIXTURES = sorted((FIXTURES_DIR / "invalid").glob("*.yaml"))


def test_schema_is_valid_draft_2020_12() -> None:
    Draft202012Validator.check_schema(_load_schema())


def test_fixtures_are_present() -> None:
    assert len(VALID_FIXTURES) == 10
    assert len(INVALID_FIXTURES) == 16


@pytest.mark.parametrize("fixture_path", VALID_FIXTURES, ids=lambda p: p.name)
def test_valid_fixture_passes_schema(fixture_path: Path) -> None:
    validator = Draft202012Validator(_load_schema())
    instance = _load_yaml(fixture_path)
    errors = list(validator.iter_errors(instance))
    assert errors == [], [error.message for error in errors]


@pytest.mark.parametrize("fixture_path", INVALID_FIXTURES, ids=lambda p: p.name)
def test_invalid_fixture_expected_sidecar_is_well_formed(fixture_path: Path) -> None:
    expected = _load_expected(fixture_path)
    assert expected["layer"] in {"structural", "semantic"}
    assert expected["code"] in STRUCTURAL_CODES | SEMANTIC_CODES
    assert expected["path"].startswith("/")


@pytest.mark.parametrize("fixture_path", INVALID_FIXTURES, ids=lambda p: p.name)
def test_invalid_fixture_matches_its_layer(fixture_path: Path) -> None:
    validator = Draft202012Validator(_load_schema())
    expected = _load_expected(fixture_path)
    instance = _load_yaml(fixture_path)
    errors = list(validator.iter_errors(instance))

    if expected["layer"] == "structural":
        assert expected["code"] in STRUCTURAL_CODES
        assert errors != []
        pointers = [_pointer(error) for error in errors]
        assert expected["path"] in pointers, pointers
    else:
        assert expected["layer"] == "semantic"
        assert expected["code"] in SEMANTIC_CODES
        assert errors == [], [error.message for error in errors]
