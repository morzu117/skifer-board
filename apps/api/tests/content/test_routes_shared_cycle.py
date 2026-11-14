"""Cycle des routes des trois genres : visibilité et révisions."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from skifer_board.content import COMPONENT_KIND, PAGE_TEMPLATE_KIND, THEME_KIND
from skifer_board.content.reindex import reindex
from skifer_board.content.repository import Kind
from spaces.monde import (
    ADMIN_B,
    ADMIN_GROUPE,
    CREATEUR_GROUPE,
    CREATEUR_PERSONNE,
    LECTEUR_GROUPE,
    NON_MEMBRE,
    A,
)

from .serveur import Banc

ROOT = Path(__file__).resolve().parents[4] / "contracts"
CASES = [
    (THEME_KIND, "themes", "themes", "clair.json"),
    (PAGE_TEMPLATE_KIND, "page-templates", "page_templates", "base.json"),
    (COMPONENT_KIND, "components", "components", "base.json"),
]


def body(directory: str, filename: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((ROOT / directory / "fixtures/valid" / filename).read_text())
    for name in ("api_version", "id", "owner"):
        del data[name]
    return data


@pytest.mark.parametrize("kind,path,directory,file", CASES)
def test_cycle_visibility_et_conflit(
    banc: Banc, kind: Kind, path: str, directory: str, file: str
) -> None:
    root = f"/api/spaces/{A}/{path}"
    content = body(directory, file)
    if kind is COMPONENT_KIND:
        content["analysis"]["analysis_id"] = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    created = banc.appel(CREATEUR_GROUPE, "POST", root, json=content)
    assert created.status_code == 201, created.text
    initial = created.json()
    ident = initial["id"]
    assert initial["state"] == "draft" and initial["approved_revision"] is None
    assert (
        initial["index_state"] == "indexed" and created.headers["etag"] == f'"{initial["commit"]}"'
    )
    current = banc.appel(CREATEUR_GROUPE, "GET", f"{root}/{ident}")
    assert current.status_code == 200 and current.json()[kind.name]["name"] == content["name"]
    assert banc.appel(CREATEUR_GROUPE, "GET", root).json()[f"{kind.name}s"][0]["id"] == ident
    assert banc.appel(CREATEUR_PERSONNE, "GET", f"{root}/{ident}").status_code == 404
    assert banc.appel(CREATEUR_PERSONNE, "GET", root).json()[f"{kind.name}s"] == []
    for method, url, options in (
        ("GET", root, {}),
        ("GET", f"{root}/{ident}", {}),
        ("POST", root, {"json": content}),
    ):
        response = banc.appel(LECTEUR_GROUPE, method, url, **options)
        assert response.status_code == 403 and response.json()["error"] == {
            "code": "forbidden",
            "required": "creator",
        }
    assert banc.appel(NON_MEMBRE, "GET", root).status_code == 404
    banc.depot.approve(A, ident, 1, expected_revision=1, actor=ADMIN_GROUPE.ref, kind=kind)
    reindex(banc.depot, banc.index, banc.tableaux)
    shown = banc.appel(CREATEUR_PERSONNE, "GET", f"{root}/{ident}")
    assert shown.status_code == 200 and shown.json()["state"] == "approved"
    assert shown.json()["approved_revision"] == 1
    assert banc.appel(CREATEUR_PERSONNE, "GET", root).json()[f"{kind.name}s"][0]["id"] == ident
    denied = banc.appel(
        CREATEUR_PERSONNE, "PUT", f"{root}/{ident}", json={**content, "expected_revision": 1}
    )
    assert denied.status_code == 403 and denied.json()["error"]["code"] == "not_owner"
    conflict = banc.appel(
        CREATEUR_GROUPE,
        "PUT",
        f"{root}/{ident}",
        json={**content, "name": "Deux", "expected_revision": 2},
    )
    assert conflict.status_code == 409 and conflict.json()["error"]["code"] == "revision_conflict"
    revised = banc.appel(
        CREATEUR_GROUPE,
        "PUT",
        f"{root}/{ident}",
        json={**content, "name": "Deux", "expected_revision": 1},
    )
    assert revised.status_code == 201 and revised.json()["revision"] == 2
    visible = banc.appel(CREATEUR_PERSONNE, "GET", f"{root}/{ident}")
    assert visible.status_code == 200 and visible.json()["revision"] == 1
    assert banc.appel(CREATEUR_PERSONNE, "GET", f"{root}/{ident}/consumers").status_code == 200
    old = banc.appel(CREATEUR_PERSONNE, "GET", f"{root}/{ident}", params={"revision": "1"})
    assert old.status_code == 200 and old.json()["state"] == "approved"
    assert old.json()["index_state"] == "indexed"
    assert banc.appel(CREATEUR_PERSONNE, "GET", root).json()[f"{kind.name}s"][0]["revision"] == 1
    assert (
        banc.appel(
            CREATEUR_PERSONNE, "GET", f"{root}/{ident}", params={"revision": "2"}
        ).status_code
        == 404
    )
    assert (
        banc.appel(
            ADMIN_GROUPE, "DELETE", f"{root}/{ident}", params={"expected_revision": "2"}
        ).json()["error"]["code"]
        == "not_owner"
    )
    assert (
        banc.appel(
            CREATEUR_GROUPE, "DELETE", f"{root}/{ident}", params={"expected_revision": "2"}
        ).status_code
        == 204
    )
    assert banc.appel(CREATEUR_GROUPE, "GET", f"{root}/{ident}").status_code == 404


@pytest.mark.parametrize("kind,path,directory,file", CASES)
def test_isolation(banc: Banc, kind: Kind, path: str, directory: str, file: str) -> None:
    root = f"/api/spaces/{A}/{path}"
    content = body(directory, file)
    if kind is COMPONENT_KIND:
        content["analysis"]["analysis_id"] = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    created = banc.appel(CREATEUR_GROUPE, "POST", root, json=content)
    assert created.status_code == 201, created.text
    ident = created.json()["id"]
    for other in {"themes", "page-templates", "components"} - {path}:
        assert (
            banc.appel(CREATEUR_GROUPE, "GET", f"/api/spaces/{A}/{other}/{ident}").status_code
            == 404
        )
    assert banc.appel(ADMIN_B, "GET", f"/api/spaces/rh/{path}/{ident}").status_code == 404


def test_depot_indisponible(banc_sans_depot: Banc) -> None:
    response = banc_sans_depot.appel(CREATEUR_GROUPE, "GET", f"/api/spaces/{A}/themes")
    assert response.status_code == 503 and response.json()["error"]["code"] == "content_unavailable"


def test_mode_local(service: Any, tmp_path: Path) -> None:
    from fastapi.testclient import TestClient
    from skifer_board.server import create_app

    from .monde import init, repository

    repo = repository(init(tmp_path / "contenus"))
    app = create_app(service, content_repository=repo)
    with TestClient(app, base_url="http://127.0.0.1", raise_server_exceptions=False) as client:
        for _, segment, _, _ in CASES:
            root = f"/api/spaces/local/{segment}"
            for method, path in (
                ("GET", root),
                ("POST", root),
                ("GET", root + "/x"),
                ("PUT", root + "/x"),
                ("DELETE", root + "/x"),
            ):
                response = client.request(method, path, headers={"Origin": "http://127.0.0.1"})
                assert response.status_code == 409
                assert response.json()["error"]["code"] == "local_mode"


def test_corps_et_index_indisponible(banc: Banc, monkeypatch: pytest.MonkeyPatch) -> None:
    from skifer_board.content.shared_index import SharedIndex
    from sqlalchemy.exc import SQLAlchemyError

    root = f"/api/spaces/{A}/themes"
    content = body("themes", "clair.json")
    assert banc.appel(CREATEUR_GROUPE, "POST", root, json=[]).status_code == 400
    assert (
        banc.appel(CREATEUR_GROUPE, "POST", root, json={**content, "owner": {}}).status_code == 422
    )
    created = banc.appel(CREATEUR_GROUPE, "POST", root, json=content)
    ident = created.json()["id"]
    url = f"{root}/{ident}"
    assert banc.appel(CREATEUR_GROUPE, "GET", f"{root}/malforme").status_code == 404
    assert banc.appel(CREATEUR_GROUPE, "PUT", url, json=[]).status_code == 400
    assert (
        banc.appel(
            CREATEUR_GROUPE, "PUT", url, json={**content, "id": ident, "expected_revision": 1}
        ).status_code
        == 422
    )

    def indisponible(*args: Any, **kwargs: Any) -> Any:
        raise SQLAlchemyError("indisponible")

    with monkeypatch.context() as patch:
        patch.setattr(SharedIndex, "get", indisponible)
        assert banc.appel(CREATEUR_GROUPE, "GET", url).status_code == 503
    with monkeypatch.context() as patch:
        patch.setattr(SharedIndex, "approvals", indisponible)
        assert banc.appel(CREATEUR_GROUPE, "GET", url).status_code == 200
    with monkeypatch.context() as patch:
        patch.setattr(SharedIndex, "rows", indisponible)
        assert banc.appel(CREATEUR_GROUPE, "GET", root).status_code == 503
    with monkeypatch.context() as patch:
        patch.setattr(SharedIndex, "upsert", indisponible)
        revised = banc.appel(
            CREATEUR_GROUPE,
            "PUT",
            url,
            json={**content, "name": "Révision", "expected_revision": 1},
        )
        assert revised.status_code == 201 and revised.json()["index_state"] == "index_stale"
    with monkeypatch.context() as patch:
        patch.setattr(SharedIndex, "remove", indisponible)
        deleted = banc.appel(CREATEUR_GROUPE, "DELETE", url, params={"expected_revision": 2})
        assert deleted.status_code == 204


def test_index_et_depot_desynchronises(banc: Banc, monkeypatch: pytest.MonkeyPatch) -> None:
    from skifer_board.content.errors import ContentError
    from skifer_board.content.repository import ContentRepository
    from skifer_board.content.shared_index import SharedIndex
    from sqlalchemy.exc import SQLAlchemyError

    root = f"/api/spaces/{A}/themes"
    content = body("themes", "clair.json")

    def panne_index(*args: Any, **kwargs: Any) -> Any:
        raise SQLAlchemyError("indisponible")

    with monkeypatch.context() as patch:
        patch.setattr(SharedIndex, "upsert", panne_index)
        stale = banc.appel(CREATEUR_GROUPE, "POST", root, json=content)
        assert stale.status_code == 201 and stale.json()["index_state"] == "index_stale"
    created = banc.appel(CREATEUR_GROUPE, "POST", root, json=content)
    ident = created.json()["id"]
    url = f"{root}/{ident}"
    with monkeypatch.context() as patch:
        patch.setattr(ContentRepository, "head", lambda self: None)
        assert banc.appel(CREATEUR_GROUPE, "GET", root).json()["themes"] == []
        assert banc.appel(CREATEUR_GROUPE, "GET", url).status_code == 404
    original_head = ContentRepository.head
    calls = 0

    def nouvelle_tete(self: ContentRepository) -> str | None:
        nonlocal calls
        calls += 1
        return original_head(self) if calls == 1 else "changed"

    with monkeypatch.context() as patch:
        patch.setattr(ContentRepository, "head", nouvelle_tete)
        assert banc.appel(CREATEUR_GROUPE, "GET", url).status_code == 200

    def erreur(code: str) -> Any:
        def lancer(*args: Any, **kwargs: Any) -> Any:
            raise ContentError(code, "damaged")

        return lancer

    with monkeypatch.context() as patch:
        patch.setattr(ContentRepository, "read_approvals", erreur("content_unavailable"))
        assert banc.appel(CREATEUR_GROUPE, "GET", url).status_code == 503
        listed = banc.appel(CREATEUR_GROUPE, "GET", root)
        assert listed.status_code == 503 and listed.json()["error"]["code"] == "content_unavailable"
    with monkeypatch.context() as patch:
        patch.setattr(ContentRepository, "history", erreur("theme_not_found"))
        assert banc.appel(CREATEUR_GROUPE, "GET", root).json()["themes"] == []
    with monkeypatch.context() as patch:
        patch.setattr(SharedIndex, "remove", panne_index)
        assert (
            banc.appel(CREATEUR_GROUPE, "DELETE", url, params={"expected_revision": 1}).status_code
            == 204
        )
    assert banc.appel(CREATEUR_GROUPE, "GET", root).json()["themes"] == []


def test_composant_analyse_personnelle_ou_absente(banc: Banc) -> None:
    root = f"/api/spaces/{A}/components"
    content = body("components", "base.json")
    missing = banc.appel(CREATEUR_GROUPE, "POST", root, json=content)
    assert missing.status_code == 404 and missing.json()["error"]["code"] == "analysis_not_found"
    content["analysis"]["analysis_id"] = banc.creer_ok(CREATEUR_GROUPE, visibility="personal")
    private = banc.appel(CREATEUR_GROUPE, "POST", root, json=content)
    assert private.status_code == 422 and private.json()["error"]["code"] == "personal_reference"


def test_liste_compte_contenu_illisible_pour_son_auteur(banc: Banc, monkeypatch: Any) -> None:
    from skifer_board.content.errors import ContentError
    from skifer_board.content.repository import ContentRepository

    root = f"/api/spaces/{A}/themes"
    approved = banc.appel(CREATEUR_GROUPE, "POST", root, json=body("themes", "clair.json")).json()[
        "id"
    ]
    draft = banc.appel(CREATEUR_GROUPE, "POST", root, json=body("themes", "clair.json")).json()[
        "id"
    ]
    assert (
        banc.appel(
            ADMIN_GROUPE,
            "POST",
            f"{root}/{approved}/approvals",
            json={"revision": 1, "expected_revision": 1},
        ).status_code
        == 201
    )
    original = ContentRepository.glance

    def broken(self: Any, space: str, content_id: str, *args: Any, **kwargs: Any) -> Any:
        if content_id in {approved, draft}:
            raise ContentError("content_unavailable", "stored_invalid")
        return original(self, space, content_id, *args, **kwargs)

    monkeypatch.setattr(ContentRepository, "glance", broken)
    for role, count in ((CREATEUR_GROUPE, 2), (CREATEUR_PERSONNE, 1), (ADMIN_GROUPE, 2)):
        response = banc.appel(role, "GET", root)
        assert response.status_code == 200 and response.json() == {
            "themes": [],
            "unreadable": count,
        }


def test_liste_panne_git_refusee_pour_tout_createur(banc: Banc, monkeypatch: Any) -> None:
    from skifer_board.content.errors import ContentError
    from skifer_board.content.repository import ContentRepository

    root = f"/api/spaces/{A}/themes"
    ident = banc.appel(CREATEUR_GROUPE, "POST", root, json=body("themes", "clair.json")).json()[
        "id"
    ]
    assert (
        banc.appel(
            ADMIN_GROUPE,
            "POST",
            f"{root}/{ident}/approvals",
            json={"revision": 1, "expected_revision": 1},
        ).status_code
        == 201
    )
    original = ContentRepository.glance

    def broken(self: Any, space: str, content_id: str, *args: Any, **kwargs: Any) -> Any:
        if content_id == ident:
            raise ContentError("content_unavailable", "git_failed")
        return original(self, space, content_id, *args, **kwargs)

    monkeypatch.setattr(ContentRepository, "glance", broken)
    for role in (CREATEUR_GROUPE, CREATEUR_PERSONNE):
        response = banc.appel(role, "GET", root)
        assert (
            response.status_code == 503
            and response.json()["error"]["code"] == "content_unavailable"
        )


def test_composant_reessaie_conflit_tete(banc: Banc, monkeypatch: Any) -> None:
    from skifer_board.content.errors import ContentError
    from skifer_board.content.repository import ContentRepository

    contenu = body("components", "base.json")
    contenu["analysis"]["analysis_id"] = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    original = ContentRepository.write
    remaining = 1

    def concurrent(self: Any, *args: Any, **kwargs: Any) -> Any:
        nonlocal remaining
        if kwargs.get("kind") is COMPONENT_KIND and remaining:
            remaining -= 1
            raise ContentError("revision_conflict", "head_changed")
        return original(self, *args, **kwargs)

    monkeypatch.setattr(ContentRepository, "write", concurrent)
    root = f"/api/spaces/{A}/components"
    created = banc.appel(CREATEUR_GROUPE, "POST", root, json=contenu)
    assert created.status_code == 201, created.text
    remaining = 1
    revised = banc.appel(
        CREATEUR_GROUPE,
        "PUT",
        f"{root}/{created.json()['id']}",
        json={**contenu, "name": "Deux", "expected_revision": 1},
    )
    assert revised.status_code == 201, revised.text
    remaining = 2
    failed = banc.appel(CREATEUR_GROUPE, "POST", root, json=contenu)
    assert failed.status_code == 409 and failed.json()["error"]["reason"] == "stale"


def test_consommateurs_utilisent_la_revision_visible(banc: Banc, monkeypatch: Any) -> None:
    from skifer_board.content.shared_consumers import SharedConsumers
    from skifer_board.content.web import Dependents

    root = f"/api/spaces/{A}/themes"
    content = body("themes", "clair.json")
    ident = banc.appel(CREATEUR_GROUPE, "POST", root, json=content).json()["id"]
    assert (
        banc.appel(
            ADMIN_GROUPE,
            "POST",
            f"{root}/{ident}/approvals",
            json={"revision": 1, "expected_revision": 1},
        ).status_code
        == 201
    )
    assert (
        banc.appel(
            CREATEUR_GROUPE,
            "PUT",
            f"{root}/{ident}",
            json={**content, "name": "Brouillon", "expected_revision": 1},
        ).status_code
        == 201
    )
    revisions: list[int] = []

    def capture(
        self: Any, space: str, kind: str, content_id: str, revision: int, actor: Any, at: Any
    ) -> Dependents:
        revisions.append(revision)
        return Dependents()

    monkeypatch.setattr(SharedConsumers, "__call__", capture)
    response = banc.appel(CREATEUR_PERSONNE, "GET", f"{root}/{ident}/consumers")
    assert response.status_code == 200
    assert revisions == [1]
