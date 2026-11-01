"""Adaptateur vers `skifer_atlas`, seul module de Board qui l'importe (plan 04, C2).

Board n'écrit aucun SQL : l'index est construit et lu par les fonctions d'Atlas (C3).
Ce module convertit leurs dictionnaires en objets typés et refuse une valeur hors contrat.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import duckdb
from skifer_atlas.index import search
from skifer_atlas.index.build import ensure_index
from skifer_atlas.index.schema import connect, index_state
from skifer_atlas.repo.git import RepoError

from .model import (
    AtlasStatus,
    CatalogDocument,
    CatalogEntry,
    Dependent,
    DocumentKind,
    Facets,
    Issue,
    Reference,
    Variant,
    availability,
)

__all__ = [
    "RepoError",
    "indexed_commit",
    "open_fresh_index",
    "open_last_index",
    "read_catalog",
    "read_document",
    "read_facets",
]

Row = dict[str, Any]


def open_fresh_index(repo: Path, db: Path) -> duckdb.DuckDBPyConnection:
    """Index à jour du clone, reconstruit par Atlas s'il porte sur un autre commit.
    Lève `RepoError` si git ne peut pas lire le clone. L'appelant ferme la connexion."""
    connection: duckdb.DuckDBPyConnection = ensure_index(repo, db)
    return connection


def open_last_index(db: Path) -> duckdb.DuckDBPyConnection | None:
    """Dernier index construit, sans relire le clone ; `None` s'il n'y en a pas."""
    if not db.is_file():
        return None
    connection: duckdb.DuckDBPyConnection = connect(db)
    if index_state(connection) is None:
        connection.close()
        return None
    return connection


def indexed_commit(connection: duckdb.DuckDBPyConnection) -> str:
    state = index_state(connection)
    if state is None:
        raise ValueError("The Atlas index has no metadata.")
    return str(state[0])


def _optional_str(value: Any) -> str | None:
    return None if value is None else str(value)


def _optional_int(value: Any) -> int | None:
    return None if value is None else int(value)


def _entry(row: Row) -> CatalogEntry:
    kind, status = DocumentKind(row["kind"]), AtlasStatus(row["status"])
    return CatalogEntry(
        id=str(row["id"]),
        kind=kind,
        label=str(row["label"]),
        domain=_optional_str(row["domain"]),
        owner=_optional_str(row["owner"]),
        version=_optional_int(row["version"]),
        status=status,
        description=_optional_str(row["description"]),
        synonyms=tuple(str(s) for s in row["synonyms"]),
        variant_count=int(row.get("variant_count", 0)),
        availability=availability(kind, status),
    )


def read_catalog(
    connection: duckdb.DuckDBPyConnection,
    *,
    q: str | None,
    domain: str | None,
    owner: str | None,
    status: AtlasStatus | None,
    kind: DocumentKind | None,
) -> tuple[CatalogEntry, ...]:
    # La convergence calculée par Atlas n'est pas lue : la base de Board ne contient
    # aucune comparaison chiffrée (C7).
    rows = search.catalog(
        connection,
        q=q,
        domain=domain,
        owner=owner,
        status=status.value if status else None,
        kind=kind.value if kind else None,
    )
    return tuple(_entry(row) for row in rows)


def read_facets(connection: duckdb.DuckDBPyConnection) -> Facets:
    found = search.facets(connection)
    return Facets(
        domain=tuple(str(v) for v in found["domain"]),
        owner=tuple(str(v) for v in found["owner"]),
        status=tuple(AtlasStatus(v) for v in found["status"]),
        kind=tuple(DocumentKind(v) for v in found["kind"]),
    )


def _optional_status(value: Any) -> AtlasStatus | None:
    return None if value is None else AtlasStatus(value)


def read_document(
    connection: duckdb.DuckDBPyConnection, document_id: str
) -> CatalogDocument | None:
    """Fiche d'un concept ou d'un KPI ; `None` pour un identifiant inconnu ou une déclinaison."""
    row = search.document(connection, document_id)
    if row is None or row["kind"] not in tuple(DocumentKind):
        return None
    links = search.dependencies(connection, document_id)
    variants = row.get("variants", [])
    return CatalogDocument(
        entry=_entry({**row, "variant_count": len(variants)}),
        fingerprint=_optional_str(row["fingerprint"]),
        path=str(row["path"]),
        issues=tuple(
            Issue(
                path=str(i["path"]),
                node_id=_optional_str(i.get("node_id")),
                code=str(i["code"]),
                message=str(i["message"]),
                severity=str(i["severity"]),
            )
            for i in row["issues"]
        ),
        variants=tuple(
            Variant(
                id=str(v["id"]),
                entity=str(v["entity"]),
                mode=str(v["mode"]),
                kpi_version=_optional_int(v["kpi_version"]),
                override_count=int(v["override_count"]),
                undeclared_count=int(v["undeclared_count"]),
                version=_optional_int(v["version"]),
                owner=_optional_str(v["owner"]),
                status=AtlasStatus(v["status"]),
            )
            for v in variants
        ),
        references=tuple(
            Reference(
                id=str(r["id"]),
                kind=str(r["kind"]),
                version=_optional_int(r["version"]),
                found=bool(r["found"]),
                document_kind=_optional_str(r["document_kind"]),
                label=_optional_str(r["label"]),
                status=_optional_status(r["status"]),
                domain=_optional_str(r["domain"]),
            )
            for r in links["references"]
        ),
        referenced_by=tuple(
            Dependent(
                id=str(r["id"]),
                kind=str(r["kind"]),
                version=_optional_int(r["version"]),
                document_kind=str(r["document_kind"]),
                label=str(r["label"]),
                status=AtlasStatus(r["status"]),
                domain=_optional_str(r["domain"]),
                document_version=_optional_int(r["document_version"]),
            )
            for r in links["referenced_by"]
        ),
        impact=int(links["impact"]),
    )
