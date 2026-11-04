"""Points d'accès Databricks configurés dans Board (plan 14)."""

import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "connection_endpoints",
        sa.Column(
            "space_id",
            sa.String(40),
            sa.ForeignKey("spaces.id", name="fk_connection_endpoints_space"),
            nullable=False,
        ),
        sa.Column("key", sa.String(63), nullable=False),
        sa.Column("host", sa.Text(), nullable=False),
        sa.Column("warehouse_id", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_issuer", sa.Text(), nullable=False),
        sa.Column("created_by_subject", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("space_id", "key", name="pk_connection_endpoints"),
    )
