"""Vérification stricte du jeton d'identité OIDC (plan 06, I2).

PyJWT ne sert qu'à vérifier la signature. Chaque claim est ensuite contrôlé ici, par type
exact et sans tolérance d'horloge, pour que chaque refus ait son code fermé.
"""

from __future__ import annotations

import hmac
import math
from collections.abc import Callable, Mapping
from datetime import datetime
from typing import Any

import jwt
from jwt.types import Options

from .config import OidcConfig
from .keys import ProviderError, ProviderKeys
from .model import Identity, Refusal, RefusalCode

# Jamais `none` ni un HMAC : la clé d'un HMAC serait le secret client, connu de Board.
ALGORITHMS = frozenset({"RS256", "ES256"})

# Seule la signature est confiée à PyJWT ; les claims sont contrôlés par `_claims`.
_SIGNATURE_ONLY: Options = {
    "verify_signature": True,
    "verify_exp": False,
    "verify_nbf": False,
    "verify_iat": False,
    "verify_aud": False,
    "verify_iss": False,
    "verify_sub": False,
    "verify_jti": False,
    "require": [],
}


def _refuse(code: RefusalCode, detail: str) -> Refusal:
    return Refusal(code, detail)


def _is_number(value: object) -> bool:
    # Fini : un `exp` à NaN ne serait jamais atteint, ni par `>=` ni par `<`.
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def _optional_text(claims: Mapping[str, Any], name: str) -> str | None | Refusal:
    value = claims.get(name)
    if value is None or isinstance(value, str):
        return value
    return _refuse(RefusalCode.INVALID_CLAIM, name)


def _groups(claims: Mapping[str, Any], name: str) -> tuple[str, ...] | Refusal:
    value = claims.get(name)
    if value is None:
        return ()
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        return _refuse(RefusalCode.INVALID_CLAIM, name)
    return tuple(value)


def _audience(claims: Mapping[str, Any], client_id: str) -> Refusal | None:
    audience = claims.get("aud")
    if audience is None:
        return _refuse(RefusalCode.MISSING_CLAIM, "aud")
    if isinstance(audience, str):
        audiences = [audience]
    elif (
        isinstance(audience, list) and audience and all(isinstance(item, str) for item in audience)
    ):
        audiences = audience
    else:
        return _refuse(RefusalCode.INVALID_CLAIM, "aud")
    if client_id not in audiences:
        return _refuse(RefusalCode.WRONG_AUDIENCE, "aud")
    # OpenID Connect Core §3.1.3.7 : plusieurs audiences exigent `azp` ; présent, il doit
    # désigner Board.
    authorized = claims.get("azp")
    if authorized is None and len(audiences) > 1:
        return _refuse(RefusalCode.MISSING_CLAIM, "azp")
    if authorized is not None and authorized != client_id:
        if not isinstance(authorized, str):
            return _refuse(RefusalCode.INVALID_CLAIM, "azp")
        return _refuse(RefusalCode.WRONG_AUTHORIZED_PARTY, "azp")
    return None


def _times(claims: Mapping[str, Any], now: float) -> Refusal | None:
    for name in ("exp", "iat"):
        if name not in claims:
            return _refuse(RefusalCode.MISSING_CLAIM, name)
        if not _is_number(claims[name]):
            return _refuse(RefusalCode.INVALID_CLAIM, name)
    if "nbf" in claims and not _is_number(claims["nbf"]):
        return _refuse(RefusalCode.INVALID_CLAIM, "nbf")
    # Aucune tolérance d'horloge : expiré à l'instant même de `exp`.
    if now >= claims["exp"]:
        return _refuse(RefusalCode.EXPIRED, "exp")
    if "nbf" in claims and now < claims["nbf"]:
        return _refuse(RefusalCode.NOT_YET_VALID, "nbf")
    return None


def _claims(
    claims: Mapping[str, Any], config: OidcConfig, nonce: str, now: float
) -> Identity | Refusal:
    issuer = claims.get("iss")
    if issuer is None:
        return _refuse(RefusalCode.MISSING_CLAIM, "iss")
    if not isinstance(issuer, str):
        return _refuse(RefusalCode.INVALID_CLAIM, "iss")
    if issuer != config.issuer:
        return _refuse(RefusalCode.WRONG_ISSUER, "iss")
    refused = _audience(claims, config.client_id) or _times(claims, now)
    if refused is not None:
        return refused
    received = claims.get("nonce")
    if received is None:
        return _refuse(RefusalCode.MISSING_CLAIM, "nonce")
    if not isinstance(received, str):
        return _refuse(RefusalCode.INVALID_CLAIM, "nonce")
    if not hmac.compare_digest(received.encode(), nonce.encode()):
        return _refuse(RefusalCode.NONCE_MISMATCH, "nonce")
    subject = claims.get("sub")
    if subject is None:
        return _refuse(RefusalCode.MISSING_CLAIM, "sub")
    if not isinstance(subject, str) or not subject:
        return _refuse(RefusalCode.INVALID_CLAIM, "sub")
    name = _optional_text(claims, "name")
    if isinstance(name, Refusal):
        return name
    email = _optional_text(claims, "email")
    if isinstance(email, Refusal):
        return email
    groups = _groups(claims, config.groups_claim)
    if isinstance(groups, Refusal):
        return groups
    return Identity(issuer, subject, name, email, groups)


def verify_id_token(
    token: str,
    *,
    nonce: str,
    config: OidcConfig,
    keys: ProviderKeys,
    clock: Callable[[], datetime],
) -> Identity | Refusal:
    """Identité portée par le jeton, ou la raison fermée de son refus."""
    try:
        header = jwt.get_unverified_header(token)
    except jwt.DecodeError:
        return _refuse(RefusalCode.MALFORMED_TOKEN, "header")
    except jwt.InvalidTokenError:
        # Seul autre refus de PyJWT sur un en-tête lisible : un `kid` qui n'est pas du texte.
        return _refuse(RefusalCode.UNKNOWN_KEY, "kid")
    algorithm = header.get("alg")
    if not isinstance(algorithm, str) or algorithm not in ALGORITHMS:
        return _refuse(RefusalCode.UNSUPPORTED_ALGORITHM, "alg")
    kid = header.get("kid")
    if not isinstance(kid, str):
        return _refuse(RefusalCode.UNKNOWN_KEY, "kid")
    try:
        key = keys.key_for(kid)
    except ProviderError:
        return _refuse(RefusalCode.PROVIDER_UNAVAILABLE, "jwks")
    if key is None:
        return _refuse(RefusalCode.UNKNOWN_KEY, "kid")
    # Une clé qui déclare son algorithme ne signe que celui-là.
    if key.algorithm_name != algorithm:
        return _refuse(RefusalCode.UNSUPPORTED_ALGORITHM, "alg")
    try:
        claims = jwt.decode(token, key.key, algorithms=[algorithm], options=_SIGNATURE_ONLY)
    except jwt.InvalidSignatureError:
        return _refuse(RefusalCode.INVALID_SIGNATURE, "signature")
    except jwt.InvalidTokenError:
        return _refuse(RefusalCode.MALFORMED_TOKEN, "payload")
    return _claims(claims, config, nonce, clock().timestamp())
