import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import fenetreInvalide from "../../../../contracts/telemetrie/fenetre-invalide.json";
import interdit from "../../../../contracts/telemetrie/interdit.json";
import lecture7j from "../../../../contracts/telemetrie/lecture-7j.json";
import lecture from "../../../../contracts/telemetrie/lecture.json";
import modeLocal from "../../../../contracts/telemetrie/mode-local.json";
import vide from "../../../../contracts/telemetrie/vide.json";
import type { Fetch } from "../spaces/api";
import { TelemetryPage } from "./TelemetryPage";

// Écran « Télémétrie » (plan 11, T8 ; 11.4). Les réponses simulées sont les exemples du serveur
// réel (contracts/telemetrie) ; toute autre requête est inattendue.

type Exemple = { status: number; body: unknown };
type Reponse = Exemple | (() => Promise<Response>);
type Brut = Record<string, unknown>;
const URL_24H = "/api/telemetry?window=24h";
const URL_7J = "/api/telemetry?window=7d";
const URL_30J = "/api/telemetry?window=30d";
const MAINTENANT = new Date("2026-11-03T12:00:00Z");
const plain = (text: string | null | undefined): string => (text ?? "").replace(/[\u00a0\u202f]/g, " ");
const reponse = (exemple: Exemple) => Response.json(exemple.body, { status: exemple.status });
const jamais = () => new Promise<Response>(() => undefined);

function serveur(table: Readonly<Record<string, Reponse>>): Mock<Fetch> {
  return vi.fn<Fetch>().mockImplementation((url, init) => {
    if ((init?.method ?? "GET") !== "GET") return Promise.reject(new Error(`écriture inattendue : ${url}`));
    const exemple = table[url];
    if (exemple === undefined) return Promise.reject(new Error(`appel inattendu : ${url}`));
    return typeof exemple === "function" ? exemple() : Promise.resolve(reponse(exemple));
  });
}
function differee() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((ok) => { resolve = ok; });
  return { promise, resolve };
}
const ouvrir = (table: Readonly<Record<string, Reponse>>, now: () => Date = () => MAINTENANT) => {
  const fetcher = serveur(table);
  const rendu = render(<main><TelemetryPage fetcher={fetcher} now={now} /></main>);
  return { fetcher, ...rendu };
};
const urls = (fetcher: Mock<Fetch>) => fetcher.mock.calls.map(([url]) => url);
const fenetre = () => screen.getByRole("group", { name: "Fenêtre" });
const bouton = (nom: string) => within(fenetre()).getByRole("button", { name: nom });
const tableau = () => screen.findByRole("table", { name: "Opérations, les plus lentes d'abord (p95 décroissant)" });
/** Lignes du tableau, chaque cellule en texte lisible. */
const lignes = (table: HTMLElement) =>
  within(table).getAllByRole("row").slice(1).map((ligne) => Array.from(ligne.querySelectorAll(":scope > th, :scope > td"), (cellule) => plain(cellule.textContent)));
const entetes = (table: HTMLElement) => within(table).getAllByRole("columnheader").map((cellule) => cellule.textContent);
const corps = (operations: Brut[], extra: Brut = {}): Exemple => ({ status: 200, body: { ...lecture.body, operations, ...extra } });
const op = (operation: string, p95: number, extra: Brut = {}): Brut => ({
  kind: "http", operation, method: "GET", count: 1, errors: 0, refusals: 0,
  duration_ms: { p50: p95, p95, max: p95 }, size: { p50: null, max: null }, rows: { p50: null, max: null }, ...extra,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Écran « Télémétrie » : en-tête et lecture", () => {
  it("titre, chapeau, fenêtre de 24 h choisie, puis lecture de cette fenêtre seule", () => {
    const { fetcher } = ouvrir({ [URL_24H]: jamais });
    expect(screen.getByRole("heading", { level: 1, name: "Télémétrie" })).toBeInTheDocument();
    expect(screen.getByText(/Aucune personne ni aucune valeur n'est enregistrée\./)).toBeInTheDocument();
    expect(within(fenetre()).getAllByRole("button").map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([
      ["24 h", "true"],
      ["7 j", "false"],
      ["30 j", "false"],
    ]);
    for (const b of within(fenetre()).getAllByRole("button")) expect(b).toHaveAttribute("type", "button");
    expect(urls(fetcher)).toEqual([URL_24H]);
  });

  it("lecture en cours : un état occupé, aucun tableau", () => {
    ouvrir({ [URL_24H]: jamais });
    expect(screen.getByRole("status")).toHaveTextContent("Lecture de la télémétrie…");
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("Écran « Télémétrie » : tableau", () => {
  it("carte titrée de la fenêtre, en-têtes dans l'ordre, chiffres de l'exemple réel", async () => {
    ouvrir({ [URL_24H]: lecture });
    const table = await tableau();
    expect(screen.getByRole("region", { name: "Opérations sur les dernières 24 heures" })).toBeInTheDocument();
    expect(entetes(table)).toEqual([
      "Opération", "Mesures", "Médiane (ms)", "p95 (ms)", "Max (ms)", "Erreurs", "Refus",
      "Taille médiane", "Taille max", "Documents médians", "Documents max",
    ]);
    expect(lignes(table)).toEqual([
      ["GET /api/spaces/{space_id}/membersRequête de l'API", "5", "14,0", "80,2", "95,0", "1 (20,0 %)", "1 (20,0 %)", "412 o", "430 o", "—", "—"],
      ["atlas.listLecture d'Atlas", "3", "35,0", "50,3", "52,0", "0", "0", "1,5 Mio", "1,5 Mio", "48", "48"],
      ["GET /api/meRequête de l'API", "2", "2,0", "2,5", "2,5", "0", "1 (50,0 %)", "64 o", "64 o", "—", "—"],
      ["atlas.documentLecture d'Atlas", "1", "2,0", "2,0", "2,0", "1 (100,0 %)", "0", "—", "—", "—", "—"],
    ]);
  });

  it("chaque ligne est nommée par son opération, en code, avec son genre ; une lecture d'Atlas n'a pas de méthode", async () => {
    ouvrir({ [URL_24H]: lecture });
    const table = await tableau();
    const entetesDeLigne = within(table).getAllByRole("rowheader");
    expect(entetesDeLigne.map((cellule) => cellule.querySelector("code")?.textContent)).toEqual([
      "GET /api/spaces/{space_id}/members", "atlas.list", "GET /api/me", "atlas.document",
    ]);
    expect(entetesDeLigne.map((cellule) => cellule.querySelector(".sb-telemetry__kind")?.textContent)).toEqual([
      "Requête de l'API", "Lecture d'Atlas", "Requête de l'API", "Lecture d'Atlas",
    ]);
    for (const cellule of entetesDeLigne) expect(cellule).toHaveAttribute("scope", "row");
    for (const cellule of within(table).getAllByRole("columnheader")) expect(cellule).toHaveAttribute("scope", "col");
  });

  it("nombres en chiffres tabulaires : chaque colonne chiffrée porte la classe des nombres", async () => {
    ouvrir({ [URL_24H]: lecture });
    const table = await tableau();
    expect(table).toHaveClass("sb-telemetry");
    const [entete, ...autres] = within(table).getAllByRole("columnheader");
    expect(entete).not.toHaveClass("sb-num");
    for (const cellule of autres) expect(cellule).toHaveClass("sb-num");
    for (const cellule of within(table).getAllByRole("cell")) expect(cellule).toHaveClass("sb-num");
  });

  it("trie par p95 décroissant même si le serveur rompt l'ordre ; à p95 égal, l'ordre du serveur reste", async () => {
    ouvrir({ [URL_24H]: corps([op("/a", 2), op("/b", 90), op("/c", 2, { method: "POST" }), op("/d", 40.5), op("/e", 2, { method: "DELETE" })]) });
    const table = await tableau();
    expect(within(table).getAllByRole("rowheader").map((cellule) => cellule.querySelector("code")?.textContent)).toEqual([
      "GET /b", "GET /d", "GET /a", "POST /c", "DELETE /e",
    ]);
  });

  it("une même opération sous deux méthodes ou deux genres fait deux lignes distinctes", async () => {
    ouvrir({ [URL_24H]: corps([op("/x", 5), op("/x", 4, { method: "POST" }), op("/x", 3, { kind: "atlas", method: null })]) });
    const table = await tableau();
    expect(lignes(table).map((ligne) => ligne[0])).toEqual(["GET /xRequête de l'API", "POST /xRequête de l'API", "/xLecture d'Atlas"]);
  });

  it("parts d'erreurs et de refus : zéro sans part, sinon le nombre et la part au dixième", async () => {
    ouvrir({ [URL_24H]: corps([op("/a", 9, { count: 3, errors: 1, refusals: 2 }), op("/b", 8, { count: 1234, errors: 0, refusals: 1234 })]) });
    const table = await tableau();
    expect(lignes(table).map((ligne) => [ligne[1], ligne[5], ligne[6]])).toEqual([
      ["3", "1 (33,3 %)", "2 (66,7 %)"],
      ["1 234", "0", "1 234 (100,0 %)"],
    ]);
  });

  it("valeurs absentes en tiret, jamais en zéro ; un zéro mesuré reste un zéro", async () => {
    ouvrir({ [URL_24H]: corps([op("/a", 9, { size: { p50: null, max: null }, rows: { p50: 0, max: 0 } }), op("/b", 1, { size: { p50: 0, max: 0 }, rows: { p50: 2.5, max: 3 } })]) });
    const table = await tableau();
    expect(lignes(table).map((ligne) => ligne.slice(7))).toEqual([
      ["—", "—", "0", "0"],
      ["0 o", "0 o", "2,5", "3"],
    ]);
  });

  it("tailles en kio et Mio, durées au dixième", async () => {
    ouvrir({ [URL_24H]: corps([op("/a", 1234.56, { duration_ms: { p50: 0.04, p95: 1234.56, max: 98765.4 }, size: { p50: 3584, max: 5 * 1024 * 1024 } })]) });
    const table = await tableau();
    expect(lignes(table)[0]?.slice(2, 5)).toEqual(["0,0", "1 234,6", "98 765,4"]);
    expect(lignes(table)[0]?.slice(7, 9)).toEqual(["3,5 kio", "5,0 Mio"]);
  });

  it("le tableau défile dans un conteneur nommé, atteignable au clavier", async () => {
    ouvrir({ [URL_24H]: lecture });
    const table = await tableau();
    const conteneur = screen.getByRole("group", { name: "Opérations, les plus lentes d'abord" });
    expect(conteneur).toHaveClass("sb-table-wrap");
    expect(conteneur).toHaveAttribute("tabindex", "0");
    expect(conteneur).toContainElement(table);
  });
});

describe("Écran « Télémétrie » : période et âge", () => {
  it("dit la période couverte en UTC et l'âge de la dernière mesure, avec l'instant injecté", async () => {
    ouvrir({ [URL_24H]: lecture });
    await tableau();
    expect(plain(document.querySelector(".sb-telemetry__period")?.textContent)).toBe(
      "Mesures du 03/11/2026 06:56 UTC au 03/11/2026 11:56 UTC · dernière mesure il y a 4 min.",
    );
  });

  it.each([
    [new Date("2026-11-03T11:56:30Z"), "à l'instant"],
    [new Date("2026-11-03T14:10:00Z"), "il y a 2 h"],
    [new Date("2026-11-06T12:00:00Z"), "il y a 3 j"],
    // Horloge du poste en retard sur le serveur : jamais d'âge négatif.
    [new Date("2026-11-03T11:00:00Z"), "à l'instant"],
  ])("à %s, la dernière mesure date de « %s »", async (instant, age) => {
    ouvrir({ [URL_24H]: lecture }, () => instant);
    await tableau();
    expect(plain(document.querySelector(".sb-telemetry__period")?.textContent)).toMatch(new RegExp(`· dernière mesure ${age}\\.$`));
  });

  it("sans instant injecté, l'âge se calcule sur l'horloge du poste", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-03T13:56:00Z"));
    render(<TelemetryPage fetcher={serveur({ [URL_24H]: lecture })} />);
    await tableau();
    expect(plain(document.querySelector(".sb-telemetry__period")?.textContent)).toMatch(/dernière mesure il y a 2 h\.$/);
  });
});

describe("Écran « Télémétrie » : états", () => {
  it("vide : la fenêtre est dite, sans tableau ni période", async () => {
    ouvrir({ [URL_24H]: vide });
    expect(await screen.findByRole("region", { name: "Aucune mesure" })).toHaveTextContent("Aucune mesure sur les dernières 24 heures.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(document.querySelector(".sb-telemetry__period")).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("refus « forbidden » : réservé à l'administration de la plateforme, sans donnée", async () => {
    ouvrir({ [URL_24H]: interdit });
    const etat = await screen.findByText("La télémétrie est réservée à l'administration de la plateforme.");
    expect(etat.closest("[role]")).toHaveAttribute("role", "status");
    expect(etat.closest(".sb-banner")).toHaveClass("sb-banner--neutral");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Le refus ne dépend pas de la fenêtre : la bascule n'est pas offerte.
    expect(screen.queryByRole("group", { name: "Fenêtre" })).not.toBeInTheDocument();
  });

  it("mode local : les mesures ne vont que sur la sortie standard", async () => {
    ouvrir({ [URL_24H]: modeLocal });
    const etat = await screen.findByText(/^En mode local, sans fournisseur d'identité, les mesures ne vont que sur la sortie standard du serveur/);
    expect(etat.closest(".sb-banner")).toHaveClass("sb-banner--neutral");
    expect(etat.closest("[role]")).toHaveAttribute("role", "status");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("autre refus : indisponible, avec la raison du serveur", async () => {
    ouvrir({ [URL_24H]: fenetreInvalide });
    expect(await screen.findByRole("alert")).toHaveTextContent("Télémétrie indisponible : La demande est incomplète ou mal formée.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("panne réseau : indisponible, et dit qu'aucune donnée n'est affichée", async () => {
    ouvrir({ [URL_24H]: () => Promise.reject(new TypeError("réseau")) });
    expect(await screen.findByRole("alert")).toHaveTextContent("Télémétrie indisponible : Le serveur Board ne répond pas. Aucune donnée n'est affichée.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("session perdue : indisponible, reconnexion demandée", async () => {
    ouvrir({ [URL_24H]: { status: 401, body: { error: { code: "unauthenticated" } } } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Session expirée : reconnectez-vous.");
  });

  it("réponse hors contrat (autre fenêtre) : aucune donnée partielle", async () => {
    ouvrir({ [URL_24H]: lecture7j });
    expect(await screen.findByRole("alert")).toHaveTextContent("Télémétrie indisponible : Réponse du serveur hors contrat : télémétrie.window : fenêtre demandée attendue.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("les états sont distincts : refus et mode local en information, autre refus et panne en alerte, chacun son texte", async () => {
    const etats: [Reponse, "status" | "alert"][] = [[interdit, "status"], [modeLocal, "status"], [fenetreInvalide, "alert"], [() => Promise.reject(new TypeError("x")), "alert"]];
    const textes = new Set<string>();
    for (const [exemple, role] of etats) {
      const { unmount, container } = ouvrir({ [URL_24H]: exemple });
      const bandeau = await waitFor(() => {
        const trouve = container.querySelector(".sb-banner");
        if (trouve === null) throw new Error("attente du bandeau");
        return trouve;
      });
      expect(bandeau).toHaveAttribute("role", role);
      textes.add(bandeau.textContent);
      unmount();
    }
    expect(textes.size).toBe(4);
  });
});

describe("Écran « Télémétrie » : changement de fenêtre", () => {
  it("24 h → 7 j → 30 j : chaque choix relit sa fenêtre, aria-pressed suit, la carte suit", async () => {
    const { fetcher } = ouvrir({ [URL_24H]: lecture, [URL_7J]: lecture7j, [URL_30J]: { status: 200, body: { ...vide.body, window: "30d" } } });
    await tableau();
    await userEvent.click(bouton("7 j"));
    expect(bouton("7 j")).toHaveAttribute("aria-pressed", "true");
    expect(bouton("24 h")).toHaveAttribute("aria-pressed", "false");
    expect(await screen.findByRole("region", { name: "Opérations sur les 7 derniers jours" })).toBeInTheDocument();
    expect(lignes(await tableau())).toHaveLength(5);
    expect(plain(document.querySelector(".sb-telemetry__period")?.textContent)).toMatch(/^Mesures du 31\/10\/2026 12:00 UTC au 03\/11\/2026 11:56 UTC/);
    await userEvent.click(bouton("30 j"));
    expect(within(fenetre()).getAllByRole("button", { pressed: true })).toEqual([bouton("30 j")]);
    expect(await screen.findByRole("region", { name: "Aucune mesure" })).toHaveTextContent("Aucune mesure sur les 30 derniers jours.");
    expect(urls(fetcher)).toEqual([URL_24H, URL_7J, URL_30J]);
  });

  it("pendant la lecture d'une autre fenêtre, l'ancien tableau disparaît : aucune donnée d'une autre fenêtre affichée", async () => {
    ouvrir({ [URL_24H]: lecture, [URL_7J]: jamais });
    await tableau();
    await userEvent.click(bouton("7 j"));
    expect(screen.getByRole("status")).toHaveTextContent("Lecture de la télémétrie…");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("une réponse tardive de la fenêtre quittée est ignorée", async () => {
    const tardive = differee();
    const { fetcher } = ouvrir({ [URL_24H]: () => tardive.promise, [URL_7J]: lecture7j });
    await userEvent.click(bouton("7 j"));
    await screen.findByRole("region", { name: "Opérations sur les 7 derniers jours" });
    const premier = fetcher.mock.calls[0]?.[1]?.signal;
    expect(premier?.aborted).toBe(true);
    await act(async () => {
      tardive.resolve(Response.json(lecture.body));
      await tardive.promise;
    });
    expect(screen.getByRole("region", { name: "Opérations sur les 7 derniers jours" })).toBeInTheDocument();
    expect(lignes(await tableau())).toHaveLength(5);
  });

  it("choisir la fenêtre déjà choisie ne relit pas ; revenir à une fenêtre la relit", async () => {
    const { fetcher } = ouvrir({ [URL_24H]: lecture, [URL_7J]: lecture7j });
    await tableau();
    await userEvent.click(bouton("24 h"));
    expect(urls(fetcher)).toEqual([URL_24H]);
    await userEvent.click(bouton("7 j"));
    await screen.findByRole("region", { name: "Opérations sur les 7 derniers jours" });
    await userEvent.click(bouton("24 h"));
    await screen.findByRole("region", { name: "Opérations sur les dernières 24 heures" });
    expect(urls(fetcher)).toEqual([URL_24H, URL_7J, URL_24H]);
  });

  it("au clavier : Tab atteint la bascule, Entrée et Espace choisissent", async () => {
    const { fetcher } = ouvrir({ [URL_24H]: lecture, [URL_7J]: lecture7j, [URL_30J]: { status: 200, body: { ...vide.body, window: "30d" } } });
    await tableau();
    bouton("7 j").focus();
    await userEvent.keyboard("{Enter}");
    expect(bouton("7 j")).toHaveAttribute("aria-pressed", "true");
    await userEvent.tab();
    expect(bouton("30 j")).toHaveFocus();
    await userEvent.keyboard(" ");
    expect(bouton("30 j")).toHaveAttribute("aria-pressed", "true");
    await screen.findByRole("region", { name: "Aucune mesure" });
    expect(urls(fetcher)).toEqual([URL_24H, URL_7J, URL_30J]);
  });

  it("un refus suit la fenêtre : la nouvelle fenêtre est relue même après un refus", async () => {
    const { fetcher } = ouvrir({ [URL_24H]: () => Promise.reject(new TypeError("réseau")), [URL_7J]: lecture7j });
    await screen.findByRole("alert");
    await userEvent.click(bouton("7 j"));
    await tableau();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(urls(fetcher)).toEqual([URL_24H, URL_7J]);
  });
});

describe("Écran « Télémétrie » : bascule selon l'état", () => {
  const groupe = () => screen.queryByRole("group", { name: "Fenêtre" });

  it("absente en mode local, comme après « forbidden » : ni l'un ni l'autre ne dépend de la fenêtre", async () => {
    const local = ouvrir({ [URL_24H]: modeLocal });
    await screen.findByText(/^En mode local/);
    expect(groupe()).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toEqual([]);
    local.unmount();
    ouvrir({ [URL_24H]: interdit });
    await screen.findByText("La télémétrie est réservée à l'administration de la plateforme.");
    expect(groupe()).not.toBeInTheDocument();
  });

  it("présente pendant la lecture, sur un tableau, sur une fenêtre vide, après une panne et après une réponse hors contrat", async () => {
    const etats: [Reponse, () => Promise<unknown>][] = [
      [jamais, () => screen.findByRole("status")],
      [lecture, tableau],
      [vide, () => screen.findByRole("region", { name: "Aucune mesure" })],
      [() => Promise.reject(new TypeError("réseau")), () => screen.findByRole("alert")],
      [lecture7j, () => screen.findByRole("alert")],
    ];
    for (const [exemple, attendre] of etats) {
      const { unmount } = ouvrir({ [URL_24H]: exemple });
      await attendre();
      expect(groupe()).toBeInTheDocument();
      expect(within(groupe() as HTMLElement).getAllByRole("button")).toHaveLength(3);
      unmount();
    }
  });

  it("présente après « invalid_request », qui dépend de la fenêtre : changer de fenêtre relit, et revenir relit encore", async () => {
    const { fetcher } = ouvrir({ [URL_24H]: fenetreInvalide, [URL_7J]: lecture7j, [URL_30J]: fenetreInvalide });
    expect(await screen.findByRole("alert")).toHaveTextContent("La demande est incomplète ou mal formée.");
    expect(groupe()).toBeInTheDocument();
    expect(bouton("24 h")).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(bouton("7 j"));
    await screen.findByRole("region", { name: "Opérations sur les 7 derniers jours" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(bouton("30 j"));
    expect(await screen.findByRole("alert")).toHaveTextContent("La demande est incomplète ou mal formée.");
    expect(bouton("30 j")).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(bouton("24 h"));
    await screen.findByRole("alert");
    expect(urls(fetcher)).toEqual([URL_24H, URL_7J, URL_30J, URL_24H]);
  });

  it("un « forbidden » sur une autre fenêtre retire la bascule ; aucune donnée de la fenêtre précédente ne reste", async () => {
    ouvrir({ [URL_24H]: lecture, [URL_7J]: interdit });
    await tableau();
    await userEvent.click(bouton("7 j"));
    await screen.findByText("La télémétrie est réservée à l'administration de la plateforme.");
    expect(groupe()).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("sans bascule, le titre et le chapeau restent", async () => {
    ouvrir({ [URL_24H]: modeLocal });
    await screen.findByText(/^En mode local/);
    expect(screen.getByRole("heading", { level: 1, name: "Télémétrie" })).toBeInTheDocument();
    expect(screen.getByText(/Aucune personne ni aucune valeur n'est enregistrée\./)).toBeInTheDocument();
  });
});

describe("Écran « Télémétrie » : aucune donnée de personne", () => {
  it("un champ de personne glissé dans la réponse n'est jamais affiché", async () => {
    const piege = structuredClone(lecture.body) as Brut & { operations: Brut[] };
    Object.assign(piege, { subject: "00u9admin", email: "alix@ex.invalid", actor_person: { name: "Alix" } });
    for (const found of piege.operations) Object.assign(found, { subject: "00u9admin", email: "alix@ex.invalid", path: "/api/spaces/finance/members", space: "finance" });
    const { container } = ouvrir({ [URL_24H]: { status: 200, body: piege } });
    await tableau();
    expect(container.textContent).not.toMatch(/00u9admin|alix|Alix|finance/);
    expect(container.innerHTML).not.toMatch(/00u9admin|alix|finance/);
  });

  it("l'écran n'émet que des lectures de la télémétrie", async () => {
    const { fetcher } = ouvrir({ [URL_24H]: lecture, [URL_7J]: lecture7j });
    await tableau();
    await userEvent.click(bouton("7 j"));
    await screen.findByRole("region", { name: "Opérations sur les 7 derniers jours" });
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toMatch(/^\/api\/telemetry\?window=(24h|7d|30d)$/);
      expect(init?.method).toBe("GET");
    }
  });
});
