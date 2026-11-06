"""Unique frontière Board → skifer pour les lectures sémantiques (plan 12.4).

Ce module ne reçoit que des noms et des filtres déclaratifs. Le texte SQL reste
dans le moteur et le connecteur ; l'appelant ne peut ni le fournir ni le réécrire.
"""

from __future__ import annotations

import re
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from hashlib import sha256
from pathlib import Path
from typing import Any

import yaml
from skifer.agentic.resolver import SemanticQuery, SemanticQueryError
from skifer.observability.certification_store import SqliteCertificationStore
from skifer.semantic.access_policy import ConsumerContext, SemanticAccessDenied
from skifer.semantic.evidence import ExecutionResult, SemanticExecutionError, hash_sql
from skifer.semantic.semantic import SemanticEngine

from ..contextual.rules import Additivity, Aggregation
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


def certification_store_from_path(path: Path | None) -> SqliteCertificationStore | None:
    """Ouvre uniquement un magasin de certification déjà provisionné par l'exploitant."""
    if path is None:
        return None
    if not path.is_absolute() or not path.is_file():
        raise ValueError("Certification store must be an existing absolute file.")
    return SqliteCertificationStore(str(path))


def _all_models_have_row_policy(models_dir: Path) -> bool:
    """Chaque lecture exige la RLS sur tous les modèles du catalogue."""
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


_MAX_MODELS = 100
_MAX_FIELDS = 500
_MAX_TEXT = 1024
_IDENTIFIER = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,79}\Z")


def _text(value: Any) -> str:
    if not isinstance(value, str) or len(value) > _MAX_TEXT:
        raise ValueError("Texte de catalogue invalide")
    value.encode("utf-8")
    return value


def _name(value: Any) -> str:
    name = _text(value)
    if _IDENTIFIER.fullmatch(name) is None:
        raise ValueError("Nom de catalogue invalide")
    return name


def _fields(model: dict[str, Any], entry: dict[str, Any], kind: str) -> list[dict[str, Any]]:
    definitions = model.get(kind, [])
    declared = entry.get(kind, [])
    if not isinstance(definitions, list) or not isinstance(declared, list):
        raise ValueError("Champs invalides")
    if len(definitions) > _MAX_FIELDS:
        raise ValueError("Trop de champs")
    if len(declared) > _MAX_FIELDS:
        raise ValueError("Trop de champs")
    result: list[dict[str, Any]] = []
    for item in definitions:
        if not isinstance(item, dict):
            raise ValueError("Champ invalide")
        name = _name(item.get("name"))
        field: dict[str, Any] = {
            "name": name,
            "label": _text(item.get("label", name)),
            "description": _text(item.get("description", "")),
        }
        if kind == "metrics":
            try:
                aggregation = Aggregation(str(item.get("type", "")).lower())
            except ValueError:
                aggregation = None
            field["aggregation"] = aggregation.value if aggregation is not None else None
            try:
                declared_additivity = Additivity(item.get("additivity", Additivity.ADDITIVE))
            except (ValueError, TypeError):
                declared_additivity = Additivity.NON_ADDITIVE
            field["additivity"] = (
                declared_additivity.value
                if aggregation in (Aggregation.SUM, Aggregation.COUNT)
                else Additivity.NON_ADDITIVE.value
            )
        else:
            raw_type = item.get("type", "unknown")
            logical_type = raw_type.lower() if isinstance(raw_type, str) else "unknown"
            field["type"] = {
                "string": "string",
                "integer": "number",
                "float": "number",
                "number": "number",
                "date": "date",
                "timestamp": "timestamp",
                "datetime": "timestamp",
                "boolean": "boolean",
            }.get(logical_type, "unknown")
            field["is_time"] = name == model.get("default_time_dimension") or field["type"] in {
                "date",
                "timestamp",
            }
        result.append(field)
    names = [item["name"] for item in result]
    catalog_names = [item.get("name") if isinstance(item, dict) else item for item in declared]
    if (
        len(set(names)) != len(names)
        or len(set(catalog_names)) != len(catalog_names)
        or set(names) != set(catalog_names)
    ):
        raise ValueError("Champs du catalogue incohérents")
    return sorted(result, key=lambda item: item["name"])


def describe_catalog(models_dir: Path) -> dict[str, Any]:
    """Décrit les champs chargés par skifer, sans accéder à une source de données."""
    try:
        catalog = yaml.safe_load((models_dir / "semantic_catalog.yaml").read_text())
        entries_raw = catalog["models"]
        if len(entries_raw) > _MAX_MODELS or len({entry["key"] for entry in entries_raw}) != len(
            entries_raw
        ):
            raise ValueError("Catalogue invalide")
        if any(
            (models_dir / entry["file"]).resolve().parent != models_dir.resolve()
            for entry in entries_raw
        ):
            raise ValueError("Fichier hors du répertoire")
        if not _all_models_have_row_policy(models_dir):
            raise ValueError("Politique de ligne absente")
        # list_models ne fournit que le résumé ; le chargeur interne est celui du planner.
        engine = SemanticEngine.from_backend(_DescriptionBackend(), models_dir=str(models_dir))
        entries = engine.list_models()
        if not entries or len(entries) > _MAX_MODELS:
            raise ValueError("Nombre de modèles invalide")
        result = []
        for entry in entries:
            name = _name(entry["key"])
            model = engine._get_model(name)
            result.append(
                {
                    "name": name,
                    "label": _text(model.get("label", name)),
                    "description": _text(model.get("description", entry.get("description", ""))),
                    "metrics": _fields(model, entry, "metrics"),
                    "dimensions": _fields(model, entry, "dimensions"),
                }
            )
        return {"models": sorted(result, key=lambda item: item["name"])}
    except (
        OSError,
        KeyError,
        TypeError,
        ValueError,
        AttributeError,
        RecursionError,
        yaml.YAMLError,
    ):
        raise SemanticRefusal("engine_unavailable") from None


class _DescriptionBackend:
    def execute_sql(self, sql: str) -> None:
        raise RuntimeError("La description ne lit aucune source")


class _Backend:
    def __init__(
        self,
        connector: ExecutionConnector,
        *,
        deadline: float,
        clock: Callable[[], float],
        pause: Callable[[float], None],
        on_statement: Callable[[str], bool] | None,
        cancel_requested: Callable[[], bool] | None,
        can_cancel: bool,
    ) -> None:
        self.connector = connector
        self.deadline = deadline
        self.clock = clock
        self.pause = pause
        self.on_statement = on_statement
        self.cancel_requested = cancel_requested
        self.can_cancel = can_cancel
        self.sql_hash: str | None = None
        self.refusal: str | None = None

    def execute_sql_with_metadata(self, sql: str) -> ExecutionResult:
        try:
            return self._execute(sql)
        except ConnectorError as error:
            self.refusal = error.code
            raise

    def _execute(self, sql: str) -> ExecutionResult:
        self.sql_hash = hash_sql(sql)
        status = self.connector.execute(sql)
        if self.clock() >= self.deadline:
            self.refusal = "execution_timed_out"
            raise SemanticRefusal("execution_timed_out")
        statement_id = status.statement_id
        if self.on_statement is not None and not self.on_statement(statement_id):
            self.refusal = "execution_lost"
            raise SemanticRefusal("execution_lost")
        cancel_sent = False
        while status.state in {"PENDING", "RUNNING"}:
            if (
                self.can_cancel
                and not cancel_sent
                and self.cancel_requested is not None
                and self.cancel_requested()
            ):
                self.connector.cancel(statement_id)
                cancel_sent = True
            if self.clock() >= self.deadline:
                self.refusal = "execution_timed_out"
                raise SemanticRefusal("execution_timed_out")
            self.pause(min(0.2, max(0.0, self.deadline - self.clock())))
            status = self.connector.status(statement_id)
            if status.statement_id != statement_id:
                self.refusal = "invalid_upstream"
                raise SemanticRefusal("invalid_upstream")
        if status.state == "CANCELED":
            self.refusal = "cancelled"
            raise SemanticRefusal("cancelled")
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
    on_statement: Callable[[str], bool] | None = None,
    cancel_requested: Callable[[], bool] | None = None,
) -> SemanticOutput:
    """Autorise, compile et exécute une lecture complète, ou refuse sans résultat."""
    if (
        getattr(connector, "identity_mode", IdentityMode.SERVICE) is not binding.identity_mode
        or (
            binding.identity_mode is IdentityMode.PERSON
            and binding.connector is not Connector.DATABRICKS
        )
        or binding.connector not in (Connector.DUCKDB, Connector.DATABRICKS)
        or certification_mode not in {"off", "enforce", "supervised"}
        or timeout_seconds <= 0
        or not _all_models_have_row_policy(models_dir)
    ):
        raise SemanticRefusal("engine_unavailable")
    backend = _Backend(
        connector,
        deadline=clock() + timeout_seconds,
        clock=clock,
        pause=pause,
        on_statement=on_statement,
        cancel_requested=cancel_requested,
        can_cancel=binding.connector == Connector.DATABRICKS,
    )
    if cancel_requested is not None and cancel_requested():
        raise SemanticRefusal("cancelled")
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
                filters=[
                    {**item, "operator": "neq" if item["operator"] == "ne" else item["operator"]}
                    for item in request.filters
                ],
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
    policy_models = {
        item.get("model_key")
        for item in evidence.get("normalized_filters", ())
        if item.get("origin") == "policy"
        and item.get("operator") == "eq"
        and item.get("value") == "<redacted>"
    }
    if (
        evidence.get("sql_hash") != backend.sql_hash
        or evidence.get("sql_dialect") != dialect
        or evidence.get("execution_status") != "succeeded"
        or evidence.get("policy", {}).get("decision") not in {"ALLOW", "WARN"}
        or not evidence.get("evidence_id")
        or not evidence.get("sources")
        or not evidence.get("model_keys")
        or not set(evidence["model_keys"]).issubset(policy_models)
    ):
        raise SemanticRefusal("evidence_invalid")
    return SemanticOutput(result.dataframe, evidence)
