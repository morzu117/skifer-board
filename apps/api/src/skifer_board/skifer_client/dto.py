"""Pydantic v2 DTO of the skifer public API (SK-02); shapes are fixed by D14.

Response DTOs tolerate unknown fields (`extra="ignore"`), so a field skifer adds later does not
break the board; every field known to this module stays required and typed. Request DTOs are
closed (`extra="forbid"`): the body of `POST /query` is exactly SK-02.2, nothing more.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue

LogicalType = Literal["string", "date", "integer", "decimal"]
FilterOperator = Literal[
    "eq", "neq", "gt", "lt", "gte", "lte", "in", "like", "is_null", "is_not_null"
]
PolicyDecision = Literal["ALLOW", "WARN", "DENY", "REQUIRE_HUMAN"]


class _ResponseModel(BaseModel):
    """Base of every DTO decoded from a skifer response."""

    model_config = ConfigDict(frozen=True, extra="ignore")


class _RequestModel(BaseModel):
    """Base of every DTO sent to skifer."""

    model_config = ConfigDict(frozen=True, extra="forbid")


class Identity(_ResponseModel):
    subject: str
    consumer_class: str
    scopes: tuple[str, ...]


class ModelSummary(_ResponseModel):
    key: str
    description: str
    layer: str | None
    tags: tuple[str, ...]


class ModelPage(_ResponseModel):
    items: tuple[ModelSummary, ...]
    next_cursor: str | None
    total: int


class GovernedModelView(_ResponseModel):
    key: str
    description: str
    layer: str | None
    tags: tuple[str, ...]
    dimensions: tuple[str, ...]
    metrics: tuple[str, ...]
    entities: tuple[str, ...]
    related_models: tuple[str, ...]


class Column(_ResponseModel):
    name: str
    logical_type: LogicalType


class EvidenceMetric(_ResponseModel):
    name: str
    model_key: str
    definition_hash: str
    source_columns: tuple[str, ...]
    lineage_status: str


class EvidenceSource(_ResponseModel):
    dataset: str
    contract_id: str
    contract_version: str
    definition_hash: str
    certification_status: str
    certified_at: str
    load_age_seconds: float
    data_age_seconds: float
    certification_run_id: str


class EvidencePolicy(_ResponseModel):
    decision: PolicyDecision
    reasons: tuple[str, ...]
    evaluated_at: str


class NormalizedFilter(_ResponseModel):
    column: str
    operator: str
    value: str | None = None


class Evidence(_ResponseModel):
    schema_version: str
    evidence_id: str
    trace_id: str
    model_keys: tuple[str, ...]
    metrics: tuple[EvidenceMetric, ...]
    dimensions: tuple[str, ...]
    normalized_filters: tuple[NormalizedFilter, ...]
    sources: tuple[EvidenceSource, ...]
    policy: EvidencePolicy
    sql_hash: str
    statement_id: str
    compiled_at: str
    executed_at: str
    execution_status: str
    execution_duration_seconds: float
    execution_error_type: str | None


class QueryResult(_ResponseModel):
    columns: tuple[Column, ...]
    rows: tuple[dict[str, JsonValue], ...]
    evidence: Evidence
    truncated: bool


class QueryFilter(_RequestModel):
    column: str
    operator: FilterOperator
    value: JsonValue | None = None


class QueryRequest(_RequestModel):
    """Closed body of `POST /query` (SK-02.2): names only, never `sql`, never `limit`."""

    model: str
    metrics: tuple[str, ...]
    group_by: tuple[str, ...] = Field(default_factory=tuple)
    filters: tuple[QueryFilter, ...] = Field(default_factory=tuple)
    date_from: str | None = None
    date_to: str | None = None
    period: str | None = None
