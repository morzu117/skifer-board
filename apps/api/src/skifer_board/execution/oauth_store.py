"""Coffre personnel OAuth et demandes PKCE partagés entre processus (plan 15.1)."""

from __future__ import annotations

import hmac
import json
import os
from collections.abc import Callable, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import Engine, delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..identity.sessions import fingerprint, new_token
from ..spaces.model import PersonRef
from ..state.schema import databricks_oauth as table
from .oauth import OAuthError, Tokens
from .vault import VaultError, VaultKeys


def credential_id(space: str, person: PersonRef, host: str, client_id: str) -> str:
    return fingerprint(json.dumps([space, person.issuer, person.subject, host, client_id]))


def _aad(row: Mapping[Any, Any]) -> bytes:
    return json.dumps(
        [row[k] for k in ("id", "purpose", "client_id", "space_id", "issuer", "subject", "host")]
        + [row["expires_at"].astimezone(UTC).isoformat()],
        separators=(",", ":"),
    ).encode()


class OAuthStore:
    def __init__(self, engine: Engine, keys: VaultKeys | None, client_id: str) -> None:
        self.engine, self.keys, self.client_id = engine, keys, client_id

    def _key(self, name: str) -> bytes:
        if self.keys is None or name not in self.keys.keys:
            raise VaultError()
        return self.keys.keys[name]

    def _encrypted(self, row: Mapping[Any, Any], payload: dict[str, str]) -> dict[str, Any]:
        if self.keys is None:
            raise VaultError()
        nonce = os.urandom(12)
        return {
            **row,
            "key_id": self.keys.active,
            "nonce": nonce,
            "ciphertext": AESGCM(self._key(self.keys.active)).encrypt(
                nonce, json.dumps(payload).encode(), _aad(row)
            ),
        }

    def _decrypt(self, row: Mapping[Any, Any]) -> dict[str, str]:
        try:
            data = json.loads(
                AESGCM(self._key(row["key_id"])).decrypt(row["nonce"], row["ciphertext"], _aad(row))
            )
        except (InvalidTag, ValueError, TypeError, UnicodeError):
            raise VaultError() from None
        if not isinstance(data, dict) or not all(
            isinstance(k, str) and isinstance(v, str) for k, v in data.items()
        ):
            raise VaultError()
        expected = (
            {"verifier", "binding"}
            if row["purpose"] == "pending"
            else {"access", "refresh", "expires_at"}
        )
        if set(data) != expected:
            raise VaultError()
        if row["purpose"] == "credential":
            try:
                if datetime.fromisoformat(data["expires_at"]).tzinfo is None:
                    raise ValueError
            except ValueError:
                raise VaultError() from None
        return data

    def _put(
        self,
        purpose: str,
        key: str,
        space: str,
        person: PersonRef,
        host: str,
        payload: dict[str, str],
        expires: datetime,
        now: datetime,
    ) -> None:
        row = self._encrypted(
            {
                "id": key,
                "purpose": purpose,
                "client_id": self.client_id,
                "space_id": space,
                "issuer": person.issuer,
                "subject": person.subject,
                "host": host,
                "expires_at": expires,
            },
            payload,
        )
        with self.engine.begin() as connection:
            connection.execute(delete(table).where(table.c.expires_at <= now))
            statement = pg_insert(table).values(**row)
            connection.execute(
                statement.on_conflict_do_update(index_elements=[table.c.id], set_=row)
            )

    def start(
        self, space: str, person: PersonRef, host: str, binding: str, now: datetime
    ) -> tuple[str, str]:
        state, verifier = new_token(), new_token()
        self._put(
            "pending",
            fingerprint(state),
            space,
            person,
            host,
            {"verifier": verifier, "binding": fingerprint(binding)},
            now + timedelta(minutes=10),
            now,
        )
        return state, verifier

    def finish(
        self, state: str, person: PersonRef, binding: str, now: datetime
    ) -> tuple[str, str, str]:
        with self.engine.begin() as connection:
            row = (
                connection.execute(
                    delete(table)
                    .where(
                        table.c.id == fingerprint(state),
                        table.c.purpose == "pending",
                        table.c.client_id == self.client_id,
                        table.c.issuer == person.issuer,
                        table.c.subject == person.subject,
                    )
                    .returning(table)
                )
                .mappings()
                .one_or_none()
            )
            if row is None:
                raise OAuthError("oauth_invalid_state")
            data = self._decrypt(row)
        if row["expires_at"] <= now or not hmac.compare_digest(
            data["binding"], fingerprint(binding)
        ):
            raise OAuthError("oauth_invalid_state")
        return row["space_id"], row["host"], data["verifier"]

    def save(self, space: str, person: PersonRef, host: str, tokens: Tokens, now: datetime) -> None:
        self._put(
            "credential",
            credential_id(space, person, host, self.client_id),
            space,
            person,
            host,
            tokens.payload(),
            now + timedelta(days=7),
            now,
        )

    def list(self, space: str, person: PersonRef, now: datetime) -> list[dict[str, str]]:
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    select(table)
                    .where(
                        table.c.purpose == "credential",
                        table.c.client_id == self.client_id,
                        table.c.space_id == space,
                        table.c.issuer == person.issuer,
                        table.c.subject == person.subject,
                        table.c.expires_at > now,
                    )
                    .order_by(table.c.host)
                )
                .mappings()
                .all()
            )
        return [
            {"host": row["host"], "expires_at": self._decrypt(row)["expires_at"]} for row in rows
        ]

    def access(
        self,
        space: str,
        person: PersonRef,
        host: str,
        now: datetime,
        renew: Callable[[str], Tokens],
    ) -> Tokens:
        # Une seule rotation à la fois, même avec plusieurs processus Board.
        with self.engine.begin() as connection:
            row = (
                connection.execute(
                    select(table)
                    .where(
                        table.c.id == credential_id(space, person, host, self.client_id),
                        table.c.expires_at > now,
                    )
                    .with_for_update()
                )
                .mappings()
                .one_or_none()
            )
            if row is None:
                raise OAuthError("oauth_reconnect")
            data = self._decrypt(row)
            tokens = Tokens(
                data["access"],
                data["refresh"],
                datetime.fromisoformat(data["expires_at"]).astimezone(UTC),
            )
            if tokens.expires_at <= now + timedelta(seconds=30):
                tokens = renew(tokens.refresh)
                encrypted = self._encrypted(row, tokens.payload())
                connection.execute(
                    table.update()
                    .where(table.c.id == row["id"])
                    .values(
                        key_id=encrypted["key_id"],
                        nonce=encrypted["nonce"],
                        ciphertext=encrypted["ciphertext"],
                    )
                )
            return tokens

    def disconnect(self, space: str, person: PersonRef, host: str) -> None:
        with self.engine.begin() as connection:
            connection.execute(
                delete(table).where(
                    table.c.id == credential_id(space, person, host, self.client_id)
                )
            )

    def rotate(self) -> dict[str, int]:
        if self.keys is None:
            raise VaultError()
        rotated = 0
        with self.engine.begin() as connection:
            rows = (
                connection.execute(select(table).order_by(table.c.id).with_for_update())
                .mappings()
                .all()
            )
            for row in rows:
                payload = self._decrypt(row)
                if row["key_id"] == self.keys.active:
                    continue
                encrypted = self._encrypted(row, payload)
                connection.execute(
                    table.update()
                    .where(table.c.id == row["id"])
                    .values(
                        key_id=encrypted["key_id"],
                        nonce=encrypted["nonce"],
                        ciphertext=encrypted["ciphertext"],
                    )
                )
                rotated += 1
            remaining = connection.execute(
                select(table.c.id).where(table.c.key_id != self.keys.active)
            ).all()
        return {"rotated": rotated, "remaining_non_active": len(remaining)}
