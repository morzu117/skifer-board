import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { expectAccessible } from "../test/a11y";
import { route as dashboardRoute } from "../dashboards/testing";
import { ANALYSES, analysisBody, editorServer, N, ROOT, sampleDraft } from "../dashboards/edition/testing";
import { ID } from "./testing";
import { decodeRevision } from "./model";
import { EpinglerDashboard } from "./EpinglerDashboard";

const analysis = () => decodeRevision(analysisBody(N.total, ANALYSES[N.total] as (typeof ANALYSES)[string]), "finance");
const listing = () => {
  const body = dashboardRoute("lister").body as { dashboards: { id: string }[] };
  (body.dashboards[0] as { id: string }).id = ID;
  return Response.json(body);
};
const setup = (options: Parameters<typeof editorServer>[0] = {}) => {
  const server = editorServer({ ...options, overrides: { [`GET ${ROOT}/dashboards`]: listing, ...options.overrides } });
  const view = render(<EpinglerDashboard space="finance" found={analysis()} fetcher={server.fetcher} onClose={vi.fn()} />);
  return { server, ...view };
};
const select = async () => {
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Dashboard" }), ID);
  await screen.findByRole("button", { name: "Épingler" });
};

it("épingle un KPI dans une rangée de la section et n'envoie que la référence et la présentation", async () => {
  const { server, container } = setup();
  await select();
  await userEvent.click(screen.getByRole("radio", { name: "KPI" }));
  await expectAccessible(container);
  await userEvent.click(screen.getByRole("button", { name: "Épingler" }));
  expect(await screen.findByRole("link", { name: "Ouvrir le dashboard" })).toHaveAttribute("href", `#/espaces/finance/dashboards/${ID}`);
  const sent = server.saved()[0] as { expected_revision: number; layout: { sections: { rows: { columns: { children: unknown[] }[] }[] }[] } };
  expect(sent.expected_revision).toBe(1);
  const added = sent.layout.sections[0]?.rows.at(-1)?.columns[0]?.children[0] as Record<string, unknown>;
  expect(typeof added.id).toBe("string");
  expect({ ...added, id: "generated" }).toEqual({ id: "generated", type: "kpi", reference: { analysis_id: N.total, revision: 1 }, presentation: {} });
});

it("un conflit conserve le brouillon et ne retente pas d'écriture automatiquement", async () => {
  const { server } = setup({ overrides: { [`POST ${ROOT}/dashboards/${ID}/revisions`]: Response.json({ error: { code: "revision_conflict", reason: "stale" } }, { status: 409 }) } });
  await select(); await userEvent.click(screen.getByRole("button", { name: "Épingler" }));
  expect(await screen.findByRole("region", { name: "Conflit de révision" })).toBeInTheDocument();
  expect(server.fetcher.mock.calls.filter(([url, init]) => url.endsWith("/revisions") && init?.method === "POST")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Copie indépendante" })).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "Rouvrir la révision courante" })).toBeInTheDocument();
});

it("rend le refus personnel sans écraser le dashboard", async () => {
  const { server } = setup({ overrides: { [`POST ${ROOT}/dashboards/${ID}/revisions`]: Response.json({ error: { code: "personal_reference", components: [N.visual] } }, { status: 422 }) } });
  await select(); await userEvent.click(screen.getByRole("button", { name: "Épingler" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(N.visual);
  expect(server.saved()).toHaveLength(0);
});

it("une double activation pendant l'écriture ne crée qu'une seule révision", async () => {
  let resolve!: (value: Response) => void;
  const delayed = new Promise<Response>((done) => { resolve = done; });
  const { server } = setup({ overrides: { [`POST ${ROOT}/dashboards/${ID}/revisions`]: () => delayed } });
  await select();
  const button = screen.getByRole("button", { name: "Épingler" });
  act(() => { fireEvent.click(button); fireEvent.click(button); });
  expect(screen.getByRole("button", { name: "Épinglage…" })).toBeDisabled();
  expect(server.fetcher.mock.calls.filter(([url, init]) => url.endsWith("/revisions") && init?.method === "POST")).toHaveLength(1);
  await act(async () => { resolve(Response.json({}, { status: 500 })); await delayed; });
  expect(await screen.findByRole("alert")).toBeInTheDocument();
});

it("ne propose que les dashboards modifiables et explique une section absente", async () => {
  const empty = { ...sampleDraft(), filters: [], layout: { sections: [] } };
  const { unmount } = setup({ draft: empty, tiles: [] });
  await select();
  expect(screen.getByText(/Ce dashboard ne contient aucune section/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Épingler" })).toBeDisabled();
  unmount();
  setup({ revise: false });
  expect(await screen.findByText("Aucun dashboard modifiable disponible.")).toBeInTheDocument();
});

it("choisit une section et n'offre le KPI que pour une révision compatible", async () => {
  const { server } = setup(); await select();
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Section" }), N.s2);
  await userEvent.click(screen.getByRole("button", { name: "Épingler" }));
  await screen.findByRole("link", { name: "Ouvrir le dashboard" });
  const sent = server.saved()[0] as { layout: { sections: { rows: unknown[] }[] } };
  expect(sent.layout.sections[1]?.rows).toHaveLength(1);
});

it("signale les lectures indisponibles sans soumettre", async () => {
  const { server } = setup({ overrides: { [`GET ${ROOT}/analyses/${N.total}/revisions`]: Response.json({}, { status: 500 }) } });
  await select();
  expect(await screen.findByText(/Historique indisponible/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Épingler" })).toBeDisabled();
  await waitFor(() => { expect(server.saved()).toHaveLength(0); });
});

it("rend le refus de la liste des dashboards", async () => {
  setup({ overrides: { [`GET ${ROOT}/dashboards`]: Response.json({}, { status: 500 }) } });
  expect(await screen.findByText(/Dashboards indisponibles/)).toBeInTheDocument();
});

it("signale un dashboard illisible et permet d'effacer la sélection", async () => {
  const { unmount } = setup({ overrides: { [`GET ${ROOT}/dashboards/${ID}`]: Response.json({}, { status: 500 }) } });
  expect(await screen.findByText("Certains dashboards n'ont pas pu être lus.")).toBeInTheDocument();
  unmount();
  setup(); await select();
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Dashboard" }), "");
  expect(screen.queryByRole("button", { name: "Épingler" })).not.toBeInTheDocument();
});

it("indique une analyse illisible et n'offre pas de l'épingler", async () => {
  setup({ overrides: { [`GET ${ROOT}/analyses/${N.total}/revisions/1`]: Response.json({}, { status: 500 }) } });
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Dashboard" }), ID);
  expect(await screen.findByText(/Analyse indisponible/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Épingler" })).not.toBeInTheDocument();
});

it("la révision choisie commande la disponibilité du KPI et son épingle", async () => {
  const specs = { ...ANALYSES, [N.total]: { ...ANALYSES[N.total], current: 2 } } as typeof ANALYSES;
  const { server } = setup({ analyses: specs }); await select();
  await userEvent.click(screen.getByRole("radio", { name: "KPI" }));
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Révision" }), "1");
  await waitFor(() => { expect(screen.getByRole("radio", { name: "Visuel" })).toBeChecked(); });
  await userEvent.click(screen.getByRole("radio", { name: "KPI" }));
  await userEvent.click(screen.getByRole("radio", { name: "Visuel" }));
  expect(screen.getByRole("radio", { name: "Visuel" })).toBeChecked();
  await userEvent.click(screen.getByRole("button", { name: "Épingler" }));
  await screen.findByRole("link", { name: "Ouvrir le dashboard" });
  const sent = server.saved()[0] as { layout: { sections: { rows: { columns: { children: { reference: { analysis_id: string; revision: number } }[] }[] }[] }[] } };
  expect(sent.layout.sections[0]?.rows.at(-1)?.columns[0]?.children[0]?.reference).toEqual({ analysis_id: N.total, revision: 1 });
});

it("avertit avant l'épinglage d'une analyse personnelle dans un dashboard partagé", async () => {
  const specs = { ...ANALYSES, [N.total]: { ...ANALYSES[N.total], visibility: "personal" } } as typeof ANALYSES;
  setup({ analyses: specs }); await select();
  expect(await screen.findByText(/Une analyse personnelle ne peut pas/)).toBeInTheDocument();
});

it("n'offre pas le KPI si l'analyse porte des dimensions", async () => {
  const specs = { ...ANALYSES, [N.total]: ANALYSES[N.bars] } as typeof ANALYSES;
  setup({ analyses: specs }); await select();
  expect(screen.queryByRole("radio", { name: "KPI" })).not.toBeInTheDocument();
});

it("la réouverture confirmée d'un conflit ouvre le dashboard courant", async () => {
  setup({ overrides: { [`POST ${ROOT}/dashboards/${ID}/revisions`]: Response.json({ error: { code: "revision_conflict", reason: "stale" } }, { status: 409 }) } });
  await select(); await userEvent.click(screen.getByRole("button", { name: "Épingler" }));
  await userEvent.click(await screen.findByRole("button", { name: "Rouvrir la révision courante" }));
  await userEvent.click(screen.getByRole("button", { name: "Abandonner et rouvrir" }));
  expect(window.location.hash).toBe(`#/espaces/finance/dashboards/${ID}`);
  window.history.replaceState(null, "", "/");
});

it("annonce une limite de rangées sans envoyer de révision", async () => {
  const draft = sampleDraft();
  const section = draft.layout.sections[0];
  const full = { ...draft, filters: [], layout: { sections: [{ ...section, rows: Array.from({ length: 24 }, (_, i) => ({ id: `00000000-0000-4000-8000-${(1000 + i).toString(16).padStart(12, "0")}`, columns: [] })) }] } };
  const { server } = setup({ draft: full as typeof draft, tiles: [] });
  await select(); await userEvent.click(screen.getByRole("button", { name: "Épingler" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Impossible d'ajouter la tuile");
  expect(server.saved()).toHaveLength(0);
});

it("dit la raison d'une commande refusée même sans détail", async () => {
  const commands = await import("../dashboards/edition/commands");
  const spy = vi.spyOn(commands, "applyCommand").mockImplementationOnce((document) => ({ ok: false, reason: "not_found", document }));
  setup(); await select(); await userEvent.click(screen.getByRole("button", { name: "Épingler" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("not_found");
  spy.mockRestore();
});

it("se base sur la révision lue quand la révision courante n'est pas indiquée", async () => {
  const server = editorServer({ overrides: { [`GET ${ROOT}/dashboards`]: listing } });
  render(<EpinglerDashboard space="finance" found={{ ...analysis(), currentRevision: null }} fetcher={server.fetcher} onClose={vi.fn()} />);
  await select();
  expect(screen.getByRole("combobox", { name: "Révision" })).toHaveValue("1");
});

it("épingle r1 choisie depuis une fiche ouverte sur la révision courante r2", async () => {
  const spec = { ...ANALYSES[N.total] as (typeof ANALYSES)[string], current: 2 };
  const server = editorServer({ analyses: { ...ANALYSES, [N.total]: spec }, overrides: { [`GET ${ROOT}/dashboards`]: listing } });
  const found = decodeRevision(analysisBody(N.total, spec, 2), "finance");
  render(<EpinglerDashboard space="finance" found={found} fetcher={server.fetcher} onClose={vi.fn()} />);
  await select();
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Révision" }), "1");
  await userEvent.click(screen.getByRole("button", { name: "Épingler" }));
  await screen.findByRole("link", { name: "Ouvrir le dashboard" });
  const sent = server.saved()[0] as { layout: { sections: { rows: { columns: { children: { reference?: { revision: number } }[] }[] }[] }[] } };
  expect(sent.layout.sections[0]?.rows.at(-1)?.columns[0]?.children[0]?.reference?.revision).toBe(1);
});
