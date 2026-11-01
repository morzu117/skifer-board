"""Catalogue d'un espace Atlas, servi depuis un clone local en lecture seule (plan 04).

Le clone n'est jamais modifié (C1). L'index et l'état de lecture vivent dans un répertoire
propre à Board (C3). Si le clone ne peut pas être relu, le dernier index est servi avec
la date de la dernière lecture réussie ; sans elle, rien n'est servi (C5, C6). Les versions
et leurs écarts ne se lisent que dans un clone relu (plan 05, V2).
"""

from __future__ import annotations

import json
import os
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import duckdb

from .atlas import (
    RepoError,
    indexed_commit,
    open_fresh_index,
    open_last_index,
    read_catalog,
    read_diff,
    read_document,
    read_facets,
    read_versions,
)
from .model import (
    AtlasStatus,
    CatalogPage,
    CatalogUnavailable,
    DiffPage,
    DiffRefusal,
    DiffRefused,
    DocumentKind,
    DocumentPage,
    Freshness,
    HistoryUnavailable,
    Provenance,
    SourceProblem,
    VersionsPage,
)

# Jamais `index.duckdb` : sous DuckDB 2.0, le catalogue `index` qui en découle entre en
# collision avec le schéma `"index"` d'Atlas (plan 04, §1).
INDEX_FILE = "catalogue.duckdb"
READ_FILE = "catalogue-lecture.json"
REPOSITORY_MISSING = "Le clone de l'espace Atlas est introuvable à l'emplacement configuré."
CONCEPT_WITHOUT_GRAPH = "Un concept n'a pas de graphe : ses versions ne se comparent pas."
# Codes d'Atlas qui refusent un écart ; tout autre échec de git rend l'historique indisponible.
_DIFF_REFUSALS = {
    "not_found": DiffRefusal.VERSION_NOT_FOUND,
    "invalid_document": DiffRefusal.UNRESOLVABLE,
}


@dataclass(frozen=True)
class CatalogConfig:
    """Clone de l'espace Atlas, et répertoire d'état de Board hors de ce clone."""

    repository: Path
    state_dir: Path

    @property
    def index_path(self) -> Path:
        return self.state_dir / INDEX_FILE

    @property
    def read_path(self) -> Path:
        return self.state_dir / READ_FILE


def _utc_now() -> datetime:
    return datetime.now(UTC)


class CatalogService:
    def __init__(self, config: CatalogConfig, clock: Callable[[], datetime] = _utc_now) -> None:
        self.config = config
        self._clock = clock

    def list(
        self,
        *,
        q: str | None = None,
        domain: str | None = None,
        owner: str | None = None,
        status: AtlasStatus | None = None,
        kind: DocumentKind | None = None,
    ) -> CatalogPage | CatalogUnavailable:
        def reader(connection: duckdb.DuckDBPyConnection, provenance: Provenance) -> CatalogPage:
            entries = read_catalog(
                connection, q=q, domain=domain, owner=owner, status=status, kind=kind
            )
            return CatalogPage(provenance, entries, read_facets(connection))

        return self._read(reader)

    def get(self, document_id: str) -> DocumentPage | CatalogUnavailable | None:
        """Fiche d'un concept ou d'un KPI ; `None` si l'index ne le contient pas."""

        def reader(
            connection: duckdb.DuckDBPyConnection, provenance: Provenance
        ) -> DocumentPage | None:
            found = read_document(connection, document_id)
            return None if found is None else DocumentPage(provenance, found)

        return self._read(reader)

    def versions(self, document_id: str) -> VersionsPage | HistoryUnavailable | None:
        """Versions taguées d'un document de l'index ; `None` s'il n'y figure pas. Jamais
        servies sans relecture du clone (plan 05, V2)."""
        repository = self.config.repository

        def reader(
            connection: duckdb.DuckDBPyConnection, provenance: Provenance
        ) -> VersionsPage | HistoryUnavailable | None:
            found = read_document(connection, document_id)
            if found is None:
                return None
            try:
                tagged = read_versions(repository, document_id)
            except RepoError as error:
                return HistoryUnavailable(SourceProblem.REPOSITORY_UNREADABLE, str(error.message))
            return VersionsPage(provenance, document_id, found.entry.version, tagged)

        return self._read_fresh(reader)

    def diff(
        self, document_id: str, base: int, other: int
    ) -> DiffPage | DiffRefused | HistoryUnavailable | None:
        """Écart d'Atlas entre deux versions taguées d'un KPI ; `None` hors de l'index."""
        repository = self.config.repository

        def reader(
            connection: duckdb.DuckDBPyConnection, provenance: Provenance
        ) -> DiffPage | DiffRefused | HistoryUnavailable | None:
            found = read_document(connection, document_id)
            if found is None:
                return None
            if found.entry.kind is DocumentKind.CONCEPT:
                return DiffRefused(DiffRefusal.NOT_SUPPORTED, CONCEPT_WITHOUT_GRAPH)
            try:
                report = read_diff(repository, document_id, base, other)
            except RepoError as error:
                refusal = _DIFF_REFUSALS.get(error.code)
                if refusal is None:
                    return HistoryUnavailable(
                        SourceProblem.REPOSITORY_UNREADABLE, str(error.message)
                    )
                return DiffRefused(refusal, str(error.message))
            return DiffPage(provenance, document_id, report)

        return self._read_fresh(reader)

    def _read_fresh[T](
        self, reader: Callable[[duckdb.DuckDBPyConnection, Provenance], T]
    ) -> T | HistoryUnavailable:
        """Relit le clone, remet l'index à jour et le passe à `reader` ; sinon, la raison."""
        config = self.config
        config.state_dir.mkdir(parents=True, exist_ok=True)
        if not config.repository.is_dir():
            # Le chemin du clone n'est pas dans le message : il part vers le navigateur
            # (plan 04, 4.2).
            return HistoryUnavailable(SourceProblem.REPOSITORY_MISSING, REPOSITORY_MISSING)
        try:
            connection = open_fresh_index(config.repository, config.index_path)
        except RepoError as error:
            return HistoryUnavailable(SourceProblem.REPOSITORY_UNREADABLE, str(error.message))
        try:
            commit, read_at = indexed_commit(connection), self._clock()
            self._record(commit, read_at)
            return reader(connection, Provenance(commit, read_at, Freshness.FRESH))
        finally:
            connection.close()

    def _read[T](
        self, reader: Callable[[duckdb.DuckDBPyConnection, Provenance], T]
    ) -> T | CatalogUnavailable:
        """Comme `_read_fresh`, puis, si le clone est illisible, le dernier index en `stale`."""
        fresh = self._read_fresh(reader)
        if not isinstance(fresh, HistoryUnavailable):
            return fresh
        problem, detail = fresh.problem, fresh.detail
        last = open_last_index(self.config.index_path)
        if last is None:
            return CatalogUnavailable(problem, detail)
        try:
            commit, recorded = indexed_commit(last), self._recorded()
            # Sans date de lecture du même commit, l'âge de l'index est inconnu : rien
            # n'est servi plutôt qu'un catalogue sans provenance.
            if recorded is None or recorded[0] != commit:
                return CatalogUnavailable(problem, detail)
            provenance = Provenance(commit, recorded[1], Freshness.STALE, problem, detail)
            return reader(last, provenance)
        finally:
            last.close()

    def _record(self, commit: str, read_at: datetime) -> None:
        """Écrit l'état de lecture par remplacement atomique : jamais de fichier à moitié."""
        payload = json.dumps({"commit": commit, "read_at": read_at.isoformat()})
        with tempfile.NamedTemporaryFile(
            "w", dir=self.config.state_dir, delete=False, encoding="utf-8", suffix=".tmp"
        ) as handle:
            handle.write(payload)
        os.replace(handle.name, self.config.read_path)

    def _recorded(self) -> tuple[str, datetime] | None:
        try:
            data = json.loads(self.config.read_path.read_text(encoding="utf-8"))
            commit, read_at = data["commit"], datetime.fromisoformat(data["read_at"])
        except (OSError, ValueError, KeyError, TypeError):
            return None
        if not isinstance(commit, str) or read_at.tzinfo is None:
            return None
        return commit, read_at
