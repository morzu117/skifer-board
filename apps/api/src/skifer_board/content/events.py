"""Événements d'usage durables des analyses (plan 18, A8).

Trois sortes : `saved` (une révision publiée), `opened` (une analyse ouverte) et `executed` (une
exécution acceptée qui porte une référence d'analyse valide). Un événement est un identifiant,
une sorte, un espace, une analyse, une révision et un instant : jamais une personne, un nom, une
valeur de filtre, un contenu ni une donnée. Les lignes restent dans la base de Board, rien n'est
transmis. L'insertion est idempotente sur l'identifiant : la rejouer ne crée pas de doublon.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID, uuid5

from sqlalchemy import Engine, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..spaces.model import PersonRef
from ..state.schema import analysis_events

Kind = Literal["saved", "opened", "executed"]
KINDS: tuple[Kind, ...] = ("saved", "opened", "executed")
WINDOW = timedelta(days=30)
# Espace de noms des identifiants dérivés : le même fait donne toujours le même identifiant.
NAMESPACE = UUID("5b0a2f6e-1c49-4d6e-9a53-2f7a18c4e0b1")
KEY_VARIABLE = "SKIFER_BOARD_USAGE_KEY"
# Séparation de domaine : cette clé ne sert qu'à pseudonymiser la clé d'idempotence d'une ouverture.
OPENED_DOMAIN = "board.analysis-event.opened.v1"


class UsageConfigError(ValueError):
    """Configuration invalide ; son message ne reprend aucune valeur."""


@dataclass(frozen=True)
class UsageKey:
    """Clé serveur des identifiants d'ouverture : 32 octets, jamais affichés."""

    value: bytes = field(repr=False)


def key_from_env(environ: Mapping[str, str]) -> UsageKey | None:
    """Clé lue de `SKIFER_BOARD_USAGE_KEY` (32 octets en base64), comme les clés du coffre.
    Absente : `None`. Présente et invalide : `UsageConfigError`, sans reprendre la valeur."""
    raw = environ.get(KEY_VARIABLE)
    if raw is None:
        return None
    try:
        decoded = base64.b64decode(raw, validate=True)
    except (ValueError, binascii.Error):
        raise UsageConfigError(f"{KEY_VARIABLE} est invalide.") from None
    if len(decoded) != 32:
        raise UsageConfigError(f"{KEY_VARIABLE} est invalide.")
    return UsageKey(decoded)


def saved_id(commit: str, action: str) -> str:
    """Identifiant d'une sauvegarde : dérivé du commit publié et de l'action, sans hasard."""
    return str(uuid5(NAMESPACE, f"saved:{commit}:{action}"))


def opened_id(
    key: UsageKey, space_id: str, analysis_id: str, actor: PersonRef, client_id: str
) -> str:
    """Identifiant d'une ouverture : HMAC-SHA256 de l'espace, de l'analyse, de la personne et de
    l'identifiant tiré par le client, sous la clé du serveur.

    C'est la pseudonymisation d'une clé d'idempotence, pas une donnée de plus : la même personne
    qui rejoue la même ouverture retombe sur la même ligne, deux personnes qui envoient le même
    identifiant produisent deux lignes, et sans la clé l'identifiant ne permet pas de retrouver
    la personne. Aucune colonne ne porte la personne."""
    message = json.dumps(
        [OPENED_DOMAIN, space_id, analysis_id, actor.issuer, actor.subject, client_id],
        separators=(",", ":"),
    ).encode()
    digest = hmac.new(key.value, message, hashlib.sha256).digest()
    return str(UUID(bytes=digest[:16]))


@dataclass(frozen=True)
class Usage:
    """Ce qu'une sorte d'événement a produit : tout l'historique, 30 jours, dernier instant."""

    total: int
    last_30_days: int
    last_at: datetime | None


class UsageEvents:
    def __init__(
        self,
        engine: Engine,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        key: UsageKey | None = None,
    ) -> None:
        self._engine = engine
        self._clock = clock
        self._key = key

    @property
    def keyed(self) -> bool:
        """Les ouvertures ne se consignent qu'avec la clé du serveur."""
        return self._key is not None

    def opened_id(self, space_id: str, analysis_id: str, actor: PersonRef, client_id: str) -> str:
        assert self._key is not None
        return opened_id(self._key, space_id, analysis_id, actor, client_id)

    def record(
        self, event_id: str, kind: Kind, space_id: str, analysis_id: str, revision: int
    ) -> None:
        """Enregistre l'événement une fois : un identifiant déjà connu ne crée rien."""
        statement = (
            pg_insert(analysis_events)
            .values(
                event_id=event_id,
                kind=kind,
                space_id=space_id,
                analysis_id=analysis_id,
                revision=revision,
                occurred_at=self._clock(),
            )
            .on_conflict_do_nothing(index_elements=["event_id"])
        )
        with self._engine.begin() as connection:
            connection.execute(statement)

    def usage(self, space_id: str, analysis_id: str) -> dict[Kind, Usage]:
        """Comptes par sorte (les trois sorties sont toujours présentes), sans aucune personne."""
        now = self._clock()
        # Fenêtre fermée aux deux bouts : un instant futur (horloges en écart) n'est pas « récent ».
        # Il reste dans `total` et dans `last_at`, qui disent tout ce qui est consigné.
        recent = func.count().filter(
            analysis_events.c.occurred_at >= now - WINDOW, analysis_events.c.occurred_at <= now
        )
        statement = (
            select(
                analysis_events.c.kind,
                func.count(),
                recent,
                func.max(analysis_events.c.occurred_at),
            )
            .where(
                analysis_events.c.space_id == space_id,
                analysis_events.c.analysis_id == analysis_id,
            )
            .group_by(analysis_events.c.kind)
        )
        with self._engine.connect() as connection:
            found = {
                row[0]: Usage(row[1], row[2], None if row[3] is None else row[3].astimezone(UTC))
                for row in connection.execute(statement)
            }
        return {kind: found.get(kind, Usage(0, 0, None)) for kind in KINDS}
