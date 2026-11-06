import { boolean, ContractError, instant, integer, list, nullable, object, oneOf, text } from "../catalogue/decode";
import { CONNECTION_NAME } from "../spaces/connections";
import { ENVIRONMENTS, type Environment } from "../shell/sections";

/** Réponse suivie du plan 12 : aucune requête SQL ni identité de source ne franchit ce contrat. */
export const STATES = ["queued", "running", "succeeded", "denied", "failed", "timed_out", "cancelled"] as const;
export type ExecutionState = (typeof STATES)[number];
export const ERRORS = [
  "deny", "require_human", "cancelled", "execution_timed_out", "execution_failed", "execution_lost",
  "invalid_upstream", "connector_unavailable", "engine_unavailable", "evidence_invalid", "worker_unavailable",
  "server_restarted", "credential_rejected", "redirect_refused", "endpoint_not_configured", "identity_unavailable",
  "vault_unavailable", "credential_not_found",
] as const;
export type ExecutionError = (typeof ERRORS)[number];

export interface Proof {
  evidenceId: string;
  sqlHash: string;
  modelKeys: readonly string[];
  metrics: readonly { name: string; model_key: string; definition_hash: string; source_columns: readonly string[]; lineage_status: string; certification: "CERTIFIED" | "CANDIDATE"; candidate_id: string | null }[];
  dimensions: readonly string[];
  filters: readonly { column: string; operator: string; origin: "policy" | "exploration"; modelKey: string | null; value: string | null; definitionHash: string | null }[];
  sources: readonly { dataset: string; certification_status: string; data_age_seconds: number | null; load_age_seconds: number | null }[];
  policy: { decision: "ALLOW" | "WARN"; reasons: readonly string[]; evaluated_at: Date };
  statementId: string | null;
  sqlDialect: string;
  duration: number | null;
}

export const AGGREGATIONS = ["sum", "count", "count_distinct", "avg", "min", "max"] as const;
export const ADDITIVITIES = ["additive", "semi_additive", "non_additive"] as const;
export interface ResultContract {
  dimensions: readonly string[];
  metrics: readonly { name: string; aggregation: (typeof AGGREGATIONS)[number] | null; additivity: (typeof ADDITIVITIES)[number] }[];
  completeness: "complete" | "truncated";
}

export interface Execution {
  id: string;
  space: string;
  environment: Environment;
  connection: string;
  state: ExecutionState;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  deadlineAt: Date;
  canCancel: boolean;
  cancelRequested: boolean;
  errorCode: ExecutionError | null;
  rows: number | null;
  size: number | null;
  truncated: boolean | null;
  proof: Proof | null;
  connectorRunId: string | null;
  resultContract: ResultContract | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE_KEYS = [
  "id", "space_id", "environment", "connection", "state", "created_at", "started_at", "finished_at",
  "deadline_at", "can_cancel", "cancel_requested", "error_code", "rows", "size", "truncated",
] as const;
const DETAIL_KEYS = [...BASE_KEYS, "evidence", "connector_run_id"] as const;
const SUCCESS_DETAIL_KEYS = [...DETAIL_KEYS, "result_contract"] as const;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;

const base = object({
  id: text,
  space_id: text,
  environment: oneOf(ENVIRONMENTS),
  connection: text,
  state: oneOf(STATES),
  created_at: instant,
  started_at: nullable(instant),
  finished_at: nullable(instant),
  deadline_at: instant,
  can_cancel: boolean,
  cancel_requested: boolean,
  error_code: nullable(oneOf(ERRORS)),
  rows: nullable(integer),
  size: nullable(integer),
  truncated: nullable(boolean),
});

function exact(value: unknown, keys: readonly string[], path: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) {
    throw new ContractError(`${path} : champs attendus`);
  }
}

const nonnegative = (value: unknown, path: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new ContractError(`${path} : nombre positif attendu`);
  return value;
};
const nonempty = (value: unknown, path: string): string => {
  const found = text(value, path);
  if (!found) throw new ContractError(`${path} : texte non vide attendu`);
  return found;
};
function proofOf(value: unknown, path: string): Proof {
  exact(value, ["schema_version", "evidence_id", "trace_id", "model_keys", "metrics", "dimensions", "normalized_filters", "sources", "policy", "sql_hash", "sql_dialect", "statement_id", "compiled_at", "executed_at", "execution_status", "execution_duration_seconds", "execution_error_type"], path);
  const metric = (item: unknown, p: string) => {
    exact(item, ["name", "model_key", "definition_hash", "source_columns", "lineage_status", "certification", "candidate_id"], p);
    return object({ name: nonempty, model_key: nonempty, definition_hash: nonempty, source_columns: list(text), lineage_status: nonempty, certification: oneOf(["CERTIFIED", "CANDIDATE"] as const), candidate_id: nullable(text) })(item, p);
  };
  const source = (item: unknown, p: string) => {
    exact(item, ["dataset", "contract_id", "contract_version", "definition_hash", "certification_status", "certified_at", "load_age_seconds", "data_age_seconds", "certification_run_id"], p);
    return object({ dataset: nonempty, contract_id: nullable(text), contract_version: nullable(text), definition_hash: nullable(text), certification_status: nonempty, certified_at: nullable(instant), load_age_seconds: nullable(nonnegative), data_age_seconds: nullable(nonnegative), certification_run_id: nullable(text) })(item, p);
  };
  const filter = (item: unknown, p: string) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new ContractError(`${p} : filtre invalide`);
    const raw = item as Record<string, unknown>;
    if (Object.keys(raw).some((key) => !["column", "operator", "origin", "model_key", "definition_hash", "value"].includes(key))) throw new ContractError(`${p} : filtre invalide`);
    const column = nonempty(raw.column, p); const operator = nonempty(raw.operator, p);
    const origin = raw.origin === undefined ? "exploration" : oneOf(["policy", "exploration"] as const)(raw.origin, p);
    const modelKey = raw.model_key === undefined ? null : nonempty(raw.model_key, p);
    const definitionHash = raw.definition_hash === undefined ? null : nonempty(raw.definition_hash, p);
    const filterValue = raw.value === undefined ? null : oneOf(["<redacted>"] as const)(raw.value, p);
    return { column, operator, origin, modelKey, definitionHash, value: filterValue };
  };
  const policy = (item: unknown, p: string) => { exact(item, ["decision", "reasons", "evaluated_at"], p); return object({ decision: oneOf(["ALLOW", "WARN"] as const), reasons: list(text), evaluated_at: instant })(item, p); };
  const found = object({ schema_version: oneOf(["2"] as const), evidence_id: nonempty, trace_id: nullable(text), model_keys: list(nonempty), metrics: list(metric), dimensions: list(nonempty), normalized_filters: list(filter), sources: list(source), policy, sql_hash: nonempty, sql_dialect: nonempty, statement_id: nullable(text), compiled_at: instant, executed_at: nullable(instant), execution_status: oneOf(["succeeded"] as const), execution_duration_seconds: nullable(nonnegative), execution_error_type: nullable(text) })(value, path);
  if (!found.model_keys.length || !found.sources.length) throw new ContractError(`${path} : preuve incomplète`);
  return { evidenceId: found.evidence_id, sqlHash: found.sql_hash, modelKeys: found.model_keys, metrics: found.metrics, dimensions: found.dimensions, filters: found.normalized_filters, sources: found.sources, policy: found.policy, statementId: found.statement_id, sqlDialect: found.sql_dialect, duration: found.execution_duration_seconds };
}

function resultContractOf(value: unknown, path: string): ResultContract {
  exact(value, ["dimensions", "metrics", "completeness"], path);
  const found = object({
    dimensions: list(text),
    metrics: list((item: unknown, metricPath: string) => {
      exact(item, ["name", "aggregation", "additivity"], metricPath);
      return object({ name: text, aggregation: nullable(oneOf(AGGREGATIONS)), additivity: oneOf(ADDITIVITIES) })(item, metricPath);
    }),
    completeness: oneOf(["complete", "truncated"] as const),
  })(value, path);
  const names = found.metrics.map((metric) => metric.name);
  if (found.dimensions.length > 32 || found.metrics.length === 0 || found.metrics.length > 32
    || found.dimensions.some((name) => !IDENTIFIER.test(name)) || names.some((name) => !IDENTIFIER.test(name))
    || found.metrics.some((metric) => metric.aggregation !== "sum" && metric.aggregation !== "count" && metric.additivity !== "non_additive")
    || new Set(found.dimensions).size !== found.dimensions.length || new Set(names).size !== names.length) {
    throw new ContractError(`${path} : dimensions et métriques invalides`);
  }
  return found;
}

export function decodeExecution(value: unknown, space: string): Execution {
  const hasProof = typeof value === "object" && value !== null && "evidence" in value;
  const raw = base(value, "exécution");
  exact(value, hasProof ? raw.state === "succeeded" ? SUCCESS_DETAIL_KEYS : DETAIL_KEYS : BASE_KEYS, "exécution");
  if (raw.space_id !== space || !UUID.test(raw.id) || !CONNECTION_NAME.test(raw.connection)) {
    throw new ContractError("exécution : espace, identifiant ou connexion inattendu");
  }
  const created = raw.created_at.getTime();
  const started = raw.started_at?.getTime();
  const finished = raw.finished_at?.getTime();
  if (raw.deadline_at.getTime() < created || (started !== undefined && started < created) || (finished !== undefined && finished < (started ?? created))) {
    throw new ContractError("exécution : horodatages incohérents");
  }
  const active = raw.state === "queued" || raw.state === "running";
  if (
    (active && (raw.finished_at !== null || raw.error_code !== null || raw.rows !== null || raw.size !== null || raw.truncated !== null))
    || (raw.state === "queued" && (raw.started_at !== null || raw.cancel_requested))
    || (raw.state === "running" && raw.started_at === null)
    || (!active && (raw.finished_at === null || raw.can_cancel))
    || (raw.cancel_requested && raw.can_cancel)
  ) {
    throw new ContractError("exécution : état incohérent");
  }
  const succeeded = raw.state === "succeeded";
  if (
    (succeeded && (raw.started_at === null || raw.error_code !== null || raw.rows === null || raw.size === null || raw.truncated === null))
    || (!succeeded && !active && (raw.error_code === null || raw.rows !== null || raw.size !== null || raw.truncated !== null))
    || (raw.rows !== null && (raw.rows < 0 || raw.rows > 1000))
    || (raw.size !== null && (raw.size < 0 || raw.size > 1024 * 1024))
    || (raw.state === "denied" && raw.error_code !== "deny" && raw.error_code !== "require_human")
    || (raw.state === "cancelled" && raw.error_code !== "cancelled")
    || (raw.state === "timed_out" && raw.error_code !== "execution_timed_out")
  ) {
    throw new ContractError("exécution : résultat ou refus incohérent");
  }
  let proof: Proof | null = null;
  let connectorRunId: string | null = null;
  let resultContract: ResultContract | null = null;
  if (hasProof) {
    const detail = object({ evidence: nullable(proofOf), connector_run_id: nullable(text) })(value, "exécution");
    if ((succeeded && detail.evidence === null) || (!succeeded && detail.evidence !== null) || (detail.connector_run_id !== null && !UUID.test(detail.connector_run_id))) {
      throw new ContractError("exécution : preuve ou trace incohérente");
    }
    proof = detail.evidence;
    connectorRunId = detail.connector_run_id;
    if (succeeded) {
      resultContract = object({ result_contract: nullable(resultContractOf) })(value, "exécution").result_contract;
      if (resultContract !== null && (resultContract.completeness === "truncated") !== raw.truncated) {
        throw new ContractError("exécution : complétude incohérente");
      }
    }
  }
  return {
    id: raw.id, space: raw.space_id, environment: raw.environment, connection: raw.connection,
    state: raw.state, createdAt: raw.created_at, startedAt: raw.started_at, finishedAt: raw.finished_at,
    deadlineAt: raw.deadline_at, canCancel: raw.can_cancel, cancelRequested: raw.cancel_requested,
    errorCode: raw.error_code, rows: raw.rows, size: raw.size, truncated: raw.truncated, proof, connectorRunId, resultContract,
  };
}

export function decodeExecutions(value: unknown, space: string): readonly Execution[] {
  exact(value, ["executions"], "liste");
  const rows = object({ executions: list((item) => decodeExecution(item, space)) })(value, "liste").executions;
  if (rows.length > 50 || new Set(rows.map((row) => row.id)).size !== rows.length || rows.some((row, index) => {
    const previous = rows[index - 1];
    return previous !== undefined && row.createdAt.getTime() > previous.createdAt.getTime();
  })) {
    throw new ContractError("liste : nombre, ordre ou identifiants incohérents");
  }
  return rows;
}
