"""Migrations en avant seulement et schéma conforme aux déclarations (plan 07, P2, P3, P8)."""

from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from skifer_board.state import (
    current_revision,
    head_revision,
    known_revisions,
    login_requests,
    metadata,
    sessions,
    upgrade,
)
from skifer_board.state.database import MIGRATIONS, _scripts
from sqlalchemy import DateTime, Engine, func, inspect, select
from sqlalchemy.exc import DBAPIError, IntegrityError

INSTANT = datetime(2026, 1, 15, 12, tzinfo=UTC)

COLONNES = {
    "databricks_oauth": {
        "id": False,
        "purpose": False,
        "client_id": False,
        "space_id": False,
        "issuer": False,
        "subject": False,
        "host": False,
        "expires_at": False,
        "key_id": False,
        "nonce": False,
        "ciphertext": False,
    },
    "sessions": {
        "fingerprint": False,
        "issuer": False,
        "subject": False,
        "name": True,
        "email": True,
        "groups": False,
        "created_at": False,
        "last_seen": False,
        "expires_at": False,
    },
    "login_requests": {
        "state_fingerprint": False,
        "nonce": False,
        "verifier": False,
        "binding_fingerprint": False,
        "created_at": False,
    },
    # Espaces, liaisons, personnes connues et journal (plan 08, 8.1, révision 0003).
    "spaces": {
        "id": False,
        "name": False,
        "atlas": False,
        "created_at": False,
        "created_by_issuer": False,
        "created_by_subject": False,
    },
    "space_bindings": {
        "id": False,
        "space_id": False,
        "kind": False,
        "group_name": True,
        "person_issuer": True,
        "person_subject": True,
        "principal_key": False,
        "role": False,
        "created_at": False,
        "created_by_issuer": False,
        "created_by_subject": False,
    },
    "people": {
        "issuer": False,
        "subject": False,
        "name": True,
        "email": True,
        "name_key": True,
        "email_key": True,
        "last_login": False,
    },
    "space_events": {
        "id": False,
        "space_id": False,
        "at": False,
        "actor_issuer": False,
        "actor_subject": False,
        "action": False,
        "detail": False,
    },
    # Environnements des espaces et accords du droit de déployer (plan 09, 9.1, révision 0004).
    "space_environments": {
        "space_id": False,
        "code": False,
        "position": False,
    },
    "deploy_grants": {
        "id": False,
        "space_id": False,
        "environment": False,
        "kind": False,
        "group_name": True,
        "person_issuer": True,
        "person_subject": True,
        "principal_key": False,
        "created_at": False,
        "created_by_issuer": False,
        "created_by_subject": False,
    },
    # Paramètres de déploiement et leurs valeurs par environnement (plan 10, 10.1, révision 0005).
    "deploy_parameters": {
        "space_id": False,
        "name": False,
        "type": False,
        "constraints": False,
        "required": False,
        "default_value": True,
        "description": False,
        "created_at": False,
        "created_by_issuer": False,
        "created_by_subject": False,
        "updated_at": False,
        "updated_by_issuer": False,
        "updated_by_subject": False,
    },
    "parameter_values": {
        "space_id": False,
        "name": False,
        "environment": False,
        "value": False,
        "set_at": False,
        "set_by_issuer": False,
        "set_by_subject": False,
    },
    # Mesures de télémétrie (plan 11, 11.1, révision 0006).
    "telemetry": {
        "id": False,
        "at": False,
        "kind": False,
        "operation": False,
        "method": True,
        "status": True,
        "outcome": False,
        "space_id": True,
        "environment": True,
        "duration_ms": False,
        "rows": True,
        "size": True,
    },
    "logical_connections": {
        "space_id": False,
        "name": False,
        "created_at": False,
        "created_by_issuer": False,
        "created_by_subject": False,
    },
    "connection_endpoints": {
        "space_id": False,
        "key": False,
        "host": False,
        "warehouse_id": False,
        "created_at": False,
        "created_by_issuer": False,
        "created_by_subject": False,
    },
    "connection_bindings": {
        "space_id": False,
        "name": False,
        "environment": False,
        "connector": False,
        "endpoint_key": False,
        "identity_mode": False,
        "set_at": False,
        "set_by_issuer": False,
        "set_by_subject": False,
    },
    "connection_credentials": {
        "space_id": False,
        "name": False,
        "environment": False,
        "key_id": False,
        "nonce": False,
        "ciphertext": False,
        "set_at": False,
        "set_by_issuer": False,
        "set_by_subject": False,
    },
    "executions": {
        "id": False,
        "space_id": False,
        "environment": False,
        "issuer": False,
        "subject": False,
        "connection_name": False,
        "request_hash": False,
        "connector": False,
        "endpoint_key": False,
        "identity_mode": False,
        "binding_set_at": False,
        "state": False,
        "created_at": False,
        "started_at": True,
        "finished_at": True,
        "deadline_at": False,
        "lease_until": False,
        "owner_id": False,
        "connector_run_id": True,
        "cancel_requested": False,
        "error_code": True,
        "evidence": True,
        "result": True,
        "row_count": True,
        "byte_count": True,
        "truncated": True,
    },
}
INSTANTS = {
    "databricks_oauth": ["expires_at"],
    "sessions": {"created_at", "last_seen", "expires_at"},
    "login_requests": {"created_at"},
    "spaces": {"created_at"},
    "space_bindings": {"created_at"},
    "people": {"last_login"},
    "space_events": {"at"},
    "space_environments": set(),
    "deploy_grants": {"created_at"},
    "deploy_parameters": {"created_at", "updated_at"},
    "parameter_values": {"set_at"},
    "telemetry": {"at"},
    "logical_connections": {"created_at"},
    "connection_endpoints": {"created_at"},
    "connection_bindings": {"set_at"},
    "connection_credentials": {"set_at"},
    "executions": {
        "binding_set_at",
        "created_at",
        "started_at",
        "finished_at",
        "deadline_at",
        "lease_until",
    },
}
CLES = {
    "databricks_oauth": ["id"],
    "sessions": ["fingerprint"],
    "login_requests": ["state_fingerprint"],
    "spaces": ["id"],
    "space_bindings": ["id"],
    "people": ["issuer", "subject"],
    "space_events": ["id"],
    "space_environments": ["space_id", "code"],
    "deploy_grants": ["id"],
    "deploy_parameters": ["space_id", "name"],
    "parameter_values": ["space_id", "name", "environment"],
    "telemetry": ["id"],
    "logical_connections": ["space_id", "name"],
    "connection_endpoints": ["space_id", "key"],
    "connection_bindings": ["space_id", "name", "environment"],
    "connection_credentials": ["space_id", "name", "environment"],
    "executions": ["id"],
}
TABLES = {*COLONNES, "alembic_version"}


def session(empreinte: str = "a" * 64) -> dict[str, object]:
    return {
        "fingerprint": empreinte,
        "issuer": "https://id.example.invalid",
        "subject": "sujet",
        "name": "Nom",
        "email": "personne@example.invalid",
        "groups": ["lecteurs", "auteurs"],
        "created_at": INSTANT,
        "last_seen": INSTANT,
        "expires_at": INSTANT + timedelta(hours=8),
    }


def tables(engine: Engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def forme(engine: Engine) -> dict[str, object]:
    """Colonnes, types, nullabilité, clés et index de chaque table de l'état."""
    inspecteur = inspect(engine)
    return {
        table: (
            [(c["name"], str(c["type"]), c["nullable"]) for c in inspecteur.get_columns(table)],
            inspecteur.get_pk_constraint(table)["constrained_columns"],
            sorted((i["name"], tuple(i["column_names"])) for i in inspecteur.get_indexes(table)),
        )
        for table in COLONNES
    }


def test_base_vierge_sans_revision(engine: Engine) -> None:
    assert current_revision(engine) is None
    assert tables(engine) == set()


def test_migration_jusqu_a_la_derniere_revision(engine: Engine) -> None:
    upgrade(engine)
    assert current_revision(engine) == head_revision()
    assert {"sessions", "login_requests", "alembic_version"} <= tables(engine)
    assert tables(engine) == TABLES


def test_rejouer_ne_change_rien(migre: Engine) -> None:
    with migre.begin() as connexion:
        connexion.execute(sessions.insert().values(session()))
    avant = forme(migre)
    upgrade(migre)
    upgrade(migre)
    assert current_revision(migre) == head_revision()
    assert {"sessions", "login_requests", "alembic_version"} <= tables(migre)
    assert tables(migre) == TABLES
    assert forme(migre) == avant
    with migre.connect() as connexion:
        lignes = connexion.execute(select(sessions)).mappings().all()
    assert [dict(ligne) for ligne in lignes] == [session()]


def test_migrations_et_declarations_concordent(migre: Engine) -> None:
    with migre.connect() as connexion:
        ecarts = compare_metadata(MigrationContext.configure(connexion), metadata)
    assert ecarts == []


def test_tables_et_colonnes_du_plan(migre: Engine) -> None:
    inspecteur = inspect(migre)
    for table, attendues in COLONNES.items():
        colonnes = {c["name"]: c for c in inspecteur.get_columns(table)}
        assert {nom: c["nullable"] for nom, c in colonnes.items()} == attendues
        for nom in INSTANTS[table]:
            # Instants en UTC, horloge de Board (P8) : `timestamptz`.
            type_ = colonnes[nom]["type"]
            assert isinstance(type_, DateTime) and type_.timezone, nom
        assert inspecteur.get_pk_constraint(table)["constrained_columns"] == CLES[table]


def test_declarations_du_plan() -> None:
    assert {sessions.name, login_requests.name} <= set(metadata.tables)
    for table in metadata.tables.values():
        assert {c.name: c.nullable for c in table.columns} == COLONNES[table.name]
        assert [c.name for c in table.primary_key.columns] == CLES[table.name]
        for nom in INSTANTS[table.name]:
            type_ = table.columns[nom].type
            assert isinstance(type_, DateTime) and type_.timezone, nom
    assert set(metadata.tables) == set(COLONNES)


def test_cle_primaire_sur_l_empreinte(migre: Engine) -> None:
    with migre.begin() as connexion:
        connexion.execute(sessions.insert().values(session()))
    with pytest.raises(IntegrityError), migre.begin() as connexion:
        connexion.execute(sessions.insert().values(session()))
    with migre.connect() as connexion:
        assert connexion.execute(select(func.count()).select_from(sessions)).scalar_one() == 1


@pytest.mark.parametrize("colonne", ["issuer", "subject", "groups", "expires_at"])
def test_identite_obligatoire(migre: Engine, colonne: str) -> None:
    ligne = session()
    ligne[colonne] = None
    # pg8000 rend la violation NOT NULL (23502) comme une ProgrammingError.
    with pytest.raises(DBAPIError, match="23502"), migre.begin() as connexion:
        connexion.execute(sessions.insert().values(ligne))


def test_instant_relu_en_utc(migre: Engine) -> None:
    # 16 h à Paris en été, soit 14 h UTC : l'instant, pas l'heure affichée, est gardé.
    decale = datetime(2026, 1, 15, 16, tzinfo=timezone(timedelta(hours=2)))
    ligne = {**session(), "expires_at": decale}
    with migre.begin() as connexion:
        connexion.execute(sessions.insert().values(ligne))
    with migre.connect() as connexion:
        relu = connexion.execute(select(sessions.c.expires_at)).scalar_one()
    assert relu.utcoffset() is not None
    assert relu == datetime(2026, 1, 15, 14, tzinfo=UTC)


def test_revisions_connues() -> None:
    connues = known_revisions()
    assert head_revision() in connues
    assert isinstance(connues, frozenset)
    # Une seule tête : pas de branches divergentes dans les migrations.
    assert len(_scripts().get_heads()) == 1


def test_migrations_en_avant_seulement() -> None:
    scripts = list(_scripts().walk_revisions())
    assert {script.revision for script in scripts} == known_revisions()
    for script in scripts:
        # Aucun retour arrière : on corrige par une nouvelle révision (P3).
        assert not hasattr(script.module, "downgrade"), script.revision
        assert "def downgrade" not in Path(script.path).read_text(encoding="utf-8")
    modele = (MIGRATIONS / "script.py.mako").read_text(encoding="utf-8")
    assert "def upgrade" in modele
    assert "downgrade" not in modele
