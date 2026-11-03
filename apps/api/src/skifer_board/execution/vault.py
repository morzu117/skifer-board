"""Coffre serveur des identifiants de service (plan 12, 12.2)."""

from __future__ import annotations

import base64
import binascii
import json
import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import Connection, Engine, delete, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..spaces.model import Environment, PersonRef
from ..state.schema import (
    connection_bindings,
    connection_credentials,
    logical_connections,
    space_events,
)
from .model import Binding, Connector, IdentityMode
from .store import BindingNotFound, ConnectionNotFound

KEYS_VARIABLE = "SKIFER_BOARD_VAULT_KEYS"
ACTIVE_VARIABLE = "SKIFER_BOARD_VAULT_ACTIVE_KEY"
KEY_ID = re.compile(r"[A-Za-z0-9_-]{1,32}")


class VaultConfigError(ValueError):
    """Configuration invalide ; son message ne reprend aucune valeur."""


class VaultError(Exception):
    code = "vault_unavailable"


class CredentialNotFound(VaultError):
    code = "credential_not_found"


class CredentialNotAllowed(VaultError):
    code = "credential_not_allowed"


@dataclass(frozen=True)
class VaultKeys:
    active: str
    keys: Mapping[str, bytes] = field(repr=False)


def keys_from_env(environ: Mapping[str, str]) -> VaultKeys | None:
    raw = environ.get(KEYS_VARIABLE)
    active = environ.get(ACTIVE_VARIABLE)
    if raw is None and active is None:
        return None
    if raw is None or active is None:
        raise VaultConfigError(
            f"{KEYS_VARIABLE} et {ACTIVE_VARIABLE} doivent être définies ensemble."
        )

    def unique_pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, value in pairs:
            if key in result:
                raise VaultConfigError(f"{KEYS_VARIABLE} contient un identifiant de clé en double.")
            result[key] = value
        return result

    try:
        values = json.loads(raw, object_pairs_hook=unique_pairs)
        if not isinstance(values, dict) or not values or KEY_ID.fullmatch(active) is None:
            raise ValueError
        keys: dict[str, bytes] = {}
        for key_id, encoded in values.items():
            if KEY_ID.fullmatch(key_id) is None or not isinstance(encoded, str):
                raise ValueError
            decoded = base64.b64decode(encoded, validate=True)
            if len(decoded) != 32:
                raise ValueError
            keys[key_id] = decoded
        if active not in keys:
            raise ValueError
    except (ValueError, TypeError, binascii.Error):
        raise VaultConfigError(f"{KEYS_VARIABLE} ou {ACTIVE_VARIABLE} est invalide.") from None
    return VaultKeys(active, keys)


def _aad(binding: Binding) -> bytes:
    # JSON canonique, sans ambiguïté entre les composantes.
    return json.dumps(
        [
            binding.space_id,
            binding.name,
            binding.environment.value,
            binding.connector.value,
            binding.endpoint_key,
            binding.identity_mode.value,
        ],
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")


def _binding(row: object) -> Binding:
    data = row._mapping  # type: ignore[attr-defined]
    return Binding(
        data["space_id"],
        data["name"],
        Environment(data["environment"]),
        Connector(data["connector"]),
        data["endpoint_key"],
        IdentityMode(data["identity_mode"]),
        data["set_at_1"] if "set_at_1" in data else data["set_at"],
        PersonRef(
            data["set_by_issuer_1"] if "set_by_issuer_1" in data else data["set_by_issuer"],
            data["set_by_subject_1"] if "set_by_subject_1" in data else data["set_by_subject"],
        ),
    )


class CredentialVault:
    def __init__(self, engine: Engine, keys: VaultKeys | None) -> None:
        self._engine = engine
        self._keys = keys

    def _key(self, key_id: str) -> bytes:
        if self._keys is None or key_id not in self._keys.keys:
            raise VaultError() from None
        return self._keys.keys[key_id]

    def _decrypt(self, row: object, binding: Binding) -> str:
        data = row._mapping  # type: ignore[attr-defined]
        try:
            plaintext = AESGCM(self._key(data["key_id"])).decrypt(
                data["nonce"], data["ciphertext"], _aad(binding)
            )
            return plaintext.decode("utf-8")
        except (InvalidTag, ValueError, TypeError, UnicodeError):
            raise VaultError() from None

    @staticmethod
    def _locked_binding(
        connection: Connection, space_id: str, name: str, environment: Environment
    ) -> Binding:
        parent = connection.execute(
            select(logical_connections.c.name)
            .where(logical_connections.c.space_id == space_id, logical_connections.c.name == name)
            .with_for_update()
        ).one_or_none()
        if parent is None:
            raise ConnectionNotFound(name)
        row = connection.execute(
            select(connection_bindings).where(
                connection_bindings.c.space_id == space_id,
                connection_bindings.c.name == name,
                connection_bindings.c.environment == environment.value,
            )
        ).one_or_none()
        if row is None:
            raise BindingNotFound(environment.value)
        return _binding(row)

    def put(
        self,
        space_id: str,
        name: str,
        environment: Environment,
        secret: str,
        actor: PersonRef,
        at: datetime,
    ) -> None:
        if self._keys is None:
            raise VaultError()
        with self._engine.begin() as connection:
            binding = self._locked_binding(connection, space_id, name, environment)
            if binding.identity_mode is not IdentityMode.SERVICE:
                raise CredentialNotAllowed()
            nonce = os.urandom(12)
            ciphertext = AESGCM(self._key(self._keys.active)).encrypt(
                nonce, secret.encode("utf-8"), _aad(binding)
            )
            values = dict(
                key_id=self._keys.active,
                nonce=nonce,
                ciphertext=ciphertext,
                set_at=at,
                set_by_issuer=actor.issuer,
                set_by_subject=actor.subject,
            )
            statement = pg_insert(connection_credentials).values(
                space_id=space_id, name=name, environment=environment.value, **values
            )
            connection.execute(
                statement.on_conflict_do_update(constraint="pk_connection_credentials", set_=values)
            )
            connection.execute(
                insert(space_events).values(
                    space_id=space_id,
                    actor_issuer=actor.issuer,
                    actor_subject=actor.subject,
                    at=at,
                    action="credential_set",
                    detail={"name": name, "environment": environment.value},
                )
            )

    def delete(
        self,
        space_id: str,
        name: str,
        environment: Environment,
        actor: PersonRef,
        at: datetime,
    ) -> None:
        with self._engine.begin() as connection:
            self._locked_binding(connection, space_id, name, environment)
            removed = connection.execute(
                delete(connection_credentials).where(
                    connection_credentials.c.space_id == space_id,
                    connection_credentials.c.name == name,
                    connection_credentials.c.environment == environment.value,
                )
            )
            if removed.rowcount != 1:
                raise CredentialNotFound()
            connection.execute(
                insert(space_events).values(
                    space_id=space_id,
                    actor_issuer=actor.issuer,
                    actor_subject=actor.subject,
                    at=at,
                    action="credential_removed",
                    detail={"name": name, "environment": environment.value},
                )
            )

    def status(self, binding: Binding) -> str:
        with self._engine.connect() as connection:
            row = connection.execute(
                select(connection_credentials).where(
                    connection_credentials.c.space_id == binding.space_id,
                    connection_credentials.c.name == binding.name,
                    connection_credentials.c.environment == binding.environment.value,
                )
            ).one_or_none()
        if row is None:
            return "unconfigured"
        try:
            self._decrypt(row, binding)
        except VaultError:
            return "unavailable"
        return "configured"

    def reveal_for_execution(self, binding: Binding) -> str:
        """Usage interne uniquement, jamais exposé par une route HTTP."""
        with self._engine.connect() as connection:
            row = connection.execute(
                select(connection_credentials).where(
                    connection_credentials.c.space_id == binding.space_id,
                    connection_credentials.c.name == binding.name,
                    connection_credentials.c.environment == binding.environment.value,
                )
            ).one_or_none()
        if row is None:
            raise CredentialNotFound()
        return self._decrypt(row, binding)

    def rotate(self) -> dict[str, int]:
        if self._keys is None:
            raise VaultError()
        with self._engine.begin() as connection:
            # Verrouille les parents dans le même ordre que put/bind/unbind ; la rotation est
            # sérialisée avec chaque écriture de liaison ou d'identifiant.
            parents = connection.execute(
                select(logical_connections.c.space_id, logical_connections.c.name)
                .order_by(logical_connections.c.space_id, logical_connections.c.name)
                .with_for_update()
            ).all()
            rotated = 0
            for space_id, name in parents:
                rows = connection.execute(
                    select(connection_credentials, connection_bindings)
                    .join(
                        connection_bindings,
                        (
                            (connection_credentials.c.space_id == connection_bindings.c.space_id)
                            & (connection_credentials.c.name == connection_bindings.c.name)
                            & (
                                connection_credentials.c.environment
                                == connection_bindings.c.environment
                            )
                        ),
                    )
                    .where(
                        connection_credentials.c.space_id == space_id,
                        connection_credentials.c.name == name,
                    )
                    .order_by(connection_credentials.c.environment)
                ).all()
                for row in rows:
                    data = row._mapping
                    binding = _binding(row)
                    secret = self._decrypt(row, binding)
                    if data["key_id"] == self._keys.active:
                        continue
                    nonce = os.urandom(12)
                    ciphertext = AESGCM(self._key(self._keys.active)).encrypt(
                        nonce, secret.encode("utf-8"), _aad(binding)
                    )
                    connection.execute(
                        update(connection_credentials)
                        .where(
                            connection_credentials.c.space_id == space_id,
                            connection_credentials.c.name == name,
                            connection_credentials.c.environment == binding.environment.value,
                        )
                        .values(key_id=self._keys.active, nonce=nonce, ciphertext=ciphertext)
                    )
                    rotated += 1
            remaining = connection.execute(select(connection_credentials.c.key_id)).scalars().all()
        counts: dict[str, int] = {}
        for key_id in remaining:
            counts[key_id] = counts.get(key_id, 0) + 1
        return {
            "rotated": rotated,
            "remaining_non_active": sum(
                count for key_id, count in counts.items() if key_id != self._keys.active
            ),
        }
