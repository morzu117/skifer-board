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
    Integer,
    LargeBinary,
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

# Registre de connexions du lot 03 (plan 12, 12.1). Ces tables ne contiennent aucun secret :
# endpoint_key désigne une configuration autorisée côté serveur, jamais une URL du navigateur.
logical_connections = Table(
    "logical_connections",
    metadata,
    Column(
        "space_id",
        String(40),
        ForeignKey("spaces.id", name="fk_logical_connections_space"),
        nullable=False,
    ),
    Column("name", String(63), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("created_by_issuer", Text, nullable=False),
    Column("created_by_subject", Text, nullable=False),
    PrimaryKeyConstraint("space_id", "name", name="pk_logical_connections"),
)

# Points d'accès Databricks saisis dans Board, propres à un espace (plan 14).
# L'hôte et le warehouse sont descriptifs ; aucun identifiant n'est stocké ici.
connection_endpoints = Table(
    "connection_endpoints",
    metadata,
    Column(
        "space_id",
        String(40),
        ForeignKey("spaces.id", name="fk_connection_endpoints_space"),
        nullable=False,
    ),
    Column("key", String(63), nullable=False),
    Column("host", Text, nullable=False),
    Column("warehouse_id", String(64), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("created_by_issuer", Text, nullable=False),
    Column("created_by_subject", Text, nullable=False),
    PrimaryKeyConstraint("space_id", "key", name="pk_connection_endpoints"),
)

connection_bindings = Table(
    "connection_bindings",
    metadata,
    Column("space_id", String(40), nullable=False),
    Column("name", String(63), nullable=False),
    Column("environment", String(10), nullable=False),
    Column("connector", String(16), nullable=False),
    Column("endpoint_key", String(63), nullable=False),
    Column("identity_mode", String(16), nullable=False),
    Column("set_at", DateTime(timezone=True), nullable=False),
    Column("set_by_issuer", Text, nullable=False),
    Column("set_by_subject", Text, nullable=False),
    PrimaryKeyConstraint("space_id", "name", "environment", name="pk_connection_bindings"),
    ForeignKeyConstraint(
        ["space_id", "name"],
        ["logical_connections.space_id", "logical_connections.name"],
        name="fk_connection_bindings_logical",
    ),
    ForeignKeyConstraint(
        ["space_id", "environment"],
        ["space_environments.space_id", "space_environments.code"],
        name="fk_connection_bindings_environment",
    ),
)

# Identifiants serveur : seul le coffre déchiffre ces octets (plan 12, 12.2).
connection_credentials = Table(
    "connection_credentials",
    metadata,
    Column("space_id", String(40), nullable=False),
    Column("name", String(63), nullable=False),
    Column("environment", String(10), nullable=False),
    Column("key_id", String(32), nullable=False),
    Column("nonce", LargeBinary, nullable=False),
    Column("ciphertext", LargeBinary, nullable=False),
    Column("set_at", DateTime(timezone=True), nullable=False),
    Column("set_by_issuer", Text, nullable=False),
    Column("set_by_subject", Text, nullable=False),
    PrimaryKeyConstraint("space_id", "name", "environment", name="pk_connection_credentials"),
    ForeignKeyConstraint(
        ["space_id", "name", "environment"],
        [
            "connection_bindings.space_id",
            "connection_bindings.name",
            "connection_bindings.environment",
        ],
        name="fk_connection_credentials_binding",
    ),
)

# Exécutions suivies (plan 12, 12.5a). Le résultat Arrow et la preuve expurgée sont
# conservés sous plafonds ; la demande brute, le SQL et le secret ne le sont jamais.
executions = Table(
    "executions",
    metadata,
    Column("id", String(36), primary_key=True),
    Column(
        "space_id", String(40), ForeignKey("spaces.id", name="fk_executions_space"), nullable=False
    ),
    Column("environment", String(10), nullable=False),
    Column("issuer", Text, nullable=False),
    Column("subject", Text, nullable=False),
    Column("connection_name", String(63), nullable=False),
    Column("request_hash", String(80), nullable=False),
    Column("connector", String(16), nullable=False),
    Column("endpoint_key", String(63), nullable=False),
    Column("identity_mode", String(16), nullable=False),
    Column("binding_set_at", DateTime(timezone=True), nullable=False),
    Column("state", String(16), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("started_at", DateTime(timezone=True), nullable=True),
    Column("finished_at", DateTime(timezone=True), nullable=True),
    Column("deadline_at", DateTime(timezone=True), nullable=False),
    Column("lease_until", DateTime(timezone=True), nullable=False),
    Column("owner_id", String(36), nullable=False),
    Column("connector_run_id", String(36), nullable=True),
    Column("cancel_requested", Boolean, nullable=False),
    Column("error_code", String(40), nullable=True),
    Column("evidence", JSONB(none_as_null=True), nullable=True),
    Column("result_contract", JSONB(none_as_null=True), nullable=True),
    Column("result", LargeBinary, nullable=True),
    Column("row_count", BigInteger, nullable=True),
    Column("byte_count", BigInteger, nullable=True),
    Column("truncated", Boolean, nullable=True),
    Index("ix_executions_reader", "space_id", "issuer", "subject", "created_at"),
    Index("ix_executions_lease", "state", "lease_until"),
)

# États PKCE et autorisations personnelles Databricks ; secrets intégralement chiffrés.
databricks_oauth = Table(
    "databricks_oauth",
    metadata,
    Column("id", String(64), primary_key=True),
    Column("purpose", String(16), nullable=False),
    Column("client_id", String(255), nullable=False),
    Column(
        "space_id",
        String(40),
        ForeignKey("spaces.id", name="fk_databricks_oauth_space"),
        nullable=False,
    ),
    Column("issuer", Text, nullable=False),
    Column("subject", Text, nullable=False),
    Column("host", Text, nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("key_id", String(32), nullable=False),
    Column("nonce", LargeBinary, nullable=False),
    Column("ciphertext", LargeBinary, nullable=False),
    Index("ix_databricks_oauth_expires_at", "expires_at"),
)

# Index des analyses versionnées (plan 18, A4) : une ligne par analyse existante, reconstruite
# depuis git par `skifer-board-reindex`. Il ne contient ni requête, ni filtre, ni calcul, ni
# description : le contenu servi vient toujours de git, l'index ne sert qu'à lister et à
# repérer un écart (`commit` n'est plus le dernier commit du fichier : `index_stale`). Aucune
# clé étrangère : git peut porter un espace que la base ne connaît pas, et l'ordre de
# reconstruction ne doit rien changer.
analysis_index = Table(
    "analysis_index",
    metadata,
    Column("space_id", String(40), nullable=False),
    Column("analysis_id", String(36), nullable=False),
    Column("name", String(120), nullable=False),
    Column("owner_issuer", Text, nullable=False),
    Column("owner_subject", Text, nullable=False),
    Column("visibility", String(8), nullable=False),
    Column("revision", Integer, nullable=False),
    Column("commit", String(64), nullable=False),
    Column("committed_at", DateTime(timezone=True), nullable=False),
    Column("model", String(80), nullable=False),
    Column("metrics", JSONB(none_as_null=True), nullable=False),
    Column("state", String(24), nullable=False),
    Column("indexed_at", DateTime(timezone=True), nullable=False),
    PrimaryKeyConstraint("space_id", "analysis_id", name="pk_analysis_index"),
    Index("ix_analysis_index_visibility", "space_id", "visibility"),
)
