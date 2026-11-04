"""Révision 0005 : paramètres de déploiement et leurs valeurs par environnement (plan 10, 10.1 ;
plan 07, P2, P3)."""

from __future__ import annotations

from typing import Any

import pytest
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from identity.conftest import INSTANT
from skifer_board.spaces import SpaceStore
from skifer_board.spaces.model import ENVIRONMENTS
from skifer_board.state import current_revision, head_revision, known_revisions, metadata, upgrade
from skifer_board.state.database import _scripts
from skifer_board.state.schema import (
    deploy_grants,
    deploy_parameters,
    parameter_values,
    people,
    space_bindings,
    space_environments,
    space_events,
    spaces,
)
from sqlalchemy import Engine, delete, inspect, select
from sqlalchemy.exc import DBAPIError, IntegrityError

from .conftest import ACTEUR, ATLAS, EMETTEUR, groupe
from .test_migration import espace, evenement, inserer, jusqu_a, liaison, personne
from .test_migration_environnements import accord, environnements, trois
from .test_parametres_modele import entier

NOUVELLES = {"deploy_parameters", "parameter_values"}
DEV, TEST, PROD = ENVIRONMENTS


def forme(engine: Engine) -> dict[str, tuple[Any, ...]]:
    inspecteur = inspect(engine)
    return {
        table: (
            [(c["name"], str(c["type"]), c["nullable"]) for c in inspecteur.get_columns(table)],
            inspecteur.get_pk_constraint(table),
            sorted((i["name"], tuple(i["column_names"])) for i in inspecteur.get_indexes(table)),
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


def declaration(nom: str = "p", espace_: str = "ventes", **reste: object) -> dict[str, object]:
    return {
        "space_id": espace_,
        "name": nom,
        "type": "integer",
        "constraints": {"minimum": None, "maximum": None},
        "required": False,
        "default_value": None,
        "description": "",
        "created_at": INSTANT,
        "created_by_issuer": EMETTEUR,
        "created_by_subject": "admin",
        "updated_at": INSTANT,
        "updated_by_issuer": EMETTEUR,
        "updated_by_subject": "admin",
        **reste,
    }


def valeur(
    nom: str = "p", espace_: str = "ventes", environnement: str = "DEV", donnee: object = 1
) -> dict[str, object]:
    return {
        "space_id": espace_,
        "name": nom,
        "environment": environnement,
        "value": donnee,
        "set_at": INSTANT,
        "set_by_issuer": EMETTEUR,
        "set_by_subject": "admin",
    }


def contenu(engine: Engine) -> list[list[Any]]:
    with engine.connect() as connexion:
        return [
            sorted(connexion.execute(select(t)).all(), key=repr)
            for t in (
                spaces,
                space_bindings,
                people,
                space_events,
                space_environments,
                deploy_grants,
            )
        ]


def lignes(engine: Engine, *tables: Any) -> list[list[Any]]:
    with engine.connect() as connexion:
        return [list(connexion.execute(select(t)).all()) for t in tables]


def deux_espaces(engine: Engine) -> None:
    magasin = SpaceStore(engine)
    for identifiant in ("ventes", "achats"):
        magasin.create_space(identifiant, identifiant, ATLAS, groupe("admins"), ACTEUR, INSTANT)


# --- Révision ------------------------------------------------------------------------------


def test_revision_0005_en_avant_apres_0004() -> None:
    assert {"0004", "0005"} <= known_revisions()
    script = _scripts().get_revision("0005")
    assert script is not None
    assert script.down_revision == "0004"
    assert not hasattr(script.module, "downgrade")
    # La tête a avancé depuis (révision 0006, télémétrie) : 0005 reste dans la chaîne.
    assert head_revision() != "0005"


def test_depuis_une_base_vierge(engine: Engine) -> None:
    jusqu_a(engine, "0004")
    assert set(inspect(engine).get_table_names()) & NOUVELLES == set()
    jusqu_a(engine, "0005")
    assert current_revision(engine) == "0005"
    assert NOUVELLES <= set(inspect(engine).get_table_names())
    assert lignes(engine, deploy_parameters, parameter_values) == [[], []]


def test_depuis_une_base_vierge_directement(engine: Engine) -> None:
    jusqu_a(engine, "0005")
    assert current_revision(engine) == "0005"
    assert NOUVELLES <= set(inspect(engine).get_table_names())


def test_depuis_0004_peuplee(engine: Engine) -> None:
    jusqu_a(engine, "0003")
    inserer(engine, spaces, espace("ventes"), espace("achats"), espace("rh"))
    inserer(engine, space_bindings, liaison("l1", "ventes"), liaison("l2", "achats"))
    inserer(engine, people, personne())
    inserer(engine, space_events, evenement("ventes"), evenement("rh"))
    jusqu_a(engine, "0004")
    inserer(
        engine,
        deploy_grants,
        accord("g1"),
        accord("g2", "rh", "PROD"),
        accord("g3", "achats", "TEST", '["group", "b"]'),
    )
    assert current_revision(engine) == "0004"
    avant = contenu(engine)
    jusqu_a(engine, "0005")
    assert current_revision(engine) == "0005"
    # Rien n'est perdu ni repris : un espace migré n'a encore aucun paramètre.
    assert contenu(engine) == avant
    assert environnements(engine) == trois("ventes", "achats", "rh")
    assert lignes(engine, deploy_parameters, parameter_values) == [[], []]
    # Le magasin s'en sert aussitôt, dans un espace migré comme dans un nouvel espace.
    magasin = SpaceStore(engine)
    magasin.declare("rh", "lignes", entier(0, 10, required=True), ACTEUR, INSTANT)
    magasin.set_value("rh", "lignes", PROD, 0, ACTEUR, INSTANT)
    configuration = magasin.configuration("rh")
    assert [p.name for p in configuration.parameters] == ["lignes"]
    assert configuration.missing(DEV) == ("lignes",) and configuration.complete(PROD)
    magasin.create_space("neuf", "Neuf", ATLAS, groupe("admins"), ACTEUR, INSTANT)
    magasin.declare("neuf", "lignes", entier(), ACTEUR, INSTANT)
    magasin.set_value("neuf", "lignes", DEV, 3, ACTEUR, INSTANT)
    assert magasin.configuration("ventes").parameters == ()
    assert [g.id for g in magasin.grants("rh")] == ["g2"]


def test_concordance_apres_une_base_peuplee(engine: Engine) -> None:
    jusqu_a(engine, "0004")
    inserer(engine, spaces, espace("ventes"))
    trois_environnements: list[dict[str, object]] = [
        {"space_id": "ventes", "code": e.value, "position": e.rank} for e in ENVIRONMENTS
    ]
    inserer(engine, space_environments, *trois_environnements)
    upgrade(engine)
    with engine.connect() as connexion:
        ecarts = compare_metadata(MigrationContext.configure(connexion), metadata)
    assert ecarts == []


def test_rejouer_ne_change_rien(migre: Engine) -> None:
    deux_espaces(migre)
    inserer(migre, deploy_parameters, declaration())
    inserer(migre, parameter_values, valeur())
    avant = (forme(migre), lignes(migre, deploy_parameters, parameter_values))
    upgrade(migre)
    upgrade(migre)
    assert (forme(migre), lignes(migre, deploy_parameters, parameter_values)) == avant


# --- Contraintes ---------------------------------------------------------------------------


def test_cles_declarees(migre: Engine) -> None:
    attendue = forme(migre)
    pk_parametres, pk_valeurs = attendue["deploy_parameters"][1], attendue["parameter_values"][1]
    assert (pk_parametres["name"], pk_parametres["constrained_columns"]) == (
        "pk_deploy_parameters",
        ["space_id", "name"],
    )
    assert (pk_valeurs["name"], pk_valeurs["constrained_columns"]) == (
        "pk_parameter_values",
        ["space_id", "name", "environment"],
    )
    assert attendue["deploy_parameters"][3] == [
        ("fk_deploy_parameters_space", "spaces", ("space_id",), ("id",))
    ]
    assert attendue["parameter_values"][3] == [
        (
            "fk_parameter_values_environment",
            "space_environments",
            ("space_id", "environment"),
            ("space_id", "code"),
        ),
        (
            "fk_parameter_values_parameter",
            "deploy_parameters",
            ("space_id", "name"),
            ("space_id", "name"),
        ),
    ]


def test_valeur_vers_un_environnement_inexistant_refusee(migre: Engine) -> None:
    deux_espaces(migre)
    inserer(migre, deploy_parameters, declaration())
    # pg8000 rend la violation de clé étrangère (23503) comme une ProgrammingError.
    for ligne in (
        valeur(environnement="QA"),
        valeur(environnement="dev"),
        valeur(environnement="PRODUCTION"),
        valeur(environnement=""),
    ):
        with pytest.raises(DBAPIError, match="23503"):
            inserer(migre, parameter_values, ligne)
    assert lignes(migre, parameter_values) == [[]]


def test_valeur_sans_declaration_refusee(migre: Engine) -> None:
    deux_espaces(migre)
    inserer(migre, deploy_parameters, declaration())
    for ligne in (valeur("autre"), valeur("p", "achats"), valeur("P")):
        with pytest.raises(DBAPIError, match="23503"):
            inserer(migre, parameter_values, ligne)
    with pytest.raises(DBAPIError, match="23503"):
        inserer(migre, deploy_parameters, declaration(espace_="fantome"))
    assert lignes(migre, parameter_values) == [[]]


def test_declaration_ou_environnement_avec_valeurs_indelebiles(migre: Engine) -> None:
    deux_espaces(migre)
    inserer(migre, deploy_parameters, declaration())
    inserer(migre, parameter_values, valeur(environnement="PROD"))
    # Pas de suppression en cascade : la base refuse de laisser une valeur orpheline.
    with pytest.raises(DBAPIError, match="23503"), migre.begin() as connexion:
        connexion.execute(delete(deploy_parameters))
    with pytest.raises(DBAPIError, match="23503"), migre.begin() as connexion:
        connexion.execute(
            delete(space_environments).where(
                space_environments.c.space_id == "ventes", space_environments.c.code == "PROD"
            )
        )
    assert len(lignes(migre, parameter_values)[0]) == 1


def test_une_declaration_par_nom_et_une_valeur_par_environnement(migre: Engine) -> None:
    deux_espaces(migre)
    inserer(migre, deploy_parameters, declaration())
    with pytest.raises(IntegrityError, match="23505"):
        inserer(migre, deploy_parameters, declaration(type="boolean"))
    # Même nom dans un autre espace, autre nom dans le même espace.
    inserer(migre, deploy_parameters, declaration(espace_="achats"), declaration("q"))
    inserer(migre, parameter_values, valeur())
    with pytest.raises(IntegrityError, match="23505"):
        inserer(migre, parameter_values, valeur(donnee=2))
    inserer(
        migre,
        parameter_values,
        valeur(environnement="TEST"),
        valeur("q"),
        valeur(espace_="achats"),
    )
    assert len(lignes(migre, parameter_values)[0]) == 4


@pytest.mark.parametrize(
    "colonne",
    [
        "type",
        "constraints",
        "required",
        "description",
        "created_at",
        "created_by_issuer",
        "created_by_subject",
        "updated_at",
        "updated_by_issuer",
        "updated_by_subject",
    ],
)
def test_colonnes_obligatoires_des_declarations(migre: Engine, colonne: str) -> None:
    deux_espaces(migre)
    with pytest.raises(DBAPIError, match="23502"):
        inserer(migre, deploy_parameters, {**declaration(), colonne: None})


@pytest.mark.parametrize("colonne", ["value", "set_at", "set_by_issuer", "set_by_subject"])
def test_colonnes_obligatoires_des_valeurs(migre: Engine, colonne: str) -> None:
    deux_espaces(migre)
    inserer(migre, deploy_parameters, declaration())
    with pytest.raises(DBAPIError, match="23502"):
        inserer(migre, parameter_values, {**valeur(), colonne: None})


def test_defaut_facultatif(migre: Engine) -> None:
    deux_espaces(migre)
    inserer(migre, deploy_parameters, declaration(), declaration("q", default_value=0))
    with migre.connect() as connexion:
        defauts = dict(
            connexion.execute(
                select(deploy_parameters.c.name, deploy_parameters.c.default_value)
            ).all()
        )
    assert defauts == {"p": None, "q": 0}
