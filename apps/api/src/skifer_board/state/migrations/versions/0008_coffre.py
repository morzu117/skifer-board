"""Coffre des identifiants de connexion (plan 12, 12.2)."""

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "connection_credentials",
        sa.Column("space_id", sa.String(40), nullable=False),
        sa.Column("name", sa.String(63), nullable=False),
        sa.Column("environment", sa.String(10), nullable=False),
        sa.Column("key_id", sa.String(32), nullable=False),
        sa.Column("nonce", sa.LargeBinary(), nullable=False),
        sa.Column("ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("set_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("set_by_issuer", sa.Text(), nullable=False),
        sa.Column("set_by_subject", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint(
            "space_id", "name", "environment", name="pk_connection_credentials"
        ),
        sa.ForeignKeyConstraint(
            ["space_id", "name", "environment"],
            [
                "connection_bindings.space_id",
                "connection_bindings.name",
                "connection_bindings.environment",
            ],
            name="fk_connection_credentials_binding",
        ),
    )
