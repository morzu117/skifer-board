"""Résolution des tuiles insérées dans les dashboards."""

from __future__ import annotations

from typing import Any

import pytest
from skifer_board.content import COMPONENT_KIND
from skifer_board.content.dashboard_shared import execution_view
from skifer_board.content.dashboard_web import Pinned
from spaces.monde import ADMIN_GROUPE, CREATEUR_GROUPE, LECTEUR_GROUPE, A

from .monde_dashboard import common_filter
from .serveur import Banc
from .test_routes_dashboards_references import creer_partages, dashboard


def test_composant_insere_analyse_et_filtre(banc: Banc) -> None:
    theme, component = creer_partages(banc)
    content, node_id = dashboard(theme, component, "personal")
    content["filters"] = [common_filter([node_id], dimension="region", default="Nord")]
    root = f"/api/spaces/{A}/dashboards"
    created = banc.appel(CREATEUR_GROUPE, "POST", root, json=content)
    assert created.status_code == 201, created.text
    response = created.json()
    assert response["components"] == [{"id": node_id, "state": "ready"}]
    component_document = response["resolved"]["components"][node_id]
    projected, missing = execution_view(response["dashboard"], {node_id: component_document}, set())
    assert not missing
    node = projected["layout"]["sections"][0]["rows"][0]["columns"][0]["children"][1]
    assert node["reference"] == component_document["analysis"]
    assert node["presentation"] == component_document["presentation"]
    assert projected["filters"][0]["targets"] == [node_id]
    pinned = Pinned(banc.depot, A, CREATEUR_GROUPE.ref, banc.depot.head())
    analysis = pinned.of(response["dashboard"])[node_id]
    assert analysis is not None and analysis["id"] == component_document["analysis"]["analysis_id"]
    for path, ident in (("themes", theme), ("components", component)):
        result = banc.appel(
            ADMIN_GROUPE,
            "POST",
            f"/api/spaces/{A}/{path}/{ident}/approvals",
            json={"revision": 1, "expected_revision": 1},
        )
        assert result.status_code == 201
    shared = {**content, "visibility": "shared"}
    saved = banc.appel(
        CREATEUR_GROUPE,
        "POST",
        f"{root}/{response['id']}/revisions",
        json={**shared, "expected_revision": 1},
    )
    assert saved.status_code == 201, saved.text
    read = banc.appel(LECTEUR_GROUPE, "GET", f"{root}/{response['id']}")
    assert read.status_code == 200 and read.json()["components"] == [
        {"id": node_id, "state": "ready"}
    ]
    banc.depot.delete(
        A, component, expected_revision=1, actor=CREATEUR_GROUPE.ref, kind=COMPONENT_KIND
    )
    gone = banc.appel(LECTEUR_GROUPE, "GET", f"{root}/{response['id']}")
    assert gone.status_code == 200
    assert gone.json()["components"] == [
        {"id": node_id, "state": "unavailable", "reason": "analysis_unavailable"}
    ]
    assert node_id not in gone.json()["resolved"]["components"]


def test_analyse_du_composant_supprimee_ne_resout_plus_la_tuile(banc: Banc) -> None:
    theme, component = creer_partages(banc)
    content, node_id = dashboard(theme, component, "personal")
    root = f"/api/spaces/{A}/dashboards"
    created = banc.appel(CREATEUR_GROUPE, "POST", root, json=content)
    assert created.status_code == 201
    analysis_id = banc.depot.read(A, component, kind=COMPONENT_KIND).document["analysis"][
        "analysis_id"
    ]
    banc.depot.delete(A, analysis_id, expected_revision=1, actor=CREATEUR_GROUPE.ref)
    read = banc.appel(CREATEUR_GROUPE, "GET", f"{root}/{created.json()['id']}")
    assert read.status_code == 200
    assert read.json()["components"] == [
        {"id": node_id, "state": "unavailable", "reason": "analysis_unavailable"}
    ]


def test_brouillon_autrui_ne_resout_pas_la_tuile(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    from skifer_board.content.index import DashboardRow
    from skifer_board.content.repository import COMPONENT_KIND, DASHBOARD_KIND, ContentRepository
    from spaces.monde import CREATEUR_PERSONNE

    from .monde_dashboard import new_id, with_components
    from .test_routes_shared_cycle import body

    analysis = banc.creer_ok(CREATEUR_PERSONNE, visibility="shared")
    component = body("components", "base.json")
    component["analysis"]["analysis_id"] = analysis
    created = banc.appel(CREATEUR_PERSONNE, "POST", f"/api/spaces/{A}/components", json=component)
    assert created.status_code == 201
    node_id = new_id()
    node = {
        "id": node_id,
        "type": "component",
        "component": {"component_id": created.json()["id"], "revision": 1},
    }
    owner = CREATEUR_GROUPE.ref
    document = with_components(node, owner={"issuer": owner.issuer, "subject": owner.subject})
    stored = banc.depot.write(
        A, document["id"], document, expected_revision=None, actor=owner, kind=DASHBOARD_KIND
    )
    banc.tableaux.upsert(DashboardRow.of(A, stored))
    original = ContentRepository.read

    def read_allowed(self: ContentRepository, *args: Any, **kwargs: Any) -> Any:
        assert kwargs.get("kind") is not COMPONENT_KIND
        return original(self, *args, **kwargs)

    monkeypatch.setattr(ContentRepository, "read", read_allowed)
    read = banc.appel(CREATEUR_GROUPE, "GET", f"/api/spaces/{A}/dashboards/{document['id']}")
    assert read.status_code == 200
    assert read.json()["components"] == [
        {"id": node_id, "state": "unavailable", "reason": "analysis_unavailable"}
    ]
    assert node_id not in read.json()["resolved"]["components"]


def test_projection_imbrication_kpi_et_refus_ferme(monkeypatch: pytest.MonkeyPatch) -> None:
    from skifer_board.content import dashboard_web
    from skifer_board.content.errors import ContentError
    from skifer_board.spaces.model import PersonRef

    from .monde_dashboard import column, container, new_id, row, with_components

    node_id = new_id()
    node = {
        "id": node_id,
        "type": "component",
        "component": {"component_id": new_id(), "revision": 1},
    }
    document = with_components(container(row(column(node))))
    reference = {"analysis_id": new_id(), "revision": 1}
    definition = {"kind": "kpi", "analysis": reference, "presentation": {"title": "Total"}}
    projected, missing = execution_view(document, {node_id: definition}, set())
    child = projected["layout"]["sections"][0]["rows"][0]["columns"][0]["children"][0]["rows"][0][
        "columns"
    ][0]["children"][0]
    assert not missing and child == {
        "id": node_id,
        "type": "kpi",
        "reference": reference,
        "presentation": {"title": "Total"},
    }
    path = "/layout/sections/0/rows/0/columns/0/children/0/rows/0/columns/0/children/0"
    blocked, unavailable = execution_view(document, {node_id: definition}, {path})
    assert unavailable == {node_id}
    assert (
        blocked["layout"]["sections"][0]["rows"][0]["columns"][0]["children"][0]["rows"][0][
            "columns"
        ][0]["children"][0]["reference"]["analysis_id"]
        == node_id
    )

    def failure(*args: Any, **kwargs: Any) -> Any:
        raise ContentError("content_unavailable", "git_failed")

    monkeypatch.setattr(dashboard_web, "validate_references", failure)
    pinned = Pinned(None, A, PersonRef("issuer", "subject"), "tip")  # type: ignore[arg-type]
    assert pinned.of(document)[node_id] is None
