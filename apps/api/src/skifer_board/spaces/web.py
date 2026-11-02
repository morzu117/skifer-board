"""Routes des espaces (plan 08, 8.2).

Toute décision d'accès est prise ici, à partir de la session : aucun rôle reçu du navigateur
n'est cru (E7). Un espace inconnu et un espace dont on n'est pas membre donnent la même
réponse, `404 space_not_found`. Les corps sont validés et les refus ont des codes fermés
(E12) ; le contrôle d'origine des écritures est celui de l'identité (plan 06, I8).
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from ..identity.model import Identity
from .access import LOCAL_SPACE, Access, Spaces
from .model import (
    SPACE_ID,
    Binding,
    BindingNotFound,
    GroupPrincipal,
    LocalMode,
    Person,
    PersonRef,
    Principal,
    Role,
    SpaceError,
    SpaceEvent,
)

NAME_MAX = 80
GROUP_MAX = 256
REF_MAX = 2048
QUERY_MAX = 200
BODY_MAX = 64 * 1024
BINDING_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")

# Statut HTTP de chaque refus du magasin.
_STATUS = {
    "space_exists": 409,
    "space_not_found": 404,
    "binding_not_found": 404,
    "unknown_person": 422,
    "last_admin": 409,
    "local_mode": 409,
}


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
    }


def _event_json(event: SpaceEvent) -> dict[str, Any]:
    return {
        "id": event.id,
        "at": event.at.isoformat(),
        "actor": _ref_json(event.actor),
        "action": event.action,
        "detail": event.detail,
    }


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


def _role(value: object, field: str) -> Role:
    if not isinstance(value, str) or value not in tuple(Role):
        raise Invalid(field)
    return Role(value)


def _space_name(value: object, field: str) -> str:
    name = _text(value, field, NAME_MAX)
    if name != name.strip():
        raise Invalid(field)
    return name


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


def install_spaces(app: FastAPI, spaces: Spaces) -> Callable[[Request, str], Access]:
    """Pose les routes des espaces. Rend la garde des routes d'un espace qui exigent le rôle
    lecteur, à utiliser comme dépendance (catalogue, E9)."""

    @app.exception_handler(Refused)
    async def refused(request: Request, error: Refused) -> JSONResponse:
        return error.response()

    @app.exception_handler(Invalid)
    async def invalid(request: Request, error: Invalid) -> JSONResponse:
        return JSONResponse({"error": {"code": "invalid_request", "field": error.field}}, 400)

    @app.exception_handler(SpaceError)
    async def space_error(request: Request, error: SpaceError) -> JSONResponse:
        return JSONResponse({"error": {"code": error.code}}, _STATUS[error.code])

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

    def binding_json(binding: Binding) -> dict[str, Any]:
        person = None
        if isinstance(binding.principal, PersonRef):
            known = spaces.person(binding.principal)
            person = None if known is None else {"name": known.name, "email": known.email}
        return {
            "id": binding.id,
            "principal": _principal_json(binding.principal),
            "person": person,
            "role": binding.role.value,
            "created_at": binding.created_at.isoformat(),
            "created_by": _ref_json(binding.created_by),
        }

    @app.get("/api/spaces/{space_id}/members")
    def list_members(request: Request, space_id: str) -> JSONResponse:
        found = manager(request, space_id)
        bindings = spaces.bindings(found.space.id)
        return JSONResponse({"members": [binding_json(binding) for binding in bindings]})

    @app.post("/api/spaces/{space_id}/members")
    async def set_member(request: Request, space_id: str) -> JSONResponse:
        found = manager(request, space_id)
        body = _object(await _body(request), "body", {"principal", "role"})
        principal = _principal(body["principal"], "principal")
        role = _role(body["role"], "role")
        binding = spaces.set_binding(viewer(request), found.space.id, principal, role)
        return JSONResponse(binding_json(binding))

    @app.delete("/api/spaces/{space_id}/members/{binding_id}")
    def remove_member(request: Request, space_id: str, binding_id: str) -> Response:
        found = manager(request, space_id)
        # Un identifiant hors format ne désigne aucune liaison, et n'atteint pas la base.
        if BINDING_ID.fullmatch(binding_id) is None:
            raise BindingNotFound(binding_id)
        spaces.remove_binding(viewer(request), found.space.id, binding_id)
        return Response(status_code=204)

    @app.get("/api/spaces/{space_id}/events")
    def list_events(request: Request, space_id: str) -> JSONResponse:
        found = manager(request, space_id)
        events = spaces.events(found.space.id)
        return JSONResponse({"events": [_event_json(event) for event in events]})

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

    return reader
