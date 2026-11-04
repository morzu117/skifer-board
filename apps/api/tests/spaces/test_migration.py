"""Révision 0003 : espaces, liaisons, personnes et journal (plan 08, 8.1 ; plan 07, P3)."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from identity.conftest import INSTANT
from skifer_board.state import current_revision, known_revisions, metadata, sessions, upgrade
from skifer_board.state.database import _alembic, _scripts
from skifer_board.state.schema import people, space_bindings, space_events, spaces
from sqlalchemy import Engine, Table, inspect, select
from sqlalchemy.exc import DBAPIError, IntegrityError

NOUVELLES = {"spaces", "space_bindings", "people", "space_events"}


def jusqu_a(engine: Engine, revision: str) -> None:
    config = _alembic()
    with engine.begin() as connexion:
        config.attributes["connection"] = connexion
        command.upgrade(config, revision)


def forme(engine: Engine) -> dict[str, tuple[Any, ...]]:
    inspecteur = inspect(engine)
    return {
        table: (
            [(c["name"], str(c["type"]), c["nullable"]) for c in inspecteur.get_columns(table)],
            inspecteur.get_pk_constraint(table)["constrained_columns"],
            sorted((i["name"], tuple(i["column_names"])) for i in inspecteur.get_indexes(table)),
            sorted(
                (u["name"], tuple(u["column_names"]))
                for u in inspecteur.get_unique_constraints(table)
            ),
            sorted(
                (f["name"], f["referred_table"], tuple(f["constrained_columns"]))
                for f in inspecteur.get_foreign_keys(table)
            ),
        )
        for table in sorted(NOUVELLES)
    }


def ligne_session() -> dict[str, object]:
    return {
        "fingerprint": "f" * 64,
        "issuer": "https://id.example.invalid",
        "subject": "sujet",
        "name": None,
        "email": None,
        "groups": ["lecteurs"],
        "created_at": INSTANT,
        "last_seen": INSTANT,
        "expires_at": INSTANT + timedelta(hours=8),
    }


def espace(identifiant: str = "ventes") -> dict[str, object]:
    return {
        "id": identifiant,
        "name": "Ventes",
        "atlas": "/srv/atlas",
        "created_at": INSTANT,
        "created_by_issuer": "https://id.example.invalid",
        "created_by_subject": "admin",
    }


def liaison(
    identifiant: str, espace_: str = "ventes", cle: str = '["group", "a"]'
) -> dict[str, Any]:
    return {
        "id": identifiant,
        "space_id": espace_,
        "kind": "group",
        "group_name": "a",
        "principal_key": cle,
        "role": "admin",
        "created_at": INSTANT,
        "created_by_issuer": "https://id.example.invalid",
        "created_by_subject": "admin",
    }


def evenement(espace_: str = "ventes") -> dict[str, object]:
    return {
        "space_id": espace_,
        "at": INSTANT,
        "actor_issuer": "https://id.example.invalid",
        "actor_subject": "admin",
        "action": "space_created",
        "detail": {"name": "Ventes"},
    }


def personne() -> dict[str, object]:
    return {
        "issuer": "https://id.example.invalid",
        "subject": "alice",
        "name": None,
        "email": None,
        "last_login": INSTANT,
    }


def inserer(engine: Engine, table: Table, *lignes: dict[str, object]) -> None:
    with engine.begin() as connexion:
        for ligne in lignes:
            connexion.execute(table.insert().values(ligne))


def test_revision_0003_en_avant_apres_0002() -> None:
    assert {"0001", "0002", "0003"} <= known_revisions()
    script = _scripts().get_revision("0003")
    assert script is not None
    assert script.down_revision == "0002"
    assert not hasattr(script.module, "downgrade")


def test_depuis_une_base_vierge_en_passant_par_0002(engine: Engine) -> None:
    jusqu_a(engine, "0002")
    assert current_revision(engine) == "0002"
    assert set(inspect(engine).get_table_names()) & NOUVELLES == set()
    inserer(engine, sessions, ligne_session())
    upgrade(engine)
    assert NOUVELLES <= set(inspect(engine).get_table_names())
    # Les sessions ouvertes avant la révision survivent : personne n'est déconnecté.
    with engine.connect() as connexion:
        lignes = connexion.execute(select(sessions)).mappings().all()
    assert [dict(ligne) for ligne in lignes] == [ligne_session()]


def test_depuis_une_base_vierge_directement(engine: Engine) -> None:
    jusqu_a(engine, "0003")
    assert current_revision(engine) == "0003"
    assert NOUVELLES <= set(inspect(engine).get_table_names())


def test_rejouer_ne_change_rien(migre: Engine) -> None:
    inserer(migre, spaces, espace())
    inserer(migre, space_bindings, liaison("l1"))
    inserer(migre, people, personne())
    inserer(migre, space_events, evenement())
    avant = forme(migre)
    with migre.connect() as connexion:
        contenu = [connexion.execute(select(t)).all() for t in (spaces, space_bindings, people)]
    upgrade(migre)
    upgrade(migre)
    assert forme(migre) == avant
    with migre.connect() as connexion:
        assert [connexion.execute(select(t)).all() for t in (spaces, space_bindings, people)] == (
            contenu
        )


def test_concordance_avec_les_declarations(migre: Engine) -> None:
    with migre.connect() as connexion:
        ecarts = compare_metadata(MigrationContext.configure(connexion), metadata)
    assert ecarts == []


def test_contraintes_et_index_declares(migre: Engine) -> None:
    attendue = forme(migre)
    assert attendue["space_bindings"][3] == [
        ("uq_space_bindings_principal", ("space_id", "principal_key"))
    ]
    assert attendue["space_bindings"][4] == [("fk_space_bindings_space", "spaces", ("space_id",))]
    assert attendue["space_events"][4] == [("fk_space_events_space", "spaces", ("space_id",))]
    assert attendue["people"][1] == ["issuer", "subject"]
    noms = {i["name"] for t in NOUVELLES for i in inspect(migre).get_indexes(t)}
    assert {"ix_space_bindings_group", "ix_space_bindings_person", "ix_space_events_space"} <= noms


def test_liaison_vers_un_espace_inexistant_refusee(migre: Engine) -> None:
    # pg8000 rend la violation de clé étrangère (23503) comme une ProgrammingError.
    with pytest.raises(DBAPIError, match="23503"):
        inserer(migre, space_bindings, liaison("l1", "fantome"))
    with pytest.raises(DBAPIError, match="23503"):
        inserer(migre, space_events, evenement("fantome"))
    with migre.connect() as connexion:
        assert connexion.execute(select(space_bindings)).all() == []
        assert connexion.execute(select(space_events)).all() == []


def test_deux_liaisons_du_meme_principal_refusees(migre: Engine) -> None:
    inserer(migre, spaces, espace("ventes"), espace("achats"))
    inserer(migre, space_bindings, liaison("l1"))
    with pytest.raises(IntegrityError, match="23505"):
        inserer(migre, space_bindings, liaison("l2"))
    # Le même principal dans un autre espace, ou un autre principal ici : admis.
    inserer(migre, space_bindings, liaison("l3", "achats"), liaison("l4", cle='["group", "b"]'))
    with pytest.raises(IntegrityError, match="23505"):
        inserer(migre, space_bindings, liaison("l1", "achats", '["group", "c"]'))


def test_cles_primaires(migre: Engine) -> None:
    inserer(migre, spaces, espace())
    with pytest.raises(IntegrityError, match="23505"):
        inserer(migre, spaces, espace())
    inserer(migre, people, personne())
    with pytest.raises(IntegrityError, match="23505"):
        inserer(migre, people, personne())


@pytest.mark.parametrize(
    "table,ligne,colonne",
    [
        (spaces, espace(), "name"),
        (spaces, espace(), "created_by_subject"),
        (people, personne(), "last_login"),
        (space_events, evenement(), "detail"),
        (space_events, evenement(), "actor_subject"),
    ],
    ids=lambda v: v if isinstance(v, str) else "",
)
def test_colonnes_obligatoires(
    migre: Engine, table: Table, ligne: dict[str, object], colonne: str
) -> None:
    if table is space_events:
        inserer(migre, spaces, espace())
    # pg8000 rend la violation NOT NULL (23502) comme une ProgrammingError.
    with pytest.raises(DBAPIError, match="23502"):
        inserer(migre, table, {**ligne, colonne: None})
