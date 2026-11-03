"""Commande `skifer-board-telemetry purge` : retire les mesures de plus de 90 jours (plan 11, T6).

Le serveur purge déjà de lui-même, au plus une fois par heure ; la commande le fait à la
demande de l'exploitation. Code de sortie : 0 purge faite, 1 base injoignable, schéma pas à
jour ou purge impossible, 2 usage ou configuration absente ou malformée.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Callable, Mapping, Sequence
from datetime import UTC, datetime

from sqlalchemy.exc import SQLAlchemyError

from ..identity.config import ConfigError
from ..state.config import DATABASE_URL, config_from_env
from ..state.database import SchemaError, check_schema, connect
from .model import RETENTION
from .store import TelemetryStore

USAGE = "Usage : skifer-board-telemetry purge"


def _utc_now() -> datetime:
    return datetime.now(UTC)


def main(
    argv: Sequence[str] | None = None,
    environ: Mapping[str, str] | None = None,
    clock: Callable[[], datetime] = _utc_now,
) -> int:
    arguments = sys.argv[1:] if argv is None else list(argv)
    if arguments != ["purge"]:
        print(USAGE, file=sys.stderr)
        return 2
    try:
        config = config_from_env(os.environ if environ is None else environ)
    except ConfigError as error:
        print(error, file=sys.stderr)
        return 2
    if config is None:
        print(f"{DATABASE_URL} n'est pas définie.", file=sys.stderr)
        return 2
    engine = connect(config)
    try:
        check_schema(engine, config)
        before = clock() - RETENTION
        removed = TelemetryStore(engine).purge(before)
    except SchemaError as error:
        print(error, file=sys.stderr)
        return 1
    except SQLAlchemyError:
        # Le détail du pilote n'est pas recopié : il peut reprendre l'adresse de connexion.
        print(f"Purge impossible dans la base d'état {config.describe()}.", file=sys.stderr)
        return 1
    finally:
        engine.dispose()
    print(f"{removed} mesure(s) antérieure(s) au {before.isoformat()} retirée(s).")
    return 0
