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
from typing import Protocol
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
class PendingLogin:
    """Demande de connexion en cours. Le lien navigateur n'est gardé que par son empreinte."""

    nonce: str
    verifier: str
    binding_fingerprint: str
    created_at: datetime


class LoginRequests(Protocol):
    """Demandes en cours, rangées par l'empreinte de leur `state` (plan 07, P7)."""

    def put(self, state: str, pending: PendingLogin) -> None:
        """Range la demande et purge celles qui ont plus de `LOGIN_LIFETIME`."""
        ...

    def take(self, state: str) -> PendingLogin | None:
        """Retire et rend la demande : un même `state` n'est jamais rendu deux fois."""
        ...

    def count(self) -> int: ...


class MemoryLoginRequests:
    """Demandes en mémoire, pour un seul processus et pour les tests."""

    def __init__(self) -> None:
        self._pending: dict[str, PendingLogin] = {}
        self._lock = threading.Lock()

    def put(self, state: str, pending: PendingLogin) -> None:
        with self._lock:
            limit = pending.created_at - LOGIN_LIFETIME
            for key in [k for k, p in self._pending.items() if p.created_at <= limit]:
                del self._pending[key]
            self._pending[fingerprint(state)] = pending

    def take(self, state: str) -> PendingLogin | None:
        with self._lock:
            return self._pending.pop(fingerprint(state), None)

    def count(self) -> int:
        with self._lock:
            return len(self._pending)


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
        requests: LoginRequests | None = None,
    ) -> None:
        self._config, self._keys, self._http, self._clock = config, keys, http, clock
        self._requests: LoginRequests = MemoryLoginRequests() if requests is None else requests

    def start(self) -> LoginStart:
        """Adresse du fournisseur ; lève `ProviderError` si sa découverte échoue."""
        metadata = self._keys.metadata()
        state, nonce, verifier, binding = (new_token() for _ in range(4))
        self._requests.put(
            state, PendingLogin(nonce, verifier, fingerprint(binding), self._clock())
        )
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
        # Usage unique : la demande est retirée avant tout contrôle.
        pending = self._requests.take(state)
        if (
            pending is None
            or now - pending.created_at >= LOGIN_LIFETIME
            or binding is None
            or not _same(fingerprint(binding), pending.binding_fingerprint)
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
        return self._requests.count()
