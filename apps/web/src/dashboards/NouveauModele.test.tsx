import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { NouveauDashboard } from "./NouveauDashboard";
import { sampleDraft } from "./edition/testing";
import type { Selection } from "./ChoixNouveau";

const mocks = vi.hoisted(() => ({ read: vi.fn(), instantiate: vi.fn(), create: vi.fn() }));
vi.mock("../page-templates/client", () => ({ fetchPageTemplateRevision: mocks.read }));
vi.mock("./edition/template", () => ({ instantiateTemplate: mocks.instantiate }));
vi.mock("./client", () => ({ createDashboard: mocks.create }));
vi.mock("./ChoixNouveau", () => ({ ChoixNouveau: ({ kind, onChange }: { kind: string; onChange: (value: Selection | null) => void }) => <button type="button" onClick={() => { onChange({ id: kind, name: kind, revision: 1, draft: kind === "modele" }); }}>Choisir {kind}</button> }));
const fetcher = vi.fn(), onLocal = vi.fn(), close = vi.fn();
beforeEach(() => { mocks.read.mockReset(); mocks.instantiate.mockReset().mockReturnValue(sampleDraft()); mocks.create.mockReset(); onLocal.mockClear(); close.mockClear(); });
function open() { render(<NouveauDashboard space="finance" fetcher={fetcher} identity="cora" onLocal={onLocal} onClose={close} />); fireEvent.change(screen.getByRole("textbox", { name: "Nom du dashboard" }), { target: { value: "Pilotage" } }); }
it("instancie localement un modèle et son thème", async () => {
  mocks.read.mockResolvedValue({ status: "ok", value: { revision: 1 } }); open();
  fireEvent.click(screen.getByRole("button", { name: "Choisir modele" })); fireEvent.click(screen.getByRole("button", { name: "Choisir theme" }));
  expect(screen.getByText("Le dashboard sera créé au premier enregistrement, une fois les emplacements remplis.")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "Description choisie" } });
  fireEvent.click(screen.getByRole("button", { name: "Ouvrir le brouillon" }));
  await waitFor(() => { expect(onLocal).toHaveBeenCalled(); });
  expect(mocks.instantiate.mock.calls[0]?.[1]).toEqual({ name: "Pilotage", visibility: "personal", theme: { theme_id: "theme", revision: 1 } });
  expect(onLocal.mock.calls[0]?.[0]).toMatchObject({ description: "Description choisie" }); expect(mocks.create).not.toHaveBeenCalled();
});
it("bloque un brouillon après passage en partagé", () => {
  open(); fireEvent.click(screen.getByRole("button", { name: "Choisir modele" })); fireEvent.click(screen.getByRole("radio", { name: "Partagé" }));
  expect(screen.getByRole("button", { name: "Ouvrir le brouillon" })).toBeDisabled();
});
it.each([{ status: "error", message: "panne" }, { status: "refused", code: "forbidden" }])("affiche le refus du modèle : $status", async (failure) => {
  mocks.read.mockResolvedValue(failure); open(); fireEvent.click(screen.getByRole("button", { name: "Choisir modele" })); fireEvent.click(screen.getByRole("button", { name: "Ouvrir le brouillon" }));
  expect(await screen.findByRole("alert")).toBeInTheDocument(); expect(onLocal).not.toHaveBeenCalled();
});
it("ignore la lecture d'un modèle après fermeture", async () => {
  let release: (value: unknown) => void = () => undefined; mocks.read.mockReturnValue(new Promise((resolve) => { release = resolve; }));
  open(); fireEvent.click(screen.getByRole("button", { name: "Choisir modele" })); fireEvent.click(screen.getByRole("button", { name: "Ouvrir le brouillon" }));
  expect(screen.getByRole("button", { name: "Lecture du modèle…" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Annuler" })); release({ status: "ok", value: { revision: 1 } });
  await waitFor(() => { expect(close).toHaveBeenCalled(); }); expect(onLocal).not.toHaveBeenCalled();
});

it("ouvre un modèle sans thème", async () => {
  mocks.read.mockResolvedValue({ status: "ok", value: { revision: 1 } }); open(); fireEvent.click(screen.getByRole("button", { name: "Choisir modele" })); fireEvent.click(screen.getByRole("button", { name: "Ouvrir le brouillon" }));
  await waitFor(() => { expect(onLocal).toHaveBeenCalled(); }); expect(mocks.instantiate.mock.calls[0]?.[1]).toEqual({ name: "Pilotage", visibility: "personal" });
});
it("crée un dashboard vide avec un thème", async () => {
  mocks.create.mockResolvedValue({ status: "error", message: "panne" }); open(); fireEvent.click(screen.getByRole("button", { name: "Choisir theme" })); fireEvent.click(screen.getByRole("button", { name: "Créer et ouvrir" }));
  await screen.findByRole("alert"); expect(mocks.create.mock.calls[0]?.[1]).toMatchObject({ theme: { theme_id: "theme", revision: 1 } });
});
