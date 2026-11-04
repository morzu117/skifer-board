"""Paramètres de déploiement des espaces et leurs valeurs par environnement (plan 10, 10.1).

Aucune donnée existante n'est reprise : un espace migré n'a encore aucun paramètre. En avant
seulement (plan 07, P3).
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "deploy_parameters",
        sa.Column(
            "space_id",
            sa.String(40),
            sa.ForeignKey("spaces.id", name="fk_deploy_parameters_space"),
            nullable=False,
        ),
        sa.Column("name", sa.String(63), nullable=False),
        sa.Column("type", sa.String(16), nullable=False),
        sa.Column("constraints", postgresql.JSONB(), nullable=False),
        sa.Column("required", sa.Boolean(), nullable=False),
        sa.Column("default_value", postgresql.JSONB(), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_issuer", sa.Text(), nullable=False),
        sa.Column("created_by_subject", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by_issuer", sa.Text(), nullable=False),
        sa.Column("updated_by_subject", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("space_id", "name", name="pk_deploy_parameters"),
    )
    op.create_table(
        "parameter_values",
        sa.Column("space_id", sa.String(40), nullable=False),
        sa.Column("name", sa.String(63), nullable=False),
        sa.Column("environment", sa.String(10), nullable=False),
        sa.Column("value", postgresql.JSONB(), nullable=False),
        sa.Column("set_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("set_by_issuer", sa.Text(), nullable=False),
        sa.Column("set_by_subject", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("space_id", "name", "environment", name="pk_parameter_values"),
        sa.ForeignKeyConstraint(
            ["space_id", "name"],
            ["deploy_parameters.space_id", "deploy_parameters.name"],
            name="fk_parameter_values_parameter",
        ),
        sa.ForeignKeyConstraint(
            ["space_id", "environment"],
            ["space_environments.space_id", "space_environments.code"],
            name="fk_parameter_values_environment",
        ),
    )
