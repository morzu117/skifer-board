import { expect, it, vi } from "vitest";
import fields from "../../../../contracts/executions/champs.json";
import interdit from "../../../../contracts/executions/champs-interdits.json";
import local from "../../../../contracts/executions/champs-mode-local.json";
import nonMembre from "../../../../contracts/executions/champs-non-membre.json";
import invalide from "../../../../contracts/executions/contextuel-invalide.json";
import nonReussi from "../../../../contracts/executions/contextuel-non-reussi.json";
import sourceIndisponible from "../../../../contracts/executions/contextuel-source-indisponible.json";
import modele from "../../../../contracts/executions/validation-modele.json";
import metriques from "../../../../contracts/executions/validation-metriques.json";
import dimensions from "../../../../contracts/executions/validation-dimensions.json";
import filtres from "../../../../contracts/executions/validation-filtres.json";
import calculated from "../../../../contracts/executions/contextuel-selection.json";
import { onSessionLost } from "../identity/session";
import { onSpaceLost } from "../spaces/lost";
import type { Fetch } from "../spaces/api";
import { computeContextual, fetchFields, submitExecution } from "./client";
import type { ContextualBody } from "./model";

const signal = new AbortController().signal;
const body: ContextualBody = { operation: "aggregate", metric: "revenue", group_by: [], selection: null, scope: null, denominator: null };
const serving = (value: unknown, status = 200) => vi.fn<Fetch>().mockResolvedValue(Response.json(value, { status }));

it("appelle les routes et décode les contrats réels", async () => {
  const fetcher = serving(fields.body);
  expect(await fetchFields("a/b", signal, fetcher)).toMatchObject({ status: "ok", value: fields.body });
  expect(fetcher).toHaveBeenCalledWith("/api/spaces/a%2Fb/explorer/fields", { method: "GET", headers: { Accept: "application/json" }, signal });
  const compute = serving(calculated.body);
  expect(await computeContextual("finance", "a/b", body, compute)).toMatchObject({ status: "ok", value: calculated.body });
  expect(compute).toHaveBeenCalledWith("/api/spaces/finance/executions/a%2Fb/contextual", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  expect(await fetchFields("finance", signal, serving({ models: [] }))).toMatchObject({ status: "error" });
});
it.each([[403, "forbidden"], [404, "space_not_found"], [409, "local_mode"], [503, "engine_unavailable"], [400, "invalid_request"], [409, "result_unavailable"]] as const)("propage le refus fermé HTTP %i %s", async (status, code) => {
  const response = { error: { code } };
  expect(await fetchFields("finance", signal, serving(response, status))).toMatchObject({ status: "refused", code });
  expect(await computeContextual("finance", "id", body, serving(response, status))).toMatchObject({ status: "refused", code });
});
it("signale la perte de session et l'accès retiré", async () => {
  const session = vi.fn(); const space = vi.fn();
  const a = onSessionLost(session); const b = onSpaceLost(space);
  try {
    await fetchFields("finance", signal, serving({}, 401));
    await computeContextual("finance", "id", body, serving({ error: { code: "space_not_found" } }, 404));
    expect(session).toHaveBeenCalledOnce(); expect(space).toHaveBeenCalledOnce();
  } finally { a(); b(); }
});

it("rend une erreur locale pour un corps invalide sans appeler le serveur", async () => {
  const fetcher = serving(calculated.body);
  const resultat = computeContextual("finance", "id", { ...body, metric: "!" }, fetcher);
  expect(resultat).toBeInstanceOf(Promise);
  await expect(resultat).resolves.toEqual({ status: "error", message: "La demande de calcul est invalide." });
  expect(fetcher).not.toHaveBeenCalled();
});

it("propage les refus versionnés du serveur", async () => {
  for (const exemple of [interdit, local, nonMembre]) {
    expect(await fetchFields("finance", signal, serving(exemple.body, exemple.status))).toMatchObject({ status: "refused", code: exemple.body.error.code });
  }
  for (const exemple of [invalide, nonReussi, sourceIndisponible]) {
    expect(await computeContextual("finance", "id", body, serving(exemple.body, exemple.status))).toMatchObject({ status: "refused", code: exemple.body.error.code });
  }
  for (const exemple of [modele, metriques, dimensions, filtres]) {
    expect(await submitExecution("finance", { connection: "source", environment: "DEV", model: "orders", metrics: ["revenue"], dimensions: [], filters: [] }, serving(exemple.body, exemple.status))).toMatchObject({ status: "refused", code: "invalid_request", field: exemple.body.error.field });
  }
});
