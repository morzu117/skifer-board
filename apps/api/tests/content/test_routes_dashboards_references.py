"""Références approuvées et brouillons des dashboards."""

from __future__ import annotations

from typing import Any

from skifer_board.content import THEME_KIND
from spaces.monde import ADMIN_GROUPE, CREATEUR_GROUPE, CREATEUR_PERSONNE, LECTEUR_GROUPE, A

from .monde_dashboard import new_id, text
from .serveur import Banc, corps_tableau
from .test_routes_shared_cycle import body


def creer_partages(banc: Banc) -> tuple[str, str]:
    theme = banc.appel(
        CREATEUR_GROUPE, "POST", f"/api/spaces/{A}/themes", json=body("themes", "clair.json")
    )
    assert theme.status_code == 201
    analyse = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    contenu = body("components", "base.json")
    contenu["analysis"]["analysis_id"] = analyse
    composant = banc.appel(CREATEUR_GROUPE, "POST", f"/api/spaces/{A}/components", json=contenu)
    assert composant.status_code == 201
    return theme.json()["id"], composant.json()["id"]


def dashboard(theme: str, composant: str, visibility: str) -> tuple[dict[str, Any], str]:
    node_id = new_id()
    node = {
        "id": node_id,
        "type": "component",
        "component": {"component_id": composant, "revision": 1},
    }
    return corps_tableau(
        text(), node, visibility=visibility, theme={"theme_id": theme, "revision": 1}
    ), node_id


def test_brouillons_approbations_et_lecture(banc: Banc) -> None:
    theme, composant = creer_partages(banc)
    root = f"/api/spaces/{A}/dashboards"
    shared, node = dashboard(theme, composant, "shared")
    refused = banc.appel(CREATEUR_GROUPE, "POST", root, json=shared)
    assert refused.status_code == 422, refused.text
    assert refused.json()["error"]["code"] == "unapproved_reference"
    assert "/theme" in refused.json()["error"]["paths"]
    assert len(refused.json()["error"]["paths"]) == 2
    personal = {**shared, "visibility": "personal"}
    created = banc.appel(CREATEUR_GROUPE, "POST", root, json=personal)
    assert created.status_code == 201, created.text
    ident = created.json()["id"]
    assert created.json()["resolved"]["theme"]["id"] == theme
    assert created.json()["resolved"]["components"][node]["id"] == composant
    rejected = banc.appel(
        CREATEUR_GROUPE,
        "POST",
        f"{root}/{ident}/revisions",
        json={**shared, "expected_revision": 1},
    )
    assert (
        rejected.status_code == 422 and rejected.json()["error"]["code"] == "unapproved_reference"
    )
    for segment, content_id in (("themes", theme), ("components", composant)):
        response = banc.appel(
            ADMIN_GROUPE,
            "POST",
            f"/api/spaces/{A}/{segment}/{content_id}/approvals",
            json={"revision": 1, "expected_revision": 1},
        )
        assert response.status_code == 201, response.text
    revised = banc.appel(
        CREATEUR_GROUPE,
        "POST",
        f"{root}/{ident}/revisions",
        json={**shared, "expected_revision": 1},
    )
    assert revised.status_code == 201, revised.text
    reader = banc.appel(LECTEUR_GROUPE, "GET", f"{root}/{ident}")
    assert reader.status_code == 200
    assert reader.json()["resolved"]["theme"]["id"] == theme
    assert reader.json()["resolved"]["components"][node]["id"] == composant
    indexed = banc.tableaux.get(A, ident)
    assert indexed is not None and indexed.theme == (theme, 1)
    assert indexed.components[0].component_ref_id == composant
    banc.depot.delete(A, theme, expected_revision=1, actor=CREATEUR_GROUPE.ref, kind=THEME_KIND)
    reread = banc.appel(LECTEUR_GROUPE, "GET", f"{root}/{ident}")
    assert reread.status_code == 200 and "theme" not in reread.json()["resolved"]


def test_brouillon_autrui_indiscernable(banc: Banc) -> None:
    root = f"/api/spaces/{A}/themes"
    foreign = banc.appel(CREATEUR_PERSONNE, "POST", root, json=body("themes", "clair.json")).json()[
        "id"
    ]
    target = f"/api/spaces/{A}/dashboards"

    def attempt(ident: str) -> Any:
        return banc.appel(
            CREATEUR_GROUPE,
            "POST",
            target,
            json=corps_tableau(
                text(), visibility="personal", theme={"theme_id": ident, "revision": 1}
            ),
        )

    hidden = attempt(foreign)
    missing = attempt(new_id())
    assert hidden.status_code == missing.status_code == 422
    assert hidden.json() == missing.json()
    assert hidden.json()["error"]["violations"] == [{"path": "/theme", "rule": "theme_not_found"}]
    approval = banc.appel(
        ADMIN_GROUPE,
        "POST",
        f"{root}/{foreign}/approvals",
        json={"revision": 1, "expected_revision": 1},
    )
    assert approval.status_code == 201
    accepted = banc.appel(
        CREATEUR_GROUPE,
        "POST",
        target,
        json=corps_tableau(text(), visibility="shared", theme={"theme_id": foreign, "revision": 1}),
    )
    assert accepted.status_code == 201, accepted.text


def test_reference_composant_absent_et_modele_informatif(banc: Banc) -> None:
    root = f"/api/spaces/{A}/dashboards"
    node_id = new_id()
    component = {
        "id": node_id,
        "type": "component",
        "component": {"component_id": new_id(), "revision": 1},
    }
    missing = banc.appel(CREATEUR_GROUPE, "POST", root, json=corps_tableau(component))
    assert missing.status_code == 422
    assert missing.json()["error"]["violations"][0]["rule"] == "component_not_found"
    template = {"template_id": new_id(), "revision": 7}
    accepted = banc.appel(
        CREATEUR_GROUPE, "POST", root, json=corps_tableau(text(), template=template)
    )
    assert accepted.status_code == 201, accepted.text


def test_lecture_sur_panne_de_reference(banc: Banc, monkeypatch: Any) -> None:
    from skifer_board.content import THEME_KIND
    from skifer_board.content.errors import ContentError
    from skifer_board.content.repository import ContentRepository

    theme, component = creer_partages(banc)
    content, _ = dashboard(theme, component, "personal")
    root = f"/api/spaces/{A}/dashboards"
    ident = banc.appel(CREATEUR_GROUPE, "POST", root, json=content).json()["id"]
    original = ContentRepository.glance

    def glance(self: ContentRepository, *args: Any, **kwargs: Any) -> Any:
        if kwargs.get("kind") is THEME_KIND:
            raise ContentError("content_unavailable", "git_failed")
        return original(self, *args, **kwargs)

    monkeypatch.setattr(ContentRepository, "glance", glance)
    response = banc.appel(CREATEUR_GROUPE, "GET", f"{root}/{ident}")
    assert response.status_code == 200 and "theme" not in response.json()["resolved"]


def test_resolution_sur_revisions_absentes_et_pannes() -> None:
    from types import SimpleNamespace
    from unittest.mock import MagicMock

    import pytest
    from skifer_board.content.dashboard_shared import (
        references,
        resolve_references,
        validate_references,
    )
    from skifer_board.content.errors import ContentError
    from skifer_board.content.repository import ContentRepository
    from skifer_board.spaces.model import PersonRef

    from .monde_dashboard import column, container, row, with_components

    ident = new_id()
    node = {
        "id": new_id(),
        "type": "component",
        "component": {"component_id": ident, "revision": 2},
    }
    document = with_components(container(row(column(node))))
    assert next(references(document))[0].endswith("/rows/0/columns/0/children/0")
    repo = MagicMock(spec=ContentRepository)
    owner = PersonRef(document["owner"]["issuer"], document["owner"]["subject"])
    repo.glance.return_value = SimpleNamespace(owner=owner, deleted=False)
    repo.head.return_value = "tip"
    repo.read_approvals.side_effect = ContentError("approvals_not_found", "missing")
    violations, _ = validate_references(repo, A, document, None)
    assert violations[0].rule == "component_not_found"
    assert resolve_references(repo, A, document, None) == {"components": {}}
    repo.glance.return_value = SimpleNamespace(owner=None, deleted=False)
    assert resolve_references(repo, A, document, "tip") == {"components": {}}
    repo.glance.return_value = SimpleNamespace(owner=owner, deleted=True)
    assert resolve_references(repo, A, document, "tip") == {"components": {}}
    repo.glance.return_value = SimpleNamespace(owner=owner, deleted=False)
    repo.read.side_effect = ContentError("component_not_found", "missing_revision")
    violations, _ = validate_references(repo, A, document, "tip")
    assert violations[0].rule == "component_not_found"
    assert resolve_references(repo, A, document, "tip")["components"] == {}
    repo.read.side_effect = ContentError("content_unavailable", "git_failed")
    with pytest.raises(ContentError, match="content_unavailable"):
        validate_references(repo, A, document, "tip")
    repo.read_approvals.side_effect = ContentError("content_unavailable", "git_failed")
    with pytest.raises(ContentError, match="content_unavailable"):
        validate_references(repo, A, document, "tip")
    repo.read_approvals.side_effect = ContentError("approvals_not_found", "missing")
    repo.head.return_value = "new"
    repo.read.side_effect = None
    validate_references(repo, A, document, "tip")
    assert repo.read_approvals.call_args.kwargs["at"] == "tip"


def test_revision_approuvee_exacte_et_lecture_epinglee(banc: Banc) -> None:
    theme, component = creer_partages(banc)
    for segment, ident in (("themes", theme), ("components", component)):
        url = f"/api/spaces/{A}/{segment}/{ident}"
        assert (
            banc.appel(
                ADMIN_GROUPE,
                "POST",
                f"{url}/approvals",
                json={"revision": 1, "expected_revision": 1},
            ).status_code
            == 201
        )
        original = banc.appel(CREATEUR_GROUPE, "GET", url).json()
        key = "theme" if segment == "themes" else "component"
        payload = {
            k: v for k, v in original[key].items() if k not in ("id", "api_version", "owner")
        }
        updated = banc.appel(
            CREATEUR_GROUPE,
            "PUT",
            url,
            json={**payload, "name": "SECRET-DRAFT", "expected_revision": 1},
        )
        assert updated.status_code == 201, updated.text
    root = f"/api/spaces/{A}/dashboards"
    shared, node = dashboard(theme, component, "shared")
    r1 = banc.appel(CREATEUR_GROUPE, "POST", root, json=shared)
    assert r1.status_code == 201, r1.text
    for role in (LECTEUR_GROUPE, CREATEUR_PERSONNE, ADMIN_GROUPE):
        read = banc.appel(role, "GET", f"{root}/{r1.json()['id']}")
        assert read.status_code == 200
        assert "SECRET-DRAFT" not in read.text
        assert read.json()["resolved"]["theme"]["name"] != "SECRET-DRAFT"
        assert read.json()["resolved"]["components"][node]["name"] != "SECRET-DRAFT"
    for kind in ("theme", "component"):
        content, _ = dashboard(theme, component, "shared")
        if kind == "theme":
            content["theme"]["revision"] = 2
        else:
            content["layout"]["sections"][0]["rows"][0]["columns"][0]["children"][1]["component"][
                "revision"
            ] = 2
        rejected = banc.appel(CREATEUR_GROUPE, "POST", root, json=content)
        assert (
            rejected.status_code == 422
            and rejected.json()["error"]["code"] == "unapproved_reference"
        )
        personal = {**content, "visibility": "personal"}
        saved = banc.appel(CREATEUR_GROUPE, "POST", root, json=personal)
        assert saved.status_code == 201, saved.text
        changed = banc.appel(
            CREATEUR_GROUPE,
            "POST",
            f"{root}/{saved.json()['id']}/revisions",
            json={**content, "expected_revision": 1},
        )
        assert (
            changed.status_code == 422 and changed.json()["error"]["code"] == "unapproved_reference"
        )


def test_theme_bloque_absent_de_la_resolution(banc: Banc, monkeypatch: Any) -> None:
    from skifer_board.content import dashboard_web
    from skifer_board.content.dashboard_shared import validate_references
    from skifer_board.content.errors import Violation

    theme, component = creer_partages(banc)
    content, _ = dashboard(theme, component, "personal")
    root = f"/api/spaces/{A}/dashboards"
    saved = banc.appel(CREATEUR_GROUPE, "POST", root, json=content)
    assert saved.status_code == 201
    original = validate_references

    def blocked(*args: Any, **kwargs: Any) -> Any:
        violations, unapproved = original(*args, **kwargs)
        if "theme" in args[2]:
            violations.append(Violation("/theme", "theme_not_found"))
        return violations, unapproved

    monkeypatch.setattr(dashboard_web, "validate_references", blocked)
    read = banc.appel(CREATEUR_GROUPE, "GET", f"{root}/{saved.json()['id']}")
    assert read.status_code == 200
    assert "theme" not in read.json()["resolved"]


def test_conflit_tete_publication_reessaye_une_fois(banc: Banc, monkeypatch: Any) -> None:
    from skifer_board.content.repository import ContentRepository

    theme, component = creer_partages(banc)
    content, _ = dashboard(theme, component, "personal")
    original = ContentRepository.write
    remaining = 1

    def concurrent(self: Any, *args: Any, **kwargs: Any) -> Any:
        nonlocal remaining
        if kwargs.get("expected_head") is not None and remaining:
            remaining -= 1
            ident = new_id()
            doc = {
                "api_version": "board.theme/v1",
                "id": ident,
                "owner": {
                    "issuer": CREATEUR_GROUPE.ref.issuer,
                    "subject": CREATEUR_GROUPE.ref.subject,
                },
                **body("themes", "clair.json"),
            }
            original(
                self,
                A,
                ident,
                doc,
                expected_revision=None,
                actor=CREATEUR_GROUPE.ref,
                kind=THEME_KIND,
            )
        return original(self, *args, **kwargs)

    monkeypatch.setattr(ContentRepository, "write", concurrent)
    root = f"/api/spaces/{A}/dashboards"
    ok = banc.appel(CREATEUR_GROUPE, "POST", root, json=content)
    assert ok.status_code == 201, ok.text
    remaining = 2
    refused = banc.appel(CREATEUR_GROUPE, "POST", root, json=content)
    assert refused.status_code == 409
    assert refused.json()["error"] == {"code": "revision_conflict", "reason": "stale"}
    url = f"{root}/{ok.json()['id']}/revisions"
    remaining = 1
    revised = banc.appel(
        CREATEUR_GROUPE, "POST", url, json={**content, "name": "Révisé", "expected_revision": 1}
    )
    assert revised.status_code == 201, revised.text
    remaining = 2
    refused = banc.appel(
        CREATEUR_GROUPE, "POST", url, json={**content, "name": "Encore", "expected_revision": 2}
    )
    assert refused.status_code == 409
    assert refused.json()["error"] == {"code": "revision_conflict", "reason": "stale"}


def test_reessai_tete_preserve_les_autres_erreurs() -> None:
    import pytest
    from skifer_board.content.errors import ContentError
    from skifer_board.content.web import retry_head

    def fail() -> None:
        raise ContentError("content_unavailable", "git_failed")

    with pytest.raises(ContentError) as error:
        retry_head(fail)
    assert error.value.reason == "git_failed"

    calls = 0

    def unstable() -> str:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise ContentError("content_unavailable", "head_changed")
        return "ok"

    assert retry_head(unstable) == "ok" and calls == 2


def test_les_contrats_de_routes_ne_revelent_pas_la_tete_git() -> None:
    from pathlib import Path

    root = Path(__file__).resolve().parents[4] / "contracts"
    files = [p for p in root.glob("*/routes/*.json")]
    assert files
    assert all("head_changed" not in p.read_text(encoding="utf-8") for p in files)
