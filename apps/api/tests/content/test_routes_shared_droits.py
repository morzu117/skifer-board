"""Confidentialité des révisions et opérations des contenus partagés."""

from __future__ import annotations

from pathlib import Path
from typing import cast

import pytest
from fastapi import FastAPI
from skifer_board.catalog import CatalogService
from skifer_board.content import COMPONENT_KIND
from skifer_board.content.reindex import reindex
from skifer_board.content.repository import Kind
from spaces.monde import (
    ADMIN_GROUPE,
    CREATEUR_GROUPE,
    CREATEUR_PERSONNE,
    LECTEUR_GROUPE,
    NON_MEMBRE,
    A,
)

from .serveur import Banc
from .test_routes_shared_cycle import CASES, body


@pytest.mark.parametrize("kind,path,directory,file", CASES)
def test_histoire_diff_et_fuites(
    banc: Banc, kind: Kind, path: str, directory: str, file: str
) -> None:
    root = f"/api/spaces/{A}/{path}"
    content = body(directory, file)
    if kind is COMPONENT_KIND:
        content["analysis"]["analysis_id"] = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    created = banc.appel(CREATEUR_GROUPE, "POST", root, json=content)
    assert created.status_code == 201, created.text
    ident = created.json()["id"]
    url = f"{root}/{ident}"
    missing = f"{root}/11111111-1111-4111-8111-111111111111"
    for suffix in ("", "/history", "/diff?from=1&to=1"):
        invisible = banc.appel(CREATEUR_PERSONNE, "GET", url + suffix)
        absent = banc.appel(CREATEUR_PERSONNE, "GET", missing + suffix)
        assert invisible.status_code == absent.status_code == 404
        assert invisible.content == absent.content
        assert invisible.headers == absent.headers
        assert invisible.json()["error"]["code"] == kind.not_found
    for profil in (CREATEUR_GROUPE, ADMIN_GROUPE):
        assert banc.appel(profil, "GET", url + "/history").json()["revisions"][0]["revision"] == 1
        assert banc.appel(profil, "GET", url + "/diff?from=1&to=1").json()["changes"] == []
    for profil, status in ((LECTEUR_GROUPE, 403), (NON_MEMBRE, 404)):
        for suffix in ("", "/history", "/diff?from=1&to=1"):
            denied = banc.appel(profil, "GET", url + suffix)
            assert denied.status_code == status
            if profil is LECTEUR_GROUPE:
                assert denied.json()["error"] == {"code": "forbidden", "required": "creator"}
    assert banc.appel(CREATEUR_PERSONNE, "GET", root).json()[f"{kind.name}s"] == []
    banc.depot.approve(A, ident, 1, expected_revision=1, actor=ADMIN_GROUPE.ref, kind=kind)
    reindex(banc.depot, banc.index, banc.tableaux)
    changed = banc.appel(
        CREATEUR_GROUPE, "PUT", url, json={**content, "name": "Deux", "expected_revision": 1}
    )
    assert changed.status_code == 201
    history = banc.appel(CREATEUR_PERSONNE, "GET", url + "/history")
    assert history.status_code == 200
    assert history.json()["current_revision"] == 1
    assert [r["revision"] for r in history.json()["revisions"]] == [1]
    assert banc.appel(CREATEUR_PERSONNE, "GET", root).json()[f"{kind.name}s"][0]["revision"] == 1
    assert banc.appel(CREATEUR_PERSONNE, "GET", url, params={"revision": 1}).status_code == 200
    assert banc.appel(CREATEUR_PERSONNE, "GET", url + "/diff?from=1&to=2").status_code == 404
    diff = banc.appel(CREATEUR_GROUPE, "GET", url + "/diff?from=1&to=2").json()
    assert (diff["base"], diff["other"]) == (1, 2)
    assert any(
        change["path"] == "/name" and change["after"] == "Deux" for change in diff["changes"]
    )
    assert banc.appel(CREATEUR_GROUPE, "GET", url + "/diff?from=0&to=2").status_code == 400
    assert (
        banc.appel(CREATEUR_GROUPE, "DELETE", url, params={"expected_revision": 2}).status_code
        == 204
    )
    deleted = banc.appel(CREATEUR_GROUPE, "GET", url + "/history").json()
    assert deleted["deleted"] is True and deleted["current_revision"] is None
    assert [r["action"] for r in deleted["revisions"]] == ["save", "save", "delete"]
    assert banc.appel(CREATEUR_PERSONNE, "GET", url + "/history").status_code == 404
    assert banc.appel(CREATEUR_GROUPE, "GET", url + "/diff?from=1&to=2").status_code == 200


def test_operations_shared_sont_des_gabarits_fermes(banc: Banc) -> None:
    from fastapi.routing import APIRoute
    from skifer_board.telemetry.asgi import _template
    from skifer_board.telemetry.model import OPERATION
    from starlette.types import Scope

    segments = ("themes", "page-templates", "components")
    routes = [r for r in cast(FastAPI, banc.client.app).routes if isinstance(r, APIRoute)]
    for segment in segments:
        base = f"/api/spaces/{{space_id}}/{segment}"
        found = {
            (r.path, method)
            for r in routes
            for method in r.methods or set()
            if r.path.startswith(base)
        }
        assert found == {
            (base, "POST"),
            (base, "GET"),
            (base + "/{content_id}", "GET"),
            (base + "/{content_id}", "PUT"),
            (base + "/{content_id}", "DELETE"),
            (base + "/{content_id}/history", "GET"),
            (base + "/{content_id}/consumers", "GET"),
            (base + "/{content_id}/diff", "GET"),
            (base + "/{content_id}/approvals", "GET"),
            (base + "/{content_id}/approvals", "POST"),
        }
        assert all(OPERATION.fullmatch(path) for path, _ in found)
        for template, method in found:
            actual_path = template.replace("{space_id}", "finance").replace(
                "{content_id}", "11111111-1111-4111-8111-111111111111"
            )
            scope: Scope = {"type": "http", "path": actual_path, "method": method}
            operation, _ = _template(routes, scope)
            assert operation == template


def test_historique_et_diff_refuses_en_local(service: CatalogService, tmp_path: Path) -> None:
    from fastapi.testclient import TestClient
    from skifer_board.server import create_app

    from .monde import init, repository

    app = create_app(service, content_repository=repository(init(tmp_path / "contenus")))
    with TestClient(app, base_url="http://127.0.0.1") as client:
        for _, segment, _, _ in CASES:
            for suffix in ("/history", "/diff?from=1&to=1"):
                response = client.get(f"/api/spaces/local/{segment}/id{suffix}")
                assert response.status_code == 409
                assert response.json()["error"]["code"] == "local_mode"


def test_histoire_sans_contenu_visible(banc: Banc, monkeypatch: pytest.MonkeyPatch) -> None:
    from skifer_board.content import shared_web
    from skifer_board.content.repository import ContentRepository

    root = f"/api/spaces/{A}/themes"
    ident = banc.appel(CREATEUR_GROUPE, "POST", root, json=body("themes", "clair.json")).json()[
        "id"
    ]
    url = f"{root}/{ident}/history"
    assert banc.appel(CREATEUR_GROUPE, "GET", f"{root}/malforme/history").status_code == 404
    with monkeypatch.context() as patch:
        patch.setattr(ContentRepository, "head", lambda self: None)
        assert banc.appel(CREATEUR_GROUPE, "GET", url).status_code == 404
    with monkeypatch.context() as patch:
        patch.setattr(shared_web, "revision_visible", lambda *args: False)
        assert banc.appel(CREATEUR_GROUPE, "GET", url).status_code == 404
