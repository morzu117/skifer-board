"""Routes des exécutions sémantiques suivies (plan 12.5c)."""

from __future__ import annotations

import asyncio
import json
import re
import time
from collections.abc import Callable, Mapping
from datetime import datetime, timedelta
from hashlib import sha256
from typing import Any, Protocol
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
from .contextual import calculer, contrat, figer
from .model import NAME, Connector, IdentityMode
from .oauth_access import PersonalAccess
from .query_validation import filtre, valider
from .runs import ExecutionRecord, ExecutionState, ExecutionStore, ExecutionUnavailable
from .semantic import SemanticRefusal, SemanticRequest, VerifiedReader, describe_catalog
from .store import ConnectionStore
from .vault import CredentialVault
from .worker import ExecutionBusy, ExecutionWorkerPool

IDENTIFIER = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,79}")
EXECUTION_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
DEADLINE = timedelta(seconds=30)
LEASE = timedelta(seconds=40)


class AnalysisReferences(Protocol):
    """Ce que la soumission demande aux analyses versionnées (plan 18.3, A8)."""

    def check(
        self, space_id: str, analysis_id: str, revision: int, actor: PersonRef, model: str
    ) -> None:
        """Lève si la référence n'est pas acceptable pour cette personne et ce modèle."""

    def executed(self, space_id: str, analysis_id: str, revision: int, execution_id: str) -> None:
        """Consigne qu'une exécution acceptée portait cette référence ; ne lève jamais."""


def _reference(value: Any) -> tuple[str, int]:
    """Référence d'analyse `{id, revision}` : forme seule, la vérification est au serveur."""
    found = _object(value, "analysis", {"id", "revision"})
    identifier, revision = found["id"], found["revision"]
    if not isinstance(identifier, str) or EXECUTION_ID.fullmatch(identifier) is None:
        raise Invalid("analysis.id")
    if type(revision) is not int or not 1 <= revision <= 999_999_999:
        raise Invalid("analysis.revision")
    return identifier, revision


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
        if not isinstance(column, str) or IDENTIFIER.fullmatch(column) is None:
            raise Invalid("filters")
        filters.append(filtre(column, operator, value))
    values["filters"] = filters
    canonical = json.dumps(values, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    request_hash = sha256(canonical.encode()).hexdigest()
    return (
        name,
        environment,
        SemanticRequest(model, metrics, dimensions, tuple(filters)),
        request_hash,
    )


def execution_json(record: ExecutionRecord, *, proof: bool = False) -> dict[str, Any]:
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
    if proof and record.state is ExecutionState.SUCCEEDED:
        result["result_contract"] = (
            None
            if record.result_contract is None
            else contrat(record.result_contract, bool(record.truncated))
        )
    if proof:
        result["evidence"] = record.evidence
        result["connector_run_id"] = record.connector_run_id
    return result


def last_execution_of(
    store: ExecutionStore, clock: Callable[[], datetime]
) -> Callable[[str, str, PersonRef], tuple[int, dict[str, Any]] | None]:
    """Dernière exécution d'une personne qui référençait une analyse (plan 18.3b), au format et
    avec la preuve de la route d'une exécution ; la révision référencée l'accompagne."""

    def last(
        space_id: str, analysis_id: str, reader: PersonRef
    ) -> tuple[int, dict[str, Any]] | None:
        store.recover_stale(clock())
        record = store.last_for_analysis(space_id, analysis_id, reader)
        if record is None:
            return None
        assert record.analysis_revision is not None
        return record.analysis_revision, execution_json(record, proof=True)

    return last


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
    personal_access: PersonalAccess,
    measure_contextual: Callable[[ExecutionRecord, str, float], None],
    attributes: Callable[[Identity], Mapping[str, str]] | None,
    analyses: AnalysisReferences,
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

    @app.get("/api/spaces/{space_id}/explorer/fields")
    def explorer_fields(request: Request, space_id: str) -> JSONResponse:
        active(request, space_id)
        if pool is None:
            raise Refused(503, "engine_unavailable")
        try:
            return JSONResponse(describe_catalog(pool.models_dir))
        except SemanticRefusal:
            raise Refused(503, "engine_unavailable") from None

    @app.get("/api/spaces/{space_id}/explorer/connections")
    def explorer_connections(request: Request, space_id: str) -> JSONResponse:
        active(request, space_id)
        assert connections is not None
        return JSONResponse({"connections": [item.name for item, _ in connections.list(space_id)]})

    @app.post(path)
    async def submit_execution(request: Request, space_id: str) -> JSONResponse:
        access, actor = active(request, space_id)
        if pool is None or connections is None:
            raise Refused(503, "engine_unavailable")
        assert store is not None
        await asyncio.to_thread(store.recover_stale, clock())
        body = await _body(request)
        reference: tuple[str, int] | None = None
        if isinstance(body, dict) and "analysis" in body:
            # La référence n'est pas la requête : elle n'entre ni dans l'empreinte ni dans
            # l'exécution, seulement dans la vérification et dans l'événement d'usage.
            body = dict(body)
            reference = _reference(body.pop("analysis"))
        name, environment, semantic, request_hash = _request(body)
        if reference is not None:
            await asyncio.to_thread(
                analyses.check, space_id, reference[0], reference[1], actor, semantic.model
            )
        try:
            catalog = await asyncio.to_thread(describe_catalog, pool.models_dir)
        except SemanticRefusal:
            raise Refused(503, "engine_unavailable") from None
        semantic = valider(semantic, catalog)
        binding = await asyncio.to_thread(connections.get_binding, space_id, name, environment)
        endpoint = connections.get_endpoint(space_id, binding.endpoint_key) or (
            endpoints or {}
        ).get(binding.endpoint_key)
        if endpoint is None or endpoint.connector is not binding.connector:
            raise EndpointNotConfigured()
        connector: ExecutionConnector
        if isinstance(endpoint, DuckDbEndpoint):
            if binding.identity_mode is IdentityMode.PERSON:
                raise IdentityUnavailable()
            connector = DuckDbExecution(endpoint)
        else:
            assert isinstance(endpoint, DatabricksEndpoint)
            if binding.identity_mode is IdentityMode.PERSON:
                tokens = await asyncio.to_thread(personal_access, space_id, actor, endpoint.host)
                token = tokens.access
            else:
                if vault is None:
                    raise Refused(503, "engine_unavailable")
                token = await asyncio.to_thread(vault.reveal_for_execution, binding)
            connector = DatabricksExecution(
                endpoint, token, transport, identity_mode=binding.identity_mode
            )
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
                    binding,
                    actor,
                    request_hash,
                    at,
                    at + DEADLINE,
                    at + LEASE,
                    owner_id,
                    figer(semantic, catalog),
                    reference,
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
        if reference is not None:
            await asyncio.to_thread(
                analyses.executed, space_id, reference[0], reference[1], record.id
            )
        return JSONResponse(execution_json(record), status_code=202)

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
        return JSONResponse({"executions": [execution_json(item) for item in records]})

    @app.get(path + "/{execution_id}")
    def get_execution(request: Request, space_id: str, execution_id: str) -> JSONResponse:
        access, actor = visible(request, space_id)
        assert store is not None
        store.recover_stale(clock())
        identifier = record_id(execution_id)
        own = store.get(access.space.id, identifier, actor)
        if own is not None:
            return JSONResponse(execution_json(own, proof=True))
        if access.manages:
            other = store.get(access.space.id, identifier, actor, manages=True)
            if other is not None:
                return JSONResponse(execution_json(other))
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

    @app.post(path + "/{execution_id}/contextual")
    async def contextual(request: Request, space_id: str, execution_id: str) -> JSONResponse:
        access, actor = active(request, space_id)
        assert store is not None
        await asyncio.to_thread(store.recover_stale, clock())
        identifier = record_id(execution_id)
        own = await asyncio.to_thread(store.get, access.space.id, identifier, actor)
        if own is None:
            raise Refused(404, "execution_not_found")
        if own.state is not ExecutionState.SUCCEEDED:
            raise Refused(409, "result_unavailable")
        data = await asyncio.to_thread(store.result, access.space.id, identifier, actor)
        if data is None:
            raise Refused(503, "result_unavailable")
        assert own.evidence is not None
        started = time.monotonic()
        outcome = "error"
        try:
            body = await _body(request)
            result = await asyncio.to_thread(
                calculer,
                data,
                own.result_contract,
                bool(own.truncated),
                own.evidence["evidence_id"],
                body,
            )
            outcome = "ok" if result["status"] == "derived" else "unavailable"
            return JSONResponse(result)
        except Invalid:
            outcome = "invalid_request"
            raise
        finally:
            try:
                measure_contextual(own, outcome, max(0.0, time.monotonic() - started))
            except Exception:
                pass

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
        return JSONResponse(execution_json(updated, proof=updated.reader == actor))
