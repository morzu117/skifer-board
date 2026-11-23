import { renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import execution from "../../../../../contracts/executions/contextuel-detail.json";
import componentFixture from "../../../../../contracts/components/routes/lire.json";
import { fetchComponent, fetchComponentRevision } from "../../components-lib/client";
import { decodeComponent } from "../../components-lib/document";
import { decodeDashboardDraft } from "../document";
import { ID } from "../../analyses/testing";
import { editorServer, MODELS, N, ROOT, sampleDraft } from "./testing";
import { referenceKey, referencesOf, useReferenceStates } from "./useReferenceStates";
import { useTiles } from "./useTiles";

vi.mock("../../components-lib/client", () => ({ fetchComponent: vi.fn(), fetchComponentRevision: vi.fn() }));
it("l'ajout d'une référence ne retire ni n'annule l'exécution du composant inchangé", async () => {
  const id = N.kpi, other = N.text, executionId = "00000000-0000-4000-8000-000000000101";
  const raw = JSON.parse(JSON.stringify(componentFixture.body.component).replaceAll("<uuid>", id)) as Record<string, unknown>;
  raw.analysis = { analysis_id: N.bars, revision: 1 }; const document = decodeComponent(raw);
  const read = { status: "ok", value: { revision: 1, approvedRevision: 1, state: "approved", component: document } };
  vi.mocked(fetchComponent).mockImplementation((_space, key) => key === id ? Promise.resolve(read as never) : new Promise(() => undefined));
  vi.mocked(fetchComponentRevision).mockImplementation((_space, key) => key === id ? Promise.resolve(read as never) : new Promise(() => undefined));
  let aborted = false;
  const base: Record<string, unknown> = { ...execution.body };
  delete base.evidence; delete base.connector_run_id; delete base.result_contract;
  Object.assign(base, { id: executionId, state: "running", finished_at: null, rows: null, size: null, truncated: null, can_cancel: true });
  const server = editorServer({ overrides: {
    [`POST ${ROOT}/executions`]: () => Response.json(base, { status: 202 }),
    [`GET ${ROOT}/executions/${executionId}`]: (init) => new Promise<Response>((_, reject) => { init?.signal?.addEventListener("abort", () => { aborted = true; reject(new DOMException("annulé", "AbortError")); }); }),
  } });
  const make = (includeOther: boolean) => decodeDashboardDraft({ ...sampleDraft(), filters: [], layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: [{ id: N.visual, type: "component", component: { component_id: id, revision: 1 } }, ...(includeOther ? [{ id: N.rule, type: "component", component: { component_id: other, revision: 1 } }] : [])] }] }] }] } });
  const first = make(false), second = make(true);
  const { result, rerender } = renderHook(({ draft }) => {
    const states = useReferenceStates("finance", "cora", ID, referencesOf(draft), server.fetcher);
    const state = states[referenceKey({ kind: "component", id, revision: 1 })];
    const resolvedComponents = state && state.state !== "unresolved" && state.component ? { [N.visual]: { document: state.component, revision: 1 } } : {};
    return useTiles({ space: "finance", dashboard: ID, identity: "cora", environment: "DEV", document: draft, tiles: [], catalog: { status: "ok", value: { models: MODELS } }, fetcher: server.fetcher, poll: 1000, resolvedComponents });
  }, { initialProps: { draft: first } });
  await waitFor(() => { expect(result.current.states.get(N.visual)?.status).toBe("running"); });
  await waitFor(() => { expect(server.fetcher.mock.calls.some(([url]) => url === `${ROOT}/executions/${executionId}`)).toBe(true); });
  rerender({ draft: second });
  expect(result.current.states.get(N.visual)?.status).toBe("running");
  expect(aborted).toBe(false);
  expect(server.fetcher.mock.calls.filter(([url, init]) => url === `${ROOT}/executions` && init?.method === "POST")).toHaveLength(1);
  expect(server.fetcher.mock.calls.some(([url]) => url.endsWith("/cancel"))).toBe(false);
});
