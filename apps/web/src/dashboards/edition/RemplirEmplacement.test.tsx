import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { Editor } from "./EditorContext";
import { RemplirEmplacement } from "./RemplirEmplacement";

const mocks = vi.hoisted(() => ({ editor: {} as Editor, list: vi.fn(), read: vi.fn(), run: vi.fn() }));
vi.mock("./EditorContext", () => ({ useEditor: () => mocks.editor }));
vi.mock("../../components-lib/client", () => ({ fetchComponents: mocks.list, fetchComponentRevision: mocks.read }));
vi.mock("./AjouterAnalyse", () => ({ AjouterAnalyse: ({ onClose }: { onClose: () => void }) => <button onClick={onClose}>Fermer analyses</button> }));
const item = { id: "id", name: "Ventes", owner: { issuer: "i", subject: "s" }, revision: 1, state: "approved", approvedRevision: 1 };
beforeEach(() => {
  mocks.run.mockReset().mockReturnValue(true);
  mocks.editor = { space: "finance", identity: "i", document: { visibility: "shared" }, readOnly: false, contentSave: { fetcher: vi.fn() }, run: mocks.run } as unknown as Editor;
  mocks.list.mockReset().mockResolvedValue({ status: "ok", value: { components: [item], unreadable: 0 } });
  mocks.read.mockReset().mockResolvedValue({ status: "ok", value: { component: { id: "id", kind: "visual" } } });
});
it("propose une analyse et ferme son dialogue", () => {
  render(<RemplirEmplacement id="slot" label="Ventes" expected="visual" />); fireEvent.click(screen.getByRole("button", { name: "Remplir l'emplacement Ventes" }));
  fireEvent.click(screen.getByRole("button", { name: "Choisir une analyse" })); fireEvent.click(screen.getByRole("button", { name: "Fermer analyses" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("remplit avec le composant résolu et ferme uniquement après succès", async () => {
  mocks.run.mockReturnValueOnce(false).mockReturnValueOnce(true);
  render(<RemplirEmplacement id="slot" label="Ventes" expected="visual" />); fireEvent.click(screen.getByRole("button", { name: "Remplir l'emplacement Ventes" }));
  const choice = await screen.findByRole("button", { name: "Ventes · r1" }); fireEvent.click(choice);
  expect(mocks.run.mock.calls[0]?.[0]).toMatchObject({ type: "fill_slot", id: "slot", value: { source: "component", kind: "visual", component: { component_id: "id", revision: 1 } } });
  expect(screen.getByRole("dialog")).toBeInTheDocument(); fireEvent.click(choice); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("ne propose pas un composant de mauvais genre", async () => {
  render(<RemplirEmplacement id="slot" label="Ventes" expected="kpi" />); fireEvent.click(screen.getByRole("button", { name: "Remplir l'emplacement Ventes" }));
  expect(await screen.findByText("Aucun composant compatible disponible.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Ventes · r1" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
});
it.each([{ status: "error", message: "panne" }, { status: "refused", code: "forbidden" }])("rend l'échec de liste $status", async (failure) => {
  mocks.list.mockResolvedValue(failure); render(<RemplirEmplacement id="slot" label="Ventes" expected="visual" />); fireEvent.click(screen.getByRole("button", { name: "Remplir l'emplacement Ventes" }));
  expect(screen.getByText("Lecture des composants…")).toBeInTheDocument(); expect(await screen.findByText(/Composants indisponibles/)).toBeInTheDocument();
});
it.each([{ status: "error", message: "panne" }, { status: "refused", code: "forbidden" }])("rend l'échec de lecture $status", async (failure) => {
  mocks.list.mockResolvedValue({ status: "ok", value: { components: [item], unreadable: 1 } }); mocks.read.mockResolvedValue(failure);
  render(<RemplirEmplacement id="slot" label="Ventes" expected="visual" />); fireEvent.click(screen.getByRole("button", { name: "Remplir l'emplacement Ventes" }));
  expect(await screen.findByText(/Ventes · r1 :/)).toBeInTheDocument(); expect(screen.getByText("Certains composants sont illisibles.")).toBeInTheDocument();
});
it("interdit l'action en lecture seule", () => {
  mocks.editor.readOnly = true; render(<RemplirEmplacement id="slot" label="Ventes" expected="kpi" />); expect(screen.getByRole("button", { name: "Remplir l'emplacement Ventes" })).toBeDisabled();
});

it("propose le brouillon de l'auteur et ferme avec Échap", async () => {
  mocks.editor.document.visibility = "personal"; mocks.editor.identity = JSON.stringify(["i", "s"]);
  mocks.list.mockResolvedValue({ status: "ok", value: { components: [{ ...item, state: "draft", approvedRevision: null }], unreadable: 0 } });
  render(<RemplirEmplacement id="slot" label="Ventes" expected="visual" />); fireEvent.click(screen.getByRole("button", { name: "Remplir l'emplacement Ventes" }));
  expect(await screen.findByRole("button", { name: "Ventes · r1 · brouillon" })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
