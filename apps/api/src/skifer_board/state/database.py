"""Connexion à la base d'état, révisions du schéma et contrôle au démarrage (plan 07, P3, P4).

Les migrations ne sont jamais appliquées au démarrage du serveur : le serveur vérifie
seulement que le schéma est exactement à la dernière révision, et refuse sinon.
"""

from __future__ import annotations

import ssl
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, create_engine
from sqlalchemy.exc import SQLAlchemyError

from .config import DatabaseConfig

MIGRATIONS = Path(__file__).parent / "migrations"
MIGRATE_COMMAND = "skifer-board-migrate"


class SchemaError(Exception):
    """Base injoignable ou schéma qui n'est pas à la dernière révision : refus de démarrer."""


def connect(config: DatabaseConfig) -> Engine:
    # Contexte par défaut : certificat vérifié contre les autorités du système, nom d'hôte compris.
    options = {"ssl_context": ssl.create_default_context()} if config.tls else {}
    # `pool_pre_ping` : une connexion rompue est remplacée avant usage, pas servie en erreur.
    return create_engine(config.url, pool_pre_ping=True, connect_args=options)


def _alembic() -> Config:
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    return config


def _scripts() -> ScriptDirectory:
    return ScriptDirectory.from_config(_alembic())


def head_revision() -> str:
    head = _scripts().get_current_head()
    assert head is not None, "aucune révision de migration"
    return head


def known_revisions() -> frozenset[str]:
    return frozenset(script.revision for script in _scripts().walk_revisions())


def current_revision(engine: Engine) -> str | None:
    with engine.connect() as connection:
        return MigrationContext.configure(connection).get_current_revision()


def upgrade(engine: Engine) -> None:
    """Applique les révisions jusqu'à la dernière ; sans effet sur une base à jour."""
    config = _alembic()
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")


def check_schema(engine: Engine, config: DatabaseConfig) -> None:
    """Lève `SchemaError` si la base est injoignable ou si son schéma n'est pas à jour."""
    where = config.describe()
    try:
        current = current_revision(engine)
    except SQLAlchemyError:
        # Le détail du pilote n'est pas recopié : il peut reprendre l'adresse de connexion.
        raise SchemaError(f"Base d'état {where} injoignable.") from None
    head = head_revision()
    if current == head:
        return
    if current is None:
        raise SchemaError(f"Base d'état {where} vide : lancez `{MIGRATE_COMMAND}`.")
    if current in known_revisions():
        raise SchemaError(
            f"Schéma de la base d'état {where} en retard (révision {current}, "
            f"attendue {head}) : lancez `{MIGRATE_COMMAND}`."
        )
    raise SchemaError(
        f"Schéma de la base d'état {where} à une révision inconnue ({current}) : "
        "ce serveur est plus ancien que la base."
    )
