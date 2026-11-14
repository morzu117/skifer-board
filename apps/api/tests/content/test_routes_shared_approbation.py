"""Approbation des trois genres par les administrateurs."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from skifer_board.catalog import CatalogService
from skifer_board.content import COMPONENT_KIND, THEME_KIND
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
def test_approbations_cycle(banc: Banc, kind: Kind, path: str, directory: str, file: str) -> None:
    root = f"/api/spaces/{A}/{path}"
    content = body(directory, file)
    if kind is COMPONENT_KIND:
        content["analysis"]["analysis_id"] = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    created = banc.appel(CREATEUR_GROUPE, "POST", root, json=content)
    assert created.status_code == 201
    ident = created.json()["id"]
    url = f"{root}/{ident}"
    approval = url + "/approvals"
    for profil in (CREATEUR_GROUPE, CREATEUR_PERSONNE, LECTEUR_GROUPE):
        refused = banc.appel(profil, "POST", approval, json={"revision": 1, "expected_revision": 1})
        assert refused.status_code == 403
        assert refused.json()["error"] == {"code": "forbidden", "required": "admin"}
    assert banc.appel(CREATEUR_PERSONNE, "GET", approval).status_code == 404
    assert (
        banc.appel(
            NON_MEMBRE, "POST", approval, json={"revision": 1, "expected_revision": 1}
        ).status_code
        == 404
    )
    assert banc.appel(CREATEUR_GROUPE, "GET", approval).json()["approvals"] == []
    assert banc.appel(ADMIN_GROUPE, "GET", approval).json()["approvals"] == []
    reader = banc.appel(LECTEUR_GROUPE, "GET", approval)
    assert reader.status_code == 403
    assert reader.json()["error"] == {"code": "forbidden", "required": "creator"}
    assert (
        banc.appel(
            ADMIN_GROUPE, "POST", approval, json={"revision": 2, "expected_revision": 1}
        ).status_code
        == 404
    )
    assert (
        banc.appel(
            ADMIN_GROUPE, "POST", approval, json={"revision": 1, "expected_revision": 2}
        ).status_code
        == 409
    )
    accepted = banc.appel(
        ADMIN_GROUPE, "POST", approval, json={"revision": 1, "expected_revision": 1}
    )
    assert accepted.status_code == 201, accepted.text
    assert accepted.json()["state"] == "approved" and accepted.json()["approved_revision"] == 1
    assert accepted.json()["diff"] is None and accepted.json()["index_state"] == "indexed"
    repeat = banc.appel(
        ADMIN_GROUPE, "POST", approval, json={"revision": 1, "expected_revision": 1}
    )
    assert repeat.status_code == 409 and repeat.json()["error"]["code"] == "already_approved"
    assert [
        a["revision"] for a in banc.appel(CREATEUR_PERSONNE, "GET", approval).json()["approvals"]
    ] == [1]
    assert (
        banc.appel(
            CREATEUR_GROUPE, "PUT", url, json={**content, "name": "Deux", "expected_revision": 1}
        ).status_code
        == 201
    )
    next_approval = banc.appel(
        ADMIN_GROUPE, "POST", approval, json={"revision": 2, "expected_revision": 2}
    )
    assert next_approval.status_code == 201
    assert next_approval.json()["approved_revision"] == 2
    assert any(change["path"] == "/name" for change in next_approval.json()["diff"])
    reindex(banc.depot, banc.index, banc.tableaux)
    assert banc.appel(CREATEUR_PERSONNE, "GET", url).json()["approved_revision"] == 2


def test_approbations_concurrentes(banc: Banc) -> None:
    root = f"/api/spaces/{A}/themes"
    ident = banc.appel(CREATEUR_GROUPE, "POST", root, json=body("themes", "clair.json")).json()[
        "id"
    ]
    url = f"{root}/{ident}/approvals"

    def approve() -> int:
        return banc.appel(
            ADMIN_GROUPE, "POST", url, json={"revision": 1, "expected_revision": 1}
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(lambda _: approve(), range(2))) == [201, 409]


def test_panne_index_ne_defait_pas_approbation(banc: Banc, monkeypatch: pytest.MonkeyPatch) -> None:
    from typing import Any

    from skifer_board.content.shared_index import SharedIndex
    from sqlalchemy.exc import SQLAlchemyError

    root = f"/api/spaces/{A}/themes"
    ident = banc.appel(CREATEUR_GROUPE, "POST", root, json=body("themes", "clair.json")).json()[
        "id"
    ]

    def unavailable(*args: Any, **kwargs: Any) -> bool:
        raise SQLAlchemyError("indisponible")

    with monkeypatch.context() as patch:
        patch.setattr(SharedIndex, "record_approvals", unavailable)
        response = banc.appel(
            ADMIN_GROUPE,
            "POST",
            f"{root}/{ident}/approvals",
            json={"revision": 1, "expected_revision": 1},
        )
        assert response.status_code == 201 and response.json()["index_state"] == "index_stale"
    assert (
        banc.depot.read_approvals(A, ident, kind=THEME_KIND).document["approvals"][0]["revision"]
        == 1
    )
    found = banc.appel(CREATEUR_PERSONNE, "GET", f"{root}/{ident}")
    assert found.status_code == 200 and found.json()["state"] == "approved"
    assert found.json()["index_state"] == "index_stale"
    assert (
        banc.appel(CREATEUR_PERSONNE, "GET", root).json()["themes"][0]["index_state"]
        == "index_stale"
    )
    reindex(banc.depot, banc.index, banc.tableaux)
    assert (
        banc.appel(CREATEUR_PERSONNE, "GET", f"{root}/{ident}").json()["index_state"] == "indexed"
    )


def test_lecture_approbations_pannes_et_suppression(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    from typing import Any

    from skifer_board.content.errors import ContentError
    from skifer_board.content.repository import ContentRepository

    root = f"/api/spaces/{A}/themes"
    ident = banc.appel(CREATEUR_GROUPE, "POST", root, json=body("themes", "clair.json")).json()[
        "id"
    ]
    url = f"{root}/{ident}/approvals"
    assert banc.appel(ADMIN_GROUPE, "POST", url, json={"revision": 1}).status_code == 400
    assert (
        banc.appel(
            ADMIN_GROUPE, "POST", url, json={"revision": 1, "expected_revision": 1}
        ).status_code
        == 201
    )
    original = ContentRepository.read_approvals
    calls = 0

    def approvals(self: ContentRepository, *args: Any, **kwargs: Any) -> Any:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise ContentError("content_unavailable", "git_failed")
        return original(self, *args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(ContentRepository, "read_approvals", approvals)
        assert banc.appel(CREATEUR_GROUPE, "GET", url).status_code == 503
    original_head = ContentRepository.head
    head_calls = 0

    def changed(self: ContentRepository) -> str | None:
        nonlocal head_calls
        head_calls += 1
        return original_head(self) if head_calls < 3 else "changed"

    with monkeypatch.context() as patch:
        patch.setattr(ContentRepository, "head", changed)
        assert banc.appel(CREATEUR_GROUPE, "GET", url).status_code == 200
    assert (
        banc.appel(
            CREATEUR_GROUPE, "DELETE", f"{root}/{ident}", params={"expected_revision": 1}
        ).status_code
        == 204
    )
    assert banc.appel(CREATEUR_GROUPE, "GET", url).status_code == 404


def test_index_approbations_monotone(banc: Banc) -> None:
    from dataclasses import replace

    from skifer_board.content.shared_index import SharedIndex

    index = SharedIndex(banc.monde.moteur)
    root = f"/api/spaces/{A}/themes"
    ident = banc.appel(CREATEUR_GROUPE, "POST", root, json=body("themes", "clair.json")).json()[
        "id"
    ]
    assert not index.record_approvals("theme", A, "11111111-1111-4111-8111-111111111111", 1, [])
    assert not index.record_approvals("theme", A, ident, 2, [])
    approval = f"{root}/{ident}/approvals"
    assert (
        banc.appel(
            ADMIN_GROUPE, "POST", approval, json={"revision": 1, "expected_revision": 1}
        ).status_code
        == 201
    )
    row = index.get("theme", A, ident)
    assert row is not None and row.approved_revision == 1
    index.upsert(replace(row, revision=2, approved_revision=None))
    current = index.get("theme", A, ident)
    assert current is not None and current.approved_revision == 1


def test_approbation_mode_local(service: CatalogService, tmp_path: Path) -> None:
    from fastapi.testclient import TestClient
    from skifer_board.server import create_app

    from .monde import init, repository

    app = create_app(service, content_repository=repository(init(tmp_path / "contenus")))
    with TestClient(app, base_url="http://127.0.0.1") as client:
        response = client.post(
            "/api/spaces/local/themes/id/approvals",
            json={"revision": 1, "expected_revision": 1},
            headers={"Origin": "http://127.0.0.1"},
        )
        assert response.status_code == 409 and response.json()["error"]["code"] == "local_mode"


@pytest.mark.parametrize("kind,path,directory,file", CASES)
def test_approbation_identifiant_malforme(
    banc: Banc, kind: Kind, path: str, directory: str, file: str
) -> None:
    response = banc.appel(
        ADMIN_GROUPE,
        "POST",
        f"/api/spaces/{A}/{path}/malforme/approvals",
        json={"revision": 1, "expected_revision": 1},
    )
    assert response.status_code == 404
    assert response.json()["error"] == {"code": kind.not_found}


def test_codes_depot_et_approbations_ont_un_statut() -> None:
    from skifer_board.content import errors
    from skifer_board.content.repository import KINDS
    from skifer_board.content.web import _STATUS

    codes = {
        errors.CONTENT_UNAVAILABLE,
        errors.REVISION_CONFLICT,
        errors.INVALID_APPROVALS,
        errors.APPROVALS_NOT_FOUND,
        errors.ALREADY_APPROVED,
        *(kind.invalid for kind in KINDS),
        *(kind.not_found for kind in KINDS),
    }
    assert codes <= _STATUS.keys()


def test_approbation_ancienne_revision_na_pas_de_base_future(banc: Banc) -> None:
    root = f"/api/spaces/{A}/themes"
    contenu = body("themes", "clair.json")
    ident = banc.appel(CREATEUR_GROUPE, "POST", root, json=contenu).json()["id"]
    url = f"{root}/{ident}"
    assert (
        banc.appel(
            CREATEUR_GROUPE, "PUT", url, json={**contenu, "name": "Deux", "expected_revision": 1}
        ).status_code
        == 201
    )
    assert (
        banc.appel(
            ADMIN_GROUPE, "POST", f"{url}/approvals", json={"revision": 2, "expected_revision": 2}
        ).status_code
        == 201
    )
    older = banc.appel(
        ADMIN_GROUPE, "POST", f"{url}/approvals", json={"revision": 1, "expected_revision": 2}
    )
    assert older.status_code == 201
    assert older.json()["diff"] is None


def test_approbation_index_seul_ne_rend_pas_un_brouillon_visible(banc: Banc) -> None:
    from datetime import UTC, datetime

    from skifer_board.content.shared_index import ApprovalRow, SharedIndex

    root = f"/api/spaces/{A}/themes"
    ident = banc.appel(CREATEUR_GROUPE, "POST", root, json=body("themes", "clair.json")).json()[
        "id"
    ]
    index = SharedIndex(banc.monde.moteur)
    assert index.record_approvals(
        "theme",
        A,
        ident,
        1,
        [ApprovalRow("theme", A, ident, 1, ADMIN_GROUPE.ref, datetime.now(UTC))],
    )
    assert banc.appel(CREATEUR_PERSONNE, "GET", f"{root}/{ident}").status_code == 404
    assert banc.appel(CREATEUR_PERSONNE, "GET", root).json()["themes"] == []
    own = banc.appel(CREATEUR_GROUPE, "GET", f"{root}/{ident}")
    assert own.json()["state"] == "draft" and own.json()["index_state"] == "index_stale"


def test_approbation_reessaie_la_tete(banc: Banc, monkeypatch: pytest.MonkeyPatch) -> None:
    from typing import Any

    from skifer_board.content.errors import ContentError
    from skifer_board.content.repository import ContentRepository

    root = f"/api/spaces/{A}/themes"
    ident = banc.appel(CREATEUR_GROUPE, "POST", root, json=body("themes", "clair.json")).json()[
        "id"
    ]
    original = ContentRepository.approve
    remaining = 1

    def unstable(self: Any, *args: Any, **kwargs: Any) -> Any:
        nonlocal remaining
        if remaining:
            remaining -= 1
            raise ContentError("content_unavailable", "head_changed")
        return original(self, *args, **kwargs)

    monkeypatch.setattr(ContentRepository, "approve", unstable)
    approval = f"{root}/{ident}/approvals"
    response = banc.appel(
        ADMIN_GROUPE, "POST", approval, json={"revision": 1, "expected_revision": 1}
    )
    assert response.status_code == 201, response.text
    remaining = 2
    refused = banc.appel(
        ADMIN_GROUPE, "POST", approval, json={"revision": 1, "expected_revision": 1}
    )
    assert refused.status_code == 409
    assert refused.json()["error"] == {"code": "revision_conflict", "reason": "stale"}
