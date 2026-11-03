"""Serveur HTTP de Board : routes du catalogue, en lecture (plan 04, C9), identité (plan 06)
et espaces (plan 08). Le catalogue se lit dans un espace, avec le rôle lecteur (plan 08, E9).

Avec OIDC, toute route `/api` exige une session. Sans OIDC, le serveur n'écoute que sur la
boucle locale, sans identité, et refuse de démarrer ailleurs (plan 06, I7). Une erreur est
une réponse JSON à code fermé, jamais une trace.
"""

from __future__ import annotations

import dataclasses
import os
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from enum import Enum
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import Engine
from starlette.exceptions import HTTPException

from .catalog import (
    AtlasStatus,
    CatalogConfig,
    CatalogService,
    CatalogUnavailable,
    DiffRefusal,
    DiffRefused,
    DocumentKind,
    HistoryUnavailable,
)
from .identity import (
    ConfigError,
    IdentityRuntime,
    UrllibHttp,
    build_runtime,
    install_identity,
    is_loopback,
)
from .identity import config_from_env as identity_from_env
from .spaces import Spaces, SpaceStore, install_spaces
from .state import (
    DATABASE_URL,
    PgLoginRequests,
    PgSessionStore,
    SchemaError,
    check_schema,
    connect,
)
from .state import config_from_env as database_from_env
from .telemetry import Recorder, TelemetryMiddleware, TelemetryStore, configure_logging

REPOSITORY_VARIABLE = "SKIFER_BOARD_ATLAS_REPOSITORY"
STATE_VARIABLE = "SKIFER_BOARD_STATE_DIR"
VERSION_PARAMETER = "Numéro de version taguée : entier strictement positif."


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


def _version(value: str | None) -> int | None:
    """Numéro de version d'un paramètre : entier strictement positif écrit en chiffres."""
    if value is None or not value.isascii() or not value.isdigit() or int(value) < 1:
        return None
    return int(value)


# Statut HTTP d'un écart refusé (plan 05, V6).
_REFUSAL_STATUS = {
    DiffRefusal.VERSION_NOT_FOUND: 404,
    DiffRefusal.NOT_SUPPORTED: 400,
    DiffRefusal.UNRESOLVABLE: 422,
}


def _history_unavailable(found: HistoryUnavailable) -> JSONResponse:
    return _error(503, "history_unavailable", problem=found.problem.value, detail=found.detail)


def create_app(
    catalog: CatalogService,
    identity: IdentityRuntime | None = None,
    spaces: Spaces | None = None,
    recorder: Recorder | None = None,
) -> FastAPI:
    """Sans espaces fournis, le mode local a son espace implicite (plan 08, E11) ; avec OIDC,
    les espaces en base sont obligatoires. Sans enregistreur fourni, les mesures ne vont qu'au
    journal (plan 11, T4)."""
    if spaces is None:
        if identity is not None:
            raise ValueError("Avec OIDC, les espaces en base sont obligatoires.")
        spaces = Spaces.local(catalog.config.repository.name, lambda: datetime.now(UTC))
    elif identity is not None and spaces.admin_group != identity.config.admin_group:
        # `/api/me` et les espaces doivent nommer le même groupe d'administration (E6).
        raise ValueError("Le groupe d'administration des espaces diffère de celui de l'identité.")
    telemetry = Recorder(None) if recorder is None else recorder

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        # Le fil d'écriture vit avec le serveur ; à l'arrêt, la file est vidée (plan 11, T5).
        telemetry.start()
        try:
            yield
        finally:
            telemetry.stop()

    app = FastAPI(
        title="Skifer Board", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    install_identity(app, identity)
    reader = Depends(install_spaces(app, spaces).reader)
    catalog_path = "/api/spaces/{space_id}/catalog"

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, error: HTTPException) -> JSONResponse:
        codes = {404: "route_not_found", 405: "method_not_allowed"}
        return _error(error.status_code, codes.get(error.status_code, "http_error"))

    @app.exception_handler(Exception)
    async def internal_error(request: Request, error: Exception) -> JSONResponse:
        return _error(500, "internal_error")

    @app.get(catalog_path, dependencies=[reader])
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

    @app.get(catalog_path + "/{document_id}", dependencies=[reader])
    def get_document(document_id: str) -> JSONResponse:
        found = catalog.get(document_id)
        if found is None:
            return _error(404, "document_not_found", id=document_id)
        if isinstance(found, CatalogUnavailable):
            return _unavailable(found)
        return JSONResponse(to_json(found))

    @app.get(catalog_path + "/{document_id}/versions", dependencies=[reader])
    def get_versions(document_id: str) -> JSONResponse:
        found = catalog.versions(document_id)
        if found is None:
            return _error(404, "document_not_found", id=document_id)
        if isinstance(found, HistoryUnavailable):
            return _history_unavailable(found)
        return JSONResponse(to_json(found))

    @app.get(catalog_path + "/{document_id}/diff", dependencies=[reader])
    def get_diff(
        document_id: str, base: str | None = None, other: str | None = None
    ) -> JSONResponse:
        first, second = _version(base), _version(other)
        if first is None or second is None:
            parameter = "base" if first is None else "other"
            return _error(400, "invalid_parameter", parameter=parameter, detail=VERSION_PARAMETER)
        found = catalog.diff(document_id, first, second)
        if found is None:
            return _error(404, "document_not_found", id=document_id)
        if isinstance(found, HistoryUnavailable):
            return _history_unavailable(found)
        if isinstance(found, DiffRefused):
            status = _REFUSAL_STATUS[found.reason]
            return _error(status, found.reason.value, id=document_id, detail=found.detail)
        return JSONResponse(to_json(found))

    # Ajouté en dernier, donc le plus extérieur : la garde d'identité et ses refus sont mesurés.
    app.add_middleware(
        TelemetryMiddleware,
        routes=app.router.routes,
        recorder=telemetry,
        clock=lambda: datetime.now(UTC),
    )
    return app


def config_from_env(environ: Mapping[str, str]) -> CatalogConfig:
    """Clone de l'espace et répertoire d'état, tous deux obligatoires : aucun défaut deviné."""
    missing = [name for name in (REPOSITORY_VARIABLE, STATE_VARIABLE) if not environ.get(name)]
    if missing:
        raise SystemExit(f"Variables d'environnement manquantes : {', '.join(missing)}.")
    return CatalogConfig(Path(environ[REPOSITORY_VARIABLE]), Path(environ[STATE_VARIABLE]))


def state_engine(environ: Mapping[str, str]) -> Engine | None:
    """Base d'état, ou `None` si aucune n'est configurée. Refuse de démarrer sur une adresse
    malformée, une base injoignable ou un schéma qui n'est pas à jour (plan 07, P4)."""
    try:
        config = database_from_env(environ)
    except ConfigError as error:
        raise SystemExit(str(error)) from error
    if config is None:
        return None
    engine = connect(config)
    try:
        check_schema(engine, config)
    except SchemaError as error:
        engine.dispose()
        raise SystemExit(str(error)) from error
    return engine


def spaces_for(
    identity: IdentityRuntime | None, engine: Engine | None, atlas: str
) -> Spaces | None:
    """Espaces en base avec OIDC ; `None` en mode local, où l'espace est implicite (E11)."""
    if identity is None:
        return None
    if engine is None:
        raise SystemExit(f"Avec OIDC, la base d'état est obligatoire : {DATABASE_URL} est absente.")
    return Spaces.database(SpaceStore(engine), atlas, identity.config.admin_group, identity.clock)


def identity_runtime(
    environ: Mapping[str, str], host: str, engine: Engine | None
) -> IdentityRuntime | None:
    """Identité du serveur, ou `None` en mode local. Refuse de démarrer hors de la boucle
    locale sans OIDC, sur une configuration OIDC incomplète (plan 06, I7), et avec OIDC
    sans base d'état (plan 07, P5)."""
    try:
        config = identity_from_env(environ)
    except ConfigError as error:
        raise SystemExit(str(error)) from error
    if config is None:
        if not is_loopback(host):
            raise SystemExit(
                f"Sans OIDC, le serveur n'écoute que sur la boucle locale ; {host} est refusé."
            )
        return None
    if engine is None:
        raise SystemExit(f"Avec OIDC, la base d'état est obligatoire : {DATABASE_URL} est absente.")
    # Sessions et demandes de connexion en base : plusieurs processus, et un redémarrage ne
    # déconnecte personne (plan 07, P6 et P7).
    return build_runtime(
        config,
        UrllibHttp(),
        lambda: datetime.now(UTC),
        PgSessionStore(engine, config.session_absolute, config.session_idle),
        PgLoginRequests(engine),
        # Chaque connexion enregistre la personne, pour qu'on puisse la lier à un espace
        # (plan 08, E5).
        SpaceStore(engine).record_login,
    )


def main() -> None:
    host = os.environ.get("SKIFER_BOARD_HOST", "127.0.0.1")
    engine = state_engine(os.environ)
    identity = identity_runtime(os.environ, host, engine)
    catalog = config_from_env(os.environ)
    spaces = spaces_for(identity, engine, catalog.repository.name)
    # Mesures en base s'il y en a une, toujours sur la sortie standard (plan 11, T4).
    configure_logging()
    recorder = Recorder(None if engine is None else TelemetryStore(engine))
    service = CatalogService(catalog, measure=recorder.submit)
    app = create_app(service, identity, spaces, recorder)
    uvicorn.run(app, host=host, port=int(os.environ.get("SKIFER_BOARD_PORT", "8000")))
