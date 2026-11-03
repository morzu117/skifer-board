"""Commande explicite de rotation des identifiants chiffrés (plan 12, 12.2)."""

from __future__ import annotations

import os
import sys
from collections.abc import Mapping

from sqlalchemy.exc import SQLAlchemyError

from ..identity.config import ConfigError
from ..state import config_from_env, connect
from .vault import CredentialVault, VaultConfigError, VaultError, keys_from_env


def main(environ: Mapping[str, str] | None = None) -> int:
    source = os.environ if environ is None else environ
    try:
        config = config_from_env(source)
        keys = keys_from_env(source)
    except (ConfigError, VaultConfigError) as error:
        print(error, file=sys.stderr)
        return 2
    if config is None or keys is None:
        print("Base d'état et clés du coffre obligatoires.", file=sys.stderr)
        return 2
    engine = connect(config)
    try:
        result = CredentialVault(engine, keys).rotate()
    except (VaultError, SQLAlchemyError):
        print(
            "Rotation impossible : clé manquante, valeur illisible ou base indisponible.",
            file=sys.stderr,
        )
        return 1
    finally:
        engine.dispose()
    print(
        f"Identifiants réécrits : {result['rotated']} ; "
        f"références à une clé non active : {result['remaining_non_active']}."
    )
    return 0
