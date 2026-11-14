"""Références de thème, modèle et composant dans dashboard/v1."""

import copy
import json
from pathlib import Path

import pytest
from skifer_board.content import ContentError, dashboard

from .monde_dashboard import column, row, section

ROOT = Path(__file__).resolve().parents[4] / "contracts/dashboards/fixtures/extensions"


def test_fixtures_et_cibles() -> None:
    data = json.loads((ROOT / "valid.json").read_text())
    assert dashboard.validate(data) == data
    raw = dashboard.dumps(data)
    assert dashboard.loads(raw) == data
    assert dashboard.brief(raw)[3] == data["id"]
    with pytest.raises(ContentError):
        dashboard.validate(json.loads((ROOT / "invalid-override.json").read_text()))
    assert not dashboard.executables(data)  # Non résolu : aucune analyse n'est exécutée.
    changed = copy.deepcopy(data)
    changed["theme"]["revision"] = 2
    assert any(c.path == "/theme/revision" for c in dashboard.diff(data, changed))


def test_borne_et_revisions() -> None:
    import uuid

    data = json.loads((ROOT / "valid.json").read_text())

    def component() -> dict[str, object]:
        return {
            "id": str(uuid.uuid4()),
            "type": "component",
            "component": {"component_id": str(uuid.uuid4()), "revision": 1},
        }

    def layout(n: int) -> dict[str, object]:
        return {
            "sections": [
                section(
                    *(
                        row(*(column(component(), span=1) for _ in range(min(12, n - i))))
                        for i in range(0, n, 12)
                    )
                )
            ]
        }

    data["filters"] = []
    data["layout"] = layout(40)
    dashboard.validate(data)
    data["layout"] = layout(41)
    with pytest.raises(ContentError) as error:
        dashboard.validate(data)
    assert any(v.rule == "out_of_bounds" for v in error.value.violations)
    data["layout"] = layout(1)
    for field in ("theme", "template"):
        altered = copy.deepcopy(data)
        altered[field]["revision"] = 1.0
        with pytest.raises(ContentError):
            dashboard.validate(altered)


@pytest.mark.parametrize(
    "value",
    [
        "dark",
        "#abcdef",
        {"color": "#123456"},
        {"theme_id": "bad", "revision": 1},
        {"theme_id": "12345678-1234-1234-1234-123456789abc", "revision": 0},
        {"theme_id": "12345678-1234-1234-1234-123456789abc", "revision": 1.0},
    ],
)
def test_theme_refuse_les_formes_invalides(value: object) -> None:
    data = json.loads((ROOT / "valid.json").read_text())
    data["theme"] = value
    with pytest.raises(ContentError) as error:
        dashboard.validate(data)
    assert error.value.code == "invalid_dashboard"


def test_filtre_visant_composant_non_resolu() -> None:
    from skifer_board.content.dashboard_checks import _filter_checks

    data = json.loads((ROOT / "valid.json").read_text())
    assert list(_filter_checks(dashboard.validate(data), {}, {"models": []})) == []


def test_composant_exige_type_et_refuse_ancien_kind() -> None:
    data = json.loads((ROOT / "valid.json").read_text())
    child = data["layout"]["sections"][0]["rows"][0]["columns"][0]["children"][0]
    assert child["type"] == "component"
    child["kind"] = child.pop("type")
    with pytest.raises(ContentError):
        dashboard.validate(data)
