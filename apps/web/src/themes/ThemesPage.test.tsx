import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import espace from "../../../../contracts/espaces/espace.json";
import list from "../../../../contracts/themes/routes/lister.json";
import consumers from "../../../../contracts/themes/routes/consommateurs.json";
import { decodeSpace } from "../spaces/model";
import type { Fetch } from "../spaces/api";
import { routeFromHash, routeHash } from "../shell/route";
import { ThemesPage } from "./ThemesPage";
import { refusalText } from "./labels";

const id = "00000000-0000-4000-8000-000000000001";
const commit = "a".repeat(40);
const example = (value: unknown) => JSON.parse(JSON.stringify(value).replaceAll("<uuid>", id).replaceAll("<commit>", commit)) as unknown;
const space = decodeSpace(espace.body, "espace");
afterEach(() => { window.history.replaceState(null, "", "/"); });

it("conserve les précisions des refus", () => {
  expect(refusalText({ code: "local_mode" })).toBe("Mode local");
  expect(refusalText({ code: "invalid_parameter", reason: "raison", required: "creator", field: "champ", parameter: "revision", detail: "détail" })).toBe("Paramètre invalide · raison : raison · rôle requis : Créateur · champ : champ · paramètre : revision · détail : détail");
});

it("construit et relit les routes de liste et d'éditeur", () => {
  for (const route of [{ page: "themes" as const, space: "finance" }, { page: "theme" as const, space: "finance", id }, { page: "theme" as const, space: "finance", id: "nouveau" }, { page: "theme" as const, space: "finance", id, view: "history" as const }, { page: "theme" as const, space: "finance", id, revision: 1 }]) expect(routeFromHash(routeHash(route))).toEqual(route);
});

it("affiche la liste, les consommateurs et actualise", async () => {
  const fetcher = vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(Response.json(example(url.endsWith("/consumers") ? consumers.body : list.body))));
  render(<ThemesPage space={space} fetcher={fetcher} />);
  expect(screen.getByRole("status")).toHaveTextContent("Lecture des thèmes");
  const row = await screen.findByRole("row", { name: /Clair/ });
  expect(within(row).getByRole("link", { name: "Clair" })).toHaveAttribute("href", `#/espaces/${space.id}/themes/${id}`);
  expect(row).toHaveTextContent("Brouillon"); expect(row).toHaveTextContent("cora"); expect(row).toHaveTextContent("commit aaaaaaaa");
  await waitFor(() => { expect(within(row).getAllByRole("cell").at(-1)).toHaveTextContent(/^1$/); });
  await userEvent.click(screen.getByRole("button", { name: "Actualiser" }));
  await waitFor(() => { expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/themes"))).toHaveLength(2); });
  await userEvent.click(screen.getByRole("button", { name: "Nouveau thème" }));
  expect(window.location.hash).toBe(`#/espaces/${space.id}/themes/nouveau`);
});

it("rend l'échec des consommateurs sans inventer zéro", async () => {
  const fetcher = vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(url.endsWith("/consumers") ? new Response("panne", { status: 500 }) : Response.json(example(list.body))));
  render(<ThemesPage space={space} fetcher={fetcher} />);
  expect(await screen.findByText(/indisponible :/)).toBeInTheDocument();
});

it.each([
  [{ code: "forbidden", required: "admin" }, "Accès refusé · rôle requis : Administrateur"],
  [{ code: "forbidden", required: "reader" }, "Accès refusé · rôle requis : Lecteur"],
  [{ code: "forbidden", required: "inconnu" }, "Accès refusé · rôle requis : inconnu"],
  [{ code: "revision_conflict", reason: "stale" }, "Conflit de révision · raison : révision périmée"],
  [{ code: "invalid_theme", reason: "token_not_admissible" }, "Thème invalide · raison : Ce token n'est pas admissible pour cette base."],
  [{ code: "component_not_found" }, "Composant introuvable"],
  [{ code: "invalid_page_template", reason: "out_of_bounds" }, "Modèle invalide · raison : hors des bornes"],
  [{ code: "inconnu" }, "Refus du serveur · code : inconnu"],
] as const)("libelle les précisions du refus %o", (refusal, expected) => {
  expect(refusalText(refusal)).toBe(expected);
});

it.each(["admin", "creator"] as const)("explique la liste vide au rôle %s", async (role) => {
  const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json({ themes: [], unreadable: 0 }));
  render(<ThemesPage space={{ ...space, role }} fetcher={fetcher} />);
  expect(await screen.findByRole("heading", { name: "Aucun thème à afficher" })).toBeInTheDocument();
  if (role === "admin") expect(screen.getByText(/brouillons des autres/)).toBeInTheDocument();
});

it("affiche les révisions approuvées, le brouillon courant et l'index périmé", async () => {
  const body = example(list.body) as { themes: Record<string, unknown>[]; unreadable: number };
  const original = body.themes[0] as Record<string, unknown>;
  body.themes = [{ ...original, state: "approved", approved_revision: 1 }, { ...original, id: "00000000-0000-4000-8000-000000000002", name: "Autre", revision: 2, approved_revision: 1, index_state: "index_stale" }];
  body.unreadable = 1;
  const fetcher = vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(Response.json(url.endsWith("/consumers") ? { id: url.split("/").at(-2), consumers: [], others: 2 } : body)));
  render(<ThemesPage space={space} fetcher={fetcher} />);
  expect(await screen.findByText("Approuvé · r1")).toBeInTheDocument();
  expect(screen.getByText("révision r1 approuvée, r2 en brouillon")).toBeInTheDocument();
  expect(screen.getByText("Index périmé")).toBeInTheDocument();
  expect(screen.getByText(/1 thème\(s\) illisible/)).toBeInTheDocument();
  await waitFor(() => { expect(screen.getAllByText("2")).toHaveLength(2); });
  await userEvent.click(screen.getByRole("button", { name: "Skifer ardoise" }));
});

it("signale les contenus illisibles sans annoncer une liste vide", async () => {
  const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json({ themes: [], unreadable: 1 }));
  render(<ThemesPage space={space} fetcher={fetcher} />);
  expect(await screen.findByText(/illisible/)).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Aucun thème à afficher" })).not.toBeInTheDocument();
});

it("garde l'état de lecture des consommateurs", async () => {
  const fetcher = vi.fn<Fetch>().mockImplementation((url) => url.endsWith("/consumers") ? new Promise<Response>(() => undefined) : Promise.resolve(Response.json(example(list.body))));
  render(<ThemesPage space={space} fetcher={fetcher} />);
  expect(await screen.findByText("lecture…")).toBeInTheDocument();
});

it.each(["réseau", "forbidden"] as const)("montre le refus de liste %s", async (kind) => {
  const fetcher = vi.fn<Fetch>().mockImplementation(() => kind === "réseau" ? Promise.reject(new Error("panne")) : Promise.resolve(Response.json({ error: { code: "forbidden", required: "creator" } }, { status: 403 })));
  render(<ThemesPage space={space} fetcher={fetcher} />);
  expect(await screen.findByText(/Thèmes indisponibles/)).toBeInTheDocument();
});

it("montre un refus fermé de lecture des consommateurs", async () => {
  const fetcher = vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(url.endsWith("/consumers") ? Response.json({ error: { code: "forbidden", required: "creator" } }, { status: 403 }) : Response.json(example(list.body))));
  render(<ThemesPage space={space} fetcher={fetcher} />);
  expect(await screen.findByText("indisponible : Accès refusé · rôle requis : Créateur")).toBeInTheDocument();
});
