"""Tables de l'état de Board, déclarées avec SQLAlchemy Core (plan 07, P2).

Les requêtes sont construites à partir de ces tables, jamais écrites en texte. Les
migrations Alembic les créent ; un test vérifie que migrations et déclarations concordent.
"""

from __future__ import annotations

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Double,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    MetaData,
    PrimaryKeyConstraint,
    SmallInteger,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB

metadata = MetaData()

# Une session : l'empreinte de son identifiant et l'identité vérifiée, jamais un jeton (P6).
sessions = Table(
    "sessions",
    metadata,
    Column("fingerprint", String(64), primary_key=True),
    Column("issuer", Text, nullable=False),
    Column("subject", Text, nullable=False),
    Column("name", Text, nullable=True),
    Column("email", Text, nullable=True),
    # JSON plutôt qu'un tableau : pg8000 y perdait un groupe nommé « null » (révision 0002).
    # `none_as_null` : `None` devient un NULL SQL, refusé, et non la valeur JSON `null`.
    Column("groups", JSONB(none_as_null=True), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("last_seen", DateTime(timezone=True), nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Index("ix_sessions_expires_at", "expires_at"),
)

# Une demande de connexion en cours, consommée une seule fois au retour (P7).
login_requests = Table(
    "login_requests",
    metadata,
    Column("state_fingerprint", String(64), primary_key=True),
    Column("nonce", Text, nullable=False),
    Column("verifier", Text, nullable=False),
    Column("binding_fingerprint", String(64), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Index("ix_login_requests_created_at", "created_at"),
)

# Un espace : identifiant stable, nom affiché, rattachement Atlas (plan 08, E1).
spaces = Table(
    "spaces",
    metadata,
    Column("id", String(40), primary_key=True),
    Column("name", Text, nullable=False),
    Column("atlas", Text, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("created_by_issuer", Text, nullable=False),
    Column("created_by_subject", Text, nullable=False),
)

# Une liaison : un groupe ou une personne, un rôle, dans un espace (E3). `principal_key`
# rend unique la liaison d'un même groupe ou d'une même personne dans un espace.
space_bindings = Table(
    "space_bindings",
    metadata,
    Column("id", String(36), primary_key=True),
    Column(
        "space_id",
        String(40),
        ForeignKey("spaces.id", name="fk_space_bindings_space"),
        nullable=False,
    ),
    Column("kind", String(10), nullable=False),
    Column("group_name", Text, nullable=True),
    Column("person_issuer", Text, nullable=True),
    Column("person_subject", Text, nullable=True),
    Column("principal_key", Text, nullable=False),
    Column("role", String(10), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("created_by_issuer", Text, nullable=False),
    Column("created_by_subject", Text, nullable=False),
    UniqueConstraint("space_id", "principal_key", name="uq_space_bindings_principal"),
    Index("ix_space_bindings_group", "group_name"),
    Index("ix_space_bindings_person", "person_issuer", "person_subject"),
)

# Environnements d'un espace, dans leur ordre de promotion (plan 09, V1).
space_environments = Table(
    "space_environments",
    metadata,
    Column(
        "space_id",
        String(40),
        ForeignKey("spaces.id", name="fk_space_environments_space"),
        nullable=False,
    ),
    Column("code", String(10), nullable=False),
    Column("position", SmallInteger, nullable=False),
    PrimaryKeyConstraint("space_id", "code", name="pk_space_environments"),
    UniqueConstraint("space_id", "position", name="uq_space_environments_position"),
)

# Accord du droit de déployer : un groupe ou une personne, dans un environnement d'un espace
# (plan 09, V3). `principal_key` rend l'accord unique par environnement.
deploy_grants = Table(
    "deploy_grants",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("space_id", String(40), nullable=False),
    Column("environment", String(10), nullable=False),
    Column("kind", String(10), nullable=False),
    Column("group_name", Text, nullable=True),
    Column("person_issuer", Text, nullable=True),
    Column("person_subject", Text, nullable=True),
    Column("principal_key", Text, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("created_by_issuer", Text, nullable=False),
    Column("created_by_subject", Text, nullable=False),
    ForeignKeyConstraint(
        ["space_id", "environment"],
        ["space_environments.space_id", "space_environments.code"],
        name="fk_deploy_grants_environment",
    ),
    UniqueConstraint("space_id", "environment", "principal_key", name="uq_deploy_grants_principal"),
    Index("ix_deploy_grants_group", "group_name"),
    Index("ix_deploy_grants_person", "person_issuer", "person_subject"),
)

# Paramètres de déploiement déclarés dans un espace (plan 10, P1 à P3). Le nom est immuable ;
# type, contraintes et défaut sont des données typées en JSON, jamais du texte interprété.
deploy_parameters = Table(
    "deploy_parameters",
    metadata,
    Column(
        "space_id",
        String(40),
        ForeignKey("spaces.id", name="fk_deploy_parameters_space"),
        nullable=False,
    ),
    Column("name", String(63), nullable=False),
    Column("type", String(16), nullable=False),
    Column("constraints", JSONB(none_as_null=True), nullable=False),
    Column("required", Boolean, nullable=False),
    Column("default_value", JSONB(none_as_null=True), nullable=True),
    Column("description", Text, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("created_by_issuer", Text, nullable=False),
    Column("created_by_subject", Text, nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
    Column("updated_by_issuer", Text, nullable=False),
    Column("updated_by_subject", Text, nullable=False),
    PrimaryKeyConstraint("space_id", "name", name="pk_deploy_parameters"),
)

# Valeur propre d'un paramètre dans un environnement de son espace (plan 10, P4) : une au plus.
parameter_values = Table(
    "parameter_values",
    metadata,
    Column("space_id", String(40), nullable=False),
    Column("name", String(63), nullable=False),
    Column("environment", String(10), nullable=False),
    Column("value", JSONB(none_as_null=True), nullable=False),
    Column("set_at", DateTime(timezone=True), nullable=False),
    Column("set_by_issuer", Text, nullable=False),
    Column("set_by_subject", Text, nullable=False),
    PrimaryKeyConstraint("space_id", "name", "environment", name="pk_parameter_values"),
    ForeignKeyConstraint(
        ["space_id", "name"],
        ["deploy_parameters.space_id", "deploy_parameters.name"],
        name="fk_parameter_values_parameter",
    ),
    ForeignKeyConstraint(
        ["space_id", "environment"],
        ["space_environments.space_id", "space_environments.code"],
        name="fk_parameter_values_environment",
    ),
)

# Personnes connues, enregistrées à la connexion ; leurs groupes ne sont pas gardés (E5).
people = Table(
    "people",
    metadata,
    Column("issuer", Text, nullable=False),
    Column("subject", Text, nullable=False),
    Column("name", Text, nullable=True),
    Column("email", Text, nullable=True),
    # Clés de recherche repliées par Board (NFC puis casefold) : la recherche ne dépend pas
    # de la locale de la base, où `ILIKE` ne replie que la casse ASCII.
    Column("name_key", Text, nullable=True),
    Column("email_key", Text, nullable=True),
    Column("last_login", DateTime(timezone=True), nullable=False),
    PrimaryKeyConstraint("issuer", "subject", name="pk_people"),
)

# Journal des espaces, en ajout seul (E10).
space_events = Table(
    "space_events",
    metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column(
        "space_id",
        String(40),
        ForeignKey("spaces.id", name="fk_space_events_space"),
        nullable=False,
    ),
    Column("at", DateTime(timezone=True), nullable=False),
    Column("actor_issuer", Text, nullable=False),
    Column("actor_subject", Text, nullable=False),
    Column("action", String(40), nullable=False),
    Column("detail", JSONB(none_as_null=True), nullable=False),
    Index("ix_space_events_space", "space_id", "id"),
)

# Mesures de télémétrie (plan 11, T1 à T3) : une liste fermée de champs, ni personne, ni chemin
# brut, ni valeur. Aucune clé étrangère : une mesure survit à l'espace retiré, et son écriture
# ne dépend d'aucune autre table.
telemetry = Table(
    "telemetry",
    metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("at", DateTime(timezone=True), nullable=False),
    Column("kind", String(16), nullable=False),
    Column("operation", String(200), nullable=False),
    Column("method", String(10), nullable=True),
    Column("status", SmallInteger, nullable=True),
    Column("outcome", String(40), nullable=False),
    Column("space_id", String(40), nullable=True),
    Column("environment", String(10), nullable=True),
    Column("duration_ms", Double, nullable=False),
    Column("rows", BigInteger, nullable=True),
    Column("size", BigInteger, nullable=True),
    Index("ix_telemetry_at", "at"),
)
