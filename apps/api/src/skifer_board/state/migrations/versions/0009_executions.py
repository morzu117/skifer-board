"""Exécutions suivies, état et résultat borné (plan 12, 12.5a)."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "executions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "space_id",
            sa.String(40),
            sa.ForeignKey("spaces.id", name="fk_executions_space"),
            nullable=False,
        ),
        sa.Column("environment", sa.String(10), nullable=False),
        sa.Column("issuer", sa.Text(), nullable=False),
        sa.Column("subject", sa.Text(), nullable=False),
        sa.Column("connection_name", sa.String(63), nullable=False),
        sa.Column("request_hash", sa.String(80), nullable=False),
        sa.Column("connector", sa.String(16), nullable=False),
        sa.Column("endpoint_key", sa.String(63), nullable=False),
        sa.Column("identity_mode", sa.String(16), nullable=False),
        sa.Column("binding_set_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deadline_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=False),
        sa.Column("owner_id", sa.String(36), nullable=False),
        sa.Column("connector_run_id", sa.String(36), nullable=True),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False),
        sa.Column("error_code", sa.String(40), nullable=True),
        sa.Column("evidence", JSONB(none_as_null=True), nullable=True),
        sa.Column("result", sa.LargeBinary(), nullable=True),
        sa.Column("row_count", sa.BigInteger(), nullable=True),
        sa.Column("byte_count", sa.BigInteger(), nullable=True),
        sa.Column("truncated", sa.Boolean(), nullable=True),
    )
    op.create_index(
        "ix_executions_reader", "executions", ["space_id", "issuer", "subject", "created_at"]
    )
    op.create_index("ix_executions_lease", "executions", ["state", "lease_until"])
