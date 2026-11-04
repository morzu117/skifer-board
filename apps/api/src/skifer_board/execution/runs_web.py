"""Routes des exécutions sémantiques suivies (plan 12.5c)."""

from __future__ import annotations

import asyncio
import json
import math
import re
from collections.abc import Callable, Mapping
from datetime import datetime, timedelta
from hashlib import sha256
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from ..identity.model import Identity
from ..spaces.access import Access
from ..spaces.model import Environment, LocalMode, PersonRef
from ..spaces.web import Invalid, Refused, _body, _object, viewer
from .connectors import (
    DatabricksEndpoint,
    DatabricksExecution,
    DuckDbEndpoint,
    DuckDbExecution,
    Endpoint,
    EndpointNotConfigured,
    ExecutionConnector,
    HttpTransport,
    IdentityUnavailable,
)
from .model import NAME, Connector, IdentityMode
from .runs import ExecutionRecord, ExecutionState, ExecutionStore, ExecutionUnavailable
from .semantic import SemanticRequest, VerifiedReader
from .store import ConnectionStore
from .vault import CredentialVault
from .worker import ExecutionBusy, ExecutionWorkerPool

IDENTIFIER = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,79}")
EXECUTION_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
OPERATORS = frozenset({"eq", "ne", "gt", "gte", "lt", "lte"})
DEADLINE = timedelta(seconds=30)
LEASE = timedelta(seconds=40)


def _names(value: Any, field: str, *, required: bool) -> tuple[str, ...]:
    if (
        not isinstance(value, list)
        or (required and not value)
        or len(value) > 32
        or any(not isinstance(item, str) or IDENTIFIER.fullmatch(item) is None for item in value)
        or len(set(value)) != len(value)
    ):
        raise Invalid(field)
    return tuple(value)


def _request(body: Any) -> tuple[str, Environment, SemanticRequest, str]:
    values = _object(
        body, "body", {"connection", "environment", "model", "metrics", "dimensions", "filters"}
    )
    name, model = values["connection"], values["model"]
    if not isinstance(name, str) or NAME.fullmatch(name) is None:
        raise Invalid("connection")
    if not isinstance(model, str) or IDENTIFIER.fullmatch(model) is None:
        raise Invalid("model")
    try:
        environment = Environment(values["environment"])
    except (ValueError, TypeError):
        raise Invalid("environment") from None
    metrics = _names(values["metrics"], "metrics", required=True)
    dimensions = _names(values["dimensions"], "dimensions", required=False)
    raw_filters = values["filters"]
    if not isinstance(raw_filters, list) or len(raw_filters) > 32:
        raise Invalid("filters")
    filters: list[dict[str, Any]] = []
    for item in raw_filters:
        if not isinstance(item, dict) or set(item) != {"column", "operator", "value"}:
            raise Invalid("filters")
        column, operator, value = item["column"], item["operator"], item["value"]
        if (
            not isinstance(column, str)
            or IDENTIFIER.fullmatch(column) is None
            or not isinstance(operator, str)
            or operator not in OPERATORS
            or type(value) not in (str, int, float, bool)
            or (type(value) is float and not math.isfinite(value))
            or (type(value) is str and (len(value) > 1024 or "\x00" in value))
        ):
            raise Invalid("filters")
        filters.append({"column": column, "operator": operator, "value": value})
    try:
        canonical = json.dumps(values, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        request_hash = sha256(canonical.encode()).hexdigest()
    except UnicodeError:
        raise Invalid("filters") from None
    return (
        name,
        environment,
        SemanticRequest(model, metrics, dimensions, tuple(filters)),
        request_hash,
    )


def _json(record: ExecutionRecord, *, proof: bool = False) -> dict[str, Any]:
    result: dict[str, Any] = {
        "id": record.id,
        "space_id": record.space_id,
        "environment": record.environment.value,
        "connection": record.connection_name,
        "state": record.state.value,
        "created_at": record.created_at.isoformat(),
        "started_at": None if record.started_at is None else record.started_at.isoformat(),
        "finished_at": None if record.finished_at is None else record.finished_at.isoformat(),
        "deadline_at": record.deadline_at.isoformat(),
        "can_cancel": record.connector is Connector.DATABRICKS
        and record.state in {ExecutionState.QUEUED, ExecutionState.RUNNING}
        and not record.cancel_requested,
        "cancel_requested": record.cancel_requested,
        "error_code": record.error_code,
        "rows": record.row_count,
        "size": record.byte_count,
        "truncated": record.truncated,
    }
    if proof:
        result["evidence"] = record.evidence
        result["connector_run_id"] = record.connector_run_id
    return result


def install_execution_routes(
    app: FastAPI,
    store: ExecutionStore | None,
    connections: ConnectionStore | None,
    pool: ExecutionWorkerPool | None,
    reader: Callable[[Request, str], Access],
    manager: Callable[[Request, str], Access],
    clock: Callable[[], datetime],
    vault: CredentialVault | None,
    endpoints: Mapping[str, Endpoint] | None,
    transport: HttpTransport,
    attributes: Callable[[Identity], Mapping[str, str]] | None = None,
) -> None:
    path = "/api/spaces/{space_id}/executions"

    def active(request: Request, space_id: str) -> tuple[Access, PersonRef]:
        access = reader(request, space_id)
        if access.implicit or store is None:
            raise LocalMode(space_id)
        identity = viewer(request)
        assert identity is not None
        return access, PersonRef.of(identity)

    def visible(request: Request, space_id: str) -> tuple[Access, PersonRef]:
        try:
            return active(request, space_id)
        except Refused as error:
            if error.code != "forbidden":
                raise
            access = manager(request, space_id)
            identity = viewer(request)
            assert identity is not None
            return access, PersonRef.of(identity)

    def record_id(value: str) -> str:
        if EXECUTION_ID.fullmatch(value) is None:
            raise Refused(404, "execution_not_found")
        return value

    @app.post(path)
    async def submit_execution(request: Request, space_id: str) -> JSONResponse:
        access, actor = active(request, space_id)
        if pool is None or connections is None:
            raise Refused(503, "engine_unavailable")
        assert store is not None
        await asyncio.to_thread(store.recover_stale, clock())
        name, environment, semantic, request_hash = _request(await _body(request))
        binding = await asyncio.to_thread(connections.get_binding, space_id, name, environment)
        if binding.identity_mode is not IdentityMode.SERVICE:
            raise IdentityUnavailable()
        endpoint = connections.get_endpoint(space_id, binding.endpoint_key) or (
            endpoints or {}
        ).get(binding.endpoint_key)
        if endpoint is None or endpoint.connector is not binding.connector:
            raise EndpointNotConfigured()
        connector: ExecutionConnector
        if isinstance(endpoint, DuckDbEndpoint):
            connector = DuckDbExecution(endpoint)
        else:
            assert isinstance(endpoint, DatabricksEndpoint)
            if vault is None:
                raise Refused(503, "engine_unavailable")
            token = await asyncio.to_thread(vault.reveal_for_execution, binding)
            connector = DatabricksExecution(endpoint, token, transport)
        identity = viewer(request)
        assert identity is not None
        try:
            supplied = {} if attributes is None else dict(attributes(identity))
            if any(
                not isinstance(key, str) or not isinstance(value, str)
                for key, value in supplied.items()
            ):
                raise ValueError
        except (ValueError, TypeError):
            raise Refused(503, "engine_unavailable") from None
        supplied.update({"issuer": identity.issuer, "subject": identity.subject})
        verified = VerifiedReader(identity, supplied)
        at = clock()
        owner_id = str(uuid4())
        try:
            record = await asyncio.to_thread(
                pool.submit,
                lambda: store.create(
                    binding, actor, request_hash, at, at + DEADLINE, at + LEASE, owner_id
                ),
                semantic,
                verified,
                binding,
                connector,
            )
        except ExecutionBusy:
            raise Refused(503, "worker_unavailable") from None
        except ExecutionUnavailable:
            raise Refused(409, "binding_changed") from None
        return JSONResponse(_json(record), status_code=202)

    @app.get(path)
    def list_executions(request: Request, space_id: str, scope: str = "mine") -> JSONResponse:
        if scope not in {"mine", "space"}:
            raise Invalid("scope")
        if scope == "space":
            access = manager(request, space_id)
            identity = viewer(request)
            assert identity is not None
            actor = PersonRef.of(identity)
        else:
            access, actor = active(request, space_id)
        assert store is not None
        store.recover_stale(clock())
        records = store.list(access.space.id, actor, manages=scope == "space")
        return JSONResponse({"executions": [_json(item) for item in records]})

    @app.get(path + "/{execution_id}")
    def get_execution(request: Request, space_id: str, execution_id: str) -> JSONResponse:
        access, actor = visible(request, space_id)
        assert store is not None
        store.recover_stale(clock())
        identifier = record_id(execution_id)
        own = store.get(access.space.id, identifier, actor)
        if own is not None:
            return JSONResponse(_json(own, proof=True))
        if access.manages:
            other = store.get(access.space.id, identifier, actor, manages=True)
            if other is not None:
                return JSONResponse(_json(other))
        raise Refused(404, "execution_not_found")

    @app.get(path + "/{execution_id}/result")
    def get_result(request: Request, space_id: str, execution_id: str) -> Response:
        access, actor = active(request, space_id)
        assert store is not None
        store.recover_stale(clock())
        identifier = record_id(execution_id)
        own = store.get(access.space.id, identifier, actor)
        if own is None:
            raise Refused(404, "execution_not_found")
        if own.state is not ExecutionState.SUCCEEDED:
            raise Refused(409, "result_unavailable")
        data = store.result(access.space.id, identifier, actor)
        if data is None:
            raise Refused(503, "result_unavailable")
        return Response(data, media_type="application/vnd.apache.arrow.stream")

    @app.post(path + "/{execution_id}/cancel")
    async def cancel_execution(request: Request, space_id: str, execution_id: str) -> JSONResponse:
        access, actor = active(request, space_id)
        if await request.body():
            raise Invalid("body")
        assert store is not None
        await asyncio.to_thread(store.recover_stale, clock())
        updated = await asyncio.to_thread(
            store.request_cancel,
            access.space.id,
            record_id(execution_id),
            actor,
            clock(),
            manages=access.manages,
        )
        if updated is None:
            raise Refused(404, "execution_not_found")
        return JSONResponse(_json(updated, proof=updated.reader == actor))
