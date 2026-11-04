"""Base d'état au démarrage du serveur : facultative, mais jamais à moitié (plan 07, P3, P4)."""

from collections.abc import Callable
from unittest.mock import Mock

import pytest
from skifer_board import server
from skifer_board.state import (
    DATABASE_URL,
    MIGRATE_COMMAND,
    DatabaseConfig,
    connect,
    current_revision,
    head_revision,
    known_revisions,
)
from sqlalchemy import Engine, inspect
from sqlalchemy.engine import URL

from .conftest import MOT_DE_PASSE, environnement, injoignable


def refus(environ: dict[str, str]) -> str:
    with pytest.raises(SystemExit) as arret:
        server.state_engine(environ)
    message = str(arret.value)
    assert MOT_DE_PASSE not in message
    return message


@pytest.mark.parametrize("environ", [{}, {DATABASE_URL: ""}])
def test_sans_base(environ: dict[str, str]) -> None:
    assert server.state_engine(environ) is None


@pytest.mark.parametrize(
    "valeur",
    [
        "pas une adresse",
        f"postgresql+psycopg://board:{MOT_DE_PASSE}@hote/etat",
        f"sqlite:///{MOT_DE_PASSE}.db",
        f"postgresql+pg8000://board:{MOT_DE_PASSE}@hote/",
    ],
)
def test_adresse_malformee(valeur: str) -> None:
    assert DATABASE_URL in refus({DATABASE_URL: valeur})


@pytest.fixture
def moteurs(monkeypatch: pytest.MonkeyPatch) -> list[Engine]:
    """Moteurs créés par le serveur, pour vérifier qu'un refus les libère."""
    crees: list[Engine] = []
    connecter: Callable[[DatabaseConfig], Engine] = connect

    def espion(config: DatabaseConfig) -> Engine:
        moteur = connecter(config)
        monkeypatch.setattr(moteur, "dispose", Mock(wraps=moteur.dispose))
        crees.append(moteur)
        return moteur

    monkeypatch.setattr(server, "connect", espion)
    return crees


def test_base_vide(database_url: URL, engine: Engine, moteurs: list[Engine]) -> None:
    message = refus(environnement(database_url))
    assert "vide" in message
    assert MIGRATE_COMMAND in message
    # Jamais de migration au démarrage (P3) : la base reste vide.
    assert current_revision(engine) is None
    assert inspect(engine).get_table_names() == []
    [moteur] = moteurs
    assert isinstance(moteur.dispose, Mock)
    moteur.dispose.assert_called_once_with()


def test_base_injoignable(moteurs: list[Engine]) -> None:
    message = refus({DATABASE_URL: injoignable()})
    assert "injoignable" in message
    assert "« etat »" in message
    assert "pg8000" not in message
    [moteur] = moteurs
    assert isinstance(moteur.dispose, Mock)
    moteur.dispose.assert_called_once_with()


def test_schema_en_retard(
    database_url: URL, migre: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    from skifer_board.state import database

    monkeypatch.setattr(database, "head_revision", lambda: "9999")
    message = refus(environnement(database_url))
    assert "en retard" in message
    assert MIGRATE_COMMAND in message
    assert current_revision(migre) in known_revisions()


def test_base_migree(database_url: URL, migre: Engine) -> None:
    moteur = server.state_engine(environnement(database_url))
    assert moteur is not None
    try:
        assert current_revision(moteur) == head_revision()
        assert moteur.url.database == database_url.database
        # Le moteur garde le mot de passe pour se connecter, mais ne l'affiche pas.
        assert MOT_DE_PASSE not in repr(moteur)
        assert MOT_DE_PASSE not in str(moteur.url)
    finally:
        moteur.dispose()


@pytest.mark.parametrize(
    ("options", "cause"),
    [("sslmode=require", "verify-full"), ("connect_timeout=5", "connect_timeout")],
)
def test_option_refusee_des_la_configuration(
    options: str, cause: str, moteurs: list[Engine]
) -> None:
    message = refus({DATABASE_URL: f"{injoignable()}&{options}"})
    assert DATABASE_URL in message and cause in message
    # Refus avant toute connexion : aucun moteur n'est créé.
    assert moteurs == []


def test_hote_distant_sans_tls(moteurs: list[Engine]) -> None:
    valeur = f"postgresql+pg8000://board:{MOT_DE_PASSE}@db.example.invalid/etat"
    assert "sslmode=verify-full" in refus({DATABASE_URL: valeur})
    assert moteurs == []


def test_port_illisible() -> None:
    message = refus({DATABASE_URL: "postgresql+pg8000://board@hote:abc/etat"})
    assert DATABASE_URL in message and "illisible" in message
