import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { SKIFER_CLAIR } from "../../charts/theme";
import type { Editor } from "./EditorContext";
import { N, sampleDraft } from "./testing";

const mock = vi.hoisted(() => ({ editor: {} as Editor }));
vi.mock("./EditorContext", () => ({ useEditor: () => mock.editor }));
vi.mock("./Tuile", () => ({ Tuile: ({ onCancel, onRetry, onRestart }: { onCancel: () => void; onRetry: () => void; onRestart: () => void }) => <div role="group" aria-label="Actions de tuile"><button onClick={onCancel}>Annuler</button><button onClick={onRetry}>Réessayer</button><button onClick={onRestart}>Relancer</button></div> }));
import { Apercu } from "./Apercu";

it("transmet les actions des tuiles et gère une largeur indisponible avant mesure", async () => {
  const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(0);
  const cancelTile = vi.fn(); const retryTile = vi.fn(); const restartTile = vi.fn();
  mock.editor = { document: sampleDraft(), states: new Map(), problems: [], analyses: {}, catalog: null, theme: SKIFER_CLAIR, cancelTile, retryTile, restartTile } as unknown as Editor;
  const view = render(<Apercu onClose={vi.fn()} />);
  const first = within(screen.getAllByRole("group", { name: "Actions de tuile" })[0] as HTMLElement);
  await userEvent.click(first.getByRole("button", { name: "Annuler" }));
  await userEvent.click(first.getByRole("button", { name: "Réessayer" }));
  await userEvent.click(first.getByRole("button", { name: "Relancer" }));
  expect(cancelTile).toHaveBeenCalledWith(N.visual);
  expect(retryTile).toHaveBeenCalledWith(N.visual);
  expect(restartTile).toHaveBeenCalledWith(N.visual);
  expect(view.container.querySelector(".sb-preview__viewport")).toHaveStyle({ zoom: "1" });
  view.unmount();
  width.mockRestore();
});

it("respecte la largeur proportionnelle et réduit le zoom à la largeur disponible", () => {
  const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
  mock.editor = { document: sampleDraft(), states: new Map(), problems: [], analyses: {}, catalog: null, theme: SKIFER_CLAIR, cancelTile: vi.fn(), retryTile: vi.fn(), restartTile: vi.fn() } as unknown as Editor;
  const view = render(<Apercu onClose={vi.fn()} />);
  expect(view.container.querySelector(`[data-column="${N.c1}"]`)).toHaveStyle({ gridColumn: "span 4" });
  expect(view.container.querySelector(".sb-preview__viewport")).toHaveStyle({ zoom: "0.5" });
  view.unmount(); width.mockRestore();
});

it("signale un composant référencé indisponible dans l'aperçu", () => {
  const draft = sampleDraft();
  mock.editor = { document: { ...draft, filters: [], layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: [{ id: N.visual, type: "component", component: { component_id: N.kpi, revision: 1 } }] }] }] }] } }, states: new Map(), problems: [], analyses: {}, catalog: null, theme: SKIFER_CLAIR, cancelTile: vi.fn(), retryTile: vi.fn(), restartTile: vi.fn() } as unknown as Editor;
  render(<Apercu onClose={vi.fn()} />);
  expect(screen.getByText("Composant indisponible : rendu non pris en charge.")).toBeInTheDocument();
});


it("affiche la raison transmise pour un composant indisponible", () => {
  const draft = sampleDraft();
  mock.editor = { document: { ...draft, filters: [], layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: [{ id: N.visual, type: "component", component: { component_id: N.kpi, revision: 1 } }] }] }] }] } }, states: new Map(), problems: [{ code: "component_unavailable", nodeId: N.visual }], analyses: {}, catalog: null, theme: SKIFER_CLAIR } as unknown as Editor;
  render(<Apercu onClose={vi.fn()} />);
  expect(screen.getByText("Composant indisponible : la tuile ne s’exécute pas.")).toBeInTheDocument();
});

it("affiche un emplacement de brouillon", () => {
  const draft = sampleDraft();
  mock.editor = { document: { ...draft, filters: [], layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: [{ id: N.visual, type: "slot", slot: { expected: "visual", label: "Ventes" } }] }] }] }] } }, states: new Map(), problems: [], analyses: {}, catalog: null, theme: SKIFER_CLAIR } as unknown as Editor;
  render(<Apercu onClose={vi.fn()} />);
  expect(screen.getByText("Emplacement : Ventes")).toBeInTheDocument();
});

it("transmet les actions d'un composant résolu", async () => {
  const draft = sampleDraft();
  const component = { id: N.visual, type: "analysis" as const, reference: { analysis_id: N.bars, revision: 1 }, presentation: {} };
  const cancelTile = vi.fn(); const retryTile = vi.fn(); const restartTile = vi.fn();
  mock.editor = { document: { ...draft, filters: [], layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: [{ id: N.visual, type: "component", component: { component_id: N.kpi, revision: 1 } }] }] }] }] } }, components: new Map([[N.visual, component]]), states: new Map(), problems: [], analyses: {}, catalog: null, theme: SKIFER_CLAIR, cancelTile, retryTile, restartTile } as unknown as Editor;
  render(<Apercu onClose={vi.fn()} />);
  const actions = within(screen.getByRole("group", { name: "Actions de tuile" }));
  await userEvent.click(actions.getByRole("button", { name: "Annuler" }));
  await userEvent.click(actions.getByRole("button", { name: "Réessayer" }));
  await userEvent.click(actions.getByRole("button", { name: "Relancer" }));
  expect(cancelTile).toHaveBeenCalledWith(N.visual); expect(retryTile).toHaveBeenCalledWith(N.visual); expect(restartTile).toHaveBeenCalledWith(N.visual);
});
