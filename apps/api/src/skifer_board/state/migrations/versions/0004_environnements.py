"""Environnements des espaces et accords du droit de déployer (plan 09, 9.1).

Chaque espace existant reçoit ses trois environnements, `DEV`, `TEST` et `PROD` (V1). En
avant seulement (plan 07, P3).
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

ENVIRONMENTS = ("DEV", "TEST", "PROD")


def upgrade() -> None:
    environments = op.create_table(
        "space_environments",
        sa.Column(
            "space_id",
            sa.String(40),
            sa.ForeignKey("spaces.id", name="fk_space_environments_space"),
            nullable=False,
        ),
        sa.Column("code", sa.String(10), nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.PrimaryKeyConstraint("space_id", "code", name="pk_space_environments"),
        sa.UniqueConstraint("space_id", "position", name="uq_space_environments_position"),
    )
    op.create_table(
        "deploy_grants",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("space_id", sa.String(40), nullable=False),
        sa.Column("environment", sa.String(10), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("group_name", sa.Text(), nullable=True),
        sa.Column("person_issuer", sa.Text(), nullable=True),
        sa.Column("person_subject", sa.Text(), nullable=True),
        sa.Column("principal_key", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_issuer", sa.Text(), nullable=False),
        sa.Column("created_by_subject", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["space_id", "environment"],
            ["space_environments.space_id", "space_environments.code"],
            name="fk_deploy_grants_environment",
        ),
        sa.UniqueConstraint(
            "space_id", "environment", "principal_key", name="uq_deploy_grants_principal"
        ),
    )
    op.create_index("ix_deploy_grants_group", "deploy_grants", ["group_name"])
    op.create_index("ix_deploy_grants_person", "deploy_grants", ["person_issuer", "person_subject"])
    # Requêtes construites, jamais écrites en texte : un `INSERT … SELECT` par environnement.
    spaces = sa.table("spaces", sa.column("id", sa.String(40)))
    for position, code in enumerate(ENVIRONMENTS, start=1):
        op.execute(
            sa.insert(environments).from_select(
                ["space_id", "code", "position"],
                sa.select(
                    spaces.c.id,
                    sa.literal(code, sa.String(10)),
                    sa.literal(position, sa.SmallInteger()),
                ),
            )
        )
