import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ChoixNouveau, type Selection } from "./ChoixNouveau";

const mocks = vi.hoisted(() => ({ themes: vi.fn(), models: vi.fn() }));
vi.mock("../themes/client", () => ({ fetchThemes: mocks.themes }));
vi.mock("../page-templates/client", () => ({ fetchPageTemplates: mocks.models }));
const owner = { issuer: "issuer", subject: "personne" };
const item = { id: "id", name: "Exemple", owner, state: "draft", revision: 2, approvedRevision: 1 };
const identity = JSON.stringify([owner.issuer, owner.subject]);
const fetcher = vi.fn(), change = vi.fn();
function open(kind: "theme" | "modele", visibility: "personal" | "shared" = "personal", value: Selection | null = null) {
  return render(<ChoixNouveau kind={kind} space="finance" identity={identity} visibility={visibility} fetcher={fetcher} value={value} onChange={change} />);
}
beforeEach(() => {
  change.mockClear(); mocks.themes.mockReset().mockResolvedValue({ status: "ok", value: { themes: [item], unreadable: 0 } });
  mocks.models.mockReset().mockResolvedValue({ status: "ok", value: { pageTemplates: [item], unreadable: 0 } });
});
it.each(["theme", "modele"] as const)("charge %s au focus et choisit une révision", async (kind) => {
  open(kind); const select = screen.getByRole("combobox");
  fireEvent.focus(select); expect(screen.getByText(/Lecture/)).toBeInTheDocument();
  expect(await screen.findByRole("option", { name: "Exemple · r2 · brouillon" })).toBeInTheDocument();
  fireEvent.change(select, { target: { value: "id:2" } }); expect(change).toHaveBeenCalledWith({ id: "id", name: "Exemple", revision: 2, draft: true });
  fireEvent.change(select, { target: { value: "" } }); expect(change).toHaveBeenLastCalledWith(null);
});
it("garde et signale un brouillon devenu interdit", () => {
  open("modele", "shared", { id: "id", name: "Exemple", revision: 2, draft: true });
  expect(screen.getByRole("combobox")).toHaveValue("id:2"); expect(screen.getByRole("alert")).toHaveTextContent("brouillon");
});
it.each([{ status: "error", message: "panne" }, { status: "refused", code: "forbidden" }])("affiche l'échec $status sans bloquer le choix vide", async (outcome) => {
  mocks.themes.mockResolvedValue(outcome); open("theme"); fireEvent.focus(screen.getByRole("combobox"));
  expect(await screen.findByText(/Thèmes indisponibles/)).toBeInTheDocument(); expect(screen.getByRole("combobox")).toHaveValue("");
});
it("annonce les contenus illisibles et annule la lecture abandonnée", async () => {
  mocks.models.mockResolvedValue({ status: "ok", value: { pageTemplates: [], unreadable: 1 } });
  const view = open("modele"); fireEvent.focus(screen.getByRole("combobox")); expect(await screen.findByText("Certains contenus sont illisibles.")).toBeInTheDocument(); view.unmount();
});
it("retrouve le choix chargé et ignore une réponse après démontage", async () => {
  const view = open("theme", "personal", { id: "id", name: "Exemple", revision: 1, draft: false });
  fireEvent.focus(screen.getByRole("combobox")); await screen.findByRole("option", { name: "Exemple · r2 · brouillon" }); expect(screen.getByRole("option", { name: "Exemple · r1" })).toBeInTheDocument();
  fireEvent.focus(screen.getByRole("combobox")); view.unmount();
  let release: (value: unknown) => void = () => undefined;
  mocks.models.mockReturnValue(new Promise((resolve) => { release = resolve; }));
  const abandoned = open("modele"); fireEvent.focus(screen.getByRole("combobox")); abandoned.unmount(); release({ status: "ok", value: { pageTemplates: [], unreadable: 0 } });
});
it("nomme une erreur de modèles", async () => {
  mocks.models.mockResolvedValue({ status: "error", message: "panne" }); open("modele"); fireEvent.focus(screen.getByRole("combobox"));
  expect(await screen.findByText(/Modèles indisponibles : panne/)).toBeInTheDocument();
});
it("propose de relire après une erreur", async () => {
  mocks.themes.mockResolvedValueOnce({ status: "error", message: "panne" }).mockResolvedValueOnce({ status: "ok", value: { themes: [item], unreadable: 0 } });
  open("theme"); fireEvent.focus(screen.getByRole("combobox"));
  fireEvent.click(await screen.findByRole("button", { name: "Réessayer" }));
  expect(await screen.findByRole("option", { name: "Exemple · r1" })).toBeInTheDocument(); expect(mocks.themes).toHaveBeenCalledTimes(2);
});
it("nomme une ancienne approbation conservée", async () => {
  open("theme", "shared", { id: "id", name: "Exemple", revision: 1, draft: false });
  mocks.themes.mockResolvedValue({ status: "ok", value: { themes: [{ ...item, approvedRevision: 2, state: "approved" }], unreadable: 0 } });
  fireEvent.focus(screen.getByRole("combobox"));
  expect(await screen.findByRole("option", { name: "Exemple · r1 (ancienne révision approuvée)" })).toBeInTheDocument();
});
it("conserve le nom d'un brouillon personnel absent de la liste", () => {
  open("theme", "personal", { id: "id", name: "Exemple", revision: 2, draft: true });
  expect(screen.getByRole("option", { name: "Exemple · r2 (brouillon)" })).toBeInTheDocument();
});
