"""Espaces, liaisons, personnes et journal dans la base d'état (plan 08, 8.1), environnements
et accords du droit de déployer (plan 09, 9.1).

Chaque écriture est une transaction qui verrouille d'abord la ligne de l'espace : deux
écritures concurrentes sur un même espace se suivent, et la règle du dernier administrateur
(E8) ne peut pas être contournée par deux retraits simultanés. Le journal (E10) est écrit
dans la même transaction que le changement qu'il décrit.
"""

from __future__ import annotations

import json
import unicodedata
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    ColumnElement,
    Connection,
    Engine,
    Row,
    Table,
    and_,
    delete,
    func,
    insert,
    or_,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError

from ..identity.model import Identity
from ..state.schema import (
    deploy_grants,
    people,
    space_bindings,
    space_environments,
    space_events,
    spaces,
)
from .model import (
    ENVIRONMENTS,
    Binding,
    BindingNotFound,
    DeployGrant,
    Environment,
    GrantNotFound,
    GroupPrincipal,
    LastAdmin,
    Person,
    PersonRef,
    Principal,
    Role,
    Space,
    SpaceEvent,
    SpaceExists,
    SpaceNotFound,
    UnknownPerson,
    effective_role,
)

PEOPLE_LIMIT = 20
EVENTS_LIMIT = 200


def _utc(instant: datetime) -> datetime:
    return instant.astimezone(UTC)


def _principal_key(principal: Principal) -> str:
    if isinstance(principal, GroupPrincipal):
        return json.dumps(["group", principal.name])
    return json.dumps(["person", principal.issuer, principal.subject])


def _principal_columns(principal: Principal) -> dict[str, str | None]:
    if isinstance(principal, GroupPrincipal):
        return {"kind": "group", "group_name": principal.name}
    return {
        "kind": "person",
        "person_issuer": principal.issuer,
        "person_subject": principal.subject,
    }


def _principal_json(principal: Principal) -> dict[str, str]:
    if isinstance(principal, GroupPrincipal):
        return {"kind": "group", "name": principal.name}
    return {"kind": "person", "issuer": principal.issuer, "subject": principal.subject}


def _space(row: Row[Any]) -> Space:
    return Space(
        row.id,
        row.name,
        row.atlas,
        _utc(row.created_at),
        PersonRef(row.created_by_issuer, row.created_by_subject),
    )


def _principal(row: Row[Any]) -> Principal:
    if row.kind == "group":
        return GroupPrincipal(row.group_name)
    return PersonRef(row.person_issuer, row.person_subject)


def _binding(row: Row[Any]) -> Binding:
    return Binding(
        row.id,
        row.space_id,
        _principal(row),
        Role(row.role),
        _utc(row.created_at),
        PersonRef(row.created_by_issuer, row.created_by_subject),
    )


def _grant(row: Row[Any]) -> DeployGrant:
    return DeployGrant(
        row.id,
        row.space_id,
        Environment(row.environment),
        _principal(row),
        _utc(row.created_at),
        PersonRef(row.created_by_issuer, row.created_by_subject),
    )


def _matching(identity: Identity, table: Table = space_bindings) -> ColumnElement[bool]:
    """Liaisons, ou accords, qui correspondent à la session : ses groupes, ou elle-même."""
    person = and_(
        table.c.kind == "person",
        table.c.person_issuer == identity.issuer,
        table.c.person_subject == identity.subject,
    )
    if not identity.groups:
        return person
    group = and_(table.c.kind == "group", table.c.group_name.in_(identity.groups))
    return or_(person, group)


class SpaceStore:
    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    # --- Personnes connues (E5).

    def record_login(self, identity: Identity, now: datetime) -> None:
        """Enregistre ou met à jour la personne à sa connexion ; ses groupes ne sont pas gardés."""
        values = {
            "name": identity.name,
            "email": identity.email,
            "name_key": _search_key(identity.name),
            "email_key": _search_key(identity.email),
            "last_login": now,
        }
        statement = pg_insert(people).values(
            issuer=identity.issuer, subject=identity.subject, **values
        )
        with self._engine.begin() as connection:
            connection.execute(statement.on_conflict_do_update(constraint="pk_people", set_=values))

    def get_person(self, ref: PersonRef) -> Person | None:
        with self._engine.connect() as connection:
            row = connection.execute(
                select(people).where(people.c.issuer == ref.issuer, people.c.subject == ref.subject)
            ).one_or_none()
        return None if row is None else _person(row)

    def search_people(self, query: str, limit: int = PEOPLE_LIMIT) -> list[Person]:
        """Personnes dont le nom ou l'adresse contient la recherche, sans tenir compte de la
        casse, accents compris. Les caractères `%` et `_` sont pris littéralement."""
        key = _search_key(query) or ""
        escaped = key.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        with self._engine.connect() as connection:
            rows = connection.execute(
                select(people)
                .where(
                    or_(
                        people.c.name_key.like(pattern, escape="\\"),
                        people.c.email_key.like(pattern, escape="\\"),
                    )
                )
                .order_by(people.c.name, people.c.email, people.c.subject, people.c.issuer)
                .limit(limit)
            ).all()
        return [_person(row) for row in rows]

    # --- Espaces.

    def create_space(
        self,
        space_id: str,
        name: str,
        atlas: str,
        first_admin: Principal,
        actor: PersonRef,
        now: datetime,
    ) -> Space:
        """Crée l'espace avec sa première liaison administrateur, en une transaction."""
        try:
            with self._engine.begin() as connection:
                self._check_person(connection, first_admin)
                connection.execute(
                    insert(spaces).values(
                        id=space_id,
                        name=name,
                        atlas=atlas,
                        created_at=now,
                        created_by_issuer=actor.issuer,
                        created_by_subject=actor.subject,
                    )
                )
                connection.execute(
                    insert(space_environments),
                    [
                        {"space_id": space_id, "code": env.value, "position": env.rank}
                        for env in ENVIRONMENTS
                    ],
                )
                self._log(connection, space_id, actor, now, "space_created", {"name": name})
                self._insert_binding(connection, space_id, first_admin, Role.ADMIN, actor, now)
        except IntegrityError:
            # Seule la clé de l'espace peut entrer en conflit : il existe déjà, peut-être
            # créé au même instant par une autre requête.
            raise SpaceExists(space_id) from None
        return Space(space_id, name, atlas, now, actor)

    def get_space(self, space_id: str) -> Space | None:
        with self._engine.connect() as connection:
            row = connection.execute(select(spaces).where(spaces.c.id == space_id)).one_or_none()
        return None if row is None else _space(row)

    def list_spaces(self) -> list[Space]:
        with self._engine.connect() as connection:
            rows = connection.execute(select(spaces).order_by(spaces.c.id)).all()
        return [_space(row) for row in rows]

    def spaces_of(self, identity: Identity) -> list[tuple[Space, Role]]:
        """Espaces où la session a un rôle, avec ce rôle."""
        with self._engine.connect() as connection:
            rows = connection.execute(select(space_bindings).where(_matching(identity))).all()
            found: dict[str, list[Binding]] = {}
            for row in rows:
                found.setdefault(row.space_id, []).append(_binding(row))
            if not found:
                return []
            space_rows = connection.execute(
                select(spaces).where(spaces.c.id.in_(found)).order_by(spaces.c.id)
            ).all()
        result: list[tuple[Space, Role]] = []
        for row in space_rows:
            role = effective_role(identity, found[row.id])
            assert role is not None, "liaisons choisies parce qu'elles correspondent"
            result.append((_space(row), role))
        return result

    def role_in(self, space_id: str, identity: Identity) -> Role | None:
        """Rôle effectif de la session dans l'espace, recalculé à chaque appel (E4)."""
        with self._engine.connect() as connection:
            rows = connection.execute(
                select(space_bindings).where(
                    space_bindings.c.space_id == space_id, _matching(identity)
                )
            ).all()
        return effective_role(identity, [_binding(row) for row in rows])

    # --- Liaisons.

    def bindings(self, space_id: str) -> list[Binding]:
        with self._engine.connect() as connection:
            rows = connection.execute(
                select(space_bindings)
                .where(space_bindings.c.space_id == space_id)
                .order_by(space_bindings.c.created_at, space_bindings.c.id)
            ).all()
        return [_binding(row) for row in rows]

    def set_binding(
        self, space_id: str, principal: Principal, role: Role, actor: PersonRef, now: datetime
    ) -> Binding:
        """Pose la liaison, ou change son rôle. Une liaison inchangée n'est pas journalisée."""
        with self._engine.begin() as connection:
            self._lock(connection, space_id)
            self._check_person(connection, principal)
            row = connection.execute(
                select(space_bindings).where(
                    space_bindings.c.space_id == space_id,
                    space_bindings.c.principal_key == _principal_key(principal),
                )
            ).one_or_none()
            if row is None:
                return self._insert_binding(connection, space_id, principal, role, actor, now)
            current = _binding(row)
            if current.role == role:
                return current
            if current.role == Role.ADMIN:
                self._keep_an_admin(connection, space_id, current.id)
            connection.execute(
                update(space_bindings)
                .where(space_bindings.c.id == current.id)
                .values(role=role.value)
            )
            self._log(
                connection,
                space_id,
                actor,
                now,
                "binding_changed",
                {
                    "principal": _principal_json(principal),
                    "before": current.role.value,
                    "after": role.value,
                },
            )
        return Binding(
            current.id, space_id, principal, role, current.created_at, current.created_by
        )

    def remove_binding(
        self, space_id: str, binding_id: str, actor: PersonRef, now: datetime
    ) -> None:
        with self._engine.begin() as connection:
            self._lock(connection, space_id)
            row = connection.execute(
                select(space_bindings).where(
                    space_bindings.c.space_id == space_id, space_bindings.c.id == binding_id
                )
            ).one_or_none()
            if row is None:
                raise BindingNotFound(binding_id)
            current = _binding(row)
            if current.role == Role.ADMIN:
                self._keep_an_admin(connection, space_id, current.id)
            connection.execute(delete(space_bindings).where(space_bindings.c.id == binding_id))
            self._log(
                connection,
                space_id,
                actor,
                now,
                "binding_removed",
                {"principal": _principal_json(current.principal), "before": current.role.value},
            )

    # --- Environnements et accords du droit de déployer (plan 09).

    def environments(self, space_ids: list[str]) -> dict[str, tuple[Environment, ...]]:
        """Environnements de chaque espace, dans leur ordre de promotion (V1)."""
        if not space_ids:
            return {}
        found: dict[str, list[Environment]] = {space_id: [] for space_id in space_ids}
        with self._engine.connect() as connection:
            rows = connection.execute(
                select(space_environments)
                .where(space_environments.c.space_id.in_(space_ids))
                .order_by(space_environments.c.space_id, space_environments.c.position)
            ).all()
        for row in rows:
            found[row.space_id].append(Environment(row.code))
        return {space_id: tuple(envs) for space_id, envs in found.items()}

    def grants(self, space_id: str) -> list[DeployGrant]:
        with self._engine.connect() as connection:
            rows = connection.execute(
                select(deploy_grants)
                .where(deploy_grants.c.space_id == space_id)
                .order_by(deploy_grants.c.created_at, deploy_grants.c.id)
            ).all()
        return [_grant(row) for row in rows]

    def grants_of(self, identity: Identity, space_ids: list[str]) -> dict[str, list[DeployGrant]]:
        """Accords qui correspondent à la session, par espace ; recalculés à chaque appel."""
        found: dict[str, list[DeployGrant]] = {space_id: [] for space_id in space_ids}
        if not space_ids:
            return found
        with self._engine.connect() as connection:
            rows = connection.execute(
                select(deploy_grants).where(
                    deploy_grants.c.space_id.in_(space_ids), _matching(identity, deploy_grants)
                )
            ).all()
        for row in rows:
            found[row.space_id].append(_grant(row))
        return found

    def grant(
        self,
        space_id: str,
        environment: Environment,
        principal: Principal,
        actor: PersonRef,
        now: datetime,
    ) -> DeployGrant:
        """Accorde le droit de déployer. Un accord déjà posé n'est ni refait ni journalisé (V5)."""
        with self._engine.begin() as connection:
            self._lock(connection, space_id)
            self._check_person(connection, principal)
            row = connection.execute(
                select(deploy_grants).where(
                    deploy_grants.c.space_id == space_id,
                    deploy_grants.c.environment == environment.value,
                    deploy_grants.c.principal_key == _principal_key(principal),
                )
            ).one_or_none()
            if row is not None:
                return _grant(row)
            grant_id = str(uuid.uuid4())
            connection.execute(
                insert(deploy_grants).values(
                    id=grant_id,
                    space_id=space_id,
                    environment=environment.value,
                    principal_key=_principal_key(principal),
                    created_at=now,
                    created_by_issuer=actor.issuer,
                    created_by_subject=actor.subject,
                    **_principal_columns(principal),
                )
            )
            self._log(
                connection,
                space_id,
                actor,
                now,
                "deploy_granted",
                {"environment": environment.value, "principal": _principal_json(principal)},
            )
        return DeployGrant(grant_id, space_id, environment, principal, now, actor)

    def revoke(self, space_id: str, grant_id: str, actor: PersonRef, now: datetime) -> None:
        with self._engine.begin() as connection:
            self._lock(connection, space_id)
            row = connection.execute(
                select(deploy_grants).where(
                    deploy_grants.c.space_id == space_id, deploy_grants.c.id == grant_id
                )
            ).one_or_none()
            if row is None:
                raise GrantNotFound(grant_id)
            current = _grant(row)
            connection.execute(delete(deploy_grants).where(deploy_grants.c.id == grant_id))
            self._log(
                connection,
                space_id,
                actor,
                now,
                "deploy_revoked",
                {
                    "environment": current.environment.value,
                    "principal": _principal_json(current.principal),
                },
            )

    # --- Journal (E10).

    def events(self, space_id: str, limit: int = EVENTS_LIMIT) -> list[SpaceEvent]:
        """Événements de l'espace, du plus récent au plus ancien."""
        with self._engine.connect() as connection:
            rows = connection.execute(
                select(space_events)
                .where(space_events.c.space_id == space_id)
                .order_by(space_events.c.id.desc())
                .limit(limit)
            ).all()
        return [
            SpaceEvent(
                row.id,
                row.space_id,
                _utc(row.at),
                PersonRef(row.actor_issuer, row.actor_subject),
                row.action,
                row.detail,
            )
            for row in rows
        ]

    # --- Interne.

    def _lock(self, connection: Connection, space_id: str) -> None:
        """Verrouille l'espace jusqu'à la fin de la transaction ; refuse un espace inconnu."""
        found = connection.execute(
            select(spaces.c.id).where(spaces.c.id == space_id).with_for_update()
        ).first()
        if found is None:
            raise SpaceNotFound(space_id)

    def _check_person(self, connection: Connection, principal: Principal) -> None:
        """Une personne ne se lie qu'une fois connue de Board, donc après une connexion (E5)."""
        if isinstance(principal, GroupPrincipal):
            return
        known = connection.execute(
            select(people.c.subject).where(
                people.c.issuer == principal.issuer, people.c.subject == principal.subject
            )
        ).first()
        if known is None:
            raise UnknownPerson(principal.subject)

    def _keep_an_admin(self, connection: Connection, space_id: str, leaving: str) -> None:
        others = connection.execute(
            select(func.count())
            .select_from(space_bindings)
            .where(
                space_bindings.c.space_id == space_id,
                space_bindings.c.role == Role.ADMIN.value,
                space_bindings.c.id != leaving,
            )
        ).scalar_one()
        if others == 0:
            raise LastAdmin(space_id)

    def _insert_binding(
        self,
        connection: Connection,
        space_id: str,
        principal: Principal,
        role: Role,
        actor: PersonRef,
        now: datetime,
    ) -> Binding:
        binding_id = str(uuid.uuid4())
        connection.execute(
            insert(space_bindings).values(
                id=binding_id,
                space_id=space_id,
                principal_key=_principal_key(principal),
                role=role.value,
                created_at=now,
                created_by_issuer=actor.issuer,
                created_by_subject=actor.subject,
                **_principal_columns(principal),
            )
        )
        self._log(
            connection,
            space_id,
            actor,
            now,
            "binding_added",
            {"principal": _principal_json(principal), "after": role.value},
        )
        return Binding(binding_id, space_id, principal, role, now, actor)

    def _log(
        self,
        connection: Connection,
        space_id: str,
        actor: PersonRef,
        now: datetime,
        action: str,
        detail: dict[str, Any],
    ) -> None:
        connection.execute(
            insert(space_events).values(
                space_id=space_id,
                at=now,
                actor_issuer=actor.issuer,
                actor_subject=actor.subject,
                action=action,
                detail=detail,
            )
        )


def _search_key(text: str | None) -> str | None:
    """Forme repliée pour la recherche, indépendante de la locale de la base."""
    if text is None:
        return None
    return unicodedata.normalize("NFC", unicodedata.normalize("NFC", text).casefold())


def _person(row: Row[Any]) -> Person:
    return Person(row.issuer, row.subject, row.name, row.email, _utc(row.last_login))
