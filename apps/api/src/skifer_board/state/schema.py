"""Tables de l'état de Board, déclarées avec SQLAlchemy Core (plan 07, P2).

Les requêtes sont construites à partir de ces tables, jamais écrites en texte. Les
migrations Alembic les créent ; un test vérifie que migrations et déclarations concordent.
"""

from __future__ import annotations

from sqlalchemy import Column, DateTime, Index, MetaData, String, Table, Text
from sqlalchemy.dialects.postgresql import ARRAY

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
    Column("groups", ARRAY(Text), nullable=False),
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
