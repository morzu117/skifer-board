import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import catalogue from "../../../contracts/catalogue/liste.json";
import creation from "../../../contracts/espaces/creation.json";
import espace from "../../../contracts/espaces/espace.json";
import interdit from "../../../contracts/espaces/interdit.json";
import introuvable from "../../../contracts/espaces/introuvable.json";
import journal from "../../../contracts/espaces/journal.json";
import liste from "../../../contracts/espaces/liste.json";
import administration from "../../../contracts/espaces/liste-administration.json";
import locale from "../../../contracts/espaces/liste-locale.json";
import membres from "../../../contracts/espaces/membres.json";
import retrait from "../../../contracts/espaces/retrait.json";
import etabli from "../../../contracts/identite/me-etabli.json";
import local from "../../../contracts/identite/me-local.json";
import type { Fetch } from "./identity/api";
import { decodeSpace, type Space } from "./spaces/model";

import { App, sectionsFor } from "./App";

type Exemple = { status: number; body: unknown };
type Reponse = Exemple | (() => Promise<Response>);
const reponse = (exemple: Exemple) => (exemple.body === null ? new Response(null, { status: exemple.status }) : Response.json(exemple.body, { status: exemple.status }));
const FINANCE: Readonly<Record<string, Reponse>> = {
  "GET /api/me": etabli,
  "GET /api/spaces": liste,
  "GET /api/spaces/finance": espace,
  "GET /api/spaces/finance/catalog": catalogue,
  "GET /api/spaces/finance/members": membres,
  "GET /api/spaces/finance/events": journal,
};
/** Serveur simulé par « MÉTHODE adresse » ; toute autre requête est inattendue. */
function routeur(table: Readonly<Record<string, Reponse>>): Mock<Fetch> {
  return vi.fn<Fetch>().mockImplementation((url, init) => {
    const cle = `${init?.method ?? "GET"} ${url}`;
    const exemple = table[cle];
    if (exemple === undefined) return Promise.reject(new Error(`appel inattendu : ${cle}`));
    return typeof exemple === "function" ? exemple() : Promise.resolve(reponse(exemple));
  });
}
function ouvrir(hash: string, table: Readonly<Record<string, Reponse>>) {
  window.history.replaceState(null, "", `/${hash}`);
  const fetcher = routeur(table);
  render(<App fetcher={fetcher} leave={vi.fn()} />);
  return fetcher;
}
const lus = (fetcher: Mock<Fetch>) => fetcher.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`);
const filAriane = () => within(screen.getByRole("navigation", { name: "Fil d'Ariane" })).getAllByRole("listitem").map((item) => item.textContent);
const nav = () => screen.getByRole("navigation", { name: "Navigation principale" });
const entree = (nom: string) => within(nav()).getByText(nom).closest("li") as HTMLElement;
const pastille = () => screen.queryByText(/^Rôle :/);

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("Entrées de la navigation selon l'espace (plan 08, 8.4)", () => {
  const base = decodeSpace(espace.body, "espace");
  const de = (role: Space["role"], implicit = false): Space => ({ ...base, role, implicit });
  const resume = (space: Space | null, plateforme: boolean) => {
    const { available, pending } = sectionsFor(space, plateforme);
    return { available: [...available].sort(), pending };
  };

  it("hors d'un espace confirmé, le catalogue et les membres se lisent « dans un espace »", () => {
    for (const plateforme of [false, true]) {
      expect(resume(null, plateforme)).toEqual({ available: [], pending: { catalogue: "dans un espace", explorer: "dans un espace", analyses: "dans un espace", espace: "dans un espace" } });
    }
  });

  it.each([
    ["admin", false, ["analyses", "catalogue", "espace", "explorer"], {}],
    ["admin", true, ["analyses", "catalogue", "espace", "explorer"], {}],
    ["creator", false, ["analyses", "catalogue", "explorer"], { espace: "administrateurs" }],
    ["reader", false, ["analyses", "catalogue", "explorer"], { espace: "administrateurs" }],
    ["reader", true, ["analyses", "catalogue", "espace", "explorer"], {}],
    [null, true, ["espace"], { catalogue: "sans rôle", explorer: "sans rôle", analyses: "sans rôle" }],
    // Un espace confirmé sans rôle ne l'est qu'à l'administration de la plateforme (E6) : l'entrée est
    // offerte même avant que la liste l'ait confirmé, et le serveur reste seul juge.
    [null, false, ["espace"], { catalogue: "sans rôle", explorer: "sans rôle", analyses: "sans rôle" }],
  ] as [Space["role"], boolean, string[], object][])("rôle %s, plateforme %s", (role, plateforme, available, pending) => {
    expect(resume(de(role), plateforme)).toEqual({ available, pending });
  });

  it("l'espace implicite du mode local : catalogue livré, membres « mode local »", () => {
    for (const plateforme of [false, true]) {
      expect(resume(de("admin", true), plateforme)).toEqual({ available: ["catalogue"], pending: { espace: "mode local", explorer: "mode local", analyses: "mode local" } });
    }
  });
});

describe("Membres et rôles dans la coque (plan 08, 8.4)", () => {
  it("#/espaces/<id>/membres ouvre l'écran, avec son fil d'Ariane et l'entrée courante", async () => {
    const fetcher = ouvrir("#/espaces/finance/membres", FINANCE);
    expect(await screen.findByRole("heading", { level: 1, name: "Membres et rôles" })).toBeInTheDocument();
    await screen.findByRole("table", { name: "Liaisons de l'espace" });
    expect(filAriane()).toEqual(["Finance", "Membres et rôles"]);
    expect(within(nav()).getByRole("button", { name: "Espace & connexions" })).toHaveAttribute("aria-current", "page");
    expect(within(nav()).getByRole("button", { name: "Catalogue Atlas" })).not.toHaveAttribute("aria-current");
    expect(pastille()).toHaveTextContent("Rôle : Administrateur");
    expect(lus(fetcher)).toEqual(expect.arrayContaining(["GET /api/spaces/finance", "GET /api/spaces/finance/members", "GET /api/spaces/finance/events"]));
    expect(lus(fetcher).filter((cle) => cle.includes("catalog"))).toEqual([]);
  });

  it("la navigation passe du catalogue aux membres et retour, dans le même espace", async () => {
    ouvrir("#/espaces/finance/catalogue", FINANCE);
    await screen.findByRole("table");
    await userEvent.click(within(nav()).getByRole("button", { name: "Espace & connexions" }));
    await waitFor(() => { expect(window.location.hash).toBe("#/espaces/finance/membres"); });
    expect(await screen.findByRole("heading", { level: 1, name: "Membres et rôles" })).toBeInTheDocument();
    await userEvent.click(within(nav()).getByRole("button", { name: "Catalogue Atlas" }));
    await waitFor(() => { expect(window.location.hash).toBe("#/espaces/finance/catalogue"); });
    expect(await screen.findByRole("heading", { level: 1, name: "Catalogue Atlas" })).toBeInTheDocument();
  });

  it("un créateur voit l'entrée fermée « administrateurs » ; l'adresse directe rend le refus du serveur", async () => {
    const createur = { status: 200, body: { ...espace.body, role: "creator" } };
    const fetcher = ouvrir("#/espaces/finance/membres", { ...FINANCE, "GET /api/spaces/finance": createur, "GET /api/spaces/finance/members": interdit, "GET /api/spaces/finance/events": interdit });
    await waitFor(() => { expect(screen.getAllByRole("alert")).toHaveLength(2); });
    for (const alerte of screen.getAllByRole("alert")) expect(alerte).toHaveTextContent("Votre rôle ne permet pas cette action.");
    expect(entree("Espace & connexions")).toHaveTextContent("Espace & connexionsadministrateurs");
    expect(within(nav()).queryByRole("button", { name: "Espace & connexions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Ajouter une liaison" })).not.toBeInTheDocument();
    expect(lus(fetcher).filter((cle) => cle.startsWith("POST") || cle.startsWith("DELETE"))).toEqual([]);
  });

  it("l'administration de la plateforme sans rôle gère les membres, catalogue fermé « sans rôle »", async () => {
    ouvrir("#/espaces/finance", { ...FINANCE, "GET /api/spaces": administration, "GET /api/spaces/finance": { status: 200, body: { ...espace.body, role: null } } });
    const lien = await screen.findByRole("link", { name: "Gérer les membres" });
    expect(entree("Explorer")).toHaveTextContent("Explorersans rôle");
    expect(entree("Catalogue Atlas")).toHaveTextContent("Catalogue Atlassans rôle");
    await userEvent.click(lien);
    expect(await screen.findByRole("heading", { level: 1, name: "Membres et rôles" })).toBeInTheDocument();
    await screen.findByRole("table", { name: "Liaisons de l'espace" });
    expect(filAriane()).toEqual(["Finance", "Membres et rôles"]);
    await waitFor(() => { expect(within(nav()).getByRole("button", { name: "Espace & connexions" })).toHaveAttribute("aria-current", "page"); });
    expect(pastille()).toHaveTextContent("Rôle : Administration de la plateforme");
  });

  it.each([
    ["en cours de lecture", () => new Promise<Response>(() => undefined)],
    ["en panne", () => Promise.resolve(reponse({ status: 500, body: {} }))],
  ])("sans rôle, l'entrée « Espace & connexions » est offerte même si la liste est %s", async (_cas, lireListe) => {
    ouvrir("#/espaces/finance/membres", { ...FINANCE, "GET /api/spaces": lireListe, "GET /api/spaces/finance": { status: 200, body: { ...espace.body, role: null } } });
    await screen.findByRole("table", { name: "Liaisons de l'espace" });
    expect(within(nav()).getByRole("button", { name: "Espace & connexions" })).toHaveAttribute("aria-current", "page");
    expect(entree("Catalogue Atlas")).toHaveTextContent("Catalogue Atlassans rôle");
  });

  it("en mode local, la page dit que l'espace implicite ne se gère pas, sans rien lire", async () => {
    const fetcher = ouvrir("#/espaces/local/membres", { "GET /api/me": local, "GET /api/spaces": locale, "GET /api/spaces/local": { status: 200, body: locale.body.spaces[0] } });
    expect(await screen.findByRole("heading", { level: 1, name: "Membres et rôles" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("En mode local, sans fournisseur d'identité, l'espace est implicite et vous en êtes l'administrateur : ses membres ne se gèrent pas.");
    expect(entree("Espace & connexions")).toHaveTextContent("Espace & connexionsmode local");
    expect(entree("Explorer")).toHaveTextContent("Explorermode local");
    expect(within(nav()).getByRole("button", { name: "Catalogue Atlas" })).toBeInTheDocument();
    expect(lus(fetcher).filter((cle) => cle.includes("/members") || cle.includes("/events"))).toEqual([]);
  });

  it.each([
    ["inconnu ou refusé", "#/espaces/paie/membres", { "GET /api/spaces/paie": introuvable }],
    ["hors format", "#/espaces/Paie/membres", {}],
  ])("un espace %s s'affiche « Espace introuvable », sans lecture des membres", async (_cas, hash, table) => {
    const fetcher = ouvrir(hash, { ...FINANCE, ...table });
    expect(await screen.findByRole("heading", { level: 1, name: "Espace introuvable" })).toBeInTheDocument();
    expect(filAriane()).toEqual(["Espace introuvable"]);
    expect(lus(fetcher).filter((cle) => cle.includes("/members") || cle.includes("/events"))).toEqual([]);
    expect(entree("Espace & connexions")).toHaveTextContent("dans un espace");
  });

  it("un espace indisponible n'ouvre pas les membres", async () => {
    const fetcher = ouvrir("#/espaces/finance/membres", { ...FINANCE, "GET /api/spaces/finance": { status: 500, body: {} } });
    expect(await screen.findByRole("heading", { level: 1, name: "Espace indisponible" })).toBeInTheDocument();
    expect(lus(fetcher).filter((cle) => cle.includes("/members"))).toEqual([]);
  });

  it("se retirer soi-même son seul accès ramène à « Espace introuvable » (E4)", async () => {
    let retire = false;
    const idDominique = membres.body.members[1]?.id ?? "";
    const fetcher = ouvrir("#/espaces/finance/membres", {
      ...FINANCE,
      "GET /api/spaces/finance": () => Promise.resolve(reponse(retire ? introuvable : espace)),
      "GET /api/spaces/finance/members": () => Promise.resolve(reponse(retire ? introuvable : membres)),
      "GET /api/spaces/finance/events": () => Promise.resolve(reponse(retire ? introuvable : journal)),
      [`DELETE /api/spaces/finance/members/${idDominique}`]: () => { retire = true; return Promise.resolve(reponse(retrait)); },
    });
    await screen.findByRole("table", { name: "Liaisons de l'espace" });
    await userEvent.click(screen.getByRole("button", { name: "Retirer Dominique Leroy" }));
    await userEvent.click(screen.getByRole("button", { name: "Retirer" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Espace introuvable" })).toBeInTheDocument();
    expect(pastille()).not.toBeInTheDocument();
    // Lecture initiale, relecture après l'écriture (`onWritten`), puis relecture de l'espace perdu.
    expect(lus(fetcher).filter((cle) => cle === "GET /api/spaces/finance")).toHaveLength(3);
  });

  // S'abaisser soi-même : la coque relit l'espace après l'écriture, la pastille et l'entrée suivent
  // le rôle que le serveur confirme désormais.
  it("la pastille suit le rôle après s'être abaissé soi-même", async () => {
    let abaisse = false;
    ouvrir("#/espaces/finance/membres", {
      ...FINANCE,
      "GET /api/spaces/finance": () => Promise.resolve(reponse(abaisse ? { status: 200, body: { ...espace.body, role: "reader" } } : espace)),
      "GET /api/spaces/finance/members": () => Promise.resolve(reponse(abaisse ? interdit : membres)),
      "GET /api/spaces/finance/events": () => Promise.resolve(reponse(abaisse ? interdit : journal)),
      "POST /api/spaces/finance/members": () => { abaisse = true; return Promise.resolve(reponse({ status: 200, body: { ...membres.body.members[1], role: "reader" } })); },
    });
    await screen.findByRole("table", { name: "Liaisons de l'espace" });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Rôle de Groupe finance-admins" }), "reader");
    await userEvent.click(screen.getByRole("button", { name: "Confirmer" }));
    await waitFor(() => { expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(1); });
    await waitFor(() => { expect(pastille()).toHaveTextContent("Rôle : Lecteur"); });
    expect(entree("Espace & connexions")).toHaveTextContent("Espace & connexionsadministrateurs");
    expect(within(nav()).queryByRole("button", { name: "Espace & connexions" })).not.toBeInTheDocument();
    // La page reste là et rend le refus du serveur, sans liste ni ajout.
    expect(screen.getByRole("heading", { level: 1, name: "Membres et rôles" })).toBeInTheDocument();
    await waitFor(() => { expect(screen.queryByRole("table", { name: "Liaisons de l'espace" })).not.toBeInTheDocument(); });
    expect(screen.queryByRole("form", { name: "Ajouter une liaison" })).not.toBeInTheDocument();
  });

  it("après une écriture, la liste et l'espace sont relus sans que la page se démonte", async () => {
    let ecrit = false;
    const espaceRelu = (() => {
      let resolve!: (response: Response) => void;
      const promise = new Promise<Response>((ok) => { resolve = ok; });
      return { promise, resolve };
    })();
    const fetcher = ouvrir("#/espaces/finance/membres", {
      ...FINANCE,
      "GET /api/spaces/finance": () => (ecrit ? espaceRelu.promise : Promise.resolve(reponse(espace))),
      "POST /api/spaces/finance/members": () => { ecrit = true; return Promise.resolve(reponse({ status: 200, body: { ...membres.body.members[1], role: "creator" } })); },
    });
    await screen.findByRole("table", { name: "Liaisons de l'espace" });
    const avant = { liste: lus(fetcher).filter((cle) => cle === "GET /api/spaces").length, espace: lus(fetcher).filter((cle) => cle === "GET /api/spaces/finance").length };
    const formulaire = screen.getByRole("form", { name: "Ajouter une liaison" });
    await userEvent.type(within(formulaire).getByRole("textbox", { name: /Nom exact du groupe/ }), "brouillon");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Rôle de Dominique Leroy" }), "creator");
    await userEvent.click(screen.getByRole("button", { name: "Confirmer" }));
    await waitFor(() => { expect(lus(fetcher).filter((cle) => cle === "GET /api/spaces/finance")).toHaveLength(avant.espace + 1); });
    expect(lus(fetcher).filter((cle) => cle === "GET /api/spaces")).toHaveLength(avant.liste + 1);
    // Pendant la relecture de l'espace, l'ancienne réponse reste : la page, sa saisie et la pastille restent.
    expect(screen.getByRole("heading", { level: 1, name: "Membres et rôles" })).toBeInTheDocument();
    expect(pastille()).toHaveTextContent("Rôle : Administrateur");
    expect(screen.getByRole("form", { name: "Ajouter une liaison" })).toBe(formulaire);
    expect(within(formulaire).getByRole("textbox", { name: /Nom exact du groupe/ })).toHaveValue("brouillon");
    await act(async () => { espaceRelu.resolve(reponse({ status: 200, body: { ...espace.body, role: "creator" } })); await Promise.resolve(); });
    await waitFor(() => { expect(pastille()).toHaveTextContent("Rôle : Créateur"); });
  });

  it("changer d'espace ne garde pas l'ancienne réponse : le nouvel espace se lit de zéro", async () => {
    const rhRelu = (() => {
      let resolve!: (response: Response) => void;
      const promise = new Promise<Response>((ok) => { resolve = ok; });
      return { promise, resolve };
    })();
    ouvrir("#/espaces/finance/membres", { ...FINANCE, "GET /api/spaces/rh": () => rhRelu.promise });
    await screen.findByRole("table", { name: "Liaisons de l'espace" });
    act(() => { window.location.hash = "#/espaces/rh/membres"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    await waitFor(() => { expect(screen.queryByRole("table", { name: "Liaisons de l'espace" })).not.toBeInTheDocument(); });
    expect(pastille()).not.toBeInTheDocument();
  });
});

describe("Création d'un espace dans la coque (plan 08, 8.4)", () => {
  it("l'accueil mène à #/nouvel-espace ; la création ouvre les membres de l'espace créé", async () => {
    const fetcher = ouvrir("#/", {
      ...FINANCE,
      "GET /api/spaces": administration,
      "POST /api/spaces": creation,
      "GET /api/spaces/finance": { status: 200, body: { ...espace.body, role: null } },
    });
    await userEvent.click(await screen.findByRole("link", { name: "Créer un espace" }));
    await waitFor(() => { expect(window.location.hash).toBe("#/nouvel-espace"); });
    expect(await screen.findByRole("heading", { level: 1, name: "Nouvel espace" })).toBeInTheDocument();
    expect(filAriane()).toEqual(["Vos espaces", "Nouvel espace"]);
    expect(entree("Espace & connexions")).toHaveTextContent("dans un espace");
    const formulaire = await screen.findByRole("form", { name: "Créer un espace" });
    await userEvent.type(within(formulaire).getByRole("textbox", { name: /^Identifiant/ }), "finance");
    await userEvent.type(within(formulaire).getByRole("textbox", { name: /^Nom affiché/ }), "Finance");
    await userEvent.type(within(formulaire).getByRole("textbox", { name: /Nom exact du groupe/ }), "finance-admins");
    await userEvent.click(within(formulaire).getByRole("button", { name: "Créer l'espace" }));
    await waitFor(() => { expect(window.location.hash).toBe("#/espaces/finance/membres"); });
    expect(await screen.findByRole("heading", { level: 1, name: "Membres et rôles" })).toBeInTheDocument();
    await screen.findByRole("table", { name: "Liaisons de l'espace" });
    expect(filAriane()).toEqual(["Finance", "Membres et rôles"]);
    expect(lus(fetcher).filter((cle) => cle === "POST /api/spaces")).toHaveLength(1);
  });

  it("#/nouvel-espace sans administration de la plateforme ne propose pas de formulaire", async () => {
    const fetcher = ouvrir("#/nouvel-espace", FINANCE);
    expect(await screen.findByText("Seuls les administrateurs de la plateforme créent des espaces.")).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(lus(fetcher).filter((cle) => cle.startsWith("POST"))).toEqual([]);
  });

  it("#/nouvel-espace en mode local le dit", async () => {
    ouvrir("#/nouvel-espace", { "GET /api/me": local, "GET /api/spaces": locale });
    expect(await screen.findByText("En mode local, Board n'a qu'un espace implicite : on n'en crée pas d'autre.")).toBeInTheDocument();
  });

  it("#/nouvel-espace attend la liste avant de décider", async () => {
    let liberer: (value: Response) => void = () => undefined;
    ouvrir("#/nouvel-espace", { ...FINANCE, "GET /api/spaces": () => new Promise<Response>((fin) => { liberer = fin; }) });
    expect(await screen.findByText("Lecture de vos droits…")).toBeInTheDocument();
    await act(async () => { liberer(reponse(administration)); await Promise.resolve(); });
    expect(await screen.findByRole("form", { name: "Créer un espace" })).toBeInTheDocument();
  });
});

it("ouvre Explorer depuis la navigation de l'espace", async () => {
  ouvrir("#/espaces/finance/catalogue", FINANCE);
  await screen.findByRole("heading", { name: "Catalogue Atlas" });
  await userEvent.click(within(nav()).getByRole("button", { name: "Explorer" }));
  expect(await screen.findByRole("heading", { name: "Explorer", level: 1 })).toBeInTheDocument();
  expect(filAriane()).toEqual(["Finance", "Explorer"]);
  expect(window.location.hash).toBe("#/espaces/finance/explorer");
});

describe("Analyses dans la navigation de l'espace (plan 18, 18.5a)", () => {
  const ID = "5f1d7c52-3b0e-4d36-9a54-0c7a3e1b9d20";
  const ROOT = "GET /api/spaces/finance/analyses";
  const AVEC_ANALYSES = { ...FINANCE, [ROOT]: { status: 200, body: { analyses: [], unreadable: 0 } } };

  it("ouvre la liste depuis la navigation, avec son fil d'Ariane et l'entrée active", async () => {
    ouvrir("#/espaces/finance/catalogue", AVEC_ANALYSES);
    await screen.findByRole("heading", { name: "Catalogue Atlas" });
    await userEvent.click(within(nav()).getByRole("button", { name: "Analyses" }));
    expect(await screen.findByRole("heading", { name: "Analyses", level: 1 })).toBeInTheDocument();
    expect(await screen.findByText("Aucune analyse à afficher pour vous dans cet espace")).toBeInTheDocument();
    expect(filAriane()).toEqual(["Finance", "Analyses"]);
    expect(window.location.hash).toBe("#/espaces/finance/analyses");
    expect(within(nav()).getByRole("button", { name: "Analyses" })).toHaveAttribute("aria-current", "page");
  });

  it("ouvre la fiche d'une analyse par son adresse, l'entrée Analyses reste active et l'ouverture est consignée", async () => {
    const fetcher = ouvrir(`#/espaces/finance/analyses/${ID}`, {
      ...FINANCE,
      [`GET /api/spaces/finance/analyses/${ID}`]: {
        status: 200,
        body: { ...analyseLue(ID) },
      },
      [`POST /api/spaces/finance/analyses/${ID}/opened`]: { status: 202, body: { recorded: true } },
    });
    expect(await screen.findByRole("heading", { name: "Chiffre d'affaires", level: 1 })).toBeInTheDocument();
    expect(filAriane()).toEqual(["Finance", "Analyses", "Fiche analyse"]);
    expect(within(nav()).getByRole("button", { name: "Analyses" })).toHaveAttribute("aria-current", "page");
    await waitFor(() => { expect(lus(fetcher)).toContain(`POST /api/spaces/finance/analyses/${ID}/opened`); });
  });

  it("une révision numérotée dans l'adresse lit cette révision", async () => {
    const fetcher = ouvrir(`#/espaces/finance/analyses/${ID}/revisions/1`, {
      ...FINANCE,
      [`GET /api/spaces/finance/analyses/${ID}/revisions/1`]: { status: 200, body: analyseLue(ID) },
      [`POST /api/spaces/finance/analyses/${ID}/opened`]: { status: 202, body: { recorded: true } },
    });
    expect(await screen.findByRole("heading", { name: "Chiffre d'affaires", level: 1 })).toBeInTheDocument();
    expect(lus(fetcher)).toContain(`GET /api/spaces/finance/analyses/${ID}/revisions/1`);
  });

  it("l'adresse d'historique ouvre l'onglet Révisions de la fiche", async () => {
    ouvrir(`#/espaces/finance/analyses/${ID}/historique`, {
      ...FINANCE,
      [`GET /api/spaces/finance/analyses/${ID}`]: { status: 200, body: analyseLue(ID) },
      [`POST /api/spaces/finance/analyses/${ID}/opened`]: { status: 202, body: { recorded: true } },
      [`GET /api/spaces/finance/analyses/${ID}/revisions`]: { status: 500, body: {} },
    });
    expect(await screen.findByRole("tab", { name: "Révisions" })).toHaveAttribute("aria-selected", "true");
  });

  it("l'adresse de l'Explorateur sur une analyse l'ouvre, l'entrée Explorer reste active", async () => {
    ouvrir(`#/espaces/finance/explorer/analyses/${ID}`, {
      ...FINANCE,
      "GET /api/spaces/finance/explorer/connections": { status: 200, body: { connections: ["finance"] } },
      "GET /api/spaces/finance/explorer/fields": { status: 200, body: { models: [{ name: "sales", label: "Ventes", description: "Ventes", metrics: [{ name: "revenue", label: "Chiffre d'affaires", description: "Montant", aggregation: "sum", additivity: "additive" }], dimensions: [{ name: "region", label: "Région", description: "Région", type: "string", is_time: false }] }] } },
      [`GET /api/spaces/finance/analyses/${ID}`]: { status: 200, body: analyseLue(ID) },
    });
    expect(await screen.findByText(/Exploration à partir de « Chiffre d'affaires », révision 1/)).toBeInTheDocument();
    expect(within(nav()).getByRole("button", { name: "Explorer" })).toHaveAttribute("aria-current", "page");
  });

  it("changer d'analyse relit la fiche (clé par identifiant et révision)", async () => {
    const AUTRE = "0b9e4a77-1c3d-4e58-b2f6-7a8d9c0e1f23";
    const fetcher = ouvrir(`#/espaces/finance/analyses/${ID}`, {
      ...FINANCE,
      [`GET /api/spaces/finance/analyses/${ID}`]: { status: 200, body: analyseLue(ID) },
      [`POST /api/spaces/finance/analyses/${ID}/opened`]: { status: 202, body: { recorded: true } },
      [`GET /api/spaces/finance/analyses/${AUTRE}`]: { status: 200, body: analyseLue(AUTRE, "Autre analyse") },
      [`POST /api/spaces/finance/analyses/${AUTRE}/opened`]: { status: 202, body: { recorded: true } },
    });
    await screen.findByRole("heading", { name: "Chiffre d'affaires", level: 1 });
    act(() => { window.location.hash = `#/espaces/finance/analyses/${AUTRE}`; });
    expect(await screen.findByRole("heading", { name: "Autre analyse", level: 1 })).toBeInTheDocument();
    expect(lus(fetcher)).toContain(`POST /api/spaces/finance/analyses/${AUTRE}/opened`);
  });
});

function analyseLue(id: string, name = "Chiffre d'affaires") {
  const person = { issuer: "https://id.example.invalid", subject: "cora" };
  return {
    id, space_id: "finance", revision: 1, current_revision: 1, commit: "0123456789abcdef0123456789abcdef01234567", committed_at: "2026-01-15T12:00:00+00:00", revised_by: person, state: "ready", unresolved: [],
    permissions: { owner: false, revise: false, delete: false, duplicate: false },
    analysis: { api_version: "board.analysis/v1", id, name, description: "Suivi.", visibility: "shared", owner: person, query: { connection: "finance", model: "sales", metrics: ["revenue"], dimensions: ["region"], filters: [] }, contextual: [], presentation: { chart: "bars" } },
  };
}
