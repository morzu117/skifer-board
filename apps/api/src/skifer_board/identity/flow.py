"""Parcours de connexion OIDC mené par le backend (plan 06, I1).

Authorization Code avec PKCE `S256`. `state` et `nonce` sont à usage unique et expirent
au bout de 10 minutes. La demande est liée au navigateur qui l'a ouverte par un cookie
de connexion, contre la connexion forcée (un tiers qui ferait terminer sa propre
connexion par la victime).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from urllib.parse import urlencode

from .config import OidcConfig
from .keys import Http, ProviderError, ProviderKeys
from .model import Identity, Refusal
from .sessions import fingerprint, new_token
from .verify import verify_id_token

LOGIN_LIFETIME = timedelta(minutes=10)
SCOPES = "openid profile email"


class LoginRefusal(StrEnum):
    """Raison fermée d'une connexion qui n'aboutit pas, renvoyée à l'application."""

    CANCELLED = "login_cancelled"
    INVALID_STATE = "invalid_state"
    CODE_REJECTED = "code_rejected"
    PROVIDER_UNAVAILABLE = "provider_unavailable"
    TOKEN_REFUSED = "token_refused"


@dataclass(frozen=True)
class LoginStart:
    redirect_url: str
    # Valeur du cookie de connexion, à poser sur le navigateur qui a demandé.
    binding: str


@dataclass(frozen=True)
class _Pending:
    nonce: str
    verifier: str
    binding: str
    created_at: datetime


def _challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def _same(left: str, right: str) -> bool:
    return hmac.compare_digest(left.encode(), right.encode())


class LoginFlow:
    def __init__(
        self,
        config: OidcConfig,
        keys: ProviderKeys,
        http: Http,
        clock: Callable[[], datetime],
    ) -> None:
        self._config, self._keys, self._http, self._clock = config, keys, http, clock
        self._pending: dict[str, _Pending] = {}
        self._lock = threading.Lock()

    def start(self) -> LoginStart:
        """Adresse du fournisseur ; lève `ProviderError` si sa découverte échoue."""
        metadata = self._keys.metadata()
        state, nonce, verifier, binding = (new_token() for _ in range(4))
        now = self._clock()
        with self._lock:
            self._purge(now)
            self._pending[fingerprint(state)] = _Pending(nonce, verifier, binding, now)
        query = urlencode(
            {
                "response_type": "code",
                "client_id": self._config.client_id,
                "redirect_uri": self._config.redirect_uri,
                "scope": SCOPES,
                "state": state,
                "nonce": nonce,
                "code_challenge": _challenge(verifier),
                "code_challenge_method": "S256",
            }
        )
        separator = "&" if "?" in metadata.authorization_endpoint else "?"
        return LoginStart(f"{metadata.authorization_endpoint}{separator}{query}", binding)

    def finish(self, params: Mapping[str, str], binding: str | None) -> Identity | LoginRefusal:
        """Identité vérifiée au retour du fournisseur, ou la raison fermée de l'échec."""
        state = params.get("state")
        if not state:
            return LoginRefusal.INVALID_STATE
        now = self._clock()
        with self._lock:
            # Usage unique : la demande est retirée avant tout contrôle.
            pending = self._pending.pop(fingerprint(state), None)
        if (
            pending is None
            or now - pending.created_at >= LOGIN_LIFETIME
            or binding is None
            or not _same(binding, pending.binding)
        ):
            return LoginRefusal.INVALID_STATE
        if "error" in params:
            return LoginRefusal.CANCELLED
        code = params.get("code")
        if not code:
            return LoginRefusal.CODE_REJECTED
        try:
            metadata = self._keys.metadata()
            answer = self._http.post_form(
                metadata.token_endpoint,
                {
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": self._config.redirect_uri,
                    "client_id": self._config.client_id,
                    "client_secret": self._config.client_secret,
                    "code_verifier": pending.verifier,
                },
            )
        except ProviderError:
            return LoginRefusal.PROVIDER_UNAVAILABLE
        token = answer.get("id_token")
        if "error" in answer or not isinstance(token, str):
            return LoginRefusal.CODE_REJECTED
        # Les jetons d'accès et de rafraîchissement sont jetés ici (I5).
        found = verify_id_token(
            token, nonce=pending.nonce, config=self._config, keys=self._keys, clock=self._clock
        )
        if isinstance(found, Refusal):
            return LoginRefusal.TOKEN_REFUSED
        return found

    def pending_count(self) -> int:
        with self._lock:
            return len(self._pending)

    def _purge(self, now: datetime) -> None:
        expired = [k for k, p in self._pending.items() if now - p.created_at >= LOGIN_LIFETIME]
        for key in expired:
            del self._pending[key]
