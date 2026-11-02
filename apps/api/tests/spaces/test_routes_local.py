"""Mode local, sans OIDC ni base : un seul espace implicite, `local` (plan 08, E11 ; plan 06,
I7, I8)."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from fastapi.testclient import TestClient
from skifer_board.catalog import CatalogService
from skifer_board.identity.model import Identity
from skifer_board.server import create_app
from skifer_board.spaces import (
    LOCAL_PERSON,
    LOCAL_SPACE,
    Environment,
    GroupPrincipal,
    LocalMode,
    PersonRef,
    Spaces,
)

ORIGINE_LOCALE = "http://127.0.0.1:5173"
MODE_LOCAL = {"error": {"code": "local_mode"}}
INTROUVABLE = {"error": {"code": "space_not_found"}}
CATALOGUE = (
    "/catalog",
    "/catalog/revenu-net",
    "/catalog/revenu-net/versions",
    "/catalog/revenu-net/diff?base=1&other=2",
)
CREATION = {"id": "nouveau", "name": "Nouveau", "first_admin": {"kind": "group", "name": "g"}}
LIAISON = {"principal": {"kind": "group", "name": "g"}, "role": "reader"}
ACCORD = {"environment": "PROD", "principal": {"kind": "group", "name": "g"}}


@pytest.fixture
def local(service: CatalogService) -> Iterator[TestClient]:
    with TestClient(
        create_app(service),
        base_url="http://127.0.0.1:8000",
        headers={"Origin": ORIGINE_LOCALE},
        raise_server_exceptions=False,
    ) as client:
        yield client


def test_un_seul_espace_implicite(local: TestClient, service: CatalogService) -> None:
    avant = datetime.now(UTC)
    reponse = local.get("/api/spaces")
    assert reponse.status_code == 200
    corps = reponse.json()
    assert set(corps) == {"spaces", "platform_admin"}
    assert corps["platform_admin"] is False
    [espace_local] = corps["spaces"]
    cree = datetime.fromisoformat(espace_local.pop("created_at"))
    assert cree.utcoffset() == timedelta(0)
    assert avant - timedelta(minutes=5) <= cree <= avant
    assert espace_local == {
        "id": "local",
        "name": "Local",
        "atlas": service.config.repository.name,
        "created_by": {"issuer": "local", "subject": "local"},
        "role": "admin",
        "implicit": True,
        # La personne locale déploie dans les trois environnements (plan 09, V8).
        "environments": [
            {"code": "DEV", "deploy": True},
            {"code": "TEST", "deploy": True},
            {"code": "PROD", "deploy": True},
        ],
    }
    # Le même espace, au même instant, à chaque lecture.
    seul = local.get("/api/spaces/local").json()
    assert seul == {**espace_local, "created_at": cree.isoformat()}
    assert local.get("/api/spaces").json()["spaces"][0]["created_at"] == cree.isoformat()
    assert local.get("/api/me").json() == {"established": False}


def test_catalogue_sous_l_espace_local(local: TestClient) -> None:
    for route in CATALOGUE:
        reponse = local.get(f"/api/spaces/local{route}")
        assert reponse.json().get("error", {}).get("code") != "space_not_found", route
        assert reponse.status_code in (200, 404)
    assert local.get("/api/spaces/local/catalog").status_code == 200


@pytest.mark.parametrize(
    "espace_demande", ["autre", "finance", "Local", "LOCAL", "local-2", "lo", "a" * 41, "%2E%2E"]
)
def test_tout_autre_espace_introuvable(local: TestClient, espace_demande: str) -> None:
    for methode, route, corps in (
        ("GET", "", None),
        ("GET", "/members", None),
        ("GET", "/events", None),
        ("POST", "/members", LIAISON),
        ("DELETE", "/members/liaison", None),
        ("GET", "/deploy-grants", None),
        ("POST", "/deploy-grants", ACCORD),
        ("DELETE", "/deploy-grants/5b0e4c1e-0000-4000-8000-000000000000", None),
        *[("GET", route, None) for route in CATALOGUE],
    ):
        reponse = local.request(methode, f"/api/spaces/{espace_demande}{route}", json=corps)
        assert (reponse.status_code, reponse.json()) == (404, INTROUVABLE), (methode, route)


@pytest.mark.parametrize(
    "methode,chemin,contenu",
    [
        ("GET", "/api/spaces/local/members", None),
        ("GET", "/api/spaces/local/events", None),
        (
            "POST",
            "/api/spaces/local/members",
            b'{"principal": {"kind": "group", "name": "g"}, "role": "reader"}',
        ),
        ("POST", "/api/spaces/local/members", b"{illisible"),
        ("POST", "/api/spaces/local/members", b'{"role": "inconnu"}'),
        ("POST", "/api/spaces/local/members", b""),
        ("DELETE", "/api/spaces/local/members/liaison", None),
        ("DELETE", "/api/spaces/local/members/5b0e4c1e-0000-4000-8000-000000000000", None),
        # Les accords de déploiement ne se gèrent pas en mode local (plan 09, V8), même avec
        # un corps invalide ou un identifiant hors format.
        ("GET", "/api/spaces/local/deploy-grants", None),
        (
            "POST",
            "/api/spaces/local/deploy-grants",
            b'{"environment": "PROD", "principal": {"kind": "group", "name": "g"}}',
        ),
        ("POST", "/api/spaces/local/deploy-grants", b'{"environment": "QA"}'),
        ("POST", "/api/spaces/local/deploy-grants", b"{illisible"),
        ("POST", "/api/spaces/local/deploy-grants", b""),
        ("DELETE", "/api/spaces/local/deploy-grants/accord", None),
        ("DELETE", "/api/spaces/local/deploy-grants/5b0e4c1e-0000-4000-8000-000000000000", None),
        (
            "POST",
            "/api/spaces",
            b'{"id": "nouveau", "name": "Nouveau", "first_admin": {"kind": "group", "name": "g"}}',
        ),
        ("POST", "/api/spaces", b'{"id": "local", "name": "Local"}'),
        ("POST", "/api/spaces", b"[]"),
        ("GET", "/api/people", None),
        ("GET", "/api/people?q=", None),
        ("GET", "/api/people?q=nom", None),
        ("GET", "/api/people?q=" + "a" * 300, None),
    ],
)
def test_gestion_refusee_en_mode_local(
    local: TestClient, methode: str, chemin: str, contenu: bytes | None
) -> None:
    reponse = local.request(methode, chemin, content=contenu)
    assert (reponse.status_code, reponse.json()) == (409, MODE_LOCAL)


@pytest.mark.parametrize(
    "origine",
    [None, "null", "https://board.example.invalid", "http://192.168.1.10:5173", "http://[::1"],
)
@pytest.mark.parametrize(
    "methode,chemin,corps",
    [
        ("POST", "/api/spaces", CREATION),
        ("POST", "/api/spaces/local/members", LIAISON),
        ("DELETE", "/api/spaces/local/members/liaison", None),
        ("POST", "/api/spaces/autre/members", LIAISON),
        ("POST", "/api/spaces/local/deploy-grants", ACCORD),
        ("DELETE", "/api/spaces/local/deploy-grants/accord", None),
    ],
)
def test_ecritures_hors_boucle_locale_refusees(
    service: CatalogService, origine: str | None, methode: str, chemin: str, corps: object
) -> None:
    with TestClient(create_app(service), base_url="http://127.0.0.1:8000") as client:
        entetes = {} if origine is None else {"Origin": origine}
        reponse = client.request(methode, chemin, json=corps, headers=entetes)
        assert (reponse.status_code, reponse.json()) == (403, {"error": {"code": "origin_refused"}})


@pytest.mark.parametrize("origine", ["http://localhost:5173", "http://[::1]:8000"])
def test_ecritures_depuis_la_boucle_locale_atteignent_le_refus_local(
    service: CatalogService, origine: str
) -> None:
    with TestClient(create_app(service), base_url="http://127.0.0.1:8000") as client:
        reponse = client.post(
            "/api/spaces/local/members", json=LIAISON, headers={"Origin": origine}
        )
        assert (reponse.status_code, reponse.json()) == (409, MODE_LOCAL)


def test_espaces_locaux_ferment_tout_acces_hors_session() -> None:
    """Les espaces locaux refusent d'eux-mêmes toute gestion, même appelés sans route."""
    instant = datetime(2026, 11, 2, 8, tzinfo=UTC)
    espaces = Spaces.local("skifer-atlas", lambda: instant)
    assert espaces.store is None and espaces.admin_group is None
    assert espaces.started == instant
    personne = Identity("https://id.example.invalid", "s", None, None, ("admins",))
    for spectateur in (None, personne):
        [vu] = espaces.visible(spectateur)
        assert vu.implicit and vu.role is not None and vu.manages
        assert vu.space.created_by == LOCAL_PERSON == PersonRef("local", "local")
        assert vu.environments == (Environment.DEV, Environment.TEST, Environment.PROD)
        assert vu.deploy == frozenset(Environment)
        assert espaces.access(spectateur, LOCAL_SPACE) == vu
        assert espaces.access(spectateur, "autre") is None
        assert espaces.platform_admin(spectateur) is False
        assert espaces.administers_any(spectateur) is False
    for appel in (
        lambda: espaces.bindings(LOCAL_SPACE),
        lambda: espaces.events(LOCAL_SPACE),
        lambda: espaces.search_people("nom"),
        lambda: espaces.person(PersonRef("i", "s")),
        lambda: espaces.remove_binding(personne, LOCAL_SPACE, "x"),
        lambda: espaces.grants(LOCAL_SPACE),
        lambda: espaces.grant(personne, LOCAL_SPACE, Environment.PROD, GroupPrincipal("g")),
        lambda: espaces.revoke(personne, LOCAL_SPACE, "x"),
    ):
        with pytest.raises(LocalMode):
            appel()
