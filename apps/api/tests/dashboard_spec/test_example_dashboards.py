"""The example dashboards under `dashboards/` validate with no issue."""

from pathlib import Path

import pytest
from skifer_board.dashboard_spec import validate_file

REPO_ROOT = Path(__file__).resolve().parents[4]
DASHBOARDS_DIR = REPO_ROOT / "dashboards"
DASHBOARD_FILES = sorted(DASHBOARDS_DIR.glob("*.yaml"))


def test_at_least_two_example_dashboards() -> None:
    assert len(DASHBOARD_FILES) >= 2


@pytest.mark.parametrize("dashboard_path", DASHBOARD_FILES, ids=lambda p: p.name)
def test_example_dashboard_has_no_issue(dashboard_path: Path) -> None:
    assert validate_file(dashboard_path) == []
