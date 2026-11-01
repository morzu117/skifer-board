"""Contrats publics du catalogue, exercés sur de vrais dépôts et index Atlas."""

import json
import re
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from skifer_board.catalog import (
    AtlasStatus,
    AvailabilityState,
    CatalogPage,
    CatalogService,
    CatalogUnavailable,
    DocumentKind,
    DocumentPage,
    Freshness,
    SourceProblem,
    UnresolvedReason,
)

from .conftest import INSTANT, commettre, git

ORDRE = (
    "brouillon",
    "commande",
    "date-de-reference",
    "invalide",
    "marge-brute",
    "panier-moyen",
    "revenu-net",
)


def liste(service: CatalogService) -> CatalogPage:
    """Exige une page disponible."""
    page = service.list()
    assert isinstance(page, CatalogPage)
    return page


def fiche(service: CatalogService, identifiant: str) -> DocumentPage:
    """Exige une fiche disponible."""
    page = service.get(identifiant)
    assert isinstance(page, DocumentPage)
    return page


def instantane(depot: Path) -> dict[str, bytes]:
    """Capture aussi les fichiers ignorés et les métadonnées git."""
    return {str(p.relative_to(depot)): p.read_bytes() for p in depot.rglob("*") if p.is_file()}


def test_liste_facettes_disponibilite_et_provenance(service: CatalogService) -> None:
    """Le catalogue reste fermé à l'exécution et porte la provenance du clone."""
    assert not service.config.state_dir.exists()
    page = liste(service)
    assert tuple(e.id for e in page.entries) == ORDRE
    assert page.facets.domain == ("finance", "ventes")
    assert page.facets.owner == ("claire.m", "marc.d")
    assert page.facets.status == (AtlasStatus.DRAFT, AtlasStatus.INVALID, AtlasStatus.VALIDATED)
    assert page.facets.kind == (DocumentKind.CONCEPT, DocumentKind.KPI)
    assert page.provenance.commit == git(service.config.repository, "rev-parse", "HEAD")
    assert page.provenance.read_at == INSTANT
    assert page.provenance.read_at.utcoffset() == timedelta(0)
    assert page.provenance.freshness is Freshness.FRESH
    assert page.provenance.problem is None
    assert page.provenance.detail is None
    assert service.config.index_path == service.config.state_dir / "catalogue.duckdb"
    assert service.config.index_path.is_file()
    assert not (service.config.state_dir / "index.duckdb").exists()
    assert not list(service.config.state_dir.glob("*.tmp"))
    assert json.loads(service.config.read_path.read_text()) == {
        "commit": page.provenance.commit,
        "read_at": INSTANT.isoformat(),
    }
    attendus = {
        "commande": AtlasStatus.VALIDATED,
        "date-de-reference": AtlasStatus.VALIDATED,
        "revenu-net": AtlasStatus.VALIDATED,
        "marge-brute": AtlasStatus.VALIDATED,
        "panier-moyen": AtlasStatus.VALIDATED,
        "brouillon": AtlasStatus.DRAFT,
        "invalide": AtlasStatus.INVALID,
    }
    for entree in page.entries:
        assert entree.status is attendus[entree.id]
        assert "convergence" not in asdict(entree)
        if entree.kind is DocumentKind.CONCEPT:
            assert entree.availability is None
        else:
            assert entree.availability is not None
            assert entree.availability.state is AvailabilityState.UNRESOLVED
            raison = (
                UnresolvedReason.MAPPING_ABSENT
                if entree.status is AtlasStatus.VALIDATED
                else UnresolvedReason.NOT_VALIDATED
            )
            assert entree.availability.reason is raison


@pytest.mark.parametrize(
    ("recherche", "attendus"),
    [
        ("Date de référence", ("date-de-reference",)),
        ("DATE DE REFERENCE", ("date-de-reference",)),
        ("date-de-reference", ("date-de-reference",)),
        ("DATE-DE-REFERENCE", ("date-de-reference",)),
        ("recettes consolidées", ("revenu-net",)),
        ("RECETTES CONSOLIDEES", ("revenu-net",)),
        ("taxes déduites", ("revenu-net",)),
        ("TAXES DEDUITES", ("revenu-net",)),
        ("introuvable", ()),
        ("  ", ORDRE),
        ("Revenu net", ("revenu-net", "brouillon", "invalide", "marge-brute", "panier-moyen")),
    ],
)
def test_recherche(service: CatalogService, recherche: str, attendus: tuple[str, ...]) -> None:
    """Recherche normalisée et classement libellé avant description."""
    page = service.list(q=recherche)
    assert isinstance(page, CatalogPage)
    assert tuple(e.id for e in page.entries) == attendus


@pytest.mark.parametrize(
    ("domain", "owner", "status", "kind", "attendus"),
    [
        ("finance", None, None, None, ("date-de-reference", "marge-brute", "revenu-net")),
        (None, "claire.m", None, None, ("date-de-reference", "marge-brute", "revenu-net")),
        (None, None, AtlasStatus.DRAFT, None, ("brouillon",)),
        (None, None, AtlasStatus.INVALID, None, ("invalide",)),
        (None, None, None, DocumentKind.CONCEPT, ("commande", "date-de-reference")),
        (
            "finance",
            "claire.m",
            AtlasStatus.VALIDATED,
            DocumentKind.KPI,
            ("marge-brute", "revenu-net"),
        ),
        ("finance", "marc.d", AtlasStatus.VALIDATED, DocumentKind.KPI, ()),
    ],
)
def test_filtres(
    service: CatalogService,
    domain: str | None,
    owner: str | None,
    status: AtlasStatus | None,
    kind: DocumentKind | None,
    attendus: tuple[str, ...],
) -> None:
    """Les filtres se combinent par intersection ; les facettes restent globales."""
    page = service.list(domain=domain, owner=owner, status=status, kind=kind)
    assert isinstance(page, CatalogPage)
    assert tuple(e.id for e in page.entries) == attendus
    assert page.facets == liste(service).facets


def test_fiches_declinaisons_references_et_impact(service: CatalogService) -> None:
    """Les fiches recopient les définitions, les variantes et leurs dépendances."""
    page = fiche(service, "revenu-net")
    doc = page.document
    assert page.provenance == liste(service).provenance
    assert doc.entry.label == "Revenu net"
    assert doc.entry.version == 4
    assert doc.entry.synonyms == ("CA net", "net revenue", "recettes consolidées")
    assert doc.path == "kpis/revenu-net.yaml"
    assert doc.fingerprint is not None
    assert re.fullmatch(r"sha256:atlas1:[0-9a-f]{64}", doc.fingerprint)
    assert doc.issues == ()
    assert doc.entry.variant_count == 2
    assert [
        (
            v.id,
            v.entity,
            v.mode,
            v.kpi_version,
            v.override_count,
            v.undeclared_count,
            v.version,
            v.owner,
            v.status,
        )
        for v in doc.variants
    ] == [
        (
            "revenu-net--nordis-es",
            "nordis-es",
            "from_scratch",
            4,
            0,
            0,
            1,
            "sofia.r",
            AtlasStatus.VALIDATED,
        ),
        (
            "revenu-net--nordis-fr",
            "nordis-fr",
            "override",
            4,
            2,
            0,
            2,
            "claire.m",
            AtlasStatus.VALIDATED,
        ),
    ]
    assert [(r.id, r.kind, r.version, r.found) for r in doc.references] == [
        ("commande", "concept", None, True),
        ("date-de-reference", "concept", None, True),
    ]
    assert {r.id for r in doc.referenced_by} == {"brouillon", "marge-brute", "panier-moyen"}
    assert doc.impact == 3
    marge = fiche(service, "marge-brute").document
    assert [(r.id, r.kind, r.version, r.found) for r in marge.references] == [
        ("revenu-net", "kpi_ref", 4, True),
    ]
    concept = fiche(service, "commande").document
    assert concept.entry.kind is DocumentKind.CONCEPT
    assert concept.entry.availability is None
    assert concept.fingerprint is None
    assert concept.variants == ()
    assert concept.references == ()
    assert {r.id for r in concept.referenced_by} == {
        "revenu-net",
        "revenu-net--nordis-es",
        "panier-moyen",
        "brouillon",
        "invalide",
    }
    assert concept.impact == 6
    assert all(r.document_version is not None for r in concept.referenced_by)
    assert service.get("inconnu") is None
    assert service.get("revenu-net--nordis-fr") is None


def test_diagnostics_et_reference_absente(service: CatalogService) -> None:
    """Un document invalide conserve son diagnostic exact et sa référence non résolue."""
    doc = fiche(service, "invalide").document
    assert doc.entry.status is AtlasStatus.INVALID
    assert doc.fingerprint is None
    assert [asdict(i) for i in doc.issues] == [
        {
            "path": "/data_product/id",
            "node_id": None,
            "code": "id_mismatch",
            "message": "L'identifiant « identifiant-errone » ne correspond pas au fichier : "
            "« invalide » attendu.",
            "severity": "error",
        }
    ]
    absent = next(r for r in doc.references if r.id == "revenu-absent")
    assert asdict(absent) == {
        "id": "revenu-absent",
        "kind": "kpi_ref",
        "version": 4,
        "found": False,
        "document_kind": None,
        "label": None,
        "status": None,
        "domain": None,
    }


def test_reconstruction_et_clone_intact(service: CatalogService, tmp_path: Path) -> None:
    """Seul le test écrit le nouveau commit ; aucune lecture ne change le clone."""
    depot = service.config.repository
    avant = instantane(depot)
    premiere = liste(service)
    fiche(service, "revenu-net")
    assert instantane(depot) == avant
    assert git(depot, "status", "--porcelain", "--ignored") == ""
    chemin = depot / "kpis/revenu-net.yaml"
    chemin.write_text(chemin.read_text().replace("label: Revenu net", "label: Revenu actualisé"))
    commit = commettre(depot)
    avant = instantane(depot)
    nouvelle = liste(service)
    assert nouvelle.provenance.commit == commit != premiere.provenance.commit
    assert fiche(service, "revenu-net").document.entry.label == "Revenu actualisé"
    assert instantane(depot) == avant
    assert git(depot, "status", "--porcelain", "--ignored") == ""
    deplace = depot.rename(tmp_path / "clone-deplace")
    page = liste(service)
    assert page.provenance.freshness is Freshness.STALE
    assert instantane(deplace) == avant
    assert git(deplace, "status", "--porcelain", "--ignored") == ""


@pytest.mark.parametrize("illisible", [False, True], ids=["absent", "sans-git"])
def test_dernier_index_et_date_conservee(
    service: CatalogService,
    tmp_path: Path,
    illisible: bool,
) -> None:
    """Un nouveau service retrouve la dernière lecture réussie sur disque."""
    premiere = liste(service)
    derniere_date = INSTANT + timedelta(hours=1)
    seconde = CatalogService(service.config, lambda: derniere_date)
    derniere = liste(seconde)
    service.config.repository.rename(tmp_path / "ancien-clone")
    if illisible:
        service.config.repository.mkdir()
    reprise = CatalogService(service.config, lambda: INSTANT + timedelta(days=10))
    page = liste(reprise)
    assert page.entries == premiere.entries == derniere.entries
    assert page.provenance.commit == premiere.provenance.commit
    assert page.provenance.read_at == derniere_date
    assert page.provenance.freshness is Freshness.STALE
    assert page.provenance.problem is (
        SourceProblem.REPOSITORY_UNREADABLE if illisible else SourceProblem.REPOSITORY_MISSING
    )
    assert page.provenance.detail
    assert fiche(reprise, "revenu-net").provenance == page.provenance


@pytest.mark.parametrize(
    "corruption",
    [
        "absent",
        "json",
        "cle",
        "sans-fuseau",
        "commit-non-texte",
        "autre-commit",
    ],
)
def test_index_sans_provenance_valide_refuse(
    service: CatalogService,
    tmp_path: Path,
    corruption: str,
) -> None:
    """Même un index lisible ne peut être servi avec un âge inconnu ou un autre commit."""
    page = liste(service)
    chemin = service.config.read_path
    contenu: dict[str, object] = {"commit": page.provenance.commit, "read_at": INSTANT.isoformat()}
    if corruption == "absent":
        chemin.unlink()
    elif corruption == "json":
        chemin.write_text("{")
    else:
        if corruption == "cle":
            del contenu["read_at"]
        elif corruption == "sans-fuseau":
            contenu["read_at"] = "2026-11-01T10:30:00"
        elif corruption == "commit-non-texte":
            contenu["commit"] = 123
        else:
            contenu["commit"] = "0" * 40
        chemin.write_text(json.dumps(contenu))
    service.config.repository.rename(tmp_path / "clone-retire")
    for resultat in (service.list(), service.get("revenu-net")):
        assert isinstance(resultat, CatalogUnavailable)
        assert resultat.problem is SourceProblem.REPOSITORY_MISSING
        assert resultat.detail


def test_sans_clone_ni_index(service: CatalogService, tmp_path: Path) -> None:
    """L'absence de source est indisponible, jamais une liste vide."""
    service.config.repository.rename(tmp_path / "clone-retire")
    for resultat in (service.list(), service.get("revenu-net")):
        assert isinstance(resultat, CatalogUnavailable)
        assert resultat.problem is SourceProblem.REPOSITORY_MISSING
        assert resultat.detail


def test_horloge_par_defaut(service: CatalogService) -> None:
    """L'horloge réelle rend une date UTC comprise entre les bornes de la lecture."""
    debut = datetime.now(UTC)
    page = liste(CatalogService(service.config))
    assert debut <= page.provenance.read_at <= datetime.now(UTC)
    assert page.provenance.read_at.utcoffset() == timedelta(0)
