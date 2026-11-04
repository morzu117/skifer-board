"""Lectures d'Atlas mesurées (plan 11, 11.2 ; T2, T3) : opération nommée, issue, documents
rendus, taille de l'index lu, durée ; jamais l'identifiant du document."""

from __future__ import annotations

import json
import shutil
import time
from pathlib import Path
from unittest.mock import Mock

import pytest
from catalog.conftest import INSTANT
from catalog.conftest import espace as espace
from catalog.conftest import espace_versionne as espace_versionne
from catalog.conftest import service as service
from catalog.test_versions import taguer
from skifer_board.catalog import (
    CatalogPage,
    CatalogService,
    DiffPage,
    DocumentPage,
    VersionsPage,
)
from skifer_board.telemetry import Kind, Measure


@pytest.fixture
def mesures() -> list[Measure]:
    return []


@pytest.fixture
def mesure(service: CatalogService, mesures: list[Measure]) -> CatalogService:
    """Le service des tests du catalogue, branché sur une liste de mesures."""
    return CatalogService(service.config, lambda: INSTANT, measure=mesures.append)


def seule(mesures: list[Measure]) -> Measure:
    assert len(mesures) == 1
    trouvee = mesures.pop()
    assert trouvee.kind is Kind.ATLAS
    assert (trouvee.method, trouvee.status, trouvee.space, trouvee.environment) == (None,) * 4
    assert trouvee.at == INSTANT
    assert 0 <= trouvee.duration_ms < 60_000
    return trouvee


def taille(service: CatalogService) -> int:
    return service.config.index_path.stat().st_size


def test_liste_mesuree(mesure: CatalogService, mesures: list[Measure]) -> None:
    page = mesure.list()
    assert isinstance(page, CatalogPage) and len(page.entries) > 1
    lue = seule(mesures)
    assert (lue.operation, lue.outcome) == ("atlas.list", "ok")
    assert (lue.rows, lue.size) == (len(page.entries), taille(mesure))
    filtree = mesure.list(q="revenu")
    assert isinstance(filtree, CatalogPage)
    assert seule(mesures).rows == len(filtree.entries) < len(page.entries)
    vide = mesure.list(q="aucun-document-ne-porte-ce-nom")
    assert isinstance(vide, CatalogPage) and vide.entries == ()
    assert seule(mesures).rows == 0


def test_fiche_mesuree(mesure: CatalogService, mesures: list[Measure]) -> None:
    assert isinstance(mesure.get("revenu-net"), DocumentPage)
    lue = seule(mesures)
    assert (lue.operation, lue.outcome, lue.rows, lue.size) == (
        "atlas.document",
        "ok",
        1,
        taille(mesure),
    )
    assert mesure.get("document-inconnu") is None
    absente = seule(mesures)
    assert (absente.operation, absente.outcome, absente.rows) == (
        "atlas.document",
        "document_not_found",
        None,
    )
    assert absente.size == taille(mesure)


def test_catalogue_indisponible(
    mesure: CatalogService, mesures: list[Measure], tmp_path: Path
) -> None:
    mesure.config.repository.rename(tmp_path / "clone-retire")
    mesure.list()
    mesure.get("revenu-net")
    assert [(m.operation, m.outcome, m.rows, m.size) for m in mesures] == [
        ("atlas.list", "catalog_unavailable", None, None),
        ("atlas.document", "catalog_unavailable", None, None),
    ]


def test_versions_mesurees(
    espace_versionne: Path, mesure: CatalogService, mesures: list[Measure]
) -> None:
    trouvees = mesure.versions("revenu-net")
    assert isinstance(trouvees, VersionsPage)
    lue = seule(mesures)
    assert (lue.operation, lue.outcome, lue.rows, lue.size) == (
        "atlas.versions",
        "ok",
        len(trouvees.versions),
        taille(mesure),
    )
    assert lue.rows == 3
    assert mesure.versions("document-inconnu") is None
    assert (seule(mesures).outcome, mesure.config.index_path.is_file()) == (
        "document_not_found",
        True,
    )
    shutil.rmtree(espace_versionne)
    mesure.versions("revenu-net")
    absente = seule(mesures)
    assert (absente.outcome, absente.rows) == ("history_unavailable", None)
    # L'index reste lisible : sa taille est mesurée même quand l'historique ne l'est pas.
    assert absente.size == taille(mesure)


def test_versions_sans_index_ni_clone(
    espace: Path, mesure: CatalogService, mesures: list[Measure]
) -> None:
    shutil.rmtree(espace)
    mesure.versions("revenu-net")
    mesure.diff("revenu-net", 4, 5)
    assert [(m.operation, m.outcome, m.rows, m.size) for m in mesures] == [
        ("atlas.versions", "history_unavailable", None, None),
        ("atlas.diff", "history_unavailable", None, None),
    ]


@pytest.mark.parametrize(
    ("document", "base", "autre", "issue"),
    [
        ("revenu-net", 4, 5, "ok"),
        ("revenu-net", 4, 99, "version_not_found"),
        ("revenu-net", 3, 5, "diff_unavailable"),
        ("commande", 1, 2, "diff_not_supported"),
        ("document-inconnu", 1, 2, "document_not_found"),
    ],
)
def test_ecart_mesure(
    espace_versionne: Path,
    mesure: CatalogService,
    mesures: list[Measure],
    document: str,
    base: int,
    autre: int,
    issue: str,
) -> None:
    taguer(espace_versionne, "commande", 1)
    taguer(espace_versionne, "commande", 2)
    trouve = mesure.diff(document, base, autre)
    assert isinstance(trouve, DiffPage) == (issue == "ok")
    lue = seule(mesures)
    # Un écart n'est pas un nombre de documents.
    assert (lue.operation, lue.outcome, lue.rows, lue.size) == (
        "atlas.diff",
        issue,
        None,
        taille(mesure),
    )
    assert document not in json.dumps(lue.to_json())


@pytest.mark.parametrize(
    ("methode", "arguments", "operation", "lecteur"),
    [
        ("list", (), "atlas.list", "read_facets"),
        ("get", ("revenu-net",), "atlas.document", "read_document"),
        ("versions", ("revenu-net",), "atlas.versions", "read_versions"),
        ("diff", ("revenu-net", 4, 5), "atlas.diff", "read_diff"),
    ],
)
def test_exception_mesuree_en_erreur_puis_remontee(
    espace_versionne: Path,
    mesure: CatalogService,
    mesures: list[Measure],
    monkeypatch: pytest.MonkeyPatch,
    methode: str,
    arguments: tuple[object, ...],
    operation: str,
    lecteur: str,
) -> None:
    monkeypatch.setattr(
        f"skifer_board.catalog.service.{lecteur}", Mock(side_effect=RuntimeError("secret"))
    )
    with pytest.raises(RuntimeError, match="secret"):
        getattr(mesure, methode)(*arguments)
    lue = seule(mesures)
    assert (lue.operation, lue.outcome, lue.rows) == (operation, "error", None)
    assert lue.size == taille(mesure)


def test_duree_mesuree_autour_de_la_lecture(
    mesure: CatalogService, mesures: list[Measure], monkeypatch: pytest.MonkeyPatch
) -> None:
    instants = iter([10.0, 10.75])
    monkeypatch.setattr(time, "perf_counter", lambda: next(instants))
    mesure.get("revenu-net")
    assert seule(mesures).duration_ms == pytest.approx(750.0)


def test_sans_mesure_fournie_rien_ne_part(service: CatalogService) -> None:
    """Le service par défaut ignore ses mesures : les tests du catalogue n'en dépendent pas."""
    assert isinstance(service.get("revenu-net"), DocumentPage)
