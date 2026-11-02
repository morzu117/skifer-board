"""Commande `skifer-board-migrate` : codes de sortie et messages sans secret (plan 07, P3, P10)."""

import os

import pytest
from skifer_board.state import DATABASE_URL, current_revision, head_revision, migrate
from sqlalchemy import Engine, inspect
from sqlalchemy.engine import URL

from .conftest import MOT_DE_PASSE, environnement, injoignable


def lancer(
    environ: dict[str, str] | None, capsys: pytest.CaptureFixture[str]
) -> tuple[int, str, str]:
    code = migrate.main(environ)
    sortie = capsys.readouterr()
    assert MOT_DE_PASSE not in sortie.out + sortie.err
    return code, sortie.out, sortie.err


def test_sans_variable(capsys: pytest.CaptureFixture[str]) -> None:
    code, sortie, erreur = lancer({}, capsys)
    assert code == 2
    assert DATABASE_URL in erreur
    assert sortie == ""


def test_lit_l_environnement_du_processus(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(os, "environ", {DATABASE_URL: ""})
    code, sortie, erreur = lancer(None, capsys)
    assert code == 2
    assert DATABASE_URL in erreur


@pytest.mark.parametrize(
    "valeur",
    [
        "pas une adresse",
        f"postgresql://board:{MOT_DE_PASSE}@hote/etat",
        f"postgresql+psycopg://board:{MOT_DE_PASSE}@hote/etat",
        f"postgresql+pg8000://board:{MOT_DE_PASSE}@hote/",
    ],
)
def test_adresse_malformee(valeur: str, capsys: pytest.CaptureFixture[str]) -> None:
    code, sortie, erreur = lancer({DATABASE_URL: valeur}, capsys)
    assert code == 2
    assert DATABASE_URL in erreur
    assert sortie == ""


def test_base_injoignable(capsys: pytest.CaptureFixture[str]) -> None:
    code, sortie, erreur = lancer({DATABASE_URL: injoignable()}, capsys)
    assert code == 1
    assert sortie == ""
    assert "« etat »" in erreur
    assert "pg8000" not in erreur


def test_base_vierge_puis_relance(
    database_url: URL, engine: Engine, capsys: pytest.CaptureFixture[str]
) -> None:
    environ = environnement(database_url)
    code, sortie, erreur = lancer(environ, capsys)
    assert code == 0
    assert erreur == ""
    assert head_revision() in sortie
    assert "révision" in sortie
    assert database_url.database is not None and database_url.database in sortie
    assert current_revision(engine) == head_revision()
    tables = set(inspect(engine).get_table_names())

    code, sortie, erreur = lancer(environ, capsys)
    assert code == 0
    assert erreur == ""
    assert head_revision() in sortie
    assert current_revision(engine) == head_revision()
    assert set(inspect(engine).get_table_names()) == tables


def test_port_illisible(capsys: pytest.CaptureFixture[str]) -> None:
    code, sortie, erreur = lancer({DATABASE_URL: "postgresql+pg8000://board@hote:abc/etat"}, capsys)
    assert code == 2
    assert DATABASE_URL in erreur and "illisible" in erreur
    assert sortie == ""


@pytest.mark.parametrize(
    ("options", "cause"),
    [("sslmode=require", "verify-full"), ("connect_timeout=5", "connect_timeout")],
)
def test_option_refusee_des_la_configuration(
    options: str, cause: str, capsys: pytest.CaptureFixture[str]
) -> None:
    code, sortie, erreur = lancer({DATABASE_URL: f"{injoignable()}&{options}"}, capsys)
    assert code == 2
    assert DATABASE_URL in erreur and cause in erreur
    assert sortie == ""


def test_hote_distant_sans_tls(capsys: pytest.CaptureFixture[str]) -> None:
    valeur = f"postgresql+pg8000://board:{MOT_DE_PASSE}@db.example.invalid/etat"
    code, sortie, erreur = lancer({DATABASE_URL: valeur}, capsys)
    assert code == 2
    assert "sslmode=verify-full" in erreur
    assert sortie == ""
