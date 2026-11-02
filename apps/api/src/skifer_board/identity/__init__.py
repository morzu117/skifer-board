"""Identité de la personne, établie par le backend auprès d'un fournisseur OIDC (plan 06)."""

from .config import ConfigError, OidcConfig, config_from_env, is_loopback
from .keys import Http, ProviderError, ProviderKeys, ProviderMetadata, UrllibHttp, discover
from .model import Identity, Refusal, RefusalCode
from .verify import ALGORITHMS, verify_id_token

__all__ = [
    "ALGORITHMS",
    "ConfigError",
    "Http",
    "Identity",
    "OidcConfig",
    "ProviderError",
    "ProviderKeys",
    "ProviderMetadata",
    "Refusal",
    "RefusalCode",
    "UrllibHttp",
    "config_from_env",
    "discover",
    "is_loopback",
    "verify_id_token",
]
