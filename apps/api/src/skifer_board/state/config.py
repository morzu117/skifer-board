"""Adresse de la base d'état, lue dans l'environnement (plan 07, P1, P10 et P11).

L'adresse peut porter un mot de passe : elle n'apparaît ni dans une représentation, ni dans
un message d'erreur. Les messages nomment la base et son hôte, jamais l'adresse complète.
Une base jointe par le réseau hors de la boucle locale exige TLS vérifié.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field

from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError

from ..identity.config import ConfigError, is_loopback

DATABASE_URL = "SKIFER_BOARD_DATABASE_URL"
DRIVER = "postgresql+pg8000"
# Options d'adresse admises ; toute autre serait refusée par le pilote à la première connexion.
OPTIONS = frozenset({"unix_sock", "application_name", "sslmode"})
TLS_MODE = "verify-full"


@dataclass(frozen=True)
class DatabaseConfig:
    # Jamais dans une représentation : l'adresse peut contenir un mot de passe.
    url: URL = field(repr=False)
    # TLS avec vérification du certificat et du nom d'hôte (P11).
    tls: bool = False

    def describe(self) -> str:
        """Base et hôte, ou fichier socket : de quoi diagnostiquer, sans aucun secret."""
        socket = self.url.query.get("unix_sock")
        where = self.url.host or (socket if isinstance(socket, str) else "socket local")
        return f"« {self.url.database} » sur {where}"


def config_from_env(environ: Mapping[str, str]) -> DatabaseConfig | None:
    """Base configurée, ou `None` si la variable est absente ou vide."""
    value = environ.get(DATABASE_URL)
    if not value:
        return None
    try:
        url = make_url(value)
    except (ArgumentError, ValueError):
        # Le message d'origine recopierait l'adresse, mot de passe compris.
        raise ConfigError(f"{DATABASE_URL} : adresse illisible.") from None
    if url.drivername != DRIVER:
        raise ConfigError(f"{DATABASE_URL} : pilote `{DRIVER}` attendu.")
    if "@" in (url.host or "") or any(c in (url.database or "") for c in "@/"):
        # Un `@` ou un `/` non encodé dans le mot de passe déplace la frontière avec l'hôte
        # et la base : des fragments du mot de passe y seraient lus, puis affichés.
        raise ConfigError(
            f"{DATABASE_URL} : caractères du mot de passe à encoder (`@` en %40, `/` en %2F)."
        )
    if not url.database:
        raise ConfigError(f"{DATABASE_URL} : nom de base attendu.")
    unknown = sorted(set(url.query) - OPTIONS)
    if unknown:
        raise ConfigError(f"{DATABASE_URL} : options non prises en charge : {', '.join(unknown)}.")
    if any(not isinstance(option, str) for option in url.query.values()):
        raise ConfigError(f"{DATABASE_URL} : option répétée.")
    mode = url.query.get("sslmode")
    if mode is not None and mode != TLS_MODE:
        raise ConfigError(f"{DATABASE_URL} : seul `sslmode={TLS_MODE}` est admis.")
    tls = mode is not None
    if url.host is not None and not is_loopback(url.host) and not tls:
        raise ConfigError(
            f"{DATABASE_URL} : TLS exigé hors de la boucle locale, ajoutez `?sslmode={TLS_MODE}`."
        )
    # `sslmode` est une option de libpq, pas de pg8000 : TLS passe par `connect`.
    return DatabaseConfig(url.difference_update_query(["sslmode"]), tls)
