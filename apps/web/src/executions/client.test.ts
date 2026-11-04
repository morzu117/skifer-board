import { tableFromArrays, tableToIPC } from "apache-arrow";
import exemple from "../../../../contracts/executions/contextuel-detail.json";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onSessionLost } from "../identity/session";
import type { AdminOutcome } from "../spaces/admin";
import { onSpaceLost } from "../spaces/lost";
import type { Fetch } from "../spaces/api";
import { cancelExecution, fetchExecution, fetchExecutions, fetchResult, submitExecution, type ExecutionInput } from "./client";
import { decodeExecution } from "./model";

const ID = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const source = {
  id: ID, space_id: "finance", environment: "DEV", connection: "source", state: "succeeded",
  created_at: "2026-11-04T00:00:00Z", started_at: "2026-11-04T00:00:01Z", finished_at: "2026-11-04T00:00:02Z",
  deadline_at: "2026-11-04T00:00:30Z", can_cancel: false, cancel_requested: false,
  error_code: null, rows: 1, size: 128, truncated: false,
};
const queued = { ...source, state: "queued", started_at: null, finished_at: null, rows: null, size: null, truncated: null };
const input: ExecutionInput = { connection: "source", environment: "DEV", model: "orders", metrics: ["revenue"], dimensions: [], filters: [] };
const signal = () => new AbortController().signal;
const serving = (body: unknown, status = 200) => vi.fn<Fetch>().mockResolvedValue(Response.json(body, { status }));
function errorIncludes(outcome: AdminOutcome<unknown>, fragment: string): void {
  expect(outcome.status).toBe("error");
  if (outcome.status === "error") expect(outcome.message).toContain(fragment);
}

afterEach(() => { vi.restoreAllMocks(); });

describe("client des exécutions suivies", () => {
  it("liste les miennes ou les métadonnées de l'espace avec le signal transmis", async () => {
    const fetcher = serving({ executions: [source] });
    const abort = signal();
    expect(await fetchExecutions("finance", "mine", abort, fetcher)).toMatchObject({ status: "ok", value: [{ id: ID }] });
    expect(fetcher).toHaveBeenCalledWith("/api/spaces/finance/executions?scope=mine", { method: "GET", headers: { Accept: "application/json" }, signal: abort });
    await fetchExecutions("a/b", "space", abort, serving({ executions: [] }));
    expect(await fetchExecutions("finance", "space", abort, serving({ executions: [] }))).toEqual({ status: "ok", value: [] });
  });

  it("lit un détail en refusant un autre identifiant", async () => {
    expect(await fetchExecution("finance", ID, signal(), serving(source))).toMatchObject({ status: "ok", value: { id: ID } });
    expect(await fetchExecution("finance", exemple.body.id, signal(), serving(exemple.body))).toMatchObject({ status: "ok", value: { resultContract: exemple.body.result_contract } });
    errorIncludes(await fetchExecution("finance", exemple.body.id, signal(), serving({ ...exemple.body, result_contract: { ...exemple.body.result_contract, extra: true } })), "hors contrat");
    errorIncludes(await fetchExecution("finance", ID, signal(), serving({ ...source, id: OTHER })), "identifiant demandé");
  });

  it("soumet uniquement les champs déclaratifs et demande une annulation sans corps", async () => {
    const create = serving(queued, 202);
    expect(await submitExecution("finance", input, create)).toMatchObject({ status: "ok", value: { state: "queued" } });
    expect(create).toHaveBeenCalledWith("/api/spaces/finance/executions", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const cancel = serving({ ...queued, state: "cancelled", finished_at: "2026-11-04T00:00:02Z", error_code: "cancelled", cancel_requested: true });
    expect(await cancelExecution("finance", ID, cancel)).toMatchObject({ status: "ok", value: { state: "cancelled" } });
    expect(cancel).toHaveBeenCalledWith(`/api/spaces/finance/executions/${ID}/cancel`, { method: "POST", headers: { Accept: "application/json" } });
    errorIncludes(await cancelExecution("finance", ID, serving({ ...source, id: OTHER })), "identifiant demandé");
  });

  it("rend les refus fermés et signale la perte de session ou d'espace", async () => {
    const session = vi.fn();
    const space = vi.fn();
    const unsubscribeSession = onSessionLost(session);
    const unsubscribeSpace = onSpaceLost(space);
    try {
      expect(await fetchExecutions("finance", "mine", signal(), serving({ error: { code: "engine_unavailable" } }, 503))).toMatchObject({ status: "refused", code: "engine_unavailable" });
      expect(await fetchExecutions("finance", "mine", signal(), serving({ error: { code: "space_not_found" } }, 404))).toMatchObject({ status: "refused", code: "space_not_found" });
      expect(space).toHaveBeenCalledTimes(1);
      errorIncludes(await fetchExecution("finance", ID, signal(), serving({ error: { code: "unauthenticated" } }, 401)), "Session expirée");
      expect(session).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribeSession();
      unsubscribeSpace();
    }
  });
});

const bytes = tableToIPC(tableFromArrays({ revenue: [12] }), "stream");
const resultSource = { ...source, size: bytes.byteLength };
const result = decodeExecution(resultSource, "finance");
const arrowResponse = (data: Uint8Array = bytes, headers: Record<string, string> = {}) => new Response(data.slice().buffer, {
  status: 200, headers: { "Content-Type": "application/vnd.apache.arrow.stream", ...headers },
});

describe("aperçu Arrow borné", () => {
  it("lit un flux typé quand les octets, lignes et colonnes correspondent à la fiche", async () => {
    const fetcher = vi.fn<Fetch>().mockResolvedValue(arrowResponse());
    const abort = signal();
    const found = await fetchResult("finance", result, abort, fetcher);
    expect(found.status).toBe("ok");
    if (found.status === "ok") expect(found.value.getChild("revenue")?.get(0)).toBe(12);
    expect(fetcher).toHaveBeenCalledWith(`/api/spaces/finance/executions/${ID}/result`, { signal: abort, headers: { Accept: "application/vnd.apache.arrow.stream" } });
    expect(await fetchResult("finance", decodeExecution(queued, "finance"), signal(), fetcher)).toMatchObject({ status: "error", message: "Le résultat n'est pas disponible." });
  });

  it.each([
    new Response(bytes.slice().buffer, { headers: { "Content-Type": "application/json" } }),
    arrowResponse(bytes, { "Content-Length": "1048577" }),
    arrowResponse(bytes, { "Content-Length": "bad" }),
    arrowResponse(bytes, { "Content-Length": "1" }),
    arrowResponse(bytes.slice(0, 10)),
    arrowResponse(new Uint8Array(bytes.byteLength)),
  ])("refuse un type, une taille ou un flux incohérent : %#", async (response) => {
    errorIncludes(await fetchResult("finance", result, signal(), vi.fn<Fetch>().mockResolvedValue(response)), "hors contrat");
  });

  it("refuse un nombre de lignes ou une liste de colonnes qui ne correspond pas", async () => {
    const empty = tableToIPC(tableFromArrays({ revenue: [] }), "stream");
    const zero = tableToIPC(tableFromArrays({}), "stream");
    for (const data of [empty, zero]) {
      const expected = decodeExecution({ ...source, size: data.byteLength }, "finance");
      errorIncludes(await fetchResult("finance", expected, signal(), vi.fn<Fetch>().mockResolvedValue(arrowResponse(data))), "hors contrat");
    }
  });

  it("rend les refus, la session perdue, une panne et une réponse illisible", async () => {
    const session = vi.fn();
    const space = vi.fn();
    const unsubscribeSession = onSessionLost(session);
    const unsubscribeSpace = onSpaceLost(space);
    try {
      expect(await fetchResult("finance", result, signal(), serving({ error: { code: "result_unavailable" } }, 409))).toMatchObject({ status: "refused", code: "result_unavailable" });
      expect(await fetchResult("finance", result, signal(), serving({ error: { code: "space_not_found" } }, 404))).toMatchObject({ status: "refused", code: "space_not_found" });
      expect(space).toHaveBeenCalledTimes(1);
      errorIncludes(await fetchResult("finance", result, signal(), serving({ error: { code: "unauthenticated" } }, 401)), "Session expirée");
      expect(session).toHaveBeenCalledTimes(1);
      errorIncludes(await fetchResult("finance", result, signal(), serving({}, 502)), "HTTP 502");
      expect(await fetchResult("finance", result, signal(), vi.fn<Fetch>().mockRejectedValue(new Error("offline")))).toMatchObject({ status: "error", message: "Le serveur Board ne répond pas." });
      errorIncludes(await fetchResult("finance", result, signal(), vi.fn<Fetch>().mockResolvedValue(new Response("{", { status: 502 }))), "HTTP 502");
    } finally {
      unsubscribeSession();
      unsubscribeSpace();
    }
  });

  it("propage une interruption de lecture réseau ou binaire", async () => {
    const aborted = new AbortController();
    aborted.abort();
    await expect(fetchResult("finance", result, aborted.signal, vi.fn<Fetch>().mockRejectedValue(new Error("aborted")))).rejects.toThrow("aborted");
    const response = arrowResponse();
    vi.spyOn(response, "arrayBuffer").mockRejectedValue(new Error("aborted"));
    await expect(fetchResult("finance", result, aborted.signal, vi.fn<Fetch>().mockResolvedValue(response))).rejects.toThrow("aborted");
  });

  it("signale une lecture binaire illisible sans abandon", async () => {
    const response = arrowResponse();
    vi.spyOn(response, "arrayBuffer").mockRejectedValue(new Error("broken stream"));
    errorIncludes(await fetchResult("finance", result, signal(), vi.fn<Fetch>().mockResolvedValue(response)), "flux Arrow illisible");
  });
});
