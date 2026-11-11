"""Serveur réel des analyses (plan 18.2) : base migrée, espaces et rôles du plan 08, dépôt de
contenus git jetable et catalogue sémantique de test (plan 19.2 : et les routes des dashboards)."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import duckdb
import pytest
import yaml
from catalog.conftest import service as service
from fastapi.testclient import TestClient
from httpx2 import Response
from identity.conftest import horloge as horloge
from skifer_board.catalog import CatalogService
from skifer_board.content import ContentRepository
from skifer_board.content.events import UsageKey
from skifer_board.content.index import AnalysisIndex, DashboardIndex
from skifer_board.execution import ConnectionStore
from skifer_board.execution.connectors import DuckDbEndpoint
from skifer_board.execution.model import Connector, IdentityMode
from skifer_board.execution.vault import VaultKeys
from skifer_board.server import create_app
from skifer_board.spaces.model import Environment, PersonRef
from spaces.monde import (
    ADMIN_GROUPE,
    COOKIE,
    LECTEUR_PERSONNE,
    ORIGINE,
    A,
    Monde,
    Profil,
    espaces_en_base,
)

from .monde import document, init, new_id, repository
from .monde_dashboard import with_components

CHEMIN = f"/api/spaces/{A}/analyses"
CHEMIN_TABLEAUX = f"/api/spaces/{A}/dashboards"
CLE_D_USAGE = UsageKey(b"u" * 32)


def modeles(racine: Path) -> Path:
    """Catalogue de test : un modèle `sales` aux métriques de chaque agrégation."""
    dossier = racine / "modeles"
    dossier.mkdir(exist_ok=True)
    metriques = [
        {"name": "revenue", "type": "sum", "sql": "amount"},
        {"name": "orders", "type": "count", "sql": "amount"},
        {"name": "balance", "type": "sum", "sql": "amount", "additivity": "semi_additive"},
        {"name": "buyers", "type": "count_distinct", "sql": "amount"},
        {"name": "basket", "type": "avg", "sql": "amount"},
        {"name": "rate", "type": "ratio", "sql": "amount"},
        {"name": "lowest", "type": "min", "sql": "amount"},
    ]
    dimensions = [
        {"name": "region", "type": "string", "sql": "region"},
        {"name": "channel", "type": "string", "sql": "region"},
        {"name": "year", "type": "number", "sql": "region"},
        {"name": "day", "type": "date", "sql": "region"},
        {"name": "active", "type": "boolean", "sql": "region"},
    ]
    modele = {
        "name": "sales",
        "table": "main.sales",
        "row_policy": {"column": "tenant", "attribute": "tenant"},
        "metrics": metriques,
        "dimensions": dimensions,
    }
    (dossier / "sales.yaml").write_text(yaml.safe_dump({"models": [modele]}))
    (dossier / "semantic_catalog.yaml").write_text(
        yaml.safe_dump(
            {
                "models": [
                    {
                        "key": "sales",
                        "file": "sales.yaml",
                        "metrics": [m["name"] for m in metriques],
                        "dimensions": [d["name"] for d in dimensions],
                    }
                ]
            }
        )
    )
    return dossier


def corps(**changes: Any) -> dict[str, Any]:
    """Corps d'une création : le document d'exemple sans les champs que pose le serveur."""
    valeur = document(new_id(), **changes)
    for nom in ("api_version", "id", "owner"):
        del valeur[nom]
    return valeur


def corps_tableau(*composants: dict[str, Any], **changes: Any) -> dict[str, Any]:
    """Corps d'une création de dashboard : le document d'exemple, avec ces composants dans son
    unique colonne, sans les champs que pose le serveur."""
    valeur = with_components(*composants, **changes)
    for nom in ("api_version", "id", "owner"):
        del valeur[nom]
    return valeur


@dataclass
class Banc:
    monde: Monde
    client: TestClient
    racine: Path
    depot: ContentRepository
    dossier_modeles: Path
    index: AnalysisIndex
    tableaux: DashboardIndex

    def appel(self, profil: Profil | None, methode: str, chemin: str, **options: Any) -> Response:
        entetes = {"Origin": ORIGINE}
        if profil is not None:
            entetes["Cookie"] = f"{COOKIE}={self.monde.session(profil)}"
        return self.client.request(methode, chemin, headers=entetes, **options)

    def creer(self, profil: Profil, **changes: Any) -> Response:
        return self.appel(profil, "POST", CHEMIN, json=corps(**changes))

    def creer_ok(self, profil: Profil, **changes: Any) -> str:
        reponse = self.creer(profil, **changes)
        assert reponse.status_code == 201, reponse.text
        identifiant: str = reponse.json()["id"]
        return identifiant

    def creer_tableau(
        self, profil: Profil, *composants: dict[str, Any], **changes: Any
    ) -> Response:
        corps_ = corps_tableau(*composants, **changes)
        return self.appel(profil, "POST", CHEMIN_TABLEAUX, json=corps_)

    def creer_tableau_ok(self, profil: Profil, *composants: dict[str, Any], **changes: Any) -> str:
        reponse = self.creer_tableau(profil, *composants, **changes)
        assert reponse.status_code == 201, reponse.text
        identifiant: str = reponse.json()["id"]
        return identifiant

    def reviser_tableau(
        self,
        profil: Profil,
        identifiant: str,
        revision: int,
        *composants: dict[str, Any],
        **changes: Any,
    ) -> Response:
        return self.appel(
            profil,
            "POST",
            f"{CHEMIN_TABLEAUX}/{identifiant}/revisions",
            json={**corps_tableau(*composants, **changes), "expected_revision": revision},
        )

    def redefinir(self, metriques: list[str], dimensions: list[str]) -> None:
        """Le catalogue change sous les pieds d'une analyse : seuls ces champs subsistent."""
        modeles(self.dossier_modeles.parent)
        fichier = self.dossier_modeles / "sales.yaml"
        modele = yaml.safe_load(fichier.read_text())
        entree = modele["models"][0]
        entree["metrics"] = [item for item in entree["metrics"] if item["name"] in metriques]
        entree["dimensions"] = [item for item in entree["dimensions"] if item["name"] in dimensions]
        fichier.write_text(yaml.safe_dump(modele))
        catalogue_fichier = self.dossier_modeles / "semantic_catalog.yaml"
        catalogue = yaml.safe_load(catalogue_fichier.read_text())
        catalogue["models"][0]["metrics"] = metriques
        catalogue["models"][0]["dimensions"] = dimensions
        catalogue_fichier.write_text(yaml.safe_dump(catalogue))

    def reviser(self, profil: Profil, identifiant: str, revision: int, **changes: Any) -> Response:
        return self.appel(
            profil,
            "POST",
            f"{CHEMIN}/{identifiant}/revisions",
            json={**corps(**changes), "expected_revision": revision},
        )


def base_de_ventes(racine: Path) -> Path:
    """Base DuckDB où `main.sales` existe : les exécutions acceptées y aboutissent."""
    chemin = racine / "ventes.duckdb"
    with duckdb.connect(str(chemin)) as connexion:
        connexion.execute("CREATE TABLE sales (tenant VARCHAR, amount INTEGER, region VARCHAR)")
        connexion.execute("INSERT INTO sales VALUES ('A', 12, 'Sud'), ('B', 100, 'Nord')")
    return chemin


def connecter_finance(monde: Monde) -> None:
    """Connexion logique `finance`, liée en DEV à la base de ventes (identité de service)."""
    acteur = PersonRef.of(ADMIN_GROUPE.identite)
    registre = ConnectionStore(monde.moteur)
    registre.create(A, "finance", acteur, monde.horloge())
    registre.bind(
        A,
        "finance",
        Environment.DEV,
        Connector.DUCKDB,
        "ventes",
        IdentityMode.SERVICE,
        acteur,
        monde.horloge(),
    )


def ouvrir(
    monde: Monde,
    service: CatalogService,
    racine: Path,
    **options: Any,
) -> Iterator[Banc]:
    depot = repository(init(racine / "contenus"), clock=monde.horloge)
    dossier = modeles(racine)
    connecter_finance(monde)
    app = create_app(
        service,
        monde.runtime,
        espaces_en_base(monde.moteur, monde.horloge),
        connections=ConnectionStore(monde.moteur),
        vault_keys=VaultKeys("test", {"test": b"1" * 32}),
        execution_models_dir=dossier,
        execution_certification_mode="off",
        endpoints={"ventes": DuckDbEndpoint(base_de_ventes(racine))},
        execution_reader_attributes=options.get("attributs", lambda identite: {"tenant": "A"}),
        content_repository=options.get("content_repository", depot),
        usage_key=options.get("usage_key", CLE_D_USAGE),
    )
    with TestClient(
        app, base_url=ORIGINE, follow_redirects=False, raise_server_exceptions=False
    ) as client:
        yield Banc(
            monde,
            client,
            racine / "contenus",
            depot,
            dossier,
            AnalysisIndex(monde.moteur, monde.horloge),
            DashboardIndex(monde.moteur, monde.horloge),
        )


@pytest.fixture
def banc(monde: Monde, service: CatalogService, tmp_path: Path) -> Iterator[Banc]:
    yield from ouvrir(monde, service, tmp_path)


@pytest.fixture
def banc_sans_depot(monde: Monde, service: CatalogService, tmp_path: Path) -> Iterator[Banc]:
    """Serveur dont l'exploitation n'a pas configuré de dépôt de contenus."""
    yield from ouvrir(monde, service, tmp_path, content_repository=None)


@pytest.fixture
def banc_sans_tenant(monde: Monde, service: CatalogService, tmp_path: Path) -> Iterator[Banc]:
    """Serveur où `luc` n'a pas d'attribut de ligne : le moteur lui refuse ses exécutions."""

    def attributs(identite: Any) -> dict[str, str]:
        return {} if identite.subject == LECTEUR_PERSONNE.sujet else {"tenant": "A"}

    yield from ouvrir(monde, service, tmp_path, attributs=attributs)
