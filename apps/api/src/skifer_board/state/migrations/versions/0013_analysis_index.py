"""Index des analyses versionnées (plan 18.2, A4).

Table reconstructible depuis git (`skifer-board-reindex`) : elle n'est jamais la source d'un
contenu. Sans clé étrangère. En avant seulement (plan 07, P3).
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "analysis_index",
        sa.Column("space_id", sa.String(40), nullable=False),
        sa.Column("analysis_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("owner_issuer", sa.Text(), nullable=False),
        sa.Column("owner_subject", sa.Text(), nullable=False),
        sa.Column("visibility", sa.String(8), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("commit", sa.String(64), nullable=False),
        sa.Column("committed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("model", sa.String(80), nullable=False),
        sa.Column("metrics", JSONB(none_as_null=True), nullable=False),
        sa.Column("state", sa.String(24), nullable=False),
        sa.Column("indexed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("space_id", "analysis_id", name="pk_analysis_index"),
    )
    op.create_index("ix_analysis_index_visibility", "analysis_index", ["space_id", "visibility"])
