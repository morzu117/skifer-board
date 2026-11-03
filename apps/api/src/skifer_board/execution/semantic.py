"""Unique frontière Board → skifer pour les lectures sémantiques (plan 12.4).

Ce module ne reçoit que des noms et des filtres déclaratifs. Le texte SQL reste
dans le moteur et le connecteur ; l'appelant ne peut ni le fournir ni le réécrire.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from hashlib import sha256
from pathlib import Path
from typing import Any

import yaml
from skifer.agentic.resolver import SemanticQuery, SemanticQueryError
from skifer.semantic.access_policy import ConsumerContext, SemanticAccessDenied
from skifer.semantic.evidence import ExecutionResult, SemanticExecutionError, hash_sql
from skifer.semantic.semantic import SemanticEngine

from ..identity.model import Identity
from .connectors import ConnectorError, ExecutionConnector
from .model import Binding, Connector, IdentityMode


class SemanticRefusal(Exception):
    """Refus à code fermé, sans SQL, secret ni attribut d'identité."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class SemanticRequest:
    model: str
    metrics: tuple[str, ...]
    dimensions: tuple[str, ...] = ()
    filters: tuple[Mapping[str, Any], ...] = ()


@dataclass(frozen=True)
class VerifiedReader:
    """Identité OIDC vérifiée et attributs obtenus d'une source serveur fiable."""

    identity: Identity
    attributes: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class SemanticOutput:
    rows: Any
    evidence: dict[str, Any]


def _all_models_have_row_policy(models_dir: Path) -> bool:
    """Une liaison de service exige la RLS sur chaque modèle du catalogue."""
    try:
        catalog = yaml.safe_load((models_dir / "semantic_catalog.yaml").read_text())
        entries = catalog["models"]
        if not isinstance(entries, list) or not entries:
            return False
        for entry in entries:
            name = entry["file"]
            if not isinstance(name, str) or Path(name).name != name:
                return False
            document = yaml.safe_load((models_dir / name).read_text())
            models = document["models"]
            if not isinstance(models, list) or not models:
                return False
            if any(not isinstance(model, dict) or not model.get("row_policy") for model in models):
                return False
        return True
    except (OSError, KeyError, TypeError, ValueError, yaml.YAMLError):
        return False


class _Backend:
    def __init__(
        self,
        connector: ExecutionConnector,
        *,
        deadline: float,
        clock: Callable[[], float],
        pause: Callable[[float], None],
    ) -> None:
        self.connector = connector
        self.deadline = deadline
        self.clock = clock
        self.pause = pause
        self.sql_hash: str | None = None
        self.refusal: str | None = None

    def execute_sql_with_metadata(self, sql: str) -> ExecutionResult:
        self.sql_hash = hash_sql(sql)
        status = self.connector.execute(sql)
        if self.clock() >= self.deadline:
            self.refusal = "execution_timed_out"
            raise SemanticRefusal("execution_timed_out")
        statement_id = status.statement_id
        while status.state in {"PENDING", "RUNNING"}:
            if self.clock() >= self.deadline:
                self.refusal = "execution_timed_out"
                raise SemanticRefusal("execution_timed_out")
            self.pause(min(0.2, max(0.0, self.deadline - self.clock())))
            status = self.connector.status(statement_id)
            if status.statement_id != statement_id:
                self.refusal = "invalid_upstream"
                raise SemanticRefusal("invalid_upstream")
        if status.state != "SUCCEEDED":
            self.refusal = "execution_failed"
            raise SemanticRefusal("execution_failed")
        rows = self.connector.result(statement_id)
        if self.clock() >= self.deadline:
            self.refusal = "execution_timed_out"
            raise SemanticRefusal("execution_timed_out")
        return ExecutionResult(rows, statement_id)


def run_semantic(
    request: SemanticRequest,
    reader: VerifiedReader,
    binding: Binding,
    connector: ExecutionConnector,
    *,
    models_dir: Path,
    certification_store: Any = None,
    certification_mode: str = "enforce",
    timeout_seconds: float = 30.0,
    clock: Callable[[], float] = time.monotonic,
    pause: Callable[[float], None] = time.sleep,
) -> SemanticOutput:
    """Autorise, compile et exécute une lecture complète, ou refuse sans résultat."""
    if (
        binding.identity_mode != IdentityMode.SERVICE
        or binding.connector not in (Connector.DUCKDB, Connector.DATABRICKS)
        or certification_mode not in {"off", "enforce", "supervised"}
        or timeout_seconds <= 0
        or not _all_models_have_row_policy(models_dir)
    ):
        raise SemanticRefusal("engine_unavailable")
    backend = _Backend(connector, deadline=clock() + timeout_seconds, clock=clock, pause=pause)
    user_id = sha256(f"{reader.identity.issuer}\0{reader.identity.subject}".encode()).hexdigest()
    context = ConsumerContext(
        consumer_id=user_id,
        consumer_class="board",
        user_id=user_id,
        attributes=reader.attributes,
    )
    dialect = "duckdb" if binding.connector == Connector.DUCKDB else "databricks"
    try:
        engine = SemanticEngine.from_backend(
            backend,
            models_dir=str(models_dir),
            environment=binding.environment.value,
            dialect=dialect,
            certification_store=certification_store,
            config={
                "environments": {
                    binding.environment.value.lower(): {
                        "semantic_certification_policy": certification_mode
                    }
                }
            },
        )
        result = engine.query_with_evidence(
            SemanticQuery(
                model_name=request.model,
                metrics=list(request.metrics),
                group_by=list(request.dimensions),
                filters=[dict(item) for item in request.filters],
            ),
            consumer_context=context,
        )
    except SemanticAccessDenied as error:
        raise SemanticRefusal(error.decision.value.lower()) from None
    except SemanticExecutionError:
        raise SemanticRefusal(backend.refusal or "execution_failed") from None
    except (SemanticQueryError, ConnectorError, OSError, ValueError, TypeError):
        raise SemanticRefusal("engine_unavailable") from None
    evidence = result.evidence.to_dict()
    if (
        evidence.get("sql_hash") != backend.sql_hash
        or evidence.get("sql_dialect") != dialect
        or evidence.get("execution_status") != "succeeded"
        or evidence.get("policy", {}).get("decision") not in {"ALLOW", "WARN"}
        or not evidence.get("evidence_id")
        or not evidence.get("sources")
    ):
        raise SemanticRefusal("evidence_invalid")
    return SemanticOutput(result.dataframe, evidence)
