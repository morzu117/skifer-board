"""Le diff positionnel consommé par le web provient de la route réelle."""

import copy
import json
from pathlib import Path

from spaces.monde import CREATEUR_GROUPE, A

from .serveur import Banc
from .test_routes_shared_cycle import body


def test_contrat_diff_reel_modele(banc: Banc) -> None:
    root = f"/api/spaces/{A}/page-templates"
    initial = body("page_templates", "base.json")
    created = banc.appel(CREATEUR_GROUPE, "POST", root, json=initial)
    assert created.status_code == 201, created.text
    ident = created.json()["id"]
    revised = copy.deepcopy(initial)
    slot = revised["layout"]["sections"][0]["rows"][0]["columns"][0]["children"][0]
    slot.clear()
    slot.update(
        {
            "id": "00000000-0000-0000-0000-000000000006",
            "type": "text",
            "blocks": [{"type": "paragraph", "content": [{"text": "Exemple"}]}],
        }
    )
    revised["filters"][0].update(
        {"operator": "in", "default": ["ouest", "est"], "allowed": ["ouest", "est"]}
    )
    updated = banc.appel(
        CREATEUR_GROUPE, "PUT", f"{root}/{ident}", json={**revised, "expected_revision": 1}
    )
    assert updated.status_code == 201, updated.text
    response = banc.appel(CREATEUR_GROUPE, "GET", f"{root}/{ident}/diff?from=1&to=2")
    assert response.status_code == 200, response.text
    fixture = Path(__file__).resolve().parents[3] / "web/src/page-templates/diff-reel.json"
    expected = json.loads(fixture.read_text())
    expected["id"] = ident
    assert response.json() == expected
