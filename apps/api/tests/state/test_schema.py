"""Contrôle du schéma au démarrage : fail-closed, cause nommée, sans secret (plan 07, P4, P10)."""

from collections.abc import Iterator

import pytest
from postgres import Cluster
from skifer_board.state import (
    MIGRATE_COMMAND,
    DatabaseConfig,
    SchemaError,
    check_schema,
    config_from_env,
    connect,
    current_revision,
    database,
    upgrade,
)
from sqlalchemy import Column, Engine, MetaData, String, Table, update
from sqlalchemy.engine import URL

from .conftest import MOT_DE_PASSE, environnement, injoignable

VERSION = Table("alembic_version", MetaData(), Column("version_num", String(32)))
DETAILS_DU_PILOTE = ("pg8000", "InterfaceError", "OperationalError", "ProgrammingError", "{")


def lire(environ: dict[str, str]) -> DatabaseConfig:
    config = config_from_env(environ)
    assert config is not None
    return config


@pytest.fixture
def config(database_url: URL) -> DatabaseConfig:
    """Base vierge de test, adresse portant un mot de passe."""
    return lire(environnement(database_url))


@pytest.fixture
def base(config: DatabaseConfig) -> Iterator[Engine]:
    moteur = connect(config)
    try:
        yield moteur
    finally:
        moteur.dispose()


def refus(base: Engine, config: DatabaseConfig) -> str:
    with pytest.raises(SchemaError) as erreur:
        check_schema(base, config)
    message = str(erreur.value)
    assert MOT_DE_PASSE not in message
    assert config.describe() in message
    assert erreur.value.__cause__ is None
    return message


def ecrire_revision(base: Engine, revision: str) -> None:
    with base.begin() as connexion:
        connexion.execute(update(VERSION).values(version_num=revision))


def test_schema_a_jour(base: Engine, config: DatabaseConfig) -> None:
    upgrade(base)
    check_schema(base, config)


def test_base_vide(base: Engine, config: DatabaseConfig) -> None:
    message = refus(base, config)
    assert "vide" in message
    assert MIGRATE_COMMAND in message
    assert MIGRATE_COMMAND == "skifer-board-migrate"
    # Le contrôle n'applique jamais les migrations lui-même (P3).
    assert current_revision(base) is None


def test_schema_en_retard(
    base: Engine, config: DatabaseConfig, monkeypatch: pytest.MonkeyPatch
) -> None:
    upgrade(base)
    actuelle = database.head_revision()
    # Une seule révision existe : on simule un serveur qui en connaît une suivante.
    monkeypatch.setattr(database, "head_revision", lambda: "9999")
    message = refus(base, config)
    assert "en retard" in message
    assert MIGRATE_COMMAND in message
    assert actuelle in message and "9999" in message
    assert current_revision(base) == actuelle


def test_schema_en_retard_par_revision_ancienne(
    base: Engine, config: DatabaseConfig, monkeypatch: pytest.MonkeyPatch
) -> None:
    upgrade(base)
    connues = database.known_revisions()
    monkeypatch.setattr(database, "known_revisions", lambda: connues | {"0000"})
    ecrire_revision(base, "0000")
    message = refus(base, config)
    assert "en retard" in message
    assert "0000" in message
    assert current_revision(base) == "0000"


def test_revision_inconnue(base: Engine, config: DatabaseConfig) -> None:
    upgrade(base)
    ecrire_revision(base, "f00dcafe")
    message = refus(base, config)
    assert "révision inconnue" in message
    assert "f00dcafe" in message
    # Le serveur ne corrige pas une base plus récente que lui.
    assert current_revision(base) == "f00dcafe"


def test_socket_injoignable() -> None:
    config = lire({"SKIFER_BOARD_DATABASE_URL": injoignable()})
    moteur = connect(config)
    try:
        message = refus(moteur, config)
    finally:
        moteur.dispose()
    assert "injoignable" in message
    for detail in DETAILS_DU_PILOTE:
        assert detail not in message


def test_base_inexistante(postgres_cluster: Cluster) -> None:
    config = lire(environnement(postgres_cluster.url("base_inexistante")))
    moteur = connect(config)
    try:
        with pytest.raises(SchemaError) as erreur:
            check_schema(moteur, config)
    finally:
        moteur.dispose()
    message = str(erreur.value)
    assert "injoignable" in message
    assert "base_inexistante" in message
    assert MOT_DE_PASSE not in message
    assert "does not exist" not in message
    for detail in DETAILS_DU_PILOTE:
        assert detail not in message
    # Le détail du pilote n'est ni chaîné ni affiché dans la trace.
    assert erreur.value.__cause__ is None
    assert erreur.value.__suppress_context__
