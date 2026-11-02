"""Commande `skifer-board-migrate` : amène la base d'état à la dernière révision (plan 07, P3).

Lancée explicitement avant le serveur, jamais par lui. Code de sortie : 0 base à jour,
1 migration impossible, 2 configuration absente ou malformée.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Mapping

from sqlalchemy.exc import SQLAlchemyError

from ..identity.config import ConfigError
from .config import DATABASE_URL, config_from_env
from .database import connect, head_revision, upgrade


def main(environ: Mapping[str, str] | None = None) -> int:
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
        upgrade(engine)
    except SQLAlchemyError:
        # Le détail du pilote n'est pas recopié : il peut reprendre l'adresse de connexion.
        print(f"Migration impossible de la base d'état {config.describe()}.", file=sys.stderr)
        return 1
    finally:
        engine.dispose()
    print(f"Base d'état {config.describe()} à la révision {head_revision()}.")
    return 0
