"""Groupes de session en JSON (plan 07, 7.2).

Un tableau PostgreSQL écrit par pg8000 lisait un groupe nommé « null », quelle que soit sa
casse, comme un NULL SQL : le groupe était perdu. Le JSON garde chaque chaîne telle quelle.
En avant seulement (plan 07, P3).
"""

from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "sessions",
        "groups",
        type_=postgresql.JSONB(),
        postgresql_using="to_jsonb(groups)",
    )
