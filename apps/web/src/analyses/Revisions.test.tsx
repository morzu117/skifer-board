import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { expectAccessible } from "../test/a11y";
import { analysesServer, COMMIT, ID, ROOT, route } from "./testing";
import { OngletRevisions } from "./Revisions";

const HISTORY = `GET ${ROOT}/${ID}/revisions`;
const DIFF = (base: number, other: number) => `GET ${ROOT}/${ID}/diff?base=${String(base)}&other=${String(other)}`;
const open = (routes: Parameters<typeof analysesServer>[0], compare?: { base: number; other: number }) => {
  const fetcher = analysesServer(routes);
  return { fetcher, ...render(<OngletRevisions space="finance" id={ID} compare={compare} fetcher={fetcher} />) };
};

it("liste l'historique avec action, auteur, instant et commit, et un lien vers chaque sauvegarde", async () => {
  const { container } = open({ [HISTORY]: route("historique") });
  expect(screen.getByRole("status")).toHaveTextContent("Lecture de l'historique…");
  const items = await screen.findAllByRole("listitem");
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent("r1 · Sauvegarde · cora (https://id.example.invalid)");
  expect(items[0]).toHaveTextContent(`commit ${COMMIT.slice(0, 12)}`);
  expect(items[1]).toHaveTextContent("r2 · Sauvegarde · ada");
  expect(within(items[0] as HTMLElement).getByRole("link", { name: "Lire la révision 1" })).toHaveAttribute("href", `#/espaces/finance/analyses/${ID}/revisions/1`);
  expect(screen.getByRole("list", { name: "Historique des révisions" })).toBeInTheDocument();
  await expectAccessible(container);
});

it("une révision masquée n'a que son numéro et « révision non disponible » : ni auteur, ni commit, ni lien", async () => {
  open({ [HISTORY]: route("historique-revision-masquee") });
  const items = await screen.findAllByRole("listitem");
  expect(items[0]?.textContent).toBe("r1 · révision non disponible");
  expect(within(items[0] as HTMLElement).queryByRole("link")).not.toBeInTheDocument();
  expect(items[1]).toHaveTextContent("r2 · Sauvegarde · cora");
  expect(screen.getByText(/Il faut deux révisions disponibles pour en comparer/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Comparer" })).not.toBeInTheDocument();
});

it("une analyse supprimée garde son historique : la suppression se lit sans lien et son numéro n'est proposé qu'une fois", async () => {
  open({ [HISTORY]: route("historique-supprimee") });
  const items = await screen.findAllByRole("listitem");
  expect(items).toHaveLength(3);
  expect(items[2]).toHaveTextContent("r2 · Suppression · cora");
  expect(within(items[2] as HTMLElement).queryByRole("link")).not.toBeInTheDocument();
  expect(within(items[1] as HTMLElement).getByRole("link", { name: "Lire la révision 2" })).toBeInTheDocument();
  const base = screen.getByLabelText("Révision de base");
  expect(within(base).getAllByRole("option").map((option) => option.textContent)).toEqual(["r1", "r2"]);
});

it("compare deux révisions lisibles : écart structurel avec avant et après", async () => {
  const diff = { status: 200, body: { id: ID, base: 1, other: 2, changes: [
    { path: "/name", kind: "modified", before: "Chiffre d'affaires", after: "Révisée" },
    { path: "/query/dimensions/1", kind: "added", before: null, after: "pays" },
    { path: "/query/filters/0", kind: "removed", before: { column: "region", operator: "eq", value: "Nord" }, after: null },
  ] } };
  const { container, fetcher } = open({ [HISTORY]: route("historique"), [DIFF(1, 2)]: diff });
  await screen.findByRole("button", { name: "Comparer" });
  expect(screen.getByLabelText("Révision de base")).toHaveValue("1");
  expect(screen.getByLabelText("Révision comparée")).toHaveValue("2");
  await userEvent.click(screen.getByRole("button", { name: "Comparer" }));
  const table = await screen.findByRole("table", { name: "Écart entre r1 et r2" });
  expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Chemin", "Nature", "Avant (r1)", "Après (r2)"]);
  const rows = within(table).getAllByRole("row").slice(1).map((row) => [...row.querySelectorAll("th, td")].map((cell) => cell.textContent));
  expect(rows).toEqual([
    ["/name", "Modifié", "\"Chiffre d'affaires\"", "\"Révisée\""],
    ["/query/dimensions/1", "Ajouté", "—", "\"pays\""],
    ["/query/filters/0", "Retiré", "{\"column\":\"region\",\"operator\":\"eq\",\"value\":\"Nord\"}", "—"],
  ]);
  expect(fetcher).toHaveBeenCalledTimes(2);
  await expectAccessible(container);
});

it("changer une révision efface l'écart affiché, qui ne vaut plus pour la nouvelle paire", async () => {
  const saves = (route("historique").body as { revisions: object[] }).revisions;
  const history = { status: 200, body: { id: ID, current_revision: 3, deleted: false, revisions: [...saves, { ...saves[1], revision: 3 }] } };
  open({ [HISTORY]: history, [DIFF(1, 3)]: route("ecart", [['"other":2', '"other":3']]) });
  await screen.findByRole("button", { name: "Comparer" });
  expect(screen.getByLabelText("Révision comparée")).toHaveValue("3");
  await userEvent.click(screen.getByRole("button", { name: "Comparer" }));
  await screen.findByRole("table", { name: "Écart entre r1 et r3" });
  await userEvent.selectOptions(screen.getByLabelText("Révision de base"), "2");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Révision comparée"), "2");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

it("dit qu'il n'y a aucune différence structurelle plutôt que de laisser un tableau vide", async () => {
  open({ [HISTORY]: route("historique"), [DIFF(1, 2)]: { status: 200, body: { id: ID, base: 1, other: 2, changes: [] } } });
  await userEvent.click(await screen.findByRole("button", { name: "Comparer" }));
  expect(await screen.findByText("Aucune différence structurelle entre r1 et r2.")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

it("un écart refusé s'affiche tel quel, sans tableau", async () => {
  open({ [HISTORY]: route("historique"), [DIFF(1, 2)]: route("refus-ecart-revision-masquee") });
  await userEvent.click(await screen.findByRole("button", { name: "Comparer" }));
  await screen.findByRole("alert");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

it("le mode local de l'écart se dit sans alarme", async () => {
  open({ [HISTORY]: route("historique"), [DIFF(1, 2)]: route("refus-mode-local") });
  await userEvent.click(await screen.findByRole("button", { name: "Comparer" }));
  expect(await screen.findByText("Les analyses ne sont pas disponibles en mode local.")).toBeInTheDocument();
});

it("une analyse inconnue ou une panne de l'historique s'affiche telle quelle, sans liste", async () => {
  const unknown = open({ [HISTORY]: route("refus-analyse-inconnue") });
  expect(await screen.findByRole("alert")).toHaveTextContent("introuvable");
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
  unknown.unmount();
  open({});
  expect(await screen.findByRole("alert")).toHaveTextContent("Historique indisponible");
});

it("le mode local de l'historique se dit sans alarme", async () => {
  open({ [HISTORY]: route("refus-mode-local") });
  expect(await screen.findByText("Les analyses ne sont pas disponibles en mode local.")).toBeInTheDocument();
});

it("annonce la lecture de l'écart tant que le serveur n'a pas répondu", async () => {
  const served = analysesServer({ [HISTORY]: route("historique") });
  render(<OngletRevisions space="finance" id={ID} fetcher={(url, init) => (url.includes("/diff") ? new Promise<Response>(() => undefined) : served(url, init))} />);
  await userEvent.click(await screen.findByRole("button", { name: "Comparer" }));
  expect(screen.getByRole("status")).toHaveTextContent("Lecture de l'écart…");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

// --- Écart demandé par l'adresse (plan 18, 18.5b) ---

const THREE = () => {
  const saves = (route("historique").body as { revisions: object[] }).revisions;
  return { status: 200, body: { id: ID, current_revision: 3, deleted: false, revisions: [...saves, { ...saves[1], revision: 3 }] } };
};

it("une comparaison demandée par l'adresse positionne les sélecteurs et lance l'écart du serveur", async () => {
  const { fetcher } = open({ [HISTORY]: THREE(), [DIFF(2, 3)]: route("ecart", [['"base":1', '"base":2'], ['"other":2', '"other":3']]) }, { base: 2, other: 3 });
  expect(await screen.findByRole("table", { name: "Écart entre r2 et r3" })).toBeInTheDocument();
  expect(screen.getByLabelText("Révision de base")).toHaveValue("2");
  expect(screen.getByLabelText("Révision comparée")).toHaveValue("3");
  expect(screen.queryByText(/n'est pas lancée/)).not.toBeInTheDocument();
  expect(fetcher.mock.calls.filter(([url]) => url.includes("/diff"))).toHaveLength(1);
});

it("une révision demandée masquée ou absente est dite, l'écart n'est pas lancé et les sélecteurs gardent leur défaut", async () => {
  const { fetcher } = open({ [HISTORY]: THREE() }, { base: 2, other: 9 });
  const notice = await screen.findByText(/La comparaison demandée/);
  expect(notice).toHaveTextContent("La comparaison demandée entre r2 et r9 n'est pas lancée : r9 n'existe pas ou n'est pas lisible pour votre session.");
  expect(screen.getByLabelText("Révision de base")).toHaveValue("1");
  expect(screen.getByLabelText("Révision comparée")).toHaveValue("3");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(fetcher.mock.calls.some(([url]) => url.includes("/diff"))).toBe(false);
});

it("dit les deux révisions quand ni l'une ni l'autre n'est lisible", async () => {
  open({ [HISTORY]: route("historique-revision-masquee") }, { base: 1, other: 7 });
  expect(await screen.findByText(/La comparaison demandée/)).toHaveTextContent("r1 et r7 n'existent pas ou ne sont pas lisibles pour votre session.");
});

it("une comparaison demandée d'une révision avec elle-même est lancée même si une seule révision est lisible", async () => {
  const { fetcher } = open({ [HISTORY]: route("historique-revision-masquee"), [DIFF(2, 2)]: route("ecart", [['"base":1', '"base":2']]) }, { base: 2, other: 2 });
  expect(await screen.findByRole("table", { name: "Écart entre r2 et r2" })).toBeInTheDocument();
  expect(screen.queryByText(/Il faut deux révisions disponibles/)).not.toBeInTheDocument();
  expect(screen.getByLabelText("Révision de base")).toHaveValue("2");
  expect(screen.getByLabelText("Révision comparée")).toHaveValue("2");
  expect(fetcher.mock.calls.filter(([url]) => url === `${ROOT}/${ID}/diff?base=2&other=2`)).toHaveLength(1);
});
