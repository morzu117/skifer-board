"""Assemblage des espaces au démarrage (plan 08, E6, E11, 8.2) : en base avec OIDC, avec le
groupe d'administration configuré ; implicite et local sans OIDC."""

from __future__ import annotations

import os
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest.mock import Mock

import pytest
import uvicorn
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from fastapi import FastAPI
from fastapi.testclient import TestClient
from identity.conftest import Cles, Fournisseur, Horloge
from identity.conftest import claims as claims
from identity.conftest import cles as cles
from identity.conftest import config as config
from identity.conftest import fournisseur as fournisseur
from identity.conftest import horloge as horloge
from identity.test_web import connecter
from skifer_board import server
from skifer_board.catalog import CatalogService
from skifer_board.execution import ConnectionStore
from skifer_board.execution.connectors import ENDPOINTS_VARIABLE
from skifer_board.execution.vault import ACTIVE_VARIABLE, KEYS_VARIABLE
from skifer_board.identity import OidcConfig
from skifer_board.identity.config import ADMIN_GROUP, REQUIRED
from skifer_board.identity.model import Identity
from skifer_board.identity.web import build_runtime
from skifer_board.spaces import GroupPrincipal, LocalMode, PersonRef, Role, Spaces, SpaceStore
from skifer_board.state import DATABASE_URL
from skifer_board.telemetry import Recorder, TelemetryStore
from sqlalchemy import Engine
from sqlalchemy.engine import URL
from state.conftest import migre as migre

from spaces.monde import ORIGINE, PLATEFORME


def test_create_app_avec_oidc_exige_des_espaces(
    service: CatalogService, config: OidcConfig, fournisseur: Fournisseur, horloge: Horloge
) -> None:
    runtime = build_runtime(config, fournisseur, horloge)
    with pytest.raises(ValueError, match="espaces"):
        server.create_app(service, runtime)
    with pytest.raises(ValueError, match="espaces"):
        server.create_app(service, runtime, None)


@pytest.mark.parametrize(
    "groupe_identite,groupe_espaces",
    [
        (None, PLATEFORME),
        (PLATEFORME, None),
        (PLATEFORME, "autres-admins"),
        (PLATEFORME, PLATEFORME.upper()),
        (PLATEFORME, f" {PLATEFORME}"),
        (PLATEFORME, ""),
    ],
    ids=["identite-sans", "espaces-sans", "differents", "casse", "blanc", "vide"],
)
def test_create_app_refuse_deux_groupes_d_administration(
    service: CatalogService,
    config: OidcConfig,
    fournisseur: Fournisseur,
    horloge: Horloge,
    migre: Engine,
    groupe_identite: str | None,
    groupe_espaces: str | None,
) -> None:
    """`/api/me` et les espaces nomment le même groupe d'administration (E6) : deux sources
    différentes empêchent l'assemblage, sans repli ni comparaison approchée."""
    runtime = build_runtime(replace(config, admin_group=groupe_identite), fournisseur, horloge)
    espaces = Spaces.database(SpaceStore(migre), "skifer-atlas", groupe_espaces, horloge)
    with pytest.raises(ValueError, match="groupe d'administration"):
        server.create_app(service, runtime, espaces)


@pytest.mark.parametrize("groupe", [PLATEFORME, None])
def test_create_app_accepte_le_meme_groupe_d_administration(
    service: CatalogService,
    config: OidcConfig,
    fournisseur: Fournisseur,
    horloge: Horloge,
    migre: Engine,
    groupe: str | None,
) -> None:
    runtime = build_runtime(replace(config, admin_group=groupe), fournisseur, horloge)
    espaces = Spaces.database(SpaceStore(migre), "skifer-atlas", groupe, horloge)
    assert isinstance(server.create_app(service, runtime, espaces), FastAPI)
    # Sans identité, le groupe des espaces n'a rien à quoi se comparer.
    assert isinstance(server.create_app(service, None, espaces), FastAPI)


def test_spaces_for_avec_oidc_sans_base_refuse_de_demarrer(
    config: OidcConfig, fournisseur: Fournisseur, horloge: Horloge
) -> None:
    runtime = build_runtime(config, fournisseur, horloge)
    with pytest.raises(SystemExit, match=DATABASE_URL) as arret:
        server.spaces_for(runtime, None, "skifer-atlas")
    assert "obligatoire" in str(arret.value.code)


def test_spaces_for_sans_oidc_espace_implicite(migre: Engine) -> None:
    assert server.spaces_for(None, None, "skifer-atlas") is None
    # Une base configurée sans OIDC ne change rien : l'espace reste implicite (E11).
    assert server.spaces_for(None, migre, "skifer-atlas") is None


@pytest.mark.parametrize("groupe", [PLATEFORME, None])
def test_spaces_for_avec_oidc_en_base(
    config: OidcConfig,
    fournisseur: Fournisseur,
    horloge: Horloge,
    migre: Engine,
    groupe: str | None,
) -> None:
    runtime = build_runtime(replace(config, admin_group=groupe), fournisseur, horloge)
    espaces = server.spaces_for(runtime, migre, "depot-atlas")
    assert isinstance(espaces, Spaces)
    assert isinstance(espaces.store, SpaceStore)
    assert espaces.atlas == "depot-atlas"
    assert espaces.admin_group == groupe
    assert espaces.clock is runtime.clock
    assert espaces.started == horloge()
    administrateur = Identity(config.issuer, "s", None, None, (PLATEFORME,))
    assert espaces.platform_admin(administrateur) is (groupe is not None)


def test_assemblage_sans_identite_sur_espaces_en_base_reste_ferme(
    service: CatalogService, migre: Engine, horloge: Horloge
) -> None:
    """Espaces en base sans OIDC : aucune personne, donc aucun espace ni aucune écriture."""
    store = SpaceStore(migre)
    espaces = Spaces.database(store, "skifer-atlas", PLATEFORME, horloge)
    app = server.create_app(service, None, espaces)
    store.create_space(
        "finance", "Finance", "skifer-atlas", GroupPrincipal("g"), PersonRef("i", "s"), horloge()
    )
    with TestClient(
        app, base_url="http://127.0.0.1:8000", headers={"Origin": "http://127.0.0.1:5173"}
    ) as client:
        assert client.get("/api/spaces").json() == {"spaces": [], "platform_admin": False}
        for chemin in ("/api/spaces/finance", "/api/spaces/finance/catalog", "/api/spaces/local"):
            reponse = client.get(chemin)
            assert reponse.status_code == 404
        reponse = client.post(
            "/api/spaces",
            json={"id": "x1", "name": "X", "first_admin": {"kind": "group", "name": "g"}},
        )
        assert (reponse.status_code, reponse.json()) == (
            403,
            {"error": {"code": "forbidden", "required": "platform_admin"}},
        )
        reponse = client.get("/api/people", params={"q": "x"})
        assert reponse.status_code == 403
    assert [espace.id for espace in store.list_spaces()] == ["finance"]
    # Sans personne, ni écriture ni rôle : le refus est celui du mode local.
    assert espaces.visible(None) == []
    assert espaces.access(None, "finance") is None
    assert espaces.administers_any(None) is False
    with pytest.raises(LocalMode):
        espaces.create(None, "x1", "X", GroupPrincipal("g"))
    with pytest.raises(LocalMode):
        espaces.set_binding(None, "finance", GroupPrincipal("g"), Role.READER)
    with pytest.raises(LocalMode):
        espaces.remove_binding(None, "finance", "liaison")


def fermer(espaces: Spaces) -> None:
    """Libère le moteur ouvert par `main`, avant que la base du test ne soit supprimée."""
    assert espaces.store is not None
    espaces.store._engine.dispose()


@pytest.fixture
def lancement(
    config: OidcConfig,
    espace: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    fournisseur: Fournisseur,
    horloge: Horloge,
) -> tuple[dict[str, str], Mock, Mock]:
    """Processus tel que `main` le voit, avec le fournisseur simulé et l'horloge du test."""

    class DateFigee(datetime):
        @classmethod
        def now(cls, tz: object = None) -> DateFigee:
            assert tz == UTC
            return cls.fromtimestamp(horloge().timestamp(), UTC)

    environnement = dict(
        zip(
            REQUIRED,
            (
                config.issuer,
                config.client_id,
                config.client_secret,
                config.redirect_uri,
                config.public_origin,
            ),
            strict=True,
        )
    )
    environnement.update(
        {
            server.REPOSITORY_VARIABLE: str(espace),
            server.STATE_VARIABLE: str(tmp_path / "etat"),
            "SKIFER_BOARD_HOST": "0.0.0.0",
        }
    )
    monkeypatch.setattr(os, "environ", environnement)
    monkeypatch.setattr(server, "datetime", DateFigee)
    monkeypatch.setattr(server, "UrllibHttp", lambda: fournisseur)
    creer = Mock(wraps=server.create_app)
    lancer = Mock()
    monkeypatch.setattr(server, "create_app", creer)
    monkeypatch.setattr(uvicorn, "run", lancer)
    return environnement, creer, lancer


def test_main_avec_oidc_assemble_les_espaces_en_base(
    lancement: tuple[dict[str, str], Mock, Mock],
    database_url: URL,
    migre: Engine,
    espace: Path,
    fournisseur: Fournisseur,
    cles: Cles,
    claims: dict[str, Any],
) -> None:
    environnement, creer, lancer = lancement
    environnement[DATABASE_URL] = database_url.render_as_string(hide_password=False)
    environnement[ADMIN_GROUP] = PLATEFORME
    server.main()
    creer.assert_called_once()
    service, identite, espaces, enregistreur, connexions, coffre, endpoints = creer.call_args.args
    assert coffre is None
    assert endpoints == {}
    assert isinstance(espaces, Spaces)
    # Avec une base, les mesures y vont, par le même enregistreur que le catalogue (plan 11, T4).
    assert isinstance(enregistreur, Recorder)
    assert isinstance(enregistreur._store, TelemetryStore)
    assert isinstance(connexions, ConnectionStore)
    assert service._measure == enregistreur.submit
    assert isinstance(espaces.store, SpaceStore)
    assert espaces.admin_group == PLATEFORME == identite.config.admin_group
    assert espaces.atlas == espace.name
    app = lancer.call_args.args[0]
    assert isinstance(app, FastAPI)
    try:
        with TestClient(app, base_url=ORIGINE, follow_redirects=False) as client:
            connecter(client, fournisseur, cles, {**claims, "groups": [PLATEFORME]})
            assert client.get("/api/me").json()["platform_admin"] is True
            creation = client.post(
                "/api/spaces",
                json={
                    "id": "finance",
                    "name": "Finance",
                    "first_admin": {"kind": "group", "name": "lecteurs"},
                },
                headers={"Origin": ORIGINE},
            )
            assert creation.status_code == 201
            assert creation.json()["atlas"] == espace.name
        # L'espace est rangé dans la base configurée, celle du démarrage.
        assert [e.id for e in SpaceStore(migre).list_spaces()] == ["finance"]
    finally:
        fermer(espaces)


def test_main_sans_groupe_d_administration(
    lancement: tuple[dict[str, str], Mock, Mock], database_url: URL, migre: Engine
) -> None:
    environnement, creer, _ = lancement
    environnement[DATABASE_URL] = database_url.render_as_string(hide_password=False)
    server.main()
    espaces = creer.call_args.args[2]
    try:
        assert isinstance(espaces, Spaces)
        assert espaces.admin_group is None
    finally:
        fermer(espaces)


def test_main_sans_oidc_avec_base_mesures_au_journal_seul(
    lancement: tuple[dict[str, str], Mock, Mock],
    database_url: URL,
    migre: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mode local avec une base d'état : l'espace reste implicite, et les mesures ne vont qu'à
    la sortie standard ; l'enregistreur n'a pas de magasin (plan 11, T4)."""
    environnement, creer, _ = lancement
    for variable in REQUIRED:
        del environnement[variable]
    environnement["SKIFER_BOARD_HOST"] = "127.0.0.1"
    environnement[DATABASE_URL] = database_url.render_as_string(hide_password=False)
    moteurs: list[Engine] = []
    ouvrir = server.state_engine

    def ouvrir_et_garder(environ: Any) -> Engine | None:
        moteur = ouvrir(environ)
        assert moteur is not None
        moteurs.append(moteur)
        return moteur

    monkeypatch.setattr(server, "state_engine", ouvrir_et_garder)
    try:
        server.main()
        assert len(moteurs) == 1
        (
            service,
            identite,
            espaces,
            enregistreur,
            connexions,
            coffre,
            endpoints,
        ) = creer.call_args.args
        assert coffre is None
        assert endpoints == {}
        assert (identite, espaces) == (None, None)
        assert isinstance(enregistreur, Recorder)
        assert enregistreur.store is None
        assert connexions is None
        assert service._measure == enregistreur.submit
    finally:
        for moteur in moteurs:
            moteur.dispose()


def test_main_refuse_configuration_des_points_d_acces_invalide(
    lancement: tuple[dict[str, str], Mock, Mock],
) -> None:
    environnement, creer, _ = lancement
    for variable in REQUIRED:
        del environnement[variable]
    environnement["SKIFER_BOARD_HOST"] = "127.0.0.1"
    environnement[ENDPOINTS_VARIABLE] = '{"local":{"connector":"duckdb","path":"relative"}}'
    with pytest.raises(SystemExit, match=ENDPOINTS_VARIABLE):
        server.main()
    creer.assert_not_called()


def test_main_sans_oidc_espace_local(
    lancement: tuple[dict[str, str], Mock, Mock], espace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    environnement, creer, lancer = lancement
    for variable in REQUIRED:
        del environnement[variable]
    environnement["SKIFER_BOARD_HOST"] = "127.0.0.1"
    server.main()
    assert creer.call_args.args[1] is None
    assert creer.call_args.args[2] is None
    app = lancer.call_args.args[0]
    # L'horloge figée a servi au démarrage ; le catalogue sérialise ses dates avec la vraie.
    monkeypatch.setattr(server, "datetime", datetime)
    with TestClient(app, base_url="http://127.0.0.1:8000") as client:
        [local] = client.get("/api/spaces").json()["spaces"]
        assert (local["id"], local["role"], local["implicit"]) == ("local", "admin", True)
        assert local["atlas"] == espace.name
        assert client.get("/api/spaces/local/catalog").status_code == 200


def test_main_refuse_une_configuration_de_coffre_invalide(
    lancement: tuple[dict[str, str], Mock, Mock],
) -> None:
    environnement, creer, _ = lancement
    for variable in REQUIRED:
        del environnement[variable]
    environnement["SKIFER_BOARD_HOST"] = "127.0.0.1"
    environnement[KEYS_VARIABLE] = "{}"
    environnement[ACTIVE_VARIABLE] = "v1"
    with pytest.raises(SystemExit) as error:
        server.main()
    assert KEYS_VARIABLE in str(error.value)
    creer.assert_not_called()
