import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { Editor } from "./EditorContext";
import { choices, ChoixComposants, ChoixTheme } from "./ChoixContenus";
import { ComponentFields, RevisionComposant } from "./RevisionComposant";
import type { ThemeListItem } from "../../themes/model";

const mocks = vi.hoisted(() => ({ themes: vi.fn(), components: vi.fn(), diff: vi.fn(), editor: { current: {} as Editor } }));
vi.mock("../../themes/client", () => ({ fetchThemes: mocks.themes }));
vi.mock("../../components-lib/client", () => ({ fetchComponents: mocks.components, fetchComponentDiff: mocks.diff }));
vi.mock("./EditorContext", () => ({ useEditor: () => mocks.editor.current }));
const id = "00000000-0000-4000-8000-000000000001";
const owner = { issuer: "issuer", subject: "sujet" };
const item: ThemeListItem = { id, name: "Exemple", owner, revision: 2, state: "draft", approvedRevision: 1, commit: "a", committedAt: new Date(), indexState: "indexed" };
const identity = JSON.stringify([owner.issuer, owner.subject]);
const run = vi.fn(() => true), say = vi.fn();
function setup() {
  mocks.editor.current = { space: "finance", identity, contentSave: { fetcher: vi.fn(), reason: null }, document: { visibility: "shared", layout: { sections: [] } }, tree: [], selected: null, readOnly: false, run, say, resolvedComponents: {}, referenceStates: {} } as unknown as Editor;
  mocks.themes.mockResolvedValue({ status: "ok", value: { themes: [item], unreadable: 0 } });
  mocks.components.mockResolvedValue({ status: "ok", value: { components: [item], unreadable: 0 } });
  run.mockClear(); say.mockClear();
}
beforeEach(setup);
it("propose l'approbation et seulement le brouillon personnel de son auteur", () => {
  expect(choices([item], false, identity).map((x) => x.revision)).toEqual([1]);
  expect(choices([item], true, identity).map((x) => x.revision)).toEqual([1, 2]);
  expect(choices([{ ...item, approvedRevision: null }], true, "autre")).toEqual([]);
});
it("choisit ou retire le thème, et préserve une référence devenue indisponible", async () => {
  const view = render(<ChoixTheme />);
  const select = await screen.findByRole("combobox", { name: "Thème" });
  await screen.findByRole("option", { name: "Exemple · r1" });
  fireEvent.change(select, { target: { value: `${id}:1` } });
  expect(run).toHaveBeenCalledWith({ type: "set_theme", theme: { theme_id: id, revision: 1 } }, "Thème modifié.");
  fireEvent.change(select, { target: { value: "" } });
  expect(run).toHaveBeenCalledWith({ type: "set_theme", theme: null }, "Thème modifié.");
  const editor = mocks.editor.current; editor.document.theme = { theme_id: id, revision: 2 }; view.rerender(<ChoixTheme />);
  expect(screen.getByText("Thème actuel en cours de lecture · r2")).toBeInTheDocument();
  editor.referenceStates = { [`theme:${id}:2`]: { state: "unresolved" } }; view.rerender(<ChoixTheme />);
  expect(screen.getByText("Thème actuel indisponible · r2")).toBeInTheDocument();
  run.mockClear(); fireEvent.change(select, { target: { value: `${id}:2` } }); expect(run).not.toHaveBeenCalled();
});
it("affiche les lectures et erreurs sans inventer de choix", async () => {
  mocks.themes.mockResolvedValue({ status: "error", message: "panne" });
  mocks.components.mockResolvedValue({ status: "refused", code: "forbidden" });
  render(<><ChoixTheme /><ChoixComposants /></>);
  expect(screen.getByText("Lecture des thèmes…")).toBeInTheDocument();
  expect(await screen.findByText(/Thèmes indisponibles : panne/)).toBeInTheDocument();
  expect(await screen.findByText(/Composants indisponibles/)).toBeInTheDocument();
});
it("insère un composant dans une colonne et refuse sans parent", async () => {
  const view = render(<ChoixComposants />);
  const button = await screen.findByRole("button", { name: /Exemple · r1/ });
  fireEvent.click(button); expect(say).toHaveBeenCalledWith(expect.stringContaining("colonne"), true);
  const editor = mocks.editor.current;
  editor.tree = [{ id: "column", kind: "column", parent: null, children: [], index: 0, siblings: 1 }] as unknown as Editor["tree"];
  editor.selected = "column"; view.rerender(<ChoixComposants />); fireEvent.click(button);
  expect(run).toHaveBeenCalledWith(expect.objectContaining({ type: "insert_component", parent: "column", component: { component_id: id, revision: 1 } }), expect.any(String), expect.any(Object));
});
it("détache la référence résolue et signale une référence indisponible", () => {
  const view = render(<ComponentFields id="node" />); expect(screen.getByText(/indisponible/)).toBeInTheDocument();
  const editor = mocks.editor.current;
  editor.resolvedComponents = { node: { document: { id, name: "Exemple" }, revision: 1 } } as unknown as Editor["resolvedComponents"];
  view.rerender(<ComponentFields id="node" />); fireEvent.click(screen.getByRole("button", { name: "Détacher" }));
  expect(run).toHaveBeenCalledWith(expect.objectContaining({ type: "detach_component", id: "node" }), "Composant détaché.");
});
it("compare, adopte ou garde la révision", async () => {
  const editor = mocks.editor.current;
  editor.document.layout.sections = [{ id: "s", rows: [{ id: "r", columns: [{ id: "c", span: 12, children: [{ id: "node", type: "component", component: { component_id: id, revision: 1 } }] }] }] }] as Editor["document"]["layout"]["sections"];
  editor.referenceStates = { [`component:${id}:1`]: { state: "approved", current_revision: 2, approved_revision: 2 } };
  mocks.diff.mockResolvedValue({ status: "ok", value: { changes: [{ path: "/name", kind: "modified", before: "Avant", after: "Après" }] } });
  render(<RevisionComposant id="node" />);
  fireEvent.click(screen.getByRole("button", { name: "Comparer les révisions" }));
  expect(await screen.findByRole("cell", { name: "Avant" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Adopter r2" })); expect(run).toHaveBeenCalledWith({ type: "adopt_component_revision", id: "node", revision: 2 }, "Révision r2 adoptée.");
  fireEvent.click(screen.getByRole("button", { name: "Garder l'épingle" })); await waitFor(() => { expect(screen.queryByText(/révision courante/)).not.toBeInTheDocument(); });
});
it("présente les brouillons personnels et signale les contenus illisibles", async () => {
  const editor = mocks.editor.current; editor.document.visibility = "personal";
  mocks.themes.mockResolvedValue({ status: "ok", value: { themes: [item], unreadable: 1 } });
  mocks.components.mockResolvedValue({ status: "ok", value: { components: [item], unreadable: 1 } });
  render(<><ChoixTheme /><ChoixComposants /></>);
  expect(await screen.findByRole("option", { name: "Exemple · r2 · brouillon" })).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "+ Exemple · r2 · brouillon" })).toBeInTheDocument();
  expect(screen.getByText("Certains thèmes sont illisibles.")).toBeInTheDocument();
  expect(screen.getByText("Certains composants sont illisibles.")).toBeInTheDocument();
});
it("rend les refus de thèmes et les erreurs de composants", async () => {
  mocks.themes.mockResolvedValue({ status: "refused", code: "forbidden" });
  mocks.components.mockResolvedValue({ status: "error", message: "panne" });
  render(<><ChoixTheme /><ChoixComposants /></>);
  expect(await screen.findByText(/Thèmes indisponibles/)).toBeInTheDocument();
  expect(await screen.findByText(/Composants indisponibles : panne/)).toBeInTheDocument();
});
it("signale une liste de composants vide", async () => {
  mocks.components.mockResolvedValue({ status: "ok", value: { components: [], unreadable: 0 } });
  render(<ChoixComposants />); expect(await screen.findByText("Aucun composant approuvé dans cet espace.")).toBeInTheDocument();
});
it("ne propose aucun écart sans référence ou sans révision plus récente", () => {
  const editor = mocks.editor.current;
  const view = render(<RevisionComposant id="node" />); expect(view.container).toBeEmptyDOMElement();
  editor.document.layout.sections = [{ id: "s", rows: [{ id: "r", columns: [{ id: "c", span: 12, children: [{ id: "node", type: "component", component: { component_id: id, revision: 1 } }] }] }] }] as Editor["document"]["layout"]["sections"];
  view.rerender(<RevisionComposant id="node" />); expect(view.container).toBeEmptyDOMElement();
  editor.referenceStates = { [`component:${id}:1`]: { state: "unresolved" } }; view.rerender(<RevisionComposant id="node" />); expect(view.container).toBeEmptyDOMElement();
  editor.referenceStates = { [`component:${id}:1`]: { state: "approved", current_revision: 1, approved_revision: 1 } }; view.rerender(<RevisionComposant id="node" />); expect(view.container).toBeEmptyDOMElement();
});
it.each([{ status: "error", message: "panne" }, { status: "refused", code: "forbidden" }, { status: "ok", value: { changes: [] } }])("rend le diff indisponible ou vide : $status", async (outcome) => {
  const editor = mocks.editor.current;
  editor.document.layout.sections = [{ id: "s", rows: [{ id: "r", columns: [{ id: "c", span: 12, children: [{ id: "node", type: "component", component: { component_id: id, revision: 1 } }] }] }] }] as Editor["document"]["layout"]["sections"];
  editor.referenceStates = { [`component:${id}:1`]: { state: "approved", current_revision: 2, approved_revision: 2 } }; mocks.diff.mockResolvedValue(outcome);
  render(<RevisionComposant id="node" />); fireEvent.click(screen.getByRole("button", { name: "Comparer les révisions" }));
  expect(screen.getByText("Lecture du diff…")).toBeInTheDocument();
  expect(await screen.findByText(outcome.status === "ok" ? "Aucune différence structurelle." : /Diff indisponible/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Masquer la comparaison" })); expect(screen.queryByText(/Diff indisponible/)).not.toBeInTheDocument();
});
it.each([
  ["approved", "shared", "Exemple · r2 (ancienne révision approuvée)"],
  ["draft", "shared", "Exemple · r2 (brouillon : interdit pour un dashboard partagé)"],
  ["draft", "personal", "Exemple · r2 (brouillon)"],
] as const)("nomme la révision courante %s pour une visibilité %s", async (state, visibility, label) => {
  const editor = mocks.editor.current;
  editor.document.theme = { theme_id: id, revision: 2 }; editor.document.visibility = visibility;
  editor.referenceStates = { [`theme:${id}:2`]: { state, current_revision: 3, approved_revision: state === "approved" ? 3 : 1, theme: { name: "Exemple" } } } as unknown as Editor["referenceStates"];
  if (visibility === "personal") mocks.themes.mockResolvedValue({ status: "ok", value: { themes: [{ ...item, owner: { issuer: "autre", subject: "autre" } }], unreadable: 0 } });
  render(<ChoixTheme />); expect(await screen.findByRole("option", { name: label })).toBeInTheDocument();
});
it.each([
  ["shared", 2, 3, 2, "Adopter r2", false],
  ["shared", 1, 3, 1, "Adopter r3", true],
  ["personal", 1, 3, 1, "Adopter r3", false],
] as const)("adoption %s, approuvée r%s et courante r%s", (visibility, approved, current, _expected, button, disabled) => {
  const editor = mocks.editor.current; editor.document.visibility = visibility;
  editor.document.layout.sections = [{ id: "s", rows: [{ id: "r", columns: [{ id: "c", span: 12, children: [{ id: "node", type: "component", component: { component_id: id, revision: 1 } }] }] }] }] as Editor["document"]["layout"]["sections"];
  editor.referenceStates = { [`component:${id}:1`]: { state: "approved", current_revision: current, approved_revision: approved } };
  render(<RevisionComposant id="node" />); const adopt = screen.getByRole("button", { name: button });
  if (disabled) { expect(adopt).toBeDisabled(); expect(screen.getByText(/est un brouillon/)).toBeInTheDocument(); }
  else { fireEvent.click(adopt); expect(run).toHaveBeenCalledWith({ type: "adopt_component_revision", id: "node", revision: visibility === "shared" ? approved : current }, expect.any(String)); }
});
it("n'appelle pas ancienne une dernière révision approuvée pendant l'absence de liste", () => {
  const editor = mocks.editor.current; editor.document.theme = { theme_id: id, revision: 2 };
  editor.referenceStates = { [`theme:${id}:2`]: { state: "approved", current_revision: 2, approved_revision: 2, theme: { name: "Exemple" } } } as unknown as Editor["referenceStates"];
  mocks.themes.mockReturnValue(new Promise(() => undefined)); render(<ChoixTheme />);
  expect(screen.getByRole("option", { name: "Exemple · r2 (approuvée)" })).toBeInTheDocument();
});
