"""Résolution unique de l'autorisation OAuth personnelle, sans repli de service (plan 16)."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime

from ..spaces.model import PersonRef
from .oauth import FormTransport, OAuthConfig, OAuthError, Tokens, exchange
from .oauth_store import OAuthStore

PersonalAccess = Callable[[str, PersonRef, str], Tokens]


class PersonalOAuth:
    def __init__(
        self,
        config: OAuthConfig | None,
        store: OAuthStore | None,
        forms: FormTransport,
        clock: Callable[[], datetime],
    ) -> None:
        self.config, self.store, self.forms, self.clock = config, store, forms, clock

    @property
    def configured(self) -> bool:
        return self.config is not None and self.store is not None and self.store.keys is not None

    def ready(self) -> tuple[OAuthConfig, OAuthStore]:
        if self.config is None or self.store is None or self.store.keys is None:
            raise OAuthError("oauth_not_configured")
        return self.config, self.store

    def token(self, space: str, person: PersonRef, host: str) -> Tokens:
        config, store = self.ready()
        return store.access(
            space,
            person,
            host,
            self.clock(),
            lambda refresh: exchange(
                config,
                host,
                {"grant_type": "refresh_token", "refresh_token": refresh},
                self.clock(),
                self.forms,
                refresh,
            ),
        )
