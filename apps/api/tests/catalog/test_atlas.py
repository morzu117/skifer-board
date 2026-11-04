"""Valeurs hors contrat et bases dépourvues d'index : refus explicites."""

from dataclasses import asdict
from pathlib import Path

import duckdb
import pytest
from skifer_board.catalog import AtlasStatus, DocumentKind, atlas


@pytest.mark.parametrize(
    ("champ", "valeur"),
    [
        ("kind", "metrique-inconnue"),
        ("status", "publie"),
    ],
)
def test_entree_hors_contrat(champ: str, valeur: str) -> None:
    """Aucun statut ni type inconnu n'est remplacé par une valeur inventée."""
    ligne = {"kind": "kpi", "status": "validated", champ: valeur}
    with pytest.raises(ValueError):
        atlas._entry(ligne)


@pytest.mark.parametrize("valeur", ["publie", "retire", ""])
def test_statut_reference_hors_contrat(valeur: str) -> None:
    """Un statut optionnel reste soumis au contrat fermé."""
    with pytest.raises(ValueError):
        atlas._optional_status(valeur)


@pytest.mark.parametrize(("champ", "valeur"), [("kind", "inconnu"), ("status", "publie")])
def test_facettes_hors_contrat(
    monkeypatch: pytest.MonkeyPatch,
    champ: str,
    valeur: str,
) -> None:
    """Les facettes ne laissent pas passer une nouvelle valeur Atlas."""
    valeurs = {"domain": [], "owner": [], "status": ["validated"], "kind": ["kpi"]}
    valeurs[champ] = [valeur]
    monkeypatch.setattr("skifer_atlas.index.search.facets", lambda _: valeurs)
    with duckdb.connect() as connexion, pytest.raises(ValueError):
        atlas.read_facets(connexion)


def test_base_sans_index(tmp_path: Path) -> None:
    """Une base DuckDB vide n'est pas un dernier index exploitable."""
    chemin = tmp_path / "vide.duckdb"
    with duckdb.connect(str(chemin)) as connexion, pytest.raises(ValueError):
        atlas.indexed_commit(connexion)
    assert atlas.open_last_index(chemin) is None
    assert atlas.open_last_index(tmp_path / "absent.duckdb") is None


def test_champs_optionnels_et_convergence_ignoree() -> None:
    """Les champs absents restent absents et la convergence Atlas n'est pas relayée."""
    entree = atlas._entry(
        {
            "id": "incomplet",
            "kind": "kpi",
            "label": "Incomplet",
            "status": "needs_curation",
            "domain": None,
            "owner": None,
            "version": None,
            "description": None,
            "synonyms": [],
            "convergence": "converged",
        }
    )
    assert entree.kind is DocumentKind.KPI
    assert entree.status is AtlasStatus.NEEDS_CURATION
    assert entree.version is None
    assert entree.owner is None
    assert entree.domain is None
    assert entree.description is None
    assert entree.variant_count == 0
    assert "convergence" not in asdict(entree)
    assert entree.availability is not None
    assert entree.availability.state.value == "unresolved"
    assert entree.availability.reason is not None
    assert entree.availability.reason.value == "not_validated"
