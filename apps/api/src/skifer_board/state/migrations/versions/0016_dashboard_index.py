"""Index des dashboards et de leurs références d'analyses (plan 19.2, B5).

Tables reconstructibles depuis git (`skifer-board-reindex`) : elles ne sont jamais la source d'un
contenu. L'index est sans clé étrangère vers les espaces ; les références n'existent que par leur
ligne d'index (suppression en cascade). En avant seulement (plan 07, P3).
"""

import sqlalchemy as sa
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dashboard_index",
        sa.Column("space_id", sa.String(40), nullable=False),
        sa.Column("dashboard_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("owner_issuer", sa.Text(), nullable=False),
        sa.Column("owner_subject", sa.Text(), nullable=False),
        sa.Column("visibility", sa.String(8), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("commit", sa.String(64), nullable=False),
        sa.Column("committed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("state", sa.String(24), nullable=False),
        sa.Column("indexed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("space_id", "dashboard_id", name="pk_dashboard_index"),
    )
    op.create_index("ix_dashboard_index_visibility", "dashboard_index", ["space_id", "visibility"])
    op.create_table(
        "dashboard_references",
        sa.Column("space_id", sa.String(40), nullable=False),
        sa.Column("dashboard_id", sa.String(36), nullable=False),
        sa.Column("component_id", sa.String(36), nullable=False),
        sa.Column("analysis_id", sa.String(36), nullable=False),
        sa.Column("analysis_revision", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint(
            "space_id", "dashboard_id", "component_id", name="pk_dashboard_references"
        ),
        sa.ForeignKeyConstraint(
            ["space_id", "dashboard_id"],
            ["dashboard_index.space_id", "dashboard_index.dashboard_id"],
            name="fk_dashboard_references_dashboard",
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_dashboard_references_analysis", "dashboard_references", ["space_id", "analysis_id"]
    )
