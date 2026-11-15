import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { decodeDashboardDraft } from "../document";
import type { Editor } from "./EditorContext";
import { N, sampleDraft } from "./testing";
import { buildTree } from "./tree";

const mock = vi.hoisted(() => ({ editor: {} as Editor }));
vi.mock("./EditorContext", () => ({ useEditor: () => mock.editor, nodeDomId: (id: string) => id, handleDomId: (id: string) => id }));
vi.mock("./Tuile", () => ({ Tuile: ({ onCancel, onRetry, onRestart }: { onCancel: () => void; onRetry: () => void; onRestart: () => void }) => <div><button onClick={onCancel}>Annuler tuile</button><button onClick={onRetry}>Réessayer tuile</button><button onClick={onRestart}>Relancer tuile</button></div> }));
import { Canevas } from "./Canevas";

it("affiche l'emplacement dans le canevas", () => {
  const document = decodeDashboardDraft({ ...sampleDraft(), filters: [], layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: [{ id: N.visual, type: "slot", slot: { expected: "kpi", label: "Ventes" } }] }] }] }] } });
  mock.editor = { document, tree: buildTree(document), readOnly: false } as unknown as Editor;
  render(<Canevas />);
  expect(screen.getByText("Emplacement : Ventes", { selector: "p" })).toBeInTheDocument();
});

it("transmet les actions d'un composant résolu", () => {
  const document = decodeDashboardDraft({ ...sampleDraft(), filters: [], layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: [{ id: N.visual, type: "component", component: { component_id: N.kpi, revision: 1 } }] }] }] }] } });
  const component = { id: N.visual, type: "analysis" as const, reference: { analysis_id: N.bars, revision: 1 }, presentation: {} };
  const cancelTile = vi.fn(); const retryTile = vi.fn(); const restartTile = vi.fn();
  mock.editor = { document, tree: buildTree(document), components: new Map([[N.visual, component]]), states: new Map(), analyses: {}, catalog: null, cancelTile, retryTile, restartTile } as unknown as Editor;
  render(<Canevas />);
  fireEvent.click(screen.getByText("Annuler tuile")); fireEvent.click(screen.getByText("Réessayer tuile")); fireEvent.click(screen.getByText("Relancer tuile"));
  expect(cancelTile).toHaveBeenCalledWith(N.visual); expect(retryTile).toHaveBeenCalledWith(N.visual); expect(restartTile).toHaveBeenCalledWith(N.visual);
});
