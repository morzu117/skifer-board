"""Invariants : aucun SQL écrit ni stocké par Board, aucune écoute réseau en test (P2, P9)."""

import ast
from pathlib import Path

import skifer_board.state
from skifer_board.state import metadata
from sqlalchemy import Engine, inspect, select
from sqlalchemy.sql import func

PAQUET = Path(skifer_board.state.__file__).parent
SUSPECTS = ("sql", "query", "requete", "statement", "expression", "formula")


def test_aucune_colonne_destinee_a_du_sql(migre: Engine) -> None:
    inspecteur = inspect(migre)
    noms = {
        (table, colonne["name"])
        for table in inspecteur.get_table_names()
        for colonne in inspecteur.get_columns(table)
    } | {(table.name, colonne.name) for table in metadata.tables.values() for colonne in table.c}
    assert noms
    for table, colonne in noms:
        for suspect in SUSPECTS:
            assert suspect not in colonne.lower(), (table, colonne)
            assert suspect not in table.lower(), table


def test_requetes_construites_jamais_ecrites() -> None:
    """Ni `text()`, ni instruction en chaîne, ni `op.execute` sur du texte dans le paquet
    d'état (P2)."""
    sources = sorted(PAQUET.rglob("*.py"))
    assert any(p.name == "0001_sessions.py" for p in sources)
    for source in sources:
        arbre = ast.parse(source.read_text(encoding="utf-8"))
        for noeud in ast.walk(arbre):
            if isinstance(noeud, ast.ImportFrom) and (noeud.module or "").startswith("sqlalchemy"):
                assert "text" not in {alias.name for alias in noeud.names}, source
            if isinstance(noeud, ast.Call) and isinstance(noeud.func, ast.Attribute):
                assert noeud.func.attr not in {"text", "exec_driver_sql"}, source
                if noeud.func.attr == "execute":
                    assert not any(
                        isinstance(argument, ast.Constant) and isinstance(argument.value, str)
                        for argument in noeud.args
                    ), source


def test_cluster_de_test_sans_ecoute_reseau(engine: Engine) -> None:
    assert engine.url.host is None
    assert "unix_sock" in engine.url.query
    with engine.connect() as connexion:
        # Pas d'adresse d'écoute : seul le fichier socket rend le cluster joignable.
        adresses = connexion.execute(select(func.current_setting("listen_addresses"))).scalar_one()
        client = connexion.execute(select(func.inet_client_addr())).scalar_one()
    assert adresses == ""
    assert client is None
