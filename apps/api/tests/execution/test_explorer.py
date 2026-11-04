"""Catalogue fermé de l'explorateur (plan 17.1)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
import yaml
from catalog.conftest import espace as espace
from catalog.conftest import service as service
from fastapi.testclient import TestClient
from identity.conftest import cles as cles
from identity.conftest import config as config
from identity.conftest import fournisseur as fournisseur
from identity.conftest import horloge as horloge
from skifer_board.catalog import CatalogService
from skifer_board.execution.connectors import DuckDbExecution
from skifer_board.execution.semantic import SemanticRefusal, describe_catalog
from skifer_board.server import create_app
from skifer_board.spaces import GroupPrincipal, Role
from spaces.monde import (
    ADMIN_GROUPE,
    ADMIN_PERSONNE,
    CREATEUR_GROUPE,
    LECTEUR_GROUPE,
    LECTEUR_PERSONNE,
    NON_MEMBRE,
    PLATEFORME_LECTEUR,
    PLATEFORME_SEULE,
    A,
    B,
    Monde,
    Profil,
)
from spaces.monde import config_plateforme as config_plateforme
from spaces.monde import monde as monde
from state.conftest import migre as migre

from execution.test_runs_web import PATH, _call, _client, _contract, _models


class ListeSousLaBorne(list[Any]):
    def __len__(self) -> int:
        return 500


def test_description_et_confidentialite(tmp_path: Path) -> None:
    directory = _models(tmp_path)
    model = yaml.safe_load((directory / "orders.yaml").read_text())
    model["models"][0].update(
        {
            "name": "main.NOM_MODELE_SENTINELLE.orders_tbl",
            "table": "TABLE_SENTINELLE",
            "row_policy": {"column": "POLITIQUE_SENTINELLE"},
            "source": "SOURCE_SENTINELLE",
            "dimensions": [{"name": "region", "type": "string", "sql": "SQL_SENTINELLE"}],
        }
    )
    (directory / "orders.yaml").write_text(yaml.safe_dump(model))
    catalog = yaml.safe_load((directory / "semantic_catalog.yaml").read_text())
    catalog["models"][0]["dimensions"] = ["region"]
    (directory / "semantic_catalog.yaml").write_text(yaml.safe_dump(catalog))
    result = describe_catalog(directory)
    assert result == {
        "models": [
            {
                "name": "orders",
                "label": "orders",
                "description": "",
                "metrics": [
                    {
                        "name": "revenue",
                        "label": "revenue",
                        "description": "",
                        "aggregation": "sum",
                        "additivity": "additive",
                    }
                ],
                "dimensions": [
                    {
                        "name": "region",
                        "label": "region",
                        "description": "",
                        "type": "string",
                        "is_time": False,
                    }
                ],
            }
        ]
    }
    assert "SENTINELLE" not in json.dumps(result)


@pytest.mark.parametrize("modification", ["policy", "yaml", "missing", "path", "limit"])
def test_catalogue_indisponible(tmp_path: Path, modification: str) -> None:
    directory = _models(tmp_path)
    catalog_path = directory / "semantic_catalog.yaml"
    model_path = directory / "orders.yaml"
    if modification == "policy":
        data = yaml.safe_load(model_path.read_text())
        del data["models"][0]["row_policy"]
        model_path.write_text(yaml.safe_dump(data))
    elif modification == "yaml":
        catalog_path.write_text("[")
    elif modification == "missing":
        model_path.unlink()
    elif modification == "path":
        catalog_path.write_text(yaml.safe_dump({"models": [{"file": "../orders.yaml"}]}))
    else:
        data = yaml.safe_load(model_path.read_text())
        data["models"][0]["label"] = "x" * 1025
        model_path.write_text(yaml.safe_dump(data))
    with pytest.raises(SemanticRefusal, match="engine_unavailable"):
        describe_catalog(directory)


def test_route_et_contrats(monde: Monde, service: CatalogService, tmp_path: Path) -> None:
    path = f"/api/spaces/{A}/explorer/fields"
    with _client(monde, service, tmp_path) as client:
        directory = tmp_path / "models"
        model_path = directory / "orders.yaml"
        document = yaml.safe_load(model_path.read_text())
        model = document["models"][0]
        model.update({"label": "Commandes", "description": "Description des commandes"})
        model["metrics"][0].update({"label": "Chiffre d'affaires", "description": "Montant total"})
        model["dimensions"] = [
            {
                "name": "jour",
                "label": "Jour",
                "description": "Date de commande",
                "type": "date",
                "sql": "jour",
            }
        ]
        model_path.write_text(yaml.safe_dump(document))
        catalog_path = directory / "semantic_catalog.yaml"
        catalog = yaml.safe_load(catalog_path.read_text())
        catalog["models"][0]["dimensions"] = ["jour"]
        catalog_path.write_text(yaml.safe_dump(catalog))
        response = _call(client, monde, LECTEUR_GROUPE, "GET", path)
        _contract(response, "champs.json")
        assert _call(client, monde, NON_MEMBRE, "GET", path).status_code == 404
        assert _call(client, monde, PLATEFORME_SEULE, "GET", path).status_code == 403
        assert (
            _call(
                client, monde, LECTEUR_GROUPE, "GET", f"/api/spaces/{B}/explorer/fields"
            ).status_code
            == 404
        )
    _contract(monde.requete(LECTEUR_GROUPE, "GET", path), "moteur-indisponible.json")
    with TestClient(create_app(service), base_url="http://127.0.0.1") as client:
        response = client.get("/api/spaces/local/explorer/fields")
        assert response.json()["error"]["code"] == "local_mode"


def test_deux_modeles_types_et_execution_duckdb(tmp_path: Path) -> None:
    from skifer_board.execution.connectors import DuckDbEndpoint, DuckDbExecution
    from skifer_board.execution.semantic import SemanticRequest

    from execution.test_semantic import _binding, _database, _reader, _run

    directory = tmp_path / "models"
    directory.mkdir()
    entries = []
    for name in ("zeta", "alpha"):
        dimensions = [
            {"name": f"d_{kind}", "type": kind, "sql": "region"}
            for kind in (
                "string",
                "number",
                "integer",
                "float",
                "date",
                "timestamp",
                "datetime",
                "boolean",
                "autre",
            )
        ]
        metrics = [
            {"name": f"m_{kind}", "type": kind, "sql": "amount"}
            for kind in ("sum", "count", "count_distinct", "avg", "min", "max", "ratio")
        ]
        model = {
            "name": name,
            "table": "main.orders",
            "row_policy": {"column": "tenant", "attribute": "tenant"},
            "metrics": metrics,
            "dimensions": dimensions,
        }
        (directory / f"{name}.yaml").write_text(yaml.safe_dump({"models": [model]}))
        entries.append(
            {
                "key": name,
                "file": f"{name}.yaml",
                "metrics": [m["name"] for m in metrics],
                "dimensions": [d["name"] for d in dimensions],
            }
        )
    (directory / "semantic_catalog.yaml").write_text(yaml.safe_dump({"models": entries}))
    described = describe_catalog(directory)["models"]
    assert [model["name"] for model in described] == ["alpha", "zeta"]
    metrics_by_name = {m["name"]: m for m in described[0]["metrics"]}
    assert metrics_by_name["m_sum"]["additivity"] == "additive"
    assert all(
        metrics_by_name[f"m_{kind}"]["additivity"] == "non_additive"
        for kind in ("avg", "count_distinct", "ratio")
    )
    assert {nom: item["aggregation"] for nom, item in metrics_by_name.items()} == {
        "m_avg": "avg",
        "m_count": "count",
        "m_count_distinct": "count_distinct",
        "m_max": "max",
        "m_min": "min",
        "m_ratio": None,
        "m_sum": "sum",
    }
    dimensions_by_name = {d["name"]: d for d in described[0]["dimensions"]}
    assert {nom: item["type"] for nom, item in dimensions_by_name.items()} == {
        "d_autre": "unknown",
        "d_boolean": "boolean",
        "d_date": "date",
        "d_datetime": "timestamp",
        "d_float": "number",
        "d_integer": "number",
        "d_number": "number",
        "d_string": "string",
        "d_timestamp": "timestamp",
    }
    assert {nom for nom, item in dimensions_by_name.items() if item["is_time"]} == {
        "d_date",
        "d_datetime",
        "d_timestamp",
    }
    assert describe_catalog(directory)["models"] == described
    database = _database(tmp_path)
    for model in described:
        output = _run(
            SemanticRequest(model["name"], ("m_sum",), ("d_string",)),
            _reader("alice", "A"),
            _binding(),
            DuckDbExecution(DuckDbEndpoint(database)),
            directory,
        )
        assert output.rows.num_rows == 2


def test_mode_local_sans_base(service: CatalogService) -> None:
    with TestClient(create_app(service), base_url="http://127.0.0.1") as client:
        response = client.get("/api/spaces/local/explorer/fields")
        _contract(response, "champs-mode-local.json")


@pytest.mark.parametrize(
    "cas",
    [
        "doublon",
        "trop_modeles",
        "champs",
        "nom",
        "nom_point",
        "nom_souligne",
        "texte_null",
        "label_dimension",
        "symlink",
    ],
)
def test_autres_catalogues_invalides(
    tmp_path: Path, cas: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    directory = _models(tmp_path)
    catalog_path = directory / "semantic_catalog.yaml"
    catalog = yaml.safe_load(catalog_path.read_text())
    if cas == "doublon":
        catalog["models"].append(catalog["models"][0])
    elif cas == "trop_modeles":
        original = (directory / "orders.yaml").read_text()
        catalog["models"] = []
        for index in range(101):
            filename = f"modele_{index}.yaml"
            (directory / filename).write_text(original)
            catalog["models"].append(
                {
                    "key": f"modele_{index}",
                    "file": filename,
                    "metrics": ["revenue"],
                    "dimensions": [],
                }
            )
        from skifer_board.execution import semantic

        premiere = catalog["models"][0]
        monkeypatch.setattr(
            vars(semantic)["SemanticEngine"], "list_models", lambda self: [premiere]
        )
    elif cas == "champs":
        catalog["models"][0]["metrics"] = ["autre"]
    elif cas in {"nom", "nom_point", "nom_souligne"}:
        catalog["models"][0]["key"] = {
            "nom": "nom invalide",
            "nom_point": "modele.champ",
            "nom_souligne": "_modele",
        }[cas]
    elif cas in {"texte_null", "label_dimension"}:
        model_path = directory / "orders.yaml"
        document = yaml.safe_load(model_path.read_text())
        if cas == "texte_null":
            document["models"][0]["label"] = None
        else:
            document["models"][0]["dimensions"] = [{"name": "jour", "label": None}]
            catalog["models"][0]["dimensions"] = ["jour"]
        model_path.write_text(yaml.safe_dump(document))
    else:
        external = tmp_path / "externe.yaml"
        external.write_text((directory / "orders.yaml").read_text())
        (directory / "lien.yaml").symlink_to(external)
        catalog["models"][0]["file"] = "lien.yaml"
    catalog_path.write_text(yaml.safe_dump(catalog))
    with pytest.raises(SemanticRefusal, match="engine_unavailable"):
        describe_catalog(directory)


def test_permissions_et_retrait(monde: Monde, service: CatalogService, tmp_path: Path) -> None:
    path = f"/api/spaces/{A}/explorer/fields"
    with _client(monde, service, tmp_path) as client:
        for profil in (
            LECTEUR_GROUPE,
            LECTEUR_PERSONNE,
            CREATEUR_GROUPE,
            ADMIN_GROUPE,
            ADMIN_PERSONNE,
            PLATEFORME_LECTEUR,
        ):
            fields = _call(client, monde, profil, "GET", path)
            submit = _call(client, monde, profil, "POST", PATH, json={})
            assert fields.status_code == 200
            assert submit.status_code == 400
        for profil in (NON_MEMBRE, PLATEFORME_SEULE):
            fields = _call(client, monde, profil, "GET", path)
            submit = _call(client, monde, profil, "POST", PATH, json={})
            assert (fields.status_code, fields.json()) == (submit.status_code, submit.json())
        _contract(_call(client, monde, NON_MEMBRE, "GET", path), "champs-non-membre.json")
        _contract(_call(client, monde, PLATEFORME_SEULE, "GET", path), "champs-interdits.json")
        _contract(
            _call(client, monde, LECTEUR_GROUPE, "GET", f"/api/spaces/{B}/explorer/fields"),
            "champs-non-membre.json",
        )
        monde.magasin.remove_binding(A, monde.liaisons["a-luc"], ADMIN_GROUPE.ref, monde.horloge())
        _contract(_call(client, monde, LECTEUR_PERSONNE, "GET", path), "champs-non-membre.json")
        assert _call(client, monde, LECTEUR_PERSONNE, "POST", PATH, json={}).status_code == 404
        monde.magasin.set_binding(
            A, GroupPrincipal("lecture-admin"), Role.READER, ADMIN_GROUPE.ref, monde.horloge()
        )
        admin_lecteur = Profil(
            "admin-lecteur", "admin-lecteur", ("finance-admins", "lecture-admin")
        )
        assert _call(client, monde, admin_lecteur, "GET", path).status_code == 200
        assert _call(client, monde, admin_lecteur, "POST", PATH, json={}).status_code == 400


def test_sentinelles_route_sans_connecteur(
    monde: Monde, service: CatalogService, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    directory = _models(tmp_path)
    model_path = directory / "orders.yaml"
    model = yaml.safe_load(model_path.read_text())
    model["models"][0].update(
        {
            "name": "main.NOM_MODELE_SENTINELLE.orders_tbl",
            "table": "TABLE_SENTINELLE",
            "source": "SOURCE_SENTINELLE",
            "row_policy": {"column": "POLITIQUE_SENTINELLE"},
        }
    )
    model["models"][0]["metrics"][0]["sql"] = "SQL_SENTINELLE"
    model_path.write_text(yaml.safe_dump(model))
    sentinel_path = directory / "CHEMIN_SENTINELLE.yaml"
    model_path.rename(sentinel_path)
    catalog_path = directory / "semantic_catalog.yaml"
    catalog = yaml.safe_load(catalog_path.read_text())
    catalog["models"][0]["file"] = sentinel_path.name
    catalog_path.write_text(yaml.safe_dump(catalog))

    def interdit(*args: object, **kwargs: object) -> None:
        raise AssertionError("Le connecteur ne doit pas être appelé")

    monkeypatch.setattr(DuckDbExecution, "execute", interdit)
    with _client(monde, service, tmp_path, execution_models_dir=directory) as client:
        # _client prépare sa fixture ; rétablir l'entrée du catalogue après cette préparation.
        catalog_path.write_text(yaml.safe_dump(catalog))
        response = _call(client, monde, LECTEUR_GROUPE, "GET", f"/api/spaces/{A}/explorer/fields")
        assert response.status_code == 200
        for valeur in (
            "TABLE_SENTINELLE",
            "NOM_MODELE_SENTINELLE",
            "SOURCE_SENTINELLE",
            "POLITIQUE_SENTINELLE",
            "SQL_SENTINELLE",
            "CHEMIN_SENTINELLE",
            str(directory),
        ):
            assert valeur not in response.text


@pytest.mark.parametrize(
    "cas",
    [
        "liste",
        "resume",
        "trop_definitions",
        "trop_resume",
        "element",
        "doublon_definition",
        "doublon_resume",
        "texte",
        "nom_champ",
        "type_non_texte",
        "semi_additif",
        "additivite_inconnue",
    ],
)
def test_formes_des_champs(tmp_path: Path, cas: str) -> None:
    directory = _models(tmp_path)
    model_path = directory / "orders.yaml"
    catalog_path = directory / "semantic_catalog.yaml"
    document = yaml.safe_load(model_path.read_text())
    model = document["models"][0]
    catalog = yaml.safe_load(catalog_path.read_text())
    entry = catalog["models"][0]
    metric = model["metrics"][0]
    if cas == "liste":
        model["metrics"] = "incorrect"
    elif cas == "resume":
        entry["metrics"] = "incorrect"
    elif cas == "trop_definitions":
        model["metrics"] = [{**metric, "name": f"m_{i}"} for i in range(501)]
        entry["metrics"] = [f"m_{i}" for i in range(501)]
    elif cas == "trop_resume":
        model["metrics"] = [{**metric, "name": f"m_{i}"} for i in range(501)]
        entry["metrics"] = [f"m_{i}" for i in range(501)]
    elif cas == "element":
        model["metrics"] = ["incorrect"]
    elif cas == "doublon_definition":
        model["metrics"].append(metric)
    elif cas == "doublon_resume":
        entry["metrics"].append("revenue")
    elif cas == "texte":
        metric["label"] = 42
    elif cas == "nom_champ":
        metric["name"] = "invalide!"
    elif cas == "type_non_texte":
        model["dimensions"] = [{"name": "region", "type": 7, "sql": "region"}]
        entry["dimensions"] = [{"name": "region"}]
    elif cas == "semi_additif":
        metric["additivity"] = "semi_additive"
    else:
        metric["additivity"] = "inconnue"
    if cas in {"trop_definitions", "trop_resume"}:
        from skifer_board.execution.semantic import _fields

        # Les deux listes contiennent les mêmes 501 noms distincts ; seul le compte
        # de l'autre liste est masqué pour éprouver indépendamment chaque garde.
        if cas == "trop_definitions":
            entry["metrics"] = ListeSousLaBorne(entry["metrics"])
        else:
            model["metrics"] = ListeSousLaBorne(model["metrics"])
        with pytest.raises(ValueError, match="Trop de champs"):
            _fields(model, entry, "metrics")
        return
    model_path.write_text(yaml.safe_dump(document))
    catalog_path.write_text(yaml.safe_dump(catalog))
    if cas in {"type_non_texte", "semi_additif", "additivite_inconnue"}:
        result = describe_catalog(directory)["models"][0]
        if cas == "type_non_texte":
            assert result["dimensions"][0]["type"] == "unknown"
        else:
            attendu = "semi_additive" if cas == "semi_additif" else "non_additive"
            assert result["metrics"][0]["additivity"] == attendu
    else:
        with pytest.raises(SemanticRefusal, match="engine_unavailable"):
            describe_catalog(directory)


def test_catalogue_invalide_refuse_par_la_route(
    monde: Monde, service: CatalogService, tmp_path: Path
) -> None:
    with _client(monde, service, tmp_path) as client:
        directory = tmp_path / "models"
        model = directory / "orders.yaml"
        catalog = directory / "semantic_catalog.yaml"
        initial_model, initial_catalog = model.read_text(), catalog.read_text()
        for cas in ("politique", "yaml", "fichier", "chemin", "borne"):
            model.write_text(initial_model)
            catalog.write_text(initial_catalog)
            document = yaml.safe_load(initial_model)
            if cas == "politique":
                del document["models"][0]["row_policy"]
                model.write_text(yaml.safe_dump(document))
            elif cas == "yaml":
                catalog.write_text("[")
            elif cas == "fichier":
                model.unlink()
            elif cas == "chemin":
                catalog.write_text(
                    yaml.safe_dump({"models": [{"key": "orders", "file": "../orders.yaml"}]})
                )
            else:
                document["models"][0]["label"] = "x" * 1025
                model.write_text(yaml.safe_dump(document))
            response = _call(
                client, monde, LECTEUR_GROUPE, "GET", f"/api/spaces/{A}/explorer/fields"
            )
            _contract(response, "moteur-indisponible.json")


def test_moteur_rendant_un_catalogue_vide(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from skifer_board.execution import semantic

    directory = _models(tmp_path)
    monkeypatch.setattr(vars(semantic)["SemanticEngine"], "list_models", lambda self: [])
    with pytest.raises(SemanticRefusal, match="engine_unavailable"):
        describe_catalog(directory)


def test_borne_modeles_rendus_par_le_moteur(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from skifer_board.execution import semantic

    directory = _models(tmp_path)
    model = yaml.safe_load((directory / "orders.yaml").read_text())["models"][0]
    entries = [
        {"key": f"modele_{index}", "file": "orders.yaml", "metrics": ["revenue"], "dimensions": []}
        for index in range(101)
    ]
    engine = vars(semantic)["SemanticEngine"]
    monkeypatch.setattr(engine, "list_models", lambda self: entries)
    monkeypatch.setattr(engine, "_get_model", lambda self, name: model)
    with pytest.raises(SemanticRefusal, match="engine_unavailable"):
        describe_catalog(directory)


def test_backend_de_description_refuse_toute_execution() -> None:
    from skifer_board.execution.semantic import _DescriptionBackend

    with pytest.raises(RuntimeError, match="aucune source"):
        _DescriptionBackend().execute_sql("sentinelle")


def test_yaml_trop_imbrique_refuse(tmp_path: Path) -> None:
    directory = _models(tmp_path)
    (directory / "semantic_catalog.yaml").write_text("models: " + "[" * 2000 + "]" * 2000)
    with pytest.raises(SemanticRefusal, match="engine_unavailable"):
        describe_catalog(directory)
