import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import espace from "../../../contracts/espaces/espace.json" with { type: "json" };
import interdit from "../../../contracts/espaces/interdit.json" with { type: "json" };
import journalEspace from "../../../contracts/espaces/journal.json" with { type: "json" };
import journalParametres from "../../../contracts/espaces/journal-parametres.json" with { type: "json" };
import liste from "../../../contracts/espaces/liste.json" with { type: "json" };
import administration from "../../../contracts/espaces/liste-administration.json" with { type: "json" };
import locale from "../../../contracts/espaces/liste-locale.json" with { type: "json" };
import membres from "../../../contracts/espaces/membres.json" with { type: "json" };
import parametres from "../../../contracts/espaces/parametres.json" with { type: "json" };
import etabli from "../../../contracts/identite/me-etabli.json" with { type: "json" };
import { catalogueHorsEspace, enregistrerLectures, simulerEspaces, simulerIdentite, type Exemple } from "./aides";

// Écran « Paramètres » d'un espace (plan 10, 10.3). Les deux projets de playwright.config.ts
// exécutent ces parcours : ordinateur (1280 px) et téléphone (390 px, émulation d'appareil).

type Code = "DEV" | "TEST" | "PROD";
type Valeur = string | number | boolean;
type Connue = { name: string | null; email: string | null };
type Ref = { issuer: string; subject: string };
interface Declaration {
  name: string;
  type: string;
  constraints: Record<string, unknown>;
  required: boolean;
  default: Valeur | null;
  description: string;
  created_at: string;
  created_by: Ref;
  created_by_person: Connue | null;
  updated_at: string;
  updated_by: Ref;
  updated_by_person: Connue | null;
}
interface Posee {
  value: Valeur;
  set_at: string;
  set_by: Ref;
  set_by_person: Connue | null;
}
type Saisie = Omit<Declaration, "name" | "created_at" | "created_by" | "created_by_person" | "updated_at" | "updated_by" | "updated_by_person"> & { name?: string };

const CODES: readonly Code[] = ["DEV", "TEST", "PROD"];
const INSTANT = "2026-11-02T12:30:00+00:00";
const MOI = { issuer: etabli.body.identity.issuer, subject: etabli.body.identity.subject };
const MOI_NOMME = { name: etabli.body.identity.name, email: etabli.body.identity.email };
const RAPPEL = "Un paramètre n'est jamais un secret, et changer une valeur demande le droit de déployer dans l'environnement.";
const TYPES = ["text", "integer", "boolean", "choice", "identifier"];

/** Serveur Board simulé pour les paramètres : résolution (P4), compatibilité (P5), droits (P6), refus (P8). */
class Serveur {
  parametres: Declaration[] = structuredClone(parametres.body.parameters);
  readonly valeurs: Record<Code, Map<string, Posee>> = { DEV: new Map(), TEST: new Map(), PROD: new Map() };
  readonly canSet: Record<Code, boolean> = { DEV: true, TEST: true, PROD: false };
  readonly journal: unknown[] = structuredClone(journalParametres.body.events);
  readonly ecritures: { methode: string; chemin: string; corps: unknown }[] = [];
  private evenement = 100;

  constructor() {
    for (const environment of parametres.body.environments) {
      for (const resolue of environment.values) {
        if (resolue.state === "value") this.valeurs[environment.code as Code].set(resolue.name, resolue as Posee);
      }
    }
  }

  configuration() {
    return {
      parameters: this.parametres,
      environments: CODES.map((code) => {
        const values = this.parametres.map((parametre) => {
          const propre = this.valeurs[code].get(parametre.name);
          if (propre !== undefined) return { name: parametre.name, state: "value", ...propre };
          const vide = { set_at: null, set_by: null, set_by_person: null };
          if (parametre.default !== null) return { name: parametre.name, state: "default", value: parametre.default, ...vide };
          return { name: parametre.name, state: parametre.required ? "missing" : "absent", value: null, ...vide };
        });
        const missing = values.filter((resolue) => resolue.state === "missing").map((resolue) => resolue.name);
        return { code, can_set: this.canSet[code], complete: missing.length === 0, missing, values };
      }),
    };
  }

  private noter(action: string, detail: unknown): void {
    this.journal.unshift({ id: this.evenement++, at: INSTANT, actor: MOI, actor_person: MOI_NOMME, action, detail, principal_person: null });
  }

  /** Une valeur respecte-t-elle le type et les contraintes ? */
  private valide(declaration: Pick<Declaration, "type" | "constraints">, valeur: unknown): boolean {
    const c = declaration.constraints;
    switch (declaration.type) {
      case "text":
        return typeof valeur === "string" && valeur.length >= 1 && Array.from(valeur).length <= (c.max_length as number);
      case "integer":
        return Number.isSafeInteger(valeur) && (c.minimum === null || (valeur as number) >= (c.minimum as number)) && (c.maximum === null || (valeur as number) <= (c.maximum as number));
      case "boolean":
        return typeof valeur === "boolean";
      case "choice":
        return (c.choices as unknown[]).includes(valeur);
      default:
        return typeof valeur === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(valeur);
    }
  }

  /** Champ en cause d'une déclaration invalide, ou `null`. */
  private champInvalide(saisie: Saisie): string | null {
    if (!TYPES.includes(saisie.type)) return "type";
    const c = saisie.constraints;
    if (saisie.type === "text" && !(Number.isSafeInteger(c.max_length) && (c.max_length as number) >= 1 && (c.max_length as number) <= 1024)) return "constraints.max_length";
    if (saisie.type === "integer") {
      if (!(c.minimum === null || Number.isSafeInteger(c.minimum))) return "constraints.minimum";
      if (!(c.maximum === null || Number.isSafeInteger(c.maximum))) return "constraints.maximum";
    }
    if (saisie.type === "choice" && !(Array.isArray(c.choices) && c.choices.length >= 1 && c.choices.every((choix) => typeof choix === "string" && choix.length >= 1))) return "constraints.choices";
    if (typeof saisie.required !== "boolean") return "required";
    if (saisie.default !== null && !this.valide(saisie, saisie.default)) return "default";
    if (typeof saisie.description !== "string" || saisie.description.length > 200) return "description";
    return null;
  }

  declarer(saisie: Saisie): Exemple {
    if (typeof saisie.name !== "string" || !/^[a-z][a-z0-9_]{0,62}$/.test(saisie.name)) return { status: 400, body: { error: { code: "invalid_request", field: "name" } } };
    const champ = this.champInvalide(saisie);
    if (champ !== null) return { status: 400, body: { error: { code: "invalid_request", field: champ } } };
    if (this.parametres.some((parametre) => parametre.name === saisie.name)) return { status: 409, body: { error: { code: "parameter_exists" } } };
    const declaration: Declaration = { ...saisie, name: saisie.name, created_at: INSTANT, created_by: MOI, created_by_person: MOI_NOMME, updated_at: INSTANT, updated_by: MOI, updated_by_person: MOI_NOMME };
    this.parametres.push(declaration);
    this.parametres.sort((a, b) => a.name.localeCompare(b.name));
    this.noter("parameter_declared", { name: saisie.name });
    return { status: 201, body: declaration };
  }

  modifier(nom: string, saisie: Saisie): Exemple {
    const existant = this.parametres.find((parametre) => parametre.name === nom);
    if (existant === undefined) return { status: 404, body: { error: { code: "parameter_not_found" } } };
    if ("name" in saisie) return { status: 400, body: { error: { code: "invalid_request", field: "body" } } };
    const champ = this.champInvalide(saisie);
    if (champ !== null) return { status: 400, body: { error: { code: "invalid_request", field: champ } } };
    const enCause = CODES.filter((code) => { const propre = this.valeurs[code].get(nom); return propre !== undefined && !this.valide(saisie, propre.value); });
    if (enCause.length > 0) return { status: 409, body: { error: { code: "values_incompatible", environments: enCause } } };
    Object.assign(existant, saisie, { updated_at: INSTANT, updated_by: MOI, updated_by_person: MOI_NOMME });
    this.noter("parameter_changed", { name: nom });
    return { status: 200, body: existant };
  }

  retirer(nom: string): Exemple {
    if (!this.parametres.some((parametre) => parametre.name === nom)) return { status: 404, body: { error: { code: "parameter_not_found" } } };
    this.parametres = this.parametres.filter((parametre) => parametre.name !== nom);
    for (const code of CODES) this.valeurs[code].delete(nom);
    this.noter("parameter_removed", { name: nom });
    return { status: 204, body: null };
  }

  poser(nom: string, code: Code, corps: { value?: unknown }): Exemple {
    if (!this.canSet[code]) return { status: 403, body: { error: { code: "forbidden", required: "deploy", environment: code } } };
    const declaration = this.parametres.find((parametre) => parametre.name === nom);
    if (declaration === undefined) return { status: 404, body: { error: { code: "parameter_not_found" } } };
    if (!this.valide(declaration, corps.value)) return { status: 400, body: { error: { code: "invalid_request", field: "value" } } };
    const posee: Posee = { value: corps.value as Valeur, set_at: INSTANT, set_by: MOI, set_by_person: MOI_NOMME };
    this.valeurs[code].set(nom, posee);
    this.noter("value_set", { name: nom, environment: code, after: corps.value });
    return { status: 200, body: { name: nom, environment: code, ...posee } };
  }

  vider(nom: string, code: Code): Exemple {
    if (!this.canSet[code]) return { status: 403, body: { error: { code: "forbidden", required: "deploy", environment: code } } };
    if (!this.parametres.some((parametre) => parametre.name === nom)) return { status: 404, body: { error: { code: "parameter_not_found" } } };
    if (this.valeurs[code].delete(nom)) this.noter("value_cleared", { name: nom, environment: code });
    return { status: 204, body: null };
  }
}

async function repondre(route: Route, exemple: Exemple): Promise<void> {
  if (exemple.body === null) await route.fulfill({ status: exemple.status });
  else await route.fulfill({ status: exemple.status, json: exemple.body });
}

/** Branche le serveur simulé : liste et espace (exemples réels), paramètres, journal, membres. */
async function simuler(page: Page, serveur: Serveur, table: Readonly<Record<string, Exemple>> = {}): Promise<void> {
  await simulerEspaces(page, { "/api/spaces": administration, "/api/spaces/finance": espace, ...table });
  await page.route((url) => /^\/api\/spaces\/finance\/(parameters(\/[^/]+(\/values\/[^/]+)?)?|events|members|deploy-grants)$/.test(url.pathname), async (route) => {
    const requete = route.request();
    const chemin = new URL(requete.url()).pathname;
    const methode = requete.method();
    const refus = table[`${methode} ${chemin}`];
    if (refus !== undefined) { await repondre(route, refus); return; }
    if (methode === "GET") {
      if (chemin.endsWith("/events")) await repondre(route, { status: 200, body: { events: serveur.journal } });
      else if (chemin.endsWith("/members")) await repondre(route, membres);
      else if (chemin.endsWith("/deploy-grants")) await repondre(route, { status: 200, body: { grants: [] } });
      else await repondre(route, { status: 200, body: serveur.configuration() });
      return;
    }
    const corps = requete.postData() === null ? null : (requete.postDataJSON() as unknown);
    serveur.ecritures.push({ methode, chemin, corps });
    const [, nom, , code] = /^\/api\/spaces\/finance\/parameters(?:\/([^/]+)(\/values\/([^/]+))?)?$/.exec(chemin) ?? [];
    const decode = nom === undefined ? undefined : decodeURIComponent(nom);
    if (decode === undefined) await repondre(route, serveur.declarer(corps as Saisie));
    else if (code !== undefined) await repondre(route, methode === "PUT" ? serveur.poser(decode, code as Code, corps as { value?: unknown }) : serveur.vider(decode, code as Code));
    else await repondre(route, methode === "PUT" ? serveur.modifier(decode, corps as Saisie) : serveur.retirer(decode));
  });
}

let lectures: string[] = [];
test.beforeEach(async ({ page }) => {
  await simulerIdentite(page, etabli);
  lectures = enregistrerLectures(page);
  await page.clock.setFixedTime(new Date("2026-11-02T12:30:00Z"));
});
test.afterEach(() => {
  expect(catalogueHorsEspace(lectures)).toEqual([]);
});

async function polices(page: Page) {
  await page.evaluate(async () => { await document.fonts.ready; });
}
async function ouvrirEcran(page: Page, serveur = new Serveur(), table: Readonly<Record<string, Exemple>> = {}) {
  await simuler(page, serveur, table);
  await page.goto("/#/espaces/finance/parametres");
  await expect(page.getByRole("heading", { level: 1, name: "Paramètres" })).toBeVisible();
  await expect(grille(page)).toBeVisible();
  await expect(page.getByRole("list", { name: "Journal de l'espace" })).toBeVisible();
  await polices(page);
  return serveur;
}
const grille = (page: Page) => page.getByRole("table", { name: "Paramètres et valeurs par environnement" });
const conteneur = (page: Page) => page.getByRole("group", { name: "Paramètres et valeurs par environnement" });
const ligne = (page: Page, nom: string) => grille(page).getByRole("row").filter({ has: page.getByRole("rowheader").locator(".sb-mono", { hasText: new RegExp(`^${nom}$`) }) });
const COLONNES = { DEV: 4, TEST: 5, PROD: 6 } as const;
const cellule = (page: Page, nom: string, code: Code) => ligne(page, nom).locator(":scope > *").nth(COLONNES[code]);
const enteteEnv = (page: Page, code: Code) => grille(page).getByRole("columnheader").nth(COLONNES[code]);
const formValeur = (page: Page) => page.getByRole("form", { name: "Poser une valeur" });
const formDeclaration = (page: Page) => page.getByRole("form", { name: /^(Déclarer un paramètre|Modifier la déclaration de)/ });
const bandeau = (page: Page) => page.locator(".sb-members__feedback");
const journalEntrees = (page: Page) => page.getByRole("list", { name: "Journal de l'espace" }).getByRole("listitem");
const bascule = (page: Page) => page.getByRole("banner").getByRole("group", { name: "Environnement" });
const debordement = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("l'écran montre la grille dans l'ordre DEV | TEST | PROD, la complétude, la cible, le rappel et le journal", async ({ page }) => {
  await ouvrirEcran(page);
  await expect(page.getByText(RAPPEL)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Fil d'Ariane" }).getByRole("listitem")).toHaveText(["Finance", "Paramètres"]);
  await expect(page.getByRole("navigation", { name: "Navigation principale" }).getByRole("button", { name: "Espace & connexions" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Administration de l'espace" }).getByRole("link", { name: "Paramètres" })).toHaveAttribute("aria-current", "page");
  await expect(grille(page).getByRole("columnheader")).toHaveText(["Paramètre", "Type et contraintes", "Obligatoire", "Défaut", "DEVenvironnement affichéincomplet · 1 manquant", "TESTincomplet · 2 manquants", "PRODincomplet · 2 manquants", "Actions"]);
  await expect(grille(page).getByRole("rowheader").locator(".sb-mono")).toHaveText(["catalogue", "lignes_max", "region"]);
  await expect(cellule(page, "catalogue", "DEV")).toContainText("finance_devvaleur propreAlix · 02/11/2026 10:40 UTC");
  await expect(cellule(page, "lignes_max", "TEST")).toContainText("20000valeur propre");
  await expect(cellule(page, "lignes_max", "PROD")).toHaveText("5000par défaut");
  await expect(cellule(page, "region", "PROD")).toHaveText("—manquant");
  // Valeurs et environnements en IBM Plex Mono.
  await expect(cellule(page, "catalogue", "DEV").getByText("finance_dev", { exact: true })).toHaveCSS("font-family", /IBM Plex Mono/);
  await expect(enteteEnv(page, "DEV").locator(".sb-mono")).toHaveCSS("font-family", /IBM Plex Mono/);
  // La colonne de la cible (DEV) sur fond cuivre clair, les autres non.
  await expect(enteteEnv(page, "DEV")).toHaveCSS("background-color", "rgb(251, 241, 233)");
  await expect(enteteEnv(page, "TEST")).not.toHaveCSS("background-color", "rgb(251, 241, 233)");
  await expect(cellule(page, "region", "DEV")).toHaveCSS("background-color", "rgb(251, 241, 233)");
  await expect(journalEntrees(page)).toHaveCount(journalParametres.body.events.length);
});

test("la bascule de la coque déplace la colonne repérée sans relire", async ({ page }) => {
  await ouvrirEcran(page);
  const avant = lectures.length;
  await bascule(page).getByRole("button", { name: "TEST", exact: true }).click();
  await expect(enteteEnv(page, "TEST")).toHaveCSS("background-color", "rgb(251, 241, 233)");
  await expect(enteteEnv(page, "DEV")).not.toHaveCSS("background-color", "rgb(251, 241, 233)");
  await expect(formValeur(page).getByRole("combobox", { name: "Environnement" })).toHaveValue("TEST");
  await page.waitForTimeout(200);
  expect(lectures.slice(avant)).toEqual([]);
});

test("boutons de valeur seulement là où le serveur l'autorise ; « Vider » seulement pour une valeur propre", async ({ page }) => {
  await ouvrirEcran(page);
  for (const nom of ["catalogue", "lignes_max", "region"]) await expect(cellule(page, nom, "PROD").getByRole("button")).toHaveCount(0);
  await expect(cellule(page, "catalogue", "DEV").getByRole("button")).toHaveText(["Changer", "Vider"]);
  await expect(cellule(page, "lignes_max", "DEV").getByRole("button")).toHaveText(["Poser"]);
  await expect(cellule(page, "region", "TEST").getByRole("button")).toHaveText(["Poser"]);
  // Un seul bouton principal dans la vue (RULES §2.2).
  await expect(page.locator(".sb-button--primary")).toHaveText(["Poser la valeur"]);
  await expect(formValeur(page).getByRole("combobox", { name: "Environnement" }).getByRole("option")).toHaveText(["DEV", "TEST"]);
});

test("déclare un entier : la grille l'ajoute avec son défaut, le journal le raconte", async ({ page }) => {
  const serveur = await ouvrirEcran(page);
  const formulaire = formDeclaration(page);
  await formulaire.getByRole("textbox", { name: /^Nom/ }).fill("plafond");
  await formulaire.getByRole("combobox", { name: "Type" }).selectOption("integer");
  await formulaire.getByRole("textbox", { name: /^Minimum/ }).fill("1");
  await formulaire.getByRole("textbox", { name: /^Maximum/ }).fill("10");
  await formulaire.getByRole("textbox", { name: /^Valeur par défaut/ }).fill("5");
  await formulaire.getByRole("checkbox", { name: /^Obligatoire/ }).check();
  await formulaire.getByRole("button", { name: "Déclarer le paramètre" }).click();
  await expect(bandeau(page)).toHaveText("Paramètre plafond déclaré.");
  await expect(bandeau(page)).toBeFocused();
  expect(serveur.ecritures).toEqual([{ methode: "POST", chemin: "/api/spaces/finance/parameters", corps: { name: "plafond", type: "integer", constraints: { minimum: 1, maximum: 10 }, required: true, default: 5, description: "" } }]);
  await expect(ligne(page, "plafond").locator(":scope > *").nth(1)).toHaveText("Entier · de 1 à 10");
  for (const code of CODES) await expect(cellule(page, "plafond", code)).toContainText("5par défaut");
  await expect(formulaire.getByRole("textbox", { name: /^Nom/ })).toHaveValue("");
  await expect(journalEntrees(page).nth(0)).toContainText("parameter_declared");
});

test("pose une valeur depuis la grille : focalisée, vide sur un défaut, préremplie sur une valeur propre, envoyée en nombre", async ({ page }) => {
  const serveur = await ouvrirEcran(page);
  await cellule(page, "lignes_max", "TEST").getByRole("button", { name: "Changer la valeur de lignes_max en TEST" }).click();
  const saisie = formValeur(page).getByRole("textbox", { name: "Valeur" });
  await expect(saisie).toBeFocused();
  await expect(saisie).toHaveValue("20000");
  await expect(saisie).toHaveAccessibleDescription("Entier · de 1 à 100000");
  await cellule(page, "lignes_max", "DEV").getByRole("button", { name: "Poser la valeur de lignes_max en DEV" }).click();
  await expect(saisie).toBeFocused();
  await expect(saisie).toHaveValue("");
  await expect(formValeur(page).getByRole("combobox", { name: "Paramètre" })).toHaveValue("lignes_max");
  await expect(formValeur(page).getByRole("combobox", { name: "Environnement" })).toHaveValue("DEV");
  await saisie.fill("300");
  await saisie.press("Enter");
  await expect(bandeau(page)).toHaveText("lignes_max en DEV : 300.");
  expect(serveur.ecritures).toEqual([{ methode: "PUT", chemin: "/api/spaces/finance/parameters/lignes_max/values/DEV", corps: { value: 300 } }]);
  await expect(cellule(page, "lignes_max", "DEV")).toContainText("300valeur propreCamille Martin");
  await expect(cellule(page, "lignes_max", "DEV").getByRole("button")).toHaveText(["Changer", "Vider"]);
  await expect(saisie).toHaveValue("");
});

test("pose une valeur de choix dans une liste ; l'environnement devient complet quand rien n'y manque", async ({ page }) => {
  await ouvrirEcran(page);
  const formulaire = formValeur(page);
  await formulaire.getByRole("combobox", { name: "Paramètre" }).selectOption("region");
  await formulaire.getByRole("combobox", { name: /^Valeur/ }).selectOption("eu-central");
  await formulaire.getByRole("button", { name: "Poser la valeur" }).click();
  await expect(bandeau(page)).toHaveText("region en DEV : eu-central.");
  await expect(enteteEnv(page, "DEV")).toHaveText("DEVenvironnement affichécomplet");
  await expect(cellule(page, "region", "DEV")).toContainText("eu-centralvaleur propre");
});

test("vide une valeur au clavier après confirmation ; Annuler rend le focus", async ({ page }) => {
  const serveur = await ouvrirEcran(page);
  const vider = cellule(page, "catalogue", "DEV").getByRole("button", { name: "Vider la valeur de catalogue en DEV" });
  await vider.focus();
  await page.keyboard.press("Enter");
  const confirmation = cellule(page, "catalogue", "DEV").getByRole("group", { name: "Vider la valeur de catalogue en DEV ?" });
  await expect(confirmation.getByRole("button", { name: "Vider", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(vider).toBeFocused();
  expect(serveur.ecritures).toEqual([]);
  await page.keyboard.press("Enter");
  await expect(confirmation.getByRole("button", { name: "Vider", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(bandeau(page)).toHaveText("Valeur de catalogue en DEV vidée.");
  await expect(bandeau(page)).toBeFocused();
  await expect(cellule(page, "catalogue", "DEV")).toHaveText("—manquantPoser");
  await expect(enteteEnv(page, "DEV")).toHaveText("DEVenvironnement affichéincomplet · 2 manquants");
  expect(serveur.ecritures).toEqual([{ methode: "DELETE", chemin: "/api/spaces/finance/parameters/catalogue/values/DEV", corps: null }]);
});

test("retire un paramètre après confirmation, avec ses valeurs", async ({ page }) => {
  const serveur = await ouvrirEcran(page);
  await ligne(page, "lignes_max").getByRole("button", { name: "Retirer le paramètre lignes_max" }).click();
  const confirmation = ligne(page, "lignes_max").getByRole("group", { name: "Retirer le paramètre lignes_max et ses valeurs ?" });
  await expect(confirmation.getByRole("button", { name: "Retirer", exact: true })).toBeFocused();
  await confirmation.getByRole("button", { name: "Retirer", exact: true }).click();
  await expect(bandeau(page)).toHaveText("Paramètre lignes_max retiré, avec ses valeurs.");
  await expect(grille(page).getByRole("rowheader").locator(".sb-mono")).toHaveText(["catalogue", "region"]);
  expect(serveur.ecritures).toEqual([{ methode: "DELETE", chemin: "/api/spaces/finance/parameters/lignes_max", corps: null }]);
  expect(serveur.valeurs.TEST.has("lignes_max")).toBe(false);
  await expect(formValeur(page).getByRole("combobox", { name: "Paramètre" }).getByRole("option")).toHaveText(["catalogue", "region"]);
});

test("modifie une déclaration préremplie ; le nom ne part pas dans le corps", async ({ page }) => {
  const serveur = await ouvrirEcran(page);
  await ligne(page, "region").getByRole("button", { name: "Modifier la déclaration de region" }).click();
  const formulaire = page.getByRole("form", { name: "Modifier la déclaration de region" });
  await expect(formulaire.getByRole("combobox", { name: "Type" })).toBeFocused();
  // La ligne modifiée est surlignée, elle seule.
  await expect(ligne(page, "region")).toHaveClass(/sb-row--selected/);
  await expect(grille(page).locator("tr.sb-row--selected")).toHaveCount(1);
  await expect(formulaire.getByRole("textbox", { name: "Valeurs possibles" })).toHaveValue("eu-west\neu-central");
  await expect(formulaire.getByRole("textbox", { name: "Valeurs possibles" })).toHaveAccessibleDescription("Une par ligne, de 1 à 50.");
  await formulaire.getByRole("combobox", { name: /^Valeur par défaut/ }).selectOption("eu-west");
  await formulaire.getByRole("button", { name: "Enregistrer la déclaration" }).click();
  await expect(bandeau(page)).toHaveText("Déclaration de region enregistrée.");
  expect(serveur.ecritures).toEqual([
    { methode: "PUT", chemin: "/api/spaces/finance/parameters/region", corps: { type: "choice", constraints: { choices: ["eu-west", "eu-central"] }, required: true, default: "eu-west", description: "Région de calcul" } },
  ]);
  await expect(cellule(page, "region", "PROD")).toHaveText("eu-westpar défaut");
  await expect(enteteEnv(page, "DEV")).toHaveText("DEVenvironnement affichécomplet");
  await expect(page.getByRole("form", { name: "Déclarer un paramètre" })).toBeVisible();
  await expect(grille(page).locator("tr.sb-row--selected")).toHaveCount(0);
});

test("refus : sans le droit de déployer, la raison nomme le droit et l'environnement", async ({ page }) => {
  const serveur = new Serveur();
  serveur.canSet.PROD = true;
  await ouvrirEcran(page, serveur, { "PUT /api/spaces/finance/parameters/lignes_max/values/PROD": { status: 403, body: { error: { code: "forbidden", required: "deploy", environment: "PROD" } } } });
  await cellule(page, "lignes_max", "PROD").getByRole("button", { name: "Poser la valeur de lignes_max en PROD" }).click();
  await formValeur(page).getByRole("textbox", { name: "Valeur" }).fill("100");
  await formValeur(page).getByRole("button", { name: "Poser la valeur" }).click();
  await expect(page.getByRole("alert")).toHaveText("Cette action demande le droit de déployer en PROD.");
  await expect(formValeur(page).getByRole("textbox", { name: "Valeur" })).toHaveValue("100");
  await expect(cellule(page, "lignes_max", "PROD")).toHaveText("5000par défautPoser");
});

test("refus : une valeur hors contraintes nomme le champ et garde la saisie", async ({ page }) => {
  const serveur = await ouvrirEcran(page);
  await cellule(page, "lignes_max", "TEST").getByRole("button", { name: "Changer la valeur de lignes_max en TEST" }).click();
  const saisie = formValeur(page).getByRole("textbox", { name: /^Valeur/ });
  await saisie.fill("100001");
  await formValeur(page).getByRole("button", { name: "Poser la valeur" }).click();
  await expect(page.getByRole("alert")).toHaveText("La demande est incomplète ou mal formée. Champ en cause : valeur.");
  await expect(saisie).toHaveValue("100001");
  // Un nombre mal écrit part tel quel, en texte : rien n'est arrondi.
  await saisie.fill("12.7");
  await formValeur(page).getByRole("button", { name: "Poser la valeur" }).click();
  await expect(page.getByRole("alert")).toHaveText("La demande est incomplète ou mal formée. Champ en cause : valeur.");
  expect(serveur.ecritures.map((ecriture) => ecriture.corps)).toEqual([{ value: 100001 }, { value: "12.7" }]);
  await expect(cellule(page, "lignes_max", "TEST")).toContainText("20000valeur propre");
});

test("refus : une déclaration qui rendrait invalide une valeur posée nomme l'environnement en cause", async ({ page }) => {
  const serveur = await ouvrirEcran(page);
  await ligne(page, "lignes_max").getByRole("button", { name: "Modifier la déclaration de lignes_max" }).click();
  const formulaire = page.getByRole("form", { name: "Modifier la déclaration de lignes_max" });
  await formulaire.getByRole("textbox", { name: /^Maximum/ }).fill("10000");
  await formulaire.getByRole("button", { name: "Enregistrer la déclaration" }).click();
  await expect(page.getByRole("alert")).toHaveText("Des valeurs déjà posées ne respecteraient plus cette déclaration : videz-les d'abord. Environnements en cause : TEST.");
  await expect(formulaire).toBeVisible();
  await expect(formulaire.getByRole("textbox", { name: /^Maximum/ })).toHaveValue("10000");
  expect(serveur.parametres.find((parametre) => parametre.name === "lignes_max")?.constraints).toEqual({ minimum: 1, maximum: 100000 });
});

test("refus : un nom déjà pris est signalé, la saisie reste", async ({ page }) => {
  await ouvrirEcran(page);
  await formDeclaration(page).getByRole("textbox", { name: /^Nom/ }).fill("region");
  await formDeclaration(page).getByRole("textbox", { name: /^Longueur maximale/ }).fill("8");
  await formDeclaration(page).getByRole("button", { name: "Déclarer le paramètre" }).click();
  await expect(page.getByRole("alert")).toHaveText("Un paramètre porte déjà ce nom dans l'espace.");
  await expect(formDeclaration(page).getByRole("textbox", { name: /^Nom/ })).toHaveValue("region");
});

test("l'accueil offre « Paramètres » à qui gère l'espace", async ({ page }) => {
  await simuler(page, new Serveur());
  await page.goto("/");
  await page.getByRole("link", { name: "Paramètres de Finance" }).click();
  await expect(page).toHaveURL(/#\/espaces\/finance\/parametres$/);
  await expect(grille(page)).toBeVisible();
});

test("accès refusé : un créateur voit le refus du serveur, sans grille ni formulaire", async ({ page }) => {
  const serveur = new Serveur();
  await simuler(page, serveur, {
    "/api/spaces": liste,
    "/api/spaces/finance": { status: 200, body: { ...espace.body, role: "creator" } },
    "GET /api/spaces/finance/parameters": interdit,
    "GET /api/spaces/finance/events": interdit,
  });
  await page.goto("/#/espaces/finance/parametres");
  await expect(page.getByRole("alert")).toHaveText(["Votre rôle ne permet pas cette action.", "Votre rôle ne permet pas cette action."]);
  await expect(grille(page)).toHaveCount(0);
  await expect(page.getByRole("form")).toHaveCount(0);
  await expect(page.getByText(RAPPEL)).toBeVisible();
  expect(serveur.ecritures).toEqual([]);
});

test("mode local : les paramètres ne se gèrent pas, et rien n'est lu", async ({ page }) => {
  await simulerIdentite(page);
  await simulerEspaces(page, { "/api/spaces": locale, "/api/spaces/local": { status: 200, body: locale.body.spaces[0] } });
  await page.goto("/#/espaces/local/parametres");
  await expect(page.getByRole("heading", { level: 1, name: "Paramètres" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "mode local" })).toHaveText("En mode local, sans base d'état, les paramètres de déploiement ne se gèrent pas : aucune configuration n'est gardée.");
  await page.waitForTimeout(200);
  expect(lectures.filter((chemin) => chemin.includes("/parameters") || chemin.includes("/events"))).toEqual([]);
});

/** Une valeur longue sans coupure, et une description longue : la grille doit les contenir. */
function serveurAuxTextesLongs(): Serveur {
  const serveur = new Serveur();
  serveur.parametres.push({
    ...(serveur.parametres[0] as Declaration),
    name: "chemin_de_depot_tres_long_pour_verifier_la_coupure",
    type: "text",
    constraints: { max_length: 1024 },
    required: false,
    default: "s3://bucket-finance-production-europe-ouest/exports/quotidiens/consolides/v2/",
    description: "Chemin du dépôt des exports consolidés de la direction financière, sans coupure possible",
  });
  return serveur;
}

/** Le journal des événements reconnus (membres, rôles) : la grille seule est en jeu. */
function sansEvenementDeParametre(serveur: Serveur): Serveur {
  serveur.journal.splice(0, serveur.journal.length, ...structuredClone(journalEspace.body.events));
  return serveur;
}

for (const largeur of [320, 390, 768, 1280]) {
  for (const etat of ["écran", "confirmation", "modification", "textes longs"] as const) {
    test(`aucun défilement horizontal de page, ${etat} à ${largeur} px ; la grille défile dans son conteneur`, async ({ page }) => {
      await page.setViewportSize({ width: largeur, height: 900 });
      await ouvrirEcran(page, sansEvenementDeParametre(etat === "textes longs" ? serveurAuxTextesLongs() : new Serveur()));
      if (etat === "confirmation") {
        await cellule(page, "lignes_max", "TEST").getByRole("button", { name: /^Vider/ }).click();
        await expect(cellule(page, "lignes_max", "TEST").getByRole("button", { name: "Vider", exact: true })).toBeFocused();
        await expect(cellule(page, "lignes_max", "TEST").getByRole("button", { name: "Vider", exact: true })).toBeInViewport();
      }
      if (etat === "modification") {
        await ligne(page, "region").getByRole("button", { name: "Modifier la déclaration de region" }).click();
        await expect(page.getByRole("form", { name: "Modifier la déclaration de region" })).toBeVisible();
      }
      await expect.poll(() => page.evaluate(() => document.documentElement.clientWidth)).toBe(largeur);
      await expect.poll(() => debordement(page)).toBeLessThanOrEqual(0);
      // Le conteneur de la grille ne sort pas de sa carte ; s'il est trop étroit, c'est lui qui défile.
      const [boite, carte] = [await conteneur(page).boundingBox(), await page.getByRole("region", { name: "Paramètres déclarés" }).boundingBox()];
      expect((boite?.x ?? 0) + (boite?.width ?? 0)).toBeLessThanOrEqual((carte?.x ?? 0) + (carte?.width ?? 0) + 0.5);
      const defile = await conteneur(page).evaluate((element) => ({ contenu: element.scrollWidth, visible: element.clientWidth, style: getComputedStyle(element).overflowX }));
      expect(["auto", "scroll"]).toContain(defile.style);
      if (largeur <= 768) expect(defile.contenu).toBeGreaterThan(defile.visible);
      // Les formulaires tiennent dans la page.
      for (const formulaire of [formValeur(page), formDeclaration(page)]) {
        const cadre = await formulaire.boundingBox();
        expect((cadre?.x ?? 0) + (cadre?.width ?? 0)).toBeLessThanOrEqual(largeur);
      }
    });
  }
}

for (const largeur of [320, 390]) {
  test(`aucun défilement horizontal de page à ${largeur} px avec le journal des paramètres`, async ({ page }) => {
    // Le journal rend encore les événements de paramètres en « action non reconnue : » suivie du
    // détail JSON (libellés prévus en 10.4) ; ces lignes se coupent et ne font pas défiler la page.
    await page.setViewportSize({ width: largeur, height: 900 });
    await ouvrirEcran(page);
    await expect.poll(() => debordement(page)).toBeLessThanOrEqual(0);
  });
}

test("le conteneur de la grille se fait défiler au clavier", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await ouvrirEcran(page);
  await conteneur(page).focus();
  await expect(conteneur(page)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => conteneur(page).evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
});

test("la première colonne reste en place quand la grille défile : on sait toujours de quelle ligne il s'agit", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await ouvrirEcran(page);
  const entete = grille(page).getByRole("rowheader").first();
  const avant = await entete.boundingBox();
  await conteneur(page).evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect.poll(() => conteneur(page).evaluate((element) => element.scrollLeft)).toBeGreaterThan(100);
  const apres = await entete.boundingBox();
  expect(apres?.x).toBeCloseTo(avant?.x ?? -1, 0);
  // Opaque : la colonne qui défile ne transparaît pas sous elle.
  const fond = await entete.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(fond).not.toBe("rgba(0, 0, 0, 0)");
  await expect(entete).toHaveCSS("position", "sticky");
});

test("l'en-tête de la première colonne reste au-dessus d'elle quand la grille défile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await ouvrirEcran(page);
  await conteneur(page).evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect.poll(() => conteneur(page).evaluate((element) => element.scrollLeft)).toBeGreaterThan(100);
  const [titre, nom] = [await grille(page).getByRole("columnheader").first().boundingBox(), await grille(page).getByRole("rowheader").first().boundingBox()];
  expect(titre?.x).toBeCloseTo(nom?.x ?? -1, 0);
});

test("à 1280 px, la grille tient dans sa carte : les actions de chaque ligne se voient sans défiler", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await ouvrirEcran(page);
  const defile = await conteneur(page).evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(defile).toBeLessThanOrEqual(0);
  await expect(ligne(page, "catalogue").getByRole("button", { name: "Retirer le paramètre catalogue" })).toBeInViewport();
});

for (const etat of ["écran", "confirmation", "modification", "refus", "valeur choisie", "accès refusé", "mode local"] as const) {
  test(`axe sur la page entière, contraste compris : ${etat}`, async ({ page }) => {
    if (etat === "accès refusé") {
      await simuler(page, new Serveur(), { "/api/spaces": liste, "/api/spaces/finance": { status: 200, body: { ...espace.body, role: "creator" } }, "GET /api/spaces/finance/parameters": interdit, "GET /api/spaces/finance/events": interdit });
      await page.goto("/#/espaces/finance/parametres");
      await expect(page.getByRole("alert")).toHaveCount(2);
    } else if (etat === "mode local") {
      await simulerIdentite(page);
      await simulerEspaces(page, { "/api/spaces": locale, "/api/spaces/local": { status: 200, body: locale.body.spaces[0] } });
      await page.goto("/#/espaces/local/parametres");
      await expect(page.getByRole("status").filter({ hasText: "mode local" })).toBeVisible();
    } else {
      await ouvrirEcran(page);
      await bascule(page).getByRole("button", { name: "TEST", exact: true }).click();
      if (etat === "confirmation") await cellule(page, "lignes_max", "TEST").getByRole("button", { name: /^Vider/ }).click();
      if (etat === "modification") await ligne(page, "lignes_max").getByRole("button", { name: /^Modifier la déclaration/ }).click();
      if (etat === "valeur choisie") await cellule(page, "region", "TEST").getByRole("button", { name: "Poser la valeur de region en TEST" }).click();
      if (etat === "refus") {
        await ligne(page, "lignes_max").getByRole("button", { name: /^Modifier la déclaration/ }).click();
        await page.getByRole("textbox", { name: /^Maximum/ }).fill("10000");
        await page.getByRole("button", { name: "Enregistrer la déclaration" }).click();
        await expect(page.getByRole("alert")).toContainText("Environnements en cause : TEST.");
      }
    }
    await polices(page);
    const resultat = await new AxeBuilder({ page }).options({ rules: { "color-contrast": { enabled: true } } }).analyze();
    expect(resultat.violations.map((violation) => violation.id), `Règles axe en échec : ${etat}`).toEqual([]);
  });
}

/** TEST choisi dans la coque sur « Environnements », puis l'onglet « Paramètres ». */
async function ouvrirAvecCibleTest(page: Page) {
  await simuler(page, new Serveur());
  await page.goto("/#/espaces/finance/environnements");
  await expect(page.getByRole("list", { name: "Droits de déployer, dans l'ordre de promotion" })).toBeVisible();
  await bascule(page).getByRole("button", { name: "TEST", exact: true }).click();
  await page.getByRole("navigation", { name: "Administration de l'espace" }).getByRole("link", { name: "Paramètres" }).click();
  await expect(grille(page)).toBeVisible();
  await expect(page.getByRole("list", { name: "Journal de l'espace" })).toBeVisible();
  await expect(formValeur(page).getByRole("combobox", { name: "Environnement" })).toHaveValue("TEST");
  await polices(page);
}

test("capture de référence de « Paramètres » : grille, cible TEST", async ({ page }) => {
  await ouvrirAvecCibleTest(page);
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });
  await expect(page).toHaveScreenshot("parametres-grille.png", { fullPage: true });
});

test("capture de référence d'une déclaration en modification, préremplie", async ({ page }) => {
  await ouvrirAvecCibleTest(page);
  await ligne(page, "lignes_max").getByRole("button", { name: "Modifier la déclaration de lignes_max" }).click();
  await expect(page.getByRole("form", { name: "Modifier la déclaration de lignes_max" })).toBeVisible();
  await expect(page).toHaveScreenshot("parametres-formulaire.png", { fullPage: true });
});

test("capture de référence d'un vidage en attente de confirmation", async ({ page }) => {
  await ouvrirAvecCibleTest(page);
  await cellule(page, "lignes_max", "TEST").getByRole("button", { name: /^Vider/ }).click();
  await expect(cellule(page, "lignes_max", "TEST").getByRole("button", { name: "Vider", exact: true })).toBeFocused();
  await expect(page).toHaveScreenshot("parametres-confirmation.png", { fullPage: true });
});

test("capture de référence d'un refus : valeurs incompatibles en TEST", async ({ page }) => {
  await ouvrirAvecCibleTest(page);
  await ligne(page, "lignes_max").getByRole("button", { name: "Modifier la déclaration de lignes_max" }).click();
  await page.getByRole("textbox", { name: /^Maximum/ }).fill("10000");
  await page.getByRole("button", { name: "Enregistrer la déclaration" }).click();
  await expect(page.getByRole("alert")).toContainText("Environnements en cause : TEST.");
  await expect(page).toHaveScreenshot("parametres-refus.png", { fullPage: true });
});
