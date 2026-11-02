"""Configuration OIDC lue dans l'environnement (plan 06, I7).

Aucune variable OIDC : mode local, sans identité. Une partie seulement : erreur qui nomme
ce qui manque, jamais un repli sur le mode local.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import timedelta
from urllib.parse import urlsplit

ISSUER = "SKIFER_BOARD_OIDC_ISSUER"
CLIENT_ID = "SKIFER_BOARD_OIDC_CLIENT_ID"
CLIENT_SECRET = "SKIFER_BOARD_OIDC_CLIENT_SECRET"
REDIRECT_URI = "SKIFER_BOARD_OIDC_REDIRECT_URI"
PUBLIC_ORIGIN = "SKIFER_BOARD_PUBLIC_ORIGIN"
GROUPS_CLAIM = "SKIFER_BOARD_OIDC_GROUPS_CLAIM"
SESSION_HOURS = "SKIFER_BOARD_SESSION_HOURS"
SESSION_IDLE_MINUTES = "SKIFER_BOARD_SESSION_IDLE_MINUTES"
# Groupe d'administration de la plateforme (plan 08, E6) : crée les espaces.
ADMIN_GROUP = "SKIFER_BOARD_ADMIN_GROUP"

REQUIRED = (ISSUER, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, PUBLIC_ORIGIN)
OPTIONAL = (GROUPS_CLAIM, SESSION_HOURS, SESSION_IDLE_MINUTES, ADMIN_GROUP)

LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


class ConfigError(ValueError):
    """Configuration OIDC incomplète ou malformée : le serveur ne démarre pas."""


@dataclass(frozen=True)
class OidcConfig:
    issuer: str
    client_id: str
    # Jamais dans une représentation : un journal ou une trace ne doit pas le montrer.
    client_secret: str = field(repr=False)
    redirect_uri: str
    public_origin: str
    groups_claim: str = "groups"
    session_absolute: timedelta = timedelta(hours=8)
    session_idle: timedelta = timedelta(minutes=30)
    # Sans groupe d'administration, personne ne crée d'espace (plan 08, E6).
    admin_group: str | None = None


def is_loopback(host: str) -> bool:
    return host in LOOPBACK_HOSTS


def check_url(name: str, value: str) -> str:
    """Adresse absolue en `https`, ou en `http` sur la boucle locale seulement."""
    parts = urlsplit(value)
    host = parts.hostname or ""
    if not host or parts.scheme not in ("https", "http"):
        raise ConfigError(f"{name} : adresse absolue attendue.")
    if parts.scheme == "http" and not is_loopback(host):
        raise ConfigError(f"{name} : `https` exigé hors de la boucle locale.")
    if parts.username or parts.password or parts.fragment:
        raise ConfigError(f"{name} : ni identifiants ni fragment dans l'adresse.")
    return value


def _origin(value: str) -> str:
    check_url(PUBLIC_ORIGIN, value)
    parts = urlsplit(value)
    if parts.path not in ("", "/") or parts.query:
        raise ConfigError(f"{PUBLIC_ORIGIN} : origine seule attendue (schéma, hôte, port).")
    return f"{parts.scheme}://{parts.netloc}"


def _positive(name: str, value: str | None, default: int) -> int:
    if value is None:
        return default
    if not value.isascii() or not value.isdigit() or int(value) < 1:
        raise ConfigError(f"{name} : entier strictement positif attendu.")
    return int(value)


def config_from_env(environ: Mapping[str, str]) -> OidcConfig | None:
    """`None` si aucune variable OIDC n'est posée ; sinon une configuration complète."""
    present = {name: environ[name] for name in (*REQUIRED, *OPTIONAL) if environ.get(name)}
    if not present:
        return None
    missing = [name for name in REQUIRED if name not in present]
    if missing:
        raise ConfigError(f"Configuration OIDC incomplète : {', '.join(missing)}.")
    issuer = check_url(ISSUER, present[ISSUER])
    origin = _origin(present[PUBLIC_ORIGIN])
    redirect = check_url(REDIRECT_URI, present[REDIRECT_URI])
    if not redirect.startswith(f"{origin}/"):
        raise ConfigError(f"{REDIRECT_URI} : doit être servie par l'origine publique {origin}.")
    hours = _positive(SESSION_HOURS, present.get(SESSION_HOURS), 8)
    idle = _positive(SESSION_IDLE_MINUTES, present.get(SESSION_IDLE_MINUTES), 30)
    return OidcConfig(
        issuer=issuer,
        client_id=present[CLIENT_ID],
        client_secret=present[CLIENT_SECRET],
        redirect_uri=redirect,
        public_origin=origin,
        groups_claim=present.get(GROUPS_CLAIM, "groups"),
        session_absolute=timedelta(hours=hours),
        session_idle=timedelta(minutes=idle),
        admin_group=present.get(ADMIN_GROUP),
    )
