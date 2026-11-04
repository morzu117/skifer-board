"""Identité de la personne, établie par le backend auprès d'un fournisseur OIDC (plan 06)."""

from .config import ConfigError, OidcConfig, config_from_env, is_loopback
from .flow import (
    LOGIN_LIFETIME,
    LoginFlow,
    LoginRefusal,
    LoginRequests,
    LoginStart,
    MemoryLoginRequests,
    PendingLogin,
)
from .keys import Http, ProviderError, ProviderKeys, ProviderMetadata, UrllibHttp, discover
from .model import Identity, Refusal, RefusalCode
from .sessions import MemorySessionStore, Session, SessionStore, fingerprint
from .verify import ALGORITHMS, verify_id_token
from .web import (
    LOGIN_COOKIE,
    LOGIN_PATH,
    LOGOUT_PATH,
    SESSION_COOKIE,
    IdentityRuntime,
    build_runtime,
    install_identity,
)

__all__ = [
    "ALGORITHMS",
    "LOGIN_COOKIE",
    "LOGIN_LIFETIME",
    "LOGIN_PATH",
    "LOGOUT_PATH",
    "SESSION_COOKIE",
    "ConfigError",
    "Http",
    "Identity",
    "IdentityRuntime",
    "LoginFlow",
    "LoginRefusal",
    "LoginRequests",
    "LoginStart",
    "MemoryLoginRequests",
    "MemorySessionStore",
    "OidcConfig",
    "PendingLogin",
    "ProviderError",
    "ProviderKeys",
    "ProviderMetadata",
    "Refusal",
    "RefusalCode",
    "Session",
    "SessionStore",
    "UrllibHttp",
    "build_runtime",
    "config_from_env",
    "discover",
    "fingerprint",
    "install_identity",
    "is_loopback",
    "verify_id_token",
]
