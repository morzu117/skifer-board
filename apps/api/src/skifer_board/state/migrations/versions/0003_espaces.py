"""Espaces, liaisons, personnes connues et journal (plan 08, 8.1).

En avant seulement (plan 07, P3).
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "spaces",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("atlas", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_issuer", sa.Text(), nullable=False),
        sa.Column("created_by_subject", sa.Text(), nullable=False),
    )
    op.create_table(
        "space_bindings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "space_id",
            sa.String(40),
            sa.ForeignKey("spaces.id", name="fk_space_bindings_space"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("group_name", sa.Text(), nullable=True),
        sa.Column("person_issuer", sa.Text(), nullable=True),
        sa.Column("person_subject", sa.Text(), nullable=True),
        sa.Column("principal_key", sa.Text(), nullable=False),
        sa.Column("role", sa.String(10), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_issuer", sa.Text(), nullable=False),
        sa.Column("created_by_subject", sa.Text(), nullable=False),
        sa.UniqueConstraint("space_id", "principal_key", name="uq_space_bindings_principal"),
    )
    op.create_index("ix_space_bindings_group", "space_bindings", ["group_name"])
    op.create_index(
        "ix_space_bindings_person", "space_bindings", ["person_issuer", "person_subject"]
    )
    op.create_table(
        "people",
        sa.Column("issuer", sa.Text(), nullable=False),
        sa.Column("subject", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("name_key", sa.Text(), nullable=True),
        sa.Column("email_key", sa.Text(), nullable=True),
        sa.Column("last_login", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("issuer", "subject", name="pk_people"),
    )
    op.create_table(
        "space_events",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "space_id",
            sa.String(40),
            sa.ForeignKey("spaces.id", name="fk_space_events_space"),
            nullable=False,
        ),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor_issuer", sa.Text(), nullable=False),
        sa.Column("actor_subject", sa.Text(), nullable=False),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("detail", postgresql.JSONB(), nullable=False),
    )
    op.create_index("ix_space_events_space", "space_events", ["space_id", "id"])
