import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import catalogue from "../../../contracts/catalogue/liste.json";
import accord from "../../../contracts/espaces/accord.json";
import accords from "../../../contracts/espaces/accords.json";
import espace from "../../../contracts/espaces/espace.json";
import interdit from "../../../contracts/espaces/interdit.json";
import introuvable from "../../../contracts/espaces/introuvable.json";
import journal from "../../../contracts/espaces/journal.json";
import journalAccords from "../../../contracts/espaces/journal-accords.json";
import liste from "../../../contracts/espaces/liste.json";
import administration from "../../../contracts/espaces/liste-administration.json";
import locale from "../../../contracts/espaces/liste-locale.json";
import membres from "../../../contracts/espaces/membres.json";
import parametres from "../../../contracts/espaces/parametres.json";
import etabli from "../../../contracts/identite/me-etabli.json";
import local from "../../../contracts/identite/me-local.json";
import type { Fetch } from "./identity/api";

import { App } from "./App";

// Écran « Environnements » dans la coque (plan 09, 9.4) : route, fil d'Ariane, entrée active, mode
// local, cible suivant la bascule, relecture de l'espace après une écriture.

type Exemple = { status: number; body: unknown };
type Reponse = Exemple | (() => Promise<Response>);
const reponse = (exemple: Exemple) => (exemple.body === null ? new Response(null, { status: exemple.status }) : Response.json(exemple.body, { status: exemple.status }));
const FINANCE: Readonly<Record<string, Reponse>> = {
  "GET /api/me": etabli,
  "GET /api/spaces": liste,
  "GET /api/spaces/finance": espace,
  "GET /api/spaces/finance/catalog": catalogue,
  "GET /api/spaces/finance/members": membres,
  "GET /api/spaces/finance/events": journalAccords,
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
const pipeline = () => screen.getByRole("list", { name: "Droits de déployer, dans l'ordre de promotion" });
const cible = () => pipeline().querySelector('[aria-current="step"] h2 .sb-mono')?.textContent;
const ligne = () => screen.queryByText(/^Déploiement :/);
const ecran = async () => {
  expect(await screen.findByRole("heading", { level: 1, name: "Environnements" })).toBeInTheDocument();
  await screen.findByRole("list", { name: "Droits de déployer, dans l'ordre de promotion" });
};

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("« Environnements » dans la coque (plan 09, 9.4)", () => {
  it("#/espaces/<id>/environnements ouvre l'écran pour un administrateur, fil d'Ariane et entrée courante compris", async () => {
    const fetcher = ouvrir("#/espaces/finance/environnements");
    await ecran();
    expect(filAriane()).toEqual(["Finance", "Environnements"]);
    expect(within(nav()).getByRole("button", { name: "Espace & connexions" })).toHaveAttribute("aria-current", "page");
    expect(within(nav()).getByRole("button", { name: "Catalogue Atlas" })).not.toHaveAttribute("aria-current");
    expect(lus(fetcher)).toEqual(expect.arrayContaining(["GET /api/spaces/finance", "GET /api/spaces/finance/deploy-grants", "GET /api/spaces/finance/events"]));
    // Ni catalogue ni membres : seul l'écran demandé lit.
    expect(lus(fetcher).filter((cle) => cle.includes("catalog") || cle.includes("/members"))).toEqual([]);
    expect(lus(fetcher).filter((cle) => !cle.startsWith("GET"))).toEqual([]);
  });

  it("la cible est l'environnement de la coque (DEV par défaut) ; changer la bascule la déplace sans rien relire", async () => {
    const fetcher = ouvrir("#/espaces/finance/environnements");
    await ecran();
    await screen.findByRole("list", { name: "Journal de l'espace" });
    expect(cible()).toBe("DEV");
    const avant = lus(fetcher).length;
    await userEvent.click(within(bascule()).getByRole("button", { name: "PROD" }));
    expect(cible()).toBe("PROD");
    await userEvent.click(within(bascule()).getByRole("button", { name: "TEST" }));
    expect(cible()).toBe("TEST");
    await act(async () => { await new Promise((fin) => setTimeout(fin, 20)); });
    expect(lus(fetcher)).toHaveLength(avant);
    expect(window.location.hash).toBe("#/espaces/finance/environnements");
  });

  it("l'environnement choisi avant d'arriver sur l'écran en est la cible, et le formulaire le propose", async () => {
    ouvrir("#/espaces/finance/catalogue");
    await screen.findByRole("table");
    await userEvent.click(within(bascule()).getByRole("button", { name: "PROD" }));
    act(() => { window.location.hash = "#/espaces/finance/environnements"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    await ecran();
    expect(cible()).toBe("PROD");
    expect(within(screen.getByRole("form", { name: "Accorder un droit de déployer" })).getByRole("combobox", { name: "Environnement" })).toHaveValue("PROD");
  });

  const choix = () => within(screen.getByRole("form", { name: "Accorder un droit de déployer" })).getByRole("combobox", { name: "Environnement" });
  const choisirDansLaBascule = (code: string) => userEvent.click(within(bascule()).getByRole("button", { name: code }));

  it("changer la bascule, l'écran ouvert et rien choisi dans le formulaire, déplace aussi l'environnement proposé ; l'accord part dans la nouvelle cible", async () => {
    const fetcher = ouvrir("#/espaces/finance/environnements", {
      ...FINANCE,
      "POST /api/spaces/finance/deploy-grants": { status: 200, body: { ...accord.body, environment: "PROD" } },
    });
    await ecran();
    expect(choix()).toHaveValue("DEV");
    await choisirDansLaBascule("PROD");
    expect(cible()).toBe("PROD");
    expect(choix()).toHaveValue("PROD");
    await choisirDansLaBascule("TEST");
    expect(cible()).toBe("TEST");
    expect(choix()).toHaveValue("TEST");
    await choisirDansLaBascule("PROD");
    const formulaire = screen.getByRole("form", { name: "Accorder un droit de déployer" });
    await userEvent.type(within(formulaire).getByRole("textbox", { name: /Nom exact du groupe/ }), "finance-admins");
    await userEvent.click(within(formulaire).getByRole("button", { name: "Accorder le droit" }));
    await screen.findByText("Groupe finance-admins : droit de déployer en PROD accordé.");
    const envoi = fetcher.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(envoi?.[1]?.body as string)).toEqual({ environment: "PROD", principal: { kind: "group", name: "finance-admins" } });
  });

  it("un choix fait dans le formulaire reste tant que la cible ne change pas, même après une écriture ; un changement de cible reprend la main", async () => {
    const fetcher = ouvrir("#/espaces/finance/environnements", {
      ...FINANCE,
      "POST /api/spaces/finance/deploy-grants": { status: 200, body: { ...accord.body, environment: "TEST" } },
    });
    await ecran();
    await userEvent.selectOptions(choix(), "TEST");
    expect(cible()).toBe("DEV");
    expect(choix()).toHaveValue("TEST");
    // Re-cliquer la cible courante n'est pas un changement de cible.
    await choisirDansLaBascule("DEV");
    expect(choix()).toHaveValue("TEST");
    // Une écriture relit l'espace et les listes : le choix reste.
    const formulaire = screen.getByRole("form", { name: "Accorder un droit de déployer" });
    await userEvent.type(within(formulaire).getByRole("textbox", { name: /Nom exact du groupe/ }), "finance-admins");
    await userEvent.click(within(formulaire).getByRole("button", { name: "Accorder le droit" }));
    await screen.findByText("Groupe finance-admins : droit de déployer en TEST accordé.");
    await waitFor(() => { expect(lus(fetcher).filter((cle) => cle === "GET /api/spaces/finance")).toHaveLength(2); });
    expect(choix()).toHaveValue("TEST");
    // La cible change : elle reprend la main sur le choix.
    await choisirDansLaBascule("PROD");
    expect(choix()).toHaveValue("PROD");
    // Nouveau choix sous la nouvelle cible, qui reste à son tour.
    await userEvent.selectOptions(choix(), "DEV");
    expect(cible()).toBe("PROD");
    expect(choix()).toHaveValue("DEV");
    await choisirDansLaBascule("TEST");
    expect(choix()).toHaveValue("TEST");
  });

  // Chaque changement de cible oublie le choix fait dans le formulaire (défaut trouvé par l'agent de test, corrigé).
  it("revenir par la bascule à la cible d'un ancien choix ne fait pas ressortir ce choix : le formulaire suit la cible", async () => {
    ouvrir("#/espaces/finance/environnements");
    await ecran();
    await userEvent.selectOptions(choix(), "TEST");
    await choisirDansLaBascule("PROD");
    expect(choix()).toHaveValue("PROD");
    await choisirDansLaBascule("DEV");
    expect(cible()).toBe("DEV");
    expect(choix()).toHaveValue("DEV");
  });

  it("les onglets passent des environnements aux membres et retour, dans le même espace", async () => {
    ouvrir("#/espaces/finance/environnements");
    await ecran();
    const onglets = () => screen.getByRole("navigation", { name: "Administration de l'espace" });
    await userEvent.click(within(onglets()).getByRole("link", { name: "Membres et rôles" }));
    await waitFor(() => { expect(window.location.hash).toBe("#/espaces/finance/membres"); });
    expect(await screen.findByRole("heading", { level: 1, name: "Membres et rôles" })).toBeInTheDocument();
    expect(filAriane()).toEqual(["Finance", "Membres et rôles"]);
    await userEvent.click(within(onglets()).getByRole("link", { name: "Environnements" }));
    await waitFor(() => { expect(window.location.hash).toBe("#/espaces/finance/environnements"); });
    await ecran();
  });

  it("un créateur à l'adresse directe voit le refus du serveur rendu, sans formulaire", async () => {
    const createur = { status: 200, body: { ...espace.body, role: "creator" } };
    const fetcher = ouvrir("#/espaces/finance/environnements", { ...FINANCE, "GET /api/spaces/finance": createur, "GET /api/spaces/finance/deploy-grants": interdit, "GET /api/spaces/finance/events": interdit, "GET /api/spaces/finance/parameters": interdit });
    expect(await screen.findByRole("heading", { level: 1, name: "Environnements" })).toBeInTheDocument();
    await waitFor(() => { expect(screen.getAllByRole("alert")).toHaveLength(2); });
    for (const alerte of screen.getAllByRole("alert")) expect(alerte).toHaveTextContent("Votre rôle ne permet pas cette action.");
    expect(screen.queryByRole("form", { name: "Accorder un droit de déployer" })).not.toBeInTheDocument();
    expect(lus(fetcher).filter((cle) => !cle.startsWith("GET"))).toEqual([]);
  });

  it("un lecteur (exemple réel de la liste : rh) voit aussi le refus rendu", async () => {
    const rh = { status: 200, body: { ...espace.body, id: "rh", name: "Ressources humaines", role: "reader" } };
    ouvrir("#/espaces/rh/environnements", { ...FINANCE, "GET /api/spaces/rh": rh, "GET /api/spaces/rh/deploy-grants": interdit, "GET /api/spaces/rh/events": interdit, "GET /api/spaces/rh/parameters": interdit });
    await waitFor(() => { expect(screen.getAllByRole("alert")).toHaveLength(2); });
    expect(filAriane()).toEqual(["Ressources humaines", "Environnements"]);
    expect(screen.queryByRole("list", { name: /ordre de promotion/ })).not.toBeInTheDocument();
  });

  it("l'administration de la plateforme sans rôle gère les droits (V5)", async () => {
    ouvrir("#/espaces/finance/environnements", { ...FINANCE, "GET /api/spaces": administration, "GET /api/spaces/finance": { status: 200, body: administration.body.spaces[0] } });
    await ecran();
    expect(within(nav()).getByRole("button", { name: "Espace & connexions" })).toHaveAttribute("aria-current", "page");
  });

  it("en mode local, l'écran dit que les droits ne se gèrent pas, sans lire accords ni journal", async () => {
    const fetcher = ouvrir("#/espaces/local/environnements", { "GET /api/me": local, "GET /api/spaces": locale, "GET /api/spaces/local": { status: 200, body: locale.body.spaces[0] } });
    expect(await screen.findByRole("heading", { level: 1, name: "Environnements" })).toBeInTheDocument();
    expect(screen.getByText(/^En mode local/)).toHaveTextContent(
      "En mode local, sans fournisseur d'identité, vous pouvez déployer dans les trois environnements de l'espace implicite : les droits de déployer ne se gèrent pas.",
    );
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Administration de l'espace" })).not.toBeInTheDocument();
    await act(async () => { await new Promise((fin) => setTimeout(fin, 20)); });
    expect(lus(fetcher).filter((cle) => cle.includes("/deploy-grants") || cle.includes("/events") || cle.includes("/members"))).toEqual([]);
  });

  it.each([
    ["inconnu ou refusé", "#/espaces/paie/environnements", { "GET /api/spaces/paie": introuvable }],
    ["hors format", "#/espaces/Paie/environnements", {}],
  ])("un espace %s s'affiche « Espace introuvable », sans lecture des accords", async (_cas, hash, table) => {
    const fetcher = ouvrir(hash, { ...FINANCE, ...table });
    expect(await screen.findByRole("heading", { level: 1, name: "Espace introuvable" })).toBeInTheDocument();
    expect(filAriane()).toEqual(["Espace introuvable"]);
    expect(lus(fetcher).filter((cle) => cle.includes("/deploy-grants") || cle.includes("/events"))).toEqual([]);
  });

  it("un espace indisponible n'ouvre pas l'écran", async () => {
    const fetcher = ouvrir("#/espaces/finance/environnements", { ...FINANCE, "GET /api/spaces/finance": { status: 500, body: {} } });
    expect(await screen.findByRole("heading", { level: 1, name: "Espace indisponible" })).toBeInTheDocument();
    expect(lus(fetcher).filter((cle) => cle.includes("/deploy-grants"))).toEqual([]);
  });

  it("une écriture relit l'espace sans démonter la page : les marques de la bascule suivent", async () => {
    let accorde = false;
    const droits = (dev: boolean) => [{ code: "DEV", deploy: dev }, { code: "TEST", deploy: false }, { code: "PROD", deploy: false }];
    const fetcher = ouvrir("#/espaces/finance/environnements", {
      ...FINANCE,
      "GET /api/spaces/finance": () => Promise.resolve(reponse({ status: 200, body: { ...espace.body, environments: droits(accorde) } })),
      "POST /api/spaces/finance/deploy-grants": () => { accorde = true; return Promise.resolve(reponse({ status: 200, body: { ...accord.body, environment: "DEV" } })); },
    });
    await ecran();
    await waitFor(() => { expect(ligne()).toHaveTextContent(/^Déploiement : aucun$/); });
    const formulaire = screen.getByRole("form", { name: "Accorder un droit de déployer" });
    await userEvent.type(within(formulaire).getByRole("textbox", { name: /Nom exact du groupe/ }), "finance-admins");
    await userEvent.click(within(formulaire).getByRole("button", { name: "Accorder le droit" }));
    await waitFor(() => { expect(ligne()).toHaveTextContent(/^Déploiement : DEV$/); });
    expect(within(bascule()).getByRole("button", { name: "DEV" })).toHaveAccessibleDescription("Déploiement autorisé");
    expect(lus(fetcher).filter((cle) => cle === "GET /api/spaces/finance")).toHaveLength(2);
    // La page n'est pas démontée : le bandeau de réponse est toujours là, avec le focus.
    expect(screen.getByText("Groupe finance-admins : droit de déployer en DEV accordé.")).toBeInTheDocument();
    expect(document.querySelector(".sb-members__feedback")).toHaveFocus();
  });

  it("la navigation latérale mène aux membres depuis les environnements", async () => {
    ouvrir("#/espaces/finance/environnements", { ...FINANCE, "GET /api/spaces/finance/events": journal });
    await ecran();
    await userEvent.click(within(nav()).getByRole("button", { name: "Espace & connexions" }));
    await waitFor(() => { expect(window.location.hash).toBe("#/espaces/finance/membres"); });
  });

  it("le lien « Paramètres » d'une carte mène à l'écran des paramètres du même espace, cible gardée (plan 10, 10.4)", async () => {
    ouvrir("#/espaces/finance/environnements");
    await ecran();
    await userEvent.click(within(bascule()).getByRole("button", { name: "PROD" }));
    const carte = within(pipeline()).getByRole("heading", { level: 2, name: /^PROD/ }).closest("li") as HTMLElement;
    await waitFor(() => { expect(carte).toHaveTextContent("incomplet · 2 manquants"); });
    await userEvent.click(within(carte).getByRole("link", { name: "Paramètres de PROD" }));
    await waitFor(() => { expect(window.location.hash).toBe("#/espaces/finance/parametres"); });
    expect(await screen.findByRole("heading", { level: 1, name: "Paramètres" })).toBeInTheDocument();
    expect(filAriane()).toEqual(["Finance", "Paramètres"]);
    expect(await screen.findByRole("table", { name: "Paramètres et valeurs par environnement" })).toBeInTheDocument();
    expect(within(bascule()).getByRole("button", { name: "PROD" })).toHaveAttribute("aria-pressed", "true");
  });

  it("en mode local, les paramètres ne sont pas lus non plus", async () => {
    const fetcher = ouvrir("#/espaces/local/environnements", { "GET /api/me": local, "GET /api/spaces": locale, "GET /api/spaces/local": { status: 200, body: locale.body.spaces[0] } });
    expect(await screen.findByRole("heading", { level: 1, name: "Environnements" })).toBeInTheDocument();
    await act(async () => { await new Promise((fin) => setTimeout(fin, 20)); });
    expect(lus(fetcher).filter((cle) => cle.includes("/parameters"))).toEqual([]);
    expect(screen.queryByRole("link", { name: /^Paramètres de / })).not.toBeInTheDocument();
  });
});
