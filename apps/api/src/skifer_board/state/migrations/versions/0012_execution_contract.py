"""Contrat de calcul figé à la soumission (plan 17.3)."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "executions", sa.Column("result_contract", JSONB(none_as_null=True), nullable=True)
    )
