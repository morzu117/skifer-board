"""Aides des tests de validation, d'états et de contrat des routes des dashboards (plan 19.2) :
catalogue qui change sous les pieds d'une analyse, chemins des composants, recherche récursive."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import yaml
from httpx2 import Response
from skifer_board.content.repository import DASHBOARD_KIND
from spaces.monde import A

from .monde import relative
from .serveur import Banc, modeles

SECRET = "valeur_confidentielle_42"
# Dimension `year` de `sales` (nombre) et de `stock` (texte) : même nom, deux types.
STOCK = "stock"


def chemin(position: int = 0) -> str:
    """Chemin du composant `position` de l'unique colonne d'un dashboard de `with_components`."""
    return f"/layout/sections/0/rows/0/columns/0/children/{position}"


def chemin_dashboard(identifiant: str) -> str:
    """Chemin, dans le dépôt, du fichier d'un dashboard."""
    return relative(A, identifiant).replace("analyses/", f"{DASHBOARD_KIND.directory}/", 1)


def typer(banc: Banc, dimension: str, genre: str) -> None:
    """Le catalogue change le type d'une dimension du modèle `sales`."""
    fichier = banc.dossier_modeles / "sales.yaml"
    modele = yaml.safe_load(fichier.read_text())
    for item in modele["models"][0]["dimensions"]:
        if item["name"] == dimension:
            item["type"] = genre
    fichier.write_text(yaml.safe_dump(modele))


def ajouter_stock(banc: Banc) -> None:
    """Second modèle, `stock`, dont la dimension `year` est un texte (et non un nombre)."""
    dossier = banc.dossier_modeles
    metriques = [{"name": "revenue", "type": "sum", "sql": "amount"}]
    dimensions = [
        {"name": "region", "type": "string", "sql": "region"},
        {"name": "year", "type": "string", "sql": "region"},
    ]
    modele = {
        "name": STOCK,
        "table": "main.sales",
        "row_policy": {"column": "tenant", "attribute": "tenant"},
        "metrics": metriques,
        "dimensions": dimensions,
    }
    (dossier / "stock.yaml").write_text(yaml.safe_dump({"models": [modele]}))
    catalogue_fichier = dossier / "semantic_catalog.yaml"
    catalogue = yaml.safe_load(catalogue_fichier.read_text())
    catalogue["models"].append(
        {
            "key": STOCK,
            "file": "stock.yaml",
            "metrics": [item["name"] for item in metriques],
            "dimensions": [item["name"] for item in dimensions],
        }
    )
    catalogue_fichier.write_text(yaml.safe_dump(catalogue))


def seulement_stock(banc: Banc) -> None:
    """Le modèle `sales` disparaît du catalogue (après `ajouter_stock`) : seul `stock` reste."""
    catalogue_fichier = banc.dossier_modeles / "semantic_catalog.yaml"
    catalogue = yaml.safe_load(catalogue_fichier.read_text())
    catalogue["models"] = [item for item in catalogue["models"] if item["key"] == STOCK]
    catalogue_fichier.write_text(yaml.safe_dump(catalogue))
    (banc.dossier_modeles / "sales.yaml").unlink()


def sans_catalogue(banc: Banc) -> None:
    """Le moteur ne sait plus décrire le catalogue."""
    (banc.dossier_modeles / "semantic_catalog.yaml").unlink()


def restaurer_catalogue(banc: Banc) -> None:
    modeles(banc.dossier_modeles.parent)


def violations(reponse: Response) -> list[dict[str, str]]:
    result: list[dict[str, str]] = reponse.json()["error"]["violations"]
    return result


def refus_invalide(reponse: Response, *attendues: tuple[str, str]) -> None:
    """Refus `invalid_dashboard` : 422, violations `(chemin, règle)` exactes et triées, la
    première règle pour raison ; ni valeur de filtre ni nom dans le corps."""
    assert reponse.status_code == 422, reponse.text
    erreur = reponse.json()["error"]
    attendu = sorted(attendues)
    assert erreur == {
        "code": "invalid_dashboard",
        "reason": attendu[0][1],
        "violations": [{"path": chemin_, "rule": regle} for chemin_, regle in attendu],
    }
    assert SECRET not in reponse.text


def cles_et_textes(valeur: Any) -> Iterator[str]:
    """Chaque clé et chaque texte d'un JSON, à tous les niveaux."""
    if isinstance(valeur, dict):
        for cle, item in valeur.items():
            yield cle
            yield from cles_et_textes(item)
    elif isinstance(valeur, list):
        for item in valeur:
            yield from cles_et_textes(item)
    elif isinstance(valeur, str):
        yield valeur
