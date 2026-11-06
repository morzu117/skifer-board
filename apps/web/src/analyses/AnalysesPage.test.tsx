import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import espace from "../../../../contracts/espaces/espace.json";
import { decodeSpace } from "../spaces/model";
import { expectAccessible } from "../test/a11y";
import { AnalysesPage } from "./AnalysesPage";
import { analysesServer, changed, ID, OTHER_ID, ROOT, route, type Exemple } from "./testing";

const space = decodeSpace(espace.body, "espace");
const listed = (body: unknown): Exemple => ({ status: 200, body });
const shared = route("lister");
const stale = route("lister-index-perime");
const item = (example: Exemple, index = 0) => (example.body as { analyses: unknown[] }).analyses[index];
const mine = { ...(item(shared) as object), id: OTHER_ID, name: "Mon suivi", is_owner: true, visibility: "personal" };
const both = listed({ analyses: [mine, item(shared)], unreadable: 0 });
const open = (routes: Parameters<typeof analysesServer>[0]) => render(<AnalysesPage space={space} fetcher={analysesServer(routes)} />);

it("annonce la lecture, puis sépare Mes analyses et Partagées avec toutes les colonnes", async () => {
  const { container } = open({ [`GET ${ROOT}`]: both });
  expect(screen.getByRole("status")).toHaveTextContent("Lecture des analyses…");
  await screen.findByRole("heading", { name: /Mes analyses · 1/ });
  expect(screen.getByRole("heading", { name: /Partagées · 1/ })).toBeInTheDocument();
  const own = within(screen.getByRole("table", { name: "Mes analyses" }));
  expect(own.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Nom", "Propriétaire", "Visibilité", "Révision", "Dernière modification", "Modèle", "État"]);
  const row = own.getByRole("row", { name: /Mon suivi/ });
  expect(within(row).getByRole("link", { name: "Mon suivi" })).toHaveAttribute("href", `#/espaces/finance/analyses/${OTHER_ID}`);
  expect(row).toHaveTextContent("Vous");
  expect(row).toHaveTextContent("Personnelle");
  expect(row).toHaveTextContent("r1");
  expect(row).toHaveTextContent("commit 01234567");
  expect(row).toHaveTextContent("sales");
  expect(row).toHaveTextContent("revenue");
  const others = within(screen.getByRole("table", { name: "Partagées" }));
  const shownRow = others.getByRole("row", { name: /Chiffre d'affaires/ });
  expect(shownRow).toHaveTextContent("cora");
  expect(shownRow).toHaveTextContent("https://id.example.invalid");
  expect(shownRow).toHaveTextContent("Partagée");
  expect(shownRow).toHaveTextContent("IndexéeL'index correspond au dépôt.");
  expect(within(shownRow).getByRole("link", { name: "Chiffre d'affaires" })).toHaveAttribute("href", `#/espaces/finance/analyses/${ID}`);
  expect(screen.getByText(/ne se lit que sur la fiche/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Nouvelle exploration" })).toHaveAttribute("href", "#/espaces/finance/explorer");
  await expectAccessible(container);
  await userEvent.click(screen.getByRole("button", { name: "Skifer ardoise" }));
  expect(container.firstElementChild).toHaveClass("sb-theme-skifer-ardoise");
  await expectAccessible(container);
});

it("dit qu'une section est vide au lieu de la masquer", async () => {
  open({ [`GET ${ROOT}`]: shared });
  await screen.findByRole("heading", { name: /Mes analyses · 0/ });
  expect(screen.getByText("Vous n'avez enregistré aucune analyse.")).toBeInTheDocument();
  expect(screen.queryByText("Personne d'autre n'a partagé d'analyse.")).not.toBeInTheDocument();
});

it("avec une analyse illisible, « Mes analyses » vide ne nie pas leur existence", async () => {
  open({ [`GET ${ROOT}`]: listed({ analyses: [item(shared)], unreadable: 1 }) });
  await screen.findByRole("heading", { name: /Mes analyses · 0/ });
  expect(screen.getByText(/Une de vos analyses n'a pas pu être relue/)).toBeInTheDocument();
  expect(screen.getByText(/Aucune de vos analyses ne peut être affichée/)).toBeInTheDocument();
  expect(screen.queryByText("Vous n'avez enregistré aucune analyse.")).not.toBeInTheDocument();
  expect(screen.getByRole("table", { name: "Partagées" })).toBeInTheDocument();
});

it("dit qu'il n'y a rien de partagé quand tout est à soi", async () => {
  open({ [`GET ${ROOT}`]: listed({ analyses: [mine], unreadable: 0 }) });
  await screen.findByRole("heading", { name: /Partagées · 0/ });
  expect(screen.getByText("Personne d'autre n'a partagé d'analyse.")).toBeInTheDocument();
});

it("montre l'état d'index en retard tel que le serveur le dit, avec sa raison", async () => {
  open({ [`GET ${ROOT}`]: stale });
  const row = await screen.findByRole("row", { name: /Écrite hors index/ });
  expect(row).toHaveTextContent("r2");
  expect(row).toHaveTextContent("Index en retard");
  expect(row).toHaveTextContent("cette ligne peut être périmée");
  expect(row).not.toHaveTextContent("Indexée");
});

it("une liste vide invite à ouvrir l'Explorateur, sans tableau", async () => {
  const { container } = open({ [`GET ${ROOT}`]: listed({ analyses: [], unreadable: 0 }) });
  await screen.findByText("Aucune analyse à afficher pour vous dans cet espace");
  expect(screen.getByText(/ne vous est visible : il n'y en a pas encore, ou aucune ne vous est ouverte/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ouvrir l'Explorateur" })).toHaveAttribute("href", "#/espaces/finance/explorer");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  await expectAccessible(container);
});

it("compte les analyses illisibles sans rien montrer à leur place", async () => {
  const one = open({ [`GET ${ROOT}`]: listed({ analyses: [item(shared)], unreadable: 1 }) });
  expect(await screen.findByText(/Une de vos analyses n'a pas pu être relue et n'est pas listée\. Rien n'est affiché à sa place\./)).toBeInTheDocument();
  one.unmount();
  open({ [`GET ${ROOT}`]: listed({ analyses: [], unreadable: 3 }) });
  expect(await screen.findByText(/3 de vos analyses n'ont pas pu être relues et ne sont pas listées\./)).toBeInTheDocument();
});

it("une liste vide avec des analyses illisibles ne dit pas qu'il n'y a aucune analyse", async () => {
  open({ [`GET ${ROOT}`]: listed({ analyses: [], unreadable: 2 }) });
  await screen.findByText(/2 de vos analyses n'ont pas pu être relues/);
  expect(screen.queryByText(/Aucune analyse/)).not.toBeInTheDocument();
  expect(screen.queryByText(/il n'y en a pas encore/)).not.toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /Mes analyses/ })).not.toBeInTheDocument();
});

it.each([
  ["refus-depot-indisponible", "Le dépôt des analyses est indisponible."],
  ["refus-interdit", "Votre rôle ne permet pas cette action."],
])("un refus (%s) s'affiche tel quel, sans liste", async (name, text) => {
  const { container } = open({ [`GET ${ROOT}`]: route(name) });
  const alert = await screen.findByText(text);
  expect(alert).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.queryByText(/Aucune analyse/)).not.toBeInTheDocument();
  await expectAccessible(container);
});

it("le mode local se dit sans alarme, et non comme une panne", async () => {
  const { container } = open({ [`GET ${ROOT}`]: route("refus-mode-local") });
  await screen.findByText("Les analyses ne sont pas disponibles en mode local.");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  await expectAccessible(container);
});

it("une panne de lecture s'affiche comme telle, sans liste", async () => {
  open({});
  await screen.findByText(/Analyses indisponibles/);
  expect(screen.getByText(/Rien n'est affiché\./)).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

it("Actualiser relit la liste", async () => {
  let second = false;
  const fetcher = analysesServer({ [`GET ${ROOT}`]: () => (second ? both : shared) });
  render(<AnalysesPage space={space} fetcher={fetcher} />);
  await screen.findByRole("heading", { name: /Mes analyses · 0/ });
  second = true;
  await userEvent.click(screen.getByRole("button", { name: "Actualiser" }));
  await screen.findByRole("heading", { name: /Mes analyses · 1/ });
  await waitFor(() => { expect(fetcher).toHaveBeenCalledTimes(2); });
});

it("n'affiche une valeur modifiée que si le contrat la porte : un état inconnu n'est pas une ligne", async () => {
  open({ [`GET ${ROOT}`]: listed(changed(shared.body, "analyses.0.state", "ready")) });
  await screen.findByText(/Analyses indisponibles/);
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});
