"""Consommateurs directs et transitifs des contenus partagés."""

from __future__ import annotations

from typing import Any

import pytest
from skifer_board.content import COMPONENT_KIND
from skifer_board.content.index import DashboardIndex
from spaces.monde import ADMIN_GROUPE, CREATEUR_GROUPE, CREATEUR_PERSONNE, A
from sqlalchemy.exc import SQLAlchemyError

from .monde_dashboard import text
from .serveur import Banc, corps_tableau
from .test_routes_dashboards_references import creer_partages, dashboard
from .test_routes_shared_cycle import body


@pytest.mark.parametrize("kind", ["themes", "components"])
def test_refus_consumers_visibles_masques_et_retrait(
    banc: Banc, kind: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    theme, component = creer_partages(banc)
    for segment, ident in (("themes", theme), ("components", component)):
        approved = banc.appel(
            ADMIN_GROUPE,
            "POST",
            f"/api/spaces/{A}/{segment}/{ident}/approvals",
            json={"revision": 1, "expected_revision": 1},
        )
        assert approved.status_code == 201
    root = f"/api/spaces/{A}/dashboards"
    shared, _ = dashboard(theme, component, "shared")
    personal, _ = dashboard(theme, component, "personal")
    visible = banc.appel(CREATEUR_GROUPE, "POST", root, json=shared)
    hidden = banc.appel(CREATEUR_PERSONNE, "POST", root, json=personal)
    assert visible.status_code == hidden.status_code == 201
    target = theme if kind == "themes" else component
    url = f"/api/spaces/{A}/{kind}/{target}"

    def refused() -> Any:
        return banc.appel(CREATEUR_GROUPE, "DELETE", url, params={"expected_revision": 1})

    response = refused()
    assert response.status_code == 409
    assert response.json()["error"] == {
        "code": "content_in_use",
        "consumers": [{"kind": "dashboard", "id": visible.json()["id"]}],
        "others": 1,
    }
    assert hidden.json()["id"] not in response.text

    def panne(*args: Any, **kwargs: Any) -> Any:
        raise SQLAlchemyError("base indisponible")

    with monkeypatch.context() as patch:
        patch.setattr(DashboardIndex, "rows", panne)
        failure = refused()
        assert failure.status_code == 503
        assert failure.json() == {"error": {"code": "content_unavailable"}}
        listing = banc.appel(CREATEUR_GROUPE, "GET", url + "/consumers")
        assert listing.status_code == 503
        assert listing.json() == failure.json()
    original_get = DashboardIndex.get
    for mode in ("missing", "error", "stale"):
        with monkeypatch.context() as patch:

            def lookup(*args: Any, _mode: str = mode, **kwargs: Any) -> Any:
                if _mode == "error":
                    raise SQLAlchemyError("index")
                if _mode == "missing":
                    return None
                from dataclasses import replace

                found = original_get(*args, **kwargs)
                return None if found is None else replace(found, commit="f" * 40)

            patch.setattr(DashboardIndex, "get", lookup)
            observed = refused()
            if mode == "error":
                assert observed.status_code == 503
                assert observed.json()["error"]["code"] == "content_unavailable"
            else:
                assert observed.json() == response.json()
    for profile, item, visibility in (
        (CREATEUR_GROUPE, visible, "shared"),
        (CREATEUR_PERSONNE, hidden, "personal"),
    ):
        changed = banc.appel(
            profile,
            "POST",
            f"{root}/{item.json()['id']}/revisions",
            json={**corps_tableau(text(), visibility=visibility), "expected_revision": 1},
        )
        assert changed.status_code == 201, changed.text
    assert refused().status_code == 204


@pytest.mark.parametrize("kind", ["themes", "components"])
def test_seule_la_revision_courante_bloque(banc: Banc, kind: str) -> None:
    theme, component = creer_partages(banc)
    content, _ = dashboard(theme, component, "personal")
    created = banc.appel(CREATEUR_GROUPE, "POST", f"/api/spaces/{A}/dashboards", json=content)
    assert created.status_code == 201
    target = theme if kind == "themes" else component
    raw = body("themes", "clair.json") if kind == "themes" else body("components", "base.json")
    if kind == "components":
        raw["analysis"]["analysis_id"] = banc.depot.read(
            A, component, kind=COMPONENT_KIND
        ).document["analysis"]["analysis_id"]
    root = f"/api/spaces/{A}/{kind}/{target}"
    revised = banc.appel(
        CREATEUR_GROUPE, "PUT", root, json={**raw, "name": "Deux", "expected_revision": 1}
    )
    assert revised.status_code == 201
    assert (
        banc.appel(CREATEUR_GROUPE, "DELETE", root, params={"expected_revision": 2}).status_code
        == 204
    )


def test_consommateurs_analyse_directs_et_transitifs(banc: Banc) -> None:
    theme, component = creer_partages(banc)
    analysis_id = banc.depot.read(A, component, kind=COMPONENT_KIND).document["analysis"][
        "analysis_id"
    ]
    content, _ = dashboard(theme, component, "personal")
    dashboard_url = f"/api/spaces/{A}/dashboards"
    created = banc.appel(CREATEUR_GROUPE, "POST", dashboard_url, json=content)
    assert created.status_code == 201
    analysis_url = f"/api/spaces/{A}/analyses/{analysis_id}"
    other = banc.appel(CREATEUR_PERSONNE, "GET", analysis_url + "/consumers")
    assert (
        other.status_code == 200 and other.json()["consumers"] == [] and other.json()["others"] == 2
    )
    assert component not in other.text and created.json()["id"] not in other.text
    refusal = banc.appel(CREATEUR_GROUPE, "DELETE", analysis_url, params={"expected_revision": 1})
    assert refusal.status_code == 409
    assert set((item["kind"], item["id"]) for item in refusal.json()["error"]["consumers"]) == {
        ("dashboard", created.json()["id"]),
        ("component", component),
    }
    changed = banc.appel(
        CREATEUR_GROUPE,
        "POST",
        f"{dashboard_url}/{created.json()['id']}/revisions",
        json={**corps_tableau(text()), "expected_revision": 1},
    )
    assert changed.status_code == 201
    assert (
        banc.appel(
            CREATEUR_GROUPE,
            "DELETE",
            f"/api/spaces/{A}/components/{component}",
            params={"expected_revision": 1},
        ).status_code
        == 204
    )
    assert (
        banc.appel(
            CREATEUR_GROUPE, "DELETE", analysis_url, params={"expected_revision": 1}
        ).status_code
        == 204
    )


def test_dependance_transitive_garde_la_revision_epinglee(banc: Banc) -> None:
    theme, component = creer_partages(banc)
    old_id = banc.depot.read(A, component, kind=COMPONENT_KIND).document["analysis"]["analysis_id"]
    content, _ = dashboard(theme, component, "personal")
    root = f"/api/spaces/{A}/dashboards"
    saved = banc.appel(CREATEUR_GROUPE, "POST", root, json=content)
    assert saved.status_code == 201
    newer_id = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    changed = body("components", "base.json")
    changed["analysis"]["analysis_id"] = newer_id
    revised = banc.appel(
        CREATEUR_GROUPE,
        "PUT",
        f"/api/spaces/{A}/components/{component}",
        json={**changed, "expected_revision": 1},
    )
    assert revised.status_code == 201
    old_url = f"/api/spaces/{A}/analyses/{old_id}"
    old = banc.appel(CREATEUR_GROUPE, "GET", old_url + "/consumers")
    assert old.json()["consumers"] == [{"kind": "dashboard", "id": saved.json()["id"]}]
    assert (
        banc.appel(CREATEUR_GROUPE, "DELETE", old_url, params={"expected_revision": 1}).status_code
        == 409
    )
    new_url = f"/api/spaces/{A}/analyses/{newer_id}"
    new = banc.appel(CREATEUR_GROUPE, "GET", new_url + "/consumers")
    assert new.json()["consumers"] == [{"kind": "component", "id": component}]
    assert (
        banc.appel(CREATEUR_GROUPE, "DELETE", new_url, params={"expected_revision": 1}).status_code
        == 409
    )


def test_visibilite_du_composant_consommateur(banc: Banc) -> None:
    from spaces.monde import LECTEUR_GROUPE

    _, component = creer_partages(banc)
    analysis = banc.depot.read(A, component, kind=COMPONENT_KIND).document["analysis"][
        "analysis_id"
    ]
    url = f"/api/spaces/{A}/analyses/{analysis}/consumers"
    for profile, visible, others in (
        (CREATEUR_GROUPE, True, 0),
        (ADMIN_GROUPE, True, 0),
        (CREATEUR_PERSONNE, False, 1),
        (LECTEUR_GROUPE, False, 1),
    ):
        response = banc.appel(profile, "GET", url)
        assert response.status_code == 200
        assert response.json()["consumers"] == (
            [{"kind": "component", "id": component}] if visible else []
        )
        assert response.json()["others"] == others
    from skifer_board.content.dashboard_web import DashboardConsumers

    anonymous_role = DashboardConsumers(banc.depot, banc.tableaux)(
        A, analysis, CREATEUR_GROUPE.ref, banc.depot.head()
    )
    assert anonymous_role.visible == () and anonymous_role.others == 1
    before = banc.depot.head()
    accepted = banc.appel(
        ADMIN_GROUPE,
        "POST",
        f"/api/spaces/{A}/components/{component}/approvals",
        json={"revision": 1, "expected_revision": 1},
    )
    assert accepted.status_code == 201
    now_visible = banc.appel(CREATEUR_PERSONNE, "GET", url)
    assert now_visible.json()["consumers"] == [{"kind": "component", "id": component}]
    assert now_visible.json()["others"] == 0
    from skifer_board.content import ContentError

    with pytest.raises(ContentError, match="approvals_not_found"):
        banc.depot.read_approvals(A, component, kind=COMPONENT_KIND, at=before)


def test_une_reference_publiee_pendant_la_suppression_est_recontrolee(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    from skifer_board.content.repository import DASHBOARD_KIND
    from skifer_board.content.shared_consumers import SharedConsumers

    from .monde_dashboard import with_components

    theme, _ = creer_partages(banc)
    original = SharedConsumers.__call__
    calls = 0
    owner = CREATEUR_GROUPE.ref
    document = with_components(
        text(),
        visibility="shared",
        theme={"theme_id": theme, "revision": 1},
        owner={"issuer": owner.issuer, "subject": owner.subject},
    )

    def intercaler(self: SharedConsumers, *args: Any) -> Any:
        nonlocal calls
        result = original(self, *args)
        calls += 1
        if calls == 1:
            banc.depot.write(
                A,
                document["id"],
                document,
                expected_revision=None,
                actor=owner,
                kind=DASHBOARD_KIND,
            )
        return result

    monkeypatch.setattr(SharedConsumers, "__call__", intercaler)
    response = banc.appel(
        CREATEUR_GROUPE,
        "DELETE",
        f"/api/spaces/{A}/themes/{theme}",
        params={"expected_revision": 1},
    )
    assert calls == 2 and response.status_code == 409
    assert response.json()["error"]["code"] == "content_in_use"
    assert response.json()["error"]["consumers"] == [{"kind": "dashboard", "id": document["id"]}]


def test_validation_et_publication_sur_la_meme_tete(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    from skifer_board.content import THEME_KIND
    from skifer_board.content.repository import DASHBOARD_KIND, ContentRepository

    theme, _ = creer_partages(banc)
    document = corps_tableau(text(), theme={"theme_id": theme, "revision": 1})
    original = ContentRepository.write
    called = False

    def intercaler(self: ContentRepository, *args: Any, **kwargs: Any) -> Any:
        nonlocal called
        if kwargs.get("kind") is DASHBOARD_KIND and not called:
            called = True
            banc.depot.delete(
                A, theme, expected_revision=1, actor=CREATEUR_GROUPE.ref, kind=THEME_KIND
            )
        return original(self, *args, **kwargs)

    monkeypatch.setattr(ContentRepository, "write", intercaler)
    response = banc.appel(CREATEUR_GROUPE, "POST", f"/api/spaces/{A}/dashboards", json=document)
    assert called and response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_dashboard"
    assert response.json()["error"]["reason"] == "theme_not_found"


def test_une_analyse_supprimee_avant_publication_du_composant(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    from skifer_board.content.repository import ContentRepository

    analysis = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    document = body("components", "base.json")
    document["analysis"]["analysis_id"] = analysis
    original = ContentRepository.write
    called = False

    def intercaler(self: ContentRepository, *args: Any, **kwargs: Any) -> Any:
        nonlocal called
        if kwargs.get("kind") is COMPONENT_KIND and not called:
            called = True
            banc.depot.delete(A, analysis, expected_revision=1, actor=CREATEUR_GROUPE.ref)
        return original(self, *args, **kwargs)

    monkeypatch.setattr(ContentRepository, "write", intercaler)
    response = banc.appel(CREATEUR_GROUPE, "POST", f"/api/spaces/{A}/components", json=document)
    assert called and response.status_code == 404
    assert response.json()["error"]["code"] == "analysis_not_found"


def test_index_dashboard_absent_ou_perime_relu_et_panne_refusee(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    theme, component = creer_partages(banc)
    analysis = banc.depot.read(A, component, kind=COMPONENT_KIND).document["analysis"][
        "analysis_id"
    ]
    content, _ = dashboard(theme, component, "personal")
    saved = banc.appel(CREATEUR_GROUPE, "POST", f"/api/spaces/{A}/dashboards", json=content)
    assert saved.status_code == 201
    url = f"/api/spaces/{A}/analyses/{analysis}/consumers"
    original_get = DashboardIndex.get
    for unavailable in (False, True, "different"):
        with monkeypatch.context() as patch:

            def missing(*args: Any, _unavailable: bool | str = unavailable, **kwargs: Any) -> Any:
                if _unavailable == "different":
                    from dataclasses import replace

                    row = original_get(*args, **kwargs)
                    return None if row is None else replace(row, commit="f" * 40)
                if _unavailable:
                    raise SQLAlchemyError("index")
                return None

            patch.setattr(DashboardIndex, "get", missing)
            response = banc.appel(CREATEUR_GROUPE, "GET", url)
            if unavailable is True:
                assert response.status_code == 503
                assert response.json()["error"]["code"] == "content_unavailable"
            else:
                assert response.status_code == 200
                assert ("dashboard", saved.json()["id"]) in {
                    (item["kind"], item["id"]) for item in response.json()["consumers"]
                }


def test_suppression_si_index_indisponible_sans_consommateur(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    theme, component = creer_partages(banc)
    analysis = banc.depot.read(A, component, kind=COMPONENT_KIND).document["analysis"][
        "analysis_id"
    ]

    def panne(*args: Any, **kwargs: Any) -> Any:
        raise SQLAlchemyError("indisponible")

    monkeypatch.setattr(DashboardIndex, "rows", panne)
    assert (
        banc.appel(
            CREATEUR_GROUPE,
            "DELETE",
            f"/api/spaces/{A}/themes/{theme}",
            params={"expected_revision": 1},
        ).status_code
        == 503
    )
    assert (
        banc.appel(
            CREATEUR_GROUPE,
            "DELETE",
            f"/api/spaces/{A}/components/{component}",
            params={"expected_revision": 1},
        ).status_code
        == 503
    )
    assert (
        banc.appel(
            CREATEUR_GROUPE, "GET", f"/api/spaces/{A}/analyses/{analysis}/consumers"
        ).status_code
        == 503
    )
    assert (
        banc.appel(
            CREATEUR_GROUPE,
            "DELETE",
            f"/api/spaces/{A}/analyses/{analysis}",
            params={"expected_revision": 1},
        ).status_code
        == 503
    )


def test_consommateurs_composants_illisibles_restent_fermes(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    from skifer_board.content.errors import ContentError
    from skifer_board.content.repository import ContentRepository

    theme, component = creer_partages(banc)
    analysis = banc.depot.read(A, component, kind=COMPONENT_KIND).document["analysis"][
        "analysis_id"
    ]
    content, _ = dashboard(theme, component, "personal")
    saved = banc.appel(CREATEUR_GROUPE, "POST", f"/api/spaces/{A}/dashboards", json=content)
    assert saved.status_code == 201
    url = f"/api/spaces/{A}/analyses/{analysis}/consumers"
    original = ContentRepository.read
    for revision_only, reason, expected_status in (
        (False, "stored_invalid", 200),
        (False, "git_failed", 503),
        (True, "stored_invalid", 200),
        (True, "git_failed", 503),
    ):
        with monkeypatch.context() as patch:

            def broken(
                self: ContentRepository,
                *args: Any,
                _only: bool = revision_only,
                _reason: str = reason,
                **kwargs: Any,
            ) -> Any:
                if kwargs.get("kind") is COMPONENT_KIND and (not _only or len(args) >= 3):
                    raise ContentError("content_unavailable", _reason)
                return original(self, *args, **kwargs)

            patch.setattr(ContentRepository, "read", broken)
            response = banc.appel(CREATEUR_GROUPE, "GET", url)
            assert response.status_code == expected_status
            if revision_only and expected_status == 200:
                assert response.json()["others"] == 1
                assert saved.json()["id"] not in response.text
    with monkeypatch.context() as patch:

        def approvals_failed(*args: Any, **kwargs: Any) -> Any:
            raise ContentError("content_unavailable", "git_failed")

        patch.setattr(ContentRepository, "read_approvals", approvals_failed)
        assert banc.appel(CREATEUR_GROUPE, "GET", url).status_code == 503


def test_suppression_conflit_de_tete_et_identifiant_absent(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    from skifer_board.content.errors import ContentError
    from skifer_board.content.repository import ContentRepository

    theme, _ = creer_partages(banc)
    root = f"/api/spaces/{A}/themes"
    assert (
        banc.appel(
            CREATEUR_GROUPE, "DELETE", root + "/incorrect", params={"expected_revision": 1}
        ).status_code
        == 404
    )
    with monkeypatch.context() as patch:
        patch.setattr(ContentRepository, "head", lambda self: None)
        assert (
            banc.appel(
                CREATEUR_GROUPE, "DELETE", f"{root}/{theme}", params={"expected_revision": 1}
            ).status_code
            == 404
        )
    assert (
        banc.appel(
            CREATEUR_GROUPE, "DELETE", f"{root}/{theme}", params={"expected_revision": 2}
        ).status_code
        == 409
    )
    calls = 0

    def conflict(*args: Any, **kwargs: Any) -> Any:
        nonlocal calls
        calls += 1
        raise ContentError("revision_conflict", "head_changed")

    with monkeypatch.context() as patch:
        patch.setattr(ContentRepository, "delete", conflict)
        response = banc.appel(
            CREATEUR_GROUPE, "DELETE", f"{root}/{theme}", params={"expected_revision": 1}
        )
        assert calls == 2 and response.status_code == 409


def test_index_perime_et_lecture_dashboard_defaillante(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    from skifer_board.content.errors import ContentError
    from skifer_board.content.repository import DASHBOARD_KIND, ContentRepository

    theme, component = creer_partages(banc)
    analysis = banc.depot.read(A, component, kind=COMPONENT_KIND).document["analysis"][
        "analysis_id"
    ]
    content, _ = dashboard(theme, component, "personal")
    saved = banc.appel(CREATEUR_GROUPE, "POST", f"/api/spaces/{A}/dashboards", json=content)
    assert saved.status_code == 201
    url = f"/api/spaces/{A}/analyses/{analysis}/consumers"
    original = ContentRepository.read
    for code, reason, status, hidden in (
        ("dashboard_not_found", "missing", 200, 0),
        ("content_unavailable", "stored_invalid", 200, 1),
        ("content_unavailable", "git_failed", 503, 0),
    ):
        with monkeypatch.context() as patch:

            def broken(
                self: ContentRepository,
                *args: Any,
                _code: str = code,
                _reason: str = reason,
                **kwargs: Any,
            ) -> Any:
                if kwargs.get("kind") is DASHBOARD_KIND:
                    raise ContentError(_code, _reason)
                return original(self, *args, **kwargs)

            patch.setattr(DashboardIndex, "get", lambda *args: None)
            patch.setattr(ContentRepository, "read", broken)
            response = banc.appel(CREATEUR_GROUPE, "GET", url)
            assert response.status_code == status
            if status == 200:
                assert response.json()["others"] == hidden


def test_suppression_refuse_une_erreur_du_depot_et_un_objet_supprime(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    from skifer_board.content.errors import ContentError
    from skifer_board.content.repository import ContentRepository

    theme, _ = creer_partages(banc)
    url = f"/api/spaces/{A}/themes/{theme}"
    with monkeypatch.context() as patch:

        def stale(*args: Any, **kwargs: Any) -> Any:
            raise ContentError("revision_conflict", "stale")

        patch.setattr(ContentRepository, "delete", stale)
        assert (
            banc.appel(CREATEUR_GROUPE, "DELETE", url, params={"expected_revision": 1}).status_code
            == 409
        )
    assert (
        banc.appel(CREATEUR_GROUPE, "DELETE", url, params={"expected_revision": 1}).status_code
        == 204
    )
    assert (
        banc.appel(CREATEUR_GROUPE, "DELETE", url, params={"expected_revision": 1}).status_code
        == 404
    )


def test_absence_du_calcul_des_consommateurs_refuse_la_suppression(
    banc: Banc, monkeypatch: pytest.MonkeyPatch
) -> None:
    from types import SimpleNamespace
    from typing import cast

    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from skifer_board.content import shared_web
    from skifer_board.content.errors import ContentError
    from skifer_board.content.shared_index import SharedIndex
    from skifer_board.spaces.access import Access
    from skifer_board.spaces.model import Role

    theme, _ = creer_partages(banc)
    app = FastAPI()
    access = cast(Access, SimpleNamespace(implicit=False, role=Role.CREATOR))
    monkeypatch.setattr(shared_web, "viewer", lambda _: CREATEUR_GROUPE.ref)
    shared_web.install_shared_routes(
        app, banc.depot, SharedIndex(banc.monde.moteur), lambda *_: access
    )
    with TestClient(app, base_url="http://127.0.0.1") as client:
        with pytest.raises(ContentError, match="content_unavailable"):
            client.delete(f"/api/spaces/{A}/themes/{theme}?expected_revision=1")
        with pytest.raises(ContentError, match="content_unavailable"):
            client.get(f"/api/spaces/{A}/themes/{theme}/consumers")


def test_fermeture_et_extraction_sans_dependances() -> None:
    from skifer_board.content.composition import dependency_closure, extract_template

    from .monde_dashboard import new_id, with_components

    document = with_components(text())
    assert dependency_closure(document, {}).analyses == ()
    assert extract_template(document, new_id(), {})["layout"] == document["layout"]
