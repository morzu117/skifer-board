"""Sessions et demandes de connexion dans la base d'état (plan 07, P6, P7 et P8).

Mêmes règles qu'en mémoire (plan 06, I4) : le serveur ne garde que des empreintes, jamais
un identifiant de session ni un jeton du fournisseur. Chaque lecture qui modifie est une
seule instruction conditionnée, pour que plusieurs processus ne se contredisent pas. Les
instants viennent de l'horloge du serveur, jamais de celle de la base.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import ColumnElement, Engine, and_, delete, func, insert, or_, select, update

from ..identity.flow import LOGIN_LIFETIME, PendingLogin
from ..identity.model import Identity
from ..identity.sessions import Session, fingerprint, new_token
from .schema import login_requests, sessions


def _utc(instant: datetime) -> datetime:
    """Instant relu en UTC : la base le rend dans le fuseau de sa session, quel qu'il soit."""
    return instant.astimezone(UTC)


class PgSessionStore:
    def __init__(self, engine: Engine, absolute: timedelta, idle: timedelta) -> None:
        self._engine, self._absolute, self._idle = engine, absolute, idle

    def _expired(self, now: datetime) -> ColumnElement[bool]:
        return or_(sessions.c.expires_at <= now, sessions.c.last_seen <= now - self._idle)

    def create(self, identity: Identity, now: datetime) -> str:
        token = new_token()
        with self._engine.begin() as connection:
            connection.execute(delete(sessions).where(self._expired(now)))
            connection.execute(
                insert(sessions).values(
                    fingerprint=fingerprint(token),
                    issuer=identity.issuer,
                    subject=identity.subject,
                    name=identity.name,
                    email=identity.email,
                    groups=list(identity.groups),
                    created_at=now,
                    last_seen=now,
                    expires_at=now + self._absolute,
                )
            )
        return token

    def get(self, token: str, now: datetime) -> Session | None:
        """Session valide du jeton, dont l'activité est prolongée ; `None` sinon.

        La prolongation n'a lieu que si la session est encore valide, dans la même
        instruction : une session expirée n'est jamais ressuscitée par un autre processus.
        """
        key = fingerprint(token)
        with self._engine.begin() as connection:
            row = connection.execute(
                update(sessions)
                .where(
                    sessions.c.fingerprint == key,
                    sessions.c.expires_at > now,
                    sessions.c.last_seen > now - self._idle,
                )
                .values(last_seen=now)
                .returning(*sessions.c)
            ).one_or_none()
            if row is None:
                connection.execute(
                    delete(sessions).where(and_(sessions.c.fingerprint == key, self._expired(now)))
                )
                return None
        identity = Identity(row.issuer, row.subject, row.name, row.email, tuple(row.groups))
        return Session(identity, _utc(row.created_at), _utc(row.last_seen), _utc(row.expires_at))

    def delete(self, token: str) -> None:
        with self._engine.begin() as connection:
            connection.execute(delete(sessions).where(sessions.c.fingerprint == fingerprint(token)))


class PgLoginRequests:
    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def put(self, state: str, pending: PendingLogin) -> None:
        with self._engine.begin() as connection:
            limit = pending.created_at - LOGIN_LIFETIME
            connection.execute(delete(login_requests).where(login_requests.c.created_at <= limit))
            connection.execute(
                insert(login_requests).values(
                    state_fingerprint=fingerprint(state),
                    nonce=pending.nonce,
                    verifier=pending.verifier,
                    binding_fingerprint=pending.binding_fingerprint,
                    created_at=pending.created_at,
                )
            )

    def take(self, state: str) -> PendingLogin | None:
        # Suppression qui rend la ligne : entre deux processus, un seul la reçoit.
        with self._engine.begin() as connection:
            row = connection.execute(
                delete(login_requests)
                .where(login_requests.c.state_fingerprint == fingerprint(state))
                .returning(*login_requests.c)
            ).one_or_none()
        if row is None:
            return None
        return PendingLogin(row.nonce, row.verifier, row.binding_fingerprint, _utc(row.created_at))

    def count(self) -> int:
        with self._engine.connect() as connection:
            return connection.execute(select(func.count()).select_from(login_requests)).scalar_one()
