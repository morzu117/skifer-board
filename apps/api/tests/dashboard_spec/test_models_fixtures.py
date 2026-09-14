"""Each valid fixture must load into the generated Pydantic models without raising."""

from pathlib import Path

import pytest
from skifer_board.dashboard_spec.loader import load_dashboard
from skifer_board.dashboard_spec.models import DashboardAsYamlV1

REPO_ROOT = Path(__file__).resolve().parents[4]
FIXTURES_DIR = REPO_ROOT / "packages" / "dashboard-spec" / "fixtures"
VALID_FIXTURES = sorted((FIXTURES_DIR / "valid").glob("*.yaml"))


@pytest.mark.parametrize("fixture_path", VALID_FIXTURES, ids=lambda p: p.name)
def test_valid_fixture_loads_into_generated_models(fixture_path: Path) -> None:
    document = load_dashboard(fixture_path)
    dashboard = DashboardAsYamlV1.model_validate(document)
    assert dashboard.metadata.slug.root == document["metadata"]["slug"]
