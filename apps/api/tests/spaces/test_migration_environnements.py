"""Révision 0004 : environnements des espaces et accords du droit de déployer (plan 09, 9.1 ;
plan 07, P2, P3)."""

from __future__ import annotations

from typing import Any

import pytest
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from identity.conftest import INSTANT
from skifer_board.identity.model import Identity
from skifer_board.spaces import Role, SpaceStore
from skifer_board.spaces.model import ENVIRONMENTS
from skifer_board.state import current_revision, known_revisions, metadata, upgrade
from skifer_board.state.database import _scripts
from skifer_board.state.schema import (
    deploy_grants,
    people,
    space_bindings,
    space_environments,
    space_events,
    spaces,
)
from sqlalchemy import Engine, inspect, select
from sqlalchemy.exc import DBAPIError, IntegrityError

from .conftest import ACTEUR, ATLAS, EMETTEUR, groupe
from .test_migration import espace, evenement, inserer, jusqu_a, liaison, personne

NOUVELLES = {"space_environments", "deploy_grants"}


def forme(engine: Engine) -> dict[str, tuple[Any, ...]]:
    inspecteur = inspect(engine)
    return {
        table: (
            [(c["name"], str(c["type"]), c["nullable"]) for c in inspecteur.get_columns(table)],
            inspecteur.get_pk_constraint(table),
            sorted((i["name"], tuple(i["column_names"])) for i in inspecteur.get_indexes(table)),
            sorted(
                (u["name"], tuple(u["column_names"]))
                for u in inspecteur.get_unique_constraints(table)
            ),
            sorted(
                (
                    f["name"],
                    f["referred_table"],
                    tuple(f["constrained_columns"]),
                    tuple(f["referred_columns"]),
                )
                for f in inspecteur.get_foreign_keys(table)
            ),
        )
        for table in sorted(NOUVELLES)
    }


def environnements(engine: Engine) -> list[tuple[str, str, int]]:
    with engine.connect() as connexion:
        lignes = connexion.execute(
            select(space_environments).order_by(
                space_environments.c.space_id, space_environments.c.position
            )
        ).all()
    return [(ligne.space_id, ligne.code, ligne.position) for ligne in lignes]


def trois(*identifiants: str) -> list[tuple[str, str, int]]:
    return [
        (i, code, rang)
        for i in sorted(identifiants)
        for code, rang in (("DEV", 1), ("TEST", 2), ("PROD", 3))
    ]


def accord(
    identifiant: str,
    espace_: str = "ventes",
    environnement: str = "DEV",
    cle: str = '["group", "a"]',
) -> dict[str, object]:
    return {
        "id": identifiant,
        "space_id": espace_,
        "environment": environnement,
        "kind": "group",
        "group_name": "a",
        "principal_key": cle,
        "created_at": INSTANT,
        "created_by_issuer": EMETTEUR,
        "created_by_subject": "admin",
    }


def contenu(engine: Engine) -> list[list[Any]]:
    with engine.connect() as connexion:
        return [
            sorted(connexion.execute(select(t)).all(), key=repr)
            for t in (spaces, space_bindings, people, space_events)
        ]


def test_revision_0004_en_avant_apres_0003() -> None:
    assert {"0003", "0004"} <= known_revisions()
    script = _scripts().get_revision("0004")
    assert script is not None
    assert script.down_revision == "0003"
    assert not hasattr(script.module, "downgrade")
    # Les codes de la migration sont figés : ce sont ceux du modèle, dans le même ordre.
    assert script.module.ENVIRONMENTS == tuple(e.value for e in ENVIRONMENTS)


def test_depuis_une_base_vierge(engine: Engine) -> None:
    jusqu_a(engine, "0004")
    assert current_revision(engine) == "0004"
    assert NOUVELLES <= set(inspect(engine).get_table_names())
    assert environnements(engine) == []


def test_depuis_0003_sans_espace(engine: Engine) -> None:
    jusqu_a(engine, "0003")
    assert set(inspect(engine).get_table_names()) & NOUVELLES == set()
    upgrade(engine)
    assert environnements(engine) == []


def test_depuis_0003_avec_des_espaces(engine: Engine) -> None:
    jusqu_a(engine, "0003")
    assert current_revision(engine) == "0003"
    inserer(engine, spaces, espace("ventes"), espace("achats"), espace("rh"))
    inserer(engine, space_bindings, liaison("l1", "ventes"), liaison("l2", "achats"))
    inserer(engine, people, personne())
    inserer(engine, space_events, evenement("ventes"), evenement("rh"))
    avant = contenu(engine)
    upgrade(engine)
    # Chaque espace existant reçoit ses trois environnements, dans l'ordre de promotion.
    assert environnements(engine) == trois("ventes", "achats", "rh")
    assert contenu(engine) == avant
    with engine.connect() as connexion:
        assert connexion.execute(select(deploy_grants)).all() == []
    # Le magasin s'en sert aussitôt : accords dans un espace migré, et nouvel espace.
    magasin = SpaceStore(engine)
    assert magasin.environments(["ventes", "rh"]) == {"ventes": ENVIRONMENTS, "rh": ENVIRONMENTS}
    accorde = magasin.grant("rh", ENVIRONMENTS[2], groupe("deployeurs"), ACTEUR, INSTANT)
    assert magasin.grants("rh") == [accorde]
    magasin.create_space("neuf", "Neuf", ATLAS, groupe("admins"), ACTEUR, INSTANT)
    assert environnements(engine) == trois("ventes", "achats", "rh", "neuf")
    createur = Identity(EMETTEUR, "x", None, None, ("deployeurs", "a"))
    magasin.set_binding("rh", groupe("deployeurs"), Role.CREATOR, ACTEUR, INSTANT)
    assert magasin.grants_of(createur, ["rh"]) == {"rh": [accorde]}


def test_concordance_apres_une_base_peuplee(engine: Engine) -> None:
    jusqu_a(engine, "0003")
    inserer(engine, spaces, espace("ventes"))
    upgrade(engine)
    with engine.connect() as connexion:
        ecarts = compare_metadata(MigrationContext.configure(connexion), metadata)
    assert ecarts == []


def test_rejouer_ne_change_rien(engine: Engine) -> None:
    jusqu_a(engine, "0003")
    inserer(engine, spaces, espace("ventes"))
    upgrade(engine)
    inserer(engine, deploy_grants, accord("g1"))
    avant = (forme(engine), environnements(engine))
    upgrade(engine)
    upgrade(engine)
    assert (forme(engine), environnements(engine)) == avant
    with engine.connect() as connexion:
        assert len(connexion.execute(select(deploy_grants)).all()) == 1


def test_contraintes_et_index_declares(migre: Engine) -> None:
    attendue = forme(migre)
    pk_env, pk_accords = attendue["space_environments"][1], attendue["deploy_grants"][1]
    assert (pk_env["name"], pk_env["constrained_columns"]) == (
        "pk_space_environments",
        ["space_id", "code"],
    )
    assert pk_accords["constrained_columns"] == ["id"]
    assert attendue["space_environments"][3] == [
        ("uq_space_environments_position", ("space_id", "position"))
    ]
    assert attendue["space_environments"][4] == [
        ("fk_space_environments_space", "spaces", ("space_id",), ("id",))
    ]
    assert attendue["deploy_grants"][3] == [
        ("uq_deploy_grants_principal", ("space_id", "environment", "principal_key"))
    ]
    assert attendue["deploy_grants"][4] == [
        (
            "fk_deploy_grants_environment",
            "space_environments",
            ("space_id", "environment"),
            ("space_id", "code"),
        )
    ]
    # PostgreSQL rend aussi l'index qui porte la contrainte d'unicité.
    assert attendue["deploy_grants"][2] == [
        ("ix_deploy_grants_group", ("group_name",)),
        ("ix_deploy_grants_person", ("person_issuer", "person_subject")),
        ("uq_deploy_grants_principal", ("space_id", "environment", "principal_key")),
    ]


def test_accord_vers_un_environnement_inexistant_refuse(migre: Engine) -> None:
    magasin = SpaceStore(migre)
    magasin.create_space("ventes", "Ventes", ATLAS, groupe("admins"), ACTEUR, INSTANT)
    # pg8000 rend la violation de clé étrangère (23503) comme une ProgrammingError.
    for ligne in (
        accord("g1", environnement="QA"),
        accord("g2", environnement="dev"),
        accord("g3", "fantome"),
    ):
        with pytest.raises(DBAPIError, match="23503"):
            inserer(migre, deploy_grants, ligne)
    with pytest.raises(DBAPIError, match="23503"):
        inserer(migre, space_environments, {"space_id": "fantome", "code": "DEV", "position": 1})
    with migre.connect() as connexion:
        assert connexion.execute(select(deploy_grants)).all() == []


def test_un_accord_par_espace_environnement_et_principal(migre: Engine) -> None:
    magasin = SpaceStore(migre)
    for identifiant in ("ventes", "achats"):
        magasin.create_space(identifiant, identifiant, ATLAS, groupe("admins"), ACTEUR, INSTANT)
    inserer(migre, deploy_grants, accord("g1"))
    with pytest.raises(IntegrityError, match="23505"):
        inserer(migre, deploy_grants, accord("g2"))
    # Le même principal dans un autre environnement ou un autre espace, ou un autre principal.
    inserer(
        migre,
        deploy_grants,
        accord("g3", environnement="PROD"),
        accord("g4", "achats"),
        accord("g5", cle='["group", "b"]'),
    )
    with pytest.raises(IntegrityError, match="23505"):
        inserer(migre, deploy_grants, accord("g1", "achats", "TEST", '["group", "c"]'))


def test_rang_et_code_uniques_par_espace(migre: Engine) -> None:
    magasin = SpaceStore(migre)
    magasin.create_space("ventes", "Ventes", ATLAS, groupe("admins"), ACTEUR, INSTANT)
    with pytest.raises(IntegrityError, match="23505"):
        inserer(migre, space_environments, {"space_id": "ventes", "code": "QA", "position": 2})
    with pytest.raises(IntegrityError, match="23505"):
        inserer(migre, space_environments, {"space_id": "ventes", "code": "DEV", "position": 9})
    assert environnements(migre) == trois("ventes")


@pytest.mark.parametrize(
    "colonne",
    [
        "environment",
        "kind",
        "principal_key",
        "created_at",
        "created_by_issuer",
        "created_by_subject",
    ],
)
def test_colonnes_obligatoires_des_accords(migre: Engine, colonne: str) -> None:
    SpaceStore(migre).create_space("ventes", "Ventes", ATLAS, groupe("admins"), ACTEUR, INSTANT)
    # pg8000 rend la violation NOT NULL (23502) comme une ProgrammingError.
    with pytest.raises(DBAPIError, match="23502"):
        inserer(migre, deploy_grants, {**accord("g1"), colonne: None})
