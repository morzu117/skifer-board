"""Révision 0006 : mesures de télémétrie (plan 11, 11.1 ; plan 07, P2, P3)."""

from __future__ import annotations

from typing import Any

import pytest
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from skifer_board.spaces import SpaceStore
from skifer_board.state import current_revision, head_revision, known_revisions, metadata, upgrade
from skifer_board.state.database import _scripts
from skifer_board.state.schema import (
    deploy_grants,
    deploy_parameters,
    parameter_values,
    people,
    sessions,
    space_bindings,
    space_environments,
    space_events,
    spaces,
    telemetry,
)
from skifer_board.telemetry import TelemetryStore, Window
from spaces.test_migration import espace, evenement, inserer, jusqu_a, liaison, personne
from spaces.test_migration_environnements import accord
from spaces.test_migration_parametres import declaration, valeur
from sqlalchemy import Engine, inspect, select
from sqlalchemy.exc import DBAPIError
from state.test_migrations import session

from .conftest import MAINTENANT, atlas, avant, http, lignes

COLONNES = [
    ("id", "BIGINT", False),
    ("at", "TIMESTAMP", False),
    ("kind", "VARCHAR(16)", False),
    ("operation", "VARCHAR(200)", False),
    ("method", "VARCHAR(10)", True),
    ("status", "SMALLINT", True),
    ("outcome", "VARCHAR(40)", False),
    ("space_id", "VARCHAR(40)", True),
    ("environment", "VARCHAR(10)", True),
    ("duration_ms", "DOUBLE PRECISION", False),
    ("rows", "BIGINT", True),
    ("size", "BIGINT", True),
]
ANCIENNES = (
    sessions,
    spaces,
    space_bindings,
    people,
    space_events,
    space_environments,
    deploy_grants,
    deploy_parameters,
    parameter_values,
)


def forme(engine: Engine) -> tuple[Any, ...]:
    inspecteur = inspect(engine)
    colonnes = inspecteur.get_columns("telemetry")
    return (
        [(c["name"], str(c["type"]), c["nullable"]) for c in colonnes],
        {c["name"]: getattr(c["type"], "timezone", None) for c in colonnes if c["name"] == "at"},
        inspecteur.get_pk_constraint("telemetry")["constrained_columns"],
        sorted(
            (i["name"], tuple(i["column_names"]), i["unique"])
            for i in inspecteur.get_indexes("telemetry")
        ),
        inspecteur.get_foreign_keys("telemetry"),
    )


def contenu(engine: Engine) -> list[list[Any]]:
    with engine.connect() as connexion:
        return [sorted(connexion.execute(select(t)).all(), key=repr) for t in ANCIENNES]


def peupler_jusqu_a_0005(engine: Engine) -> None:
    jusqu_a(engine, "0003")
    inserer(engine, sessions, session())
    inserer(engine, spaces, espace("ventes"), espace("achats"))
    inserer(engine, space_bindings, liaison("l1", "ventes"), liaison("l2", "achats"))
    inserer(engine, people, personne())
    inserer(engine, space_events, evenement("ventes"), evenement("achats"))
    jusqu_a(engine, "0004")
    inserer(engine, deploy_grants, accord("g1"), accord("g2", "achats", "PROD"))
    jusqu_a(engine, "0005")
    inserer(engine, deploy_parameters, declaration(), declaration("q", "achats"))
    inserer(engine, parameter_values, valeur(), valeur("q", "achats", "PROD", 7))


# --- Révision --------------------------------------------------------------------------------


def test_revision_0006_en_avant_apres_0005() -> None:
    assert {"0005", "0006"} <= known_revisions()
    script = _scripts().get_revision("0006")
    assert script is not None
    assert script.down_revision == "0005"
    assert not hasattr(script.module, "downgrade")
    assert head_revision() >= "0006"


# --- Base vierge -----------------------------------------------------------------------------


def test_depuis_une_base_vierge_en_passant_par_0005(engine: Engine) -> None:
    jusqu_a(engine, "0005")
    assert "telemetry" not in inspect(engine).get_table_names()
    jusqu_a(engine, "0006")
    assert current_revision(engine) == "0006"
    assert "telemetry" in inspect(engine).get_table_names()
    assert lignes(engine) == []


def test_depuis_une_base_vierge_directement(engine: Engine) -> None:
    upgrade(engine)
    assert current_revision(engine) == head_revision()
    assert lignes(engine) == []


def test_forme_de_la_table(migre: Engine) -> None:
    assert forme(migre) == (
        COLONNES,
        {"at": True},
        ["id"],
        [("ix_telemetry_at", ("at",), False)],
        # Aucune clé étrangère : une mesure ne dépend d'aucune autre table.
        [],
    )


def test_identifiant_engendre_par_la_base(migre: Engine) -> None:
    TelemetryStore(migre).record([http(), http()])
    premier, second = (ligne["id"] for ligne in lignes(migre))
    assert premier < second


@pytest.mark.parametrize("colonne", ["at", "kind", "operation", "outcome", "duration_ms"])
def test_colonnes_obligatoires(migre: Engine, colonne: str) -> None:
    ligne: dict[str, object] = {
        "at": MAINTENANT,
        "kind": "http",
        "operation": "x",
        "outcome": "ok",
        "duration_ms": 1.0,
        colonne: None,
    }
    with pytest.raises(DBAPIError, match="23502"):
        inserer(migre, telemetry, ligne)
    assert lignes(migre) == []


# --- Base peuplée ----------------------------------------------------------------------------


def test_depuis_0005_peuplee(engine: Engine) -> None:
    peupler_jusqu_a_0005(engine)
    assert current_revision(engine) == "0005"
    avant_migration = contenu(engine)
    assert all(avant_migration)
    upgrade(engine)
    assert current_revision(engine) == head_revision()
    # Rien n'est perdu ni repris ; la table des mesures part vide.
    assert contenu(engine) == avant_migration
    assert lignes(engine) == []
    # Le magasin s'en sert aussitôt, et celui des espaces aussi.
    magasin = TelemetryStore(engine)
    magasin.record([http(space="ventes", environment="DEV"), atlas(at=avant(days=91))])
    assert [o.count for o in magasin.summary(Window.DAY, MAINTENANT).operations] == [1]
    assert magasin.purge(avant(days=90)) == 1
    assert SpaceStore(engine).configuration("ventes").parameters[0].name == "p"


def test_concordance_apres_une_base_peuplee(engine: Engine) -> None:
    peupler_jusqu_a_0005(engine)
    upgrade(engine)
    with engine.connect() as connexion:
        ecarts = compare_metadata(MigrationContext.configure(connexion), metadata)
    assert ecarts == []


def test_rejouer_ne_change_rien(migre: Engine) -> None:
    TelemetryStore(migre).record([http(), atlas(rows=1, size=2)])
    avant_rejeu = (forme(migre), lignes(migre))
    upgrade(migre)
    upgrade(migre)
    assert current_revision(migre) == head_revision()
    assert (forme(migre), lignes(migre)) == avant_rejeu
