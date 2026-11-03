"""Mesures de télémétrie (plan 11, 11.1).

Table en ajout seul, purgée après 90 jours (T6), sans clé étrangère. En avant seulement
(plan 07, P3).
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "telemetry",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("operation", sa.String(200), nullable=False),
        sa.Column("method", sa.String(10), nullable=True),
        sa.Column("status", sa.SmallInteger(), nullable=True),
        sa.Column("outcome", sa.String(40), nullable=False),
        sa.Column("space_id", sa.String(40), nullable=True),
        sa.Column("environment", sa.String(10), nullable=True),
        sa.Column("duration_ms", sa.Double(), nullable=False),
        sa.Column("rows", sa.BigInteger(), nullable=True),
        sa.Column("size", sa.BigInteger(), nullable=True),
    )
    op.create_index("ix_telemetry_at", "telemetry", ["at"])
