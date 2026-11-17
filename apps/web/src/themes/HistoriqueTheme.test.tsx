import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import historique from "../../../../contracts/themes/routes/historique.json";
import interdit from "../../../../contracts/themes/routes/refus-interdit.json";
import type { Fetch } from "../spaces/api";
import { HistoriqueTheme } from "./HistoriqueTheme";

const id = "00000000-0000-4000-8000-000000000001";
const body = JSON.parse(JSON.stringify(historique.body).replaceAll("<uuid>", id).replaceAll("<commit>", "a".repeat(40))) as unknown;
it("lit et relie les révisions disponibles", async () => {
  render(<HistoriqueTheme space="finance" id={id} fetcher={vi.fn<Fetch>().mockResolvedValue(Response.json(body))} />);
  expect(screen.getByRole("status")).toHaveTextContent("Lecture de l'historique");
  expect(await screen.findByRole("link", { name: "Lire la révision 1" })).toHaveAttribute("href", `#/espaces/finance/themes/${id}/revisions/1`);
  expect(screen.getByRole("list", { name: "Historique des révisions" })).toHaveTextContent("cora");
});
it("rend le refus et les erreurs de lecture", async () => {
  const view = render(<HistoriqueTheme space="finance" id={id} fetcher={vi.fn<Fetch>().mockResolvedValue(Response.json(interdit.body, { status: 403 }))} />);
  expect(await screen.findByText(/Historique indisponible : Accès refusé/)).toBeInTheDocument();
  view.unmount();
  render(<HistoriqueTheme space="finance" id={id} fetcher={vi.fn<Fetch>().mockRejectedValue(new Error("panne"))} />);
  expect(await screen.findByText(/Historique indisponible : Le serveur Board ne répond pas/)).toBeInTheDocument();
});
it("rend illisible un historique sans révision", async () => {
  render(<HistoriqueTheme space="finance" id={id} fetcher={vi.fn<Fetch>().mockResolvedValue(Response.json({ id, current_revision: null, deleted: false, revisions: [] }))} />);
  expect(await screen.findByText(/Historique indisponible.*hors contrat/)).toBeInTheDocument();
});
it("ne propose pas la lecture d'une suppression", async () => {
  const deleted = structuredClone(body) as { deleted: boolean; current_revision: number | null; revisions: Record<string, unknown>[] };
  deleted.deleted = true; deleted.current_revision = null;
  deleted.revisions.push({ ...deleted.revisions[1], action: "delete" });
  render(<HistoriqueTheme space="finance" id={id} fetcher={vi.fn<Fetch>().mockResolvedValue(Response.json(deleted))} />);
  expect(await screen.findByText(/Suppression/)).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: /Lire la révision/ })).toHaveLength(2);
});
