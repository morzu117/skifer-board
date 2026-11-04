import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import catalogue from "../../../contracts/catalogue/liste.json";
import accords from "../../../contracts/espaces/accords.json";
import espace from "../../../contracts/espaces/espace.json";
import interdit from "../../../contracts/espaces/interdit.json";
import introuvable from "../../../contracts/espaces/introuvable.json";
import journalParametres from "../../../contracts/espaces/journal-parametres.json";
import administration from "../../../contracts/espaces/liste-administration.json";
import liste from "../../../contracts/espaces/liste.json";
import locale from "../../../contracts/espaces/liste-locale.json";
import membres from "../../../contracts/espaces/membres.json";
import parametres from "../../../contracts/espaces/parametres.json";
import valeur from "../../../contracts/espaces/valeur.json";
import etabli from "../../../contracts/identite/me-etabli.json";
import local from "../../../contracts/identite/me-local.json";
import type { Fetch } from "./identity/api";

import { App } from "./App";

// Écran « Paramètres » dans la coque (plan 10, 10.3) : route, fil d'Ariane, entrée active, onglets,
// mode local, cible suivant la bascule, relecture de l'espace après une écriture.

type Exemple = { status: number; body: unknown };
type Reponse = Exemple | (() => Promise<Response>);
const reponse = (exemple: Exemple) => (exemple.body === null ? new Response(null, { status: exemple.status }) : Response.json(exemple.body, { status: exemple.status }));
const FINANCE: Readonly<Record<string, Reponse>> = {
  "GET /api/me": etabli,
  "GET /api/spaces": liste,
  "GET /api/spaces/finance": espace,
  "GET /api/spaces/finance/catalog": catalogue,
  "GET /api/spaces/finance/members": membres,
  "GET /api/spaces/finance/events": journalParametres,
  "GET /api/spaces/finance/deploy-grants": accords,
  "GET /api/spaces/finance/parameters": parametres,
};
function routeur(table: Readonly<Record<string, Reponse>>): Mock<Fetch> {
  return vi.fn<Fetch>().mockImplementation((url, init) => {
    const cle = `${init?.method ?? "GET"} ${url}`;
    const exemple = table[cle];
    if (exemple === undefined) return Promise.reject(new Error(`appel inattendu : ${cle}`));
    return typeof exemple === "function" ? exemple() : Promise.resolve(reponse(exemple));
  });
}
function ouvrir(hash: string, table: Readonly<Record<string, Reponse>> = FINANCE) {
  window.history.replaceState(null, "", `/${hash}`);
  const fetcher = routeur(table);
  render(<App fetcher={fetcher} leave={vi.fn()} />);
  return fetcher;
}
const lus = (fetcher: Mock<Fetch>) => fetcher.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`);
const filAriane = () => within(screen.getByRole("navigation", { name: "Fil d'Ariane" })).getAllByRole("listitem").map((item) => item.textContent);
const nav = () => screen.getByRole("navigation", { name: "Navigation principale" });
const bascule = () => within(screen.getByRole("banner")).getByRole("group", { name: "Environnement" });
const onglets = () => screen.getByRole("navigation", { name: "Administration de l'espace" });
const grille = () => screen.getByRole("table", { name: "Paramètres et valeurs par environnement" });
const cible = () => grille().querySelector(".sb-params__env--target .sb-mono")?.textContent;
const choixEnv = () => within(screen.getByRole("form", { name: "Poser une valeur" })).getByRole("combobox", { name: "Environnement" });
const ecran = async () => {
  expect(await screen.findByRole("heading", { level: 1, name: "Paramètres" })).toBeInTheDocument();
  await screen.findByRole("table", { name: "Paramètres et valeurs par environnement" });
};

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("« Paramètres » dans la coque (plan 10, 10.3)", () => {
  it("#/espaces/<id>/parametres ouvre l'écran pour un administrateur, fil d'Ariane « Espace / Paramètres » et entrée courante compris", async () => {
    const fetcher = ouvrir("#/espaces/finance/parametres");
    await ecran();
    expect(filAriane()).toEqual(["Finance", "Paramètres"]);
    expect(within(nav()).getByRole("button", { name: "Espace & connexions" })).toHaveAttribute("aria-current", "page");
    expect(within(nav()).getByRole("button", { name: "Catalogue Atlas" })).not.toHaveAttribute("aria-current");
    expect(lus(fetcher)).toEqual(expect.arrayContaining(["GET /api/spaces/finance", "GET /api/spaces/finance/parameters", "GET /api/spaces/finance/events"]));
    // Ni catalogue, ni membres, ni droits : seul l'écran demandé lit.
    expect(lus(fetcher).filter((cle) => cle.includes("catalog") || cle.includes("/members") || cle.includes("/deploy-grants"))).toEqual([]);
    expect(lus(fetcher).filter((cle) => !cle.startsWith("GET"))).toEqual([]);
  });

  it("la cible de la grille est l'environnement de la coque ; la bascule la déplace sans relire, et le formulaire suit", async () => {
    const fetcher = ouvrir("#/espaces/finance/parametres");
    await ecran();
    await screen.findByRole("list", { name: "Journal de l'espace" });
    expect(cible()).toBe("DEV");
    expect(choixEnv()).toHaveValue("DEV");
    const avant = lus(fetcher).length;
    await userEvent.click(within(bascule()).getByRole("button", { name: "TEST" }));
    expect(cible()).toBe("TEST");
    expect(choixEnv()).toHaveValue("TEST");
    // PROD : rien ne s'y pose pour cette session (`can_set` faux), le formulaire garde un environnement autorisé.
    await userEvent.click(within(bascule()).getByRole("button", { name: "PROD" }));
    expect(cible()).toBe("PROD");
    expect(choixEnv()).toHaveValue("DEV");
    await act(async () => { await new Promise((fin) => setTimeout(fin, 20)); });
    expect(lus(fetcher)).toHaveLength(avant);
    expect(window.location.hash).toBe("#/espaces/finance/parametres");
  });

  it("l'environnement choisi avant d'arriver sur l'écran en est la cible", async () => {
    ouvrir("#/espaces/finance/environnements");
    await screen.findByRole("list", { name: "Droits de déployer, dans l'ordre de promotion" });
    await userEvent.click(within(bascule()).getByRole("button", { name: "TEST" }));
    await userEvent.click(within(onglets()).getByRole("link", { name: "Paramètres" }));
    await ecran();
    expect(cible()).toBe("TEST");
    expect(choixEnv()).toHaveValue("TEST");
  });

  it("les onglets passent des paramètres aux environnements et aux membres, et retour", async () => {
    ouvrir("#/espaces/finance/parametres");
    await ecran();
    expect(within(onglets()).getByRole("link", { name: "Paramètres" })).toHaveAttribute("aria-current", "page");
    await userEvent.click(within(onglets()).getByRole("link", { name: "Environnements" }));
    await waitFor(() => { expect(window.location.hash).toBe("#/espaces/finance/environnements"); });
    expect(await screen.findByRole("heading", { level: 1, name: "Environnements" })).toBeInTheDocument();
    expect(filAriane()).toEqual(["Finance", "Environnements"]);
    await userEvent.click(within(onglets()).getByRole("link", { name: "Membres et rôles" }));
    await waitFor(() => { expect(window.location.hash).toBe("#/espaces/finance/membres"); });
    await userEvent.click(within(onglets()).getByRole("link", { name: "Paramètres" }));
    await waitFor(() => { expect(window.location.hash).toBe("#/espaces/finance/parametres"); });
    await ecran();
    expect(filAriane()).toEqual(["Finance", "Paramètres"]);
  });

  it("le lien « Paramètres de Finance » de l'accueil mène à l'écran", async () => {
    ouvrir("#/", { ...FINANCE, "GET /api/spaces": administration, "GET /api/spaces/finance": { status: 200, body: administration.body.spaces[0] } });
    await userEvent.click(await screen.findByRole("link", { name: "Paramètres de Finance" }));
    await waitFor(() => { expect(window.location.hash).toBe("#/espaces/finance/parametres"); });
    await ecran();
  });

  it("un créateur à l'adresse directe voit le refus du serveur rendu, sans grille ni formulaire", async () => {
    const createur = { status: 200, body: { ...espace.body, role: "creator" } };
    const fetcher = ouvrir("#/espaces/finance/parametres", { ...FINANCE, "GET /api/spaces/finance": createur, "GET /api/spaces/finance/parameters": interdit, "GET /api/spaces/finance/events": interdit });
    expect(await screen.findByRole("heading", { level: 1, name: "Paramètres" })).toBeInTheDocument();
    await waitFor(() => { expect(screen.getAllByRole("alert")).toHaveLength(2); });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(lus(fetcher).filter((cle) => !cle.startsWith("GET"))).toEqual([]);
  });

  it("l'administration de la plateforme sans rôle lit les paramètres (P6)", async () => {
    ouvrir("#/espaces/finance/parametres", { ...FINANCE, "GET /api/spaces": administration, "GET /api/spaces/finance": { status: 200, body: administration.body.spaces[0] } });
    await ecran();
    expect(filAriane()).toEqual(["Finance", "Paramètres"]);
    expect(within(nav()).getByRole("button", { name: "Espace & connexions" })).toHaveAttribute("aria-current", "page");
  });

  it("en mode local, l'écran dit que les paramètres ne se gèrent pas, sans rien lire ni onglets", async () => {
    const fetcher = ouvrir("#/espaces/local/parametres", { "GET /api/me": local, "GET /api/spaces": locale, "GET /api/spaces/local": { status: 200, body: locale.body.spaces[0] } });
    expect(await screen.findByRole("heading", { level: 1, name: "Paramètres" })).toBeInTheDocument();
    expect(screen.getByText(/^En mode local/)).toHaveTextContent(
      "En mode local, sans base d'état, les paramètres de déploiement ne se gèrent pas : aucune configuration n'est gardée.",
    );
    expect(filAriane()).toEqual(["Local", "Paramètres"]);
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Administration de l'espace" })).not.toBeInTheDocument();
    await act(async () => { await new Promise((fin) => setTimeout(fin, 20)); });
    expect(lus(fetcher).filter((cle) => cle.includes("/parameters") || cle.includes("/events"))).toEqual([]);
  });

  it.each([
    ["inconnu ou refusé", "#/espaces/paie/parametres", { "GET /api/spaces/paie": introuvable }],
    ["hors format", "#/espaces/Paie/parametres", {}],
  ])("un espace %s s'affiche « Espace introuvable », sans lecture des paramètres", async (_cas, hash, table) => {
    const fetcher = ouvrir(hash, { ...FINANCE, ...table });
    expect(await screen.findByRole("heading", { level: 1, name: "Espace introuvable" })).toBeInTheDocument();
    expect(filAriane()).toEqual(["Espace introuvable"]);
    expect(lus(fetcher).filter((cle) => cle.includes("/parameters"))).toEqual([]);
  });

  it("un espace indisponible n'ouvre pas l'écran", async () => {
    const fetcher = ouvrir("#/espaces/finance/parametres", { ...FINANCE, "GET /api/spaces/finance": { status: 500, body: {} } });
    expect(await screen.findByRole("heading", { level: 1, name: "Espace indisponible" })).toBeInTheDocument();
    expect(lus(fetcher).filter((cle) => cle.includes("/parameters"))).toEqual([]);
  });

  it("une écriture relit l'espace sans démonter la page : le bandeau de réponse garde le focus", async () => {
    const fetcher = ouvrir("#/espaces/finance/parametres", { ...FINANCE, "PUT /api/spaces/finance/parameters/catalogue/values/DEV": valeur });
    await ecran();
    const formulaire = screen.getByRole("form", { name: "Poser une valeur" });
    await userEvent.type(within(formulaire).getByRole("textbox", { name: /^Valeur/ }), "finance_dev");
    await userEvent.click(within(formulaire).getByRole("button", { name: "Poser la valeur" }));
    await screen.findByText("catalogue en DEV : finance_dev.");
    await waitFor(() => { expect(lus(fetcher).filter((cle) => cle === "GET /api/spaces/finance")).toHaveLength(2); });
    expect(screen.getByText("catalogue en DEV : finance_dev.")).toBeInTheDocument();
    expect(document.querySelector(".sb-members__feedback")).toHaveFocus();
    expect(lus(fetcher).filter((cle) => cle === "GET /api/spaces/finance/parameters")).toHaveLength(2);
  });
});
