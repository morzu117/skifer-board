"""Identité établie par le backend, et refus à codes fermés (plan 06, I2)."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


@dataclass(frozen=True)
class Identity:
    """Personne authentifiée par le fournisseur OIDC. Jamais reçue du navigateur (§4.3)."""

    issuer: str
    subject: str
    name: str | None
    email: str | None
    # Lus, pas encore interprétés : aucun droit n'en dépend avant les espaces (I9).
    groups: tuple[str, ...]


class RefusalCode(StrEnum):
    """Raison fermée d'un jeton refusé. Un refus n'est jamais une identité dégradée."""

    MALFORMED_TOKEN = "malformed_token"
    UNSUPPORTED_ALGORITHM = "unsupported_algorithm"
    UNKNOWN_KEY = "unknown_key"
    INVALID_SIGNATURE = "invalid_signature"
    WRONG_ISSUER = "wrong_issuer"
    WRONG_AUDIENCE = "wrong_audience"
    WRONG_AUTHORIZED_PARTY = "wrong_authorized_party"
    EXPIRED = "expired"
    NOT_YET_VALID = "not_yet_valid"
    MISSING_CLAIM = "missing_claim"
    INVALID_CLAIM = "invalid_claim"
    NONCE_MISMATCH = "nonce_mismatch"
    PROVIDER_UNAVAILABLE = "provider_unavailable"


@dataclass(frozen=True)
class Refusal:
    """Refus d'un jeton. `detail` nomme le claim en cause, jamais sa valeur ni le jeton."""

    code: RefusalCode
    detail: str
