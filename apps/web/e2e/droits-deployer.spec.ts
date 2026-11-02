import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import accords from "../../../contracts/espaces/accords.json" with { type: "json" };
import espace from "../../../contracts/espaces/espace.json" with { type: "json" };
import interdit from "../../../contracts/espaces/interdit.json" with { type: "json" };
import journalAccords from "../../../contracts/espaces/journal-accords.json" with { type: "json" };
import liste from "../../../contracts/espaces/liste.json" with { type: "json" };
import administration from "../../../contracts/espaces/liste-administration.json" with { type: "json" };
import locale from "../../../contracts/espaces/liste-locale.json" with { type: "json" };
import membres from "../../../contracts/espaces/membres.json" with { type: "json" };
import personnes from "../../../contracts/espaces/personnes.json" with { type: "json" };
import etabli from "../../../contracts/identite/me-etabli.json" with { type: "json" };
import { catalogueHorsEspace, enregistrerLectures, simulerEspaces, simulerIdentite, type Exemple } from "./aides";

// Écran « Environnements » d'un espace (plan 09, 9.4). Les deux projets de playwright.config.ts
// exécutent ces parcours : ordinateur (1280 px) et téléphone (390 px, émulation d'appareil).

type Code = "DEV" | "TEST" | "PROD";
type Principal = { kind: "group"; name: string } | { kind: "person"; issuer: string; subject: string };
type Connue = { name: string | null; email: string | null };
interface Accord {
  id: string;
  environment: Code;
  principal: Principal;
  person: Connue | null;
  created_at: string;
  created_by: { issuer: string; subject: string };
  created_by_person: Connue | null;
}
interface Evenement {
  id: number;
  at: string;
  actor: { issuer: string; subject: string };
  actor_person: Connue | null;
  action: string;
  detail: unknown;
  principal_person: Connue | null;
}

const INSTANT = "2026-11-02T12:30:00+00:00";
const MOI = { issuer: etabli.body.identity.issuer, subject: etabli.body.identity.subject };
const MOI_NOMME = { name: etabli.body.identity.name, email: etabli.body.identity.email };
const DOMINIQUE = personnes.body.people[0] as { issuer: string; subject: string; name: string; email: string; last_login: string };
const ALIX = { issuer: "https://id.example.invalid", subject: "00u7alix", name: "Alix Martin", email: "alix.martin@example.invalid", last_login: "2026-11-02T08:50:00+00:00" };
const CONNUES = [DOMINIQUE, ALIX];
const RAPPEL = "Un droit de déployer n'a d'effet qu'avec le rôle Créateur ou Administrateur dans l'espace, et ne donne aucun droit sur les données.";

/** Serveur Board simulé pour les droits de déployer : accord idempotent, retrait, journal (V5, V6, V9). */
class Serveur {
  accords: Accord[] = structuredClone(accords.body.grants as unknown as Accord[]);
  readonly journal: Evenement[] = structuredClone(journalAccords.body.events as unknown as Evenement[]);
  readonly ecritures: { methode: string; chemin: string; corps: unknown }[] = [];
  private suivant = 1;
  private evenement = 100;

  private connue(principal: Principal) {
    return principal.kind === "person" ? CONNUES.find((p) => p.issuer === principal.issuer && p.subject === principal.subject) : undefined;
  }

  private noter(action: string, environment: Code, principal: Principal): void {
    const visee = this.connue(principal);
    this.journal.unshift({ id: this.evenement++, at: INSTANT, actor: MOI, actor_person: MOI_NOMME, action, detail: { environment, principal }, principal_person: visee === undefined ? null : { name: visee.name, email: visee.email } });
  }

  accorder(environment: Code, principal: Principal): Exemple {
    if (!["DEV", "TEST", "PROD"].includes(environment)) return { status: 400, body: { error: { code: "invalid_request", field: "environment" } } };
    const connue = this.connue(principal);
    if (principal.kind === "person" && connue === undefined) return { status: 422, body: { error: { code: "unknown_person" } } };
    const meme = (a: Principal, b: Principal) => (a.kind === "group" ? b.kind === "group" && a.name === b.name : b.kind === "person" && a.issuer === b.issuer && a.subject === b.subject);
    const existant = this.accords.find((accord) => accord.environment === environment && meme(accord.principal, principal));
    if (existant !== undefined) return { status: 200, body: existant };
    const accord: Accord = {
      id: `00000000-0000-4000-8000-${String(this.suivant++).padStart(12, "0")}`,
      environment,
      principal,
      person: connue === undefined ? null : { name: connue.name, email: connue.email },
      created_at: INSTANT,
      created_by: MOI,
      created_by_person: MOI_NOMME,
    };
    this.accords.push(accord);
    this.noter("deploy_granted", environment, principal);
    return { status: 200, body: accord };
  }

  retirer(id: string): Exemple {
    const accord = this.accords.find((candidat) => candidat.id === id);
    if (accord === undefined) return { status: 404, body: { error: { code: "grant_not_found" } } };
    this.accords = this.accords.filter((candidat) => candidat !== accord);
    this.noter("deploy_revoked", accord.environment, accord.principal);
    return { status: 204, body: null };
  }
}

async function repondre(route: Route, exemple: Exemple): Promise<void> {
  if (exemple.body === null) await route.fulfill({ status: exemple.status });
  else await route.fulfill({ status: exemple.status, json: exemple.body });
}

/** Branche le serveur simulé : liste et espace (exemples réels), accords, journal, membres, personnes. */
async function simuler(page: Page, serveur: Serveur, table: Readonly<Record<string, Exemple>> = {}): Promise<void> {
  await simulerEspaces(page, { "/api/spaces": administration, "/api/spaces/finance": espace, ...table });
  await page.route((url) => /^\/api\/spaces\/finance\/(deploy-grants(\/[^/]+)?|events|members)$/.test(url.pathname), async (route) => {
    const requete = route.request();
    const chemin = new URL(requete.url()).pathname;
    const refus = table[`${requete.method()} ${chemin}`];
    if (refus !== undefined) { await repondre(route, refus); return; }
    if (requete.method() === "GET") {
      if (chemin.endsWith("/events")) await repondre(route, { status: 200, body: { events: serveur.journal } });
      else if (chemin.endsWith("/members")) await repondre(route, membres);
      else await repondre(route, { status: 200, body: { grants: serveur.accords } });
      return;
    }
    const corps = requete.method() === "POST" ? (requete.postDataJSON() as { environment: Code; principal: Principal }) : null;
    serveur.ecritures.push({ methode: requete.method(), chemin, corps });
    await repondre(route, corps === null ? serveur.retirer(chemin.split("/").pop() ?? "") : serveur.accorder(corps.environment, corps.principal));
  });
  await page.route((url) => url.pathname === "/api/people", async (route) => {
    const q = (new URL(route.request().url()).searchParams.get("q") ?? "").toLowerCase();
    await repondre(route, { status: 200, body: { people: CONNUES.filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(q)) } });
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
  await page.goto("/#/espaces/finance/environnements");
  await expect(page.getByRole("heading", { level: 1, name: "Environnements" })).toBeVisible();
  await expect(pipeline(page)).toBeVisible();
  await expect(page.getByRole("list", { name: "Journal de l'espace" })).toBeVisible();
  await polices(page);
  return serveur;
}
const pipeline = (page: Page) => page.getByRole("list", { name: "Droits de déployer, dans l'ordre de promotion" });
const etapes = (page: Page) => pipeline(page).locator(":scope > li");
const etape = (page: Page, code: Code) => etapes(page).filter({ has: page.getByRole("heading", { level: 2, name: new RegExp(`^${code}`) }) });
const formulaire = (page: Page) => page.getByRole("form", { name: "Accorder un droit de déployer" });
const journalEntrees = (page: Page) => page.getByRole("list", { name: "Journal de l'espace" }).getByRole("listitem");
const bascule = (page: Page) => page.getByRole("banner").getByRole("group", { name: "Environnement" });
const debordement = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/**
 * Éléments d'une carte du pipeline qui dépassent de leur carte, bordure comprise. Le padding n'est
 * pas exigé : à 1110 px, l'adresse de l'exemple réel y entre de 4 px sans sortir de la carte.
 */
const sortiesDeCarte = (page: Page) =>
  etapes(page).evaluateAll((items) =>
    items.flatMap((item) => {
      const carte = item.getBoundingClientRect();
      const style = getComputedStyle(item);
      const droite = carte.right - parseFloat(style.borderRightWidth);
      return [...item.querySelectorAll("span, p, strong, button")].filter((el) => el.getBoundingClientRect().right > droite + 0.5).map((el) => el.textContent.slice(0, 40));
    }),
  );
const boites = (page: Page) => etapes(page).evaluateAll((items) => items.map((item) => { const r = item.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));

test("l'écran montre les trois environnements dans l'ordre, la cible, les accords, le rappel et le journal", async ({ page }) => {
  await ouvrirEcran(page);
  await expect(page.getByText(RAPPEL)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Fil d'Ariane" }).getByRole("listitem")).toHaveText(["Finance", "Environnements"]);
  await expect(page.getByRole("navigation", { name: "Navigation principale" }).getByRole("button", { name: "Espace & connexions" })).toHaveAttribute("aria-current", "page");
  await expect(pipeline(page).getByRole("heading", { level: 2 })).toHaveText(["DEVenvironnement affiché", "TEST", "PROD"]);
  await expect(etape(page, "DEV")).toHaveAttribute("aria-current", "step");
  await expect(etape(page, "DEV")).toContainText("Groupe finance-createurs");
  await expect(etape(page, "TEST")).toContainText("Dominique Leroy");
  await expect(etape(page, "TEST")).toContainText("Accordé par Camille Martin");
  await expect(etape(page, "PROD")).toContainText("Personne ne peut y déployer.");
  await expect(journalEntrees(page).nth(0)).toContainText("Alix a retiré le droit de déployer en PROD au groupe finance-admins.");
  await expect(journalEntrees(page).nth(3)).toContainText("Camille Martin a accordé le droit de déployer en TEST à Dominique Leroy.");
});

test("accorde à un groupe par son nom exact dans l'environnement choisi ; le journal le raconte", async ({ page }) => {
  const serveur = await ouvrirEcran(page);
  await formulaire(page).getByRole("textbox", { name: /Nom exact du groupe/ }).fill("Finance-Ops ");
  await formulaire(page).getByRole("combobox", { name: "Environnement" }).selectOption("PROD");
  await formulaire(page).getByRole("button", { name: "Accorder le droit" }).click();
  await expect(page.getByRole("status").filter({ hasText: "accordé." })).toContainText("Groupe Finance-Ops : droit de déployer en PROD accordé.");
  await expect(page.locator(".sb-members__feedback")).toBeFocused();
  expect(serveur.ecritures).toEqual([{ methode: "POST", chemin: "/api/spaces/finance/deploy-grants", corps: { environment: "PROD", principal: { kind: "group", name: "Finance-Ops " } } }]);
  await expect(etape(page, "PROD")).toContainText("Groupe Finance-Ops");
  await expect(etape(page, "PROD")).not.toContainText("Personne ne peut y déployer.");
  await expect(journalEntrees(page).nth(0)).toContainText("a accordé le droit de déployer en PROD au groupe Finance-Ops .");
  await expect(formulaire(page).getByRole("textbox", { name: /Nom exact du groupe/ })).toHaveValue("");
  await expect(page.getByText(RAPPEL)).toBeVisible();
});

test("accorde à une personne connue cherchée par nom ou adresse", async ({ page }) => {
  const serveur = await ouvrirEcran(page);
  await formulaire(page).getByRole("radio", { name: "Personne connue" }).check();
  await formulaire(page).getByRole("searchbox", { name: "Nom ou adresse" }).fill("alix");
  await formulaire(page).getByRole("searchbox", { name: "Nom ou adresse" }).press("Enter");
  await formulaire(page).getByRole("list", { name: "Personnes trouvées" }).getByRole("button", { name: /Alix Martin/ }).click();
  await formulaire(page).getByRole("button", { name: "Accorder le droit" }).click();
  await expect(etape(page, "DEV")).toContainText("Alix Martin");
  expect(serveur.ecritures[0]?.corps).toEqual({ environment: "DEV", principal: { kind: "person", issuer: ALIX.issuer, subject: ALIX.subject } });
  await expect(journalEntrees(page).nth(0)).toContainText("a accordé le droit de déployer en DEV à Alix Martin.");
});

test("un droit déjà accordé est signalé et rien ne part, même par Entrée ; ailleurs il s'accorde", async ({ page }) => {
  const serveur = await ouvrirEcran(page);
  const nom = formulaire(page).getByRole("textbox", { name: /Nom exact du groupe/ });
  await nom.fill("finance-createurs");
  await expect(formulaire(page).getByRole("status")).toHaveText("Groupe finance-createurs peut déjà déployer en DEV : rien ne changera.");
  await expect(formulaire(page).getByRole("button", { name: "Accorder le droit" })).toBeDisabled();
  await nom.press("Enter");
  await page.waitForTimeout(200);
  expect(serveur.ecritures).toEqual([]);
  await formulaire(page).getByRole("combobox", { name: "Environnement" }).selectOption("TEST");
  await expect(formulaire(page).getByRole("status")).toHaveCount(0);
  await formulaire(page).getByRole("button", { name: "Accorder le droit" }).click();
  await expect(etape(page, "TEST")).toContainText("Groupe finance-createurs");
  expect(serveur.ecritures.map((ecriture) => ecriture.corps)).toEqual([{ environment: "TEST", principal: { kind: "group", name: "finance-createurs" } }]);
});

test("retire un droit au clavier après confirmation ; Annuler rend le focus", async ({ page }) => {
  const serveur = await ouvrirEcran(page);
  const retirer = etape(page, "TEST").getByRole("button", { name: "Retirer le droit de déployer en TEST : Dominique Leroy" });
  await retirer.focus();
  await page.keyboard.press("Enter");
  const confirmation = etape(page, "TEST").getByRole("group", { name: "Retirer le droit de déployer en TEST : Dominique Leroy\u00a0?" });
  await expect(confirmation.getByRole("button", { name: "Retirer", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(retirer).toBeFocused();
  expect(serveur.ecritures).toEqual([]);
  await page.keyboard.press("Enter");
  await expect(confirmation.getByRole("button", { name: "Retirer", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "retiré" })).toHaveText("Droit de déployer en TEST retiré : Dominique Leroy.");
  await expect(page.locator(".sb-members__feedback")).toBeFocused();
  await expect(etape(page, "TEST")).toContainText("Personne ne peut y déployer.");
  expect(serveur.ecritures).toEqual([{ methode: "DELETE", chemin: `/api/spaces/finance/deploy-grants/${accords.body.grants[0]?.id ?? ""}`, corps: null }]);
  await expect(journalEntrees(page).nth(0)).toContainText("a retiré le droit de déployer en TEST à Dominique Leroy.");
});

test("la bascule de la coque déplace la cible du pipeline sans relire", async ({ page }) => {
  await ouvrirEcran(page);
  const avant = lectures.length;
  await bascule(page).getByRole("button", { name: "PROD", exact: true }).click();
  await expect(etape(page, "PROD")).toHaveAttribute("aria-current", "step");
  await expect(etape(page, "DEV")).not.toHaveAttribute("aria-current");
  await expect(pipeline(page).getByRole("heading", { level: 2 })).toHaveText(["DEV", "TEST", "PRODenvironnement affiché"]);
  await page.waitForTimeout(200);
  expect(lectures.slice(avant)).toEqual([]);
});

test("le formulaire suit la bascule tant que rien n'y est choisi ; un choix fait l'emporte jusqu'au prochain changement de cible", async ({ page }) => {
  const serveur = await ouvrirEcran(page);
  const choix = formulaire(page).getByRole("combobox", { name: "Environnement" });
  await expect(choix).toHaveValue("DEV");
  await bascule(page).getByRole("button", { name: "PROD", exact: true }).click();
  await expect(choix).toHaveValue("PROD");
  await choix.selectOption("TEST");
  await formulaire(page).getByRole("textbox", { name: /Nom exact du groupe/ }).fill("finance-admins");
  await formulaire(page).getByRole("button", { name: "Accorder le droit" }).click();
  await expect(page.locator(".sb-members__feedback")).toContainText("Groupe finance-admins : droit de déployer en TEST accordé.");
  await expect(choix).toHaveValue("TEST");
  await bascule(page).getByRole("button", { name: "DEV", exact: true }).click();
  await expect(choix).toHaveValue("DEV");
  await formulaire(page).getByRole("textbox", { name: /Nom exact du groupe/ }).fill("finance-admins");
  await formulaire(page).getByRole("button", { name: "Accorder le droit" }).click();
  await expect(page.locator(".sb-members__feedback")).toContainText("Groupe finance-admins : droit de déployer en DEV accordé.");
  expect(serveur.ecritures.map((ecriture) => (ecriture.corps as { environment: Code } | null)?.environment)).toEqual(["TEST", "DEV"]);
});

test("les onglets relient « Membres et rôles » et « Environnements »", async ({ page }) => {
  await ouvrirEcran(page);
  const onglets = page.getByRole("navigation", { name: "Administration de l'espace" });
  await expect(onglets.getByRole("link", { name: "Environnements" })).toHaveAttribute("aria-current", "page");
  await onglets.getByRole("link", { name: "Membres et rôles" }).click();
  await expect(page).toHaveURL(/#\/espaces\/finance\/membres$/);
  await expect(page.getByRole("table", { name: "Liaisons de l'espace" })).toBeVisible();
  await expect(onglets.getByRole("link", { name: "Membres et rôles" })).toHaveAttribute("aria-current", "page");
  await onglets.getByRole("link", { name: "Environnements" }).click();
  await expect(page).toHaveURL(/#\/espaces\/finance\/environnements$/);
  await expect(pipeline(page)).toBeVisible();
});

test("l'accueil offre « Environnements » à qui gère l'espace", async ({ page }) => {
  await simuler(page, new Serveur());
  await page.goto("/");
  await page.getByRole("link", { name: "Environnements de Finance" }).click();
  await expect(page).toHaveURL(/#\/espaces\/finance\/environnements$/);
  await expect(pipeline(page)).toBeVisible();
});

for (const largeur of [320, 390, 1280]) {
  test(`accueil : « Membres et rôles » et « Environnements » dans leur carte, sans défilement horizontal, à ${largeur} px`, async ({ page }) => {
    await page.setViewportSize({ width: largeur, height: 900 });
    await simuler(page, new Serveur());
    await page.goto("/");
    const membresLien = page.getByRole("link", { name: "Membres et rôles de Finance" });
    const environnementsLien = page.getByRole("link", { name: "Environnements de Finance" });
    await expect(environnementsLien).toBeVisible();
    await polices(page);
    const carte = await page.locator("li", { has: environnementsLien }).last().boundingBox();
    const [m, e] = [await membresLien.boundingBox(), await environnementsLien.boundingBox()];
    for (const lien of [m, e]) {
      expect(lien?.x ?? 0).toBeGreaterThanOrEqual(carte?.x ?? 0);
      expect((lien?.x ?? 0) + (lien?.width ?? 0)).toBeLessThanOrEqual((carte?.x ?? 0) + (carte?.width ?? 0));
    }
    // Côte à côte quand ils tiennent, sans se chevaucher ; sinon l'un sous l'autre.
    if ((m?.y ?? 0) === (e?.y ?? 0)) expect((m?.x ?? 0) + (m?.width ?? 0)).toBeLessThan(e?.x ?? 0);
    else expect((m?.y ?? 0) + (m?.height ?? 0)).toBeLessThanOrEqual(e?.y ?? 0);
    if (largeur >= 390) expect(m?.y).toBe(e?.y);
    await expect.poll(() => debordement(page)).toBeLessThanOrEqual(0);
  });
}

test("accès refusé : un créateur voit le refus du serveur, sans formulaire", async ({ page }) => {
  const serveur = new Serveur();
  await simuler(page, serveur, {
    "/api/spaces": liste,
    "/api/spaces/finance": { status: 200, body: { ...espace.body, role: "creator" } },
    "GET /api/spaces/finance/deploy-grants": interdit,
    "GET /api/spaces/finance/events": interdit,
  });
  await page.goto("/#/espaces/finance/environnements");
  await expect(page.getByRole("alert")).toHaveText(["Votre rôle ne permet pas cette action.", "Votre rôle ne permet pas cette action."]);
  await expect(pipeline(page)).toHaveCount(0);
  await expect(formulaire(page)).toHaveCount(0);
  await expect(page.getByText(RAPPEL)).toBeVisible();
  expect(serveur.ecritures).toEqual([]);
});

test("mode local : les droits ne se gèrent pas, et rien n'est lu", async ({ page }) => {
  await simulerIdentite(page);
  await simulerEspaces(page, { "/api/spaces": locale, "/api/spaces/local": { status: 200, body: locale.body.spaces[0] } });
  await page.goto("/#/espaces/local/environnements");
  await expect(page.getByRole("heading", { level: 1, name: "Environnements" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "mode local" })).toContainText("les droits de déployer ne se gèrent pas");
  await page.waitForTimeout(200);
  expect(lectures.filter((chemin) => chemin.includes("/deploy-grants") || chemin.includes("/events") || chemin.startsWith("/api/people"))).toEqual([]);
});

test("pipeline : trois cartes reliées par des flèches, la cible sur fond cuivre clair et bordure cuivre 2 px", async ({ page }) => {
  await ouvrirEcran(page);
  await bascule(page).getByRole("button", { name: "TEST", exact: true }).click();
  const styles = await etapes(page).evaluateAll((items) =>
    items.map((item) => {
      const style = getComputedStyle(item);
      const fleche = getComputedStyle(item, "::before");
      return { fond: style.backgroundColor, bord: `${style.borderTopWidth} ${style.borderTopColor}`, fleche: fleche.content };
    }),
  );
  expect(styles[1]).toMatchObject({ fond: "rgb(251, 241, 233)", bord: "2px rgb(164, 82, 31)" });
  for (const index of [0, 2]) expect(styles[index]).toMatchObject({ fond: "rgb(255, 255, 255)", bord: "1px rgb(218, 223, 227)" });
  // La première carte n'a pas de flèche ; les suivantes en ont une, muette pour les lecteurs d'écran.
  expect(styles[0]?.fleche).toBe("none");
  const boite = await boites(page);
  const [a, b, c] = boite as [typeof boite[0], typeof boite[0], typeof boite[0]];
  const largeur = page.viewportSize()?.width ?? 0;
  if (largeur >= 1100) {
    expect(styles.slice(1).map((style) => style.fleche)).toEqual(['"→" / ""', '"→" / ""']);
    // En ligne, sans chevauchement, à la même hauteur.
    expect(a.y).toBe(b.y);
    expect(b.y).toBe(c.y);
    expect(a.x + a.w).toBeLessThan(b.x);
    expect(b.x + b.w).toBeLessThan(c.x);
  } else {
    expect(styles.slice(1).map((style) => style.fleche)).toEqual(['"↓" / ""', '"↓" / ""']);
    expect(a.x).toBe(b.x);
    expect(a.y + a.h).toBeLessThan(b.y);
    expect(b.y + b.h).toBeLessThan(c.y);
  }
  // La flèche tient dans l'intervalle entre deux cartes, sans les recouvrir.
  const fleches = await etapes(page).evaluateAll((items) => items.slice(1).map((item) => {
    const style = getComputedStyle(item, "::before");
    return { top: parseFloat(style.top), left: parseFloat(style.left), width: parseFloat(style.width) };
  }));
  for (const fleche of fleches) {
    if (largeur >= 1100) expect(fleche.left + fleche.width).toBeLessThanOrEqual(0);
    else expect(fleche.top).toBeLessThan(0);
  }
});

// 1110 px : juste au-dessus du passage en colonne (1100 px), la zone de contenu est la plus étroite
// pour trois cartes côte à côte.
for (const largeur of [390, 768, 1110, 1280]) {
  for (const etat of ["écran", "confirmation"] as const) {
    test(`aucun défilement horizontal de page, ${etat} à ${largeur} px`, async ({ page }) => {
      await page.setViewportSize({ width: largeur, height: 900 });
      await ouvrirEcran(page);
      if (etat === "confirmation") {
        await etape(page, "TEST").getByRole("button", { name: /^Retirer le droit/ }).click();
        await expect(etape(page, "TEST").getByRole("button", { name: "Retirer", exact: true })).toBeFocused();
        await expect(etape(page, "TEST").getByRole("button", { name: "Retirer", exact: true })).toBeInViewport();
      }
      await expect.poll(() => page.evaluate(() => document.documentElement.clientWidth)).toBe(largeur);
      await expect.poll(() => debordement(page)).toBeLessThanOrEqual(0);
      // Aucune carte ne déborde de la liste ni n'en chevauche une autre.
      const liste = await pipeline(page).boundingBox();
      for (const boite of await boites(page)) {
        expect(boite.x).toBeGreaterThanOrEqual((liste?.x ?? 0) - 0.5);
        expect(boite.x + boite.w).toBeLessThanOrEqual((liste?.x ?? 0) + (liste?.width ?? 0) + 0.5);
      }
      expect(await sortiesDeCarte(page)).toEqual([]);
    });
  }
}

/** Le dernier caractère de la question (« ? ») est sur la même ligne que le mot qui le précède. */
const pointSurLaLigne = (page: Page) =>
  page.locator(".sb-confirm__question").evaluate((question) => {
    const texte = question.firstChild as Text;
    const n = texte.length;
    const boite = (debut: number, fin: number) => { const r = document.createRange(); r.setStart(texte, debut); r.setEnd(texte, fin); return r.getBoundingClientRect(); };
    return { avant: texte.data.at(-2), meme: Math.abs(boite(n - 1, n).top - boite(n - 3, n - 2).top) < 1 };
  });

const ADRESSE_LONGUE = "dominique.leroydelafontaine@directionfinanciere.example.invalid";
const GROUPE_LONG = "cn=financecreateursregionsudouest,ou=groupes,dc=entreprise";
/** Accords aux noms longs sans coupure : l'adresse d'une personne en TEST, un groupe en DEV. */
function serveurAuxNomsLongs(): Serveur {
  const serveur = new Serveur();
  const personne = serveur.accords.find((accord) => accord.environment === "TEST");
  if (personne !== undefined) personne.person = { name: "Dominique Leroy", email: ADRESSE_LONGUE };
  const groupe = serveur.accords.find((accord) => accord.environment === "DEV");
  if (groupe !== undefined) groupe.principal = { kind: "group", name: GROUPE_LONG };
  return serveur;
}
/** Boutons d'une carte qui sortent de la carte, padding compris : ils restent entiers et cliquables. */
const boutonsHorsCarte = (page: Page) =>
  etapes(page).evaluateAll((items) =>
    items.flatMap((item) => {
      const carte = item.getBoundingClientRect();
      const style = getComputedStyle(item);
      const gauche = carte.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
      const droite = carte.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
      return [...item.querySelectorAll("button")].filter((el) => { const r = el.getBoundingClientRect(); return r.left < gauche - 0.5 || r.right > droite + 0.5; }).map((el) => el.textContent);
    }),
  );

// Une adresse ou un nom de groupe longs sans coupure se coupent dans leur carte (plan 09, 9.4,
// défaut trouvé par ces tests, corrigé par `min-width: 0` et `overflow-wrap: anywhere`).
for (const largeur of [390, 1110, 1280]) {
  for (const etat of ["écran", "confirmation"] as const) {
    test(`noms longs sans coupure : rien ne sort des cartes, ${etat} à ${largeur} px`, async ({ page }) => {
      await page.setViewportSize({ width: largeur, height: 900 });
      await ouvrirEcran(page, serveurAuxNomsLongs());
      await expect(etape(page, "TEST")).toContainText(ADRESSE_LONGUE);
      await expect(etape(page, "DEV")).toContainText(`Groupe ${GROUPE_LONG}`);
      if (etat === "confirmation") {
        for (const code of ["DEV", "TEST"] as const) {
          const carte = etape(page, code);
          await carte.getByRole("button", { name: /^Retirer le droit/ }).click();
          await expect(carte.getByRole("button", { name: "Retirer", exact: true })).toBeFocused();
          await expect(carte.getByRole("button", { name: "Retirer", exact: true })).toBeInViewport();
          await expect(carte.getByRole("button", { name: "Annuler" })).toBeVisible();
          expect(await sortiesDeCarte(page)).toEqual([]);
          expect(await boutonsHorsCarte(page)).toEqual([]);
          await carte.getByRole("button", { name: "Annuler" }).click();
        }
      } else {
        await expect(etape(page, "DEV").getByRole("button", { name: `Retirer le droit de déployer en DEV : Groupe ${GROUPE_LONG}` })).toBeVisible();
      }
      expect(await sortiesDeCarte(page)).toEqual([]);
      expect(await boutonsHorsCarte(page)).toEqual([]);
      await expect.poll(() => debordement(page)).toBeLessThanOrEqual(0);
      // Le texte se coupe, il n'est pas masqué : l'adresse tient entière dans sa carte, sur plusieurs lignes à 390 px.
      const adresse = etape(page, "TEST").getByText(ADRESSE_LONGUE, { exact: true });
      const [boite, carte] = [await adresse.boundingBox(), await etape(page, "TEST").boundingBox()];
      expect((boite?.x ?? 0) + (boite?.width ?? 0)).toBeLessThanOrEqual((carte?.x ?? 0) + (carte?.width ?? 0));
      if (largeur === 390) expect(boite?.height ?? 0).toBeGreaterThan(30);
    });
  }
}

for (const [largeur, nom, accord] of [[390, "Dominique Leroy", "TEST"], [390, `Groupe ${GROUPE_LONG}`, "DEV"], [1110, "Dominique Leroy", "TEST"]] as const) {
  test(`la question de confirmation garde « ? » avec le mot qui le précède : ${nom.slice(0, 24)} à ${largeur} px`, async ({ page }) => {
    await page.setViewportSize({ width: largeur, height: 900 });
    await ouvrirEcran(page, serveurAuxNomsLongs());
    await etape(page, accord).getByRole("button", { name: /^Retirer le droit/ }).click();
    const question = etape(page, accord).locator(".sb-confirm__question");
    await expect(question).toHaveText(`Retirer le droit de déployer en ${accord} : ${nom}\u00a0?`);
    expect(await pointSurLaLigne(page)).toEqual({ avant: "\u00a0", meme: true });
  });
}

for (const etat of ["écran", "confirmation", "refus", "doublon", "accès refusé", "mode local"] as const) {
  test(`axe sur la page entière, contraste compris : ${etat}`, async ({ page }) => {
    if (etat === "accès refusé") {
      await simuler(page, new Serveur(), { "/api/spaces": liste, "/api/spaces/finance": { status: 200, body: { ...espace.body, role: "creator" } }, "GET /api/spaces/finance/deploy-grants": interdit, "GET /api/spaces/finance/events": interdit });
      await page.goto("/#/espaces/finance/environnements");
      await expect(page.getByRole("alert")).toHaveCount(2);
    } else if (etat === "mode local") {
      await simulerIdentite(page);
      await simulerEspaces(page, { "/api/spaces": locale, "/api/spaces/local": { status: 200, body: locale.body.spaces[0] } });
      await page.goto("/#/espaces/local/environnements");
      await expect(page.getByRole("status").filter({ hasText: "mode local" })).toBeVisible();
    } else {
      await ouvrirEcran(page, new Serveur(), etat === "refus" ? { "POST /api/spaces/finance/deploy-grants": { status: 400, body: { error: { code: "invalid_request", field: "environment" } } } } : {});
      await bascule(page).getByRole("button", { name: "TEST", exact: true }).click();
      if (etat === "confirmation") await etape(page, "TEST").getByRole("button", { name: /^Retirer le droit/ }).click();
      if (etat === "doublon") await formulaire(page).getByRole("textbox", { name: /Nom exact du groupe/ }).fill("finance-createurs");
      if (etat === "refus") {
        await formulaire(page).getByRole("textbox", { name: /Nom exact du groupe/ }).fill("x");
        await formulaire(page).getByRole("button", { name: "Accorder le droit" }).click();
        await expect(page.getByRole("alert")).toHaveText("La demande est incomplète ou mal formée. Champ en cause : environnement.");
      }
    }
    await polices(page);
    const resultat = await new AxeBuilder({ page }).options({ rules: { "color-contrast": { enabled: true } } }).analyze();
    expect(resultat.violations.map((violation) => violation.id), `Règles axe en échec : ${etat}`).toEqual([]);
  });
}

/** TEST choisi dans la coque sur « Membres et rôles », puis l'onglet « Environnements ». */
async function ouvrirAvecCibleTest(page: Page) {
  await simuler(page, new Serveur());
  await page.goto("/#/espaces/finance/membres");
  await expect(page.getByRole("table", { name: "Liaisons de l'espace" })).toBeVisible();
  await bascule(page).getByRole("button", { name: "TEST", exact: true }).click();
  await page.getByRole("navigation", { name: "Administration de l'espace" }).getByRole("link", { name: "Environnements" }).click();
  await expect(pipeline(page)).toBeVisible();
  await expect(page.getByRole("list", { name: "Journal de l'espace" })).toBeVisible();
  await expect(etape(page, "TEST")).toHaveAttribute("aria-current", "step");
  await expect(formulaire(page).getByRole("combobox", { name: "Environnement" })).toHaveValue("TEST");
  await polices(page);
}

test("capture de référence de « Environnements » : accords et cible TEST", async ({ page }) => {
  await ouvrirAvecCibleTest(page);
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });
  await expect(page).toHaveScreenshot("environnements-ecran.png", { fullPage: true });
});

test("capture de référence d'un retrait en attente de confirmation", async ({ page }) => {
  await ouvrirAvecCibleTest(page);
  await etape(page, "TEST").getByRole("button", { name: /^Retirer le droit/ }).click();
  await expect(etape(page, "TEST").getByRole("button", { name: "Retirer", exact: true })).toBeFocused();
  await expect(page).toHaveScreenshot("environnements-confirmation.png", { fullPage: true });
});
