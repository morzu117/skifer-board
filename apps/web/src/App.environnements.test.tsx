import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import catalogue from "../../../contracts/catalogue/liste.json";
import espace from "../../../contracts/espaces/espace.json";
import introuvable from "../../../contracts/espaces/introuvable.json";
import journal from "../../../contracts/espaces/journal.json";
import liste from "../../../contracts/espaces/liste.json";
import administration from "../../../contracts/espaces/liste-administration.json";
import locale from "../../../contracts/espaces/liste-locale.json";
import membres from "../../../contracts/espaces/membres.json";
import etabli from "../../../contracts/identite/me-etabli.json";
import local from "../../../contracts/identite/me-local.json";
import type { Fetch } from "./identity/api";

import { App } from "./App";

// Environnements dans la coque (plan 09, 9.3) : la bascule marque, dans un espace confirmé par le
// serveur, les environnements où la personne peut déployer ; la ligne « Déploiement » le dit en texte.

type Exemple = { status: number; body: unknown };
type Reponse = Exemple | (() => Promise<Response>);
const reponse = (exemple: Exemple) => (exemple.body === null ? new Response(null, { status: exemple.status }) : Response.json(exemple.body, { status: exemple.status }));
const droits = (dev: boolean, test: boolean, prod: boolean) => [
  { code: "DEV", deploy: dev },
  { code: "TEST", deploy: test },
  { code: "PROD", deploy: prod },
];
/** Finance telle que le serveur la confirme à un créateur qui a un accord en DEV (comme dans la liste). */
const financeCreateur: Exemple = { status: 200, body: { ...espace.body, role: "creator", environments: droits(true, false, false) } };
/** Ressources humaines, confirmée lectrice avec un accord en PROD : sans effet côté serveur (V3), rendu ici tel quel. */
const rhServeur = (environments = droits(false, false, false)): Exemple => ({ status: 200, body: { ...espace.body, id: "rh", name: "Ressources humaines", role: "reader", environments } });
const TABLE: Readonly<Record<string, Reponse>> = {
  "GET /api/me": etabli,
  "GET /api/spaces": liste,
  "GET /api/spaces/finance": financeCreateur,
  "GET /api/spaces/finance/catalog": catalogue,
  "GET /api/spaces/rh": rhServeur(),
  "GET /api/spaces/rh/catalog": catalogue,
  "GET /api/spaces/paie": introuvable,
};
function routeur(table: Readonly<Record<string, Reponse>>): Mock<Fetch> {
  return vi.fn<Fetch>().mockImplementation((url, init) => {
    const cle = `${init?.method ?? "GET"} ${url}`;
    const exemple = table[cle];
    if (exemple === undefined) return Promise.reject(new Error(`appel inattendu : ${cle}`));
    return typeof exemple === "function" ? exemple() : Promise.resolve(reponse(exemple));
  });
}
function ouvrir(hash: string, table: Readonly<Record<string, Reponse>> = TABLE) {
  window.history.replaceState(null, "", `/${hash}`);
  const fetcher = routeur(table);
  render(<App fetcher={fetcher} leave={vi.fn()} />);
  return fetcher;
}
function naviguer(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}
function differee() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((ok) => { resolve = ok; });
  return { promise, resolve };
}
const bascule = () => within(screen.getByRole("banner")).getByRole("group", { name: "Environnement" });
/**
 * Chaque segment, dans l'ordre affiché : « DEV » si sans droit, « DEV · Déploiement autorisé » si le
 * droit est sa description. Le nom accessible est vérifié au passage : c'est toujours le seul code.
 */
const segments = () =>
  within(bascule()).getAllByRole("button").map((segment) => {
    const code = /^(DEV|TEST|PROD)/.exec(segment.textContent)?.[0] ?? "?";
    expect(within(bascule()).getByRole("button", { name: code })).toBe(segment);
    const decrit = segment.getAttribute("aria-describedby");
    return decrit === null ? code : `${code} · ${document.getElementById(decrit)?.textContent ?? "?"}`;
  });
/** Code de l'environnement choisi (`aria-pressed`). */
const choisi = () => within(bascule()).getAllByRole("button").filter((segment) => segment.getAttribute("aria-pressed") === "true").map((segment) => /^(DEV|TEST|PROD)/.exec(segment.textContent)?.[0]);
/** Marques « ● » visibles ; leur place est toujours réservée, vide sans droit. */
const marques = () => [...bascule().querySelectorAll(".sb-env__deploy")].filter((marque) => marque.textContent === "●").length;
const ligne = () => screen.queryByText(/^Déploiement :/);
const SANS_MARQUE = ["DEV", "TEST", "PROD"];
const lus = (fetcher: Mock<Fetch>) => fetcher.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`);

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("Bascule et ligne « Déploiement » dans un espace (plan 09, 9.3)", () => {
  it("un créateur avec un accord en DEV voit DEV marqué, et la ligne le dit", async () => {
    ouvrir("#/espaces/finance/catalogue");
    await screen.findByRole("table");
    await waitFor(() => { expect(ligne()).toHaveTextContent(/^Déploiement : DEV$/); });
    expect(segments()).toEqual(["DEV · Déploiement autorisé", "TEST", "PROD"]);
    expect(within(bascule()).getByRole("button", { name: "DEV" })).toHaveAttribute("aria-pressed", "true");
    expect(marques()).toBe(1);
  });

  it("suit la réponse du serveur pour l'espace, pas la liste : un administrateur sans accord n'a rien (V4)", async () => {
    // La liste dit DEV pour finance ; l'espace confirmé (exemple réel) n'a aucun droit.
    ouvrir("#/espaces/finance/catalogue", { ...TABLE, "GET /api/spaces/finance": espace });
    await screen.findByRole("table");
    await waitFor(() => { expect(screen.getByText(/^Rôle :/)).toHaveTextContent("Rôle : Administrateur"); });
    expect(ligne()).toHaveTextContent(/^Déploiement : aucun$/);
    expect(segments()).toEqual(SANS_MARQUE);
    expect(marques()).toBe(0);
  });

  it("l'administration de la plateforme sans rôle ne déploie pas : aucune marque, « aucun »", async () => {
    ouvrir("#/espaces/finance/catalogue", { ...TABLE, "GET /api/spaces": administration, "GET /api/spaces/finance": { status: 200, body: administration.body.spaces[0] } });
    await screen.findByText(/sans rôle dans cet espace/);
    expect(ligne()).toHaveTextContent(/^Déploiement : aucun$/);
    expect(marques()).toBe(0);
  });

  it("Board ne recalcule pas le droit : un lecteur à qui le serveur dit PROD voit PROD marqué", async () => {
    ouvrir("#/espaces/rh/catalogue", { ...TABLE, "GET /api/spaces/rh": rhServeur(droits(false, false, true)) });
    await screen.findByRole("table");
    await waitFor(() => { expect(ligne()).toHaveTextContent(/^Déploiement : PROD$/); });
    expect(segments()).toEqual(["DEV", "TEST", "PROD · Déploiement autorisé"]);
  });

  it("mode local : les trois environnements sont marqués", async () => {
    ouvrir("#/espaces/local/catalogue", { "GET /api/me": local, "GET /api/spaces": locale, "GET /api/spaces/local": { status: 200, body: locale.body.spaces[0] }, "GET /api/spaces/local/catalog": catalogue });
    await screen.findByRole("table");
    await waitFor(() => { expect(ligne()).toHaveTextContent(/^Déploiement : DEV, TEST, PROD$/); });
    expect(segments()).toEqual(["DEV · Déploiement autorisé", "TEST · Déploiement autorisé", "PROD · Déploiement autorisé"]);
    expect(marques()).toBe(3);
  });

  it("choisir un environnement ne lit rien et ne change pas les marques : c'est un état de la coque", async () => {
    const fetcher = ouvrir("#/espaces/finance/catalogue");
    await screen.findByRole("table");
    await waitFor(() => { expect(marques()).toBe(1); });
    const avant = lus(fetcher).length;
    await userEvent.click(within(bascule()).getByRole("button", { name: "PROD" }));
    expect(choisi()).toEqual(["PROD"]);
    await userEvent.click(within(bascule()).getByRole("button", { name: "DEV" }));
    expect(choisi()).toEqual(["DEV"]);
    await userEvent.click(within(bascule()).getByRole("button", { name: "TEST" }));
    expect(segments()).toEqual(["DEV · Déploiement autorisé", "TEST", "PROD"]);
    expect(ligne()).toHaveTextContent(/^Déploiement : DEV$/);
    await act(async () => { await new Promise((fin) => setTimeout(fin, 20)); });
    expect(lus(fetcher)).toHaveLength(avant);
    expect(window.location.hash).toBe("#/espaces/finance/catalogue");
  });
});

describe("Hors d'un espace, la bascule reste sans marque (plan 09, 9.3)", () => {
  it.each([
    ["l'accueil", "#/", () => screen.findByRole("list", { name: "Espaces" })],
    ["la création d'un espace", "#/nouvel-espace", () => screen.findByText("Seuls les administrateurs de la plateforme créent des espaces.")],
    ["le prototype", "#/prototype", () => screen.findByRole("heading", { level: 1, name: "Prototype graphique" })],
    ["un espace introuvable", "#/espaces/paie/catalogue", () => screen.findByRole("heading", { level: 1, name: "Espace introuvable" })],
    ["un identifiant hors format", "#/espaces/Paie/catalogue", () => screen.findByRole("heading", { level: 1, name: "Espace introuvable" })],
  ])("%s : aucune marque ni ligne « Déploiement »", async (_cas, hash, attendre) => {
    ouvrir(hash);
    await attendre();
    // La liste (où finance a DEV) est lue : elle ne marque rien hors d'un espace.
    await screen.findByRole("option", { name: "Finance" });
    expect(segments()).toEqual(SANS_MARQUE);
    expect(marques()).toBe(0);
    expect(ligne()).not.toBeInTheDocument();
    // Aucun segment n'est décrit comme autorisé ; la place de la marque reste réservée, vide.
    expect(bascule().querySelectorAll("[aria-describedby]")).toHaveLength(0);
    expect(bascule().querySelectorAll(".sb-env__deploy")).toHaveLength(3);
  });

  it.each([
    ["HTTP 500", { status: 500, body: {} }],
    ["environnements dans un autre ordre", { status: 200, body: { ...espace.body, environments: [...droits(true, true, true)].reverse() } }],
    ["environnements absents", { status: 200, body: { ...espace.body, environments: undefined } }],
    ["quatre environnements", { status: 200, body: { ...espace.body, environments: [...droits(true, true, true), { code: "PROD", deploy: true }] } }],
  ] as [string, Exemple][])("un espace indisponible (%s) n'a ni marque ni ligne : fail-closed", async (_cas, exemple) => {
    ouvrir("#/espaces/finance/catalogue", { ...TABLE, "GET /api/spaces/finance": exemple });
    expect(await screen.findByRole("heading", { level: 1, name: "Espace indisponible" })).toBeInTheDocument();
    expect(marques()).toBe(0);
    expect(ligne()).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("pendant la lecture de l'espace, rien n'est marqué", async () => {
    const attente = differee();
    ouvrir("#/espaces/finance/catalogue", { ...TABLE, "GET /api/spaces/finance": () => attente.promise });
    expect(await screen.findByText("Lecture de l'espace…")).toBeInTheDocument();
    await screen.findByRole("option", { name: "Finance" });
    expect(marques()).toBe(0);
    expect(ligne()).not.toBeInTheDocument();
    await act(async () => { attente.resolve(reponse(financeCreateur)); await Promise.resolve(); });
    await waitFor(() => { expect(marques()).toBe(1); });
  });

  it("quitter l'espace pour l'accueil retire les marques et la ligne", async () => {
    ouvrir("#/espaces/finance/catalogue");
    await waitFor(() => { expect(marques()).toBe(1); });
    naviguer("#/");
    await screen.findByRole("list", { name: "Espaces" });
    await waitFor(() => { expect(marques()).toBe(0); });
    expect(ligne()).not.toBeInTheDocument();
  });
});

describe("Les marques suivent l'espace et ses relectures (plan 09, 9.3)", () => {
  it("changer d'espace : les marques suivent, sans garder celles de l'espace précédent pendant la lecture", async () => {
    const rh = differee();
    ouvrir("#/espaces/finance/catalogue", { ...TABLE, "GET /api/spaces/rh": () => rh.promise });
    await screen.findByRole("table");
    await waitFor(() => { expect(marques()).toBe(1); });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Espace" }), "rh");
    await waitFor(() => { expect(window.location.hash).toBe("#/espaces/rh/catalogue"); });
    await screen.findByText("Lecture de l'espace…");
    expect(marques()).toBe(0);
    expect(ligne()).not.toBeInTheDocument();
    await act(async () => { rh.resolve(reponse(rhServeur(droits(false, true, true)))); await Promise.resolve(); });
    await waitFor(() => { expect(ligne()).toHaveTextContent(/^Déploiement : TEST, PROD$/); });
    expect(segments()).toEqual(["DEV", "TEST · Déploiement autorisé", "PROD · Déploiement autorisé"]);
  });

  it("l'environnement choisi est conservé en changeant d'espace, et hors d'un espace", async () => {
    ouvrir("#/espaces/finance/catalogue");
    await waitFor(() => { expect(marques()).toBe(1); });
    await userEvent.click(within(bascule()).getByRole("button", { name: "PROD" }));
    naviguer("#/espaces/rh/catalogue");
    await waitFor(() => { expect(ligne()).toHaveTextContent(/^Déploiement : aucun$/); });
    expect(choisi()).toEqual(["PROD"]);
    naviguer("#/");
    await screen.findByRole("list", { name: "Espaces" });
    expect(choisi()).toEqual(["PROD"]);
    naviguer("#/espaces/finance/catalogue");
    await waitFor(() => { expect(marques()).toBe(1); });
    expect(choisi()).toEqual(["PROD"]);
    expect(within(bascule()).getByRole("button", { name: "PROD" })).toHaveAttribute("aria-pressed", "true");
  });

  it("après une écriture, l'espace relu change les marques : gagnées puis perdues", async () => {
    let etat = 0;
    const etats = [droits(false, false, false), droits(true, false, true), droits(false, false, false)];
    const fetcher = ouvrir("#/espaces/finance/membres", {
      ...TABLE,
      "GET /api/spaces/finance": () => Promise.resolve(reponse({ status: 200, body: { ...espace.body, environments: etats[etat] } })),
      "GET /api/spaces/finance/members": membres,
      "GET /api/spaces/finance/events": journal,
      "POST /api/spaces/finance/members": () => { etat += 1; return Promise.resolve(reponse({ status: 200, body: { ...membres.body.members[1], role: "creator" } })); },
    });
    await screen.findByRole("table", { name: "Liaisons de l'espace" });
    await waitFor(() => { expect(ligne()).toHaveTextContent(/^Déploiement : aucun$/); });
    expect(marques()).toBe(0);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Rôle de Dominique Leroy" }), "creator");
    await userEvent.click(screen.getByRole("button", { name: "Confirmer" }));
    await waitFor(() => { expect(ligne()).toHaveTextContent(/^Déploiement : DEV, PROD$/); });
    expect(segments()).toEqual(["DEV · Déploiement autorisé", "TEST", "PROD · Déploiement autorisé"]);
    // La liste des membres simulée ne change pas : Dominique reste lectrice, l'écriture se refait.
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Rôle de Dominique Leroy" }), "creator");
    await userEvent.click(screen.getByRole("button", { name: "Confirmer" }));
    await waitFor(() => { expect(ligne()).toHaveTextContent(/^Déploiement : aucun$/); });
    expect(marques()).toBe(0);
    expect(lus(fetcher).filter((cle) => cle === "GET /api/spaces/finance")).toHaveLength(3);
  });
});
