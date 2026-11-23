"""Index des thèmes, modèles, composants, approbations et références (plan 20.2).

Tables reconstructibles depuis git : elles ne sont jamais la source d'un contenu. L'index et
les approbations sont sans clé étrangère vers les espaces ; les références des dashboards
n'existent que par leur ligne d'index (suppression en cascade). En avant seulement (plan 07, P3).
"""

import sqlalchemy as sa
from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shared_content_index",
        sa.Column("kind", sa.String(13), nullable=False),
        sa.Column("space_id", sa.String(40), nullable=False),
        sa.Column("content_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("owner_issuer", sa.Text(), nullable=False),
        sa.Column("owner_subject", sa.Text(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("commit", sa.String(64), nullable=False),
        sa.Column("committed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("approved_revision", sa.Integer(), nullable=True),
        sa.Column("component_kind", sa.String(6), nullable=True),
        sa.Column("analysis_id", sa.String(36), nullable=True),
        sa.Column("analysis_revision", sa.Integer(), nullable=True),
        sa.Column("indexed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("kind", "space_id", "content_id", name="pk_shared_content_index"),
        sa.CheckConstraint(
            "kind IN ('theme', 'page_template', 'component')", name="ck_shared_content_kind"
        ),
        sa.CheckConstraint(
            "(kind = 'component' AND component_kind IS NOT NULL "
            "AND component_kind IN ('visual', 'kpi') "
            "AND analysis_id IS NOT NULL AND analysis_revision IS NOT NULL) OR "
            "(kind <> 'component' AND component_kind IS NULL AND analysis_id IS NULL "
            "AND analysis_revision IS NULL)",
            name="ck_shared_content_component",
        ),
    )
    op.create_index("ix_shared_content_space", "shared_content_index", ["space_id", "kind"])
    op.create_table(
        "content_approvals",
        sa.Column("kind", sa.String(13), nullable=False),
        sa.Column("space_id", sa.String(40), nullable=False),
        sa.Column("content_id", sa.String(36), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("issuer", sa.Text(), nullable=False),
        sa.Column("subject", sa.Text(), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint(
            "kind", "space_id", "content_id", "revision", name="pk_content_approvals"
        ),
        sa.CheckConstraint(
            "kind IN ('theme', 'page_template', 'component')", name="ck_content_approvals_kind"
        ),
    )
    op.create_table(
        "dashboard_theme_references",
        sa.Column("space_id", sa.String(40), nullable=False),
        sa.Column("dashboard_id", sa.String(36), nullable=False),
        sa.Column("theme_id", sa.String(36), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("space_id", "dashboard_id", name="pk_dashboard_theme_references"),
        sa.ForeignKeyConstraint(
            ["space_id", "dashboard_id"],
            ["dashboard_index.space_id", "dashboard_index.dashboard_id"],
            name="fk_dashboard_theme_references_dashboard",
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_dashboard_theme_consumers",
        "dashboard_theme_references",
        ["space_id", "theme_id", "revision"],
    )
    op.create_table(
        "dashboard_component_references",
        sa.Column("space_id", sa.String(40), nullable=False),
        sa.Column("dashboard_id", sa.String(36), nullable=False),
        sa.Column("component_id", sa.String(36), nullable=False),
        sa.Column("component_ref_id", sa.String(36), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint(
            "space_id", "dashboard_id", "component_id", name="pk_dashboard_component_references"
        ),
        sa.ForeignKeyConstraint(
            ["space_id", "dashboard_id"],
            ["dashboard_index.space_id", "dashboard_index.dashboard_id"],
            name="fk_dashboard_component_references_dashboard",
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_dashboard_component_consumers",
        "dashboard_component_references",
        ["space_id", "component_ref_id", "revision"],
    )
