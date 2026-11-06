import { describe, expect, it, vi } from "vitest";
import { submitExecution, type ExecutionInput } from "../executions/client";
import type { Fetch } from "../spaces/api";
import { decodeReference } from "./reference";
import { bodyOf, ID, OTHER_ID, reply, route } from "./testing";

const input: ExecutionInput = { connection: "finance", environment: "DEV", model: "sales", metrics: ["revenue"], dimensions: ["region"], filters: [{ column: "region", operator: "in", value: ["Nord", "Sud"] }] };
const queued = [['"<state>"', '"queued"'], ['"<started_at>"', "null"]] as const;
const POST = { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" } };
const serving = (name: string, replacements: readonly (readonly [string, string])[] = []) => vi.fn<Fetch>().mockImplementation(() => Promise.resolve(reply(route(name, replacements))));
const URL = "/api/spaces/finance/executions";

describe("référence d'analyse d'une soumission", () => {
  it("décode la référence : un UUID minuscule et un numéro de révision, rien d'autre", () => {
    expect(decodeReference({ id: ID, revision: 1 })).toEqual({ id: ID, revision: 1 });
    expect(decodeReference({ id: ID, revision: 999_999_999 })).toEqual({ id: ID, revision: 999_999_999 });
    for (const bad of [null, [], {}, { id: ID }, { revision: 1 }, { id: ID, revision: 0 }, { id: ID, revision: 1.5 }, { id: ID, revision: 1_000_000_000 }, { id: ID, revision: "1" }, { id: ID.toUpperCase(), revision: 1 }, { id: "x", revision: 1 }, { id: ID, revision: 1, name: "x" }, { id: ID, revision: 1, sql: "SELECT 1" }]) {
      expect(() => decodeReference(bad), JSON.stringify(bad)).toThrow();
    }
  });

  it("sans référence, la requête émise est identique octet pour octet à celle du plan 17", async () => {
    const fetcher = serving("executer-avec-reference", queued);
    expect(await submitExecution("finance", input, fetcher)).toMatchObject({ status: "ok", value: { state: "queued" } });
    const expected = '{"connection":"finance","environment":"DEV","model":"sales","metrics":["revenue"],"dimensions":["region"],"filters":[{"column":"region","operator":"in","value":["Nord","Sud"]}]}';
    expect(fetcher).toHaveBeenCalledWith(URL, { ...POST, body: expected });
    expect(bodyOf(fetcher)).toBe(JSON.stringify(input));
    // Une référence explicitement absente ne laisse aucune trace dans le corps.
    const absent = serving("executer-avec-reference", queued);
    await submitExecution("finance", { ...input, analysis: undefined } as unknown as ExecutionInput, absent);
    expect(bodyOf(absent)).toBe(expected);
  });

  it("avec une référence, elle part en dernier champ, vérifiée avant l'envoi", async () => {
    const fetcher = serving("executer-avec-reference", queued);
    expect(await submitExecution("finance", { ...input, analysis: { id: ID, revision: 2 } }, fetcher)).toMatchObject({ status: "ok", value: { state: "queued", connection: "finance", space: "finance" } });
    const body = bodyOf(fetcher);
    expect(body).toBe(`${JSON.stringify(input).slice(0, -1)},"analysis":{"id":"${ID}","revision":2}}`);
    expect(Object.keys(JSON.parse(body) as object).at(-1)).toBe("analysis");
  });

  it("refuse localement une référence mal formée, sans appeler le serveur", async () => {
    const fetcher = serving("executer-avec-reference", queued);
    for (const analysis of [{ id: "x", revision: 1 }, { id: ID, revision: 0 }, { id: ID, revision: 1, sql: "SELECT 1" }, null, {}]) {
      const outcome = await submitExecution("finance", { ...input, analysis } as unknown as ExecutionInput, fetcher);
      expect(outcome).toEqual({ status: "error", message: "La référence d'analyse est invalide." });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rend les refus de la référence comme des refus fermés", async () => {
    const reference = { ...input, analysis: { id: OTHER_ID, revision: 1 } };
    expect(await submitExecution("finance", reference, serving("refus-reference-introuvable"))).toEqual({ status: "refused", code: "analysis_not_found", field: null });
    expect(await submitExecution("finance", reference, serving("refus-reference-modele"))).toEqual({ status: "refused", code: "analysis_model_mismatch", field: null });
    expect(await submitExecution("finance", reference, serving("refus-reference-depot-indisponible"))).toEqual({ status: "refused", code: "content_unavailable", field: null });
    expect(await submitExecution("finance", reference, serving("refus-reference-invalide"))).toEqual({ status: "refused", code: "invalid_request", field: "analysis.revision" });
  });

  it("décode la réponse d'une exécution avec référence comme une exécution ordinaire", async () => {
    const running = [['"<state>"', '"running"'], ['"<started_at>"', '"2026-01-15T12:00:01+00:00"']] as const;
    expect(await submitExecution("finance", { ...input, analysis: { id: ID, revision: 1 } }, serving("executer-avec-reference", running))).toMatchObject({ status: "ok", value: { state: "running", id: ID } });
    // Aucun champ de plus : l'exécution ne porte pas la référence.
    const extra = vi.fn<Fetch>().mockResolvedValue(Response.json({ ...(route("executer-avec-reference", queued).body as object), analysis: { id: ID, revision: 1 } }, { status: 202 }));
    expect(await submitExecution("finance", { ...input, analysis: { id: ID, revision: 1 } }, extra)).toMatchObject({ status: "error" });
  });
});
