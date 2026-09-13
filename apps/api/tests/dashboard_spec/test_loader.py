"""Safe YAML loading: unreadable YAML and non-mapping roots become one root issue."""

from pathlib import Path

import pytest
from skifer_board.dashboard_spec import validate_file
from skifer_board.dashboard_spec.loader import (
    DashboardLoadError,
    load_dashboard,
    load_dashboard_text,
)

ROOT_ISSUE = ("structural", "SCHEMA_VIOLATION", "")


@pytest.mark.parametrize(
    "text",
    ["spec: [unclosed\n", "- a list\n- at the root\n", "just a string\n", ""],
    ids=["unreadable", "list-root", "scalar-root", "empty"],
)
def test_load_failure_is_one_structural_root_issue(text: str) -> None:
    with pytest.raises(DashboardLoadError) as raised:
        load_dashboard_text(text)
    issue = raised.value.issue
    assert (issue.layer, issue.code, issue.path) == ROOT_ISSUE
    assert "\n" not in issue.message


@pytest.mark.parametrize("text", ["spec: [unclosed\n", "- a list\n"], ids=["unreadable", "list"])
def test_validate_file_returns_load_failure_without_raising(tmp_path: Path, text: str) -> None:
    dashboard = tmp_path / "broken.yaml"
    dashboard.write_text(text, encoding="utf-8")
    issues = validate_file(dashboard)
    assert [(issue.layer, issue.code, issue.path) for issue in issues] == [ROOT_ISSUE]


def test_non_utf8_file_is_one_structural_root_issue(tmp_path: Path) -> None:
    dashboard = tmp_path / "latin1.yaml"
    dashboard.write_bytes("title: caf\xe9\n".encode("latin-1"))
    issues = validate_file(dashboard)
    assert [(issue.layer, issue.code, issue.path) for issue in issues] == [ROOT_ISSUE]


def test_load_dashboard_returns_the_mapping(tmp_path: Path) -> None:
    dashboard = tmp_path / "mapping.yaml"
    dashboard.write_text("kind: Dashboard\n", encoding="utf-8")
    assert load_dashboard(dashboard) == {"kind": "Dashboard"}


def test_loader_does_not_build_python_objects() -> None:
    with pytest.raises(DashboardLoadError):
        load_dashboard_text("!!python/object/apply:os.system ['echo unsafe']\n")
