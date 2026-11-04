import { describe, expect, it } from "vitest";
import exemple from "../../../../contracts/executions/contextuel-detail.json";
import { ContractError } from "../catalogue/decode";
import { decodeExecution, decodeExecutions, ERRORS, STATES } from "./model";

const ID = "11111111-1111-1111-1111-111111111111";
const SECOND = "22222222-2222-2222-2222-222222222222";
const CREATED = "2026-11-04T00:00:00+00:00";
const STARTED = "2026-11-04T00:00:01+00:00";
const FINISHED = "2026-11-04T00:00:02+00:00";
const DEADLINE = "2026-11-04T00:00:30+00:00";

const success = {
  id: ID, space_id: "finance", environment: "DEV", connection: "source", state: "succeeded",
  created_at: CREATED, started_at: STARTED, finished_at: FINISHED, deadline_at: DEADLINE,
  can_cancel: false, cancel_requested: false, error_code: null, rows: 1, size: 128, truncated: false,
};
const evidence = { ...exemple.body.evidence, evidence_id: "evidence-1", sql_hash: "sha256:n1:abc", execution_status: "succeeded", model_keys: ["orders"] };
const contract = { dimensions: ["region"], metrics: [{ name: "revenue", aggregation: "sum", additivity: "additive" }], completeness: "complete" };
const detail = { ...success, evidence, connector_run_id: SECOND, result_contract: contract };
const running = { ...success, state: "running", finished_at: null, error_code: null, rows: null, size: null, truncated: null, can_cancel: true };
const queued = { ...running, state: "queued", started_at: null };
const denied = { ...success, state: "denied", error_code: "deny", rows: null, size: null, truncated: null };

function rejects(value: unknown): void {
  expect(() => decodeExecution(value, "finance")).toThrow(ContractError);
}

describe("contrat des exécutions suivies", () => {
  it("décode une réussite, sa preuve expurgée et les métadonnées d'administration", () => {
    const found = decodeExecution(detail, "finance");
    expect(found).toMatchObject({ id: ID, space: "finance", state: "succeeded", rows: 1, size: 128, truncated: false, proof: { evidenceId: "evidence-1", sqlHash: "sha256:n1:abc", modelKeys: ["orders"] }, connectorRunId: SECOND });
    expect(found.createdAt).toEqual(new Date(CREATED));
    expect(decodeExecution(success, "finance").proof).toBeNull();
    rejects({ ...success, evidence: null, connector_run_id: null });
  });

  it("décode le contrat réel, un ancien résultat sans contrat et une troncature", () => {
    expect(decodeExecution(exemple.body, "finance").resultContract).toEqual(exemple.body.result_contract);
    expect(decodeExecution({ ...detail, result_contract: null }, "finance").resultContract).toBeNull();
    expect(decodeExecution({ ...detail, truncated: true, result_contract: { ...contract, completeness: "truncated" } }, "finance").resultContract?.completeness).toBe("truncated");
    expect(decodeExecution({ ...detail, result_contract: { ...contract, dimensions: [], metrics: [{ name: "ratio", aggregation: null, additivity: "non_additive" }] } }, "finance").resultContract?.metrics[0]?.aggregation).toBeNull();
    expect(decodeExecution({ ...denied, evidence: null, connector_run_id: null }, "finance").resultContract).toBeNull();
  });

  it.each([
    { ...success, evidence, connector_run_id: SECOND },
    { ...success, result_contract: contract },
    { ...denied, evidence: null, connector_run_id: null, result_contract: null },
    { ...detail, result_contract: {} },
    { ...detail, result_contract: { ...contract, extra: true } },
    { ...detail, result_contract: { ...contract, dimensions: "region" } },
    { ...detail, result_contract: { ...contract, dimensions: ["region", "region"] } },
    { ...detail, result_contract: { ...contract, dimensions: ["mauvais nom"] } },
    { ...detail, result_contract: { ...contract, dimensions: Array.from({ length: 33 }, (_, i) => `d${String(i)}`) } },
    { ...detail, result_contract: { ...contract, metrics: [] } },
    { ...detail, result_contract: { ...contract, metrics: Array.from({ length: 33 }, (_, i) => ({ ...contract.metrics[0], name: `m${String(i)}` })) } },
    { ...detail, result_contract: { ...contract, metrics: [contract.metrics[0], contract.metrics[0]] } },
    { ...detail, result_contract: { ...contract, metrics: [{ ...contract.metrics[0], name: "!" }] } },
    { ...detail, result_contract: { ...contract, metrics: [{ ...contract.metrics[0], aggregation: "other" }] } },
    { ...detail, result_contract: { ...contract, metrics: [{ ...contract.metrics[0], additivity: "other" }] } },
    { ...detail, result_contract: { ...contract, metrics: [{ ...contract.metrics[0], aggregation: "avg", additivity: "additive" }] } },
    { ...detail, result_contract: { ...contract, metrics: [{ ...contract.metrics[0], aggregation: null, additivity: "additive" }] } },
    { ...detail, result_contract: { ...contract, metrics: [{ ...contract.metrics[0], extra: "sql" }] } },
    { ...detail, result_contract: { ...contract, completeness: "other" } },
    { ...detail, result_contract: { ...contract, completeness: "truncated" } },
    { ...detail, truncated: true, result_contract: contract },
  ])("refuse un contrat de résultat absent ou incohérent : %#", rejects);

  it("reconnaît les états actifs, les refus et une annulation avant départ", () => {
    expect(decodeExecution(queued, "finance")).toMatchObject({ state: "queued", startedAt: null, canCancel: true });
    expect(decodeExecution({ ...running, cancel_requested: true, can_cancel: false }, "finance")).toMatchObject({ state: "running", cancelRequested: true, canCancel: false });
    expect(decodeExecution(denied, "finance").errorCode).toBe("deny");
    expect(decodeExecution({ ...denied, error_code: "require_human" }, "finance").errorCode).toBe("require_human");
    expect(decodeExecution({ ...denied, state: "failed", error_code: "server_restarted" }, "finance").state).toBe("failed");
    expect(decodeExecution({ ...denied, state: "timed_out", error_code: "execution_timed_out" }, "finance").state).toBe("timed_out");
    expect(decodeExecution({ ...denied, state: "cancelled", error_code: "cancelled", started_at: null, cancel_requested: true }, "finance").state).toBe("cancelled");
    expect(STATES).toHaveLength(7);
    expect(ERRORS).toContain("invalid_upstream");
  });

  it.each([
    null, [], {}, { ...success, sql: "SELECT 1" }, { ...success, id: "bad" }, { ...success, space_id: "rh" },
    { ...success, connection: "bad name" }, { ...success, environment: "TESTING" }, { ...success, state: "other" },
    { ...success, error_code: "sql_error" }, { ...success, created_at: "bad" },
    { ...success, deadline_at: "2026-11-03T23:59:59Z" }, { ...success, started_at: "2026-11-03T23:59:59Z" },
    { ...success, finished_at: CREATED },
  ])("refuse une enveloppe, un identifiant ou un temps incohérent : %#", rejects);

  it.each([
    { ...running, finished_at: FINISHED }, { ...running, error_code: "execution_failed" },
    { ...running, rows: 1 }, { ...running, size: 1 }, { ...running, truncated: false },
    { ...queued, started_at: STARTED }, { ...queued, cancel_requested: true },
    { ...running, started_at: null }, { ...success, finished_at: null }, { ...success, can_cancel: true },
    { ...running, can_cancel: true, cancel_requested: true },
    { ...success, started_at: null }, { ...success, error_code: "execution_failed" },
    { ...success, rows: null }, { ...success, size: null }, { ...success, truncated: null },
    { ...denied, error_code: null }, { ...denied, rows: 1 }, { ...denied, size: 1 }, { ...denied, truncated: false },
    { ...success, rows: -1 }, { ...success, rows: 1001 }, { ...success, size: -1 }, { ...success, size: 1048577 },
    { ...denied, error_code: "server_restarted" },
    { ...denied, state: "cancelled" }, { ...denied, state: "timed_out" },
  ])("refuse un état ou un résultat incohérent : %#", rejects);

  it.each([
    { ...detail, evidence: null }, { ...detail, evidence: { ...evidence, sql_text: "SELECT 1" } },
    { ...detail, evidence: { ...evidence, evidence_id: "" } },
    { ...detail, evidence: { ...evidence, sql_hash: "" } },
    { ...detail, evidence: { ...evidence, model_keys: [] } },
    { ...detail, evidence: { ...evidence, execution_status: "failed" } },
    { ...detail, connector_run_id: "bad" },
    { ...denied, evidence, connector_run_id: null },
    { ...detail, evidence: undefined },
  ])("refuse une preuve absente, complète ou hors contrat : %#", rejects);

  it("décode une liste bornée, ordonnée et sans doublons", () => {
    const older = { ...success, id: SECOND, created_at: "2026-11-03T23:00:00Z", started_at: "2026-11-03T23:00:01Z", finished_at: "2026-11-03T23:00:02Z", deadline_at: "2026-11-03T23:00:30Z" };
    expect(decodeExecutions({ executions: [success, older] }, "finance").map((row) => row.id)).toEqual([ID, SECOND]);
    expect(() => decodeExecutions({ executions: [success, success] }, "finance")).toThrow(ContractError);
    expect(() => decodeExecutions({ executions: [older, success] }, "finance")).toThrow(ContractError);
    expect(() => decodeExecutions({ executions: Array.from({ length: 51 }, (_, index) => ({ ...success, id: `${String(index).padStart(8, "0")}-1111-1111-1111-111111111111` })) }, "finance")).toThrow(ContractError);
    expect(() => decodeExecutions({ executions: [], token: "secret" }, "finance")).toThrow(ContractError);
  });
});

describe("preuve expurgée détaillée", () => {
  const raw = exemple.body.evidence;
  it("conserve les champs de provenance et distingue les filtres d'exploration", () => {
    const e = { ...raw, normalized_filters: [...raw.normalized_filters, { column: "region", operator: "eq", value: "<redacted>" }] };
    const proof = decodeExecution({ ...exemple.body, evidence: e }, "finance").proof;
    expect(proof?.metrics[0]?.definition_hash).toBe(raw.metrics[0]?.definition_hash);
    expect(proof?.filters.map((item) => item.origin)).toEqual(["policy", "exploration"]);
    expect(proof?.policy.evaluated_at).toBeInstanceOf(Date);
    expect(proof?.sources[0]?.data_age_seconds).toBeNull();
  });
  it.each([
    { ...raw, autre: "secret" }, { ...raw, schema_version: "3" }, { ...raw, sources: [] },
    { ...raw, metrics: [{ ...raw.metrics[0], certification: "INVALIDE" }] },
    { ...raw, metrics: [{ ...raw.metrics[0], sql_text: "secret" }] },
    { ...raw, sources: [{ ...raw.sources[0], data_age_seconds: -1 }] },
    { ...raw, sources: [{ ...raw.sources[0], autre: "secret" }] },
    { ...raw, policy: { ...raw.policy, decision: "DENY" } },
    { ...raw, policy: { ...raw.policy, autre: "secret" } },
    { ...raw, normalized_filters: [null] },
    { ...raw, normalized_filters: [{ column: "region", operator: "eq", value: "secret" }] },
    { ...raw, normalized_filters: [{ column: "region", operator: "eq", origin: "inconnu" }] },
    { ...raw, normalized_filters: [{ column: "region", operator: "eq", autre: "secret" }] },
    { ...raw, execution_duration_seconds: -1 }, { ...raw, sql_dialect: "" },
  ])("refuse une preuve hors contrat %#", (e) => { rejects({ ...exemple.body, evidence: e }); });
  it("lit les champs optionnels permis d'un filtre de politique", () => {
    const e = { ...raw, normalized_filters: [{ column: "base_filter", operator: "sql", origin: "policy", model_key: "orders", definition_hash: "empreinte" }] };
    expect(decodeExecution({ ...exemple.body, evidence: e }, "finance").proof?.filters[0]).toEqual({ column: "base_filter", operator: "sql", origin: "policy", modelKey: "orders", definitionHash: "empreinte", value: null });
  });
});
