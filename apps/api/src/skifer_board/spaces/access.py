"""Accès aux espaces depuis une requête (plan 08, E6, E7 et E11 ; plan 09, V7 et V8).

Avec OIDC, les espaces sont en base ; le rôle et le droit de déployer sont recalculés à chaque
appel à partir de la session. En mode local, sans personne ni base obligatoire, un seul espace
implicite, `local`, existe : la personne locale y est administrateur et peut déployer dans ses
trois environnements, et ni ses membres ni ses accords ne se gèrent.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from ..identity.model import Identity
from .model import (
    ENVIRONMENTS,
    Binding,
    DeployGrant,
    Environment,
    LocalMode,
    Person,
    PersonRef,
    Principal,
    Role,
    Space,
    SpaceEvent,
    deployable,
    is_platform_admin,
)
from .store import SpaceStore

LOCAL_SPACE = "local"
LOCAL_PERSON = PersonRef("local", "local")


@dataclass(frozen=True)
class Access:
    """Ce que la session peut voir d'un espace. `role` vaut `None` pour un administrateur de
    la plateforme qui n'y a aucun rôle : il gère les membres, il ne lit pas le catalogue."""

    space: Space
    role: Role | None
    platform_admin: bool
    implicit: bool = False
    #: Environnements de l'espace, dans l'ordre de promotion (plan 09, V1).
    environments: tuple[Environment, ...] = ENVIRONMENTS
    #: Environnements où la session peut déployer (V3, V4).
    deploy: frozenset[Environment] = frozenset()

    @property
    def manages(self) -> bool:
        return self.platform_admin or (self.role is not None and self.role.allows(Role.ADMIN))


@dataclass(frozen=True)
class Spaces:
    """Espaces vus par le serveur. `store` vaut `None` en mode local (E11)."""

    store: SpaceStore | None
    atlas: str
    admin_group: str | None
    clock: Callable[[], datetime]
    started: datetime

    @classmethod
    def local(cls, atlas: str, clock: Callable[[], datetime]) -> Spaces:
        return cls(None, atlas, None, clock, clock())

    @classmethod
    def database(
        cls, store: SpaceStore, atlas: str, admin_group: str | None, clock: Callable[[], datetime]
    ) -> Spaces:
        return cls(store, atlas, admin_group, clock, clock())

    def platform_admin(self, viewer: Identity | None) -> bool:
        return viewer is not None and is_platform_admin(viewer, self.admin_group)

    def visible(self, viewer: Identity | None) -> list[Access]:
        """Espaces où la session a un rôle ; tous pour un administrateur de la plateforme."""
        if self.store is None:
            return [self._local()]
        if viewer is None:
            return []
        member = self.store.spaces_of(viewer)
        admin = self.platform_admin(viewer)
        roles = {space.id: role for space, role in member}
        shown = self.store.list_spaces() if admin else [space for space, _ in member]
        return self._with_environments(viewer, [(s, roles.get(s.id)) for s in shown], admin)

    def access(self, viewer: Identity | None, space_id: str) -> Access | None:
        """L'espace et le rôle de la session, ou `None` : espace inconnu ou non-membre, sans
        distinction (E7)."""
        if self.store is None:
            return self._local() if space_id == LOCAL_SPACE else None
        if viewer is None:
            return None
        space = self.store.get_space(space_id)
        if space is None:
            return None
        role = self.store.role_in(space_id, viewer)
        admin = self.platform_admin(viewer)
        if role is None and not admin:
            return None
        [found] = self._with_environments(viewer, [(space, role)], admin)
        return found

    def _with_environments(
        self, viewer: Identity, shown: list[tuple[Space, Role | None]], admin: bool
    ) -> list[Access]:
        """Accès complétés des environnements et du droit de déployer : deux lectures pour
        tous les espaces, pas une par espace."""
        assert self.store is not None, "espaces en base"
        ids = [space.id for space, _ in shown]
        environments = self.store.environments(ids)
        grants = self.store.grants_of(viewer, ids)
        return [
            Access(
                space,
                role,
                admin,
                environments=environments[space.id],
                deploy=deployable(viewer, role, grants[space.id]),
            )
            for space, role in shown
        ]

    def administers_any(self, viewer: Identity | None) -> bool:
        """Administrateur d'au moins un espace, ou de la plateforme : peut chercher des
        personnes à lier."""
        if viewer is None or self.store is None:
            return False
        if self.platform_admin(viewer):
            return True
        return any(role is Role.ADMIN for _, role in self.store.spaces_of(viewer))

    # --- Écritures, et lectures réservées aux administrateurs : refusées en mode local.

    def create(
        self, viewer: Identity | None, space_id: str, name: str, first_admin: Principal
    ) -> Space:
        store, actor = self._writer(viewer)
        return store.create_space(space_id, name, self.atlas, first_admin, actor, self.clock())

    def bindings(self, space_id: str) -> list[Binding]:
        return self._reader().bindings(space_id)

    def person(self, ref: PersonRef) -> Person | None:
        return self._reader().get_person(ref)

    def set_binding(
        self, viewer: Identity | None, space_id: str, principal: Principal, role: Role
    ) -> Binding:
        store, actor = self._writer(viewer)
        return store.set_binding(space_id, principal, role, actor, self.clock())

    def remove_binding(self, viewer: Identity | None, space_id: str, binding_id: str) -> None:
        store, actor = self._writer(viewer)
        store.remove_binding(space_id, binding_id, actor, self.clock())

    def grants(self, space_id: str) -> list[DeployGrant]:
        return self._reader().grants(space_id)

    def grant(
        self,
        viewer: Identity | None,
        space_id: str,
        environment: Environment,
        principal: Principal,
    ) -> DeployGrant:
        store, actor = self._writer(viewer)
        return store.grant(space_id, environment, principal, actor, self.clock())

    def revoke(self, viewer: Identity | None, space_id: str, grant_id: str) -> None:
        store, actor = self._writer(viewer)
        store.revoke(space_id, grant_id, actor, self.clock())

    def events(self, space_id: str) -> list[SpaceEvent]:
        return self._reader().events(space_id)

    def search_people(self, query: str) -> list[Person]:
        return self._reader().search_people(query)

    def _reader(self) -> SpaceStore:
        if self.store is None:
            raise LocalMode(LOCAL_SPACE)
        return self.store

    def _writer(self, viewer: Identity | None) -> tuple[SpaceStore, PersonRef]:
        # Sans session, pas d'auteur à journaliser : seul le mode local en est là.
        if self.store is None or viewer is None:
            raise LocalMode(LOCAL_SPACE)
        return self.store, PersonRef.of(viewer)

    def _local(self) -> Access:
        space = Space(LOCAL_SPACE, "Local", self.atlas, self.started, LOCAL_PERSON)
        return Access(space, Role.ADMIN, False, implicit=True, deploy=frozenset(ENVIRONMENTS))
