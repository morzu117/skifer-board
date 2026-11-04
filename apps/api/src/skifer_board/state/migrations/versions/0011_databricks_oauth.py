"""Demandes et autorisations OAuth Databricks personnelles chiffrées (plan 15)."""

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "databricks_oauth",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("purpose", sa.String(16), nullable=False),
        sa.Column("client_id", sa.String(255), nullable=False),
        sa.Column(
            "space_id",
            sa.String(40),
            sa.ForeignKey("spaces.id", name="fk_databricks_oauth_space"),
            nullable=False,
        ),
        sa.Column("issuer", sa.Text(), nullable=False),
        sa.Column("subject", sa.Text(), nullable=False),
        sa.Column("host", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("key_id", sa.String(32), nullable=False),
        sa.Column("nonce", sa.LargeBinary(), nullable=False),
        sa.Column("ciphertext", sa.LargeBinary(), nullable=False),
    )
    op.create_index("ix_databricks_oauth_expires_at", "databricks_oauth", ["expires_at"])
