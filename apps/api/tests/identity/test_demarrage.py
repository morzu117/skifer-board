"""Démarrage fermé sans configuration complète, sans port ni réseau (I7)."""

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

from identity.conftest import Horloge


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
        server.identity_runtime(environnement, "localhost")


@pytest.mark.parametrize("hote", ["localhost", "127.0.0.1", "::1"])
def test_mode_local_sur_boucle_locale(hote: str) -> None:
    assert server.identity_runtime({}, hote) is None


@pytest.mark.parametrize("hote", ["0.0.0.0", "board.example.invalid", "::"])
def test_mode_local_refuse_hote_expose(hote: str) -> None:
    with pytest.raises(SystemExit, match=hote):
        server.identity_runtime({}, hote)


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
    runtime = server.identity_runtime(environnement, hote)
    assert runtime is not None
    assert runtime.clock() == horloge()
    assert isinstance(assemblage.call_args.args[1], UrllibHttp)
    assert runtime.config.client_id == environnement[REQUIRED[1]]


def test_main_transmet_runtime(
    environnement: dict[str, str], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
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
    server.main()
    creer.assert_called_once()
    assert isinstance(creer.call_args.args[1], IdentityRuntime)
    lancer.assert_called_once()
    assert lancer.call_args.kwargs == {"host": "0.0.0.0", "port": 8000}
    assert lancer.call_args.args[0].title == "Skifer Board"
