"""Démarrage fermé sans configuration complète, sans port ni réseau (I7), et base d'état
obligatoire avec OIDC (plan 07, P4, P5)."""

import os
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import Mock

import pytest
import uvicorn
from skifer_board import server
from skifer_board.identity import OidcConfig, UrllibHttp
from skifer_board.identity.config import REQUIRED
from skifer_board.identity.web import IdentityRuntime, build_runtime
from skifer_board.state import DATABASE_URL, MIGRATE_COMMAND, upgrade
from sqlalchemy import Engine
from sqlalchemy.engine import URL

from identity.conftest import Horloge

# Assembler le runtime ne touche pas la base (plan 07, 7.2) : un moteur factice suffit tant
# que le test n'ouvre ni session ni demande de connexion.
BASE_FACTICE = Mock(spec=Engine)


@pytest.fixture
def environnement(config: OidcConfig) -> dict[str, str]:
    return dict(
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


@pytest.mark.parametrize("variable", REQUIRED)
def test_configuration_incomplete(environnement: dict[str, str], variable: str) -> None:
    del environnement[variable]
    with pytest.raises(SystemExit, match=variable):
        server.identity_runtime(environnement, "localhost", None)


@pytest.mark.parametrize("hote", ["localhost", "127.0.0.1", "::1"])
def test_mode_local_sur_boucle_locale(hote: str) -> None:
    assert server.identity_runtime({}, hote, None) is None


@pytest.mark.parametrize("hote", ["0.0.0.0", "board.example.invalid", "::"])
def test_mode_local_refuse_hote_expose(hote: str) -> None:
    with pytest.raises(SystemExit, match=hote):
        server.identity_runtime({}, hote, None)


@pytest.mark.parametrize(
    "hote", ["localhost", "127.0.0.1", "::1", "0.0.0.0", "board.example.invalid"]
)
def test_oidc_sur_tout_hote(
    environnement: dict[str, str], hote: str, monkeypatch: pytest.MonkeyPatch, horloge: Horloge
) -> None:
    class DateFigee(datetime):
        @classmethod
        def now(cls, tz: object = None) -> "DateFigee":
            assert tz == UTC
            return cls.fromtimestamp(horloge().timestamp(), UTC)

    monkeypatch.setattr(server, "datetime", DateFigee)
    assemblage = Mock(wraps=build_runtime)
    monkeypatch.setattr(server, "build_runtime", assemblage)
    runtime = server.identity_runtime(environnement, hote, BASE_FACTICE)
    assert runtime is not None
    assert runtime.clock() == horloge()
    assert isinstance(assemblage.call_args.args[1], UrllibHttp)
    assert runtime.config.client_id == environnement[REQUIRED[1]]


@pytest.fixture
def lancement(
    environnement: dict[str, str], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> tuple[dict[str, str], Mock, Mock]:
    """Environnement du processus, assemblage de l'application et uvicorn espionnés."""
    environnement.update(
        {
            server.REPOSITORY_VARIABLE: str(tmp_path / "clone"),
            server.STATE_VARIABLE: str(tmp_path / "etat"),
            "SKIFER_BOARD_HOST": "0.0.0.0",
        }
    )
    monkeypatch.setattr(os, "environ", environnement)
    creer = Mock(wraps=server.create_app)
    lancer = Mock()
    monkeypatch.setattr(server, "create_app", creer)
    monkeypatch.setattr(uvicorn, "run", lancer)
    return environnement, creer, lancer


def adresse(url: URL) -> str:
    return url.render_as_string(hide_password=False)


def test_main_transmet_runtime(
    lancement: tuple[dict[str, str], Mock, Mock],
    database_url: URL,
    engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    environnement, creer, lancer = lancement
    upgrade(engine)
    environnement[DATABASE_URL] = adresse(database_url)
    identite = Mock(wraps=server.identity_runtime)
    monkeypatch.setattr(server, "identity_runtime", identite)
    server.main()
    creer.assert_called_once()
    assert isinstance(creer.call_args.args[1], IdentityRuntime)
    lancer.assert_called_once()
    assert lancer.call_args.kwargs == {"host": "0.0.0.0", "port": 8000}
    assert lancer.call_args.args[0].title == "Skifer Board"
    # La base vérifiée au démarrage est celle remise à l'identité.
    base = identite.call_args.args[2]
    assert isinstance(base, Engine)
    try:
        assert base.url.database == database_url.database
    finally:
        base.dispose()


def test_oidc_sans_base_refuse(environnement: dict[str, str]) -> None:
    with pytest.raises(SystemExit, match=DATABASE_URL) as arret:
        server.identity_runtime(environnement, "board.example.invalid", None)
    assert "OIDC" in str(arret.value)
    assert environnement[REQUIRED[2]] not in str(arret.value)


@pytest.mark.parametrize("hote", ["localhost", "127.0.0.1", "::1"])
def test_mode_local_avec_base(hote: str) -> None:
    # Sans OIDC, une base fournie ne change rien : mode local, sans identité (P5).
    assert server.identity_runtime({}, hote, BASE_FACTICE) is None


def test_main_oidc_sans_base_refuse(lancement: tuple[dict[str, str], Mock, Mock]) -> None:
    _, creer, lancer = lancement
    with pytest.raises(SystemExit, match=DATABASE_URL):
        server.main()
    creer.assert_not_called()
    lancer.assert_not_called()


def test_main_base_vide_refuse(
    lancement: tuple[dict[str, str], Mock, Mock], database_url: URL
) -> None:
    environnement, creer, lancer = lancement
    environnement[DATABASE_URL] = adresse(database_url)
    with pytest.raises(SystemExit, match="vide") as arret:
        server.main()
    assert MIGRATE_COMMAND in str(arret.value)
    creer.assert_not_called()
    lancer.assert_not_called()


def test_main_mode_local_base_vide_refuse(
    lancement: tuple[dict[str, str], Mock, Mock], database_url: URL
) -> None:
    # Même sans OIDC, une base configurée doit être à jour pour démarrer (P4).
    environnement, creer, lancer = lancement
    environnement.clear()
    environnement.update({DATABASE_URL: adresse(database_url), "SKIFER_BOARD_HOST": "127.0.0.1"})
    with pytest.raises(SystemExit, match="vide"):
        server.main()
    creer.assert_not_called()
    lancer.assert_not_called()


def test_main_mode_local_sans_base(lancement: tuple[dict[str, str], Mock, Mock]) -> None:
    # Sans OIDC ni base : démarrage du plan 06, sur la boucle locale, sans identité (P5).
    environnement, creer, lancer = lancement
    for variable in REQUIRED:
        del environnement[variable]
    environnement["SKIFER_BOARD_HOST"] = "127.0.0.1"
    server.main()
    creer.assert_called_once()
    assert creer.call_args.args[1] is None
    lancer.assert_called_once()
    assert lancer.call_args.kwargs == {"host": "127.0.0.1", "port": 8000}
