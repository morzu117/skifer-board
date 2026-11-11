import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";

import espace from "../../../../contracts/espaces/espace.json";
import { decodeSpace } from "../spaces/model";
import { expectAccessible } from "../test/a11y";
import { DashboardsPage } from "./DashboardsPage";
import { dashboardsServer, OTHER_ID, ROOT, route, type Exemple } from "./testing";

const space = decodeSpace(espace.body, "espace");
const listed = (body: unknown): Exemple => ({ status: 200, body });
const shared = route("lister");
const stale = route("lister-index-perime");
const item = (example: Exemple, index = 0) => (example.body as { dashboards: unknown[] }).dashboards[index];
const mine = { ...(item(shared) as object), id: OTHER_ID, name: "Mon suivi", is_owner: true, visibility: "personal" };
const both = listed({ dashboards: [mine, item(shared)], unreadable: 0 });
const open = (routes: Parameters<typeof dashboardsServer>[0]) => render(<DashboardsPage space={space} fetcher={dashboardsServer(routes)} />);

it("annonce la lecture, puis sépare Mes dashboards et Partagés avec toutes les colonnes", async () => {
  const { container } = open({ [`GET ${ROOT}`]: both });
  expect(screen.getByRole("status")).toHaveTextContent("Lecture des dashboards…");
  await screen.findByRole("heading", { name: /Mes dashboards · 1/ });
  expect(screen.getByRole("heading", { name: /Partagés · 1/ })).toBeInTheDocument();
  const own = within(screen.getByRole("table", { name: "Mes dashboards" }));
  expect(own.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Nom", "Propriétaire", "Visibilité", "Révision", "Dernière modification", "État"]);
  const row = own.getByRole("row", { name: /Mon suivi/ });
  expect(within(row).getByRole("link", { name: "Mon suivi" })).toHaveAttribute("href", `#/espaces/finance/dashboards/${OTHER_ID}`);
  expect(row).toHaveTextContent("Vous");
  expect(row).toHaveTextContent("Personnel");
  expect(row).toHaveTextContent("r1");
  expect(row).toHaveTextContent("commit 01234567");
  const others = within(screen.getByRole("table", { name: "Partagés" }));
  const shownRow = others.getByRole("row", { name: /Pilotage/ });
  expect(shownRow).toHaveTextContent("cora");
  expect(shownRow).toHaveTextContent("https://id.example.invalid");
  expect(shownRow).toHaveTextContent("Partagé");
  expect(shownRow).toHaveTextContent("IndexéL'index correspond au dépôt.");
  expect(within(shownRow).getByRole("link", { name: "Pilotage" })).toHaveAttribute("href", `#/espaces/finance/dashboards/${(item(shared) as { id: string }).id}`);
  expect(screen.getByText(/ne se lit qu'à l'ouverture/)).toBeInTheDocument();
  await expectAccessible(container);
  await userEvent.click(screen.getByRole("button", { name: "Skifer ardoise" }));
  expect(container.firstElementChild).toHaveClass("sb-theme-skifer-ardoise");
  await expectAccessible(container);
});

it("dit qu'une section est vide au lieu de la masquer", async () => {
  open({ [`GET ${ROOT}`]: shared });
  await screen.findByRole("heading", { name: /Mes dashboards · 0/ });
  expect(screen.getByText("Vous n'avez créé aucun dashboard.")).toBeInTheDocument();
  expect(screen.queryByText("Personne d'autre n'a partagé de dashboard.")).not.toBeInTheDocument();
});

it("avec un dashboard illisible, « Mes dashboards » vide ne nie pas leur existence", async () => {
  open({ [`GET ${ROOT}`]: listed({ dashboards: [item(shared)], unreadable: 1 }) });
  await screen.findByRole("heading", { name: /Mes dashboards · 0/ });
  expect(screen.getByText(/Un de vos dashboards n'a pas pu être relu/)).toBeInTheDocument();
  expect(screen.getByText(/Aucun de vos dashboards ne peut être affiché/)).toBeInTheDocument();
  expect(screen.queryByText("Vous n'avez créé aucun dashboard.")).not.toBeInTheDocument();
});

it("dit qu'il n'y a rien de partagé quand tout est à soi", async () => {
  open({ [`GET ${ROOT}`]: listed({ dashboards: [mine], unreadable: 0 }) });
  await screen.findByRole("heading", { name: /Partagés · 0/ });
  expect(screen.getByText("Personne d'autre n'a partagé de dashboard.")).toBeInTheDocument();
});

it("montre l'état d'index en retard tel que le serveur le dit, avec sa raison", async () => {
  open({ [`GET ${ROOT}`]: stale });
  const row = await screen.findByRole("row", { name: /Index en retard/ });
  expect(row).toHaveTextContent("cette ligne peut être périmée");
  expect(row).not.toHaveTextContent("IndexéL'index");
});

it("une liste vide invite à créer, sans tableau", async () => {
  const { container } = open({ [`GET ${ROOT}`]: listed({ dashboards: [], unreadable: 0 }) });
  await screen.findByText("Aucun dashboard à afficher pour vous dans cet espace");
  expect(screen.getByText(/ne vous est visible : il n'y en a pas encore, ou aucun ne vous est ouvert/)).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  await expectAccessible(container);
});

it("compte les dashboards illisibles sans rien montrer à leur place", async () => {
  const one = open({ [`GET ${ROOT}`]: listed({ dashboards: [item(shared)], unreadable: 1 }) });
  expect(await screen.findByText(/Un de vos dashboards n'a pas pu être relu et n'est pas listé\. Rien n'est affiché à sa place\./)).toBeInTheDocument();
  one.unmount();
  open({ [`GET ${ROOT}`]: listed({ dashboards: [], unreadable: 3 }) });
  expect(await screen.findByText(/3 de vos dashboards n'ont pas pu être relus et ne sont pas listés\./)).toBeInTheDocument();
});

it("une liste vide avec des dashboards illisibles ne dit pas qu'il n'y a aucun dashboard", async () => {
  open({ [`GET ${ROOT}`]: listed({ dashboards: [], unreadable: 2 }) });
  await screen.findByText(/2 de vos dashboards n'ont pas pu être relus/);
  expect(screen.queryByText(/Aucun dashboard à afficher/)).not.toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /Mes dashboards/ })).not.toBeInTheDocument();
});

it.each([
  ["refus-depot-indisponible", "dépôt"],
  ["refus-interdit", "Votre rôle ne permet pas cette action."],
])("un refus (%s) s'affiche tel quel, sans liste", async (name, text) => {
  const { container } = open({ [`GET ${ROOT}`]: route(name) });
  expect(await screen.findByText(new RegExp(text))).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.queryByText(/Aucun dashboard à afficher/)).not.toBeInTheDocument();
  await expectAccessible(container);
});

it("le mode local se dit sans alarme, et non comme une panne", async () => {
  const { container } = open({ [`GET ${ROOT}`]: route("refus-mode-local") });
  await screen.findByText("Les dashboards ne sont pas disponibles en mode local.");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  await expectAccessible(container);
});

it("une panne de lecture s'affiche comme telle, sans liste", async () => {
  open({});
  await screen.findByText(/Dashboards indisponibles/);
  expect(screen.getByText(/Rien n'est affiché\./)).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

it("Actualiser relit la liste", async () => {
  let second = false;
  const fetcher = dashboardsServer({ [`GET ${ROOT}`]: () => (second ? both : shared) });
  render(<DashboardsPage space={space} fetcher={fetcher} />);
  await screen.findByRole("heading", { name: /Mes dashboards · 0/ });
  second = true;
  await userEvent.click(screen.getByRole("button", { name: "Actualiser" }));
  await screen.findByRole("heading", { name: /Mes dashboards · 1/ });
  await waitFor(() => { expect(fetcher).toHaveBeenCalledTimes(2); });
});

it("« Nouveau dashboard » ouvre le dialogue de création et le referme sans rien créer", async () => {
  const fetcher = dashboardsServer({ [`GET ${ROOT}`]: shared });
  render(<DashboardsPage space={space} fetcher={fetcher} />);
  await screen.findByRole("heading", { name: /Mes dashboards/ });
  const opener = screen.getByRole("button", { name: "Nouveau dashboard" });
  await userEvent.click(opener);
  expect(screen.getByRole("dialog", { name: "Nouveau dashboard" })).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
