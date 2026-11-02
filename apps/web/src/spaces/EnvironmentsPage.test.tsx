import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "vitest";

import accord from "../../../../contracts/espaces/accord.json";
import accordInconnu from "../../../../contracts/espaces/accord-inconnu.json";
import accords from "../../../../contracts/espaces/accords.json";
import environnementInvalide from "../../../../contracts/espaces/environnement-invalide.json";
import espace from "../../../../contracts/espaces/espace.json";
import interdit from "../../../../contracts/espaces/interdit.json";
import introuvable from "../../../../contracts/espaces/introuvable.json";
import journalAccords from "../../../../contracts/espaces/journal-accords.json";
import modeLocal from "../../../../contracts/espaces/mode-local.json";
import parametres from "../../../../contracts/espaces/parametres.json";
import inconnue from "../../../../contracts/espaces/personne-inconnue.json";
import personnes from "../../../../contracts/espaces/personnes.json";
import retraitAccord from "../../../../contracts/espaces/retrait-accord.json";
import type { Environment } from "../shell/sections";
import type { Fetch } from "./api";
import { DEPLOY_REMINDER, EnvironmentsPage } from "./EnvironmentsPage";
import { onSpaceLost } from "./lost";
import { decodeSpace } from "./model";

// Écran « Environnements » d'un espace (écrans §9, plan 09, 9.4). Les réponses simulées sont les
// exemples du serveur réel (contracts/espaces) ; toute autre requête est inattendue.

type Exemple = { status: number; body: unknown };
type Reponse = Exemple | (() => Promise<Response>);
const reponse = (exemple: Exemple) => (exemple.body === null ? new Response(null, { status: exemple.status }) : Response.json(exemple.body, { status: exemple.status }));
const FINANCE = decodeSpace(espace.body, "espace");
const ACCORDS = "GET /api/spaces/finance/deploy-grants";
const JOURNAL = "GET /api/spaces/finance/events";
const PARAMETRES = "GET /api/spaces/finance/parameters";
const ACCORDER = "POST /api/spaces/finance/deploy-grants";
const ID_DOMINIQUE = "3d8e1f2a-6b7c-4d9e-8f01-2a3b4c5d6e7f";
const ID_CREATEURS = "7a4b9c0d-1e2f-4a3b-9c4d-5e6f7a8b9c0d";
const RETIRER_DOMINIQUE = `DELETE /api/spaces/finance/deploy-grants/${ID_DOMINIQUE}`;
const RETIRER_CREATEURS = `DELETE /api/spaces/finance/deploy-grants/${ID_CREATEURS}`;
const DOMINIQUE = { kind: "person", issuer: "https://id.example.invalid", subject: "00u5d6e7f8" } as const;
const CAMILLE = { issuer: "https://id.example.invalid", subject: "00u1a2b3c4" };

// La complétude des paramètres (plan 10, 10.4) se lit aussi : l'exemple réel, sauf avis contraire.
function serveur(entrees: Readonly<Record<string, Reponse>>): Mock<Fetch> {
  const table: Readonly<Record<string, Reponse>> = { [PARAMETRES]: parametres, ...entrees };
  return vi.fn<Fetch>().mockImplementation((url, init) => {
    const cle = `${init?.method ?? "GET"} ${url}`;
    const exemple = table[cle];
    if (exemple === undefined) return Promise.reject(new Error(`appel inattendu : ${cle}`));
    return typeof exemple === "function" ? exemple() : Promise.resolve(reponse(exemple));
  });
}
const BASE = { [ACCORDS]: accords, [JOURNAL]: journalAccords };
function differee() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((ok) => { resolve = ok; });
  return { promise, resolve };
}
const appels = (fetcher: Mock<Fetch>, cle: string) => fetcher.mock.calls.filter(([url, init]) => `${init?.method ?? "GET"} ${url}` === cle);
const corpsEnvoye = (fetcher: Mock<Fetch>, cle: string, rang = 0) => JSON.parse(appels(fetcher, cle)[rang]?.[1]?.body as string) as unknown;
const ecritures = (fetcher: Mock<Fetch>) => fetcher.mock.calls.filter(([, init]) => (init?.method ?? "GET") !== "GET");
const accordBrut = (id: string, environment: string, principal: object, extra: object = {}) => ({
  id,
  environment,
  principal,
  person: null,
  created_at: "2026-11-02T10:00:00+00:00",
  created_by: CAMILLE,
  created_by_person: null,
  ...extra,
});

const pipeline = () => screen.getByRole("list", { name: "Droits de déployer, dans l'ordre de promotion" });
/** Étape d'un environnement : l'élément du pipeline dont le titre est ce code. */
const etape = (code: Environment) => {
  const titre = within(pipeline()).getByRole("heading", { level: 2, name: new RegExp(`^${code}`) });
  return titre.closest("li") as HTMLElement;
};
const ordre = () => within(pipeline()).getAllByRole("heading", { level: 2 }).map((titre) => titre.querySelector(".sb-mono")?.textContent);
const accordsDe = (code: Environment) => within(etape(code)).queryByRole("list", { name: `Droits de déployer en ${code}` });
const formulaire = () => screen.getByRole("form", { name: "Accorder un droit de déployer" });
const nomGroupe = () => within(formulaire()).getByRole("textbox", { name: /Nom exact du groupe/ });
const environnement = () => within(formulaire()).getByRole("combobox", { name: "Environnement" });
const accorder = () => within(formulaire()).getByRole("button", { name: "Accorder le droit" });
const bandeau = () => document.querySelector<HTMLElement>(".sb-members__feedback");
const journal = () => screen.getByRole("list", { name: "Journal de l'espace" });
const entrees = () => within(journal()).getAllByRole("listitem").map((item) => item.textContent.replace(/^.*UTC/, ""));

async function ouvrir(fetcher: Mock<Fetch>, target: Environment = "DEV", onWritten?: () => void) {
  const rendu = render(onWritten === undefined ? <EnvironmentsPage space={FINANCE} fetcher={fetcher} target={target} /> : <EnvironmentsPage space={FINANCE} fetcher={fetcher} target={target} onWritten={onWritten} />);
  await screen.findByRole("list", { name: "Droits de déployer, dans l'ordre de promotion" });
  await screen.findByRole("list", { name: "Journal de l'espace" });
  return rendu;
}

describe("Environnements : lecture (écrans §9, plan 09, 9.4)", () => {
  it("annonce les lectures, garde le rappel permanent, puis montre le pipeline et le formulaire", async () => {
    const lus = differee();
    const evenements = differee();
    const fetcher = serveur({ [ACCORDS]: () => lus.promise, [JOURNAL]: () => evenements.promise });
    render(<EnvironmentsPage space={FINANCE} fetcher={fetcher} target="DEV" />);
    expect(screen.getByRole("heading", { level: 1, name: "Environnements" })).toBeInTheDocument();
    expect(screen.getByText("finance", { selector: ".sb-mono" }).parentElement).toHaveTextContent("Finance · finance");
    expect(screen.getByText(DEPLOY_REMINDER)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Droits de déployer" })).toHaveTextContent("Lecture des droits de déployer…");
    expect(screen.getByText("Lecture des droits de déployer…")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Lecture du journal…")).toHaveAttribute("aria-busy", "true");
    // Rien à accorder tant que les droits ne sont pas lus : le doublon ne pourrait pas être signalé.
    expect(screen.queryByRole("form", { name: "Accorder un droit de déployer" })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method, init?.signal instanceof AbortSignal])).toEqual([
      ["/api/spaces/finance/deploy-grants", "GET", true],
      ["/api/spaces/finance/events", "GET", true],
      ["/api/spaces/finance/parameters", "GET", true],
    ]);
    await act(async () => { lus.resolve(reponse(accords)); evenements.resolve(reponse(journalAccords)); await Promise.resolve(); });
    await screen.findByRole("list", { name: "Droits de déployer, dans l'ordre de promotion" });
    expect(screen.queryByRole("region", { name: "Droits de déployer" })).not.toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Accorder un droit de déployer" })).toBeInTheDocument();
    expect(screen.getByText(DEPLOY_REMINDER)).toBeInTheDocument();
    // Lecture seule : aucune écriture sans geste de la personne.
    expect(ecritures(fetcher)).toEqual([]);
  });

  it("le rappel dit qu'un droit de déployer n'a d'effet qu'avec le rôle Créateur ou plus, et ne donne aucun droit sur les données (V3)", () => {
    expect(DEPLOY_REMINDER).toBe("Un droit de déployer n'a d'effet qu'avec le rôle Créateur ou Administrateur dans l'espace, et ne donne aucun droit sur les données.");
  });

  it("les trois environnements sont toujours dans l'ordre DEV, TEST, PROD, quel que soit l'ordre des accords", async () => {
    const desordre = {
      grants: [
        accordBrut("p", "PROD", { kind: "group", name: "prod-ops" }),
        accordBrut("t", "TEST", { kind: "group", name: "test-ops" }),
        accordBrut("d", "DEV", { kind: "group", name: "dev-ops" }),
        accordBrut("p2", "PROD", { kind: "group", name: "prod-ops-2" }),
      ],
    };
    await ouvrir(serveur({ [ACCORDS]: { status: 200, body: desordre }, [JOURNAL]: journalAccords }));
    expect(ordre()).toEqual(["DEV", "TEST", "PROD"]);
    expect(within(pipeline()).getAllByRole("listitem").filter((item) => item.parentElement === pipeline())).toHaveLength(3);
    expect(within(accordsDe("PROD") as HTMLElement).getAllByRole("listitem").map((item) => item.querySelector("span")?.textContent)).toEqual(["Groupe prod-ops", "Groupe prod-ops-2"]);
    expect(accordsDe("DEV")).toHaveTextContent("Groupe dev-ops");
    expect(accordsDe("TEST")).toHaveTextContent("Groupe test-ops");
    expect(accordsDe("DEV")).not.toHaveTextContent("prod-ops");
  });

  it("les trois étapes sont là même sans aucun accord, chacune disant que personne ne peut y déployer", async () => {
    render(<EnvironmentsPage space={FINANCE} fetcher={serveur({ [ACCORDS]: { status: 200, body: { grants: [] } }, [JOURNAL]: { status: 200, body: { events: [] } } })} target="DEV" />);
    await screen.findByRole("list", { name: "Droits de déployer, dans l'ordre de promotion" });
    await screen.findByText("Aucun événement.");
    expect(ordre()).toEqual(["DEV", "TEST", "PROD"]);
    for (const code of ["DEV", "TEST", "PROD"] as const) {
      expect(etape(code)).toHaveTextContent("Personne ne peut y déployer.");
      expect(accordsDe(code)).not.toBeInTheDocument();
    }
  });

  it("« Personne ne peut y déployer. » seulement pour un environnement vide (exemple réel : PROD)", async () => {
    await ouvrir(serveur(BASE));
    expect(etape("PROD")).toHaveTextContent("Personne ne peut y déployer.");
    expect(etape("DEV")).not.toHaveTextContent("Personne ne peut y déployer.");
    expect(etape("TEST")).not.toHaveTextContent("Personne ne peut y déployer.");
    expect(within(pipeline()).getAllByText("Personne ne peut y déployer.")).toHaveLength(1);
  });

  it.each(["DEV", "TEST", "PROD"] as const)("la cible est l'environnement choisi dans la coque : %s", async (cible) => {
    await ouvrir(serveur(BASE), cible);
    for (const code of ["DEV", "TEST", "PROD"] as const) {
      if (code === cible) {
        expect(etape(code)).toHaveAttribute("aria-current", "step");
        expect(etape(code)).toHaveClass("sb-pipeline__stage--target");
        expect(within(etape(code)).getByRole("heading", { level: 2 })).toHaveTextContent(`${code}environnement affiché`);
      } else {
        expect(etape(code)).not.toHaveAttribute("aria-current");
        expect(etape(code)).not.toHaveClass("sb-pipeline__stage--target");
        expect(within(etape(code)).getByRole("heading", { level: 2 })).toHaveTextContent(new RegExp(`^${code}$`));
      }
    }
    expect(pipeline().querySelectorAll("[aria-current]")).toHaveLength(1);
    expect(pipeline().querySelectorAll(".sb-pipeline__stage--target")).toHaveLength(1);
  });

  it("changer de cible déplace la mise en avant sans rien relire", async () => {
    const fetcher = serveur(BASE);
    const { rerender } = await ouvrir(fetcher, "DEV");
    const lues = fetcher.mock.calls.length;
    rerender(<EnvironmentsPage space={FINANCE} fetcher={fetcher} target="PROD" />);
    expect(etape("PROD")).toHaveAttribute("aria-current", "step");
    expect(etape("DEV")).not.toHaveAttribute("aria-current");
    await act(async () => { await new Promise((fin) => setTimeout(fin, 10)); });
    expect(fetcher.mock.calls).toHaveLength(lues);
  });

  it("le formulaire suit la cible quand elle change, saisie gardée, et le doublon se juge dans le nouvel environnement", async () => {
    const fetcher = serveur(BASE);
    const { rerender } = await ouvrir(fetcher, "DEV");
    await userEvent.type(nomGroupe(), "finance-createurs");
    expect(within(formulaire()).getByRole("status")).toHaveTextContent("Groupe finance-createurs peut déjà déployer en DEV : rien ne changera.");
    expect(accorder()).toBeDisabled();
    rerender(<EnvironmentsPage space={FINANCE} fetcher={fetcher} target="PROD" />);
    expect(environnement()).toHaveValue("PROD");
    expect(nomGroupe()).toHaveValue("finance-createurs");
    expect(within(formulaire()).queryByRole("status")).not.toBeInTheDocument();
    expect(accorder()).toBeEnabled();
    // Un choix fait ici l'emporte jusqu'au prochain changement de cible.
    await userEvent.selectOptions(environnement(), "DEV");
    expect(accorder()).toBeDisabled();
    rerender(<EnvironmentsPage space={FINANCE} fetcher={fetcher} target="PROD" />);
    expect(environnement()).toHaveValue("DEV");
    rerender(<EnvironmentsPage space={FINANCE} fetcher={fetcher} target="TEST" />);
    expect(environnement()).toHaveValue("TEST");
    expect(ecritures(fetcher)).toEqual([]);
  });

  it("chaque accord dit son groupe ou sa personne, son auteur et sa date", async () => {
    await ouvrir(serveur(BASE));
    const groupe = within(accordsDe("DEV") as HTMLElement).getByRole("listitem");
    expect(groupe).toHaveTextContent(/^Groupe finance-createursGroupeAccordé par Camille Martin · .*2026.*UTCRetirer$/);
    expect(within(groupe).getByRole("button", { name: "Retirer le droit de déployer en DEV : Groupe finance-createurs" })).toHaveTextContent("Retirer");
    const personne = within(accordsDe("TEST") as HTMLElement).getByRole("listitem");
    expect(personne).toHaveTextContent(/^Dominique LeroyPersonnedominique\.leroy@example\.invalidAccordé par Camille Martin · /);
    expect(personne.querySelector(".sb-grant__meta .sb-mono")?.textContent).toMatch(/2026.*UTC/);
    expect(personne.querySelector(".sb-grant__meta .sb-mono")?.textContent).not.toBe(groupe.querySelector(".sb-grant__meta .sb-mono")?.textContent);
    expect(within(personne).getByRole("button", { name: "Retirer le droit de déployer en TEST : Dominique Leroy" })).toBeInTheDocument();
  });

  it("une personne inconnue de Board se dit telle, nommée par son sujet ; un auteur inconnu se dit par son sujet", async () => {
    const liste = {
      grants: [
        accordBrut("x", "DEV", { kind: "person", issuer: "https://id.example.invalid", subject: "sujet-x" }),
        accordBrut("y", "DEV", { kind: "person", issuer: "https://id.example.invalid", subject: "sujet-y" }, { person: { name: null, email: "y@ex" }, created_by_person: { name: null, email: "auteur@ex" } }),
      ],
    };
    await ouvrir(serveur({ [ACCORDS]: { status: 200, body: liste }, [JOURNAL]: journalAccords }));
    const [x, y] = within(accordsDe("DEV") as HTMLElement).getAllByRole("listitem");
    expect(x).toHaveTextContent(/^sujet-xPersonneInconnue de Board ·https:\/\/id\.example\.invalidAccordé par 00u1a2b3c4 · /);
    expect(y).toHaveTextContent(/^y@exPersonnesujet-yAccordé par auteur@ex · /);
    expect(y).not.toHaveTextContent("Inconnue");
  });

  it("encode l'identifiant de l'espace dans ses adresses", async () => {
    const fetcher = vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(Response.json(url.endsWith("/deploy-grants") ? { grants: [] } : url.endsWith("/parameters") ? { parameters: [], environments: [] } : { events: [] })));
    render(<EnvironmentsPage space={{ ...FINANCE, id: "a/b c" }} fetcher={fetcher} target="DEV" />);
    await screen.findByText("Aucun événement.");
    await screen.findByRole("list", { name: "Droits de déployer, dans l'ordre de promotion" });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/spaces/a%2Fb%20c/deploy-grants", "/api/spaces/a%2Fb%20c/events", "/api/spaces/a%2Fb%20c/parameters"]);
  });

  it("les onglets relient « Membres et rôles », « Environnements », celui-ci courant, et « Paramètres »", async () => {
    await ouvrir(serveur(BASE));
    const onglets = screen.getByRole("navigation", { name: "Administration de l'espace" });
    expect(within(onglets).getAllByRole("link").map((lien) => [lien.textContent, lien.getAttribute("href"), lien.getAttribute("aria-current")])).toEqual([
      ["Membres et rôles", "#/espaces/finance/membres", null],
      ["Environnements", "#/espaces/finance/environnements", "page"],
      ["Paramètres", "#/espaces/finance/parametres", null],
    ]);
  });
});

describe("Environnements : lecture refusée ou en panne", () => {
  it("un rôle insuffisant est rendu tel que le serveur le dit, sans pipeline ni formulaire, le rappel gardé", async () => {
    const fetcher = serveur({ [ACCORDS]: interdit, [JOURNAL]: interdit, [PARAMETRES]: interdit });
    render(<EnvironmentsPage space={{ ...FINANCE, role: "creator" }} fetcher={fetcher} target="DEV" />);
    await waitFor(() => { expect(screen.getAllByRole("alert")).toHaveLength(2); });
    for (const alerte of screen.getAllByRole("alert")) expect(alerte).toHaveTextContent(/^Votre rôle ne permet pas cette action\.$/);
    expect(within(screen.getByRole("region", { name: "Droits de déployer" })).getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /ordre de promotion/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Accorder un droit de déployer" })).not.toBeInTheDocument();
    expect(screen.getByText(DEPLOY_REMINDER)).toBeInTheDocument();
    expect(ecritures(fetcher)).toEqual([]);
  });

  it.each([
    ["HTTP 500", { status: 500, body: {} }, "Droits de déployer indisponibles : Réponse inattendue du serveur (HTTP 500). Rien n'est affiché."],
    ["serveur muet", () => Promise.reject(new TypeError("réseau")), "Droits de déployer indisponibles : Le serveur Board ne répond pas. Rien n'est affiché."],
    ["hors contrat", { status: 200, body: { grants: [{ ...accord.body, environment: "QA" }] } }, "Droits de déployer indisponibles : Réponse du serveur hors contrat : réponse.grants[0].environment : DEV | TEST | PROD attendu. Rien n'est affiché."],
  ] as [string, Reponse, string][])("une panne de lecture (%s) n'affiche aucun droit, et le dit", async (_cas, panne, texte) => {
    render(<EnvironmentsPage space={FINANCE} fetcher={serveur({ [ACCORDS]: panne, [JOURNAL]: journalAccords })} target="DEV" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(texte);
    // Fail-closed : aucune étape, donc aucun « Personne ne peut y déployer » qui serait faux.
    expect(screen.queryByText("Personne ne peut y déployer.")).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Accorder un droit de déployer" })).not.toBeInTheDocument();
    // Le journal se lit malgré tout.
    expect(await screen.findByRole("list", { name: "Journal de l'espace" })).toBeInTheDocument();
  });

  it("un journal en panne n'empêche pas de lire les droits", async () => {
    await act(async () => { render(<EnvironmentsPage space={FINANCE} fetcher={serveur({ [ACCORDS]: accords, [JOURNAL]: { status: 502, body: "" } })} target="DEV" />); await Promise.resolve(); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Journal indisponible : Réponse inattendue du serveur (HTTP 502). Rien n'est affiché.");
    expect(await screen.findByRole("list", { name: "Droits de déployer, dans l'ordre de promotion" })).toBeInTheDocument();
  });

  it("un espace retiré pendant la lecture est signalé à la coque", async () => {
    const perdu = vi.fn();
    const quitter = onSpaceLost(perdu);
    try {
      // Les paramètres se lisent : seuls accords et journal disent l'espace perdu.
      render(<EnvironmentsPage space={FINANCE} fetcher={serveur({ [ACCORDS]: introuvable, [JOURNAL]: introuvable })} target="DEV" />);
      await waitFor(() => { expect(perdu).toHaveBeenCalledTimes(2); });
      expect(screen.getAllByRole("alert")[0]).toHaveTextContent("Espace introuvable.");
    } finally { quitter(); }
  });
});

describe("Environnements : retirer un droit de déployer", () => {
  const retirer = (code: Environment, nom: string) => within(etape(code)).getByRole("button", { name: `Retirer le droit de déployer en ${code} : ${nom}` });

  it("se confirme sur place, focus sur « Retirer », sans rien envoyer avant", async () => {
    const fetcher = serveur(BASE);
    await ouvrir(fetcher);
    await userEvent.click(retirer("TEST", "Dominique Leroy"));
    // Une espace insécable avant « ? » : le point d'interrogation ne passe jamais seul à la ligne.
    const question = "Retirer le droit de déployer en TEST : Dominique Leroy\u00a0?";
    const confirmation = within(etape("TEST")).getByRole("group", { name: question });
    expect(confirmation.getAttribute("aria-label")).toBe(question);
    expect(confirmation.querySelector(".sb-confirm__question")?.textContent).toBe(question);
    expect(confirmation.getAttribute("aria-label")).not.toContain("Leroy ?");
    expect(within(confirmation).getByRole("button", { name: "Retirer" })).toHaveFocus();
    expect(confirmation.closest("li")).toHaveClass("sb-grant--pending");
    expect(ecritures(fetcher)).toEqual([]);
  });

  it("Annuler ferme la confirmation sans rien envoyer et rend le focus au bouton « Retirer » de l'accord", async () => {
    const fetcher = serveur(BASE);
    await ouvrir(fetcher);
    await userEvent.click(retirer("TEST", "Dominique Leroy"));
    await userEvent.click(within(etape("TEST")).getByRole("button", { name: "Annuler" }));
    expect(within(etape("TEST")).queryByRole("group")).not.toBeInTheDocument();
    expect(retirer("TEST", "Dominique Leroy")).toHaveFocus();
    expect(ecritures(fetcher)).toEqual([]);
  });

  it("Annuler au clavier rend aussi le focus", async () => {
    await ouvrir(serveur(BASE));
    retirer("DEV", "Groupe finance-createurs").focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.tab();
    expect(within(etape("DEV")).getByRole("button", { name: "Annuler" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(retirer("DEV", "Groupe finance-createurs")).toHaveFocus();
  });

  it("Retirer envoie le DELETE de cet accord, puis relit accords et journal et prévient la coque", async () => {
    let retire = false;
    const ecrit = vi.fn();
    const fetcher = serveur({
      [ACCORDS]: () => Promise.resolve(reponse(retire ? { status: 200, body: { grants: [accords.body.grants[1]] } } : accords)),
      [JOURNAL]: journalAccords,
      [RETIRER_DOMINIQUE]: () => { retire = true; return Promise.resolve(reponse(retraitAccord)); },
    });
    await ouvrir(fetcher, "DEV", ecrit);
    expect(ecrit).not.toHaveBeenCalled();
    await userEvent.click(retirer("TEST", "Dominique Leroy"));
    expect(ecrit).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByText("Droit de déployer en TEST retiré : Dominique Leroy.")).toBeInTheDocument();
    expect(appels(fetcher, RETIRER_DOMINIQUE)).toHaveLength(1);
    expect(appels(fetcher, RETIRER_DOMINIQUE)[0]?.[1]).toEqual({ method: "DELETE", headers: { Accept: "application/json" } });
    expect(ecritures(fetcher)).toHaveLength(1);
    await waitFor(() => { expect(appels(fetcher, ACCORDS)).toHaveLength(2); });
    expect(appels(fetcher, JOURNAL)).toHaveLength(2);
    expect(ecrit).toHaveBeenCalledTimes(1);
    await waitFor(() => { expect(etape("TEST")).toHaveTextContent("Personne ne peut y déployer."); });
    await waitFor(() => { expect(bandeau()).toHaveFocus(); });
  });

  it("un accord déjà retiré ailleurs : le refus `grant_not_found` est dit, et la liste relue", async () => {
    const fetcher = serveur({ ...BASE, [RETIRER_CREATEURS]: accordInconnu });
    await ouvrir(fetcher);
    await userEvent.click(retirer("DEV", "Groupe finance-createurs"));
    await userEvent.click(within(etape("DEV")).getByRole("button", { name: "Retirer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/^Ce droit de déployer n'existe plus : la liste a été relue\.$/);
    await waitFor(() => { expect(appels(fetcher, ACCORDS)).toHaveLength(2); });
    expect(within(etape("DEV")).queryByRole("group")).not.toBeInTheDocument();
  });

  it("pendant l'envoi, aucune action n'est possible ; la réponse ferme la confirmation", async () => {
    const attente = differee();
    const fetcher = serveur({ ...BASE, [RETIRER_DOMINIQUE]: () => attente.promise });
    await ouvrir(fetcher);
    await userEvent.click(retirer("TEST", "Dominique Leroy"));
    await userEvent.click(within(etape("TEST")).getByRole("button", { name: "Retirer" }));
    for (const bouton of within(pipeline()).getAllByRole("button")) expect(bouton).toBeDisabled();
    expect(accorder()).toBeDisabled();
    expect(environnement()).toBeDisabled();
    expect(nomGroupe()).toBeDisabled();
    await act(async () => { attente.resolve(reponse(retraitAccord)); await Promise.resolve(); });
    await waitFor(() => { expect(within(etape("TEST")).queryByRole("group")).not.toBeInTheDocument(); });
    expect(environnement()).toBeEnabled();
  });

  it("une seule confirmation à la fois : en ouvrir une autre ferme la première et efface le message", async () => {
    const fetcher = serveur({ ...BASE, [RETIRER_CREATEURS]: accordInconnu });
    await ouvrir(fetcher);
    await userEvent.click(retirer("DEV", "Groupe finance-createurs"));
    await userEvent.click(within(etape("DEV")).getByRole("button", { name: "Retirer" }));
    await screen.findByRole("alert");
    await userEvent.click(retirer("TEST", "Dominique Leroy"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(retirer("DEV", "Groupe finance-createurs"));
    expect(within(etape("TEST")).queryByRole("group")).not.toBeInTheDocument();
    expect(within(etape("DEV")).getByRole("group")).toBeInTheDocument();
    // Ouvrir une autre confirmation ne ramène pas le focus sur le bouton de la première.
    expect(within(etape("DEV")).getByRole("button", { name: "Retirer" })).toHaveFocus();
  });

  it("une panne pendant le retrait n'est pas un succès : elle est dite, et la liste relue", async () => {
    const fetcher = serveur({ ...BASE, [RETIRER_DOMINIQUE]: { status: 503, body: "" } });
    await ouvrir(fetcher);
    await userEvent.click(retirer("TEST", "Dominique Leroy"));
    await userEvent.click(within(etape("TEST")).getByRole("button", { name: "Retirer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Changement non confirmé : Réponse inattendue du serveur (HTTP 503). La liste a été relue.");
    expect(screen.queryByText(/retiré :/)).not.toBeInTheDocument();
    await waitFor(() => { expect(appels(fetcher, ACCORDS)).toHaveLength(2); });
  });
});

describe("Environnements : accorder un droit de déployer", () => {
  it("à un groupe par son nom exact, non rogné, dans l'environnement cible par défaut", async () => {
    const fetcher = serveur({ ...BASE, [ACCORDER]: { status: 200, body: { ...accord.body, environment: "PROD", principal: { kind: "group", name: " Finance-Ops " }, person: null } } });
    await ouvrir(fetcher, "PROD");
    expect(environnement()).toHaveValue("PROD");
    expect(within(environnement()).getAllByRole("option").map((option) => option.textContent)).toEqual(["DEV", "TEST", "PROD"]);
    expect(accorder()).toBeDisabled();
    await userEvent.type(nomGroupe(), " Finance-Ops ");
    expect(accorder()).toBeEnabled();
    await userEvent.click(accorder());
    expect(corpsEnvoye(fetcher, ACCORDER)).toEqual({ environment: "PROD", principal: { kind: "group", name: " Finance-Ops " } });
    expect(await screen.findByText("Groupe  Finance-Ops  : droit de déployer en PROD accordé.", { normalizer: (texte) => texte })).toBeInTheDocument();
    await waitFor(() => { expect(appels(fetcher, ACCORDS)).toHaveLength(2); });
    expect(appels(fetcher, JOURNAL)).toHaveLength(2);
  });

  it.each(["DEV", "TEST", "PROD"] as const)("l'environnement proposé est la cible de la coque (%s)", async (cible) => {
    await ouvrir(serveur(BASE), cible);
    expect(environnement()).toHaveValue(cible);
  });

  it("dans un autre environnement choisi, et Entrée dans le nom envoie", async () => {
    const fetcher = serveur({ ...BASE, [ACCORDER]: accord });
    await ouvrir(fetcher, "DEV");
    await userEvent.selectOptions(environnement(), "TEST");
    await userEvent.type(nomGroupe(), "finance-x{Enter}");
    expect(corpsEnvoye(fetcher, ACCORDER)).toEqual({ environment: "TEST", principal: { kind: "group", name: "finance-x" } });
  });

  it("à une personne connue choisie par la recherche", async () => {
    const autre = { ...personnes.body.people[0], subject: "00u-autre", name: "Dominique Autre", email: "d.autre@example.invalid" };
    const fetcher = serveur({ ...BASE, "GET /api/people?q=dominique": { status: 200, body: { people: [autre] } }, [ACCORDER]: accord });
    await ouvrir(fetcher, "PROD");
    await userEvent.click(within(formulaire()).getByRole("radio", { name: "Personne connue" }));
    expect(accorder()).toBeDisabled();
    await userEvent.type(within(formulaire()).getByRole("searchbox"), "dominique{Enter}");
    await userEvent.click(await within(formulaire()).findByRole("button", { name: /Dominique Autre/ }));
    await userEvent.click(accorder());
    expect(corpsEnvoye(fetcher, ACCORDER)).toEqual({ environment: "PROD", principal: { kind: "person", issuer: "https://id.example.invalid", subject: "00u-autre" } });
    expect(await screen.findByText("Dominique Autre : droit de déployer en PROD accordé.")).toBeInTheDocument();
  });

  it("un groupe qui peut déjà déployer dans cet environnement : signalé, bouton fermé, rien envoyé, même par Entrée", async () => {
    const fetcher = serveur(BASE);
    await ouvrir(fetcher, "DEV");
    await userEvent.type(nomGroupe(), "finance-createurs");
    expect(within(formulaire()).getByRole("status")).toHaveTextContent(/^Groupe finance-createurs peut déjà déployer en DEV : rien ne changera\.$/);
    expect(accorder()).toBeDisabled();
    await userEvent.type(nomGroupe(), "{Enter}");
    expect(ecritures(fetcher)).toEqual([]);
  });

  it("le même groupe dans un autre environnement s'accorde : le doublon dépend de l'environnement", async () => {
    const fetcher = serveur({ ...BASE, [ACCORDER]: accord });
    await ouvrir(fetcher, "DEV");
    await userEvent.type(nomGroupe(), "finance-createurs");
    expect(accorder()).toBeDisabled();
    await userEvent.selectOptions(environnement(), "PROD");
    expect(within(formulaire()).queryByRole("status")).not.toBeInTheDocument();
    expect(accorder()).toBeEnabled();
    await userEvent.click(accorder());
    expect(corpsEnvoye(fetcher, ACCORDER)).toEqual({ environment: "PROD", principal: { kind: "group", name: "finance-createurs" } });
  });

  it("un autre nom à la casse ou aux blancs près est un autre groupe (E3) : il s'accorde", async () => {
    await ouvrir(serveur(BASE), "DEV");
    for (const nom of ["Finance-Createurs", " finance-createurs", "finance-createurs "]) {
      await userEvent.clear(nomGroupe());
      await userEvent.type(nomGroupe(), nom);
      expect(within(formulaire()).queryByRole("status"), nom).not.toBeInTheDocument();
      expect(accorder(), nom).toBeEnabled();
    }
  });

  it("une personne qui peut déjà déployer dans cet environnement est signalée ; ailleurs elle s'accorde", async () => {
    const fetcher = serveur({ ...BASE, "GET /api/people?q=leroy": personnes, [ACCORDER]: { status: 200, body: { ...accord.body, environment: "DEV" } } });
    await ouvrir(fetcher, "TEST");
    await userEvent.click(within(formulaire()).getByRole("radio", { name: "Personne connue" }));
    await userEvent.type(within(formulaire()).getByRole("searchbox"), "leroy{Enter}");
    await userEvent.click(await within(formulaire()).findByRole("button", { name: /Dominique Leroy/ }));
    expect(within(formulaire()).getByRole("status")).toHaveTextContent(/^Dominique Leroy peut déjà déployer en TEST : rien ne changera\.$/);
    expect(accorder()).toBeDisabled();
    // Le groupe du même nom n'est pas la personne : seul le principal exact compte.
    await userEvent.selectOptions(environnement(), "DEV");
    expect(within(formulaire()).queryByRole("status")).not.toBeInTheDocument();
    await userEvent.click(accorder());
    expect(corpsEnvoye(fetcher, ACCORDER)).toEqual({ environment: "DEV", principal: DOMINIQUE });
    expect(await screen.findByText("Dominique Leroy : droit de déployer en DEV accordé.")).toBeInTheDocument();
  });

  it("un groupe homonyme d'une personne autorisée n'est pas un doublon", async () => {
    await ouvrir(serveur(BASE), "TEST");
    await userEvent.type(nomGroupe(), "00u5d6e7f8");
    expect(within(formulaire()).queryByRole("status")).not.toBeInTheDocument();
    expect(accorder()).toBeEnabled();
  });

  it.each([
    ["personne inconnue", inconnue, "Cette personne n'est pas connue de Board : elle doit s'être connectée une fois."],
    ["environnement invalide", environnementInvalide, "La demande est incomplète ou mal formée. Champ en cause : environnement."],
    ["mode local", modeLocal, "En mode local, l'espace implicite ne se gère pas."],
    ["interdit", interdit, "Votre rôle ne permet pas cette action."],
    ["panne", { status: 502, body: "" }, "Changement non confirmé : Réponse inattendue du serveur (HTTP 502). La liste a été relue."],
  ] as [string, Exemple, string][])("un refus (%s) est rendu avec sa raison ; la saisie et l'environnement restent", async (_cas, exemple, texte) => {
    const fetcher = serveur({ ...BASE, [ACCORDER]: exemple });
    await ouvrir(fetcher, "DEV");
    await userEvent.type(nomGroupe(), "Finance-X ");
    await userEvent.selectOptions(environnement(), "PROD");
    await userEvent.click(accorder());
    expect(await screen.findByRole("alert")).toHaveTextContent(texte);
    await waitFor(() => { expect(bandeau()).toHaveFocus(); });
    await waitFor(() => { expect(appels(fetcher, ACCORDS)).toHaveLength(2); });
    expect(nomGroupe()).toHaveValue("Finance-X ");
    expect(environnement()).toHaveValue("PROD");
    expect(accorder()).toBeEnabled();
  });

  it("une personne choisie reste choisie après un refus", async () => {
    const fetcher = serveur({ ...BASE, "GET /api/people?q=leroy": personnes, [ACCORDER]: inconnue });
    await ouvrir(fetcher, "PROD");
    await userEvent.click(within(formulaire()).getByRole("radio", { name: "Personne connue" }));
    await userEvent.type(within(formulaire()).getByRole("searchbox"), "leroy{Enter}");
    await userEvent.click(await within(formulaire()).findByRole("button", { name: /Dominique Leroy/ }));
    await userEvent.click(accorder());
    expect(await screen.findByRole("alert")).toHaveTextContent("Cette personne n'est pas connue de Board");
    expect(within(formulaire()).getByRole("radio", { name: "Personne connue" })).toBeChecked();
    expect(formulaire()).toHaveTextContent("Dominique Leroy");
  });

  it("un accord accepté vide la saisie ; l'environnement choisi reste", async () => {
    const fetcher = serveur({ ...BASE, [ACCORDER]: accord });
    await ouvrir(fetcher, "DEV");
    await userEvent.type(nomGroupe(), "finance-x");
    await userEvent.selectOptions(environnement(), "TEST");
    await userEvent.click(accorder());
    await waitFor(() => { expect(nomGroupe()).toHaveValue(""); });
    expect(accorder()).toBeDisabled();
    expect(environnement()).toHaveValue("TEST");
  });

  it("le formulaire envoyé sans principal ne part pas", async () => {
    const fetcher = serveur(BASE);
    await ouvrir(fetcher);
    fireEvent.submit(formulaire());
    expect(ecritures(fetcher)).toEqual([]);
  });

  it("le focus va au bandeau de réponse ; un nouveau message le reprend, même identique", async () => {
    const fetcher = serveur({ ...BASE, [ACCORDER]: inconnue });
    await ouvrir(fetcher);
    for (let fois = 0; fois < 2; fois += 1) {
      await userEvent.type(nomGroupe(), "x");
      nomGroupe().focus();
      await userEvent.click(accorder());
      await waitFor(() => { expect(bandeau()).toHaveFocus(); });
      expect(bandeau()).toHaveAttribute("tabindex", "-1");
    }
    expect(appels(fetcher, ACCORDER)).toHaveLength(2);
  });

  it("la coque est prévenue après chaque écriture, refus et panne compris, jamais avant", async () => {
    const reponses: Exemple[] = [accord, inconnue, { status: 500, body: "" }];
    const fetcher = serveur({ ...BASE, [ACCORDER]: () => Promise.resolve(reponse(reponses.shift() ?? inconnue)) });
    const ecrit = vi.fn();
    await ouvrir(fetcher, "DEV", ecrit);
    for (let fois = 1; fois <= 3; fois += 1) {
      await userEvent.type(nomGroupe(), `g${String(fois)}`);
      expect(ecrit).toHaveBeenCalledTimes(fois - 1);
      await userEvent.click(accorder());
      await waitFor(() => { expect(ecrit).toHaveBeenCalledTimes(fois); });
      await userEvent.clear(nomGroupe());
    }
  });

  it("pendant la relecture, le pipeline, la saisie et le journal précédents restent affichés", async () => {
    const relecture = differee();
    let lectures = 0;
    const fetcher = serveur({
      [ACCORDS]: () => {
        lectures += 1;
        return lectures === 1 ? Promise.resolve(reponse(accords)) : relecture.promise;
      },
      [JOURNAL]: journalAccords,
      [ACCORDER]: inconnue,
    });
    await ouvrir(fetcher);
    await userEvent.type(nomGroupe(), "finance-x");
    await userEvent.click(accorder());
    await waitFor(() => { expect(lectures).toBe(2); });
    expect(screen.queryByText("Lecture des droits de déployer…")).not.toBeInTheDocument();
    expect(pipeline()).toBeInTheDocument();
    expect(nomGroupe()).toHaveValue("finance-x");
    await act(async () => { relecture.resolve(Response.json({ grants: [] })); await Promise.resolve(); });
    await waitFor(() => { expect(etape("DEV")).toHaveTextContent("Personne ne peut y déployer."); });
    expect(nomGroupe()).toHaveValue("finance-x");
  });
});

describe("Journal de l'espace : accords et retraits (V6)", () => {
  it("raconte l'exemple du serveur réel : groupe « au groupe », personne « à … », auteur nommé", async () => {
    await ouvrir(serveur(BASE));
    expect(entrees()).toEqual([
      "Alix a retiré le droit de déployer en PROD au groupe finance-admins.",
      "Alix a accordé le droit de déployer en PROD au groupe finance-admins.",
      "Camille Martin a accordé le droit de déployer en DEV au groupe finance-createurs.",
      "Camille Martin a accordé le droit de déployer en TEST à Dominique Leroy.",
      "Camille Martin a ajouté Dominique Leroy : Lecteur.",
      "Camille Martin a ajouté le groupe finance-admins : Administrateur.",
      "Camille Martin a créé l'espace « Finance ».",
    ]);
    for (const texte of entrees()) {
      expect(texte).not.toMatch(/à le groupe|à au|de le groupe à/);
    }
  });

  it("une personne visée est nommée par `principal_person`, sinon son adresse, sinon son sujet ; un groupe jamais", async () => {
    const auteur = { issuer: "https://id.example.invalid", subject: "sujet-auteur" };
    const partie = { kind: "person", issuer: "https://id.example.invalid", subject: "sujet-parti" };
    const evenement = (id: number, action: string, detail: unknown, principalPerson: unknown = null) => ({ id, at: "2026-11-02T10:00:00+00:00", actor: auteur, actor_person: null, action, detail, principal_person: principalPerson });
    const events = [
      evenement(5, "deploy_revoked", { environment: "TEST", principal: partie }, { name: "Alix Partie", email: "alix@example.invalid" }),
      evenement(4, "deploy_granted", { environment: "DEV", principal: partie }, { name: " ", email: "alix@example.invalid" }),
      evenement(3, "deploy_granted", { environment: "PROD", principal: partie }),
      evenement(2, "deploy_granted", { environment: "PROD", principal: { kind: "group", name: "finance-x" } }, { name: "Quelqu'un", email: null }),
      evenement(1, "deploy_revoked", { environment: "DEV", principal: { kind: "group", name: " Espaces " } }),
    ];
    await ouvrir(serveur({ [ACCORDS]: accords, [JOURNAL]: { status: 200, body: { events } } }));
    expect(within(journal()).getAllByRole("listitem").map((item) => item.textContent.replace(/^.*UTC/, ""))).toEqual([
      "sujet-auteur a retiré le droit de déployer en TEST à Alix Partie.",
      "sujet-auteur a accordé le droit de déployer en DEV à alix@example.invalid.",
      "sujet-auteur a accordé le droit de déployer en PROD à sujet-parti.",
      "sujet-auteur a accordé le droit de déployer en PROD au groupe finance-x.",
      "sujet-auteur a retiré le droit de déployer en DEV au groupe  Espaces .",
    ]);
  });

  it("un détail inattendu est montré tel quel, sans être interprété", async () => {
    const auteur = { issuer: "i", subject: "s" };
    const groupe = { kind: "group", name: "g" };
    const evenement = (id: number, action: string, detail: unknown) => ({ id, at: "2026-11-02T10:00:00+00:00", actor: auteur, actor_person: null, action, detail, principal_person: null });
    const events = [
      evenement(9, "deploy_granted", { environment: "QA", principal: groupe }),
      evenement(8, "deploy_granted", { environment: "dev", principal: groupe }),
      evenement(7, "deploy_revoked", { principal: groupe }),
      evenement(6, "deploy_granted", { environment: "DEV" }),
      evenement(5, "deploy_granted", { environment: "DEV", principal: { kind: "robot" } }),
      evenement(4, "deploy_revoked", null),
      evenement(3, "deploy_granted", { environment: ["DEV"], principal: groupe }),
      evenement(2, "deploy_promoted", { environment: "DEV", principal: groupe }),
      evenement(1, "deploy_granted", { environment: "PROD", principal: groupe, after: "admin" }),
    ];
    await ouvrir(serveur({ [ACCORDS]: accords, [JOURNAL]: { status: 200, body: { events } } }));
    expect(within(journal()).getAllByRole("listitem").map((item) => item.textContent.replace(/^.*UTC/, ""))).toEqual([
      's action non reconnue : deploy_granted {"environment":"QA","principal":{"kind":"group","name":"g"}}',
      's action non reconnue : deploy_granted {"environment":"dev","principal":{"kind":"group","name":"g"}}',
      's action non reconnue : deploy_revoked {"principal":{"kind":"group","name":"g"}}',
      's action non reconnue : deploy_granted {"environment":"DEV"}',
      's action non reconnue : deploy_granted {"environment":"DEV","principal":{"kind":"robot"}}',
      "s action non reconnue : deploy_revoked null",
      's action non reconnue : deploy_granted {"environment":["DEV"],"principal":{"kind":"group","name":"g"}}',
      's action non reconnue : deploy_promoted {"environment":"DEV","principal":{"kind":"group","name":"g"}}',
      // Un champ en plus ne change pas le sens : l'accord reste raconté.
      "s a accordé le droit de déployer en PROD au groupe g.",
    ]);
  });

  it("aucune action ne s'écrit dans le journal depuis la page", async () => {
    await ouvrir(serveur(BASE));
    expect(within(journal()).queryByRole("button")).not.toBeInTheDocument();
  });
});
