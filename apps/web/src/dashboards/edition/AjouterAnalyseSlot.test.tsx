import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AjouterAnalyse } from "./AjouterAnalyse";
import { EditorContext, type Editor } from "./EditorContext";
import { ANALYSES, analysisBody, editorServer, N, ROOT, sampleDraft, type AnalysisSpec } from "./testing";

function open(expected: "visual" | "kpi", options: Parameters<typeof editorServer>[0] = {}) {
  const server = editorServer(options), run = vi.fn().mockReturnValue(true), close = vi.fn();
  const editor = { document: sampleDraft(), tree: [], selected: null, run } as unknown as Editor;
  render(<EditorContext value={editor}><AjouterAnalyse space="finance" fetcher={server.fetcher} slot={{ id: "slot", expected, label: "Ventes" }} onClose={close} /></EditorContext>);
  return { server, run, close };
}
it("remplit un visuel avec l'analyse choisie", async () => {
  const { run, close } = open("visual");
  run.mockReturnValueOnce(false);
  fireEvent.click(await screen.findByRole("button", { name: /Chiffre d'affaires par région/ }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(await within(dialog).findByRole("button", { name: "Remplir" }));
  expect(run.mock.calls[0]?.[0]).toMatchObject({ type: "fill_slot", id: "slot", value: { source: "analysis", kind: "visual" } });
  expect(close).not.toHaveBeenCalled(); fireEvent.click(within(dialog).getByRole("button", { name: "Remplir" }));
  expect(close).toHaveBeenCalled();
});
it("ne propose pour un KPI que les analyses compatibles", async () => {
  const { run } = open("kpi");
  expect(await screen.findByRole("button", { name: /Total · Partagée/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Chiffre d'affaires par région/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Total · Partagée/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Remplir" }));
  expect(run.mock.calls[0]?.[0]).toMatchObject({ value: { kind: "kpi" } });
});
it("exclut les analyses personnelles d'un dashboard partagé", async () => {
  open("visual", { analyses: { ...ANALYSES, [N.bars]: { ...ANALYSES[N.bars] as AnalysisSpec, visibility: "personal" } } });
  expect(await screen.findByRole("button", { name: /Total · Partagée/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Chiffre d'affaires par région/ })).not.toBeInTheDocument();
});
it("signale une analyse dont la compatibilité ne peut être lue", async () => {
  open("kpi", { overrides: { [`GET ${ROOT}/analyses/${N.bars}/revisions/1`]: Response.json({ error: { code: "forbidden" } }, { status: 403 }) } });
  expect(await screen.findByText(/Analyse Chiffre d'affaires par région indisponible/)).toBeInTheDocument();
});


it("refuse une révision ancienne devenue incompatible avec un KPI", async () => {
  open("kpi", { analyses: { ...ANALYSES, [N.total]: { ...ANALYSES[N.total] as AnalysisSpec, current: 2 } }, overrides: { [`GET ${ROOT}/analyses/${N.total}/revisions/1`]: Response.json(analysisBody(N.total, ANALYSES[N.bars] as AnalysisSpec, 1)) } });
  fireEvent.click(await screen.findByRole("button", { name: /Total · Partagée/ }));
  const revision = await screen.findByRole("combobox", { name: "Révision" });
  fireEvent.change(revision, { target: { value: "1" } });
  expect(await screen.findByText("Cette analyse ne convient pas à un KPI.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Remplir" })).toBeDisabled();
});
it("explique pourquoi les analyses personnelles sont masquées", async () => {
  open("visual", { analyses: { [N.bars]: { ...ANALYSES[N.bars] as AnalysisSpec, visibility: "personal" } } });
  expect(await screen.findByText("Les analyses personnelles ne sont pas proposées pour un dashboard partagé.")).toBeInTheDocument();
  expect(screen.getByText("Aucune analyse ne correspond à la recherche.")).toBeInTheDocument();
});
