"""Frozen catalogue of the skifer mock, as fixed by plan 01 §4.

Dimension values are frozen so that query rows are a pure function of the request:

- `region`: EMEA, NA, APAC; `channel`: web, store;
- `order_date`: the first day of each month, from 2025-10-01 to 2026-09-01;
- `order_month` and `invoice_month`: the 12 months from 2025-10 to 2026-09;
- `customer_id`: C001 to C005; `segment`: smb, enterprise; `country`: FR, DE, US;
- `status`: paid, open, overdue.

Certification: `sales.*` is `CERTIFIED` (decision `ALLOW`), `finance.invoices` is `EXPIRED`
(decision `DENY`, reason `EXPIRED`).
"""

import hashlib
from dataclasses import dataclass

FROZEN_AT = "2026-09-13T00:00:00Z"

MONTHS = tuple(f"2025-{month:02d}" for month in range(10, 13)) + tuple(
    f"2026-{month:02d}" for month in range(1, 10)
)


def frozen_hash(label: str) -> str:
    """Return a frozen definition hash, in the `sha256:v1:<hex>` format of skifer."""
    return "sha256:v1:" + hashlib.sha256(label.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Dimension:
    name: str
    logical_type: str
    values: tuple[str, ...]


@dataclass(frozen=True)
class Metric:
    name: str
    source_columns: tuple[str, ...]

    @property
    def logical_type(self) -> str:
        return "integer" if self.name.endswith("_count") else "decimal"

    def definition_hash(self, model_key: str) -> str:
        return frozen_hash(f"metric:{model_key}.{self.name}")


@dataclass(frozen=True)
class Source:
    dataset: str
    contract_id: str
    contract_version: str
    certification_status: str
    certified_at: str
    load_age_seconds: float
    data_age_seconds: float
    certification_run_id: str

    @property
    def definition_hash(self) -> str:
        return frozen_hash(f"source:{self.dataset}@{self.contract_version}")


@dataclass(frozen=True)
class Model:
    key: str
    description: str
    layer: str
    tags: tuple[str, ...]
    dimensions: tuple[Dimension, ...]
    metrics: tuple[Metric, ...]
    entities: tuple[str, ...]
    related_models: tuple[str, ...]
    periods: tuple[str, ...]
    source: Source
    decision: str
    reasons: tuple[str, ...]
    recommended_action: str | None


SALES_ORDERS = Model(
    key="sales.orders",
    description="Orders placed on every sales channel.",
    layer="gold",
    tags=("sales",),
    dimensions=(
        Dimension("order_date", "date", tuple(f"{month}-01" for month in MONTHS)),
        Dimension("order_month", "string", MONTHS),
        Dimension("region", "string", ("EMEA", "NA", "APAC")),
        Dimension("channel", "string", ("web", "store")),
        Dimension("customer_id", "string", ("C001", "C002", "C003", "C004", "C005")),
    ),
    metrics=(
        Metric("revenue", ("amount",)),
        Metric("order_count", ("order_id",)),
        Metric("avg_basket", ("amount", "order_id")),
    ),
    entities=("order", "customer"),
    related_models=("sales.customers",),
    periods=("last_12_months", "ytd", "previous_year"),
    source=Source(
        dataset="gold.sales_orders",
        contract_id="sales_orders",
        contract_version="1.0.0",
        certification_status="CERTIFIED",
        certified_at=FROZEN_AT,
        load_age_seconds=3600.0,
        data_age_seconds=7200.0,
        certification_run_id="mock-run-sales-orders",
    ),
    decision="ALLOW",
    reasons=(),
    recommended_action=None,
)

SALES_CUSTOMERS = Model(
    key="sales.customers",
    description="Customers, joined to orders through customer_id.",
    layer="gold",
    tags=("sales",),
    dimensions=(
        Dimension("customer_id", "string", ("C001", "C002", "C003", "C004", "C005")),
        Dimension("segment", "string", ("smb", "enterprise")),
        Dimension("country", "string", ("FR", "DE", "US")),
    ),
    metrics=(Metric("customer_count", ("customer_id",)),),
    entities=("customer",),
    related_models=("sales.orders",),
    periods=(),
    source=Source(
        dataset="gold.sales_customers",
        contract_id="sales_customers",
        contract_version="1.0.0",
        certification_status="CERTIFIED",
        certified_at=FROZEN_AT,
        load_age_seconds=3600.0,
        data_age_seconds=7200.0,
        certification_run_id="mock-run-sales-customers",
    ),
    decision="ALLOW",
    reasons=(),
    recommended_action=None,
)

FINANCE_INVOICES = Model(
    key="finance.invoices",
    description="Issued invoices and their payment status.",
    layer="gold",
    tags=("finance",),
    dimensions=(
        Dimension("invoice_month", "string", MONTHS),
        Dimension("status", "string", ("paid", "open", "overdue")),
    ),
    metrics=(
        Metric("invoiced_amount", ("amount",)),
        Metric("overdue_amount", ("amount", "status")),
    ),
    entities=("invoice",),
    related_models=(),
    periods=(),
    source=Source(
        dataset="gold.finance_invoices",
        contract_id="finance_invoices",
        contract_version="1.0.0",
        certification_status="EXPIRED",
        certified_at="2026-06-13T00:00:00Z",
        load_age_seconds=3600.0,
        data_age_seconds=7200.0,
        certification_run_id="mock-run-finance-invoices",
    ),
    decision="DENY",
    reasons=("EXPIRED",),
    recommended_action="Renew the certification of gold.finance_invoices before querying it.",
)

CATALOG: dict[str, Model] = {
    model.key: model for model in (SALES_ORDERS, SALES_CUSTOMERS, FINANCE_INVOICES)
}

STALE_ORDERS = Model(
    key="ops.stale_orders",
    description="Test fixture: certified but stale orders, triggering a WARN decision.",
    layer="gold",
    tags=("ops", "test-fixture"),
    dimensions=(Dimension("region", "string", ("EMEA", "NA", "APAC")),),
    metrics=(Metric("revenue", ("amount",)),),
    entities=("order",),
    related_models=(),
    periods=(),
    source=Source(
        dataset="gold.stale_orders",
        contract_id="stale_orders",
        contract_version="1.0.0",
        certification_status="CERTIFIED",
        certified_at=FROZEN_AT,
        load_age_seconds=3600.0,
        data_age_seconds=7200.0,
        certification_run_id="mock-run-stale-orders",
    ),
    decision="WARN",
    reasons=("DEPRECATED",),
    recommended_action=None,
)

PENDING_ORDERS = Model(
    key="ops.pending_orders",
    description="Test fixture: orders pending certification, triggering a REQUIRE_HUMAN decision.",
    layer="gold",
    tags=("ops", "test-fixture"),
    dimensions=(Dimension("region", "string", ("EMEA", "NA", "APAC")),),
    metrics=(Metric("revenue", ("amount",)),),
    entities=("order",),
    related_models=(),
    periods=(),
    source=Source(
        dataset="gold.pending_orders",
        contract_id="pending_orders",
        contract_version="1.0.0",
        certification_status="MISSING",
        certified_at=FROZEN_AT,
        load_age_seconds=3600.0,
        data_age_seconds=7200.0,
        certification_run_id="mock-run-pending-orders",
    ),
    decision="REQUIRE_HUMAN",
    reasons=("MISSING",),
    recommended_action="Get human sign-off before querying 'ops.pending_orders'.",
)

TEST_CATALOG: dict[str, Model] = {
    **CATALOG,
    STALE_ORDERS.key: STALE_ORDERS,
    PENDING_ORDERS.key: PENDING_ORDERS,
}
