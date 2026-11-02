"""État de Board dans PostgreSQL : schéma, migrations et contrôle au démarrage (plan 07)."""

from .config import DATABASE_URL, DatabaseConfig, config_from_env
from .database import (
    MIGRATE_COMMAND,
    SchemaError,
    check_schema,
    connect,
    current_revision,
    head_revision,
    known_revisions,
    upgrade,
)
from .schema import login_requests, metadata, sessions

__all__ = [
    "DATABASE_URL",
    "MIGRATE_COMMAND",
    "DatabaseConfig",
    "SchemaError",
    "check_schema",
    "config_from_env",
    "connect",
    "current_revision",
    "head_revision",
    "known_revisions",
    "login_requests",
    "metadata",
    "sessions",
    "upgrade",
]
