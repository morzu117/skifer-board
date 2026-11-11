import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { Fetch } from "../spaces/api";
import { expectAccessible } from "../test/a11y";
import changes from "./ecart-reel.json";
import { DashboardDiffView, HistoriqueDashboard } from "./Historique";
import { ID, ROOT, dashboardsServer, route } from "./testing";

const historyUrl = `${ROOT}/${ID}/revisions`;
const diffUrl = `${ROOT}/${ID}/diff?base=1&other=2`;
const history = () => route("historique");
const data = () => ({ status: 200, body: { id: ID, base: 1, other: 2, changes } });

it("liste les révisions lisibles et masquées, puis affiche l'écart du serveur nœud par nœud", async () => {
  const original = history().body as { revisions: Record<string, unknown>[] } & Record<string, unknown>;
  const masked = { ...original, revisions: [{ revision: 1, available: false }, original.revisions[1]] };
  const first = dashboardsServer({ [`GET ${historyUrl}`]: { status: 200, body: masked } });
  const { unmount } = render(<HistoriqueDashboard space="finance" id={ID} fetcher={first} />);
  expect((await screen.findByText(/révision non disponible/)).closest("li")).toHaveTextContent("r1 · révision non disponible");
  expect(screen.queryByRole("link", { name: "Lire la révision 1" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Lire la révision 2" })).toHaveAttribute("href", `#/espaces/finance/dashboards/${ID}/revisions/2`);
  unmount();
  const server = dashboardsServer({ [`GET ${historyUrl}`]: history(), [`GET ${diffUrl}`]: data() });
  const view = render(<HistoriqueDashboard space="finance" id={ID} fetcher={server} />);
  await screen.findByRole("button", { name: "Comparer" });
  await userEvent.click(screen.getByRole("button", { name: "Comparer" }));
  const table = await screen.findByRole("table", { name: "Écart entre r1 et r2" });
  for (const nature of ["Ajouté", "Retiré", "Modifié", "Déplacé"]) expect(within(table).getAllByText(nature).length).toBeGreaterThan(0);
  expect(within(table).getByText("/name")).toBeInTheDocument();
  expect(server.mock.calls.filter(([url]) => url === diffUrl)).toHaveLength(1);
  await expectAccessible(view.container);
});

it("une adresse de comparaison lisible lance directement l'écart", async () => {
  const server = dashboardsServer({ [`GET ${historyUrl}`]: history(), [`GET ${diffUrl}`]: data() });
  render(<HistoriqueDashboard space="finance" id={ID} compare={{ base: 1, other: 2 }} fetcher={server} />);
  await screen.findByRole("table", { name: "Écart entre r1 et r2" });
  expect(server.mock.calls.filter(([url]) => url === diffUrl)).toHaveLength(1);
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Révision de base" }), "2");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Révision comparée" }), "1");
});

it("ne compare pas une révision masquée et annonce le motif", async () => {
  const original = history().body as { revisions: Record<string, unknown>[] } & Record<string, unknown>;
  const server = dashboardsServer({ [`GET ${historyUrl}`]: { status: 200, body: { ...original, revisions: [{ revision: 1, available: false }, original.revisions[1]] } } });
  render(<HistoriqueDashboard space="finance" id={ID} compare={{ base: 1, other: 2 }} fetcher={server} />);
  expect(await screen.findByText(/La comparaison demandée n'est pas disponible/)).toBeInTheDocument();
  expect(server.mock.calls.some(([url]) => url.includes("/diff?"))).toBe(false);
});

it("annonce le refus d'historique et n'appelle rien pour un identifiant invalide", async () => {
  const server = vi.fn<Fetch>();
  render(<HistoriqueDashboard space="finance" id="invalide" fetcher={server} />);
  expect(await screen.findByText(/Historique indisponible/)).toBeInTheDocument();
  expect(server).not.toHaveBeenCalled();
});

it.each(["error", "empty"] as const)("rend l'écart %s", async (mode) => {
  const server = dashboardsServer({ [`GET ${diffUrl}`]: mode === "empty" ? { status: 200, body: { id: ID, base: 1, other: 2, changes: [] } } : { status: 500, body: {} } });
  render(<DashboardDiffView space="finance" id={ID} base={1} other={2} fetcher={server} />);
  expect(await screen.findByText(mode === "empty" ? "Aucune différence structurelle." : /Écart indisponible/)).toBeInTheDocument();
});

it("indique qu'une seule révision lisible ne permet pas une comparaison libre", async () => {
  const original = history().body as { revisions: Record<string, unknown>[] } & Record<string, unknown>;
  const server = dashboardsServer({ [`GET ${historyUrl}`]: { status: 200, body: { ...original, revisions: [{ revision: 1, available: false }, original.revisions[1]] } } });
  render(<HistoriqueDashboard space="finance" id={ID} fetcher={server} />);
  await waitFor(() => { expect(screen.getByText("Il faut deux révisions disponibles pour en comparer.")).toBeInTheDocument(); });
});

it("affiche la suppression sans proposer de lire une révision de suppression", async () => {
  const server = dashboardsServer({ [`GET ${historyUrl}`]: route("historique-supprime") });
  render(<HistoriqueDashboard space="finance" id={ID} fetcher={server} />);
  const entries = await screen.findAllByRole("listitem");
  expect(entries.at(-1)).not.toHaveTextContent("Lire la révision");
  expect(entries.at(-1)).toHaveTextContent(/suppression/i);
});
