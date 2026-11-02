import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import creation from "../../../contracts/espaces/creation.json" with { type: "json" };
import espace from "../../../contracts/espaces/espace.json" with { type: "json" };
import interdit from "../../../contracts/espaces/interdit.json" with { type: "json" };
import journal from "../../../contracts/espaces/journal.json" with { type: "json" };
import administration from "../../../contracts/espaces/liste-administration.json" with { type: "json" };
import liste from "../../../contracts/espaces/liste.json" with { type: "json" };
import locale from "../../../contracts/espaces/liste-locale.json" with { type: "json" };
import membres from "../../../contracts/espaces/membres.json" with { type: "json" };
import personnes from "../../../contracts/espaces/personnes.json" with { type: "json" };
import etabli from "../../../contracts/identite/me-etabli.json" with { type: "json" };
import { catalogueHorsEspace, enregistrerLectures, simulerEspaces, simulerIdentite, type Exemple } from "./aides";

// Membres et rôles, création d'un espace (plan 08, 8.4). Les deux projets de playwright.config.ts
// exécutent tous ces parcours : ordinateur (1280 px) et téléphone (390 px, émulation d'appareil).

type Role = "reader" | "creator" | "admin";
type Principal = { kind: "group"; name: string } | { kind: "person"; issuer: string; subject: string };
interface Liaison {
  id: string;
  principal: Principal;
  person: { name: string | null; email: string | null } | null;
  role: Role;
  created_at: string;
  created_by: { issuer: string; subject: string };
  created_by_person: { name: string | null; email: string | null } | null;
}
interface Evenement {
  id: number;
  at: string;
  actor: { issuer: string; subject: string };
  actor_person: { name: string | null; email: string | null } | null;
  action: string;
  detail: unknown;
  principal_person: { name: string | null; email: string | null } | null;
}

const INSTANT = "2026-11-02T12:30:00+00:00";
const MOI = { issuer: etabli.body.identity.issuer, subject: etabli.body.identity.subject };
const MOI_NOMME = { name: etabli.body.identity.name, email: etabli.body.identity.email };
const DOMINIQUE = personnes.body.people[0] as { issuer: string; subject: string; name: string; email: string; last_login: string };
const ALIX = { issuer: "https://id.example.invalid", subject: "00u7alix", name: "Alix Martin", email: "alix.martin@example.invalid", last_login: "2026-11-02T08:50:00+00:00" };
const CONNUES = [DOMINIQUE, ALIX];

/**
 * Serveur Board simulé pour l'administration des espaces, avec la règle du dernier administrateur
 * (E8), le journal (E10) et les refus à codes fermés (E12). Il enregistre les écritures reçues.
 */
class Serveur {
  readonly espaces = new Map<string, { corps: Record<string, unknown>; liaisons: Liaison[]; journal: Evenement[] }>();
  readonly ecritures: { methode: string; chemin: string; corps: unknown }[] = [];
  private suivant = 1;
  private evenement = 100;

  constructor() {
    this.espaces.set("finance", {
      corps: espace.body,
      liaisons: structuredClone(membres.body.members as unknown as Liaison[]),
      journal: structuredClone(journal.body.events as unknown as Evenement[]),
    });
  }

  private nouvelId(): string {
    return `00000000-0000-4000-8000-${String(this.suivant++).padStart(12, "0")}`;
  }

  /** Comme le serveur : la personne visée par une liaison est nommée si Board la connaît, même retirée. */
  private noter(id: string, action: string, detail: { principal?: Principal } & Record<string, unknown>): void {
    const visee = detail.principal === undefined ? undefined : this.connue(detail.principal);
    const principal_person = visee === undefined ? null : { name: visee.name, email: visee.email };
    this.espaces.get(id)?.journal.unshift({ id: this.evenement++, at: INSTANT, actor: MOI, actor_person: MOI_NOMME, action, detail, principal_person });
  }

  private connue(principal: Principal) {
    return principal.kind === "person" ? CONNUES.find((p) => p.issuer === principal.issuer && p.subject === principal.subject) : undefined;
  }

  private memePrincipal(a: Principal, b: Principal): boolean {
    return a.kind === "group" ? b.kind === "group" && a.name === b.name : b.kind === "person" && a.issuer === b.issuer && a.subject === b.subject;
  }

  private nouvelleLiaison(principal: Principal, role: Role): Liaison {
    const connue = this.connue(principal);
    return { id: this.nouvelId(), principal, person: connue === undefined ? null : { name: connue.name, email: connue.email }, role, created_at: INSTANT, created_by: MOI, created_by_person: MOI_NOMME };
  }

  creer(corps: { id: string; name: string; first_admin: Principal }): Exemple {
    if (this.espaces.has(corps.id)) return { status: 409, body: { error: { code: "space_exists" } } };
    if (corps.first_admin.kind === "person" && this.connue(corps.first_admin) === undefined) return { status: 422, body: { error: { code: "unknown_person" } } };
    const cree = { ...creation.body, id: corps.id, name: corps.name, created_at: INSTANT, created_by: MOI };
    this.espaces.set(corps.id, { corps: cree, liaisons: [this.nouvelleLiaison(corps.first_admin, "admin")], journal: [] });
    this.noter(corps.id, "space_created", { name: corps.name });
    this.noter(corps.id, "binding_added", { principal: corps.first_admin, after: "admin" });
    return { status: 201, body: cree };
  }

  poser(id: string, principal: Principal, role: Role): Exemple {
    const lieu = this.espaces.get(id);
    if (lieu === undefined) return { status: 404, body: { error: { code: "space_not_found" } } };
    if (principal.kind === "person" && this.connue(principal) === undefined) return { status: 422, body: { error: { code: "unknown_person" } } };
    const existante = lieu.liaisons.find((liaison) => this.memePrincipal(liaison.principal, principal));
    if (existante === undefined) {
      const liaison = this.nouvelleLiaison(principal, role);
      lieu.liaisons.push(liaison);
      this.noter(id, "binding_added", { principal, after: role });
      return { status: 200, body: liaison };
    }
    if (existante.role === role) return { status: 200, body: existante };
    if (existante.role === "admin" && lieu.liaisons.filter((liaison) => liaison.role === "admin").length === 1) return { status: 409, body: { error: { code: "last_admin" } } };
    this.noter(id, "binding_changed", { principal, before: existante.role, after: role });
    existante.role = role;
    return { status: 200, body: existante };
  }

  retirer(id: string, liaisonId: string): Exemple {
    const lieu = this.espaces.get(id);
    if (lieu === undefined) return { status: 404, body: { error: { code: "space_not_found" } } };
    const liaison = lieu.liaisons.find((candidate) => candidate.id === liaisonId);
    if (liaison === undefined) return { status: 404, body: { error: { code: "binding_not_found" } } };
    if (liaison.role === "admin" && lieu.liaisons.filter((candidate) => candidate.role === "admin").length === 1) return { status: 409, body: { error: { code: "last_admin" } } };
    lieu.liaisons = lieu.liaisons.filter((candidate) => candidate !== liaison);
    this.noter(id, "binding_removed", { principal: liaison.principal, before: liaison.role });
    return { status: 204, body: null };
  }
}

async function repondre(route: Route, exemple: Exemple): Promise<void> {
  if (exemple.body === null) await route.fulfill({ status: exemple.status });
  else await route.fulfill({ status: exemple.status, json: exemple.body });
}

/** Branche le serveur simulé : liste et espaces (exemples réels), membres, journal, personnes, création. */
async function simuler(page: Page, serveur: Serveur, table: Readonly<Record<string, Exemple>> = {}): Promise<void> {
  const routes: Record<string, Exemple> = { "/api/spaces": administration, ...table };
  for (const [id, lieu] of serveur.espaces) routes[`/api/spaces/${id}`] ??= { status: 200, body: { ...lieu.corps, role: null } };
  await simulerEspaces(page, routes);
  // Les espaces créés pendant le parcours se lisent aussi, sans rôle, comme pour l'administration de la plateforme.
  await page.route((url) => /^\/api\/spaces\/[^/]+$/.test(url.pathname), async (route) => {
    const id = new URL(route.request().url()).pathname.split("/")[3] ?? "";
    const lieu = serveur.espaces.get(id);
    if (table[`/api/spaces/${id}`] === undefined && lieu !== undefined) await repondre(route, { status: 200, body: { ...lieu.corps, role: id === "finance" ? "admin" : null } });
    else await route.fallback();
  });
  await page.route((url) => url.pathname === "/api/spaces", async (route) => {
    if (route.request().method() !== "POST") { await route.fallback(); return; }
    const corps = route.request().postDataJSON() as { id: string; name: string; first_admin: Principal };
    serveur.ecritures.push({ methode: "POST", chemin: "/api/spaces", corps });
    await repondre(route, serveur.creer(corps));
  });
  await page.route((url) => /^\/api\/spaces\/[^/]+\/(members(\/[^/]+)?|events)$/.test(url.pathname), async (route) => {
    const requete = route.request();
    const chemin = new URL(requete.url()).pathname;
    const [, , , id = "", ressource, liaison] = chemin.split("/");
    const lieu = serveur.espaces.get(id);
    const refus = table[`${requete.method()} ${chemin}`];
    if (refus !== undefined) { await repondre(route, refus); return; }
    if (lieu === undefined) { await repondre(route, { status: 404, body: { error: { code: "space_not_found" } } }); return; }
    if (requete.method() === "GET") {
      await repondre(route, ressource === "events" ? { status: 200, body: { events: lieu.journal } } : { status: 200, body: { members: lieu.liaisons } });
      return;
    }
    const corps = requete.method() === "POST" ? (requete.postDataJSON() as { principal: Principal; role: Role }) : null;
    serveur.ecritures.push({ methode: requete.method(), chemin, corps });
    await repondre(route, corps === null ? serveur.retirer(id, liaison ?? "") : serveur.poser(id, corps.principal, corps.role));
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
async function ouvrirMembres(page: Page, serveur = new Serveur(), table: Readonly<Record<string, Exemple>> = {}) {
  await simuler(page, serveur, table);
  await page.goto("/#/espaces/finance/membres");
  await expect(page.getByRole("heading", { level: 1, name: "Membres et rôles" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Liaisons de l'espace" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Journal de l'espace" })).toBeVisible();
  await polices(page);
  return serveur;
}
const ligne = (page: Page, nom: string | RegExp) => page.getByRole("table", { name: "Liaisons de l'espace" }).getByRole("row").filter({ has: page.getByRole("rowheader", { name: nom }) });
const formulaire = (page: Page) => page.getByRole("form", { name: "Ajouter une liaison" });
const journalEntrees = (page: Page) => page.getByRole("list", { name: "Journal de l'espace" }).getByRole("listitem");
const debordement = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const RAPPEL = "Un rôle ne donne aucun droit sur les données.";


test("l'écran liste les liaisons, rappelle qu'un rôle ne donne aucun droit sur les données, et montre le journal", async ({ page }) => {
  await ouvrirMembres(page);
  await expect(page.getByText(RAPPEL)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Fil d'Ariane" }).getByRole("listitem")).toHaveText(["Finance", "Membres et rôles"]);
  await expect(page.getByRole("navigation", { name: "Navigation principale" }).getByRole("button", { name: "Espace & connexions" })).toHaveAttribute("aria-current", "page");
  await expect(ligne(page, /Groupe finance-admins/)).toContainText("Camille Martin");
  await expect(ligne(page, /Dominique Leroy/)).toContainText("dominique.leroy@example.invalid");
  await expect(journalEntrees(page)).toHaveCount(3);
  await expect(journalEntrees(page).nth(0)).toContainText("Camille Martin a ajouté Dominique Leroy : Lecteur.");
  await expect(journalEntrees(page).nth(2)).toContainText("Camille Martin a créé l'espace « Finance ».");
});

test("ajoute un groupe par son nom exact, au rôle choisi", async ({ page }) => {
  const serveur = await ouvrirMembres(page);
  await formulaire(page).getByRole("textbox", { name: /Nom exact du groupe/ }).fill("Finance-Invités ");
  await formulaire(page).getByRole("combobox", { name: "Rôle" }).selectOption("creator");
  await formulaire(page).getByRole("button", { name: "Ajouter la liaison" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Créateur." })).toContainText("Groupe Finance-Invités : Créateur.");
  // Le nom part tel quel, casse et espace final compris (E3).
  expect(serveur.ecritures).toEqual([{ methode: "POST", chemin: "/api/spaces/finance/members", corps: { principal: { kind: "group", name: "Finance-Invités " }, role: "creator" } }]);
  await expect(ligne(page, /Groupe Finance-Invités/).getByRole("combobox")).toHaveValue("creator");
  await expect(journalEntrees(page).nth(0)).toContainText("Camille Martin a ajouté le groupe Finance-Invités : Créateur.");
  await expect(page.getByText(RAPPEL)).toBeVisible();
});

test("ajoute une personne connue cherchée par nom ou adresse", async ({ page }) => {
  const serveur = await ouvrirMembres(page);
  await formulaire(page).getByRole("radio", { name: "Personne connue" }).check();
  await formulaire(page).getByRole("searchbox", { name: "Nom ou adresse" }).fill("alix");
  await formulaire(page).getByRole("searchbox", { name: "Nom ou adresse" }).press("Enter");
  await formulaire(page).getByRole("list", { name: "Personnes trouvées" }).getByRole("button", { name: /Alix Martin/ }).click();
  await expect(formulaire(page)).toContainText("Alix Martin · alix.martin@example.invalid");
  await formulaire(page).getByRole("button", { name: "Ajouter la liaison" }).click();
  await expect(ligne(page, /Alix Martin/)).toBeVisible();
  expect(serveur.ecritures[0]?.corps).toEqual({ principal: { kind: "person", issuer: ALIX.issuer, subject: ALIX.subject }, role: "reader" });
  expect(lectures).toContain("/api/people?q=alix");
});

test("une recherche sans résultat dit comment ajouter quelqu'un qui ne s'est jamais connecté", async ({ page }) => {
  await ouvrirMembres(page);
  await formulaire(page).getByRole("radio", { name: "Personne connue" }).check();
  await formulaire(page).getByRole("searchbox", { name: "Nom ou adresse" }).fill("zoé");
  await formulaire(page).getByRole("button", { name: "Chercher" }).click();
  await expect(formulaire(page).getByRole("status")).toHaveText("Aucune personne connue ne correspond. Une personne s'ajoute après sa première connexion, ou par un groupe.");
});

test("change un rôle au clavier : le focus va au bouton de confirmation", async ({ page }) => {
  const serveur = await ouvrirMembres(page);
  const role = ligne(page, /Dominique Leroy/).getByRole("combobox", { name: "Rôle de Dominique Leroy" });
  await role.focus();
  await role.selectOption("creator");
  const confirmation = ligne(page, /Dominique Leroy/).getByRole("group", { name: "Passer Dominique Leroy de Lecteur à Créateur ?" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole("button", { name: "Confirmer" })).toBeFocused();
  expect(serveur.ecritures).toEqual([]);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Dominique Leroy : Créateur." })).toBeVisible();
  // La ligne confirmée a pu changer : le focus va au bandeau de réponse.
  await expect(page.locator(".sb-members__feedback")).toBeFocused();
  expect(serveur.ecritures[0]?.corps).toEqual({ principal: { kind: "person", issuer: DOMINIQUE.issuer, subject: DOMINIQUE.subject }, role: "creator" });
  await expect(ligne(page, /Dominique Leroy/).getByRole("combobox")).toHaveValue("creator");
  await expect(journalEntrees(page).nth(0)).toContainText("a changé le rôle de Dominique Leroy : Lecteur → Créateur.");
});

test("annuler un changement de rôle ne change rien", async ({ page }) => {
  const serveur = await ouvrirMembres(page);
  await ligne(page, /Dominique Leroy/).getByRole("combobox").selectOption("admin");
  await ligne(page, /Dominique Leroy/).getByRole("button", { name: "Annuler" }).click();
  await expect(ligne(page, /Dominique Leroy/).getByRole("combobox")).toHaveValue("reader");
  // Le focus revient au bouton « Retirer » de la ligne, pas au début de la page.
  await expect(ligne(page, /Dominique Leroy/).getByRole("button", { name: "Retirer Dominique Leroy" })).toBeFocused();
  expect(serveur.ecritures).toEqual([]);
});

test("un ajout refusé garde la saisie, pour la corriger", async ({ page }) => {
  const serveur = await ouvrirMembres(page, new Serveur(), { "POST /api/spaces/finance/members": { status: 400, body: { error: { code: "invalid_request", field: "principal.name" } } } });
  await formulaire(page).getByRole("textbox", { name: /Nom exact du groupe/ }).fill("finance-x");
  await formulaire(page).getByRole("combobox", { name: "Rôle" }).selectOption("creator");
  await formulaire(page).getByRole("button", { name: "Ajouter la liaison" }).click();
  await expect(page.getByRole("alert")).toHaveText("La demande est incomplète ou mal formée. Champ en cause : nom du groupe.");
  await expect(page.locator(".sb-members__feedback")).toBeFocused();
  await expect(formulaire(page).getByRole("textbox", { name: /Nom exact du groupe/ })).toHaveValue("finance-x");
  await expect(formulaire(page).getByRole("combobox", { name: "Rôle" })).toHaveValue("creator");
  expect(serveur.ecritures).toEqual([]);
});

test("retire une liaison au clavier, après confirmation", async ({ page }) => {
  const serveur = await ouvrirMembres(page);
  await ligne(page, /Dominique Leroy/).getByRole("button", { name: "Retirer Dominique Leroy" }).focus();
  await page.keyboard.press("Enter");
  const confirmation = ligne(page, /Dominique Leroy/).getByRole("group", { name: "Retirer Dominique Leroy ?" });
  await expect(confirmation.getByRole("button", { name: "Retirer" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Liaison retirée" })).toHaveText("Liaison retirée : Dominique Leroy.");
  await expect(ligne(page, /Dominique Leroy/)).toHaveCount(0);
  expect(serveur.ecritures.map((ecriture) => ecriture.methode)).toEqual(["DELETE"]);
  // Retirée, la personne n'est plus dans les liaisons : le journal la nomme par `principal_person`.
  await expect(journalEntrees(page).nth(0)).toContainText("Camille Martin a retiré Dominique Leroy (Lecteur).");
});

test("le dernier administrateur ne se retire ni ne s'abaisse : le refus dit pourquoi", async ({ page }) => {
  await ouvrirMembres(page);
  const raison = "C'est la dernière liaison administrateur de l'espace : ajoutez d'abord un autre administrateur.";
  await ligne(page, /Groupe finance-admins/).getByRole("button", { name: "Retirer Groupe finance-admins" }).click();
  await ligne(page, /Groupe finance-admins/).getByRole("button", { name: "Retirer", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(raison);
  await expect(ligne(page, /Groupe finance-admins/)).toBeVisible();
  await ligne(page, /Groupe finance-admins/).getByRole("combobox").selectOption("reader");
  await ligne(page, /Groupe finance-admins/).getByRole("button", { name: "Confirmer" }).click();
  await expect(page.getByRole("alert")).toHaveText(raison);
  await expect(ligne(page, /Groupe finance-admins/).getByRole("combobox")).toHaveValue("admin");
});

test("crée un espace puis arrive sur ses membres", async ({ page }) => {
  const serveur = new Serveur();
  await simuler(page, serveur);
  await page.goto("/");
  await page.getByRole("link", { name: "Créer un espace" }).click();
  await expect(page).toHaveURL(/#\/nouvel-espace$/);
  await expect(page.getByRole("heading", { level: 1, name: "Nouvel espace" })).toBeVisible();
  const creer = page.getByRole("form", { name: "Créer un espace" });
  await creer.getByRole("textbox", { name: /^Identifiant/ }).fill("achats");
  await creer.getByRole("textbox", { name: /^Nom affiché/ }).fill("  Achats  ");
  await creer.getByRole("textbox", { name: /Nom exact du groupe/ }).fill("achats-admins");
  await creer.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(page).toHaveURL(/#\/espaces\/achats\/membres$/);
  await expect(page.getByRole("heading", { level: 1, name: "Membres et rôles" })).toBeVisible();
  await expect(ligne(page, /Groupe achats-admins/).getByRole("combobox")).toHaveValue("admin");
  await expect(journalEntrees(page).nth(1)).toContainText("a créé l'espace « Achats ».");
  await expect(page.getByRole("navigation", { name: "Fil d'Ariane" }).getByRole("listitem")).toHaveText(["Achats", "Membres et rôles"]);
  expect(serveur.ecritures).toEqual([{ methode: "POST", chemin: "/api/spaces", corps: { id: "achats", name: "Achats", first_admin: { kind: "group", name: "achats-admins" } } }]);
});

test("la création refuse un identifiant hors format sans rien envoyer, puis rend le refus du serveur", async ({ page }) => {
  const serveur = new Serveur();
  await simuler(page, serveur);
  await page.goto("/#/nouvel-espace");
  const creer = page.getByRole("form", { name: "Créer un espace" });
  await creer.getByRole("textbox", { name: /^Identifiant/ }).fill("Finance");
  await creer.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(creer.getByRole("textbox", { name: /^Identifiant/ })).toHaveAttribute("aria-invalid", "true");
  await expect(creer).toContainText("Le nom est obligatoire.");
  // Le focus va au premier champ en cause ; le problème du premier administrateur décrit son groupe.
  await expect(creer.getByRole("textbox", { name: /^Identifiant/ })).toBeFocused();
  await expect(creer.getByRole("group", { name: "Premier administrateur" })).toHaveAccessibleDescription("Choisissez le premier administrateur : un groupe ou une personne connue.");
  expect(serveur.ecritures).toEqual([]);
  await creer.getByRole("textbox", { name: /^Identifiant/ }).fill("finance");
  await creer.getByRole("textbox", { name: /^Nom affiché/ }).fill("Finance");
  await creer.getByRole("textbox", { name: /Nom exact du groupe/ }).fill("g");
  await creer.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(creer.getByRole("alert")).toHaveText("Cet identifiant est déjà pris par un espace.");
  await expect(page).toHaveURL(/#\/nouvel-espace$/);
});

test("accès refusé : un créateur voit l'entrée fermée et le refus du serveur", async ({ page }) => {
  const serveur = new Serveur();
  // Liste sans administration de la plateforme : un créateur n'a pas l'entrée « Espace & connexions ».
  await simuler(page, serveur, {
    "/api/spaces": liste,
    "/api/spaces/finance": { status: 200, body: { ...espace.body, role: "creator" } },
    "GET /api/spaces/finance/members": interdit,
    "GET /api/spaces/finance/events": interdit,
  });
  await page.goto("/#/espaces/finance/membres");
  await expect(page.getByRole("alert")).toHaveText(["Votre rôle ne permet pas cette action.", "Votre rôle ne permet pas cette action."]);
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("form", { name: "Ajouter une liaison" })).toHaveCount(0);
  await expect(page.getByText(RAPPEL)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Navigation principale" }).getByRole("listitem").filter({ hasText: "Espace & connexions" })).toHaveText("Espace & connexionsadministrateurs");
  expect(serveur.ecritures).toEqual([]);
});

test("mode local : l'espace implicite ne se gère pas, et aucun espace ne se crée", async ({ page }) => {
  await simulerIdentite(page);
  await simulerEspaces(page, { "/api/spaces": locale, "/api/spaces/local": { status: 200, body: locale.body.spaces[0] } });
  await page.goto("/#/espaces/local/membres");
  await expect(page.getByRole("heading", { level: 1, name: "Membres et rôles" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "mode local" })).toContainText("ses membres ne se gèrent pas");
  await expect(page.getByRole("navigation", { name: "Navigation principale" }).getByRole("listitem").filter({ hasText: "Espace & connexions" })).toHaveText("Espace & connexionsmode local");
  await page.goto("/#/nouvel-espace");
  await expect(page.getByText("En mode local, Board n'a qu'un espace implicite : on n'en crée pas d'autre.")).toBeVisible();
  expect(lectures.filter((chemin) => chemin.includes("/members") || chemin.includes("/events") || chemin.startsWith("/api/people"))).toEqual([]);
});

for (const largeur of [390, 768, 1280]) {
  for (const etat of ["membres", "confirmation", "création"] as const) {
    test(`aucun défilement horizontal de page, ${etat} à ${largeur} px`, async ({ page }) => {
      await page.setViewportSize({ width: largeur, height: 900 });
      if (etat === "création") {
        await simuler(page, new Serveur());
        await page.goto("/#/nouvel-espace");
        await page.getByRole("button", { name: "Créer l'espace" }).click();
        await expect(page.getByText("Le nom est obligatoire.")).toBeVisible();
      } else {
        await ouvrirMembres(page);
        if (etat === "confirmation") {
          await ligne(page, /Dominique Leroy/).getByRole("combobox").selectOption("admin");
          await expect(ligne(page, /Dominique Leroy/).getByRole("button", { name: "Confirmer" })).toBeFocused();
        }
      }
      await expect.poll(() => page.evaluate(() => document.documentElement.clientWidth)).toBe(largeur);
      await expect.poll(() => debordement(page)).toBeLessThanOrEqual(0);
    });
  }
}

test("à 390 px, le bouton de confirmation est visible sans défilement de page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ouvrirMembres(page);
  await ligne(page, /Dominique Leroy/).getByRole("button", { name: "Retirer Dominique Leroy" }).click();
  const bouton = ligne(page, /Dominique Leroy/).getByRole("button", { name: "Retirer", exact: true });
  await expect(bouton).toBeFocused();
  await expect(bouton).toBeInViewport();
});

for (const etat of ["membres", "confirmation", "dernier administrateur", "création", "accès refusé", "mode local"] as const) {
  test(`axe sur la page entière, contraste compris : ${etat}`, async ({ page }) => {
    if (etat === "création") {
      await simuler(page, new Serveur());
      await page.goto("/#/nouvel-espace");
      await page.getByRole("button", { name: "Créer l'espace" }).click();
      await expect(page.getByText("Le nom est obligatoire.")).toBeVisible();
    } else if (etat === "accès refusé") {
      await simuler(page, new Serveur(), { "/api/spaces": liste, "/api/spaces/finance": { status: 200, body: { ...espace.body, role: "creator" } }, "GET /api/spaces/finance/members": interdit, "GET /api/spaces/finance/events": interdit });
      await page.goto("/#/espaces/finance/membres");
      await expect(page.getByRole("alert")).toHaveCount(2);
    } else if (etat === "mode local") {
      await simulerIdentite(page);
      await simulerEspaces(page, { "/api/spaces": locale, "/api/spaces/local": { status: 200, body: locale.body.spaces[0] } });
      await page.goto("/#/espaces/local/membres");
      await expect(page.getByRole("status").filter({ hasText: "mode local" })).toBeVisible();
    } else {
      await ouvrirMembres(page);
      if (etat === "confirmation") await ligne(page, /Dominique Leroy/).getByRole("combobox").selectOption("admin");
      if (etat === "dernier administrateur") {
        await ligne(page, /Groupe finance-admins/).getByRole("button", { name: "Retirer Groupe finance-admins" }).click();
        await ligne(page, /Groupe finance-admins/).getByRole("button", { name: "Retirer", exact: true }).click();
        await expect(page.getByRole("alert")).toBeVisible();
        await expect(page.getByRole("table", { name: "Liaisons de l'espace" })).toBeVisible();
      }
    }
    await polices(page);
    const resultat = await new AxeBuilder({ page }).options({ rules: { "color-contrast": { enabled: true } } }).analyze();
    expect(resultat.violations.map((violation) => violation.id), `Règles axe en échec : ${etat}`).toEqual([]);
  });
}

test("capture de référence de « Membres et rôles »", async ({ page }) => {
  await ouvrirMembres(page);
  await expect(page).toHaveScreenshot("membres-espace.png", { fullPage: true });
});

test("capture de référence d'un changement de rôle en attente de confirmation", async ({ page }) => {
  await ouvrirMembres(page);
  await ligne(page, /Dominique Leroy/).getByRole("combobox").selectOption("admin");
  await expect(ligne(page, /Dominique Leroy/).getByRole("button", { name: "Confirmer" })).toBeFocused();
  await expect(page).toHaveScreenshot("membres-confirmation.png", { fullPage: true });
});

test("capture de référence du refus du dernier administrateur", async ({ page }) => {
  await ouvrirMembres(page);
  await ligne(page, /Groupe finance-admins/).getByRole("button", { name: "Retirer Groupe finance-admins" }).click();
  await ligne(page, /Groupe finance-admins/).getByRole("button", { name: "Retirer", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("table", { name: "Liaisons de l'espace" })).toBeVisible();
  await polices(page);
  await expect(page).toHaveScreenshot("membres-dernier-administrateur.png", { fullPage: true });
});

test("capture de référence de la création d'un espace", async ({ page }) => {
  await simuler(page, new Serveur());
  await page.goto("/#/nouvel-espace");
  await page.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(page.getByText("Le nom est obligatoire.")).toBeVisible();
  await polices(page);
  await expect(page).toHaveScreenshot("nouvel-espace.png", { fullPage: true });
});
