"""Sessions côté serveur (plan 06, I4).

Le navigateur tient un identifiant opaque de 256 bits ; le serveur n'en garde que
l'empreinte SHA-256. Le magasin est en mémoire dans cette tranche : un redémarrage
déconnecte tout le monde, ce qui est fail-closed.
"""

from __future__ import annotations

import hashlib
import secrets
import threading
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import Protocol

from .model import Identity

TOKEN_BYTES = 32


def fingerprint(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


@dataclass(frozen=True)
class Session:
    identity: Identity
    created_at: datetime
    last_seen: datetime
    # Échéance absolue ; l'inactivité peut la devancer.
    expires_at: datetime


class SessionStore(Protocol):
    def create(self, identity: Identity, now: datetime) -> str: ...

    def get(self, token: str, now: datetime) -> Session | None: ...

    def delete(self, token: str) -> None: ...


class MemorySessionStore:
    def __init__(self, absolute: timedelta, idle: timedelta) -> None:
        self._absolute, self._idle = absolute, idle
        self._sessions: dict[str, Session] = {}
        self._lock = threading.Lock()

    def create(self, identity: Identity, now: datetime) -> str:
        token = new_token()
        session = Session(identity, now, now, now + self._absolute)
        with self._lock:
            self._purge(now)
            self._sessions[fingerprint(token)] = session
        return token

    def get(self, token: str, now: datetime) -> Session | None:
        """Session valide du jeton, dont l'activité est prolongée ; `None` sinon."""
        key = fingerprint(token)
        with self._lock:
            session = self._sessions.get(key)
            if session is None:
                return None
            if self._expired(session, now):
                del self._sessions[key]
                return None
            session = replace(session, last_seen=now)
            self._sessions[key] = session
            return session

    def delete(self, token: str) -> None:
        with self._lock:
            self._sessions.pop(fingerprint(token), None)

    def __len__(self) -> int:
        with self._lock:
            return len(self._sessions)

    def fingerprints(self) -> frozenset[str]:
        """Clés gardées en mémoire : des empreintes, jamais un identifiant de session."""
        with self._lock:
            return frozenset(self._sessions)

    def _expired(self, session: Session, now: datetime) -> bool:
        return now >= session.expires_at or now >= session.last_seen + self._idle

    def _purge(self, now: datetime) -> None:
        for key in [k for k, s in self._sessions.items() if self._expired(s, now)]:
            del self._sessions[key]
