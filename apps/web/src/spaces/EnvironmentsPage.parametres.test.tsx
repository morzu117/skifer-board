import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "vitest";

import accord from "../../../../contracts/espaces/accord.json";
import accords from "../../../../contracts/espaces/accords.json";
import espace from "../../../../contracts/espaces/espace.json";
import interdit from "../../../../contracts/espaces/interdit.json";
import introuvable from "../../../../contracts/espaces/introuvable.json";
import journalAccords from "../../../../contracts/espaces/journal-accords.json";
import modeLocal from "../../../../contracts/espaces/mode-local.json";
import parametres from "../../../../contracts/espaces/parametres.json";
import retraitAccord from "../../../../contracts/espaces/retrait-accord.json";
import type { Environment } from "../shell/sections";
import type { Fetch } from "./api";
import { EnvironmentsPage } from "./EnvironmentsPage";
import { onSpaceLost } from "./lost";
import { decodeSpace } from "./model";

// Complétude des paramètres dans le pipeline d'« Environnements » (plan 10, 10.4) : l'état de chaque
// environnement est celui que rend le serveur (P4), jamais recalculé ; une lecture refusée ou en
// panne est dite une fois, au-dessus du pipeline, et seulement si le pipeline est là.

type Exemple = { status: number; body: unknown };
type Reponse = Exemple | (() => Promise<Response>);
const reponse = (exemple: Exemple) => (exemple.body === null ? new Response(null, { status: exemple.status }) : Response.json(exemple.body, { status: exemple.status }));
const FINANCE = decodeSpace(espace.body, "espace");
const ACCORDS = "GET /api/spaces/finance/deploy-grants";
const JOURNAL = "GET /api/spaces/finance/events";
const PARAMETRES = "GET /api/spaces/finance/parameters";
const ACCORDER = "POST /api/spaces/finance/deploy-grants";
const RETIRER_DOMINIQUE = "DELETE /api/spaces/finance/deploy-grants/3d8e1f2a-6b7c-4d9e-8f01-2a3b4c5d6e7f";
const BASE = { [ACCORDS]: accords, [JOURNAL]: journalAccords, [PARAMETRES]: parametres };
const TITRE = "Complétude des paramètres indisponible";

function serveur(table: Readonly<Record<string, Reponse>>): Mock<Fetch> {
  return vi.fn<Fetch>().mockImplementation((url, init) => {
    const cle = `${init?.method ?? "GET"} ${url}`;
    const exemple = table[cle];
    if (exemple === undefined) return Promise.reject(new Error(`appel inattendu : ${cle}`));
    return typeof exemple === "function" ? exemple() : Promise.resolve(reponse(exemple));
  });
}
function differee() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((ok) => { resolve = ok; });
  return { promise, resolve };
}
const appels = (fetcher: Mock<Fetch>, cle: string) => fetcher.mock.calls.filter(([url, init]) => `${init?.method ?? "GET"} ${url}` === cle);

const CODES = ["DEV", "TEST", "PROD"] as const;
const pipeline = () => screen.getByRole("list", { name: "Droits de déployer, dans l'ordre de promotion" });
const etape = (code: Environment) => within(pipeline()).getByRole("heading", { level: 2, name: new RegExp(`^${code}`) }).closest("li") as HTMLElement;
const completude = (code: Environment) => etape(code).querySelector(".sb-pipeline__parameters") as HTMLElement;
const textes = () => CODES.map((code) => completude(code).textContent);
const lien = (code: Environment) => within(etape(code)).getByRole("link", { name: `Paramètres de ${code}` });

async function ouvrir(fetcher: Mock<Fetch>, target: Environment = "DEV") {
  const rendu = render(<EnvironmentsPage space={FINANCE} fetcher={fetcher} target={target} />);
  await screen.findByRole("list", { name: "Droits de déployer, dans l'ordre de promotion" });
  await screen.findByRole("list", { name: "Journal de l'espace" });
  return rendu;
}

/** Configuration construite : `etats[i]` donne l'état de chaque paramètre dans l'environnement `i`. */
function configuration(noms: readonly string[], etats: readonly (readonly ("value" | "default" | "missing" | "absent")[])[]) {
  const auteur = { issuer: "https://id.example.invalid", subject: "00u9admin" };
  const declaration = (name: string) => ({ ...parametres.body.parameters[0], name, type: "text", constraints: { max_length: 8 }, required: true, default: null });
  return {
    parameters: noms.map(declaration),
    environments: CODES.map((code, index) => {
      const values = noms.map((name, position) => {
        const state = etats[index]?.[position] ?? "absent";
        const propre = state === "value";
        return { name, state, value: state === "value" || state === "default" ? "v" : null, set_at: propre ? "2026-11-02T10:00:00+00:00" : null, set_by: propre ? auteur : null, set_by_person: null };
      });
      const missing = values.filter((value) => value.state === "missing").map((value) => value.name);
      return { code, can_set: true, complete: missing.length === 0, missing, values };
    }),
  };
}

describe("Complétude de chaque carte du pipeline (plan 10, 10.4)", () => {
  it("exemple réel : chaque environnement dit combien de paramètres y manquent, au singulier ou au pluriel", async () => {
    await ouvrir(serveur(BASE));
    expect(textes()).toEqual(["incomplet · 1 manquant Paramètres", "incomplet · 2 manquants Paramètres", "incomplet · 2 manquants Paramètres"]);
    for (const code of CODES) {
      const badge = completude(code).querySelector(".sb-badge");
      expect(badge).toHaveClass("sb-badge--danger");
      expect(completude(code).querySelector(".sb-badge--success")).toBeNull();
    }
    // Rien n'est dit en double : pas de bandeau quand tout s'est lu.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("la complétude est sous le titre de la carte, avant les droits", async () => {
    await ouvrir(serveur(BASE));
    for (const code of CODES) {
      const titre = within(etape(code)).getByRole("heading", { level: 2 });
      expect(titre.nextElementSibling).toBe(completude(code));
      expect(completude(code).tagName).toBe("P");
    }
  });

  it("complet, incomplet et sans paramètre obligatoire manquant se distinguent par le mot, pas seulement la couleur", async () => {
    const config = configuration(["a", "b", "c"], [["value", "default", "absent"], ["missing", "value", "value"], ["missing", "missing", "missing"]]);
    await ouvrir(serveur({ ...BASE, [PARAMETRES]: { status: 200, body: config } }));
    expect(textes()).toEqual(["paramètres complets Paramètres", "incomplet · 1 manquant Paramètres", "incomplet · 3 manquants Paramètres"]);
    expect(completude("DEV").querySelector(".sb-badge")).toHaveClass("sb-badge--success");
    expect(completude("TEST").querySelector(".sb-badge")).toHaveClass("sb-badge--danger");
  });

  it("un paramètre facultatif absent n'empêche pas d'être complet (P4)", async () => {
    const config = configuration(["a"], [["absent"], ["absent"], ["default"]]);
    await ouvrir(serveur({ ...BASE, [PARAMETRES]: { status: 200, body: config } }));
    expect(textes()).toEqual(["paramètres complets Paramètres", "paramètres complets Paramètres", "paramètres complets Paramètres"]);
  });

  it("sans aucune déclaration, chaque carte le dit, sans badge", async () => {
    await ouvrir(serveur({ ...BASE, [PARAMETRES]: { status: 200, body: configuration([], [[], [], []]) } }));
    expect(textes()).toEqual(["Aucun paramètre déclaré. Paramètres", "Aucun paramètre déclaré. Paramètres", "Aucun paramètre déclaré. Paramètres"]);
    expect(pipeline().querySelector(".sb-badge--success, .sb-badge--danger")).toBeNull();
  });

  it("pendant la lecture, chaque carte l'annonce ; aucun bandeau", async () => {
    const lecture = differee();
    await ouvrir(serveur({ ...BASE, [PARAMETRES]: () => lecture.promise }));
    expect(textes()).toEqual(["Lecture des paramètres… Paramètres", "Lecture des paramètres… Paramètres", "Lecture des paramètres… Paramètres"]);
    // Annoncée comme les autres lectures : un état, occupé.
    for (const code of CODES) {
      const lecture = within(completude(code)).getByRole("status");
      expect(lecture).toHaveTextContent(/^Lecture des paramètres…$/);
      expect(lecture).toHaveAttribute("aria-busy", "true");
    }
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => { lecture.resolve(reponse(parametres)); await Promise.resolve(); });
    await waitFor(() => { expect(completude("DEV")).toHaveTextContent("incomplet · 1 manquant"); });
    // Lue, la complétude n'est plus un état occupé.
    for (const code of CODES) expect(within(completude(code)).queryByRole("status")).not.toBeInTheDocument();
  });

  it.each([
    ["HTTP 500", { status: 500, body: {} }, `${TITRE} : Réponse inattendue du serveur (HTTP 500). Rien n'est affiché.`],
    ["serveur muet", () => Promise.reject(new TypeError("réseau")), `${TITRE} : Le serveur Board ne répond pas. Rien n'est affiché.`],
    ["hors contrat", { status: 200, body: { ...parametres.body, environments: parametres.body.environments.slice(0, 2) } }, `${TITRE} : Réponse du serveur hors contrat : réponse.environments : DEV | TEST | PROD attendus dans cet ordre. Rien n'est affiché.`],
    ["refus", interdit, `${TITRE} : Votre rôle ne permet pas cette action.`],
    ["mode local", modeLocal, `${TITRE} : En mode local, l'espace implicite ne se gère pas.`],
  ] as [string, Reponse, string][])("lecture en échec (%s) : chaque carte dit la complétude indisponible, un seul bandeau en donne la raison", async (_cas, panne, texte) => {
    await ouvrir(serveur({ ...BASE, [PARAMETRES]: panne }));
    await waitFor(() => { expect(screen.getAllByRole("alert")).toHaveLength(1); });
    expect(screen.getByRole("alert")).toHaveTextContent(new RegExp(`^${texte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    expect(textes()).toEqual(["Complétude indisponible. Paramètres", "Complétude indisponible. Paramètres", "Complétude indisponible. Paramètres"]);
    // Fail-closed : aucun badge, ni « complet » ni « incomplet ».
    expect(pipeline().querySelector(".sb-badge--success, .sb-badge--danger")).toBeNull();
    // Le bandeau est au-dessus du pipeline, hors des cartes.
    const alerte = screen.getByRole("alert");
    expect(pipeline()).not.toContainElement(alerte);
    expect(alerte.compareDocumentPosition(pipeline()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Les droits restent affichés et gérables.
    expect(etape("TEST")).toHaveTextContent("Dominique Leroy");
    expect(screen.getByRole("form", { name: "Accorder un droit de déployer" })).toBeInTheDocument();
  });

  // Défaut trouvé par ces tests, corrigé : un refus ne disait pas que c'était la complétude qui manquait.
  it("un refus de lecture des paramètres dit, dans son bandeau, que c'est la complétude qui est indisponible", async () => {
    await ouvrir(serveur({ ...BASE, [PARAMETRES]: interdit }));
    expect(await screen.findByRole("alert")).toHaveTextContent(new RegExp(`^${TITRE} : Votre rôle ne permet pas cette action\\.$`));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("droits et paramètres refusés : le refus est dit une fois, pour les droits, sans bandeau des paramètres", async () => {
    render(<EnvironmentsPage space={FINANCE} fetcher={serveur({ [ACCORDS]: interdit, [JOURNAL]: journalAccords, [PARAMETRES]: interdit })} target="DEV" />);
    await screen.findByRole("list", { name: "Journal de l'espace" });
    await waitFor(() => { expect(screen.getAllByRole("alert")).toHaveLength(1); });
    expect(within(screen.getByRole("region", { name: "Droits de déployer" })).getByRole("alert")).toHaveTextContent("Votre rôle ne permet pas cette action.");
    expect(screen.queryByText(new RegExp(TITRE))).not.toBeInTheDocument();
    expect(screen.queryByText("Complétude indisponible.")).not.toBeInTheDocument();
  });

  it("droits en panne, paramètres en panne : seul le bandeau des droits", async () => {
    render(<EnvironmentsPage space={FINANCE} fetcher={serveur({ [ACCORDS]: { status: 500, body: {} }, [JOURNAL]: journalAccords, [PARAMETRES]: { status: 502, body: {} } })} target="DEV" />);
    await screen.findByRole("list", { name: "Journal de l'espace" });
    await waitFor(() => { expect(screen.getAllByRole("alert")).toHaveLength(1); });
    expect(screen.getByRole("alert")).toHaveTextContent(/^Droits de déployer indisponibles : /);
    expect(screen.queryByText(new RegExp(TITRE))).not.toBeInTheDocument();
  });

  it("droits encore en lecture : pas de bandeau des paramètres ; il vient quand les droits sont lus", async () => {
    const droits = differee();
    render(<EnvironmentsPage space={FINANCE} fetcher={serveur({ [ACCORDS]: () => droits.promise, [JOURNAL]: journalAccords, [PARAMETRES]: { status: 500, body: {} } })} target="DEV" />);
    await screen.findByRole("list", { name: "Journal de l'espace" });
    await act(async () => { await new Promise((fin) => setTimeout(fin, 10)); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => { droits.resolve(reponse(accords)); await Promise.resolve(); });
    expect(await screen.findByRole("alert")).toHaveTextContent(`${TITRE} : Réponse inattendue du serveur (HTTP 500). Rien n'est affiché.`);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("un espace retiré pendant la lecture des paramètres est signalé à la coque", async () => {
    const perdu = vi.fn();
    const quitter = onSpaceLost(perdu);
    try {
      await ouvrir(serveur({ ...BASE, [PARAMETRES]: introuvable }));
      await waitFor(() => { expect(perdu).toHaveBeenCalledTimes(1); });
      expect(await screen.findByRole("alert")).toHaveTextContent(`${TITRE} : Espace introuvable.`);
    } finally { quitter(); }
  });

  it("la complétude ne dépend pas de l'environnement affiché", async () => {
    const fetcher = serveur(BASE);
    const { rerender } = await ouvrir(fetcher, "DEV");
    const avant = textes();
    rerender(<EnvironmentsPage space={FINANCE} fetcher={fetcher} target="PROD" />);
    expect(textes()).toEqual(avant);
    expect(appels(fetcher, PARAMETRES)).toHaveLength(1);
  });
});

describe("Lien vers « Paramètres » depuis chaque carte", () => {
  it("chaque carte a un lien « Paramètres », nommé par son environnement, vers l'écran des paramètres de l'espace", async () => {
    await ouvrir(serveur(BASE));
    for (const code of CODES) {
      expect(lien(code)).toHaveTextContent(/^Paramètres$/);
      expect(lien(code)).toHaveAttribute("href", "#/espaces/finance/parametres");
      expect(lien(code)).toHaveClass("sb-pipeline__link");
      expect(completude(code)).toContainElement(lien(code));
    }
    expect(within(pipeline()).getAllByRole("link")).toHaveLength(3);
  });

  it.each([
    ["en lecture", () => new Promise<Response>(() => undefined)],
    ["en panne", { status: 500, body: {} }],
  ] as [string, Reponse][])("le lien est là même quand la complétude est %s", async (_cas, lecture) => {
    await ouvrir(serveur({ ...BASE, [PARAMETRES]: lecture }));
    for (const code of CODES) expect(lien(code)).toHaveAttribute("href", "#/espaces/finance/parametres");
  });

  it("encode l'identifiant de l'espace dans l'adresse du lien et dans la lecture", async () => {
    const fetcher = vi.fn<Fetch>().mockImplementation((url) =>
      Promise.resolve(Response.json(url.endsWith("/deploy-grants") ? { grants: [] } : url.endsWith("/parameters") ? configuration([], [[], [], []]) : { events: [] })),
    );
    render(<EnvironmentsPage space={{ ...FINANCE, id: "a/b c#d" }} fetcher={fetcher} target="DEV" />);
    await screen.findByRole("list", { name: "Droits de déployer, dans l'ordre de promotion" });
    await waitFor(() => { expect(completude("DEV")).toHaveTextContent("Aucun paramètre déclaré."); });
    for (const code of CODES) expect(lien(code)).toHaveAttribute("href", "#/espaces/a%2Fb%20c%23d/parametres");
    expect(fetcher.mock.calls.map(([url]) => url)).toContain("/api/spaces/a%2Fb%20c%23d/parameters");
  });

  it("le nom accessible commence par le texte visible (WCAG 2.5.3)", async () => {
    await ouvrir(serveur(BASE));
    for (const code of CODES) expect(lien(code).getAttribute("aria-label")?.startsWith(lien(code).textContent)).toBe(true);
  });
});

describe("Relecture de la complétude après une écriture", () => {
  it("un accord relit les paramètres, et la nouvelle complétude remplace l'ancienne", async () => {
    let ecrit = false;
    const complet = configuration(["a"], [["value"], ["value"], ["value"]]);
    const fetcher = serveur({ ...BASE, [PARAMETRES]: () => Promise.resolve(reponse(ecrit ? { status: 200, body: complet } : parametres)), [ACCORDER]: () => { ecrit = true; return Promise.resolve(reponse(accord)); } });
    await ouvrir(fetcher);
    expect(appels(fetcher, PARAMETRES)).toHaveLength(1);
    const formulaire = screen.getByRole("form", { name: "Accorder un droit de déployer" });
    await userEvent.type(within(formulaire).getByRole("textbox", { name: /Nom exact du groupe/ }), "finance-x");
    await userEvent.click(within(formulaire).getByRole("button", { name: "Accorder le droit" }));
    await waitFor(() => { expect(appels(fetcher, PARAMETRES)).toHaveLength(2); });
    await waitFor(() => { expect(textes()).toEqual(["paramètres complets Paramètres", "paramètres complets Paramètres", "paramètres complets Paramètres"]); });
  });

  it("un retrait relit aussi les paramètres", async () => {
    const fetcher = serveur({ ...BASE, [RETIRER_DOMINIQUE]: retraitAccord });
    await ouvrir(fetcher);
    await userEvent.click(within(etape("TEST")).getByRole("button", { name: "Retirer le droit de déployer en TEST : Dominique Leroy" }));
    await userEvent.click(within(etape("TEST")).getByRole("button", { name: "Retirer" }));
    await waitFor(() => { expect(appels(fetcher, PARAMETRES)).toHaveLength(2); });
  });

  it("un accord refusé relit aussi les paramètres", async () => {
    const fetcher = serveur({ ...BASE, [ACCORDER]: interdit });
    await ouvrir(fetcher);
    const formulaire = screen.getByRole("form", { name: "Accorder un droit de déployer" });
    await userEvent.type(within(formulaire).getByRole("textbox", { name: /Nom exact du groupe/ }), "finance-x");
    await userEvent.click(within(formulaire).getByRole("button", { name: "Accorder le droit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Votre rôle ne permet pas cette action.");
    await waitFor(() => { expect(appels(fetcher, PARAMETRES)).toHaveLength(2); });
  });

  it("pendant la relecture, la complétude précédente reste affichée ; la panne de la relecture est dite", async () => {
    const relecture = differee();
    let lectures = 0;
    const fetcher = serveur({ ...BASE, [PARAMETRES]: () => { lectures += 1; return lectures === 1 ? Promise.resolve(reponse(parametres)) : relecture.promise; }, [ACCORDER]: interdit });
    await ouvrir(fetcher);
    const formulaire = screen.getByRole("form", { name: "Accorder un droit de déployer" });
    await userEvent.type(within(formulaire).getByRole("textbox", { name: /Nom exact du groupe/ }), "finance-x");
    await userEvent.click(within(formulaire).getByRole("button", { name: "Accorder le droit" }));
    await waitFor(() => { expect(lectures).toBe(2); });
    expect(screen.queryByText("Lecture des paramètres…")).not.toBeInTheDocument();
    expect(completude("DEV")).toHaveTextContent("incomplet · 1 manquant");
    await act(async () => { relecture.resolve(reponse({ status: 503, body: "" })); await Promise.resolve(); });
    await waitFor(() => { expect(completude("DEV")).toHaveTextContent("Complétude indisponible."); });
    expect(screen.getByText(new RegExp(`^${TITRE} : Réponse inattendue du serveur \\(HTTP 503\\)`))).toBeInTheDocument();
  });
});
