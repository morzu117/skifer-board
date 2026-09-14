"""skifer mock: the nominal path of the SK-02 public API, with the HTTP contract of D14.

Everything is computed from the frozen catalogue: no network, no clock, no randomness. Two
identical requests yield byte-identical responses.
"""

import base64
import binascii
import hashlib
import json
import secrets
import uuid
from collections.abc import Mapping
from itertools import islice, product
from typing import Any, Literal

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.middleware.base import RequestResponseEndpoint

from skifer_mock.catalog import CATALOG, FROZEN_AT, TEST_CATALOG, Dimension, Metric, Model

API_PREFIX = "/api/v1"
DEFAULT_TOKEN = "mock-token"
MODELS_LIMIT_DEFAULT = 50
MODELS_LIMIT_MAX = 100
QUERY_LIMIT_DEFAULT = 100
QUERY_LIMIT_MAX = 1000
EVIDENCE_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://skifer-board/skifer-mock/evidence")
REDACTED = "<redacted>"

FilterOperator = Literal[
    "eq", "neq", "gt", "lt", "gte", "lte", "in", "like", "is_null", "is_not_null"
]
FilterScalar = str | int | float | bool


class QueryFilter(BaseModel):
    model_config = ConfigDict(extra="forbid")

    column: str = Field(min_length=1)
    operator: FilterOperator
    value: FilterScalar | list[FilterScalar] | None = None


class SemanticQueryBody(BaseModel):
    """Closed body of `POST /query` (SK-02.2); `limit` is a query parameter."""

    model_config = ConfigDict(extra="forbid")

    model: str = Field(min_length=1)
    metrics: list[str] = Field(min_length=1)
    group_by: list[str] = Field(default_factory=list)
    filters: list[QueryFilter] = Field(default_factory=list)
    date_from: str | None = None
    date_to: str | None = None
    period: str | None = None


class MockApiError(Exception):
    """An error rendered as `{"error": {"type", "message", ...}}` (SK-02.5, D14)."""

    def __init__(self, status_code: int, error_type: str, message: str, **details: Any) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_type = error_type
        self.message = message
        self.details = details


def error_response(status_code: int, error_type: str, message: str, **details: Any) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"type": error_type, "message": message, **details}},
    )


SCOPES_FULL = ("models:read", "query:execute")
SCOPES_READ_ONLY = ("models:read",)


def resolve_scopes(
    authorization: str | None, token: str, read_only_token: str | None
) -> tuple[str, ...] | None:
    """Return the scopes of the presented bearer, or `None` if it authenticates no one."""
    scheme, _, credentials = (authorization or "").partition(" ")
    if scheme.lower() != "bearer":
        return None
    presented = credentials.encode("utf-8")
    if secrets.compare_digest(presented, token.encode("utf-8")):
        return SCOPES_FULL
    if read_only_token is not None and secrets.compare_digest(
        presented, read_only_token.encode("utf-8")
    ):
        return SCOPES_READ_ONLY
    return None


def encode_cursor(offset: int) -> str:
    raw = json.dumps({"offset": offset}, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_cursor(cursor: str, total: int) -> int:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        payload = json.loads(raw)
    except (binascii.Error, ValueError) as exc:
        raise MockApiError(400, "InvalidCursor", "The cursor is not valid.") from exc
    offset = payload.get("offset") if isinstance(payload, dict) else None
    if isinstance(offset, bool) or not isinstance(offset, int) or not 0 <= offset < total:
        raise MockApiError(400, "InvalidCursor", "The cursor is not valid.")
    return offset


def validate_limit(limit: int, maximum: int) -> int:
    if not 1 <= limit <= maximum:
        raise MockApiError(
            400, "LimitExceeded", f"limit must be between 1 and {maximum} (got {limit})."
        )
    return limit


def list_models_page(
    cursor: str | None, limit: int, catalog: Mapping[str, Model]
) -> dict[str, Any]:
    keys = sorted(catalog)
    offset = 0 if cursor is None else decode_cursor(cursor, len(keys))
    page = keys[offset : offset + limit]
    next_offset = offset + len(page)
    return {
        "items": [
            {
                "key": model.key,
                "description": model.description,
                "layer": model.layer,
                "tags": list(model.tags),
            }
            for model in (catalog[key] for key in page)
        ],
        "next_cursor": encode_cursor(next_offset) if next_offset < len(keys) else None,
        "total": len(keys),
    }


def get_model(key: str, catalog: Mapping[str, Model]) -> Model:
    model = catalog.get(key)
    if model is None:
        raise MockApiError(404, "ResourceNotFound", f"Unknown model '{key}'.")
    return model


def describe_model(key: str, catalog: Mapping[str, Model]) -> dict[str, Any]:
    model = get_model(key, catalog)
    return {
        "key": model.key,
        "description": model.description,
        "layer": model.layer,
        "tags": list(model.tags),
        "dimensions": [dimension.name for dimension in model.dimensions],
        "metrics": [metric.name for metric in model.metrics],
        "entities": list(model.entities),
        "related_models": list(model.related_models),
    }


def _reachable_models(root: Model, catalog: Mapping[str, Model]) -> tuple[Model, ...]:
    return (root, *(catalog[key] for key in root.related_models))


def resolve_metric(name: str, reachable: tuple[Model, ...]) -> tuple[Model, Metric]:
    for model in reachable:
        for metric in model.metrics:
            if metric.name == name:
                return model, metric
    available = sorted({metric.name for model in reachable for metric in model.metrics})
    raise MockApiError(
        422,
        "SemanticQueryError",
        f"Unknown metric '{name}' for model '{reachable[0].key}'.",
        suggestions=available,
    )


def resolve_dimension(name: str, reachable: tuple[Model, ...]) -> tuple[Model, Dimension]:
    for model in reachable:
        for dimension in model.dimensions:
            if dimension.name == name:
                return model, dimension
    available = sorted({dim.name for model in reachable for dim in model.dimensions})
    raise MockApiError(
        422,
        "SemanticQueryError",
        f"Unknown dimension '{name}' for model '{reachable[0].key}'.",
        suggestions=available,
    )


def filtered_values(dimension: Dimension, filters: list[QueryFilter]) -> list[str]:
    """Apply `eq`, `neq` and `in` filters on a dimension; other operators leave rows as is."""
    values = list(dimension.values)
    for query_filter in filters:
        if query_filter.column != dimension.name:
            continue
        if query_filter.operator == "eq":
            values = [value for value in values if value == query_filter.value]
        elif query_filter.operator == "neq":
            values = [value for value in values if value != query_filter.value]
        elif query_filter.operator == "in":
            accepted = query_filter.value if isinstance(query_filter.value, list) else []
            values = [value for value in values if value in accepted]
    return values


def canonical_json(payload: Any) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def metric_value(
    model_key: str, metric: Metric, dimension_values: list[list[str]], canonical_query: str
) -> int | float:
    """Pure function of (model, metric, the row's dimension values, normalized query)."""
    seed = canonical_json([model_key, metric.name, dimension_values, canonical_query])
    number = int.from_bytes(hashlib.sha256(seed.encode("utf-8")).digest()[:8], "big")
    if metric.logical_type == "integer":
        return number % 10_000
    return (number % 10_000_000) / 100


def run_query(body: SemanticQueryBody, limit: int, catalog: Mapping[str, Model]) -> dict[str, Any]:
    root = get_model(body.model, catalog)
    reachable = _reachable_models(root, catalog)
    metrics = [resolve_metric(name, reachable) for name in body.metrics]
    dimensions = [resolve_dimension(name, reachable) for name in body.group_by]
    if body.period is not None:
        periods = sorted({period for model in reachable for period in model.periods})
        if body.period not in periods:
            raise MockApiError(
                422,
                "SemanticQueryError",
                f"Unknown period '{body.period}' for model '{root.key}'.",
                suggestions=periods,
            )

    involved: list[Model] = [root]
    for model, _ in [*metrics, *dimensions]:
        if model not in involved:
            involved.append(model)

    denied = [model for model in involved if model.decision in ("DENY", "REQUIRE_HUMAN")]
    if denied:
        reasons: list[str] = []
        for model in denied:
            reasons.extend(reason for reason in model.reasons if reason not in reasons)
        raise MockApiError(
            403,
            "SemanticAccessDenied",
            f"The certification gate denies access to '{denied[0].key}'.",
            decision=denied[0].decision,
            reasons=reasons,
            evaluated_at=FROZEN_AT,
            recommended_action=denied[0].recommended_action,
        )

    warned = [model for model in involved if model.decision == "WARN"]
    policy_reasons: list[str] = []
    for model in warned:
        policy_reasons.extend(reason for reason in model.reasons if reason not in policy_reasons)

    filters = [query_filter.model_dump(exclude_unset=True) for query_filter in body.filters]
    normalized = {
        "model": root.key,
        "metrics": list(body.metrics),
        "group_by": list(body.group_by),
        "filters": filters,
        "date_from": body.date_from,
        "date_to": body.date_to,
        "period": body.period,
    }
    canonical_query = canonical_json(normalized)
    digest = hashlib.sha256(canonical_query.encode("utf-8")).hexdigest()

    value_lists = [filtered_values(dimension, body.filters) for _, dimension in dimensions]
    combinations = list(islice(product(*value_lists), limit + 1))
    rows: list[dict[str, Any]] = []
    for combination in combinations[:limit]:
        pairs = [
            [dimension.name, value]
            for (_, dimension), value in zip(dimensions, combination, strict=True)
        ]
        row: dict[str, Any] = {name: value for name, value in pairs}
        for model, metric in metrics:
            row[metric.name] = metric_value(model.key, metric, pairs, canonical_query)
        rows.append(row)

    columns = [
        {"name": dimension.name, "logical_type": dimension.logical_type}
        for _, dimension in dimensions
    ] + [{"name": metric.name, "logical_type": metric.logical_type} for _, metric in metrics]

    evidence = {
        "schema_version": "1",
        "evidence_id": str(uuid.uuid5(EVIDENCE_NAMESPACE, canonical_query)),
        "trace_id": f"mock-trace-{digest[:16]}",
        "model_keys": [model.key for model in involved],
        "metrics": [
            {
                "name": metric.name,
                "model_key": model.key,
                "definition_hash": metric.definition_hash(model.key),
                "source_columns": list(metric.source_columns),
                "lineage_status": "resolved",
            }
            for model, metric in metrics
        ],
        "dimensions": list(body.group_by),
        "normalized_filters": [
            {
                "column": query_filter["column"],
                "operator": query_filter["operator"],
                **({"value": REDACTED} if "value" in query_filter else {}),
            }
            for query_filter in filters
        ],
        "sources": [
            {
                "dataset": model.source.dataset,
                "contract_id": model.source.contract_id,
                "contract_version": model.source.contract_version,
                "definition_hash": model.source.definition_hash,
                "certification_status": model.source.certification_status,
                "certified_at": model.source.certified_at,
                "load_age_seconds": model.source.load_age_seconds,
                "data_age_seconds": model.source.data_age_seconds,
                "certification_run_id": model.source.certification_run_id,
            }
            for model in involved
        ],
        "policy": {
            "decision": "WARN" if warned else "ALLOW",
            "reasons": policy_reasons,
            "evaluated_at": FROZEN_AT,
        },
        "sql_hash": f"sha256:v1:{digest}",
        "statement_id": f"mock-statement-{digest[:16]}",
        "compiled_at": FROZEN_AT,
        "executed_at": FROZEN_AT,
        "execution_status": "succeeded",
        "execution_duration_seconds": 0.042,
        "execution_error_type": None,
    }
    return {
        "columns": columns,
        "rows": rows,
        "evidence": evidence,
        "truncated": len(combinations) > limit,
    }


QUERY_PATH = f"{API_PREFIX}/query"
HEALTH_PATH = f"{API_PREFIX}/health"
SCENARIO_HEADER = "X-Mock-Scenario"
MOCK_SCENARIOS = (
    "deny_expired",
    "warn_stale",
    "require_human",
    "limit_exceeded",
    "invalid_cursor",
    "unknown_metric",
    "scope_denied",
    "unavailable",
)
QUERY_ONLY_SCENARIOS = frozenset({"deny_expired", "warn_stale", "require_human"})


async def _drain_response_body(response: Response) -> bytes:
    chunks = [section async for section in response.body_iterator]  # type: ignore[attr-defined]
    return b"".join(chunks)


def create_app(
    *,
    token: str = DEFAULT_TOKEN,
    read_only_token: str | None = None,
    catalog: Mapping[str, Model] = CATALOG,
) -> FastAPI:
    """Build the mock app; every route but `/health` requires `Authorization: Bearer <token>`."""
    app = FastAPI(title="skifer mock", docs_url=None, redoc_url=None, openapi_url=None)

    # Starlette applies the LAST-registered `@app.middleware("http")` outermost (it runs first),
    # so `apply_scenario` is registered before `authenticate`: authentication must run first, and
    # the scenario header must never bypass it.
    @app.middleware("http")
    async def apply_scenario(request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.url.path == HEALTH_PATH:
            return await call_next(request)
        scenario = request.headers.get(SCENARIO_HEADER)
        if scenario is None:
            return await call_next(request)
        if scenario not in MOCK_SCENARIOS:
            return error_response(
                400,
                "InvalidRequest",
                f"Unknown X-Mock-Scenario '{scenario}'; expected one of: "
                f"{', '.join(MOCK_SCENARIOS)}.",
            )
        if scenario in QUERY_ONLY_SCENARIOS and request.url.path != QUERY_PATH:
            return await call_next(request)
        if scenario == "limit_exceeded":
            return error_response(
                400, "LimitExceeded", "The requested limit exceeds the allowed maximum."
            )
        if scenario == "invalid_cursor":
            return error_response(400, "InvalidCursor", "The cursor is not valid.")
        if scenario == "unknown_metric":
            available = sorted(
                {metric.name for model in catalog.values() for metric in model.metrics}
            )
            return error_response(
                422, "SemanticQueryError", "Unknown metric.", suggestions=available
            )
        if scenario == "scope_denied":
            return error_response(403, "ScopeDenied", "The 'query:execute' scope is required.")
        if scenario == "unavailable":
            return error_response(
                503, "ResourceUnavailable", "The service is temporarily unavailable."
            )
        if scenario == "deny_expired":
            return error_response(
                403,
                "SemanticAccessDenied",
                "The certification gate denies access.",
                decision="DENY",
                reasons=["EXPIRED"],
                evaluated_at=FROZEN_AT,
                recommended_action="Renew the certification before querying it.",
            )
        if scenario == "require_human":
            return error_response(
                403,
                "SemanticAccessDenied",
                "The certification gate denies access.",
                decision="REQUIRE_HUMAN",
                reasons=["MISSING"],
                evaluated_at=FROZEN_AT,
                recommended_action="Get human sign-off before querying it.",
            )
        response = await call_next(request)
        if scenario == "warn_stale" and response.status_code == 200:
            payload = json.loads(await _drain_response_body(response))
            payload["evidence"]["policy"] = {
                "decision": "WARN",
                "reasons": ["STALE"],
                "evaluated_at": FROZEN_AT,
            }
            return JSONResponse(payload)
        return response

    @app.middleware("http")
    async def authenticate(request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.url.path == HEALTH_PATH:
            return await call_next(request)
        scopes = resolve_scopes(request.headers.get("authorization"), token, read_only_token)
        if scopes is None:
            return error_response(401, "Unauthenticated", "A valid bearer token is required.")
        request.state.scopes = scopes
        return await call_next(request)

    @app.exception_handler(MockApiError)
    async def handle_mock_error(_: Request, exc: MockApiError) -> JSONResponse:
        return error_response(exc.status_code, exc.error_type, exc.message, **exc.details)

    @app.exception_handler(RequestValidationError)
    async def handle_invalid_request(_: Request, exc: RequestValidationError) -> JSONResponse:
        problems = "; ".join(
            f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}"
            for error in exc.errors()
        )
        return error_response(400, "InvalidRequest", f"Invalid request: {problems}")

    @app.get(f"{API_PREFIX}/health")
    def health() -> dict[str, Any]:
        return {"status": "ok"}

    @app.get(f"{API_PREFIX}/me")
    def me(request: Request) -> dict[str, Any]:
        return {
            "subject": "mock-user",
            "consumer_class": "dashboard",
            "scopes": list(request.state.scopes),
        }

    @app.get(f"{API_PREFIX}/models")
    def list_models(cursor: str | None = None, limit: int = MODELS_LIMIT_DEFAULT) -> dict[str, Any]:
        return list_models_page(cursor, validate_limit(limit, MODELS_LIMIT_MAX), catalog)

    @app.get(f"{API_PREFIX}/models/{{key}}")
    def read_model(key: str) -> dict[str, Any]:
        return describe_model(key, catalog)

    @app.post(f"{API_PREFIX}/query")
    def query(
        request: Request, body: SemanticQueryBody, limit: int = QUERY_LIMIT_DEFAULT
    ) -> dict[str, Any]:
        if "query:execute" not in request.state.scopes:
            raise MockApiError(403, "ScopeDenied", "The 'query:execute' scope is required.")
        return run_query(body, validate_limit(limit, QUERY_LIMIT_MAX), catalog)

    return app


def create_contract_app() -> FastAPI:
    """App for `skifer_contract_tests` (D15): `WARN`, `REQUIRE_HUMAN` and `ScopeDenied` fixtures."""
    return create_app(read_only_token="mock-read-token", catalog=TEST_CATALOG)
