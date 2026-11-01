"""Serveur HTTP de Board : routes du catalogue, en lecture (plan 04, C9).

Pas d'identité avant le lot 02 : le catalogue est lisible par tous les rôles et le serveur
écoute sur `127.0.0.1` par défaut. Une erreur est une réponse JSON à code fermé, jamais
une trace.
"""

from __future__ import annotations

import dataclasses
import os
from collections.abc import Mapping
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from .catalog import AtlasStatus, CatalogConfig, CatalogService, CatalogUnavailable, DocumentKind

REPOSITORY_VARIABLE = "SKIFER_BOARD_ATLAS_REPOSITORY"
STATE_VARIABLE = "SKIFER_BOARD_STATE_DIR"


def to_json(value: Any) -> Any:
    """Objets du catalogue en JSON : énumérations par leur valeur, dates en ISO 8601."""
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return {f.name: to_json(getattr(value, f.name)) for f in dataclasses.fields(value)}
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, tuple | list):
        return [to_json(item) for item in value]
    return value


def _error(status: int, code: str, **fields: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, **fields}}, status_code=status)


def _unavailable(found: CatalogUnavailable) -> JSONResponse:
    return _error(503, "catalog_unavailable", problem=found.problem.value, detail=found.detail)


def _invalid(parameter: str, allowed: type[Enum]) -> JSONResponse:
    values = ", ".join(str(member.value) for member in allowed)
    return _error(400, "invalid_parameter", parameter=parameter, detail=f"Valeurs : {values}.")


def create_app(catalog: CatalogService) -> FastAPI:
    app = FastAPI(title="Skifer Board", docs_url=None, redoc_url=None, openapi_url=None)

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, error: HTTPException) -> JSONResponse:
        codes = {404: "route_not_found", 405: "method_not_allowed"}
        return _error(error.status_code, codes.get(error.status_code, "http_error"))

    @app.exception_handler(Exception)
    async def internal_error(request: Request, error: Exception) -> JSONResponse:
        return _error(500, "internal_error")

    @app.get("/api/catalog")
    def list_catalog(
        q: str | None = None,
        domain: str | None = None,
        owner: str | None = None,
        status: str | None = None,
        kind: str | None = None,
    ) -> JSONResponse:
        if status is not None and status not in tuple(AtlasStatus):
            return _invalid("status", AtlasStatus)
        if kind is not None and kind not in tuple(DocumentKind):
            return _invalid("kind", DocumentKind)
        found = catalog.list(
            q=q,
            domain=domain or None,
            owner=owner or None,
            status=AtlasStatus(status) if status else None,
            kind=DocumentKind(kind) if kind else None,
        )
        if isinstance(found, CatalogUnavailable):
            return _unavailable(found)
        return JSONResponse(to_json(found))

    @app.get("/api/catalog/{document_id}")
    def get_document(document_id: str) -> JSONResponse:
        found = catalog.get(document_id)
        if found is None:
            return _error(404, "document_not_found", id=document_id)
        if isinstance(found, CatalogUnavailable):
            return _unavailable(found)
        return JSONResponse(to_json(found))

    return app


def config_from_env(environ: Mapping[str, str]) -> CatalogConfig:
    """Clone de l'espace et répertoire d'état, tous deux obligatoires : aucun défaut deviné."""
    missing = [name for name in (REPOSITORY_VARIABLE, STATE_VARIABLE) if not environ.get(name)]
    if missing:
        raise SystemExit(f"Variables d'environnement manquantes : {', '.join(missing)}.")
    return CatalogConfig(Path(environ[REPOSITORY_VARIABLE]), Path(environ[STATE_VARIABLE]))


def main() -> None:
    app = create_app(CatalogService(config_from_env(os.environ)))
    host = os.environ.get("SKIFER_BOARD_HOST", "127.0.0.1")
    uvicorn.run(app, host=host, port=int(os.environ.get("SKIFER_BOARD_PORT", "8000")))
