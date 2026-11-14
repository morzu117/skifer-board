"""Matrice finale des droits et des états des contenus du plan 20."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from skifer_board.catalog import CatalogService
from skifer_board.content import COMPONENT_KIND
from skifer_board.content.repository import Kind
from skifer_board.server import create_app
from spaces.monde import (
    ADMIN_GROUPE,
    CREATEUR_GROUPE,
    CREATEUR_PERSONNE,
    LECTEUR_GROUPE,
    NON_MEMBRE,
    A,
)

from .monde import init, new_id, repository
from .monde_dashboard import text
from .serveur import Banc, corps_tableau
from .test_routes_shared_cycle import CASES, body


@pytest.mark.parametrize("kind,segment,directory,file", CASES)
@pytest.mark.parametrize("approved", [False, True], ids=["brouillon", "approuve"])
def test_matrice_routes(
    banc: Banc, kind: Kind, segment: str, directory: str, file: str, approved: bool
) -> None:
    root = f"/api/spaces/{A}/{segment}"
    document = body(directory, file)
    if kind is COMPONENT_KIND:
        document["analysis"]["analysis_id"] = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    created = banc.appel(CREATEUR_GROUPE, "POST", root, json=document)
    assert created.status_code == 201
    url = f"{root}/{created.json()['id']}"
    if approved:
        assert (
            banc.appel(
                ADMIN_GROUPE,
                "POST",
                url + "/approvals",
                json={"revision": 1, "expected_revision": 1},
            ).status_code
            == 201
        )
    for profil, name in (
        (CREATEUR_GROUPE, "owner"),
        (CREATEUR_PERSONNE, "other"),
        (ADMIN_GROUPE, "admin"),
        (LECTEUR_GROUPE, "reader"),
        (NON_MEMBRE, "nonmember"),
    ):
        allowed = name in {"owner", "admin"} or (name == "other" and approved)
        status = 200 if allowed else 403 if name == "reader" else 404
        listed = banc.appel(profil, "GET", root)
        assert listed.status_code == (
            403 if name == "reader" else 404 if name == "nonmember" else 200
        )
        if listed.status_code == 200:
            ids = [item["id"] for item in listed.json()[f"{kind.name}s"]]
            assert (created.json()["id"] in ids) == allowed
        for suffix in ("", "/history", "/diff?from=1&to=1", "/approvals", "/consumers"):
            response = banc.appel(profil, "GET", url + suffix)
            assert response.status_code == status, (name, suffix, response.text)
            if name == "reader":
                assert response.json()["error"] == {"code": "forbidden", "required": "creator"}
        create = banc.appel(profil, "POST", root, json={"name": []})
        assert create.status_code == (
            403 if name == "reader" else 404 if name == "nonmember" else 422
        )
        if name == "owner":
            writing = 409
        elif name == "admin" or (name == "other" and approved):
            writing = 403
        elif name == "reader":
            writing = 403
        else:
            writing = 404
        revise = banc.appel(profil, "PUT", url, json={**document, "expected_revision": 2})
        delete = banc.appel(profil, "DELETE", url, params={"expected_revision": 2})
        assert revise.status_code == delete.status_code == writing, (name, revise.text, delete.text)
        approve = banc.appel(
            profil, "POST", url + "/approvals", json={"revision": 2, "expected_revision": 1}
        )
        assert approve.status_code == (404 if name in {"admin", "nonmember"} else 403)
        if name not in {"admin", "nonmember"}:
            assert approve.json()["error"] == {"code": "forbidden", "required": "admin"}


@pytest.mark.parametrize("kind,segment,directory,file", CASES)
def test_matrice_mode_local(
    service: CatalogService, tmp_path: Path, kind: Kind, segment: str, directory: str, file: str
) -> None:
    app = create_app(service, content_repository=repository(init(tmp_path / "contenus")))
    root = f"/api/spaces/local/{segment}"
    with TestClient(app, base_url="http://127.0.0.1") as client:
        for method, suffix in (
            ("GET", ""),
            ("POST", ""),
            ("GET", "/id"),
            ("PUT", "/id"),
            ("DELETE", "/id"),
            ("GET", "/id/history"),
            ("GET", "/id/diff?from=1&to=1"),
            ("GET", "/id/consumers"),
            ("GET", "/id/approvals"),
            ("POST", "/id/approvals"),
        ):
            response = client.request(method, root + suffix, headers={"Origin": "http://127.0.0.1"})
            assert response.status_code == 409
            assert response.json()["error"]["code"] == "local_mode"


@pytest.mark.parametrize(
    "segment,directory,file",
    [("themes", "themes", "clair.json"), ("components", "components", "base.json")],
)
@pytest.mark.parametrize("own", [False, True], ids=["autrui", "proprietaire"])
@pytest.mark.parametrize("visibility", ["personal", "shared"])
@pytest.mark.parametrize("approved", [False, True], ids=["brouillon", "approuve"])
def test_matrice_dashboard(
    banc: Banc, segment: str, directory: str, file: str, own: bool, visibility: str, approved: bool
) -> None:
    owner = CREATEUR_GROUPE if own else CREATEUR_PERSONNE
    document = body(directory, file)
    if segment == "components":
        document["analysis"]["analysis_id"] = banc.creer_ok(owner, visibility="shared")
    created = banc.appel(owner, "POST", f"/api/spaces/{A}/{segment}", json=document)
    assert created.status_code == 201
    ident = created.json()["id"]
    if approved:
        assert (
            banc.appel(
                ADMIN_GROUPE,
                "POST",
                f"/api/spaces/{A}/{segment}/{ident}/approvals",
                json={"revision": 1, "expected_revision": 1},
            ).status_code
            == 201
        )
    if segment == "themes":
        tableau = corps_tableau(
            text(), visibility=visibility, theme={"theme_id": ident, "revision": 1}
        )
    else:
        node = {
            "id": new_id(),
            "type": "component",
            "component": {"component_id": ident, "revision": 1},
        }
        tableau = corps_tableau(node, visibility=visibility)
    result = banc.appel(CREATEUR_GROUPE, "POST", f"/api/spaces/{A}/dashboards", json=tableau)
    expected = 201 if approved or (own and visibility == "personal") else 422
    assert result.status_code == expected, result.text
    if expected == 422:
        code = "unapproved_reference" if own else "invalid_dashboard"
        assert result.json()["error"]["code"] == code


@pytest.mark.parametrize("visibility", ["personal", "shared"])
def test_matrice_modele_est_informatif(banc: Banc, visibility: str) -> None:
    tableau = corps_tableau(
        text(), visibility=visibility, template={"template_id": new_id(), "revision": 4}
    )
    assert (
        banc.appel(CREATEUR_GROUPE, "POST", f"/api/spaces/{A}/dashboards", json=tableau).status_code
        == 201
    )
