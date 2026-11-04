"""Versions taguées et écarts d'Atlas, lus dans de vrais dépôts git (plan 05, 5.1)."""

import shutil
from collections import Counter
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import Mock

import pytest
from skifer_atlas.sheet import version_diff
from skifer_board.catalog import (
    CatalogPage,
    CatalogService,
    DiffClassification,
    DifferenceKind,
    DiffPage,
    DiffRefusal,
    DiffRefused,
    DiffSeverity,
    DocumentPage,
    FieldChange,
    Freshness,
    HistoryUnavailable,
    SourceProblem,
    VersionsPage,
    atlas,
)
from skifer_board.catalog.atlas import RepoError
from skifer_board.catalog.service import CONCEPT_WITHOUT_GRAPH, REPOSITORY_MISSING

from .conftest import INSTANT, commettre, git
from .test_service import instantane

ADRESSE = "catalogue@example.invalid"
AUTEUR = "Tests catalogue"
EMPREINTE = "sha256:atlas1:"
IRRESOLUBLE = "La version 3 de « revenu-net » n'est pas un document valide."


def versions(service: CatalogService, identifiant: str = "revenu-net") -> VersionsPage:
    """Exige une page de versions."""
    page = service.versions(identifiant)
    assert isinstance(page, VersionsPage), page
    return page


def ecart(
    service: CatalogService, base: int, other: int, identifiant: str = "revenu-net"
) -> DiffPage:
    """Exige un rapport d'écart."""
    page = service.diff(identifiant, base, other)
    assert isinstance(page, DiffPage), page
    return page


def taguer(depot: Path, identifiant: str, version: int, message: str | None = None) -> str:
    """Pose un tag de version sur un nouveau commit vide ; rend ce commit."""
    git(depot, "commit", "--allow-empty", "-m", message or f"{identifiant} v{version}")
    git(depot, "tag", f"doc/{identifiant}/v{version}")
    return git(depot, "rev-parse", "HEAD")


def tags(depot: Path) -> str:
    return git(depot, "tag", "--list")


def passer_en_v6(depot: Path) -> str:
    """Version courante non taguée : « revenu-net » passe en v6 sans tag."""
    chemin = depot / "kpis" / "revenu-net.yaml"
    texte = chemin.read_text(encoding="utf-8")
    chemin.write_text(texte.replace("  version: 5\n", "  version: 6\n"), encoding="utf-8")
    return commettre(depot)


# --- versions ------------------------------------------------------------------------------


def test_versions_dans_l_ordre_et_provenance(
    service: CatalogService, espace_versionne: Path
) -> None:
    """Trois tags, du plus ancien au plus récent, avec commit, date, auteur et message."""
    page = versions(service)
    assert page.id == "revenu-net"
    assert tuple(v.version for v in page.versions) == (3, 4, 5)
    for version in page.versions:
        tag = f"doc/revenu-net/v{version.version}"
        assert version.commit == git(espace_versionne, "rev-list", "-n", "1", tag)
        assert isinstance(version.date, datetime)
        assert version.date.tzinfo is not None
        assert version.date.utcoffset() is not None
        assert version.author == AUTEUR
        assert version.message == f"Revenu net v{version.version}"
    assert len({v.commit for v in page.versions}) == 3
    tete = git(espace_versionne, "rev-parse", "HEAD")
    assert page.versions[-1].commit == tete
    fiche = service.get("revenu-net")
    assert isinstance(fiche, DocumentPage)
    assert page.current_version == fiche.document.entry.version == 5
    assert page.provenance.commit == tete
    assert page.provenance.read_at == INSTANT
    assert page.provenance.freshness is Freshness.FRESH
    assert page.provenance.problem is None
    assert page.provenance.detail is None
    assert ADRESSE not in repr(page)
    assert ADRESSE not in repr(asdict(page))


def test_ordre_numerique_et_tags_etrangers(service: CatalogService, espace: Path) -> None:
    """v10 suit v9 ; les tags d'un autre document ou mal formés ne sont pas des versions."""
    commits = {n: taguer(espace, "commande", n, f"Commande v{n}") for n in (10, 2, 9)}
    git(espace, "tag", "doc/commande/v0")
    git(espace, "tag", "doc/commande/vx")
    git(espace, "tag", "doc/commande/v01")
    git(espace, "tag", "doc/commande-bis/v1")
    git(espace, "tag", "doc/revenu-net/v1")
    page = versions(service, "commande")
    assert tuple(v.version for v in page.versions) == (2, 9, 10)
    assert {v.version: v.commit for v in page.versions} == commits
    assert {v.version: v.message for v in page.versions} == {n: f"Commande v{n}" for n in commits}
    assert page.current_version == 5


def test_date_fuseau_et_auteur_sans_adresse(
    service: CatalogService, espace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Le fuseau du commit est conservé ; seul le nom de l'auteur est relayé."""
    monkeypatch.setenv("GIT_COMMITTER_DATE", "2026-10-15T09:00:00+02:00")
    monkeypatch.setenv("GIT_AUTHOR_NAME", "Élodie Martin")
    monkeypatch.setenv("GIT_AUTHOR_EMAIL", "elodie.martin@example.invalid")
    taguer(espace, "commande", 1, "Commande : première version")
    (version,) = versions(service, "commande").versions
    assert version.date == datetime(2026, 10, 15, 9, tzinfo=timezone(timedelta(hours=2)))
    assert version.date.utcoffset() == timedelta(hours=2)
    assert version.author == "Élodie Martin"
    assert version.message == "Commande : première version"
    assert "elodie.martin@example.invalid" not in repr(version)


def test_version_courante_non_taguee(service: CatalogService, espace_versionne: Path) -> None:
    """La version de l'index est dite telle quelle, sans tag inventé (V3)."""
    commit = passer_en_v6(espace_versionne)
    page = versions(service)
    assert page.current_version == 6
    assert tuple(v.version for v in page.versions) == (3, 4, 5)
    assert 6 not in {v.version for v in page.versions}
    assert page.provenance.commit == commit
    refus = service.diff("revenu-net", 5, 6)
    assert refus == DiffRefused(
        DiffRefusal.VERSION_NOT_FOUND, "Version 6 de « revenu-net » introuvable."
    )


def test_tag_ajoute_ou_retire_vu_aussitot(service: CatalogService, espace_versionne: Path) -> None:
    """L'historique est relu à chaque demande, jamais mémorisé (V1, V2)."""
    assert len(versions(service).versions) == 3
    tete = git(espace_versionne, "rev-parse", "HEAD")
    git(espace_versionne, "tag", "doc/revenu-net/v7")
    page = versions(service)
    assert tuple(v.version for v in page.versions) == (3, 4, 5, 7)
    assert page.provenance.commit == tete
    git(espace_versionne, "tag", "-d", "doc/revenu-net/v3")
    assert tuple(v.version for v in versions(service).versions) == (4, 5, 7)


@pytest.mark.parametrize(
    ("identifiant", "courante"),
    [("revenu-net", 4), ("commande", 5), ("invalide", None), ("brouillon", None)],
)
def test_document_sans_tag(service: CatalogService, identifiant: str, courante: int | None) -> None:
    """Sans tag, la liste est vide et la version courante reste celle de l'index."""
    fiche = service.get(identifiant)
    assert isinstance(fiche, DocumentPage)
    page = versions(service, identifiant)
    assert page.versions == ()
    assert page.id == identifiant
    assert page.current_version == fiche.document.entry.version
    if courante is not None:
        assert page.current_version == courante


def test_concept_tague(service: CatalogService, espace: Path) -> None:
    """Un concept a un historique, même s'il n'a pas d'écart."""
    commit = taguer(espace, "commande", 1)
    page = versions(service, "commande")
    assert tuple((v.version, v.commit) for v in page.versions) == ((1, commit),)
    assert page.current_version == 5


@pytest.mark.parametrize("identifiant", ["inconnu", "revenu-net--nordis-fr", ""])
def test_identifiant_hors_catalogue(
    service: CatalogService, espace_versionne: Path, identifiant: str
) -> None:
    """Inconnu ou déclinaison, même taguée : `None`, sans demander l'écart à Atlas."""
    git(espace_versionne, "tag", "doc/revenu-net--nordis-fr/v1")
    git(espace_versionne, "tag", "doc/revenu-net--nordis-fr/v2")
    assert service.versions(identifiant) is None
    assert service.diff(identifiant, 1, 2) is None


def test_clone_absent_apres_index(
    service: CatalogService, espace_versionne: Path, tmp_path: Path
) -> None:
    """Le catalogue sert l'ancien index, l'historique jamais (V2)."""
    assert len(versions(service).versions) == 3
    ecart(service, 4, 5)
    shutil.rmtree(espace_versionne)
    attendu = HistoryUnavailable(SourceProblem.REPOSITORY_MISSING, REPOSITORY_MISSING)
    assert service.versions("revenu-net") == attendu
    assert service.versions("commande") == attendu
    assert service.diff("revenu-net", 4, 5) == attendu
    assert str(tmp_path) not in attendu.detail
    fiche = service.get("revenu-net")
    assert isinstance(fiche, DocumentPage)
    assert fiche.provenance.freshness is Freshness.STALE
    assert fiche.provenance.problem is SourceProblem.REPOSITORY_MISSING
    assert fiche.provenance.read_at == INSTANT
    catalogue = service.list()
    assert isinstance(catalogue, CatalogPage)
    assert catalogue.provenance.freshness is Freshness.STALE


def test_clone_absent_sans_index(service: CatalogService, espace: Path) -> None:
    """Sans clone ni index, l'historique est indisponible, jamais vide."""
    shutil.rmtree(espace)
    attendu = HistoryUnavailable(SourceProblem.REPOSITORY_MISSING, REPOSITORY_MISSING)
    assert service.versions("revenu-net") == attendu
    assert service.diff("revenu-net", 4, 5) == attendu


def _rendre_illisible(depot: Path, tmp_path: Path, panne: str) -> None:
    if panne == "pas-un-depot":
        depot.rename(tmp_path / "clone-retire")
        depot.mkdir()
        (depot / "atlas.yaml").write_text("schema_version: 1\n", encoding="utf-8")
    elif panne == "git-pointeur":
        (depot / ".git").rename(tmp_path / "metadonnees-git")
        (depot / ".git").write_text(f"gitdir: {tmp_path / 'introuvable'}\n", encoding="utf-8")
    else:
        (depot / ".git" / "HEAD").write_text("n'importe quoi\n", encoding="utf-8")


@pytest.mark.parametrize("panne", ["pas-un-depot", "git-pointeur", "head-corrompu"])
@pytest.mark.parametrize("ancien", [False, True], ids=["sans-index", "avec-index"])
def test_depot_illisible(
    service: CatalogService,
    espace_versionne: Path,
    tmp_path: Path,
    panne: str,
    ancien: bool,
) -> None:
    """Un clone présent mais illisible rend l'historique indisponible, sans chemin privé."""
    if ancien:
        versions(service)
    _rendre_illisible(espace_versionne, tmp_path, panne)
    for resultat in (service.versions("revenu-net"), service.diff("revenu-net", 4, 5)):
        assert isinstance(resultat, HistoryUnavailable), resultat
        assert resultat.problem is SourceProblem.REPOSITORY_UNREADABLE
        assert resultat.detail
        assert str(tmp_path) not in resultat.detail


def test_echec_git_apres_index_frais(
    service: CatalogService, espace_versionne: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Un échec de lecture des tags après un index frais n'est pas une liste vide."""
    monkeypatch.setattr(
        "skifer_board.catalog.service.read_versions",
        Mock(side_effect=RepoError("git_failed", "git for-each-ref a échoué : panne")),
    )
    assert service.versions("revenu-net") == HistoryUnavailable(
        SourceProblem.REPOSITORY_UNREADABLE, "git for-each-ref a échoué : panne"
    )


# --- écarts --------------------------------------------------------------------------------


def test_ecart_cosmetique_et_a_verifier(service: CatalogService, espace_versionne: Path) -> None:
    """4 → 5 : filtre renommé (cosmétique, info) et calcul modifié (à vérifier, warn)."""
    page = ecart(service, 4, 5)
    rapport = page.diff
    assert page.id == "revenu-net"
    assert page.provenance.commit == git(espace_versionne, "rev-parse", "HEAD")
    assert page.provenance.read_at == INSTANT
    assert page.provenance.freshness is Freshness.FRESH
    assert rapport.identical is False
    assert (rapport.base.version, rapport.other.version) == (4, 5)
    assert rapport.base.fingerprint.startswith(EMPREINTE)
    assert rapport.other.fingerprint.startswith(EMPREINTE)
    assert rapport.base.fingerprint != rapport.other.fingerprint
    filtre, calcul = rapport.differences
    assert filtre.kind is calcul.kind is DifferenceKind.MODIFIED
    assert (filtre.node_type, filtre.base_node, filtre.other_node) == ("filter", "n02", "n02")
    assert filtre.changes == (FieldChange("label", "Factures validées", "Factures émises"),)
    assert filtre.classification is DiffClassification.COSMETIC
    assert filtre.severity is DiffSeverity.INFO
    assert (calcul.node_type, calcul.base_node, calcul.other_node) == ("compute", "n03", "n03")
    assert calcul.changes == (
        FieldChange("expr", "montant_ttc - montant_taxes - avoirs", "montant_ttc - montant_taxes"),
    )
    assert calcul.classification is DiffClassification.TO_VERIFY
    assert calcul.severity is DiffSeverity.WARN
    assert filtre.message and calcul.message
    compte = Counter(d.severity.value for d in rapport.differences)
    resume = rapport.by_severity
    assert (resume.info, resume.warn, resume.critical) == (1, 1, 0)
    assert asdict(resume) == {s.value: compte.get(s.value, 0) for s in DiffSeverity}
    assert resume.info + resume.warn + resume.critical == len(rapport.differences)


def test_ecart_relaye_sans_reinterpretation(
    service: CatalogService, espace_versionne: Path
) -> None:
    """Messages, classifications, sévérités et empreintes sont ceux du rapport d'Atlas (V4)."""
    brut: dict[str, Any] = version_diff(espace_versionne, "revenu-net", 4, 5)
    rapport = ecart(service, 4, 5).diff
    assert rapport.base.fingerprint == brut["base"]["fingerprint"]
    assert rapport.other.fingerprint == brut["other"]["fingerprint"]
    assert [
        (d.kind.value, d.classification.value, d.severity.value, d.message)
        for d in rapport.differences
    ] == [
        (d["kind"], d["classification"], d["severity"], d["message"]) for d in brut["differences"]
    ]
    assert asdict(rapport.by_severity) == brut["summary"]["by_severity"]


@pytest.mark.parametrize("version", [4, 5])
def test_ecart_identique(service: CatalogService, espace_versionne: Path, version: int) -> None:
    """Deux fois la même version : identique, aucun écart, résumé nul."""
    rapport = ecart(service, version, version).diff
    assert rapport.identical is True
    assert rapport.differences == ()
    assert rapport.base == rapport.other
    assert rapport.base.version == version
    assert rapport.base.fingerprint.startswith(EMPREINTE)
    assert asdict(rapport.by_severity) == {"info": 0, "warn": 0, "critical": 0}


def test_empreintes_stables_entre_sens(service: CatalogService, espace_versionne: Path) -> None:
    """5 → 4 est accepté : mêmes empreintes, avant et après échangés."""
    aller, retour = ecart(service, 4, 5).diff, ecart(service, 5, 4).diff
    assert (retour.base, retour.other) == (aller.other, aller.base)
    assert retour.identical is False
    assert [d.node_type for d in retour.differences] == ["filter", "compute"]
    assert retour.differences[0].changes == (
        FieldChange("label", "Factures émises", "Factures validées"),
    )
    assert retour.differences[1].changes == (
        FieldChange("expr", "montant_ttc - montant_taxes", "montant_ttc - montant_taxes - avoirs"),
    )
    assert asdict(retour.by_severity) == asdict(aller.by_severity)
    assert ecart(service, 5, 5).diff.base.fingerprint == aller.other.fingerprint


@pytest.mark.parametrize(("base", "other", "absente"), [(4, 9, 9), (9, 4, 9), (1, 5, 1), (2, 2, 2)])
def test_version_non_taguee(
    service: CatalogService, espace_versionne: Path, base: int, other: int, absente: int
) -> None:
    """Une version sans tag est refusée avec le message d'Atlas."""
    assert service.diff("revenu-net", base, other) == DiffRefused(
        DiffRefusal.VERSION_NOT_FOUND, f"Version {absente} de « revenu-net » introuvable."
    )


def test_ecart_concept_sans_appel_atlas(
    service: CatalogService, espace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Un concept, même tagué, n'a pas de graphe : refus sans demander l'écart à Atlas."""
    taguer(espace, "commande", 1)
    taguer(espace, "commande", 2)
    lecture = Mock(side_effect=AssertionError("Atlas ne doit pas être appelé."))
    monkeypatch.setattr("skifer_board.catalog.service.read_diff", lecture)
    for base, other in ((1, 2), (1, 1), (7, 8)):
        assert service.diff("commande", base, other) == DiffRefused(
            DiffRefusal.NOT_SUPPORTED, CONCEPT_WITHOUT_GRAPH
        )
    lecture.assert_not_called()


@pytest.mark.parametrize(("base", "other"), [(3, 5), (5, 3), (3, 3), (3, 4)])
def test_version_irresoluble(
    service: CatalogService, espace_versionne: Path, base: int, other: int
) -> None:
    """Une version taguée dont le graphe ne se résout pas : refus avec le message d'Atlas."""
    assert service.diff("revenu-net", base, other) == DiffRefused(
        DiffRefusal.UNRESOLVABLE, IRRESOLUBLE
    )


@pytest.mark.parametrize("code", ["git_timeout", "git_failed", "not_a_variant"])
def test_autre_echec_atlas(
    service: CatalogService,
    espace_versionne: Path,
    monkeypatch: pytest.MonkeyPatch,
    code: str,
) -> None:
    """Tout autre code d'Atlas rend l'historique indisponible, jamais un écart vide."""
    message = f"Échec {code}."
    monkeypatch.setattr(
        "skifer_board.catalog.service.read_diff", Mock(side_effect=RepoError(code, message))
    )
    assert service.diff("revenu-net", 4, 5) == HistoryUnavailable(
        SourceProblem.REPOSITORY_UNREADABLE, message
    )


# --- contrat fermé d'Atlas ------------------------------------------------------------------


def rapport_atlas(**ecart_atlas: Any) -> dict[str, Any]:
    """Rapport de diff minimal, au format d'Atlas, avec un écart."""
    difference: dict[str, Any] = {
        "kind": "modified",
        "node_type": "filter",
        "node_ref": {"base": "n02", "other": "n02"},
        "changes": [{"field": "label", "before": "a", "after": "b"}],
        "classification": "cosmetic",
        "severity": "info",
        "message": "Filtre modifié.",
        **ecart_atlas,
    }
    return {
        "identical": False,
        "base": {"version": 4, "fingerprint": "sha256:atlas1:a"},
        "other": {"version": 5, "fingerprint": "sha256:atlas1:b"},
        "differences": [difference],
        "pairs": [{"base": "n02", "other": "n02"}],
        "summary": {"by_severity": {"info": 1, "warn": 0, "critical": 0}},
    }


def remplacer_atlas(monkeypatch: pytest.MonkeyPatch, rapport: dict[str, Any]) -> None:
    monkeypatch.setattr(atlas, "version_diff", lambda *_: rapport)


@pytest.mark.parametrize(
    ("champ", "valeur"),
    [
        ("kind", "renamed"),
        ("kind", "MODIFIED"),
        ("classification", "equivalent"),
        ("classification", ""),
        ("severity", "blocker"),
        ("severity", "Info"),
        ("severity", None),
    ],
)
def test_valeur_inconnue_du_rapport(
    service: CatalogService,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    champ: str,
    valeur: str | None,
) -> None:
    """Une valeur hors contrat est une erreur, jamais une valeur devinée (V4)."""
    remplacer_atlas(monkeypatch, rapport_atlas(**{champ: valeur}))
    with pytest.raises(ValueError):
        atlas.read_diff(tmp_path, "revenu-net", 4, 5)
    with pytest.raises(ValueError):
        service.diff("revenu-net", 4, 5)


def test_severite_inconnue_dans_le_resume(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Le résumé par sévérité est aussi en valeurs fermées."""
    rapport = rapport_atlas()
    rapport["summary"]["by_severity"]["blocker"] = 2
    remplacer_atlas(monkeypatch, rapport)
    with pytest.raises(ValueError):
        atlas.read_diff(tmp_path, "revenu-net", 4, 5)


@pytest.mark.parametrize(
    ("reference", "attendu"),
    [
        (None, (None, None)),
        ({"base": None, "other": "n08"}, (None, "n08")),
        ({"base": "n05", "other": None}, ("n05", None)),
    ],
)
def test_noeuds_absents(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    reference: dict[str, str | None] | None,
    attendu: tuple[str | None, str | None],
) -> None:
    """Un nœud absent d'un côté reste absent ; les alignements ne sont pas relayés."""
    remplacer_atlas(monkeypatch, rapport_atlas(kind="added", node_ref=reference, changes=[]))
    rapport = atlas.read_diff(tmp_path, "revenu-net", 4, 5)
    (difference,) = rapport.differences
    assert (difference.base_node, difference.other_node) == attendu
    assert difference.kind is DifferenceKind.ADDED
    assert difference.changes == ()
    assert "pairs" not in asdict(rapport)


def test_valeurs_json_des_champs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Avant et après restent les valeurs JSON d'Atlas, expressions comprises (V5)."""
    changements = [
        {"field": "expr", "before": "a - b", "after": None},
        {"field": "keys", "before": [["a", "b"]], "after": {"x": 1}},
    ]
    remplacer_atlas(monkeypatch, rapport_atlas(changes=changements))
    (difference,) = atlas.read_diff(tmp_path, "revenu-net", 4, 5).differences
    assert difference.changes == (
        FieldChange("expr", "a - b", None),
        FieldChange("keys", [["a", "b"]], {"x": 1}),
    )


# Lecture des tags par Atlas, telle que `atlas.read_versions` l'appelle.
VERSIONS_ATLAS = "skifer_atlas.repo.versions.versions"


def version_atlas(date: str) -> SimpleNamespace:
    return SimpleNamespace(version=1, commit="0" * 40, date=date, author=AUTEUR, message="v1")


@pytest.mark.parametrize("date", ["2026-11-01T10:30:00", "2026-11-01"])
def test_date_sans_fuseau(
    service: CatalogService,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    date: str,
) -> None:
    """Une date sans fuseau est hors contrat, pas une heure locale supposée."""
    monkeypatch.setattr(VERSIONS_ATLAS, lambda *_: [version_atlas(date)])
    with pytest.raises(ValueError):
        atlas.read_versions(tmp_path, "revenu-net")
    with pytest.raises(ValueError):
        service.versions("revenu-net")


@pytest.mark.parametrize(
    ("date", "decalage"),
    [("2026-11-01T10:30:00+01:00", timedelta(hours=1)), ("2026-11-01T10:30:00Z", timedelta(0))],
)
def test_date_avec_fuseau(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, date: str, decalage: timedelta
) -> None:
    """Le décalage d'Atlas est conservé, `Z` compris."""
    monkeypatch.setattr(VERSIONS_ATLAS, lambda *_: [version_atlas(date)])
    (version,) = atlas.read_versions(tmp_path, "revenu-net")
    assert version.date.utcoffset() == decalage


# --- clone intact ------------------------------------------------------------------------------


def test_aucune_ecriture_dans_le_clone(service: CatalogService, espace_versionne: Path) -> None:
    """Ni fichier ni tag écrit dans le clone, quelle que soit la lecture."""
    avant, etiquettes = instantane(espace_versionne), tags(espace_versionne)
    assert not service.config.state_dir.is_relative_to(espace_versionne)
    versions(service)
    versions(service, "commande")
    for base, other in ((4, 5), (5, 4), (5, 5), (3, 5), (4, 9)):
        service.diff("revenu-net", base, other)
    service.diff("commande", 1, 2)
    service.versions("inconnu")
    service.list()
    service.get("revenu-net")
    assert instantane(espace_versionne) == avant
    assert tags(espace_versionne) == etiquettes
    assert git(espace_versionne, "status", "--porcelain", "--ignored") == ""
