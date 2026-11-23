import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { navigate } from "../../shell/route";
import { SKIFER_CLAIR } from "../../charts/theme";
import * as client from "../client";
import { decodeDashboardDraft } from "../document";
import { decodeDashboardRevision } from "../model";
import { Editeur } from "./Editeur";
import { dashboardBody, editorServer } from "./testing";

const draft = () => decodeDashboardDraft({ name: "Local", description: "", visibility: "personal", defaults: {}, filters: [], layout: { sections: [] } });
function open() {
  const onCreated = vi.fn(), onLeaveLocal = vi.fn();
  const server = editorServer();
  const view = render(<Editeur space="finance" identity="cora" localDraft={draft()} onCreated={onCreated} onLeaveLocal={onLeaveLocal} environment="DEV" fetcher={server.fetcher} theme={SKIFER_CLAIR} onTheme={vi.fn()} poll={1} />);
  return { ...view, onCreated, onLeaveLocal };
}
afterEach(() => { vi.restoreAllMocks(); window.location.hash = ""; });
it("garde le brouillon local et permet de quitter après confirmation", () => {
  const { onLeaveLocal } = open();
  expect(screen.getAllByText("Brouillon local, jamais enregistré").length).toBeGreaterThan(0);
  expect(screen.queryByRole("link", { name: "Historique des révisions" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retour aux dashboards" }));
  fireEvent.click(screen.getByRole("button", { name: "Rester" })); expect(onLeaveLocal).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retour aux dashboards" })); fireEvent.click(screen.getByRole("button", { name: "Quitter sans enregistrer" })); expect(onLeaveLocal).toHaveBeenCalled();
});
it("crée le dashboard au premier enregistrement", async () => {
  const revision = decodeDashboardRevision(dashboardBody(draft(), { tiles: [] }), "finance");
  vi.spyOn(client, "createDashboard").mockResolvedValue({ status: "ok", value: revision });
  const { onCreated } = open(); fireEvent.click(screen.getByRole("button", { name: /^Enregistrer$/ }));
  await waitFor(() => { expect(onCreated).toHaveBeenCalledWith(revision.id); });
});
it.each([{ status: "refused", code: "forbidden", field: null }, { status: "error", message: "panne" }] as const)("rend le refus ou l'erreur de création : $status", async (failure) => {
  vi.spyOn(client, "createDashboard").mockResolvedValue(failure); const { onCreated } = open(); fireEvent.click(screen.getByRole("button", { name: /^Enregistrer$/ }));
  expect(await screen.findByRole("alert")).toBeInTheDocument(); expect(onCreated).not.toHaveBeenCalled();
});
it("ne recrée pas un dashboard dont le serveur a changé le contenu", async () => {
  const different = decodeDashboardDraft({ ...draft(), name: "Autre" });
  vi.spyOn(client, "createDashboard").mockResolvedValue({ status: "ok", value: decodeDashboardRevision(dashboardBody(different, { tiles: [] }), "finance") });
  const { onCreated } = open(); fireEvent.click(screen.getByRole("button", { name: /^Enregistrer$/ }));
  expect(await screen.findByText(/contenu diffère du brouillon/)).toBeInTheDocument(); expect(screen.getByRole("button", { name: /^Enregistrer$/ })).toBeDisabled(); expect(onCreated).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retour aux dashboards" }));
  expect(screen.getByText(/dashboard a été créé sur le serveur/)).toBeInTheDocument();
});
it("ignore la réponse après démontage", async () => {
  let release: (value: Awaited<ReturnType<typeof client.createDashboard>>) => void = () => undefined;
  vi.spyOn(client, "createDashboard").mockReturnValue(new Promise((resolve) => { release = resolve; }));
  const { unmount, onCreated } = open(); fireEvent.click(screen.getByRole("button", { name: /^Enregistrer$/ })); unmount();
  release({ status: "ok", value: decodeDashboardRevision(dashboardBody(draft(), { tiles: [] }), "finance") });
  await Promise.resolve(); expect(onCreated).not.toHaveBeenCalled();
});

it("retourne à la liste depuis la navigation du même emplacement", () => {
  window.location.hash = "#/espaces/finance/dashboards"; const { onLeaveLocal } = open();
  act(() => { navigate({ page: "dashboards", space: "finance" }); });
  fireEvent.click(screen.getByRole("button", { name: "Quitter sans enregistrer" })); expect(onLeaveLocal).toHaveBeenCalled();
});
it("conserve l'historique pendant la première création", () => {
  vi.spyOn(client, "createDashboard").mockReturnValue(new Promise(() => undefined)); open();
  fireEvent.click(screen.getByRole("button", { name: "Ajouter une section" })); fireEvent.click(screen.getByRole("button", { name: /^Enregistrer$/ }));
  fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
  fireEvent.keyDown(screen.getByRole("button", { name: "Annuler" }), { key: "z", ctrlKey: true, shiftKey: true });
  expect(screen.getByRole("button", { name: "Section 1" })).toBeInTheDocument();
});
it("montre la référence du modèle dans l'en-tête du brouillon", () => {
  const localDraft = decodeDashboardDraft({ ...draft(), template: { template_id: "00000000-0000-4000-8000-000000000050", revision: 2 } });
  render(<Editeur space="finance" identity="cora" localDraft={localDraft} onCreated={vi.fn()} onLeaveLocal={vi.fn()} environment="DEV" fetcher={editorServer().fetcher} theme={SKIFER_CLAIR} onTheme={vi.fn()} poll={1} />);
  expect(screen.getByText(/Issu du modèle/)).toHaveTextContent("00000000-0000-4000-8000-000000000050 · r2");
});
it("interdit de quitter pendant la création en cours", () => {
  vi.spyOn(client, "createDashboard").mockReturnValue(new Promise(() => undefined));
  open(); fireEvent.click(screen.getByRole("button", { name: /^Enregistrer$/ }));
  fireEvent.click(screen.getByRole("button", { name: "Retour aux dashboards" }));
  expect(screen.getByText(/création est en cours/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Quitter sans enregistrer" })).toBeDisabled();
});
