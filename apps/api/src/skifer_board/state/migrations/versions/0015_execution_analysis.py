"""Référence d'analyse portée par une exécution (plan 18.3b).

Deux identifiants, jamais le nom ni le contenu de l'analyse : de quoi retrouver, pour la
personne qui a exécuté, sa dernière exécution d'une analyse. En avant seulement (plan 07, P3).
"""

import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("executions", sa.Column("analysis_id", sa.String(36), nullable=True))
    op.add_column("executions", sa.Column("analysis_revision", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "ck_executions_analysis",
        "executions",
        "(analysis_id IS NULL) = (analysis_revision IS NULL)",
    )
    op.create_index(
        "ix_executions_analysis",
        "executions",
        ["space_id", "analysis_id", "issuer", "subject", "created_at"],
    )
