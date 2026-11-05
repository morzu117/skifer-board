"""Événements d'usage des analyses versionnées (plan 18.3, A8).

Aucune personne, aucune valeur : de quoi compter et dater. Sans clé étrangère. En avant
seulement (plan 07, P3).
"""

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "analysis_events",
        sa.Column("event_id", sa.String(36), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("space_id", sa.String(40), nullable=False),
        sa.Column("analysis_id", sa.String(36), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("event_id", name="pk_analysis_events"),
    )
    op.create_index(
        "ix_analysis_events_analysis", "analysis_events", ["space_id", "analysis_id", "kind"]
    )
