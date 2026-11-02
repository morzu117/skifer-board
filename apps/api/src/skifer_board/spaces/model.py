"""Espaces, liaisons et rôles (plan 08, E1 à E6).

Un rôle ne donne jamais de droit sur les données : elles restent évaluées pour la personne,
selon son identité et le RLS. Le rôle effectif est recalculé à partir de la session, jamais
reçu du navigateur.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any

from ..identity.model import Identity

SPACE_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,38}[a-z0-9]")


class Role(StrEnum):
    READER = "reader"
    CREATOR = "creator"
    ADMIN = "admin"

    @property
    def rank(self) -> int:
        return _RANKS[self]

    def allows(self, required: Role) -> bool:
        return self.rank >= required.rank


_RANKS = {Role.READER: 1, Role.CREATOR: 2, Role.ADMIN: 3}


@dataclass(frozen=True)
class PersonRef:
    """Personne désignée par son émetteur et son sujet, jamais par son adresse (E3)."""

    issuer: str
    subject: str

    @classmethod
    def of(cls, identity: Identity) -> PersonRef:
        return cls(identity.issuer, identity.subject)


@dataclass(frozen=True)
class GroupPrincipal:
    """Groupe du fournisseur, par sa valeur exacte dans le claim des groupes."""

    name: str


Principal = GroupPrincipal | PersonRef


@dataclass(frozen=True)
class Space:
    id: str
    name: str
    atlas: str
    created_at: datetime
    created_by: PersonRef


@dataclass(frozen=True)
class Binding:
    id: str
    space_id: str
    principal: Principal
    role: Role
    created_at: datetime
    created_by: PersonRef


@dataclass(frozen=True)
class Person:
    issuer: str
    subject: str
    name: str | None
    email: str | None
    last_login: datetime


@dataclass(frozen=True)
class SpaceEvent:
    id: int
    space_id: str
    at: datetime
    actor: PersonRef
    action: str
    detail: dict[str, Any]


class SpaceError(Exception):
    """Refus d'une opération sur les espaces, à code fermé."""

    code = "space_error"


class SpaceExists(SpaceError):
    code = "space_exists"


class SpaceNotFound(SpaceError):
    code = "space_not_found"


class BindingNotFound(SpaceError):
    code = "binding_not_found"


class UnknownPerson(SpaceError):
    code = "unknown_person"


class LastAdmin(SpaceError):
    """La dernière liaison administrateur d'un espace ne se retire ni ne s'abaisse (E8)."""

    code = "last_admin"


def matches(principal: Principal, identity: Identity) -> bool:
    if isinstance(principal, GroupPrincipal):
        return principal.name in identity.groups
    return principal == PersonRef.of(identity)


def effective_role(identity: Identity, bindings: Iterable[Binding]) -> Role | None:
    """Le plus élevé des rôles des liaisons qui correspondent à la session (E3)."""
    roles = [b.role for b in bindings if matches(b.principal, identity)]
    return max(roles, key=lambda role: role.rank, default=None)


def is_platform_admin(identity: Identity, admin_group: str | None) -> bool:
    """Membre du groupe d'administration de la plateforme (E6). Aucun rôle dans un espace."""
    return admin_group is not None and admin_group in identity.groups
