"""`skifer-board validate`: exit codes and one output line per issue."""

import json
import shutil
from pathlib import Path

import pytest
from skifer_board.cli import main

REPO_ROOT = Path(__file__).resolve().parents[4]
FIXTURES_DIR = REPO_ROOT / "packages" / "dashboard-spec" / "fixtures"
DASHBOARDS_DIR = REPO_ROOT / "dashboards"


def test_valid_fixture_exits_zero(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["validate", str(FIXTURES_DIR / "valid" / "minimal.yaml")]) == 0
    assert capsys.readouterr().out == ""


def test_invalid_fixture_exits_one_and_prints_the_code(capsys: pytest.CaptureFixture[str]) -> None:
    fixture = FIXTURES_DIR / "invalid" / "semantic-empty-query.yaml"
    assert main(["validate", str(fixture)]) == 1
    out = capsys.readouterr().out
    assert out.startswith(f"{fixture}:/spec/tiles/0/query: semantic/EMPTY_QUERY: ")
    assert len(out.splitlines()) == 1


def test_no_argument_exits_two() -> None:
    assert main([]) == 2


def test_validate_without_path_exits_two() -> None:
    assert main(["validate"]) == 2


def test_missing_path_exits_two(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["validate", str(tmp_path / "absent.yaml")]) == 2
    assert "absent.yaml" in capsys.readouterr().err


def test_valid_fixtures_directory_exits_zero() -> None:
    assert main(["validate", str(FIXTURES_DIR / "valid")]) == 0


def test_invalid_fixtures_directory_prints_one_line_per_semantic_fixture(
    capsys: pytest.CaptureFixture[str],
) -> None:
    invalid_dir = FIXTURES_DIR / "invalid"
    assert main(["validate", str(invalid_dir)]) == 1
    lines = capsys.readouterr().out.splitlines()
    for fixture in sorted(invalid_dir.glob("*.yaml")):
        expected_path = fixture.with_suffix("").with_suffix(".expected.json")
        expected = json.loads(expected_path.read_text(encoding="utf-8"))
        prefix = f"{fixture}:{expected['path']}: {expected['layer']}/{expected['code']}: "
        fixture_lines = [line for line in lines if line.startswith(f"{fixture}:")]
        if expected["layer"] == "semantic":
            assert len(fixture_lines) == 1
            assert fixture_lines[0].startswith(prefix)
        else:
            assert any(line.startswith(prefix) for line in fixture_lines)


def test_directory_search_is_recursive_over_yaml_and_yml(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    nested = tmp_path / "nested"
    nested.mkdir()
    shutil.copy(FIXTURES_DIR / "valid" / "minimal.yaml", nested / "ok.yml")
    shutil.copy(FIXTURES_DIR / "invalid" / "semantic-empty-query.yaml", tmp_path / "bad.yaml")
    (tmp_path / "ignored.txt").write_text("not: [yaml", encoding="utf-8")
    assert main(["validate", str(tmp_path)]) == 1
    lines = capsys.readouterr().out.splitlines()
    assert len(lines) == 1
    assert "bad.yaml:/spec/tiles/0/query: semantic/EMPTY_QUERY: " in lines[0]


def test_dashboards_directory_is_valid_when_present() -> None:
    if DASHBOARDS_DIR.is_dir():
        assert main(["validate", str(DASHBOARDS_DIR)]) == 0
