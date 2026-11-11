import { act, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import { describe, expect, it, vi } from "vitest";

import executionExample from "../../../../../contracts/executions/contextuel-detail.json";
import { decodeExecution } from "../../executions/model";
import type { Fetch } from "../../spaces/api";
import { decodeDashboardDraft } from "../document";
import { ID } from "../../analyses/testing";
import { analysisBody, ANALYSES, echo, editorServer, MODELS, N, openEditor, ROOT, sampleDraft, type AnalysisSpec } from "./testing";
import { executionClients, OutcomeError, useTiles, type TileSources } from "./useTiles";

const READ = `GET ${ROOT}/analyses/${N.bars}/revisions/1`;
const posts = (fetcher: ReturnType<typeof openEditor>["server"]["fetcher"]): string[] => fetcher.mock.calls.filter(([url, init]) => url === `${ROOT}/executions` && init?.method === "POST").map(([, init]) => init?.body as string);
const ready = async (options: Parameters<typeof openEditor>[0] = {}) => {
  const view = openEditor(options);
  await screen.findByRole("heading", { name: "Pilotage", level: 1 });
  return view;
};
const tile = (title: string | RegExp) => screen.getAllByRole("group", { name: title }).find((one) => one.classList.contains("sb-tile")) as HTMLElement;
const select = (name: string | RegExp) => userEvent.click(screen.getByRole("button", { name }));
const BASE: Record<string, unknown> = { ...executionExample.body };
delete BASE.evidence;
delete BASE.connector_run_id;
delete BASE.result_contract;
const succeeded = (size: number) => ({ ...executionExample.body, rows: 2, size });
const running = () => ({ ...BASE, state: "running", finished_at: null, rows: null, size: null, truncated: null, can_cancel: true });
const cancelled = () => ({ ...BASE, state: "cancelled", error_code: "cancelled", rows: null, size: null, truncated: null });

describe("clients d'exécution", () => {
  const json = (body: unknown, status = 200) => Response.json(body, { status });

  it("soumettent, lisent, rendent le résultat et annulent sur les routes de l'espace", async () => {
    const bytes = tableToIPC(tableFromArrays({ n: [1, 2] }), "stream");
    const respond = (url: string): Response => {
      if (url.endsWith("/result")) return new Response(bytes.slice().buffer, { headers: { "content-type": "application/vnd.apache.arrow.stream" } });
      if (url.endsWith("/cancel")) return json(cancelled());
      return json(succeeded(bytes.byteLength));
    };
    const fetcher = vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(respond(url)));
    const clients = executionClients("finance", fetcher, 1);
    const signal = new AbortController().signal;
    const submitted = await clients.submit({ connection: "finance", environment: "DEV", model: "sales", metrics: ["revenue"], dimensions: [], filters: [] });
    expect(submitted.state).toBe("succeeded");
    const read = await clients.read(submitted, signal);
    expect(read.id).toBe(submitted.id);
    expect((await clients.result(read, signal)).numRows).toBe(2);
    await expect(clients.cancel(read)).resolves.toBeUndefined();
    expect(fetcher.mock.calls.map(([url]) => url.replace(/.*executions/, "executions").replace(submitted.id, "ID"))).toEqual(["executions", "executions/ID", "executions/ID/result", "executions/ID/cancel"]);
  });

  it("rendent un refus ou une panne sous la forme d'une erreur qui garde son issue", async () => {
    const refused = executionClients("finance", vi.fn<Fetch>().mockResolvedValue(json({ error: { code: "forbidden", message: "Non." } }, 403)), 1);
    const failure = await refused.cancel(decodeExecution(running(), "finance")).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OutcomeError);
    expect((failure as OutcomeError).outcome.status).toBe("refused");
    const broken = executionClients("finance", vi.fn<Fetch>().mockRejectedValue(new TypeError("réseau")), 1);
    const down = await broken.submit({ connection: "finance", environment: "DEV", model: "sales", metrics: [], dimensions: [], filters: [] }).catch((error: unknown) => error);
    expect(down).toBeInstanceOf(OutcomeError);
    expect((down as OutcomeError).message).toBe("Le serveur Board ne répond pas.");
    expect((down as OutcomeError).outcome.status).toBe("error");
  });

  it("l'attente se termine d'elle-même, ou tout de suite quand on l'abandonne", async () => {
    const clients = executionClients("finance", vi.fn<Fetch>(), 5);
    await expect(clients.wait(new AbortController().signal)).resolves.toBeUndefined();
    const controller = new AbortController();
    const long = executionClients("finance", vi.fn<Fetch>(), 60_000).wait(controller.signal);
    controller.abort();
    await expect(long).resolves.toBeUndefined();
  });
});

describe("tuiles de l'éditeur", () => {
  it("une tuile indisponible selon le serveur n'est ni lue ni exécutée, et dit sa raison", async () => {
    const { server } = await ready({ tiles: [{ id: N.visual, state: "unavailable", reason: "analysis_unavailable" }, { id: N.kpi, state: "ready" }], state: "unresolved_reference" });
    await waitFor(() => { expect(tile("Total")).toHaveTextContent("Preuve"); });
    expect(within(tile("Visuel épinglé")).getByText(/L'analyse épinglée n'est pas disponible pour vous/)).toBeInTheDocument();
    expect(server.fetcher.mock.calls.some(([url]) => url === `${ROOT}/analyses/${N.bars}/revisions/1`)).toBe(false);
    expect(server.submitted().map((body) => body.metrics)).toEqual([["revenue"]]);
  });

  it("une analyse épinglée illisible laisse la tuile illisible, sans exécution ni nouvel essai", async () => {
    const { server } = await ready({ overrides: { [READ]: Response.json({ error: { code: "forbidden", message: "Non." } }, { status: 403 }) } });
    await waitFor(() => { expect(within(tile("Visuel épinglé")).getByRole("alert")).toHaveTextContent(/^Analyse épinglée illisible/); });
    await waitFor(() => { expect(server.submitted()).toHaveLength(1); });
    expect(server.fetcher.mock.calls.filter(([url]) => url === `${ROOT}/analyses/${N.bars}/revisions/1`)).toHaveLength(1);
    expect(server.submitted().map((body) => body.dimensions)).toEqual([[]]);
  });

  it("tant que l'analyse n'est pas lue, la tuile est en lecture et rien n'est exécuté", async () => {
    const { server } = await ready({ overrides: { [READ]: () => new Promise<Response>(() => undefined) } });
    expect(within(tile("Visuel épinglé")).getByRole("status")).toBeInTheDocument();
    expect(server.submitted()).toHaveLength(0);
  });

  it("une lecture qui aboutit après la sortie de l'éditeur est ignorée", async () => {
    let finish: () => void = () => undefined;
    const late = new Promise<Response>((resolve) => { finish = () => { resolve(Response.json({}, { status: 500 })); }; });
    const { unmount, server } = await ready({ overrides: { [READ]: () => late } });
    unmount();
    finish();
    await late;
    expect(server.submitted()).toHaveLength(0);
  });

  it("quitter l'éditeur abandonne les lectures en cours sans erreur", async () => {
    let aborted = false;
    const { unmount, server } = await ready({ overrides: { [READ]: (init) => new Promise<Response>((_, reject) => { init?.signal?.addEventListener("abort", () => { aborted = true; reject(new DOMException("abandon", "AbortError")); }); }) } });
    unmount();
    await waitFor(() => { expect(aborted).toBe(true); });
    expect(server.submitted()).toHaveLength(0);
  });
});

describe("la présentation ne change jamais la requête soumise", () => {
  const pinned = (presentation: object) => decodeDashboardDraft({
    ...sampleDraft(),
    layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: [
      { id: N.visual, type: "analysis", reference: { analysis_id: N.bars, revision: 1 }, presentation },
      { id: N.kpi, type: "kpi", reference: { analysis_id: N.total, revision: 1 }, presentation: {} },
    ] }] }] }] },
  });
  const full = { title: "Autre titre", chart: "line", legend: "hidden", number_format: "percent", tooltip: "value_and_definition", threshold: { value: 5, label: "Cible" } };

  it("octet pour octet : les mêmes corps, quelle que soit la présentation du document", async () => {
    const plain = await ready({ draft: pinned({}) });
    await waitFor(() => { expect(posts(plain.server.fetcher)).toHaveLength(2); });
    const before = posts(plain.server.fetcher);
    plain.unmount();
    const styled = await ready({ draft: pinned(full) });
    await waitFor(() => { expect(posts(styled.server.fetcher)).toHaveLength(2); });
    expect([...posts(styled.server.fetcher)].sort()).toEqual([...before].sort());
    expect(ANALYSES[N.bars]).toBeDefined();
  });

  it("modifier la présentation dans l'éditeur ne relance aucune exécution", async () => {
    const { server } = await ready();
    await waitFor(() => { expect(posts(server.fetcher)).toHaveLength(2); });
    await waitFor(() => { expect(screen.getAllByText("Preuve")).toHaveLength(2); });
    const before = posts(server.fetcher);
    await select(/^Visuel · Chiffre d'affaires par région$/);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /^Type de graphique/ }), "line");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /^Format des nombres/ }), "percent");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /^Légende/ }), "hidden");
    const title = screen.getByRole("textbox", { name: /^Titre/ });
    await userEvent.clear(title);
    await userEvent.type(title, "Autre titre{Enter}");
    await screen.findByRole("heading", { name: "Autre titre" });
    expect(posts(server.fetcher)).toEqual(before);
  });
});

const quiet = () => act(async () => { await new Promise<void>((resolve) => { setTimeout(resolve, 30); }); });
const DENIED = "DENY · accès refusé";

describe("une requête inchangée n'est jamais resoumise", () => {
  it("déplacer une colonne, annuler puis rétablir ne resoumet ni le refus du moteur ni le résultat", async () => {
    const { server } = await ready({ outcomes: { [N.bars]: "deny" } });
    await waitFor(() => { expect(within(tile("Chiffre d'affaires par région")).getByRole("alert")).toHaveTextContent(DENIED); });
    await waitFor(() => { expect(posts(server.fetcher)).toHaveLength(2); });
    const before = posts(server.fetcher);
    screen.getByRole("button", { name: /^Colonne 2/ }).focus();
    fireEvent.keyDown(screen.getByRole("button", { name: /^Colonne 2/ }), { key: "ArrowLeft", altKey: true });
    await waitFor(() => { expect(document.querySelector(".sb-editor__announce")?.textContent).toMatch(/^Déplacé : Colonne 1 · 4\/12, position 1 sur 3/); });
    await quiet();
    expect(posts(server.fetcher)).toEqual(before);
    await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
    await userEvent.click(screen.getByRole("button", { name: "Rétablir" }));
    await quiet();
    expect(posts(server.fetcher)).toEqual(before);
    expect(within(tile("Chiffre d'affaires par région")).getByRole("alert")).toHaveTextContent(DENIED);
  });

  it("retirer une autre tuile ne relance pas non plus un refus REQUIRE_HUMAN, et seule la requête modifiée repart", async () => {
    const { server } = await ready({ outcomes: { [N.bars]: "require_human" } });
    await waitFor(() => { expect(posts(server.fetcher)).toHaveLength(2); });
    await waitFor(() => { expect(screen.getAllByText("Preuve")).toHaveLength(1); });
    const before = posts(server.fetcher);
    const kpi = screen.getByRole("button", { name: /^KPI/ });
    kpi.focus();
    fireEvent.keyDown(kpi, { key: "Delete" });
    await waitFor(() => { expect(screen.queryByRole("button", { name: /^KPI/ })).not.toBeInTheDocument(); });
    await quiet();
    expect(posts(server.fetcher)).toEqual(before);
    await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
    await screen.findByRole("button", { name: /^KPI/ });
    await quiet();
    expect(posts(server.fetcher)).toEqual(before);
  });
});

describe("un composant que la dernière réponse du serveur ne connaît pas", () => {
  it("annuler une suppression déjà enregistrée rend le composant sans erreur, après la lecture de son analyse", async () => {
    const { server } = await ready({ overrides: { [`POST ${ROOT}/dashboards/${ID}/revisions`]: (init) => echo(init, 2, 201, [{ id: N.kpi, state: "ready" }]) } });
    await waitFor(() => { expect(screen.getAllByText("Preuve")).toHaveLength(2); });
    const visual = screen.getByRole("button", { name: /^Visuel/ });
    visual.focus();
    fireEvent.keyDown(visual, { key: "Delete" });
    await waitFor(() => { expect(screen.queryByRole("button", { name: /^Visuel/ })).not.toBeInTheDocument(); });
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Révision 2 enregistrée.");
    await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
    await screen.findByRole("button", { name: /^Visuel/ });
    expect(screen.getByRole("heading", { name: "Pilotage", level: 1 })).toBeInTheDocument();
    await waitFor(() => { expect(screen.getByRole("region", { name: "Chiffre d'affaires par région" })).toBeInTheDocument(); });
    expect(server.fetcher.mock.calls.filter(([, init]) => init?.method === "POST" && typeof init.body === "string" && init.body.includes("expected_revision"))).toHaveLength(1);
  });
});

describe("le contexte est la durée de vie de ce qui a été lu et exécuté", () => {
  const sources = (server: ReturnType<typeof editorServer>, extra: Partial<TileSources> = {}): TileSources => ({
    space: "finance", dashboard: ID, identity: "[\"https://id.example.invalid\",\"cora\"]", environment: "DEV", document: sampleDraft(),
    tiles: [{ id: N.visual, state: "ready" }, { id: N.kpi, state: "ready" }], catalog: { status: "ok", value: { models: MODELS } }, fetcher: server.fetcher, poll: 1, ...extra,
  });
  const analysisReads = (server: ReturnType<typeof editorServer>) => server.fetcher.mock.calls.filter(([url]) => url.includes("/analyses/")).length;

  it("une autre identité abandonne les lectures et les exécutions, efface les données, puis relit et resoumet tout", async () => {
    const server = editorServer({ outcomes: { [N.bars]: "deny" } });
    const { result, rerender } = renderHook((props: TileSources) => useTiles(props), { initialProps: sources(server) });
    await waitFor(() => { expect(result.current.states.get(N.visual)).toMatchObject({ status: "denied" }); });
    await waitFor(() => { expect(result.current.states.get(N.kpi)).toMatchObject({ status: "success" }); });
    expect(Object.keys(result.current.analyses)).toHaveLength(2);
    expect(analysisReads(server)).toBe(2);
    rerender(sources(server, { identity: "[\"https://id.example.invalid\",\"bob\"]" }));
    // Aussitôt : rien de ce qui a été lu sous la personne précédente n'est plus affiché.
    expect(result.current.analyses).toEqual({});
    expect(result.current.settled).toBe(false);
    expect([...result.current.states.values()].map((state) => state.status)).toEqual(["reading", "reading"]);
    await waitFor(() => { expect(result.current.states.get(N.kpi)).toMatchObject({ status: "success" }); });
    await waitFor(() => { expect(result.current.states.get(N.visual)).toMatchObject({ status: "denied" }); });
    expect(analysisReads(server)).toBe(4);
    expect(server.submitted()).toHaveLength(4);
  });

  it("un autre environnement, espace ou dashboard fait de même ; le même contexte ne relit rien", async () => {
    const server = editorServer();
    const { result, rerender } = renderHook((props: TileSources) => useTiles(props), { initialProps: sources(server) });
    await waitFor(() => { expect(server.submitted()).toHaveLength(2); });
    await waitFor(() => { expect(result.current.states.get(N.kpi)).toMatchObject({ status: "success" }); });
    rerender(sources(server));
    await quiet();
    expect(analysisReads(server)).toBe(2);
    expect(server.submitted()).toHaveLength(2);
    rerender(sources(server, { environment: "TEST" }));
    expect(result.current.analyses).toEqual({});
    await waitFor(() => { expect(server.submitted()).toHaveLength(4); });
    rerender(sources(server, { environment: "TEST", dashboard: "00000000-0000-4000-8000-0000000000bb" }));
    expect(result.current.analyses).toEqual({});
    await waitFor(() => { expect(server.submitted()).toHaveLength(6); });
    rerender(sources(server, { environment: "TEST", dashboard: "00000000-0000-4000-8000-0000000000bb", space: "autre" }));
    expect(result.current.analyses).toEqual({});
    await quiet();
  });

  it("une lecture qui aboutit après le changement de contexte n'est pas affichée", async () => {
    let finish: () => void = () => undefined;
    const late = new Promise<Response>((resolve) => { finish = () => { resolve(Response.json({}, { status: 500 })); }; });
    let calls = 0;
    const server = editorServer({ overrides: { [READ]: () => { calls += 1; return calls === 1 ? late : Response.json(analysisBody(N.bars, ANALYSES[N.bars] as AnalysisSpec)); } } });
    const { result, rerender } = renderHook((props: TileSources) => useTiles(props), { initialProps: sources(server) });
    rerender(sources(server, { identity: "autre" }));
    await waitFor(() => { expect(result.current.states.get(N.visual)).toMatchObject({ status: "success" }); });
    // La réponse tardive de la personne précédente (une panne) n'écrase rien de ce qui est lu sous la nouvelle.
    finish();
    await quiet();
    expect(result.current.states.get(N.visual)).toMatchObject({ status: "success" });
    expect(Object.keys(result.current.analyses)).toContain(N.visual);
  });
});

describe("décision et compatibilité des tuiles", () => {
  const duplicate = () => decodeDashboardDraft({
    ...sampleDraft(), filters: [],
    layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: [
      { id: N.visual, type: "analysis", reference: { analysis_id: N.bars, revision: 1 }, presentation: {} },
      { id: N.kpi, type: "analysis", reference: { analysis_id: N.bars, revision: 1 }, presentation: { title: "Copie" } },
    ] }] }] }] },
  });
  const sources = (server: ReturnType<typeof editorServer>, document = duplicate()): TileSources => ({
    space: "finance", dashboard: ID, identity: "cora", environment: "DEV", document,
    tiles: [{ id: N.visual, state: "ready" }, { id: N.kpi, state: "ready" }],
    catalog: { status: "ok", value: { models: MODELS } }, fetcher: server.fetcher, poll: 1,
  });

  it("partage une seule décision même si une seconde soumission aurait réussi", async () => {
    const server = editorServer({ sequence: { [N.bars]: ["deny", "succeeded"] } });
    const initial = duplicate();
    const { result, rerender } = renderHook((props: TileSources) => useTiles(props), { initialProps: sources(server, initial) });
    await waitFor(() => { expect(result.current.states.get(N.visual)).toMatchObject({ status: "denied", decision: "DENY" }); });
    expect(result.current.states.get(N.kpi)).toMatchObject({ status: "denied", decision: "DENY" });
    expect(server.submitted()).toHaveLength(1);
    const remaining = decodeDashboardDraft({ ...initial, layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: [
      { id: N.visual, type: "analysis", reference: { analysis_id: N.bars, revision: 1 }, presentation: {} },
    ] }] }] }] } });
    rerender(sources(server, remaining));
    await quiet();
    expect(result.current.states.get(N.visual)).toMatchObject({ status: "denied", decision: "DENY" });
    expect(server.submitted()).toHaveLength(1);
  });

  it.each([true, false])("bloque un filtre sans défaut sur dimension absente, tuile serveur présente : %s", async (present) => {
    const server = editorServer();
    const draft = decodeDashboardDraft({ ...duplicate(), filters: [{ id: N.filter, label: "Absente", dimension: "absente", operator: "eq", targets: [N.visual] }] });
    const props = sources(server, draft);
    const { result } = renderHook(() => useTiles({ ...props, tiles: present ? props.tiles : [{ id: N.kpi, state: "ready" }] }));
    await waitFor(() => { expect(result.current.states.get(N.visual)).toEqual({ status: "unavailable", reason: "filter_incompatible" }); });
    await waitFor(() => { expect(result.current.states.get(N.kpi)).toMatchObject({ status: "success" }); });
    expect(server.submitted()).toHaveLength(1);
  });
});

it("attend le catalogue ciblé et rend son échec sans exécuter la tuile", async () => {
  const server = editorServer();
  const props: TileSources = { space: "finance", dashboard: ID, identity: "cora", environment: "DEV", document: sampleDraft(),
    tiles: [{ id: N.visual, state: "ready" }, { id: N.kpi, state: "ready" }], catalog: { status: "loading" }, fetcher: server.fetcher, poll: 1 };
  const { result, rerender } = renderHook((value: TileSources) => useTiles(value), { initialProps: props });
  await waitFor(() => { expect(result.current.settled).toBe(true); });
  expect(result.current.states.get(N.visual)).toEqual({ status: "reading", source: "catalog" });
  const failure = { status: "error", message: "Catalogue indisponible" } as const;
  rerender({ ...props, catalog: failure });
  expect(result.current.states.get(N.visual)).toEqual({ status: "unreadable", outcome: failure, source: "catalog" });
  expect(server.submitted().every((one) => one.dimensions.length === 0)).toBe(true);
});

it("rend indisponible une analyse épinglée non vérifiée", async () => {
  const server = editorServer({ analyses: { ...ANALYSES, [N.bars]: { ...ANALYSES[N.bars] as AnalysisSpec, state: "unverified" } } });
  const props: TileSources = { space: "finance", dashboard: ID, identity: "cora", environment: "DEV", document: sampleDraft(),
    tiles: [{ id: N.visual, state: "ready" }, { id: N.kpi, state: "ready" }], catalog: { status: "ok", value: { models: MODELS } }, fetcher: server.fetcher, poll: 1 };
  const { result } = renderHook(() => useTiles(props));
  await waitFor(() => { expect(result.current.states.get(N.visual)).toEqual({ status: "unavailable", reason: "unverified" }); });
});

it("conserve les soumissions en cours pendant la lecture d'une analyse ajoutée", async () => {
  const server = editorServer({ overrides: {
    [`POST ${ROOT}/executions`]: () => new Promise<Response>(() => undefined),
    [`GET ${ROOT}/analyses/${N.total}/revisions/1`]: () => new Promise<Response>(() => undefined),
  } });
  const single = decodeDashboardDraft({ ...sampleDraft(), layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: [
    { id: N.visual, type: "analysis", reference: { analysis_id: N.bars, revision: 1 }, presentation: {} },
  ] }] }] }] } });
  const props: TileSources = { space: "finance", dashboard: ID, identity: "cora", environment: "DEV", document: single,
    tiles: [{ id: N.visual, state: "ready" }, { id: N.kpi, state: "ready" }], catalog: { status: "ok", value: { models: MODELS } }, fetcher: server.fetcher, poll: 1 };
  const { result, rerender } = renderHook((value: TileSources) => useTiles(value), { initialProps: props });
  await waitFor(() => { expect(result.current.states.get(N.visual)?.status).toBe("running"); });
  rerender({ ...props, document: sampleDraft() });
  expect(result.current.settled).toBe(false);
  expect(result.current.states.get(N.visual)?.status).toBe("running");
  expect(server.fetcher.mock.calls.filter(([url, init]) => url === `${ROOT}/executions` && init?.method === "POST")).toHaveLength(1);
});

describe("requêtes et décisions conservées", () => {
  const draft = (include: boolean) => decodeDashboardDraft({ ...sampleDraft(), filters: [], layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: include ? [{ id: N.visual, type: "analysis", reference: { analysis_id: N.bars, revision: 1 }, presentation: {} }] : [] }] }] }] } });
  const props = (server: ReturnType<typeof editorServer>, include = true): TileSources => ({ space: "finance", dashboard: ID, identity: "cora", environment: "DEV", document: draft(include), tiles: [{ id: N.visual, state: "ready" }], catalog: { status: "ok", value: { models: MODELS } }, fetcher: server.fetcher, poll: 1 });
  it("ajoute le défaut du filtre commun après les filtres de l'analyse", async () => {
    const server = editorServer();
    const base = props(server);
    const document = decodeDashboardDraft({ ...base.document, filters: [{ id: N.filter, label: "Région", dimension: "region", operator: "eq", default: "Nord", targets: [N.visual] }] });
    renderHook(() => useTiles({ ...base, document }));
    await waitFor(() => { expect(server.submitted()).toHaveLength(1); });
    expect(server.submitted()[0]?.filters).toEqual([{ column: "region", operator: "in", value: ["Nord", "Sud"] }, { column: "region", operator: "eq", value: "Nord" }]);
  });
  it.each(["deny", "require_human"] as const)("garde %s après retrait et rétablissement", async (decision) => {
    const server = editorServer({ outcomes: { [N.bars]: decision } });
    const { result, rerender } = renderHook((value: TileSources) => useTiles(value), { initialProps: props(server) });
    await waitFor(() => { expect(result.current.states.get(N.visual)?.status).toBe("denied"); });
    rerender(props(server, false));
    rerender(props(server));
    await quiet();
    expect(result.current.states.get(N.visual)).toMatchObject({ status: "denied", decision: decision === "deny" ? "DENY" : "REQUIRE_HUMAN" });
    expect(server.submitted()).toHaveLength(1);
  });
  it("ne garde pas une erreur après retrait et rétablissement", async () => {
    const server = editorServer({ outcomes: { [N.bars]: "failed" } });
    const { result, rerender } = renderHook((value: TileSources) => useTiles(value), { initialProps: props(server) });
    await waitFor(() => { expect(result.current.states.get(N.visual)?.status).toBe("error"); });
    rerender(props(server, false));
    rerender(props(server));
    await waitFor(() => { expect(server.submitted()).toHaveLength(2); });
  });
});

it("réessaie explicitement une lecture d'analyse en échec puis exécute la tuile", async () => {
  let attempts = 0;
  const view = await ready({ overrides: { [READ]: () => { attempts += 1; return attempts === 1 ? Response.json({}, { status: 500 }) : Response.json(analysisBody(N.bars, ANALYSES[N.bars] as AnalysisSpec)); } } });
  await within(tile("Visuel épinglé")).findByRole("alert");
  await userEvent.click(within(tile("Visuel épinglé")).getByRole("button", { name: "Réessayer" }));
  await waitFor(() => { expect(within(screen.getByRole("region", { name: "Chiffre d'affaires par région" })).getByText("Preuve")).toBeInTheDocument(); });
  expect(attempts).toBe(2);
  expect(view.server.submitted()).toHaveLength(2);
});

it("annule la tuile en cours sans réessayer les lectures valides ou inconnues", async () => {
  const server = editorServer({ overrides: { [`POST ${ROOT}/executions`]: () => new Promise<Response>(() => undefined) } });
  const props: TileSources = { space: "finance", dashboard: ID, identity: "cora", environment: "DEV", document: sampleDraft(), tiles: [{ id: N.visual, state: "ready" }, { id: N.kpi, state: "ready" }], catalog: { status: "ok", value: { models: MODELS } }, fetcher: server.fetcher, poll: 1 };
  const { result } = renderHook(() => useTiles(props));
  act(() => { result.current.retry("inconnu"); result.current.retry(N.visual); });
  await waitFor(() => { expect(result.current.states.get(N.visual)?.status).toBe("running"); });
  act(() => { result.current.retry(N.visual); result.current.cancel(N.visual); });
  expect(result.current.states.get(N.visual)?.status).toBe("cancelled");
  expect(result.current.states.get(N.kpi)?.status).toBe("running");
});

it("le bouton de la tuile annule sa soumission en cours", async () => {
  await ready({ overrides: { [`POST ${ROOT}/executions`]: () => new Promise<Response>(() => undefined) } });
  await waitFor(() => { expect(within(tile("Chiffre d'affaires par région")).getByRole("button", { name: /Annuler l/ })).toBeInTheDocument(); });
  await userEvent.click(within(tile("Chiffre d'affaires par région")).getByRole("button", { name: /Annuler l/ }));
  expect(within(tile("Chiffre d'affaires par région")).getByRole("status")).toHaveTextContent("Exécution annulée");
  await userEvent.click(within(tile("Chiffre d'affaires par région")).getByRole("button", { name: "Relancer" }));
  expect(within(tile("Chiffre d'affaires par région")).getByRole("status")).toHaveTextContent("Exécution en cours");
});

it("une tuile prête attend les autres lectures avant sa première soumission", async () => {
  const server = editorServer({ overrides: { [`GET ${ROOT}/analyses/${N.total}/revisions/1`]: () => new Promise<Response>(() => undefined) } });
  const props: TileSources = { space: "finance", dashboard: ID, identity: "cora", environment: "DEV", document: sampleDraft(), tiles: [{ id: N.visual, state: "ready" }, { id: N.kpi, state: "ready" }], catalog: { status: "ok", value: { models: MODELS } }, fetcher: server.fetcher, poll: 1 };
  const { result } = renderHook(() => useTiles(props));
  await waitFor(() => { expect(result.current.analyses[N.visual]).toBeDefined(); });
  expect(result.current.states.get(N.visual)).toEqual({ status: "reading" });
  expect(server.submitted()).toHaveLength(0);
});

it("annule côté serveur la requête de la tuile seule, puis la relance", async () => {
  const ids = ["00000000-0000-4000-8000-000000000101", "00000000-0000-4000-8000-000000000102", "00000000-0000-4000-8000-000000000103"];
  let count = 0;
  const server = editorServer({ overrides: {
    [`POST ${ROOT}/executions`]: () => Response.json({ ...running(), id: ids[count++] }, { status: 202 }),
    [`POST ${ROOT}/executions/${ids[0]}/cancel`]: () => Response.json({ ...cancelled(), id: ids[0] }),
  } });
  const props: TileSources = { space: "finance", dashboard: ID, identity: "cora", environment: "DEV", document: sampleDraft(), tiles: [{ id: N.visual, state: "ready" }, { id: N.kpi, state: "ready" }], catalog: { status: "ok", value: { models: MODELS } }, fetcher: server.fetcher, poll: 60_000 };
  const { result } = renderHook(() => useTiles(props));
  await waitFor(() => { expect(count).toBe(2); });
  await act(async () => { await Promise.resolve(); });
  act(() => { result.current.cancel(N.visual); });
  await waitFor(() => { expect(server.fetcher.mock.calls.filter(([url, init]) => url === `${ROOT}/executions/${ids[0]}/cancel` && init?.method === "POST")).toHaveLength(1); });
  expect(result.current.states.get(N.visual)?.status).toBe("cancelled");
  expect(result.current.states.get(N.kpi)?.status).toBe("running");
  act(() => { result.current.restart(N.visual); });
  await waitFor(() => { expect(count).toBe(3); });
  expect(result.current.states.get(N.visual)?.status).toBe("running");
});

it("ne stoppe pas une requête partagée tant qu'une autre tuile la demande", async () => {
  const id = "00000000-0000-4000-8000-000000000101";
  const server = editorServer({ overrides: { [`POST ${ROOT}/executions`]: () => Response.json({ ...running(), id }, { status: 202 }) } });
  const document = decodeDashboardDraft({ ...sampleDraft(), filters: [], layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: [
    { id: N.visual, type: "analysis", reference: { analysis_id: N.bars, revision: 1 }, presentation: {} },
    { id: N.kpi, type: "analysis", reference: { analysis_id: N.bars, revision: 1 }, presentation: {} },
  ] }] }] }] } });
  const props: TileSources = { space: "finance", dashboard: ID, identity: "cora", environment: "DEV", document, tiles: [{ id: N.visual, state: "ready" }, { id: N.kpi, state: "ready" }], catalog: { status: "ok", value: { models: MODELS } }, fetcher: server.fetcher, poll: 60_000 };
  const { result } = renderHook(() => useTiles(props));
  await waitFor(() => { expect(result.current.states.get(N.visual)?.status).toBe("running"); });
  act(() => { result.current.cancel(N.visual); });
  expect(result.current.states.get(N.visual)?.status).toBe("cancelled");
  expect(result.current.states.get(N.kpi)?.status).toBe("running");
  expect(server.fetcher.mock.calls.filter(([url]) => url.endsWith("/cancel"))).toHaveLength(0);
  expect(server.fetcher.mock.calls.filter(([url, init]) => url === `${ROOT}/executions` && init?.method === "POST")).toHaveLength(1);
  act(() => { result.current.restart(N.visual); });
  expect(result.current.states.get(N.visual)?.status).toBe("running");
  expect(server.fetcher.mock.calls.filter(([url, init]) => url === `${ROOT}/executions` && init?.method === "POST")).toHaveLength(1);
});

it("le réessai efface l'échec pendant la lecture et ne relit jamais une analyse déjà réussie", async () => {
  let calls = 0;
  let release!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { release = resolve; });
  const server = editorServer({ overrides: { [READ]: () => { calls += 1; return calls === 1 ? Response.json({}, { status: 500 }) : pending; } } });
  const props: TileSources = { space: "finance", dashboard: ID, identity: "cora", environment: "DEV", document: sampleDraft(), tiles: [{ id: N.visual, state: "ready" }, { id: N.kpi, state: "ready" }], catalog: { status: "ok", value: { models: MODELS } }, fetcher: server.fetcher, poll: 1 };
  const { result } = renderHook(() => useTiles(props));
  await waitFor(() => { expect(result.current.states.get(N.visual)?.status).toBe("unreadable"); });
  act(() => { result.current.retry(N.visual); });
  expect(result.current.states.get(N.visual)?.status).toBe("reading");
  await waitFor(() => { expect(calls).toBe(2); });
  await act(async () => { release(Response.json(analysisBody(N.bars, ANALYSES[N.bars] as AnalysisSpec))); await pending; });
  await waitFor(() => { expect(result.current.states.get(N.visual)?.status).toBe("success"); });
  act(() => { result.current.retry(N.visual); });
  expect(calls).toBe(2);
});

it("relance une exécution annulée par le serveur, une seule soumission par clic", async () => {
  let calls = 0;
  const server = editorServer({ overrides: { [`POST ${ROOT}/executions`]: () => {
    calls += 1;
    return Response.json(calls === 1 ? cancelled() : running(), { status: 202 });
  } } });
  const document = decodeDashboardDraft({ ...sampleDraft(), filters: [], layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: [
    { id: N.visual, type: "analysis", reference: { analysis_id: N.bars, revision: 1 }, presentation: {} },
  ] }] }] }] } });
  const props: TileSources = { space: "finance", dashboard: ID, identity: "cora", environment: "DEV", document, tiles: [{ id: N.visual, state: "ready" }], catalog: { status: "ok", value: { models: MODELS } }, fetcher: server.fetcher, poll: 60_000 };
  const { result } = renderHook(() => useTiles(props));
  await waitFor(() => { expect(result.current.states.get(N.visual)?.status).toBe("cancelled"); });
  act(() => { result.current.restart(N.visual); });
  await waitFor(() => { expect(result.current.states.get(N.visual)?.status).toBe("running"); });
  expect(calls).toBe(2);
  act(() => { result.current.restart(N.visual); });
  expect(calls).toBe(2);
});

it.each(["deny", "require_human"] as const)("ne relance jamais le refus %s", async (decision) => {
  const server = editorServer({ outcomes: { [N.bars]: decision } });
  const props: TileSources = { space: "finance", dashboard: ID, identity: "cora", environment: "DEV", document: sampleDraft(), tiles: [{ id: N.visual, state: "ready" }, { id: N.kpi, state: "ready" }], catalog: { status: "ok", value: { models: MODELS } }, fetcher: server.fetcher, poll: 1 };
  const { result } = renderHook(() => useTiles(props));
  await waitFor(() => { expect(result.current.states.get(N.visual)?.status).toBe("denied"); });
  const count = server.submitted().length;
  act(() => { result.current.restart(N.visual); });
  await quiet();
  expect(result.current.states.get(N.visual)?.status).toBe("denied");
  expect(server.submitted()).toHaveLength(count);
});
