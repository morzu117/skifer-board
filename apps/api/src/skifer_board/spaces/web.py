"""Routes des espaces (plan 08, 8.2), de leurs environnements et du droit de déployer
(plan 09, 9.2), de leurs paramètres de déploiement (plan 10, 10.2).

Toute décision d'accès est prise ici, à partir de la session : aucun rôle reçu du navigateur
n'est cru (E7). Un espace inconnu et un espace dont on n'est pas membre donnent la même
réponse, `404 space_not_found`. Les corps sont validés et les refus ont des codes fermés
(E12) ; le contrôle d'origine des écritures est celui de l'identité (plan 06, I8).
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from ..identity.model import Identity
from .access import LOCAL_SPACE, Access, Spaces
from .model import (
    SPACE_ID,
    Binding,
    BindingNotFound,
    DeployGrant,
    Environment,
    GrantNotFound,
    GroupPrincipal,
    LocalMode,
    Person,
    PersonRef,
    Principal,
    Role,
    SpaceError,
    SpaceEvent,
)
from .parameters import (
    Configuration,
    Declaration,
    InvalidParameter,
    Parameter,
    ParameterNotFound,
    ParameterValue,
    ValuesIncompatible,
    check_name,
)

NAME_MAX = 80
GROUP_MAX = 256
REF_MAX = 2048
QUERY_MAX = 200
BODY_MAX = 64 * 1024
# Identifiant de liaison ou d'accord, tiré par le magasin.
BINDING_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")

# Statut HTTP de chaque refus du magasin.
_STATUS = {
    "space_exists": 409,
    "space_not_found": 404,
    "binding_not_found": 404,
    "grant_not_found": 404,
    "unknown_person": 422,
    "last_admin": 409,
    "local_mode": 409,
    "parameter_not_found": 404,
    "parameter_exists": 409,
    "parameter_limit": 409,
    "values_incompatible": 409,
}
# Champs d'une déclaration, tous exigés : aucun n'est complété en silence (plan 10, P3).
DECLARATION_KEYS = {"type", "constraints", "required", "default", "description"}


class Refused(Exception):
    """Refus d'une route d'espace, rendu tel quel par le serveur."""

    def __init__(self, status: int, code: str, **fields: str) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.fields = fields

    def response(self) -> JSONResponse:
        return JSONResponse({"error": {"code": self.code, **self.fields}}, self.status)


class Invalid(Exception):
    """Corps refusé ; `field` nomme le champ en cause, jamais sa valeur."""

    def __init__(self, field: str) -> None:
        super().__init__(field)
        self.field = field


def _not_found() -> Refused:
    return Refused(404, "space_not_found")


def _forbidden(required: str) -> Refused:
    return Refused(403, "forbidden", required=required)


def viewer(request: Request) -> Identity | None:
    """Identité de la session, posée par la garde ; `None` en mode local."""
    session = getattr(request.state, "session", None)
    return None if session is None else session.identity


def _ref_json(ref: PersonRef) -> dict[str, str]:
    return {"issuer": ref.issuer, "subject": ref.subject}


def _principal_json(principal: Principal) -> dict[str, str]:
    if isinstance(principal, GroupPrincipal):
        return {"kind": "group", "name": principal.name}
    return {"kind": "person", **_ref_json(principal)}


def _person_json(person: Person) -> dict[str, Any]:
    return {
        **_ref_json(PersonRef(person.issuer, person.subject)),
        "name": person.name,
        "email": person.email,
        "last_login": person.last_login.isoformat(),
    }


def _access_json(access: Access) -> dict[str, Any]:
    space = access.space
    return {
        "id": space.id,
        "name": space.name,
        "atlas": space.atlas,
        "created_at": space.created_at.isoformat(),
        "created_by": _ref_json(space.created_by),
        "role": None if access.role is None else access.role.value,
        "implicit": access.implicit,
        # Ordre de promotion, et droit de déployer de la session dans chacun (V7).
        "environments": [
            {"code": environment.value, "deploy": environment in access.deploy}
            for environment in access.environments
        ],
    }


def _event_json(
    event: SpaceEvent,
    actor: dict[str, str | None] | None,
    principal: dict[str, str | None] | None,
) -> dict[str, Any]:
    return {
        "id": event.id,
        "at": event.at.isoformat(),
        "actor": _ref_json(event.actor),
        "actor_person": actor,
        "action": event.action,
        "detail": event.detail,
        "principal_person": principal,
    }


def _detail_person(event: SpaceEvent) -> PersonRef | None:
    """Personne visée par un événement de liaison ou d'accord, telle que le journal l'a
    gardée. Un détail inattendu n'en désigne aucune : il est rendu tel quel, sans faire tomber
    le journal."""
    detail: object = event.detail
    if not isinstance(detail, dict):
        return None
    principal = detail.get("principal")
    if not isinstance(principal, dict) or principal.get("kind") != "person":
        return None
    issuer, subject = principal.get("issuer"), principal.get("subject")
    if not isinstance(issuer, str) or not isinstance(subject, str):
        return None
    return PersonRef(issuer, subject)


# --- Validation des corps.


def _storable(value: str) -> bool:
    """Texte que la base peut garder : ni U+0000, ni demi-code UTF-16 isolé."""
    return "\x00" not in value and not any("\ud800" <= char <= "\udfff" for char in value)


def _object(value: object, field: str, keys: set[str]) -> dict[str, Any]:
    # Une clé inconnue n'est pas renvoyée : `field` reste dans un ensemble fermé.
    if not isinstance(value, dict) or not set(value) <= keys:
        raise Invalid(field)
    for key in sorted(keys):
        if key not in value:
            raise Invalid(f"{field}.{key}" if field != "body" else key)
    return value


def _text(value: object, field: str, maximum: int) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum or not _storable(value):
        raise Invalid(field)
    return value


def _principal(value: object, field: str) -> Principal:
    kind = value.get("kind") if isinstance(value, dict) else None
    if kind == "group":
        found = _object(value, field, {"kind", "name"})
        # Valeur exacte du claim des groupes (E3) : ni repliée ni rognée.
        return GroupPrincipal(_text(found["name"], f"{field}.name", GROUP_MAX))
    if kind == "person":
        found = _object(value, field, {"kind", "issuer", "subject"})
        return PersonRef(
            _text(found["issuer"], f"{field}.issuer", REF_MAX),
            _text(found["subject"], f"{field}.subject", REF_MAX),
        )
    raise Invalid(f"{field}.kind")


def _environment(value: object, field: str) -> Environment:
    if not isinstance(value, str) or value not in tuple(Environment):
        raise Invalid(field)
    return Environment(value)


def _role(value: object, field: str) -> Role:
    if not isinstance(value, str) or value not in tuple(Role):
        raise Invalid(field)
    return Role(value)


def _space_name(value: object, field: str) -> str:
    name = _text(value, field, NAME_MAX)
    if name != name.strip():
        raise Invalid(field)
    return name


def _declaration(body: dict[str, Any]) -> Declaration:
    return Declaration.parse(
        body["type"], body["constraints"], body["required"], body["default"], body["description"]
    )


def _parameter_name(value: str) -> str:
    """Nom d'un paramètre dans le chemin ; hors format, il ne désigne aucun paramètre."""
    try:
        return check_name(value)
    except InvalidParameter:
        raise ParameterNotFound(value) from None


def _space_id(value: object, field: str) -> str:
    if not isinstance(value, str) or SPACE_ID.fullmatch(value) is None:
        raise Invalid(field)
    return value


def _unique_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    found = dict(pairs)
    if len(found) != len(pairs):
        # Clé en double : laquelle croire serait un choix silencieux.
        raise Invalid("body")
    return found


async def _body(request: Request) -> object:
    raw = await request.body()
    if len(raw) > BODY_MAX:
        raise Invalid("body")
    try:
        return json.loads(raw, object_pairs_hook=_unique_keys)
    except (ValueError, RecursionError):
        raise Invalid("body") from None


@dataclass(frozen=True)
class Guards:
    """Gardes des routes d'un espace, à utiliser comme dépendances. `reader` exige le rôle
    lecteur (catalogue, plan 08, E9) ; `deployer` exige le droit de déployer dans
    l'environnement `environment` de la route (plan 09, V7)."""

    reader: Callable[[Request, str], Access]
    deployer: Callable[[Request, str, str], Access]


def install_spaces(app: FastAPI, spaces: Spaces) -> Guards:
    """Pose les routes des espaces et rend leurs gardes."""

    @app.exception_handler(Refused)
    async def refused(request: Request, error: Refused) -> JSONResponse:
        return error.response()

    @app.exception_handler(Invalid)
    async def invalid(request: Request, error: Invalid) -> JSONResponse:
        return JSONResponse({"error": {"code": "invalid_request", "field": error.field}}, 400)

    @app.exception_handler(InvalidParameter)
    async def invalid_parameter(request: Request, error: InvalidParameter) -> JSONResponse:
        return JSONResponse({"error": {"code": "invalid_request", "field": error.field}}, 400)

    @app.exception_handler(SpaceError)
    async def space_error(request: Request, error: SpaceError) -> JSONResponse:
        fields: dict[str, Any] = {}
        if isinstance(error, ValuesIncompatible):
            # Les environnements dont il faut d'abord vider la valeur (P5).
            fields["environments"] = [environment.value for environment in error.environments]
        return JSONResponse({"error": {"code": error.code, **fields}}, _STATUS[error.code])

    def access(request: Request, space_id: str) -> Access:
        # Un identifiant hors format ne peut désigner aucun espace : même réponse.
        found = None
        if SPACE_ID.fullmatch(space_id) is not None:
            found = spaces.access(viewer(request), space_id)
        if found is None:
            raise _not_found()
        return found

    def reader(request: Request, space_id: str) -> Access:
        found = access(request, space_id)
        # Un administrateur de la plateforme sans rôle ne lit pas le catalogue (E6).
        if found.role is None:
            raise _forbidden(Role.READER.value)
        return found

    def deployer(request: Request, space_id: str, environment: str) -> Access:
        found = access(request, space_id)
        target = _environment(environment, "environment")
        # Recalculé à chaque requête : un accord retiré ne vaut plus à la suivante.
        if target not in found.deploy:
            raise Refused(403, "forbidden", required="deploy", environment=target.value)
        return found

    def manager(request: Request, space_id: str) -> Access:
        found = access(request, space_id)
        if found.implicit:
            raise LocalMode(found.space.id)
        if not found.manages:
            raise _forbidden(Role.ADMIN.value)
        return found

    @app.get("/api/spaces")
    def list_spaces(request: Request) -> JSONResponse:
        identity = viewer(request)
        return JSONResponse(
            {
                "spaces": [_access_json(found) for found in spaces.visible(identity)],
                "platform_admin": spaces.platform_admin(identity),
            }
        )

    @app.post("/api/spaces")
    async def create_space(request: Request) -> JSONResponse:
        identity = viewer(request)
        if spaces.store is None:
            raise LocalMode(LOCAL_SPACE)
        if not spaces.platform_admin(identity):
            raise _forbidden("platform_admin")
        body = _object(await _body(request), "body", {"id", "name", "first_admin"})
        space_id = _space_id(body["id"], "id")
        name = _space_name(body["name"], "name")
        first_admin = _principal(body["first_admin"], "first_admin")
        spaces.create(identity, space_id, name, first_admin)
        return JSONResponse(_access_json(access(request, space_id)), 201)

    @app.get("/api/spaces/{space_id}")
    def get_space(request: Request, space_id: str) -> JSONResponse:
        return JSONResponse(_access_json(access(request, space_id)))

    def people_of(refs: list[PersonRef]) -> dict[PersonRef, dict[str, str | None] | None]:
        """Nom et adresse des personnes connues, une lecture par personne distincte ; `None`
        pour une personne que Board ne connaît pas."""
        found: dict[PersonRef, dict[str, str | None] | None] = {}
        for ref in refs:
            if ref not in found:
                known = spaces.person(ref)
                found[ref] = None if known is None else {"name": known.name, "email": known.email}
        return found

    def bindings_json(bindings: list[Binding]) -> list[dict[str, Any]]:
        persons = [b.principal for b in bindings if isinstance(b.principal, PersonRef)]
        people = people_of(persons + [b.created_by for b in bindings])
        return [
            {
                "id": binding.id,
                "principal": _principal_json(binding.principal),
                "person": (
                    people[binding.principal] if isinstance(binding.principal, PersonRef) else None
                ),
                "role": binding.role.value,
                "created_at": binding.created_at.isoformat(),
                "created_by": _ref_json(binding.created_by),
                "created_by_person": people[binding.created_by],
            }
            for binding in bindings
        ]

    @app.get("/api/spaces/{space_id}/members")
    def list_members(request: Request, space_id: str) -> JSONResponse:
        found = manager(request, space_id)
        bindings = spaces.bindings(found.space.id)
        return JSONResponse({"members": bindings_json(bindings)})

    @app.post("/api/spaces/{space_id}/members")
    async def set_member(request: Request, space_id: str) -> JSONResponse:
        found = manager(request, space_id)
        body = _object(await _body(request), "body", {"principal", "role"})
        principal = _principal(body["principal"], "principal")
        role = _role(body["role"], "role")
        binding = spaces.set_binding(viewer(request), found.space.id, principal, role)
        return JSONResponse(bindings_json([binding])[0])

    @app.delete("/api/spaces/{space_id}/members/{binding_id}")
    def remove_member(request: Request, space_id: str, binding_id: str) -> Response:
        found = manager(request, space_id)
        # Un identifiant hors format ne désigne aucune liaison, et n'atteint pas la base.
        if BINDING_ID.fullmatch(binding_id) is None:
            raise BindingNotFound(binding_id)
        spaces.remove_binding(viewer(request), found.space.id, binding_id)
        return Response(status_code=204)

    def grants_json(grants: list[DeployGrant]) -> list[dict[str, Any]]:
        persons = [g.principal for g in grants if isinstance(g.principal, PersonRef)]
        people = people_of(persons + [g.created_by for g in grants])
        return [
            {
                "id": grant.id,
                "environment": grant.environment.value,
                "principal": _principal_json(grant.principal),
                "person": (
                    people[grant.principal] if isinstance(grant.principal, PersonRef) else None
                ),
                "created_at": grant.created_at.isoformat(),
                "created_by": _ref_json(grant.created_by),
                "created_by_person": people[grant.created_by],
            }
            for grant in grants
        ]

    @app.get("/api/spaces/{space_id}/deploy-grants")
    def list_grants(request: Request, space_id: str) -> JSONResponse:
        found = manager(request, space_id)
        return JSONResponse({"grants": grants_json(spaces.grants(found.space.id))})

    @app.post("/api/spaces/{space_id}/deploy-grants")
    async def grant(request: Request, space_id: str) -> JSONResponse:
        found = manager(request, space_id)
        body = _object(await _body(request), "body", {"environment", "principal"})
        environment = _environment(body["environment"], "environment")
        principal = _principal(body["principal"], "principal")
        granted = spaces.grant(viewer(request), found.space.id, environment, principal)
        return JSONResponse(grants_json([granted])[0])

    @app.delete("/api/spaces/{space_id}/deploy-grants/{grant_id}")
    def revoke(request: Request, space_id: str, grant_id: str) -> Response:
        found = manager(request, space_id)
        if BINDING_ID.fullmatch(grant_id) is None:
            raise GrantNotFound(grant_id)
        spaces.revoke(viewer(request), found.space.id, grant_id)
        return Response(status_code=204)

    def value_setter(
        request: Request, space_id: str, environment: str
    ) -> tuple[Access, Environment]:
        """Poser ou vider une valeur : rôle administrateur dans l'espace et droit de déployer
        dans l'environnement (plan 10, P6). L'administration de la plateforme n'y suffit pas."""
        found = manager(request, space_id)
        target = _environment(environment, "environment")
        if found.role is None or not found.role.allows(Role.ADMIN):
            raise _forbidden(Role.ADMIN.value)
        if target not in found.sets_values:
            raise Refused(403, "forbidden", required="deploy", environment=target.value)
        return found, target

    def parameter_json(
        parameter: Parameter, people: dict[PersonRef, dict[str, str | None] | None]
    ) -> dict[str, Any]:
        return {
            "name": parameter.name,
            **parameter.declaration.to_json(),
            "created_at": parameter.created_at.isoformat(),
            "created_by": _ref_json(parameter.created_by),
            "created_by_person": people[parameter.created_by],
            "updated_at": parameter.updated_at.isoformat(),
            "updated_by": _ref_json(parameter.updated_by),
            "updated_by_person": people[parameter.updated_by],
        }

    def value_json(
        found: ParameterValue, people: dict[PersonRef, dict[str, str | None] | None]
    ) -> dict[str, Any]:
        return {
            "name": found.name,
            "environment": found.environment.value,
            "value": found.value,
            "set_at": found.set_at.isoformat(),
            "set_by": _ref_json(found.set_by),
            "set_by_person": people[found.set_by],
        }

    def configuration_json(found: Access, configuration: Configuration) -> dict[str, Any]:
        parameters = configuration.parameters
        people = people_of(
            [p.created_by for p in parameters]
            + [p.updated_by for p in parameters]
            + [v.set_by for v in configuration.values]
        )
        environments = []
        for environment in found.environments:
            resolved = []
            for parameter, state in configuration.resolved(environment):
                own = configuration.own(parameter.name, environment)
                # Valeur résolue et son état, calculés ici : le navigateur ne les recalcule pas
                # (P4). Une valeur propre dit qui l'a posée, et quand.
                resolved.append(
                    {
                        "name": parameter.name,
                        "state": state.state.value,
                        "value": state.value,
                        "set_at": None if own is None else own.set_at.isoformat(),
                        "set_by": None if own is None else _ref_json(own.set_by),
                        "set_by_person": None if own is None else people[own.set_by],
                    }
                )
            environments.append(
                {
                    "code": environment.value,
                    "can_set": environment in found.sets_values,
                    "complete": configuration.complete(environment),
                    "missing": list(configuration.missing(environment)),
                    "values": resolved,
                }
            )
        return {
            "parameters": [parameter_json(p, people) for p in parameters],
            "environments": environments,
        }

    @app.get("/api/spaces/{space_id}/parameters")
    def list_parameters(request: Request, space_id: str) -> JSONResponse:
        found = manager(request, space_id)
        configuration = spaces.configuration(found.space.id)
        return JSONResponse(configuration_json(found, configuration))

    @app.post("/api/spaces/{space_id}/parameters")
    async def declare(request: Request, space_id: str) -> JSONResponse:
        found = manager(request, space_id)
        body = _object(await _body(request), "body", {"name", *DECLARATION_KEYS})
        name = check_name(body["name"])
        declaration = _declaration(body)
        parameter = spaces.declare(viewer(request), found.space.id, name, declaration)
        return JSONResponse(parameter_json(parameter, people_of([parameter.created_by])), 201)

    @app.put("/api/spaces/{space_id}/parameters/{name}")
    async def redeclare(request: Request, space_id: str, name: str) -> JSONResponse:
        found = manager(request, space_id)
        parameter_name = _parameter_name(name)
        declaration = _declaration(_object(await _body(request), "body", DECLARATION_KEYS))
        parameter = spaces.redeclare(viewer(request), found.space.id, parameter_name, declaration)
        people = people_of([parameter.created_by, parameter.updated_by])
        return JSONResponse(parameter_json(parameter, people))

    @app.delete("/api/spaces/{space_id}/parameters/{name}")
    def remove_parameter(request: Request, space_id: str, name: str) -> Response:
        found = manager(request, space_id)
        spaces.remove_parameter(viewer(request), found.space.id, _parameter_name(name))
        return Response(status_code=204)

    @app.put("/api/spaces/{space_id}/parameters/{name}/values/{environment}")
    async def set_value(
        request: Request, space_id: str, name: str, environment: str
    ) -> JSONResponse:
        found, target = value_setter(request, space_id, environment)
        parameter_name = _parameter_name(name)
        body = _object(await _body(request), "body", {"value"})
        stored = spaces.set_value(
            viewer(request), found.space.id, parameter_name, target, body["value"]
        )
        return JSONResponse(value_json(stored, people_of([stored.set_by])))

    @app.delete("/api/spaces/{space_id}/parameters/{name}/values/{environment}")
    def clear_value(request: Request, space_id: str, name: str, environment: str) -> Response:
        found, target = value_setter(request, space_id, environment)
        spaces.clear_value(viewer(request), found.space.id, _parameter_name(name), target)
        return Response(status_code=204)

    @app.get("/api/spaces/{space_id}/events")
    def list_events(request: Request, space_id: str) -> JSONResponse:
        found = manager(request, space_id)
        events = spaces.events(found.space.id)
        targets = [_detail_person(event) for event in events]
        # Une personne retirée n'est plus dans les liaisons : son nom vient d'ici.
        people = people_of([e.actor for e in events] + [t for t in targets if t is not None])
        return JSONResponse(
            {
                "events": [
                    _event_json(event, people[event.actor], None if t is None else people[t])
                    for event, t in zip(events, targets, strict=True)
                ]
            }
        )

    @app.get("/api/people")
    def search_people(request: Request, q: str | None = None) -> JSONResponse:
        identity = viewer(request)
        if spaces.store is None:
            raise LocalMode(LOCAL_SPACE)
        if not spaces.administers_any(identity):
            raise _forbidden(Role.ADMIN.value)
        query = "" if q is None else q.strip()
        if not query or len(query) > QUERY_MAX or not _storable(query):
            return JSONResponse(
                {"error": {"code": "invalid_parameter", "parameter": "q"}}, status_code=400
            )
        found = spaces.search_people(query)
        return JSONResponse({"people": [_person_json(person) for person in found]})

    return Guards(reader, deployer)
