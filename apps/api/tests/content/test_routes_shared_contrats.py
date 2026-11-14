"""Contrats des contenus partagés produits par le serveur réel.

Régénération :
`BOARD_REGENERER_CONTRATS=1 uv run pytest apps/api/tests/content/test_routes_shared_contrats.py`
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from httpx2 import Response
from skifer_board.catalog import CatalogService
from skifer_board.content import COMPONENT_KIND
from skifer_board.content.repository import Kind
from skifer_board.server import create_app
from spaces.monde import ADMIN_GROUPE, CREATEUR_GROUPE, LECTEUR_GROUPE, A

from .monde import init, new_id, repository
from .monde_dashboard import text
from .serveur import Banc, corps_tableau
from .test_routes_shared_cycle import CASES, body

ROOT = Path(__file__).resolve().parents[4] / "contracts"
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
COMMIT = re.compile(r"[0-9a-f]{40}")
BASE = frozenset(
    {
        "creer",
        "lister",
        "lire",
        "reviser",
        "historique",
        "diff",
        "supprimer",
        "approver",
        "approbations",
        "refus-deja-approuve",
        "refus-interdit",
        "refus-mode-local",
        "refus-pas-proprietaire",
        "refus-inconnu",
        "refus-revision-conflit",
        "refus-invalide",
        "refus-depot-indisponible",
        "consommateurs",
    }
)
PRODUITS: set[tuple[str, str]] = set()


def normaliser(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: normaliser(item) for key, item in value.items()}
    if isinstance(value, list):
        return [normaliser(item) for item in value]
    if isinstance(value, str):
        if UUID.fullmatch(value):
            return "<uuid>"
        if COMMIT.fullmatch(value):
            return "<commit>"
    return value


def exemple(directory: str, name: str, response: Response, status: int) -> None:
    assert response.status_code == status, response.text
    actual = {"status": status, "body": normaliser(response.json()) if response.content else None}
    path = ROOT / directory / "routes" / f"{name}.json"
    PRODUITS.add((directory, name))
    if os.environ.get("BOARD_REGENERER_CONTRATS"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(actual, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
    assert actual == json.loads(path.read_text(encoding="utf-8"))


@pytest.mark.parametrize("kind,segment,directory,file", CASES)
def test_contrats_du_cycle(
    banc: Banc,
    kind: Kind,
    segment: str,
    directory: str,
    file: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = f"/api/spaces/{A}/{segment}"
    content = body(directory, file)
    if kind is COMPONENT_KIND:
        content["analysis"]["analysis_id"] = banc.creer_ok(CREATEUR_GROUPE, visibility="shared")
    created = banc.appel(CREATEUR_GROUPE, "POST", root, json=content)
    exemple(directory, "creer", created, 201)
    ident = created.json()["id"]
    url = f"{root}/{ident}"
    exemple(directory, "lister", banc.appel(CREATEUR_GROUPE, "GET", root), 200)
    exemple(directory, "lire", banc.appel(CREATEUR_GROUPE, "GET", url), 200)
    exemple(directory, "refus-interdit", banc.appel(LECTEUR_GROUPE, "GET", url), 403)
    exemple(
        directory, "refus-inconnu", banc.appel(CREATEUR_GROUPE, "GET", f"{root}/{new_id()}"), 404
    )
    exemple(
        directory,
        "refus-invalide",
        banc.appel(CREATEUR_GROUPE, "POST", root, json={"name": []}),
        422,
    )
    exemple(
        directory,
        "refus-pas-proprietaire",
        banc.appel(ADMIN_GROUPE, "DELETE", url, params={"expected_revision": 1}),
        403,
    )
    exemple(
        directory,
        "refus-revision-conflit",
        banc.appel(CREATEUR_GROUPE, "PUT", url, json={**content, "expected_revision": 2}),
        409,
    )
    approval = {"revision": 1, "expected_revision": 1}
    exemple(
        directory,
        "approver",
        banc.appel(ADMIN_GROUPE, "POST", url + "/approvals", json=approval),
        201,
    )
    exemple(
        directory,
        "approbations",
        banc.appel(CREATEUR_GROUPE, "GET", url + "/approvals"),
        200,
    )
    exemple(
        directory,
        "refus-deja-approuve",
        banc.appel(ADMIN_GROUPE, "POST", url + "/approvals", json=approval),
        409,
    )
    exemple(
        directory,
        "reviser",
        banc.appel(
            CREATEUR_GROUPE, "PUT", url, json={**content, "name": "Révisé", "expected_revision": 1}
        ),
        201,
    )
    exemple(directory, "historique", banc.appel(CREATEUR_GROUPE, "GET", url + "/history"), 200)
    exemple(
        directory,
        "diff",
        banc.appel(CREATEUR_GROUPE, "GET", url + "/diff", params={"from": 1, "to": 2}),
        200,
    )
    if kind.name in {"theme", "component"}:
        if kind.name == "theme":
            tableau = corps_tableau(text(), theme={"theme_id": ident, "revision": 2})
        else:
            node = {
                "id": new_id(),
                "type": "component",
                "component": {"component_id": ident, "revision": 2},
            }
            tableau = corps_tableau(node)
        created_dashboard = banc.appel(
            CREATEUR_GROUPE, "POST", f"/api/spaces/{A}/dashboards", json=tableau
        )
        assert created_dashboard.status_code == 201, created_dashboard.text
        exemple(
            directory, "consommateurs", banc.appel(CREATEUR_GROUPE, "GET", url + "/consumers"), 200
        )
        exemple(
            directory,
            "refus-content-in-use",
            banc.appel(CREATEUR_GROUPE, "DELETE", url, params={"expected_revision": 2}),
            409,
        )
        from skifer_board.content.index import DashboardIndex
        from sqlalchemy.exc import SQLAlchemyError

        def unavailable(*args: Any, **kwargs: Any) -> Any:
            raise SQLAlchemyError("index")

        with monkeypatch.context() as patch:
            patch.setattr(DashboardIndex, "rows", unavailable)
            exemple(
                directory,
                "refus-index-indisponible",
                banc.appel(CREATEUR_GROUPE, "DELETE", url, params={"expected_revision": 2}),
                503,
            )
        assert (
            banc.appel(
                CREATEUR_GROUPE,
                "DELETE",
                f"/api/spaces/{A}/dashboards/{created_dashboard.json()['id']}",
                params={"expected_revision": 1},
            ).status_code
            == 204
        )
    else:
        # La provenance d'un modèle ne crée pas de consommateur ni de refus de suppression.
        provenance = corps_tableau(text(), template={"template_id": ident, "revision": 2})
        dashboard = banc.appel(
            CREATEUR_GROUPE, "POST", f"/api/spaces/{A}/dashboards", json=provenance
        )
        assert dashboard.status_code == 201, dashboard.text
        exemple(
            directory, "consommateurs", banc.appel(CREATEUR_GROUPE, "GET", url + "/consumers"), 200
        )
    exemple(
        directory,
        "supprimer",
        banc.appel(CREATEUR_GROUPE, "DELETE", url, params={"expected_revision": 2}),
        204,
    )


@pytest.mark.parametrize("kind,segment,directory,file", CASES)
def test_contrat_depot_indisponible(
    banc_sans_depot: Banc, kind: Kind, segment: str, directory: str, file: str
) -> None:
    exemple(
        directory,
        "refus-depot-indisponible",
        banc_sans_depot.appel(CREATEUR_GROUPE, "GET", f"/api/spaces/{A}/{segment}"),
        503,
    )


@pytest.mark.parametrize("kind,segment,directory,file", CASES)
def test_contrat_mode_local(
    service: CatalogService, tmp_path: Path, kind: Kind, segment: str, directory: str, file: str
) -> None:
    app = create_app(service, content_repository=repository(init(tmp_path / "contenus")))
    with TestClient(app, base_url="http://127.0.0.1") as client:
        exemple(directory, "refus-mode-local", client.get(f"/api/spaces/local/{segment}"), 409)


def test_zz_contrats_exactement_produits() -> None:
    for kind, _, directory, _ in CASES:
        names = BASE | (
            {"refus-content-in-use", "refus-index-indisponible"}
            if kind.name != "page_template"
            else set()
        )
        actual = {item.stem for item in (ROOT / directory / "routes").glob("*.json")}
        assert actual == names
        assert {(folder, name) for folder, name in PRODUITS if folder == directory} == {
            (directory, name) for name in names
        }
