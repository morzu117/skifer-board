"""Espaces, liaisons et rôles (plan 08, E1 à E6), environnements et droit de déployer
(plan 09, V1 à V4).

Un rôle ne donne jamais de droit sur les données : elles restent évaluées pour la personne,
selon son identité et le RLS. Le rôle effectif et le droit de déployer sont recalculés à
partir de la session, jamais reçus du navigateur.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any

from ..identity.model import Identity

# Défini avec l'identité, pour que `/api/me` le dise (E6) ; réexporté ici.
from ..identity.model import is_platform_admin as is_platform_admin

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


class Environment(StrEnum):
    """Les trois environnements de tout espace, dans leur ordre de promotion (V1)."""

    DEV = "DEV"
    TEST = "TEST"
    PROD = "PROD"

    @property
    def rank(self) -> int:
        return ENVIRONMENTS.index(self) + 1


ENVIRONMENTS = (Environment.DEV, Environment.TEST, Environment.PROD)


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
class DeployGrant:
    """Accord du droit de déployer dans un environnement d'un espace (V3)."""

    id: str
    space_id: str
    environment: Environment
    principal: Principal
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


class GrantNotFound(SpaceError):
    code = "grant_not_found"


class UnknownPerson(SpaceError):
    code = "unknown_person"


class LastAdmin(SpaceError):
    """La dernière liaison administrateur d'un espace ne se retire ni ne s'abaisse (E8)."""

    code = "last_admin"


class LocalMode(SpaceError):
    """En mode local, l'espace implicite n'a pas de membres à gérer (E11)."""

    code = "local_mode"


def matches(principal: Principal, identity: Identity) -> bool:
    if isinstance(principal, GroupPrincipal):
        return principal.name in identity.groups
    return principal == PersonRef.of(identity)


def effective_role(identity: Identity, bindings: Iterable[Binding]) -> Role | None:
    """Le plus élevé des rôles des liaisons qui correspondent à la session (E3)."""
    roles = [b.role for b in bindings if matches(b.principal, identity)]
    return max(roles, key=lambda role: role.rank, default=None)


def deployable(
    identity: Identity, role: Role | None, grants: Iterable[DeployGrant]
) -> frozenset[Environment]:
    """Environnements où la session peut déployer : un accord y correspond à elle, et son rôle
    est créateur ou plus (V3). Aucun droit d'office, administrateur compris (V4)."""
    if role is None or not role.allows(Role.CREATOR):
        return frozenset()
    return frozenset(g.environment for g in grants if matches(g.principal, identity))


def can_deploy(
    identity: Identity, role: Role | None, grants: Iterable[DeployGrant], environment: Environment
) -> bool:
    return environment in deployable(identity, role, grants)
