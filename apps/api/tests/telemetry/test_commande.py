"""Commande `skifer-board-telemetry purge` (plan 11, 11.2 ; T6) : codes de sortie 0, 1 et 2,
jamais l'adresse ni le mot de passe de la base dans un message."""

from __future__ import annotations

import sys
import tomllib
from datetime import UTC, datetime, timedelta
from importlib.metadata import entry_points
from pathlib import Path

import pytest
from skifer_board.state import DATABASE_URL
from skifer_board.state.schema import telemetry
from skifer_board.telemetry import TelemetryStore
from skifer_board.telemetry.cli import USAGE, main
from sqlalchemy import Engine, inspect
from sqlalchemy.engine import URL
from state.conftest import MOT_DE_PASSE, environnement, injoignable

from .conftest import MAINTENANT, avant, http, lignes

RETENTION = timedelta(days=90)


def lancer(
    capsys: pytest.CaptureFixture[str], argv: list[str] | None, environ: dict[str, str] | None
) -> tuple[int, str, str]:
    code = main(argv, environ, lambda: MAINTENANT)
    sortie = capsys.readouterr()
    assert MOT_DE_PASSE not in sortie.out + sortie.err
    return code, sortie.out, sortie.err


def test_script_declare() -> None:
    projet = tomllib.loads(
        (Path(__file__).parents[2] / "pyproject.toml").read_text(encoding="utf-8")
    )
    assert projet["project"]["scripts"]["skifer-board-telemetry"] == (
        "skifer_board.telemetry.cli:main"
    )
    (point,) = [
        e for e in entry_points(group="console_scripts") if e.name == "skifer-board-telemetry"
    ]
    assert point.load() is main


def test_purge_retire_les_mesures_de_plus_de_90_jours(
    migre: Engine, database_url: URL, capsys: pytest.CaptureFixture[str]
) -> None:
    limite = MAINTENANT - RETENTION
    gardees = [http(at=limite), http(at=avant(days=1)), http()]
    TelemetryStore(migre).record(
        [
            http(at=avant(days=200)),
            gardees[0],
            http(at=limite - timedelta(microseconds=1)),
            *gardees[1:],
        ]
    )
    code, sortie, erreur = lancer(capsys, ["purge"], environnement(database_url))
    assert (code, erreur) == (0, "")
    assert sortie == f"2 mesure(s) antérieure(s) au {limite.isoformat()} retirée(s).\n"
    assert [ligne["at"] for ligne in lignes(migre)] == [m.at for m in gardees]
    # Une seconde purge ne retire rien.
    code, sortie, _ = lancer(capsys, ["purge"], environnement(database_url))
    assert code == 0 and sortie.startswith("0 mesure(s) ")


def test_purge_lit_l_environnement_et_les_arguments_du_processus(
    migre: Engine,
    database_url: URL,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for variable, valeur in environnement(database_url).items():
        monkeypatch.setenv(variable, valeur)
    monkeypatch.setattr(sys, "argv", ["skifer-board-telemetry", "purge"])
    # Horloge réelle : une mesure d'il y a 91 jours part, une d'il y a 89 jours reste.
    maintenant = datetime.now(UTC)
    TelemetryStore(migre).record(
        [http(at=maintenant - timedelta(days=91)), http(at=maintenant - timedelta(days=89))]
    )
    assert main() == 0
    sortie = capsys.readouterr().out
    assert sortie.startswith("1 mesure(s) antérieure(s) au ")
    limite = datetime.fromisoformat(sortie.split(" au ")[1].split(" retirée")[0])
    assert maintenant - RETENTION <= limite <= datetime.now(UTC) - RETENTION
    assert len(lignes(migre)) == 1


@pytest.mark.parametrize(
    "arguments",
    [[], ["purge", "--force"], ["PURGE"], ["purger"], ["summary"], ["--help"], ["purge", "purge"]],
)
def test_usage(arguments: list[str], capsys: pytest.CaptureFixture[str]) -> None:
    code, sortie, erreur = lancer(capsys, arguments, {})
    assert (code, sortie, erreur) == (2, "", USAGE + "\n")


def test_usage_sans_arguments_du_processus(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(sys, "argv", ["skifer-board-telemetry"])
    assert lancer(capsys, None, {})[0] == 2


def test_base_non_configuree(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv(DATABASE_URL, raising=False)
    for environ in ({}, {DATABASE_URL: ""}, None):
        code, sortie, erreur = lancer(capsys, ["purge"], environ)
        assert (code, sortie) == (2, "")
        assert DATABASE_URL in erreur and "n'est pas définie" in erreur


@pytest.mark.parametrize(
    "adresse",
    [
        f"postgresql+psycopg://board:{MOT_DE_PASSE}@/etat",
        f"postgresql+pg8000://board:{MOT_DE_PASSE}@/etat?inconnue=1",
        f"pas une adresse {MOT_DE_PASSE}",
    ],
)
def test_configuration_malformee(adresse: str, capsys: pytest.CaptureFixture[str]) -> None:
    code, sortie, erreur = lancer(capsys, ["purge"], {DATABASE_URL: adresse})
    assert (code, sortie) == (2, "")
    assert erreur.startswith(DATABASE_URL)


def test_base_injoignable(capsys: pytest.CaptureFixture[str]) -> None:
    code, sortie, erreur = lancer(capsys, ["purge"], {DATABASE_URL: injoignable()})
    assert (code, sortie) == (1, "")
    assert "injoignable" in erreur


def test_schema_pas_a_jour(
    engine: Engine, database_url: URL, capsys: pytest.CaptureFixture[str]
) -> None:
    code, sortie, erreur = lancer(capsys, ["purge"], environnement(database_url))
    assert (code, sortie) == (1, "")
    assert erreur
    # Rien n'a été créé dans la base vierge.
    assert inspect(engine).get_table_names() == []


def test_purge_impossible(
    migre: Engine, database_url: URL, capsys: pytest.CaptureFixture[str]
) -> None:
    """Schéma à jour, table retirée par la main : erreur de base, sans détail du pilote."""
    telemetry.drop(migre)
    code, sortie, erreur = lancer(capsys, ["purge"], environnement(database_url))
    assert (code, sortie) == (1, "")
    assert erreur.startswith("Purge impossible dans la base d'état ")
    assert "telemetry" not in erreur and "relation" not in erreur
