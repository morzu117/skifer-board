"""${message}

Révision ${up_revision}, après ${down_revision | comma,n}. En avant seulement (plan 07, P3).
"""

from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = None
depends_on = None


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}
