"""The Python validator against the 25 Dashboard as YAML v1 fixtures and their sidecars."""

import json
from pathlib import Path
from typing import Any

import pytest
from skifer_board.dashboard_spec import validate_file
from skifer_board.dashboard_spec.issues import json_pointer

REPO_ROOT = Path(__file__).resolve().parents[4]
FIXTURES_DIR = REPO_ROOT / "packages" / "dashboard-spec" / "fixtures"
VALID_FIXTURES = sorted((FIXTURES_DIR / "valid").glob("*.yaml"))
INVALID_FIXTURES = sorted((FIXTURES_DIR / "invalid").glob("*.yaml"))


def _load_expected(fixture_path: Path) -> dict[str, Any]:
    expected_path = fixture_path.with_suffix("").with_suffix(".expected.json")
    expected: dict[str, Any] = json.loads(expected_path.read_text(encoding="utf-8"))
    return expected


def test_all_fixtures_are_covered() -> None:
    assert len(VALID_FIXTURES) + len(INVALID_FIXTURES) == 25


@pytest.mark.parametrize("fixture_path", VALID_FIXTURES, ids=lambda p: p.name)
def test_valid_fixture_has_no_issue(fixture_path: Path) -> None:
    assert validate_file(fixture_path) == []


@pytest.mark.parametrize("fixture_path", INVALID_FIXTURES, ids=lambda p: p.name)
def test_invalid_fixture_reports_expected_issue(fixture_path: Path) -> None:
    expected = _load_expected(fixture_path)
    issues = validate_file(fixture_path)

    if expected["layer"] == "semantic":
        assert [(issue.layer, issue.code, issue.path) for issue in issues] == [
            (expected["layer"], expected["code"], expected["path"])
        ]
    else:
        assert issues != []
        assert all(
            (issue.layer, issue.code) == ("structural", "SCHEMA_VIOLATION") for issue in issues
        )
        assert expected["path"] in [issue.path for issue in issues]


def test_json_pointer_escapes_and_root() -> None:
    assert json_pointer([]) == ""
    assert json_pointer(["spec", "tiles", 0]) == "/spec/tiles/0"
    assert json_pointer(["a/b", "c~d"]) == "/a~1b/c~0d"
