"""Objets du catalogue tels que Board les expose (plan 04, C4 à C7).

Tout ce qui vient d'Atlas est recopié sans réinterprétation : statut, diagnostics,
empreinte. Board n'ajoute que la disponibilité d'un KPI et la provenance de l'index.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum


class DocumentKind(StrEnum):
    """Documents listés par le catalogue ; les déclinaisons se lisent depuis leur KPI."""

    CONCEPT = "concept"
    KPI = "kpi"


class AtlasStatus(StrEnum):
    """Statut d'un document dans l'index Atlas."""

    VALIDATED = "validated"
    DRAFT = "draft"
    NEEDS_CURATION = "needs_curation"
    INVALID = "invalid"


class AvailabilityState(StrEnum):
    EXECUTABLE = "executable"
    UNRESOLVED = "unresolved"


class UnresolvedReason(StrEnum):
    # Aucune correspondance KPI → modèle sémantique skifer n'existe encore (AT-02).
    MAPPING_ABSENT = "mapping_absent"
    NOT_VALIDATED = "not_validated"


def availability(kind: DocumentKind, status: AtlasStatus) -> Availability | None:
    """Disponibilité d'un document du catalogue : aucune pour un concept (plan 04, C4)."""
    if kind is DocumentKind.CONCEPT:
        return None
    if status is not AtlasStatus.VALIDATED:
        return Availability(AvailabilityState.UNRESOLVED, UnresolvedReason.NOT_VALIDATED)
    return Availability(AvailabilityState.UNRESOLVED, UnresolvedReason.MAPPING_ABSENT)


@dataclass(frozen=True)
class Availability:
    """Ce qu'un KPI permet d'exécuter. Sans correspondance AT-02, jamais `executable`."""

    state: AvailabilityState
    reason: UnresolvedReason | None


class Freshness(StrEnum):
    FRESH = "fresh"
    STALE = "stale"


class SourceProblem(StrEnum):
    """Pourquoi le clone de l'espace n'a pas pu être lu."""

    REPOSITORY_MISSING = "repository_missing"
    REPOSITORY_UNREADABLE = "repository_unreadable"


@dataclass(frozen=True)
class Provenance:
    """Index d'où vient une réponse : commit indexé et dernière lecture réussie du clone.
    En `stale`, le clone n'a pas pu être relu ; `problem` et `detail` disent pourquoi."""

    commit: str
    read_at: datetime
    freshness: Freshness
    problem: SourceProblem | None = None
    detail: str | None = None


@dataclass(frozen=True)
class CatalogEntry:
    id: str
    kind: DocumentKind
    label: str
    domain: str | None
    owner: str | None
    version: int | None
    status: AtlasStatus
    description: str | None
    synonyms: tuple[str, ...]
    variant_count: int
    # `None` pour un concept : ce n'est pas une métrique.
    availability: Availability | None


@dataclass(frozen=True)
class Issue:
    """Diagnostic Atlas d'un document, recopié tel quel."""

    path: str
    node_id: str | None
    code: str
    message: str
    severity: str


@dataclass(frozen=True)
class Variant:
    """Déclinaison d'un KPI par entité."""

    id: str
    entity: str
    mode: str
    kpi_version: int | None
    override_count: int
    undeclared_count: int
    version: int | None
    owner: str | None
    status: AtlasStatus


@dataclass(frozen=True)
class Reference:
    """Document que celui-ci référence. `found` est faux pour une référence non résolue."""

    id: str
    kind: str
    version: int | None
    found: bool
    document_kind: str | None
    label: str | None
    status: AtlasStatus | None
    domain: str | None


@dataclass(frozen=True)
class Dependent:
    """Document qui référence celui-ci."""

    id: str
    kind: str
    version: int | None
    document_kind: str
    label: str
    status: AtlasStatus
    domain: str | None
    document_version: int | None


@dataclass(frozen=True)
class CatalogDocument:
    entry: CatalogEntry
    fingerprint: str | None
    path: str
    issues: tuple[Issue, ...]
    variants: tuple[Variant, ...]
    references: tuple[Reference, ...]
    referenced_by: tuple[Dependent, ...]
    # Nombre de documents qui en dépendent, directement ou non.
    impact: int


@dataclass(frozen=True)
class Facets:
    domain: tuple[str, ...]
    owner: tuple[str, ...]
    status: tuple[AtlasStatus, ...]
    kind: tuple[DocumentKind, ...]


@dataclass(frozen=True)
class CatalogPage:
    provenance: Provenance
    entries: tuple[CatalogEntry, ...]
    facets: Facets


@dataclass(frozen=True)
class DocumentPage:
    provenance: Provenance
    document: CatalogDocument


@dataclass(frozen=True)
class CatalogUnavailable:
    """Le clone est illisible et aucun index antérieur n'existe : rien à servir."""

    problem: SourceProblem
    detail: str


# --- versions et écarts (plan 05) ---------------------------------------------------------


@dataclass(frozen=True)
class DocumentVersion:
    """Version taguée `doc/<id>/v<n>` : commit, date et message du commit, nom de l'auteur."""

    version: int
    commit: str
    date: datetime
    author: str
    message: str


@dataclass(frozen=True)
class VersionsPage:
    """Versions taguées, de la plus ancienne à la plus récente. La version courante est
    celle de l'index ; elle peut ne pas être taguée (plan 05, V3)."""

    provenance: Provenance
    id: str
    current_version: int | None
    versions: tuple[DocumentVersion, ...]


@dataclass(frozen=True)
class HistoryUnavailable:
    """Le clone n'a pas pu être relu : aucun historique n'est servi (plan 05, V2)."""

    problem: SourceProblem
    detail: str


class DifferenceKind(StrEnum):
    MODIFIED = "modified"
    ADDED = "added"
    REMOVED = "removed"
    REORDERED = "reordered"


class DiffClassification(StrEnum):
    """Classification d'un écart par Atlas, recopiée sans réinterprétation."""

    OVERRIDE_DECLARED = "override_declared"
    OVERRIDE_UNDECLARED = "override_undeclared"
    FROM_SCRATCH = "from_scratch"
    CRITICAL = "critical"
    COSMETIC = "cosmetic"
    TO_VERIFY = "to_verify"


class DiffSeverity(StrEnum):
    INFO = "info"
    WARN = "warn"
    CRITICAL = "critical"


@dataclass(frozen=True)
class FieldChange:
    """Champ d'un nœud modifié. Avant et après sont des valeurs JSON de la définition :
    une expression y reste du texte, jamais exécuté ni stocké (plan 05, V5)."""

    field: str
    before: object
    after: object


@dataclass(frozen=True)
class Difference:
    kind: DifferenceKind
    node_type: str
    # Nœud dans chacune des deux versions ; `None` du côté où il n'existe pas.
    base_node: str | None
    other_node: str | None
    changes: tuple[FieldChange, ...]
    classification: DiffClassification
    severity: DiffSeverity
    message: str


@dataclass(frozen=True)
class VersionRef:
    version: int
    fingerprint: str


@dataclass(frozen=True)
class SeverityCount:
    info: int
    warn: int
    critical: int


@dataclass(frozen=True)
class VersionDiff:
    """Rapport de diff d'Atlas entre deux versions taguées d'un KPI (plan 05, V4)."""

    identical: bool
    base: VersionRef
    other: VersionRef
    differences: tuple[Difference, ...]
    by_severity: SeverityCount


@dataclass(frozen=True)
class DiffPage:
    provenance: Provenance
    id: str
    diff: VersionDiff


class DiffRefusal(StrEnum):
    VERSION_NOT_FOUND = "version_not_found"
    # Un concept n'a pas de graphe : ses versions ne se comparent pas.
    NOT_SUPPORTED = "diff_not_supported"
    # Une version taguée dont le graphe ne se résout pas.
    UNRESOLVABLE = "diff_unavailable"


@dataclass(frozen=True)
class DiffRefused:
    reason: DiffRefusal
    detail: str
