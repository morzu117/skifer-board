import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "vitest";

import espace from "../../../../contracts/espaces/espace.json";
import interdit from "../../../../contracts/espaces/interdit.json";
import journalParametres from "../../../../contracts/espaces/journal-parametres.json";
import parametre from "../../../../contracts/espaces/parametre.json";
import parametreExistant from "../../../../contracts/espaces/parametre-existant.json";
import parametreInconnu from "../../../../contracts/espaces/parametre-inconnu.json";
import parametreModifie from "../../../../contracts/espaces/parametre-modifie.json";
import parametres from "../../../../contracts/espaces/parametres.json";
import retraitParametre from "../../../../contracts/espaces/retrait-parametre.json";
import valeur from "../../../../contracts/espaces/valeur.json";
import valeurInterdite from "../../../../contracts/espaces/valeur-interdite.json";
import valeurInvalide from "../../../../contracts/espaces/valeur-invalide.json";
import valeursIncompatibles from "../../../../contracts/espaces/valeurs-incompatibles.json";
import { formatInstant } from "../format/date";
import type { Environment } from "../shell/sections";
import type { Fetch } from "./api";
import { decodeSpace } from "./model";
import { PARAMETER_REMINDER, ParametersPage } from "./ParametersPage";

// Écran « Paramètres » d'un espace (écrans §9, plan 10, 10.3). Les réponses simulées sont les
// exemples du serveur réel (contracts/espaces) ; toute autre requête est inattendue.

type Exemple = { status: number; body: unknown };
type Reponse = Exemple | (() => Promise<Response>);
type Brut = Record<string, unknown>;
type Corps = { parameters: Brut[]; environments: (Brut & { values: Brut[] })[] };
const reponse = (exemple: Exemple) => (exemple.body === null ? new Response(null, { status: exemple.status }) : Response.json(exemple.body, { status: exemple.status }));
const FINANCE = decodeSpace(espace.body, "espace");
const PARAMETRES = "GET /api/spaces/finance/parameters";
const JOURNAL = "GET /api/spaces/finance/events";
const DECLARER = "POST /api/spaces/finance/parameters";
const poser = (nom: string, code: Environment) => `PUT /api/spaces/finance/parameters/${nom}/values/${code}`;
const vider = (nom: string, code: Environment) => `DELETE /api/spaces/finance/parameters/${nom}/values/${code}`;
const modifier = (nom: string) => `PUT /api/spaces/finance/parameters/${nom}`;
const retirer = (nom: string) => `DELETE /api/spaces/finance/parameters/${nom}`;
const ALIX_REF = { issuer: "https://id.example.invalid", subject: "00u9admin" };
const ALIX = { name: "Alix", email: "alix@ex.invalid" };

function serveur(table: Readonly<Record<string, Reponse>>): Mock<Fetch> {
  return vi.fn<Fetch>().mockImplementation((url, init) => {
    const cle = `${init?.method ?? "GET"} ${url}`;
    const exemple = table[cle];
    if (exemple === undefined) return Promise.reject(new Error(`appel inattendu : ${cle}`));
    return typeof exemple === "function" ? exemple() : Promise.resolve(reponse(exemple));
  });
}
const BASE = { [PARAMETRES]: parametres, [JOURNAL]: journalParametres };
function differee() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((ok) => { resolve = ok; });
  return { promise, resolve };
}
const appels = (fetcher: Mock<Fetch>, cle: string) => fetcher.mock.calls.filter(([url, init]) => `${init?.method ?? "GET"} ${url}` === cle);
const corpsEnvoye = (fetcher: Mock<Fetch>, cle: string, rang = 0) => JSON.parse(appels(fetcher, cle)[rang]?.[1]?.body as string) as unknown;
const ecritures = (fetcher: Mock<Fetch>) => fetcher.mock.calls.filter(([, init]) => (init?.method ?? "GET") !== "GET").map(([url, init]) => `${init?.method ?? "GET"} ${url}`);
const copie = (): Corps => structuredClone(parametres.body);
const servi = (corps: unknown): Exemple => ({ status: 200, body: corps });
const resolue = (name: string, extra: Brut = {}) => ({ name, state: "missing", value: null, set_at: null, set_by: null, set_by_person: null, ...extra });
const propre = (value: unknown, at = "2026-11-02T10:40:00+00:00") => ({ state: "value", value, set_at: at, set_by: ALIX_REF, set_by_person: ALIX });
/** Configuration d'un seul paramètre déclaré ; `valeurs` par environnement. */
function unSeul(declaration: Brut, valeurs: readonly Brut[] = [{}, {}, {}], canSet: readonly boolean[] = [true, true, false]): Corps {
  const corps = copie();
  const name = (declaration.name as string | undefined) ?? "p";
  corps.parameters = [{ ...corps.parameters[0], name, ...declaration }];
  corps.environments = corps.environments.map((environment, rang) => {
    const cellule = resolue(name, valeurs[rang]);
    const manquant = cellule.state === "missing";
    return { ...environment, can_set: canSet[rang], complete: !manquant, missing: manquant ? [name] : [], values: [cellule] };
  });
  return corps;
}
/** Complétude recalculée depuis les états, comme le serveur : le décodage refuse tout écart. */
function coherent(corps: Corps): Corps {
  for (const environment of corps.environments) {
    environment.missing = environment.values.filter((value) => value.state === "missing").map((value) => value.name);
    environment.complete = (environment.missing as string[]).length === 0;
  }
  return corps;
}
/** Configuration sans aucun paramètre. */
function aucun(canSet: readonly boolean[] = [true, true, false]): Corps {
  const corps = copie();
  corps.parameters = [];
  corps.environments = corps.environments.map((environment, rang) => ({ ...environment, can_set: canSet[rang], complete: true, missing: [], values: [] }));
  return corps;
}

const grille = () => screen.getByRole("table", { name: "Paramètres et valeurs par environnement" });
const entetes = () => within(grille()).getAllByRole("columnheader").map((entete) => entete.textContent);
const lignes = () => within(grille()).getAllByRole("rowheader").map((entete) => entete.querySelector(".sb-mono")?.textContent);
const ligne = (nom: string) => {
  const entete = within(grille()).getAllByRole("rowheader").find((candidat) => candidat.querySelector(".sb-mono")?.textContent === nom);
  return entete?.closest("tr") as HTMLTableRowElement;
};
const COLONNES = { DEV: 4, TEST: 5, PROD: 6 } as const;
const cellule = (nom: string, code: Environment) => ligne(nom).children[COLONNES[code]] as HTMLElement;
const colonnes = (nom: string) => [...ligne(nom).children].map((case_) => case_.textContent);
const enteteEnv = (code: Environment) => within(grille()).getAllByRole("columnheader")[COLONNES[code]] as HTMLElement;
const formValeur = () => screen.getByRole("form", { name: "Poser une valeur" });
const choixParametre = () => within(formValeur()).getByRole("combobox", { name: "Paramètre" });
const choixEnv = () => within(formValeur()).getByRole("combobox", { name: "Environnement" });
const options = (select: HTMLElement) => within(select).getAllByRole("option").map((option) => [option.getAttribute("value"), option.textContent]);
const saisieValeur = () => within(formValeur()).getByRole("textbox", { name: /^Valeur/ });
const choixValeur = () => within(formValeur()).getByRole("combobox", { name: /^Valeur/ });
const boutonPoser = () => within(formValeur()).getByRole("button", { name: "Poser la valeur" });
const formDeclaration = () => screen.getByRole("form", { name: /^(Déclarer un paramètre|Modifier la déclaration de)/ });
const champ = (nom: RegExp) => within(formDeclaration()).getByRole("textbox", { name: nom });
const type = () => within(formDeclaration()).getByRole("combobox", { name: "Type" });
const bandeau = () => document.querySelector<HTMLElement>(".sb-members__feedback");
const journal = () => screen.getByRole("list", { name: "Journal de l'espace" });

async function ouvrir(fetcher: Mock<Fetch>, target: Environment = "DEV", onWritten?: () => void) {
  const rendu = render(onWritten === undefined ? <ParametersPage space={FINANCE} fetcher={fetcher} target={target} /> : <ParametersPage space={FINANCE} fetcher={fetcher} target={target} onWritten={onWritten} />);
  await screen.findByRole("list", { name: "Journal de l'espace" });
  await waitFor(() => { expect(screen.queryByText("Lecture des paramètres…")).not.toBeInTheDocument(); });
  return rendu;
}

describe("Paramètres : lecture (écrans §9, plan 10, 10.3)", () => {
  it("annonce les lectures, garde le rappel permanent, puis montre la grille et les formulaires", async () => {
    const lus = differee();
    const evenements = differee();
    const fetcher = serveur({ [PARAMETRES]: () => lus.promise, [JOURNAL]: () => evenements.promise });
    render(<ParametersPage space={FINANCE} fetcher={fetcher} target="DEV" />);
    expect(screen.getByRole("heading", { level: 1, name: "Paramètres" })).toBeInTheDocument();
    expect(screen.getByText("finance", { selector: ".sb-mono" }).parentElement).toHaveTextContent("Finance · finance");
    expect(screen.getByText(PARAMETER_REMINDER)).toBeInTheDocument();
    expect(screen.getByText("Lecture des paramètres…")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Lecture du journal…")).toHaveAttribute("aria-busy", "true");
    // Rien à poser ni à déclarer tant que la configuration n'est pas lue.
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method, init?.signal instanceof AbortSignal])).toEqual([
      ["/api/spaces/finance/parameters", "GET", true],
      ["/api/spaces/finance/events", "GET", true],
    ]);
    await act(async () => { lus.resolve(reponse(parametres)); evenements.resolve(reponse(journalParametres)); await Promise.resolve(); });
    await screen.findByRole("table", { name: "Paramètres et valeurs par environnement" });
    expect(screen.queryByText("Lecture des paramètres…")).not.toBeInTheDocument();
    expect(formValeur()).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Déclarer un paramètre" })).toBeInTheDocument();
    expect(ecritures(fetcher)).toEqual([]);
  });

  it("le rappel : un paramètre n'est jamais un secret, et changer une valeur demande le droit de déployer", () => {
    expect(PARAMETER_REMINDER).toBe("Un paramètre n'est jamais un secret, et changer une valeur demande le droit de déployer dans l'environnement.");
  });

  it("le rappel est dans un bandeau neutre, avant la grille", async () => {
    await ouvrir(serveur(BASE));
    const rappel = screen.getByText(PARAMETER_REMINDER);
    expect(rappel.closest('[role="status"]')).toHaveTextContent(`${PARAMETER_REMINDER} Une valeur est une donnée typée, jamais un fragment de requête.`);
    expect(rappel.compareDocumentPosition(grille()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("grille : en-têtes dans l'ordre, une colonne par environnement DEV | TEST | PROD avec sa complétude", async () => {
    await ouvrir(serveur(BASE));
    expect(entetes()).toEqual(["Paramètre", "Type et contraintes", "Obligatoire", "Défaut", "DEVenvironnement affichéincomplet · 1 manquant", "TESTincomplet · 2 manquants", "PRODincomplet · 2 manquants", "Actions"]);
    expect(within(enteteEnv("DEV")).getByText("incomplet · 1 manquant")).toHaveClass("sb-badge--danger");
    expect(within(enteteEnv("DEV")).getByText("DEV")).toHaveClass("sb-mono");
    // La grille défile dans son conteneur, que le clavier atteint.
    const conteneur = screen.getByRole("group", { name: "Paramètres et valeurs par environnement" });
    expect(conteneur).toHaveClass("sb-table-wrap");
    expect(conteneur).toHaveAttribute("tabindex", "0");
  });

  it("grille : une ligne par paramètre, dans l'ordre des déclarations, avec type, contraintes, obligatoire et défaut", async () => {
    await ouvrir(serveur(BASE));
    expect(lignes()).toEqual(["catalogue", "lignes_max", "region"]);
    const alix = (iso: string) => `Alix · ${formatInstant(new Date(iso))}`;
    expect(colonnes("catalogue")).toEqual([
      "catalogueCatalogue des tables publiées",
      "Identifiant",
      "oui",
      "aucun",
      `finance_devvaleur propre${alix("2026-11-02T10:40:00Z")}ChangerVider`,
      "—manquantPoser",
      "—manquant",
      "ModifierRetirer",
    ]);
    expect(colonnes("lignes_max")).toEqual(["lignes_max", "Entier · de 1 à 100000", "non", "5000", "5000par défautPoser", `20000valeur propre${alix("2026-11-02T10:41:00Z")}ChangerVider`, "5000par défaut", "ModifierRetirer"]);
    expect(colonnes("region")).toEqual(["regionRégion de calcul", "Choix · eu-west, eu-central", "oui", "aucun", "—manquantPoser", "—manquantPoser", "—manquant", "ModifierRetirer"]);
    // Ni description vide affichée, ni valeur inventée.
    expect(ligne("lignes_max").querySelector(".sb-params__description")).toBeNull();
    expect(within(cellule("catalogue", "DEV")).getByText("finance_dev")).toHaveClass("sb-mono");
    expect(within(ligne("lignes_max")).getAllByText("5000")[0]).toHaveClass("sb-mono");
  });

  it("chaque état a son mot et son ton : manquant en refus, les autres neutres", async () => {
    await ouvrir(serveur(BASE));
    expect(within(cellule("region", "DEV")).getByText("manquant")).toHaveClass("sb-badge", "sb-badge--danger");
    expect(within(cellule("catalogue", "DEV")).getByText("valeur propre")).toHaveClass("sb-badge--neutral");
    expect(within(cellule("lignes_max", "DEV")).getByText("par défaut")).toHaveClass("sb-badge--neutral");
  });

  it("état « absent » et environnement complet : « absent », « — », « complet » en succès", async () => {
    await ouvrir(serveur({ ...BASE, [PARAMETRES]: servi(unSeul({ type: "text", constraints: { max_length: 64 }, required: false, default: null, description: "" }, [{ state: "absent" }, { state: "absent" }, { state: "absent" }])) }));
    expect(entetes().slice(4, 7)).toEqual(["DEVenvironnement affichécomplet", "TESTcomplet", "PRODcomplet"]);
    expect(within(enteteEnv("TEST")).getByText("complet")).toHaveClass("sb-badge--success");
    expect(colonnes("p").slice(1, 7)).toEqual(["Texte · 64 caractères au plus", "non", "aucun", "—absentPoser", "—absentPoser", "—absent"]);
    expect(within(cellule("p", "PROD")).getByText("absent")).toHaveClass("sb-badge--neutral");
  });

  it("un booléen s'affiche « vrai » ou « faux », en défaut comme en valeur propre", async () => {
    await ouvrir(serveur({ ...BASE, [PARAMETRES]: servi(unSeul({ type: "boolean", constraints: {}, required: true, default: true }, [propre(false), { state: "default", value: true }, propre(true)], [true, true, true])) }));
    expect(colonnes("p").slice(1, 7).map((texte) => texte.replace(/Alix.*UTC/, "Alix"))).toEqual([
      "Booléen",
      "oui",
      "vrai",
      "fauxvaleur propreAlixChangerVider",
      "vraipar défautPoser",
      "vraivaleur propreAlixChangerVider",
    ]);
  });

  it("l'auteur d'une valeur propre est nommé par ce que Board sait de lui, sinon par son sujet", async () => {
    const corps = unSeul({ type: "identifier", constraints: {}, required: false, default: null }, [{ ...propre("a"), set_by_person: null }, { ...propre("b"), set_by_person: { name: null, email: "x@ex.invalid" } }, { state: "absent" }]);
    await ouvrir(serveur({ ...BASE, [PARAMETRES]: servi(corps) }));
    expect(cellule("p", "DEV").querySelector(".sb-params__meta")).toHaveTextContent(`00u9admin · ${formatInstant(new Date("2026-11-02T10:40:00Z"))}`);
    expect(cellule("p", "TEST").querySelector(".sb-params__meta")).toHaveTextContent(/^x@ex\.invalid · /);
    expect(cellule("p", "PROD").querySelector(".sb-params__meta")).toBeNull();
    // Seule une valeur propre a un auteur et une date.
    expect(cellule("p", "DEV").querySelector(".sb-params__meta .sb-mono")).toHaveTextContent(formatInstant(new Date("2026-11-02T10:40:00Z")));
  });

  it("complétude : « 1 manquant » au singulier, « n manquants » au pluriel", async () => {
    // lignes_max obligatoire sans défaut : posé en DEV et TEST, manquant en PROD.
    const corps = copie();
    Object.assign(corps.parameters[1] as Brut, { required: true, default: null });
    Object.assign((corps.environments[0] as Corps["environments"][number]).values[1] as Brut, propre(300));
    Object.assign((corps.environments[2] as Corps["environments"][number]).values[1] as Brut, resolue("lignes_max"));
    await ouvrir(serveur({ ...BASE, [PARAMETRES]: servi(coherent(corps)) }), "TEST");
    expect(entetes().slice(4, 7)).toEqual(["DEVincomplet · 1 manquant", "TESTenvironnement affichéincomplet · 2 manquants", "PRODincomplet · 3 manquants"]);
  });

  it.each(["DEV", "TEST", "PROD"] as const)("la colonne de l'environnement de la coque (%s) est repérée, en-tête et cellules, et elle seule", async (cible) => {
    await ouvrir(serveur(BASE), cible);
    for (const code of ["DEV", "TEST", "PROD"] as const) {
      expect(enteteEnv(code).classList.contains("sb-params__env--target"), code).toBe(code === cible);
      for (const nom of ["catalogue", "lignes_max", "region"]) {
        expect(cellule(nom, code).classList.contains("sb-params__value--target"), `${nom} ${code}`).toBe(code === cible);
      }
    }
    expect(document.querySelectorAll(".sb-params__env--target")).toHaveLength(1);
  });

  it("la cible suit la coque sans relire", async () => {
    const fetcher = serveur(BASE);
    const { rerender } = await ouvrir(fetcher, "DEV");
    const avant = fetcher.mock.calls.length;
    rerender(<ParametersPage space={FINANCE} fetcher={fetcher} target="PROD" />);
    expect(enteteEnv("PROD")).toHaveClass("sb-params__env--target");
    expect(enteteEnv("DEV")).not.toHaveClass("sb-params__env--target");
    expect(fetcher.mock.calls).toHaveLength(avant);
  });

  it.each(["DEV", "TEST", "PROD"] as const)("la colonne de la cible (%s) est dite en texte, pas seulement par la couleur, et elle seule", async (cible) => {
    await ouvrir(serveur(BASE), cible);
    const notes = within(grille()).getAllByText("environnement affiché");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveClass("sb-params__note");
    expect(enteteEnv(cible)).toContainElement(notes[0] as HTMLElement);
    // Sous le code de l'environnement, avant la complétude.
    expect(enteteEnv(cible).textContent).toMatch(new RegExp(`^${cible}environnement affiché(in)?complet`));
  });

  it("la note de la cible suit la coque", async () => {
    const fetcher = serveur(BASE);
    const { rerender } = await ouvrir(fetcher, "DEV");
    rerender(<ParametersPage space={FINANCE} fetcher={fetcher} target="PROD" />);
    expect(within(enteteEnv("PROD")).getByText("environnement affiché")).toBeInTheDocument();
    expect(within(enteteEnv("DEV")).queryByText("environnement affiché")).not.toBeInTheDocument();
  });

  it("aucun paramètre : la grille le dit, chaque environnement est complet ; rien à poser, la déclaration reste offerte", async () => {
    await ouvrir(serveur({ ...BASE, [PARAMETRES]: servi(aucun()) }));
    expect(screen.getByText("Aucun paramètre déclaré : chaque environnement est complet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Poser une valeur" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Poser une valeur" })).not.toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Déclarer un paramètre" })).toBeInTheDocument();
  });

  it("le journal de l'espace est présent, avec ses événements", async () => {
    await ouvrir(serveur(BASE));
    expect(within(journal()).getAllByRole("listitem")).toHaveLength(journalParametres.body.events.length);
    expect(screen.getByRole("region", { name: "Journal de l'espace" })).toContainElement(journal());
  });

  it("les onglets relient les trois écrans d'administration, « Paramètres » courant", async () => {
    await ouvrir(serveur(BASE));
    const onglets = screen.getByRole("navigation", { name: "Administration de l'espace" });
    expect(within(onglets).getAllByRole("link").map((lien) => [lien.textContent, lien.getAttribute("href"), lien.getAttribute("aria-current")])).toEqual([
      ["Membres et rôles", "#/espaces/finance/membres", null],
      ["Environnements", "#/espaces/finance/environnements", null],
      ["Paramètres", "#/espaces/finance/parametres", "page"],
    ]);
    const titre = screen.getByRole("heading", { level: 1, name: "Paramètres" });
    expect(titre.compareDocumentPosition(onglets) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(onglets.compareDocumentPosition(screen.getByText(PARAMETER_REMINDER)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("Paramètres : lecture refusée ou en panne", () => {
  it("un rôle insuffisant est rendu tel que le serveur le dit, sans grille ni formulaire, le rappel gardé", async () => {
    const fetcher = serveur({ [PARAMETRES]: interdit, [JOURNAL]: interdit });
    render(<ParametersPage space={{ ...FINANCE, role: "creator" }} fetcher={fetcher} target="DEV" />);
    await waitFor(() => { expect(screen.getAllByRole("alert")).toHaveLength(2); });
    for (const alerte of screen.getAllByRole("alert")) expect(alerte).toHaveTextContent(/^Votre rôle ne permet pas cette action\.$/);
    expect(within(screen.getByRole("region", { name: "Paramètres déclarés" })).getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.getByText(PARAMETER_REMINDER)).toBeInTheDocument();
    expect(ecritures(fetcher)).toEqual([]);
  });

  it.each([
    ["serveur muet", () => Promise.reject(new TypeError("réseau")), "Paramètres indisponibles : Le serveur Board ne répond pas. Rien n'est affiché."],
    ["panne HTTP", () => Promise.resolve(new Response("oups", { status: 500 })), "Paramètres indisponibles : Réponse inattendue du serveur (HTTP 500). Rien n'est affiché."],
    [
      "environnements désordonnés",
      () => { const corps = copie(); corps.environments.reverse(); return Promise.resolve(Response.json(corps)); },
      "Paramètres indisponibles : Réponse du serveur hors contrat : réponse.environments : DEV | TEST | PROD attendus dans cet ordre. Rien n'est affiché.",
    ],
    [
      "valeur d'un autre type",
      () => { const corps = copie(); ((corps.environments[1] as Corps["environments"][number]).values[1] as Brut).value = "20000"; return Promise.resolve(Response.json(corps)); },
      "Paramètres indisponibles : Réponse du serveur hors contrat : réponse.environments[1].values[1].value : entier attendu. Rien n'est affiché.",
    ],
  ])("une lecture en échec (%s) est dite, sans grille ni valeur partielle", async (_cas, lecture, message) => {
    render(<ParametersPage space={FINANCE} fetcher={serveur({ [PARAMETRES]: lecture, [JOURNAL]: journalParametres })} target="DEV" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("finance_dev")).not.toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    await screen.findByRole("list", { name: "Journal de l'espace" });
  });
});

describe("Paramètres : boutons de valeur là où le serveur l'autorise (P6)", () => {
  it("« Poser » ou « Changer » seulement dans les environnements où `can_set` est vrai ; « Vider » seulement pour une valeur propre", async () => {
    await ouvrir(serveur(BASE));
    const boutons = within(grille()).getAllByRole("button").map((bouton) => bouton.getAttribute("aria-label"));
    expect(boutons).toEqual([
      "Changer la valeur de catalogue en DEV",
      "Vider la valeur de catalogue en DEV",
      "Poser la valeur de catalogue en TEST",
      "Modifier la déclaration de catalogue",
      "Retirer le paramètre catalogue",
      "Poser la valeur de lignes_max en DEV",
      "Changer la valeur de lignes_max en TEST",
      "Vider la valeur de lignes_max en TEST",
      "Modifier la déclaration de lignes_max",
      "Retirer le paramètre lignes_max",
      "Poser la valeur de region en DEV",
      "Poser la valeur de region en TEST",
      "Modifier la déclaration de region",
      "Retirer le paramètre region",
    ]);
    // PROD : `can_set` faux, aucune action de valeur, même pour une valeur propre ou par défaut.
    for (const nom of ["catalogue", "lignes_max", "region"]) expect(within(cellule(nom, "PROD")).queryByRole("button")).not.toBeInTheDocument();
  });

  it("une valeur propre en PROD sans `can_set` se lit, sans « Vider »", async () => {
    await ouvrir(serveur({ ...BASE, [PARAMETRES]: servi(unSeul({ type: "identifier", constraints: {}, required: true, default: null }, [propre("a"), propre("b"), propre("c")])) }));
    expect(cellule("p", "PROD")).toHaveTextContent(/^cvaleur propreAlix/);
    expect(within(cellule("p", "PROD")).queryByRole("button")).not.toBeInTheDocument();
    expect(within(cellule("p", "TEST")).getByRole("button", { name: "Vider la valeur de p en TEST" })).toBeInTheDocument();
  });

  it("`can_set` faux partout : aucun bouton de valeur, et le formulaire dit qu'aucun environnement n'est ouvert", async () => {
    const corps = copie();
    for (const environment of corps.environments) environment.can_set = false;
    await ouvrir(serveur({ ...BASE, [PARAMETRES]: servi(corps) }));
    expect(within(grille()).queryAllByRole("button", { name: /la valeur de/ })).toEqual([]);
    expect(within(grille()).getAllByRole("button", { name: /^(Modifier la déclaration|Retirer le paramètre)/ })).toHaveLength(6);
    expect(screen.queryByRole("form", { name: "Poser une valeur" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Poser une valeur" })).toHaveTextContent(
      "Vous ne pouvez poser de valeur dans aucun environnement : il faut le rôle Administrateur dans l'espace et le droit d'y déployer.",
    );
  });

  it("`can_set` faux partout et aucun paramètre : le message est gardé", async () => {
    await ouvrir(serveur({ ...BASE, [PARAMETRES]: servi(aucun([false, false, false])) }));
    expect(screen.getByRole("region", { name: "Poser une valeur" })).toHaveTextContent(/aucun environnement/);
  });

  it("`can_set` vrai en PROD seulement : les boutons ne sont qu'en PROD", async () => {
    await ouvrir(serveur({ ...BASE, [PARAMETRES]: servi(unSeul({ type: "identifier", constraints: {}, required: true, default: null }, [propre("a"), propre("b"), propre("c")], [false, false, true])) }));
    expect(within(grille()).getAllByRole("button", { name: /la valeur de/ }).map((bouton) => bouton.getAttribute("aria-label"))).toEqual([
      "Changer la valeur de p en PROD",
      "Vider la valeur de p en PROD",
    ]);
    expect(options(choixEnv())).toEqual([["PROD", "PROD"]]);
  });
});

describe("Paramètres : vider une valeur", () => {
  it("demande confirmation sur place, focus sur « Vider » ; Annuler rend le focus au bouton, sans rien envoyer", async () => {
    const fetcher = serveur(BASE);
    await ouvrir(fetcher);
    const bouton = within(cellule("catalogue", "DEV")).getByRole("button", { name: "Vider la valeur de catalogue en DEV" });
    await userEvent.click(bouton);
    const confirmation = within(cellule("catalogue", "DEV")).getByRole("group", { name: "Vider la valeur de catalogue en DEV ?" });
    expect(within(confirmation).getByRole("button", { name: "Vider" })).toHaveFocus();
    // La confirmation remplace les actions de la cellule ; la valeur reste lisible.
    expect(within(cellule("catalogue", "DEV")).queryByRole("button", { name: /^(Poser|Changer) la valeur/ })).not.toBeInTheDocument();
    expect(cellule("catalogue", "DEV")).toHaveTextContent(/^finance_devvaleur propre/);
    await userEvent.click(within(confirmation).getByRole("button", { name: "Annuler" }));
    expect(within(cellule("catalogue", "DEV")).getByRole("button", { name: "Vider la valeur de catalogue en DEV" })).toHaveFocus();
    expect(ecritures(fetcher)).toEqual([]);
  });

  it("confirmé : DELETE à l'environnement, réponse annoncée et focalisée, grille relue, coque prévenue", async () => {
    let vide = false;
    const onWritten = vi.fn();
    const relue = () => {
      const corps = copie();
      if (vide) Object.assign((corps.environments[0] as Corps["environments"][number]).values[0] as Brut, { state: "missing", value: null, set_at: null, set_by: null, set_by_person: null });
      return Promise.resolve(Response.json(coherent(corps)));
    };
    const fetcher = serveur({ ...BASE, [PARAMETRES]: relue, [vider("catalogue", "DEV")]: () => { vide = true; return Promise.resolve(reponse(retraitParametre)); } });
    await ouvrir(fetcher, "DEV", onWritten);
    await userEvent.click(within(cellule("catalogue", "DEV")).getByRole("button", { name: "Vider la valeur de catalogue en DEV" }));
    await userEvent.click(within(cellule("catalogue", "DEV")).getByRole("button", { name: "Vider" }));
    expect(await screen.findByText("Valeur de catalogue en DEV vidée.")).toBeInTheDocument();
    expect(bandeau()).toHaveFocus();
    await waitFor(() => { expect(cellule("catalogue", "DEV")).toHaveTextContent(/^—manquantPoser$/); });
    expect(ecritures(fetcher)).toEqual(["DELETE /api/spaces/finance/parameters/catalogue/values/DEV"]);
    expect(appels(fetcher, vider("catalogue", "DEV"))[0]?.[1]?.body).toBeUndefined();
    expect(appels(fetcher, PARAMETRES)).toHaveLength(2);
    expect(appels(fetcher, JOURNAL)).toHaveLength(2);
    expect(onWritten).toHaveBeenCalledTimes(1);
  });

  it("une seule confirmation à la fois : en ouvrir une autre ferme la première", async () => {
    await ouvrir(serveur(BASE));
    await userEvent.click(within(cellule("catalogue", "DEV")).getByRole("button", { name: /^Vider/ }));
    await userEvent.click(within(cellule("lignes_max", "TEST")).getByRole("button", { name: /^Vider/ }));
    expect(screen.getAllByRole("group", { name: /\?$/ }).map((groupe) => groupe.getAttribute("aria-label"))).toEqual(["Vider la valeur de lignes_max en TEST ?"]);
  });

  it("refusé : la raison est rendue, la grille relue", async () => {
    const fetcher = serveur({ ...BASE, [vider("catalogue", "DEV")]: parametreInconnu });
    await ouvrir(fetcher);
    await userEvent.click(within(cellule("catalogue", "DEV")).getByRole("button", { name: /^Vider/ }));
    await userEvent.click(within(cellule("catalogue", "DEV")).getByRole("button", { name: "Vider" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ce paramètre n'existe plus : la liste a été relue.");
    expect(bandeau()).toHaveFocus();
    await waitFor(() => { expect(appels(fetcher, PARAMETRES)).toHaveLength(2); });
  });

  it("pendant l'écriture, tous les boutons sont désactivés", async () => {
    const attente = differee();
    await ouvrir(serveur({ ...BASE, [vider("catalogue", "DEV")]: () => attente.promise }));
    await userEvent.click(within(cellule("catalogue", "DEV")).getByRole("button", { name: /^Vider/ }));
    await userEvent.click(within(cellule("catalogue", "DEV")).getByRole("button", { name: "Vider" }));
    for (const bouton of within(grille()).getAllByRole("button")) expect(bouton).toBeDisabled();
    expect(boutonPoser()).toBeDisabled();
    expect(choixParametre()).toBeDisabled();
    await act(async () => { attente.resolve(reponse(retraitParametre)); await Promise.resolve(); });
    await screen.findByText("Valeur de catalogue en DEV vidée.");
  });
});

describe("Paramètres : retirer un paramètre (P5)", () => {
  it("demande confirmation (il retire ses valeurs) ; Annuler rend le focus à « Retirer »", async () => {
    const fetcher = serveur(BASE);
    await ouvrir(fetcher);
    await userEvent.click(within(ligne("region")).getByRole("button", { name: "Retirer le paramètre region" }));
    const confirmation = within(ligne("region")).getByRole("group", { name: "Retirer le paramètre region et ses valeurs ?" });
    expect(ligne("region")).toHaveClass("sb-row--selected");
    expect(within(confirmation).getByRole("button", { name: "Retirer" })).toHaveFocus();
    expect(within(ligne("region")).queryByRole("button", { name: /^Modifier la déclaration/ })).not.toBeInTheDocument();
    await userEvent.click(within(confirmation).getByRole("button", { name: "Annuler" }));
    expect(within(ligne("region")).getByRole("button", { name: "Retirer le paramètre region" })).toHaveFocus();
    expect(ligne("region")).not.toHaveClass("sb-row--selected");
    expect(ecritures(fetcher)).toEqual([]);
  });

  it("confirmé : DELETE au nom, réponse annoncée, la ligne disparaît à la relecture", async () => {
    let retire = false;
    const relue = () => {
      const corps = copie();
      if (retire) {
        corps.parameters.pop();
        for (const environment of corps.environments) {
          environment.values.pop();
          environment.missing = (environment.missing as string[]).filter((nom) => nom !== "region");
          environment.complete = (environment.missing as string[]).length === 0;
        }
      }
      return Promise.resolve(Response.json(corps));
    };
    const fetcher = serveur({ ...BASE, [PARAMETRES]: relue, [retirer("region")]: () => { retire = true; return Promise.resolve(reponse(retraitParametre)); } });
    await ouvrir(fetcher);
    await userEvent.click(within(ligne("region")).getByRole("button", { name: "Retirer le paramètre region" }));
    await userEvent.click(within(ligne("region")).getByRole("button", { name: "Retirer" }));
    expect(await screen.findByText("Paramètre region retiré, avec ses valeurs.")).toBeInTheDocument();
    expect(bandeau()).toHaveFocus();
    await waitFor(() => { expect(lignes()).toEqual(["catalogue", "lignes_max"]); });
    expect(ecritures(fetcher)).toEqual(["DELETE /api/spaces/finance/parameters/region"]);
    expect(entetes()[4]).toBe("DEVenvironnement affichécomplet");
  });

  it("retirer le paramètre en cours de modification ferme la modification ; un autre la laisse ouverte", async () => {
    await ouvrir(serveur({ ...BASE, [retirer("region")]: retraitParametre, [retirer("catalogue")]: retraitParametre }));
    await userEvent.click(screen.getByRole("button", { name: "Modifier la déclaration de lignes_max" }));
    await userEvent.click(screen.getByRole("button", { name: "Retirer le paramètre region" }));
    await userEvent.click(within(ligne("region")).getByRole("button", { name: "Retirer" }));
    await screen.findByText("Paramètre region retiré, avec ses valeurs.");
    expect(screen.getByRole("form", { name: "Modifier la déclaration de lignes_max" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Modifier la déclaration de catalogue" }));
    await userEvent.click(screen.getByRole("button", { name: "Retirer le paramètre catalogue" }));
    await userEvent.click(within(ligne("catalogue")).getByRole("button", { name: "Retirer" }));
    await screen.findByText("Paramètre catalogue retiré, avec ses valeurs.");
    expect(screen.getByRole("form", { name: "Déclarer un paramètre" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /^Modifier la déclaration/ })).not.toBeInTheDocument();
  });

  it("un retrait refusé garde la modification ouverte et dit pourquoi", async () => {
    await ouvrir(serveur({ ...BASE, [retirer("region")]: parametreInconnu }));
    await userEvent.click(screen.getByRole("button", { name: "Modifier la déclaration de region" }));
    await userEvent.click(screen.getByRole("button", { name: "Retirer le paramètre region" }));
    await userEvent.click(within(ligne("region")).getByRole("button", { name: "Retirer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ce paramètre n'existe plus : la liste a été relue.");
    expect(screen.getByRole("form", { name: "Modifier la déclaration de region" })).toBeInTheDocument();
  });

  it("retrait en mode local : la raison du serveur est rendue", async () => {
    await ouvrir(serveur({ ...BASE, [retirer("region")]: { status: 409, body: { error: { code: "local_mode" } } } }));
    await userEvent.click(screen.getByRole("button", { name: "Retirer le paramètre region" }));
    await userEvent.click(within(ligne("region")).getByRole("button", { name: "Retirer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("En mode local, l'espace implicite ne se gère pas.");
  });
});

describe("Paramètres : poser une valeur", () => {
  it("le formulaire propose le premier paramètre, la cible de la coque, et seulement les environnements autorisés", async () => {
    await ouvrir(serveur(BASE), "TEST");
    expect(options(choixParametre())).toEqual([["catalogue", "catalogue"], ["lignes_max", "lignes_max"], ["region", "region"]]);
    expect(choixParametre()).toHaveValue("catalogue");
    expect(options(choixEnv())).toEqual([["DEV", "DEV"], ["TEST", "TEST"]]);
    expect(choixEnv()).toHaveValue("TEST");
    expect(saisieValeur()).toHaveValue("");
    expect(within(formValeur()).getByText("Identifiant")).toHaveClass("sb-field__hint");
    expect(boutonPoser()).toBeDisabled();
  });

  it("une cible où rien ne se pose (PROD) propose le premier environnement autorisé", async () => {
    await ouvrir(serveur(BASE), "PROD");
    expect(choixEnv()).toHaveValue("DEV");
  });

  it("l'environnement proposé suit la cible de la coque", async () => {
    const fetcher = serveur(BASE);
    const { rerender } = await ouvrir(fetcher, "DEV");
    expect(choixEnv()).toHaveValue("DEV");
    rerender(<ParametersPage space={FINANCE} fetcher={fetcher} target="TEST" />);
    expect(choixEnv()).toHaveValue("TEST");
    rerender(<ParametersPage space={FINANCE} fetcher={fetcher} target="PROD" />);
    expect(choixEnv()).toHaveValue("DEV");
    await userEvent.selectOptions(choixEnv(), "TEST");
    rerender(<ParametersPage space={FINANCE} fetcher={fetcher} target="PROD" />);
    // Même cible : le choix fait reste.
    expect(choixEnv()).toHaveValue("TEST");
    rerender(<ParametersPage space={FINANCE} fetcher={fetcher} target="DEV" />);
    expect(choixEnv()).toHaveValue("DEV");
  });

  it("contrôle adapté au type : texte libre pour un identifiant, chiffres pour un entier, liste pour un choix", async () => {
    await ouvrir(serveur(BASE));
    expect(saisieValeur()).not.toHaveAttribute("inputmode");
    expect(saisieValeur()).toHaveAttribute("spellcheck", "false");
    expect(saisieValeur()).toHaveAttribute("autocomplete", "off");
    await userEvent.selectOptions(choixParametre(), "lignes_max");
    expect(saisieValeur()).toHaveAttribute("inputmode", "numeric");
    expect(within(formValeur()).getByText("Entier · de 1 à 100000")).toBeInTheDocument();
    await userEvent.selectOptions(choixParametre(), "region");
    expect(within(formValeur()).queryByRole("textbox")).not.toBeInTheDocument();
    expect(options(choixValeur())).toEqual([["", "Choisir…"], ["eu-west", "eu-west"], ["eu-central", "eu-central"]]);
    expect(choixValeur()).toHaveValue("");
    expect(boutonPoser()).toBeDisabled();
  });

  it("un booléen se choisit « vrai » ou « faux » et part en booléen", async () => {
    const fetcher = serveur({
      ...BASE,
      [PARAMETRES]: servi(unSeul({ type: "boolean", constraints: {}, required: true, default: null })),
      [poser("p", "DEV")]: { status: 200, body: { ...valeur.body, name: "p", value: false } },
    });
    await ouvrir(fetcher);
    expect(options(choixValeur())).toEqual([["", "Choisir…"], ["true", "vrai"], ["false", "faux"]]);
    await userEvent.selectOptions(choixValeur(), "false");
    await userEvent.click(boutonPoser());
    expect(await screen.findByText("p en DEV : faux.")).toBeInTheDocument();
    expect(corpsEnvoye(fetcher, poser("p", "DEV"))).toStrictEqual({ value: false });
    await userEvent.selectOptions(choixValeur(), "true");
    await userEvent.click(boutonPoser());
    await screen.findByText("p en DEV : vrai.");
    expect(corpsEnvoye(fetcher, poser("p", "DEV"), 1)).toStrictEqual({ value: true });
  });

  it("un texte part tel quel, espaces compris", async () => {
    const fetcher = serveur({ ...BASE, [PARAMETRES]: servi(unSeul({ type: "text", constraints: { max_length: 64 }, required: false, default: null })), [poser("p", "TEST")]: valeur });
    await ouvrir(fetcher, "TEST");
    expect(within(formValeur()).getByText("Texte · 64 caractères au plus")).toBeInTheDocument();
    await userEvent.type(saisieValeur(), "  Bonjour, monde ");
    await userEvent.click(boutonPoser());
    await waitFor(() => { expect(bandeau()?.textContent).toBe("p en TEST :   Bonjour, monde ."); });
    expect(corpsEnvoye(fetcher, poser("p", "TEST"))).toStrictEqual({ value: "  Bonjour, monde " });
  });

  it("pose un identifiant dans l'environnement choisi : PUT `{value}`, réponse annoncée, saisie vidée, grille relue", async () => {
    const onWritten = vi.fn();
    const fetcher = serveur({ ...BASE, [poser("catalogue", "TEST")]: { status: 200, body: { ...valeur.body, environment: "TEST", value: "finance_test" } } });
    await ouvrir(fetcher, "DEV", onWritten);
    await userEvent.selectOptions(choixEnv(), "TEST");
    await userEvent.type(saisieValeur(), "finance_test");
    expect(boutonPoser()).toBeEnabled();
    await userEvent.click(boutonPoser());
    expect(await screen.findByText("catalogue en TEST : finance_test.")).toBeInTheDocument();
    expect(bandeau()).toHaveFocus();
    expect(ecritures(fetcher)).toEqual(["PUT /api/spaces/finance/parameters/catalogue/values/TEST"]);
    expect(corpsEnvoye(fetcher, poser("catalogue", "TEST"))).toStrictEqual({ value: "finance_test" });
    expect(saisieValeur()).toHaveValue("");
    expect(choixEnv()).toHaveValue("TEST");
    expect(choixParametre()).toHaveValue("catalogue");
    await waitFor(() => { expect(appels(fetcher, PARAMETRES)).toHaveLength(2); });
    expect(onWritten).toHaveBeenCalledTimes(1);
  });

  it("Entrée dans le champ envoie la valeur", async () => {
    const fetcher = serveur({ ...BASE, [poser("catalogue", "DEV")]: valeur });
    await ouvrir(fetcher);
    await userEvent.type(saisieValeur(), "finance_dev{Enter}");
    await screen.findByText("catalogue en DEV : finance_dev.");
    expect(ecritures(fetcher)).toEqual(["PUT /api/spaces/finance/parameters/catalogue/values/DEV"]);
  });

  it.each([
    ["12", 12],
    ["-3", -3],
    ["0", 0],
    ["9007199254740991", 9007199254740991],
    // Mal écrit ou trop grand : envoyé tel quel en texte, jamais arrondi ni corrigé.
    ["1.5", "1.5"],
    ["1e3", "1e3"],
    ["12 ", "12 "],
    ["9007199254740993", "9007199254740993"],
    ["douze", "douze"],
  ] as const)("entier saisi « %s » : envoyé %j", async (saisie, envoye) => {
    const fetcher = serveur({ ...BASE, [poser("lignes_max", "DEV")]: valeurInvalide });
    await ouvrir(fetcher);
    await userEvent.selectOptions(choixParametre(), "lignes_max");
    await userEvent.type(saisieValeur(), saisie);
    await userEvent.click(boutonPoser());
    await screen.findByRole("alert");
    expect(corpsEnvoye(fetcher, poser("lignes_max", "DEV"))).toStrictEqual({ value: envoye });
  });

  it("refusé : raison et champ rendus, saisie gardée pour la corriger", async () => {
    const fetcher = serveur({ ...BASE, [poser("lignes_max", "TEST")]: valeurInvalide });
    await ouvrir(fetcher, "TEST");
    await userEvent.selectOptions(choixParametre(), "lignes_max");
    await userEvent.type(saisieValeur(), "100001");
    await userEvent.click(boutonPoser());
    expect(await screen.findByRole("alert")).toHaveTextContent("La demande est incomplète ou mal formée. Champ en cause : valeur.");
    expect(bandeau()).toHaveFocus();
    expect(saisieValeur()).toHaveValue("100001");
    expect(choixParametre()).toHaveValue("lignes_max");
    expect(choixEnv()).toHaveValue("TEST");
  });

  it("une panne garde aussi la saisie et dit que rien n'est confirmé", async () => {
    await ouvrir(serveur({ ...BASE, [poser("catalogue", "DEV")]: () => Promise.reject(new TypeError("réseau")) }));
    await userEvent.type(saisieValeur(), "x");
    await userEvent.click(boutonPoser());
    expect(await screen.findByRole("alert")).toHaveTextContent("Changement non confirmé : Le serveur Board ne répond pas. La liste a été relue.");
    expect(saisieValeur()).toHaveValue("x");
  });

  it("changer de paramètre vide la saisie ; changer d'environnement la garde", async () => {
    await ouvrir(serveur(BASE));
    await userEvent.type(saisieValeur(), "abc");
    await userEvent.selectOptions(choixEnv(), "TEST");
    expect(saisieValeur()).toHaveValue("abc");
    await userEvent.selectOptions(choixParametre(), "lignes_max");
    expect(saisieValeur()).toHaveValue("");
  });

  it("« Changer » dans la grille préremplit paramètre, environnement et valeur propre, et donne le focus au contrôle", async () => {
    await ouvrir(serveur(BASE));
    await userEvent.click(within(cellule("lignes_max", "TEST")).getByRole("button", { name: "Changer la valeur de lignes_max en TEST" }));
    expect(choixParametre()).toHaveValue("lignes_max");
    expect(choixEnv()).toHaveValue("TEST");
    expect(saisieValeur()).toHaveValue("20000");
    expect(saisieValeur()).toHaveFocus();
    // « Poser » sur une valeur par défaut laisse la saisie vide : recopié, le défaut deviendrait une valeur propre.
    await userEvent.click(within(cellule("lignes_max", "DEV")).getByRole("button", { name: "Poser la valeur de lignes_max en DEV" }));
    expect(choixEnv()).toHaveValue("DEV");
    expect(saisieValeur()).toHaveValue("");
    expect(saisieValeur()).toHaveFocus();
    expect(boutonPoser()).toBeDisabled();
    // Un manquant laisse vide aussi.
    await userEvent.click(within(cellule("region", "TEST")).getByRole("button", { name: "Poser la valeur de region en TEST" }));
    expect(choixParametre()).toHaveValue("region");
    expect(choixValeur()).toHaveValue("");
    expect(choixValeur()).toHaveFocus();
  });

  it("choisir deux fois la même cellule reprend la valeur du serveur, même après une saisie", async () => {
    await ouvrir(serveur(BASE));
    const bouton = () => within(cellule("catalogue", "DEV")).getByRole("button", { name: "Changer la valeur de catalogue en DEV" });
    await userEvent.click(bouton());
    expect(saisieValeur()).toHaveValue("finance_dev");
    await userEvent.clear(saisieValeur());
    await userEvent.type(saisieValeur(), "autre");
    await userEvent.click(bouton());
    expect(saisieValeur()).toHaveValue("finance_dev");
    expect(saisieValeur()).toHaveFocus();
  });

  it("un booléen choisi depuis la grille préremplit « vrai » ou « faux »", async () => {
    await ouvrir(serveur({ ...BASE, [PARAMETRES]: servi(unSeul({ type: "boolean", constraints: {}, required: true, default: null }, [propre(false), propre(true), {}])) }));
    await userEvent.click(within(cellule("p", "TEST")).getByRole("button", { name: "Changer la valeur de p en TEST" }));
    expect(choixValeur()).toHaveValue("true");
    expect(within(choixValeur()).getByRole("option", { name: "vrai" })).toHaveProperty("selected", true);
    await userEvent.click(within(cellule("p", "DEV")).getByRole("button", { name: "Changer la valeur de p en DEV" }));
    expect(choixValeur()).toHaveValue("false");
  });

  it("depuis la grille puis envoyé : la valeur part dans l'environnement de la cellule", async () => {
    const fetcher = serveur({ ...BASE, [poser("region", "TEST")]: { status: 200, body: { ...valeur.body, name: "region", environment: "TEST", value: "eu-west" } } });
    await ouvrir(fetcher, "DEV");
    await userEvent.click(within(cellule("region", "TEST")).getByRole("button", { name: "Poser la valeur de region en TEST" }));
    await userEvent.selectOptions(choixValeur(), "eu-west");
    await userEvent.click(boutonPoser());
    await screen.findByText("region en TEST : eu-west.");
    expect(corpsEnvoye(fetcher, poser("region", "TEST"))).toStrictEqual({ value: "eu-west" });
  });

  it("le paramètre choisi retiré entre-temps : le formulaire revient au premier", async () => {
    let retire = false;
    const relue = () => {
      const corps = copie();
      if (retire) { corps.parameters.pop(); for (const environment of corps.environments) environment.values.pop(); }
      return Promise.resolve(Response.json(coherent(corps)));
    };
    await ouvrir(serveur({ ...BASE, [PARAMETRES]: relue, [retirer("region")]: () => { retire = true; return Promise.resolve(reponse(retraitParametre)); } }));
    await userEvent.selectOptions(choixParametre(), "region");
    await userEvent.click(screen.getByRole("button", { name: "Retirer le paramètre region" }));
    await userEvent.click(within(ligne("region")).getByRole("button", { name: "Retirer" }));
    await waitFor(() => { expect(lignes()).toEqual(["catalogue", "lignes_max"]); });
    expect(choixParametre()).toHaveValue("catalogue");
    expect(options(choixParametre()).map(([nom]) => nom)).toEqual(["catalogue", "lignes_max"]);
    expect(saisieValeur()).toBeInTheDocument();
  });

  it("l'environnement choisi n'est plus autorisé à la relecture : le premier autorisé est proposé", async () => {
    let ferme = false;
    const relue = () => {
      const corps = copie();
      if (ferme) (corps.environments[1] as Brut).can_set = false;
      return Promise.resolve(Response.json(corps));
    };
    await ouvrir(serveur({ ...BASE, [PARAMETRES]: relue, [poser("catalogue", "TEST")]: () => { ferme = true; return Promise.resolve(reponse({ status: 200, body: { ...valeur.body, environment: "TEST" } })); } }), "TEST");
    await userEvent.type(saisieValeur(), "x");
    await userEvent.click(boutonPoser());
    await waitFor(() => { expect(options(choixEnv())).toEqual([["DEV", "DEV"]]); });
    expect(choixEnv()).toHaveValue("DEV");
    expect(within(cellule("catalogue", "TEST")).queryByRole("button")).not.toBeInTheDocument();
  });

  it("le premier paramètre déclaré dans un espace vide devient proposable", async () => {
    let declare = false;
    const relue = () => Promise.resolve(Response.json(declare ? unSeul({ type: "identifier", constraints: {}, required: true, default: null, name: "catalogue" }) : aucun()));
    await ouvrir(serveur({ ...BASE, [PARAMETRES]: relue, [DECLARER]: () => { declare = true; return Promise.resolve(reponse(parametre)); } }));
    await userEvent.type(champ(/^Nom/), "catalogue");
    await userEvent.click(within(formDeclaration()).getByRole("button", { name: "Déclarer le paramètre" }));
    await screen.findByText("Paramètre catalogue déclaré.");
    await waitFor(() => { expect(choixParametre()).toHaveValue("catalogue"); });
  });
});

describe("Paramètres : déclarer un paramètre", () => {
  it("formulaire de création : nom, type (texte par défaut), longueur maximale, défaut, obligatoire, description ; envoi impossible sans nom", async () => {
    await ouvrir(serveur(BASE));
    const formulaire = screen.getByRole("form", { name: "Déclarer un paramètre" });
    expect(screen.getByRole("region", { name: "Déclarer un paramètre" })).toContainElement(formulaire);
    expect(type()).toHaveValue("text");
    expect(options(type())).toEqual([["text", "Texte"], ["integer", "Entier"], ["boolean", "Booléen"], ["choice", "Choix"], ["identifier", "Identifiant"]]);
    expect(champ(/^Nom/)).toHaveValue("");
    expect(within(formulaire).getByText("Minuscules, chiffres et _, en commençant par une lettre ; il ne change plus ensuite.")).toBeInTheDocument();
    expect(champ(/^Longueur maximale/)).toHaveAttribute("inputmode", "numeric");
    expect(within(formulaire).getByText("De 1 à 1024 caractères.")).toBeInTheDocument();
    expect(champ(/^Valeur par défaut/)).toHaveValue("");
    expect(within(formulaire).getByRole("checkbox", { name: /^Obligatoire/ })).not.toBeChecked();
    expect(champ(/^Description/)).toHaveValue("");
    expect(within(formulaire).getByRole("button", { name: "Déclarer le paramètre" })).toBeDisabled();
    expect(within(formulaire).queryByRole("button", { name: "Annuler" })).not.toBeInTheDocument();
    await userEvent.type(champ(/^Nom/), "x");
    expect(within(formulaire).getByRole("button", { name: "Déclarer le paramètre" })).toBeEnabled();
  });

  it("contraintes selon le type : longueur pour un texte, bornes pour un entier, choix une par ligne, rien pour un booléen ou un identifiant", async () => {
    await ouvrir(serveur(BASE));
    const visibles = () => within(formDeclaration()).getAllByRole("textbox").map((boite) => (boite as HTMLInputElement).labels?.[0]?.textContent);
    expect(visibles()).toEqual(["Nom", "Longueur maximale", "Valeur par défaut", "Description (facultative)"]);
    await userEvent.selectOptions(type(), "integer");
    expect(visibles()).toEqual(["Nom", "Minimum (facultatif)", "Maximum (facultatif)", "Valeur par défaut", "Description (facultative)"]);
    expect(champ(/^Minimum/)).toHaveAttribute("inputmode", "numeric");
    expect(champ(/^Maximum/)).toHaveAttribute("inputmode", "numeric");
    expect(champ(/^Valeur par défaut/)).toHaveAttribute("inputmode", "numeric");
    await userEvent.selectOptions(type(), "choice");
    expect(visibles()).toEqual(["Nom", "Valeurs possibles", "Description (facultative)"]);
    expect(within(formDeclaration()).getByText("Une par ligne, de 1 à 50.")).toBeInTheDocument();
    expect(options(within(formDeclaration()).getByRole("combobox", { name: /^Valeur par défaut/ }))).toEqual([["", "Aucune"]]);
    await userEvent.selectOptions(type(), "boolean");
    expect(visibles()).toEqual(["Nom", "Description (facultative)"]);
    expect(options(within(formDeclaration()).getByRole("combobox", { name: /^Valeur par défaut/ }))).toEqual([["", "Aucune"], ["true", "vrai"], ["false", "faux"]]);
    await userEvent.selectOptions(type(), "identifier");
    expect(visibles()).toEqual(["Nom", "Valeur par défaut", "Description (facultative)"]);
    expect(within(formDeclaration()).getByText("Format fixe : une lettre ou _, puis lettres, chiffres ou _, 128 caractères au plus.")).toBeInTheDocument();
    expect(champ(/^Valeur par défaut/)).not.toHaveAttribute("inputmode");
  });

  it("déclare un texte : POST du nom et des cinq champs, longueur en nombre, défaut en texte ; saisie vidée", async () => {
    const onWritten = vi.fn();
    const fetcher = serveur({ ...BASE, [DECLARER]: parametre });
    await ouvrir(fetcher, "DEV", onWritten);
    await userEvent.type(champ(/^Nom/), "message");
    await userEvent.type(champ(/^Longueur maximale/), "64");
    await userEvent.type(champ(/^Valeur par défaut/), " Bonjour ");
    await userEvent.click(within(formDeclaration()).getByRole("checkbox", { name: /^Obligatoire/ }));
    await userEvent.type(champ(/^Description/), "Accueil");
    await userEvent.click(within(formDeclaration()).getByRole("button", { name: "Déclarer le paramètre" }));
    expect(await screen.findByText("Paramètre message déclaré.")).toBeInTheDocument();
    expect(bandeau()).toHaveFocus();
    expect(ecritures(fetcher)).toEqual(["POST /api/spaces/finance/parameters"]);
    expect(corpsEnvoye(fetcher, DECLARER)).toStrictEqual({ name: "message", type: "text", constraints: { max_length: 64 }, required: true, default: " Bonjour ", description: "Accueil" });
    expect(champ(/^Nom/)).toHaveValue("");
    expect(champ(/^Longueur maximale/)).toHaveValue("");
    expect(type()).toHaveValue("text");
    expect(within(formDeclaration()).getByRole("checkbox", { name: /^Obligatoire/ })).not.toBeChecked();
    expect(onWritten).toHaveBeenCalledTimes(1);
    await waitFor(() => { expect(appels(fetcher, PARAMETRES)).toHaveLength(2); });
  });

  it("déclare un entier : bornes et défaut en nombres, borne vide en null", async () => {
    const fetcher = serveur({ ...BASE, [DECLARER]: parametre });
    await ouvrir(fetcher);
    await userEvent.type(champ(/^Nom/), "lignes");
    await userEvent.selectOptions(type(), "integer");
    await userEvent.type(champ(/^Minimum/), "-10");
    await userEvent.type(champ(/^Valeur par défaut/), "42");
    await userEvent.click(within(formDeclaration()).getByRole("button", { name: "Déclarer le paramètre" }));
    await screen.findByText("Paramètre lignes déclaré.");
    expect(corpsEnvoye(fetcher, DECLARER)).toStrictEqual({ name: "lignes", type: "integer", constraints: { minimum: -10, maximum: null }, required: false, default: 42, description: "" });
  });

  it("un entier mal écrit ou trop grand part tel quel en texte ; le refus nomme le champ, la saisie reste", async () => {
    const fetcher = serveur({ ...BASE, [DECLARER]: { status: 400, body: { error: { code: "invalid_request", field: "constraints.maximum" } } } });
    await ouvrir(fetcher);
    await userEvent.type(champ(/^Nom/), "lignes");
    await userEvent.selectOptions(type(), "integer");
    await userEvent.type(champ(/^Minimum/), "1.5");
    await userEvent.type(champ(/^Maximum/), "99999999999999999999");
    await userEvent.type(champ(/^Valeur par défaut/), "9007199254740993");
    await userEvent.click(within(formDeclaration()).getByRole("button", { name: "Déclarer le paramètre" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("La demande est incomplète ou mal formée. Champ en cause : maximum.");
    expect(corpsEnvoye(fetcher, DECLARER)).toStrictEqual({
      name: "lignes",
      type: "integer",
      constraints: { minimum: "1.5", maximum: "99999999999999999999" },
      required: false,
      default: "9007199254740993",
      description: "",
    });
    expect(champ(/^Nom/)).toHaveValue("lignes");
    expect(champ(/^Minimum/)).toHaveValue("1.5");
    expect(champ(/^Maximum/)).toHaveValue("99999999999999999999");
  });

  it("une longueur maximale vide ou mal écrite part telle quelle en texte", async () => {
    const fetcher = serveur({ ...BASE, [DECLARER]: { status: 400, body: { error: { code: "invalid_request", field: "constraints.max_length" } } } });
    await ouvrir(fetcher);
    await userEvent.type(champ(/^Nom/), "t");
    await userEvent.click(within(formDeclaration()).getByRole("button", { name: "Déclarer le paramètre" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Champ en cause : longueur maximale.");
    expect(corpsEnvoye(fetcher, DECLARER)).toStrictEqual({ name: "t", type: "text", constraints: { max_length: "" }, required: false, default: null, description: "" });
    await userEvent.type(champ(/^Longueur maximale/), "64 car");
    await userEvent.click(within(formDeclaration()).getByRole("button", { name: "Déclarer le paramètre" }));
    await waitFor(() => { expect(appels(fetcher, DECLARER)).toHaveLength(2); });
    expect(corpsEnvoye(fetcher, DECLARER, 1)).toMatchObject({ constraints: { max_length: "64 car" } });
  });

  it("déclare un choix : une valeur par ligne, lignes vides ignorées, sans retouche ; le défaut se choisit parmi elles", async () => {
    const fetcher = serveur({ ...BASE, [DECLARER]: parametre });
    await ouvrir(fetcher);
    await userEvent.type(champ(/^Nom/), "region");
    await userEvent.selectOptions(type(), "choice");
    const valeurs = within(formDeclaration()).getByRole("textbox", { name: /^Valeurs possibles/ });
    expect(valeurs.tagName).toBe("TEXTAREA");
    await userEvent.type(valeurs, "eu-west{Enter}{Enter} eu-central {Enter}");
    const defaut = within(formDeclaration()).getByRole("combobox", { name: /^Valeur par défaut/ });
    expect(options(defaut)).toEqual([["", "Aucune"], ["eu-west", "eu-west"], [" eu-central ", " eu-central "]]);
    await userEvent.selectOptions(defaut, " eu-central ");
    await userEvent.click(within(formDeclaration()).getByRole("button", { name: "Déclarer le paramètre" }));
    await screen.findByText("Paramètre region déclaré.");
    expect(corpsEnvoye(fetcher, DECLARER)).toStrictEqual({ name: "region", type: "choice", constraints: { choices: ["eu-west", " eu-central "] }, required: false, default: " eu-central ", description: "" });
  });

  it("déclare un booléen : défaut « faux » en booléen, sans contrainte", async () => {
    const fetcher = serveur({ ...BASE, [DECLARER]: parametre });
    await ouvrir(fetcher);
    await userEvent.type(champ(/^Nom/), "actif");
    await userEvent.selectOptions(type(), "boolean");
    await userEvent.selectOptions(within(formDeclaration()).getByRole("combobox", { name: /^Valeur par défaut/ }), "false");
    await userEvent.click(within(formDeclaration()).getByRole("button", { name: "Déclarer le paramètre" }));
    await screen.findByText("Paramètre actif déclaré.");
    expect(corpsEnvoye(fetcher, DECLARER)).toStrictEqual({ name: "actif", type: "boolean", constraints: {}, required: false, default: false, description: "" });
  });

  it("déclare un identifiant : sans contrainte, défaut en texte", async () => {
    const fetcher = serveur({ ...BASE, [DECLARER]: parametre });
    await ouvrir(fetcher);
    await userEvent.type(champ(/^Nom/), "catalogue");
    await userEvent.selectOptions(type(), "identifier");
    await userEvent.type(champ(/^Valeur par défaut/), "finance");
    await userEvent.click(within(formDeclaration()).getByRole("button", { name: "Déclarer le paramètre" }));
    await screen.findByText("Paramètre catalogue déclaré.");
    expect(corpsEnvoye(fetcher, DECLARER)).toStrictEqual({ name: "catalogue", type: "identifier", constraints: {}, required: false, default: "finance", description: "" });
  });

  it("changer de type efface le défaut saisi, qui pourrait ne plus convenir", async () => {
    await ouvrir(serveur(BASE));
    await userEvent.type(champ(/^Valeur par défaut/), "abc");
    await userEvent.selectOptions(type(), "integer");
    expect(champ(/^Valeur par défaut/)).toHaveValue("");
  });

  it.each([
    ["nom déjà pris", parametreExistant, "Un paramètre porte déjà ce nom dans l'espace."],
    ["limite atteinte", { status: 409, body: { error: { code: "parameter_limit" } } }, "L'espace a déjà 100 paramètres, le maximum."],
    ["nom invalide", { status: 400, body: { error: { code: "invalid_request", field: "name" } } }, "La demande est incomplète ou mal formée. Champ en cause : nom."],
    ["défaut hors contraintes", { status: 400, body: { error: { code: "invalid_request", field: "default" } } }, "La demande est incomplète ou mal formée. Champ en cause : valeur par défaut."],
    ["description trop longue", { status: 400, body: { error: { code: "invalid_request", field: "description" } } }, "La demande est incomplète ou mal formée. Champ en cause : description."],
    ["choix invalides", { status: 400, body: { error: { code: "invalid_request", field: "constraints.choices" } } }, "La demande est incomplète ou mal formée. Champ en cause : valeurs possibles."],
  ] as [string, Exemple, string][])("refus de la déclaration (%s) : raison rendue, saisie gardée", async (_cas, exemple, message) => {
    await ouvrir(serveur({ ...BASE, [DECLARER]: exemple }));
    await userEvent.type(champ(/^Nom/), "catalogue");
    await userEvent.type(champ(/^Description/), "texte");
    await userEvent.click(within(formDeclaration()).getByRole("button", { name: "Déclarer le paramètre" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(champ(/^Nom/)).toHaveValue("catalogue");
    expect(champ(/^Description/)).toHaveValue("texte");
  });
});

describe("Paramètres : modifier une déclaration", () => {
  it("préremplit depuis le serveur, sans champ de nom, focus sur le type ; Annuler revient à la création", async () => {
    const fetcher = serveur(BASE);
    await ouvrir(fetcher);
    await userEvent.click(screen.getByRole("button", { name: "Modifier la déclaration de lignes_max" }));
    const formulaire = screen.getByRole("form", { name: "Modifier la déclaration de lignes_max" });
    expect(screen.getByRole("region", { name: "Modifier la déclaration de lignes_max" })).toContainElement(formulaire);
    expect(within(formulaire).queryByRole("textbox", { name: /^Nom/ })).not.toBeInTheDocument();
    expect(type()).toHaveValue("integer");
    expect(type()).toHaveFocus();
    expect(champ(/^Minimum/)).toHaveValue("1");
    expect(champ(/^Maximum/)).toHaveValue("100000");
    expect(champ(/^Valeur par défaut/)).toHaveValue("5000");
    expect(within(formulaire).getByRole("checkbox", { name: /^Obligatoire/ })).not.toBeChecked();
    expect(champ(/^Description/)).toHaveValue("");
    expect(within(formulaire).getByRole("button", { name: "Enregistrer la déclaration" })).toBeEnabled();
    await userEvent.click(within(formulaire).getByRole("button", { name: "Annuler" }));
    expect(screen.getByRole("form", { name: "Déclarer un paramètre" })).toBeInTheDocument();
    expect(champ(/^Nom/)).toHaveValue("");
    expect(type()).toHaveValue("text");
    expect(ecritures(fetcher)).toEqual([]);
  });

  it("préremplit un choix (une valeur par ligne) et un identifiant obligatoire décrit", async () => {
    await ouvrir(serveur(BASE));
    await userEvent.click(screen.getByRole("button", { name: "Modifier la déclaration de region" }));
    expect(type()).toHaveValue("choice");
    expect(within(formDeclaration()).getByRole("textbox", { name: /^Valeurs possibles/ })).toHaveValue("eu-west\neu-central");
    expect(within(formDeclaration()).getByRole("combobox", { name: /^Valeur par défaut/ })).toHaveValue("");
    expect(within(formDeclaration()).getByRole("checkbox", { name: /^Obligatoire/ })).toBeChecked();
    expect(champ(/^Description/)).toHaveValue("Région de calcul");
    await userEvent.click(screen.getByRole("button", { name: "Modifier la déclaration de catalogue" }));
    expect(screen.getByRole("form", { name: "Modifier la déclaration de catalogue" })).toBeInTheDocument();
    expect(type()).toHaveValue("identifier");
    expect(champ(/^Valeur par défaut/)).toHaveValue("");
    expect(champ(/^Description/)).toHaveValue("Catalogue des tables publiées");
  });

  it("préremplit un texte et un booléen", async () => {
    const corps = unSeul({ type: "text", constraints: { max_length: 32 }, required: false, default: "x", name: "t" });
    const b = unSeul({ type: "boolean", constraints: {}, required: false, default: false, name: "b" });
    corps.parameters.push(b.parameters[0] as Brut);
    corps.environments.forEach((environment, rang) => { environment.values.push((b.environments[rang] as Corps["environments"][number]).values[0] as Brut); });
    await ouvrir(serveur({ ...BASE, [PARAMETRES]: servi(coherent(corps)) }));
    await userEvent.click(screen.getByRole("button", { name: "Modifier la déclaration de t" }));
    expect(champ(/^Longueur maximale/)).toHaveValue("32");
    expect(champ(/^Valeur par défaut/)).toHaveValue("x");
    await userEvent.click(screen.getByRole("button", { name: "Modifier la déclaration de b" }));
    expect(within(formDeclaration()).getByRole("combobox", { name: /^Valeur par défaut/ })).toHaveValue("false");
    expect(within(formDeclaration()).getByRole("option", { name: "faux" })).toHaveProperty("selected", true);
  });

  it("un entier sans bornes se préremplit vide", async () => {
    await ouvrir(serveur({ ...BASE, [PARAMETRES]: servi(unSeul({ type: "integer", constraints: { minimum: null, maximum: null }, required: false, default: null })) }));
    await userEvent.click(screen.getByRole("button", { name: "Modifier la déclaration de p" }));
    expect(champ(/^Minimum/)).toHaveValue("");
    expect(champ(/^Maximum/)).toHaveValue("");
    expect(champ(/^Valeur par défaut/)).toHaveValue("");
  });

  it("enregistre : PUT au nom, sans le nom dans le corps ; la modification se ferme", async () => {
    const fetcher = serveur({ ...BASE, [modifier("region")]: parametreModifie });
    await ouvrir(fetcher);
    await userEvent.click(screen.getByRole("button", { name: "Modifier la déclaration de region" }));
    await userEvent.selectOptions(within(formDeclaration()).getByRole("combobox", { name: /^Valeur par défaut/ }), "eu-west");
    await userEvent.click(within(formDeclaration()).getByRole("button", { name: "Enregistrer la déclaration" }));
    expect(await screen.findByText("Déclaration de region enregistrée.")).toBeInTheDocument();
    expect(ecritures(fetcher)).toEqual(["PUT /api/spaces/finance/parameters/region"]);
    expect(corpsEnvoye(fetcher, modifier("region"))).toStrictEqual({
      type: "choice",
      constraints: { choices: ["eu-west", "eu-central"] },
      required: true,
      default: "eu-west",
      description: "Région de calcul",
    });
    expect(screen.getByRole("form", { name: "Déclarer un paramètre" })).toBeInTheDocument();
    expect(champ(/^Nom/)).toHaveValue("");
  });

  it("un entier modifié sans changement repart avec ses bornes en nombres", async () => {
    const fetcher = serveur({ ...BASE, [modifier("lignes_max")]: { status: 200, body: { ...parametreModifie.body } } });
    await ouvrir(fetcher);
    await userEvent.click(screen.getByRole("button", { name: "Modifier la déclaration de lignes_max" }));
    await userEvent.click(within(formDeclaration()).getByRole("button", { name: "Enregistrer la déclaration" }));
    await screen.findByText("Déclaration de lignes_max enregistrée.");
    expect(corpsEnvoye(fetcher, modifier("lignes_max"))).toStrictEqual({ type: "integer", constraints: { minimum: 1, maximum: 100000 }, required: false, default: 5000, description: "" });
  });

  it("valeurs incompatibles : le refus nomme les environnements en cause ; la modification reste ouverte, saisie comprise", async () => {
    const fetcher = serveur({ ...BASE, [modifier("lignes_max")]: valeursIncompatibles });
    await ouvrir(fetcher);
    await userEvent.click(screen.getByRole("button", { name: "Modifier la déclaration de lignes_max" }));
    await userEvent.clear(champ(/^Maximum/));
    await userEvent.type(champ(/^Maximum/), "10000");
    await userEvent.click(within(formDeclaration()).getByRole("button", { name: "Enregistrer la déclaration" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Des valeurs déjà posées ne respecteraient plus cette déclaration : videz-les d'abord. Environnements en cause : TEST.",
    );
    expect(bandeau()).toHaveFocus();
    expect(screen.getByRole("form", { name: "Modifier la déclaration de lignes_max" })).toBeInTheDocument();
    expect(champ(/^Maximum/)).toHaveValue("10000");
    expect(corpsEnvoye(fetcher, modifier("lignes_max"))).toMatchObject({ constraints: { minimum: 1, maximum: 10000 } });
  });

  it("valeurs incompatibles dans plusieurs environnements : nommés dans l'ordre de promotion, inconnus ignorés", async () => {
    await ouvrir(serveur({ ...BASE, [modifier("lignes_max")]: { status: 409, body: { error: { code: "values_incompatible", environments: ["PROD", "QA", "DEV"] } } } }));
    await userEvent.click(screen.getByRole("button", { name: "Modifier la déclaration de lignes_max" }));
    await userEvent.click(within(formDeclaration()).getByRole("button", { name: "Enregistrer la déclaration" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Environnements en cause : DEV, PROD\.$/);
  });

  it("un paramètre disparu entre-temps : la raison est rendue, la modification reste ouverte", async () => {
    await ouvrir(serveur({ ...BASE, [modifier("region")]: parametreInconnu }));
    await userEvent.click(screen.getByRole("button", { name: "Modifier la déclaration de region" }));
    await userEvent.click(within(formDeclaration()).getByRole("button", { name: "Enregistrer la déclaration" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ce paramètre n'existe plus : la liste a été relue.");
    expect(screen.getByRole("form", { name: "Modifier la déclaration de region" })).toBeInTheDocument();
  });

  it("ouvrir une modification efface le bandeau précédent", async () => {
    await ouvrir(serveur({ ...BASE, [poser("catalogue", "DEV")]: valeurInvalide }));
    await userEvent.type(saisieValeur(), "x");
    await userEvent.click(boutonPoser());
    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: "Modifier la déclaration de region" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(boutonPoser());
    await screen.findByRole("alert");
    await userEvent.click(within(cellule("region", "DEV")).getByRole("button", { name: "Poser la valeur de region en DEV" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(within(cellule("region", "DEV")).getByRole("button", { name: "Poser la valeur de region en DEV" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Paramètres : règles du design system", () => {
  // RULES §2.2 : « Un seul bouton principal (cuivre) par vue » ; c'est « Poser la valeur ».
  it("un seul bouton principal dans la vue, au repos comme en modification : « Poser la valeur »", async () => {
    await ouvrir(serveur(BASE));
    const principaux = () => [...document.querySelectorAll(".sb-button--primary")].map((bouton) => bouton.textContent);
    expect(principaux()).toEqual(["Poser la valeur"]);
    const declarer = within(formDeclaration()).getByRole("button", { name: "Déclarer le paramètre" });
    expect(declarer.className).toBe("sb-button");
    await userEvent.click(screen.getByRole("button", { name: "Modifier la déclaration de region" }));
    expect(principaux()).toEqual(["Poser la valeur"]);
    expect(within(formDeclaration()).getByRole("button", { name: "Enregistrer la déclaration" }).className).toBe("sb-button");
  });

  it("sans environnement ouvert, aucun bouton principal", async () => {
    const corps = copie();
    for (const environment of corps.environments) environment.can_set = false;
    await ouvrir(serveur({ ...BASE, [PARAMETRES]: servi(corps) }));
    expect(document.querySelectorAll(".sb-button--primary")).toHaveLength(0);
  });
});

describe("Paramètres : ligne en cours de modification", () => {
  it("la ligne dont la déclaration est modifiée est surlignée, elle seule ; Annuler l'éteint", async () => {
    await ouvrir(serveur(BASE));
    const surlignees = () => lignes().filter((nom) => ligne(nom as string).classList.contains("sb-row--selected"));
    expect(surlignees()).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Modifier la déclaration de lignes_max" }));
    expect(surlignees()).toEqual(["lignes_max"]);
    await userEvent.click(screen.getByRole("button", { name: "Modifier la déclaration de region" }));
    expect(surlignees()).toEqual(["region"]);
    await userEvent.click(within(formDeclaration()).getByRole("button", { name: "Annuler" }));
    expect(surlignees()).toEqual([]);
  });

  it("enregistrée, la modification se ferme et la ligne n'est plus surlignée", async () => {
    await ouvrir(serveur({ ...BASE, [modifier("region")]: parametreModifie }));
    await userEvent.click(screen.getByRole("button", { name: "Modifier la déclaration de region" }));
    expect(ligne("region")).toHaveClass("sb-row--selected");
    await userEvent.click(within(formDeclaration()).getByRole("button", { name: "Enregistrer la déclaration" }));
    await screen.findByText("Déclaration de region enregistrée.");
    await waitFor(() => { expect(ligne("region")).not.toHaveClass("sb-row--selected"); });
  });

  it("un retrait confirmé d'une autre ligne garde la ligne modifiée surlignée", async () => {
    await ouvrir(serveur(BASE));
    await userEvent.click(screen.getByRole("button", { name: "Modifier la déclaration de lignes_max" }));
    await userEvent.click(screen.getByRole("button", { name: "Retirer le paramètre region" }));
    expect(ligne("lignes_max")).toHaveClass("sb-row--selected");
    expect(ligne("region")).toHaveClass("sb-row--selected");
    await userEvent.click(within(ligne("region")).getByRole("button", { name: "Annuler" }));
    expect(ligne("region")).not.toHaveClass("sb-row--selected");
    expect(ligne("lignes_max")).toHaveClass("sb-row--selected");
  });
});

describe("Paramètres : champs étiquetés, aides en description", () => {
  it("formulaire de valeur : noms réduits à l'étiquette, les contraintes en description", async () => {
    await ouvrir(serveur(BASE));
    expect(choixParametre()).toHaveAccessibleName("Paramètre");
    expect(choixEnv()).toHaveAccessibleName("Environnement");
    expect(within(formValeur()).getByRole("textbox", { name: "Valeur" })).toHaveAccessibleDescription("Identifiant");
    await userEvent.selectOptions(choixParametre(), "lignes_max");
    expect(within(formValeur()).getByRole("textbox", { name: "Valeur" })).toHaveAccessibleDescription("Entier · de 1 à 100000");
    await userEvent.selectOptions(choixParametre(), "region");
    expect(within(formValeur()).getByRole("combobox", { name: "Valeur" })).toHaveAccessibleDescription("Choix · eu-west, eu-central");
    // Paramètre et environnement n'ont pas d'aide.
    expect(choixParametre()).not.toHaveAttribute("aria-describedby");
    expect(choixEnv()).not.toHaveAttribute("aria-describedby");
  });

  it("formulaire de déclaration : chaque champ nommé par son étiquette, son aide en description", async () => {
    await ouvrir(serveur(BASE));
    const formulaire = formDeclaration();
    expect(within(formulaire).getByRole("textbox", { name: "Nom" })).toHaveAccessibleDescription("Minuscules, chiffres et _, en commençant par une lettre ; il ne change plus ensuite.");
    expect(within(formulaire).getByRole("combobox", { name: "Type" })).not.toHaveAttribute("aria-describedby");
    expect(within(formulaire).getByRole("textbox", { name: "Longueur maximale" })).toHaveAccessibleDescription("De 1 à 1024 caractères.");
    expect(within(formulaire).getByRole("textbox", { name: "Valeur par défaut" })).toHaveAccessibleDescription("Vide : aucune valeur par défaut.");
    expect(within(formulaire).getByRole("textbox", { name: "Description (facultative)" })).toHaveAccessibleDescription("200 caractères au plus.");
    await userEvent.selectOptions(type(), "integer");
    expect(within(formulaire).getByRole("textbox", { name: "Minimum (facultatif)" })).toBeInTheDocument();
    expect(within(formulaire).getByRole("textbox", { name: "Maximum (facultatif)" })).toBeInTheDocument();
    await userEvent.selectOptions(type(), "choice");
    expect(within(formulaire).getByRole("textbox", { name: "Valeurs possibles" })).toHaveAccessibleDescription("Une par ligne, de 1 à 50.");
    expect(within(formulaire).getByRole("combobox", { name: "Valeur par défaut" })).toHaveAccessibleDescription("Vide : aucune valeur par défaut.");
  });

  it("chaque étiquette désigne son contrôle, et chaque aide a son identifiant propre", async () => {
    await ouvrir(serveur(BASE));
    const controles = [...document.querySelectorAll<HTMLElement>("form input:not([type=checkbox]), form select, form textarea")];
    for (const controle of controles) expect(document.querySelector(`label[for="${controle.id}"]`), controle.outerHTML).not.toBeNull();
    const aides = [...document.querySelectorAll("span.sb-field__hint[id]")].map((aide) => aide.id);
    expect(new Set(aides).size).toBe(aides.length);
  });
});

describe("Paramètres : choix en double", () => {
  it("deux lignes identiques restent deux options, sans clé React en double, et partent telles quelles au serveur qui juge", async () => {
    const erreurs = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = serveur({ ...BASE, [DECLARER]: { status: 400, body: { error: { code: "invalid_request", field: "constraints.choices" } } } });
    await ouvrir(fetcher);
    await userEvent.type(champ(/^Nom/), "region2");
    await userEvent.selectOptions(type(), "choice");
    await userEvent.type(within(formDeclaration()).getByRole("textbox", { name: "Valeurs possibles" }), "a{Enter}a");
    expect(options(within(formDeclaration()).getByRole("combobox", { name: "Valeur par défaut" }))).toEqual([["", "Aucune"], ["a", "a"], ["a", "a"]]);
    await userEvent.click(within(formDeclaration()).getByRole("button", { name: "Déclarer le paramètre" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Champ en cause : valeurs possibles.");
    expect(corpsEnvoye(fetcher, DECLARER)).toMatchObject({ constraints: { choices: ["a", "a"] } });
    expect(erreurs.mock.calls.filter((appel) => String(appel[0]).includes("same key"))).toEqual([]);
    erreurs.mockRestore();
  });
});

describe("Paramètres : refus faute de droit de déployer", () => {
  it.each(["DEV", "TEST"] as const)("poser en %s sans le droit : le refus nomme le droit et l'environnement, la saisie reste", async (code) => {
    await ouvrir(serveur({ ...BASE, [poser("catalogue", code)]: { status: 403, body: { error: { code: "forbidden", required: "deploy", environment: code } } } }), code);
    await userEvent.type(saisieValeur(), "x");
    await userEvent.click(boutonPoser());
    expect(await screen.findByRole("alert")).toHaveTextContent(`Cette action demande le droit de déployer en ${code}.`);
    expect(saisieValeur()).toHaveValue("x");
  });

  it("vider sans le droit (exemple réel, PROD) : la raison est rendue", async () => {
    const corps = copie();
    (corps.environments[2] as Brut).can_set = true;
    await ouvrir(serveur({ ...BASE, [PARAMETRES]: servi(corps), [vider("lignes_max", "TEST")]: valeurInterdite }));
    await userEvent.click(within(cellule("lignes_max", "TEST")).getByRole("button", { name: /^Vider/ }));
    await userEvent.click(within(cellule("lignes_max", "TEST")).getByRole("button", { name: "Vider" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/^Cette action demande le droit de déployer en PROD\.$/);
  });

  it("un refus « interdit » sans environnement garde le libellé du rôle", async () => {
    await ouvrir(serveur({ ...BASE, [poser("catalogue", "DEV")]: interdit }));
    await userEvent.type(saisieValeur(), "x");
    await userEvent.click(boutonPoser());
    expect(await screen.findByRole("alert")).toHaveTextContent(/^Votre rôle ne permet pas cette action\.$/);
  });
});
