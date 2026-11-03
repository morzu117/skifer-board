"""Routes du registre de connexions, réservées à l'administration (plan 12, 12.1)."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from ..spaces.access import Access
from ..spaces.model import Environment, LocalMode, PersonRef
from ..spaces.web import Invalid, _body, _object, viewer
from .model import ENDPOINT_KEY, NAME, Binding, Connector, IdentityMode, LogicalConnection
from .store import ConnectionError, ConnectionStore
from .vault import CredentialVault, VaultError


def _name(value: object, field: str) -> str:
    if not isinstance(value, str) or NAME.fullmatch(value) is None:
        raise Invalid(field)
    return value


def _environment(value: str) -> Environment:
    try:
        return Environment(value)
    except ValueError:
        raise Invalid("environment") from None


def _binding_json(binding: Binding, vault: CredentialVault | None = None) -> dict[str, Any]:
    return {
        "environment": binding.environment.value,
        "connector": binding.connector.value,
        "endpoint_key": binding.endpoint_key,
        "identity_mode": binding.identity_mode.value,
        "set_at": binding.set_at.isoformat(),
        "set_by": {"issuer": binding.set_by.issuer, "subject": binding.set_by.subject},
        "credential_state": "unconfigured" if vault is None else vault.status(binding),
    }


def _logical_json(
    logical: LogicalConnection, bindings: list[Binding], vault: CredentialVault | None = None
) -> dict[str, Any]:
    by_environment = {binding.environment: binding for binding in bindings}
    return {
        "name": logical.name,
        "created_at": logical.created_at.isoformat(),
        "created_by": {"issuer": logical.created_by.issuer, "subject": logical.created_by.subject},
        "bindings": [
            _binding_json(by_environment[environment], vault)
            if environment in by_environment
            else {"environment": environment.value, "state": "unconfigured"}
            for environment in Environment
        ],
    }


def install_connections(
    app: FastAPI,
    store: ConnectionStore | None,
    manager: Callable[[Request, str], Access],
    clock: Callable[[], datetime],
    vault: CredentialVault | None = None,
) -> None:
    @app.exception_handler(ConnectionError)
    async def connection_error(request: Request, error: ConnectionError) -> JSONResponse:
        status = {
            "connection_exists": 409,
            "connection_not_found": 404,
            "connection_binding_not_found": 404,
            "connection_in_use": 409,
        }[error.code]
        return JSONResponse({"error": {"code": error.code}}, status_code=status)

    @app.exception_handler(VaultError)
    async def vault_error(request: Request, error: VaultError) -> JSONResponse:
        status = {
            "vault_unavailable": 503,
            "credential_not_found": 404,
            "credential_not_allowed": 409,
        }[error.code]
        return JSONResponse({"error": {"code": error.code}}, status_code=status)

    def writable(request: Request, space_id: str) -> tuple[ConnectionStore, Access, PersonRef]:
        if store is None:
            raise LocalMode(space_id)
        access = manager(request, space_id)
        identity = viewer(request)
        assert identity is not None, "mode hébergé authentifié"
        return store, access, PersonRef.of(identity)

    path = "/api/spaces/{space_id}/connections"

    @app.get(path)
    def list_connections(request: Request, space_id: str) -> JSONResponse:
        registry, access, _ = writable(request, space_id)
        return JSONResponse(
            {
                "connections": [
                    _logical_json(logical, bindings, vault)
                    for logical, bindings in registry.list(access.space.id)
                ]
            }
        )

    @app.post(path)
    async def create_connection(request: Request, space_id: str) -> JSONResponse:
        registry, access, actor = writable(request, space_id)
        body = _object(await _body(request), "body", {"name"})
        name = _name(body["name"], "name")
        logical = registry.create(access.space.id, name, actor, clock())
        return JSONResponse(_logical_json(logical, []), status_code=201)

    @app.put(path + "/{name}/bindings/{environment}")
    async def set_binding(
        request: Request, space_id: str, name: str, environment: str
    ) -> JSONResponse:
        registry, access, actor = writable(request, space_id)
        logical_name = _name(name, "name")
        target = _environment(environment)
        body = _object(await _body(request), "body", {"connector", "endpoint_key", "identity_mode"})
        try:
            connector = Connector(body["connector"])
        except (ValueError, TypeError):
            raise Invalid("connector") from None
        endpoint = body["endpoint_key"]
        if not isinstance(endpoint, str) or ENDPOINT_KEY.fullmatch(endpoint) is None:
            raise Invalid("endpoint_key")
        try:
            identity_mode = IdentityMode(body["identity_mode"])
        except (ValueError, TypeError):
            raise Invalid("identity_mode") from None
        binding = registry.bind(
            access.space.id,
            logical_name,
            target,
            connector,
            endpoint,
            identity_mode,
            actor,
            clock(),
        )
        return JSONResponse(_binding_json(binding, vault))

    credential_path = path + "/{name}/bindings/{environment}/credential"

    @app.put(credential_path)
    async def set_credential(
        request: Request, space_id: str, name: str, environment: str
    ) -> Response:
        _, access, actor = writable(request, space_id)
        assert vault is not None, "le coffre hébergé est initialisé"
        logical_name = _name(name, "name")
        target = _environment(environment)
        body = _object(await _body(request), "body", {"secret"})
        secret = body["secret"]
        if not isinstance(secret, str) or not secret:
            raise Invalid("secret")
        try:
            size = len(secret.encode("utf-8"))
        except UnicodeError:
            raise Invalid("secret") from None
        if size > 16384:
            raise Invalid("secret")
        vault.put(access.space.id, logical_name, target, secret, actor, clock())
        return Response(status_code=204)

    @app.delete(credential_path)
    def remove_credential(request: Request, space_id: str, name: str, environment: str) -> Response:
        _, access, actor = writable(request, space_id)
        assert vault is not None, "le coffre hébergé est initialisé"
        vault.delete(
            access.space.id, _name(name, "name"), _environment(environment), actor, clock()
        )
        return Response(status_code=204)

    @app.delete(path + "/{name}/bindings/{environment}")
    def remove_binding(request: Request, space_id: str, name: str, environment: str) -> Response:
        registry, access, actor = writable(request, space_id)
        registry.unbind(
            access.space.id, _name(name, "name"), _environment(environment), actor, clock()
        )
        return Response(status_code=204)

    @app.delete(path + "/{name}")
    def remove_connection(request: Request, space_id: str, name: str) -> Response:
        registry, access, actor = writable(request, space_id)
        registry.remove(access.space.id, _name(name, "name"), actor, clock())
        return Response(status_code=204)
