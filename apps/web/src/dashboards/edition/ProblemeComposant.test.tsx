import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { EditorContext, type Editor } from "./EditorContext";
import { PanneauBas } from "./PanneauBas";
import { buildTree } from "./tree";
import { decodeDashboardDraft } from "../document";
import { N, sampleDraft } from "./testing";

it.each([true, false])("nomme l'écart de composant, résolu : %s", (resolved) => {
  const document = decodeDashboardDraft({ ...sampleDraft(), filters: [], layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: [{ id: N.visual, type: "component", component: { component_id: N.kpi, revision: 1 } }] }] }] }] } });
  const editor = { document, tree: buildTree(document), problems: [{ code: "component_revision_behind", severity: "warning", nodeId: N.visual, path: "/x", pinned: 1, current: 2 }], resolvedComponents: resolved ? { [N.visual]: { document: { name: "Ventes" } } } : {}, settled: true, catalog: [], reveal: vi.fn() } as unknown as Editor;
  render(<EditorContext value={editor}><PanneauBas tab="problems" onTab={vi.fn()} /></EditorContext>);
  expect(screen.getByText(resolved ? "Ventes" : "Composant")).toBeInTheDocument();
});
