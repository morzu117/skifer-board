"""Registre descriptif des connexions, sans identifiants (plan 12, 12.1)."""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "logical_connections",
        sa.Column(
            "space_id",
            sa.String(40),
            sa.ForeignKey("spaces.id", name="fk_logical_connections_space"),
            nullable=False,
        ),
        sa.Column("name", sa.String(63), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_issuer", sa.Text(), nullable=False),
        sa.Column("created_by_subject", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("space_id", "name", name="pk_logical_connections"),
    )
    op.create_table(
        "connection_bindings",
        sa.Column("space_id", sa.String(40), nullable=False),
        sa.Column("name", sa.String(63), nullable=False),
        sa.Column("environment", sa.String(10), nullable=False),
        sa.Column("connector", sa.String(16), nullable=False),
        sa.Column("endpoint_key", sa.String(63), nullable=False),
        sa.Column("identity_mode", sa.String(16), nullable=False),
        sa.Column("set_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("set_by_issuer", sa.Text(), nullable=False),
        sa.Column("set_by_subject", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("space_id", "name", "environment", name="pk_connection_bindings"),
        sa.ForeignKeyConstraint(
            ["space_id", "name"],
            ["logical_connections.space_id", "logical_connections.name"],
            name="fk_connection_bindings_logical",
        ),
        sa.ForeignKeyConstraint(
            ["space_id", "environment"],
            ["space_environments.space_id", "space_environments.code"],
            name="fk_connection_bindings_environment",
        ),
    )
