import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import catalogue from "../../../contracts/catalogue/liste.json" with { type: "json" };
import espace from "../../../contracts/espaces/espace.json" with { type: "json" };
import administration from "../../../contracts/espaces/liste-administration.json" with { type: "json" };
import liste from "../../../contracts/espaces/liste.json" with { type: "json" };
import locale from "../../../contracts/espaces/liste-locale.json" with { type: "json" };
import absent from "../../../contracts/espaces/introuvable.json" with { type: "json" };
import etabli from "../../../contracts/identite/me-etabli.json" with { type: "json" };
import { attendreGraphiques, catalogueHorsEspace, enregistrerLectures, simulerEspaces, simulerIdentite, type Exemple } from "./aides";

// Espaces dans la coque (plan 08, 8.3) : accueil, sélecteur, espace introuvable, prototype hors espace.
// Les deux projets de playwright.config.ts exécutent tous ces parcours : ordinateur et téléphone.

let lectures: string[] = [];
test.beforeEach(async ({ page }) => {
  await simulerIdentite(page, etabli);
  lectures = enregistrerLectures(page);
  await page.clock.setFixedTime(new Date("2026-11-02T12:30:00Z"));
});
test.afterEach(() => {
  expect(catalogueHorsEspace(lectures), "Aucune lecture de /api/catalog sans espace").toEqual([]);
});

/** Catalogue servi pour un espace : l'exemple de liste, quelle que soit la requête. */
async function simulerCatalogue(page: Page, espaceId: string, exemple: Exemple = catalogue): Promise<void> {
  await page.route(`**/api/spaces/${espaceId}/catalog**`, async (route) => {
    await route.fulfill({ status: exemple.status, json: exemple.body });
  });
}
async function polices(page: Page) {
  await page.evaluate(async () => { await document.fonts.ready; });
}
async function accueil(page: Page, table: Readonly<Record<string, Exemple>> = {}) {
  await simulerEspaces(page, table);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Vos espaces" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
  await polices(page);
}
async function introuvable(page: Page, id = "paie-direction") {
  await simulerEspaces(page);
  await page.goto(`/#/espaces/${id}/catalogue`);
  await expect(page.getByRole("heading", { level: 1, name: "Espace introuvable" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Espace" }).getByRole("option")).toHaveCount(3);
  await polices(page);
}
const selecteur = (page: Page) => page.getByRole("combobox", { name: "Espace" });
const pastille = (page: Page) => page.getByText(/^Rôle :/);
const debordement = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("l'accueil liste les espaces avec le rôle, le rattachement Atlas et le lien de leur catalogue", async ({ page }) => {
  await accueil(page);
  const espaces = page.getByRole("list", { name: "Espaces" }).getByRole("listitem");
  await expect(espaces).toHaveCount(2);
  await expect(espaces.nth(0)).toContainText("Créateur");
  await expect(espaces.nth(0)).toContainText("Atlas : skifer-atlas · finance");
  await expect(espaces.nth(0).getByRole("link", { name: "Finance" })).toHaveAttribute("href", "#/espaces/finance/catalogue");
  await expect(espaces.nth(1)).toContainText("Lecteur");
  await expect(espaces.nth(1).getByRole("link", { name: "Ressources humaines" })).toHaveAttribute("href", "#/espaces/rh/catalogue");
  await expect(page.getByRole("button", { name: /Créer un espace/ })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Fil d'Ariane" }).getByRole("listitem")).toHaveText(["Vos espaces"]);
  await expect(selecteur(page)).toHaveValue("");
  await expect(pastille(page)).toHaveCount(0);
  expect(lectures.filter((chemin) => chemin.startsWith("/api/spaces/"))).toEqual([]);
});

test("l'administration de la plateforme voit « Créer un espace » et son absence de rôle", async ({ page }) => {
  await accueil(page, { "/api/spaces": administration });
  // La création est livrée (plan 08, 8.4) : un lien vers sa page, et les membres de chaque espace.
  await expect(page.getByRole("link", { name: "Créer un espace" })).toHaveAttribute("href", "#/nouvel-espace");
  await expect(page.getByRole("button", { name: /Créer un espace/ })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Espaces" })).toContainText("Administration de la plateforme");
  await expect(page.getByRole("link", { name: "Membres et rôles de Finance" })).toHaveAttribute("href", "#/espaces/finance/membres");
});

test("une liste vide se distingue d'une erreur", async ({ page }) => {
  await accueil(page, { "/api/spaces": { status: 200, body: { spaces: [], platform_admin: false } } });
  await expect(page.getByRole("region", { name: "Aucun espace" })).toContainText("Vous n'êtes membre d'aucun espace.");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(selecteur(page).getByRole("option")).toHaveText(["Aucun espace"]);
});

test("une liste illisible s'annonce sans donnée", async ({ page }) => {
  await accueil(page, { "/api/spaces": { status: 500, body: {} } });
  await expect(page.getByRole("alert")).toContainText("Espaces indisponibles : Réponse inattendue du serveur (HTTP 500). Aucune donnée n'est affichée.");
  await expect(selecteur(page).getByRole("option")).toHaveText(["Espaces indisponibles"]);
});

test("le sélecteur, au clavier, ouvre le catalogue de l'espace choisi avec le rôle confirmé", async ({ page }) => {
  await simulerCatalogue(page, "rh");
  await accueil(page);
  await selecteur(page).focus();
  await selecteur(page).selectOption("rh");
  await expect(page).toHaveURL(/#\/espaces\/rh\/catalogue$/);
  await expect(page.getByRole("table")).toBeVisible();
  await expect(selecteur(page)).toHaveValue("rh");
  await expect(pastille(page)).toHaveText("Rôle : Lecteur");
  await expect(page.getByRole("navigation", { name: "Fil d'Ariane" }).getByRole("listitem")).toHaveText(["Ressources humaines", "Catalogue Atlas"]);
  // Passer à finance : le serveur y confirme « Administrateur », la liste disait « Créateur ».
  await simulerCatalogue(page, "finance");
  await selecteur(page).selectOption("finance");
  await expect(page).toHaveURL(/#\/espaces\/finance\/catalogue$/);
  await expect(pastille(page)).toHaveText("Rôle : Administrateur");
  await expect(page.getByRole("table")).toBeVisible();
  expect(lectures).toEqual(expect.arrayContaining(["/api/spaces/rh", "/api/spaces/rh/catalog", "/api/spaces/finance", "/api/spaces/finance/catalog"]));
});

test("« Espace introuvable » ne dit rien de plus et ne lit aucun catalogue", async ({ page }) => {
  await introuvable(page);
  await expect(page.getByRole("main")).toHaveText("Espace introuvableRetour à vos espaces");
  await expect(page.getByRole("link", { name: "Retour à vos espaces" })).toHaveAttribute("href", "#/");
  await expect(page.getByRole("navigation", { name: "Fil d'Ariane" }).getByRole("listitem")).toHaveText(["Espace introuvable"]);
  await expect(pastille(page)).toHaveCount(0);
  await expect(selecteur(page)).toHaveValue("");
  expect(await page.locator("body").innerText()).not.toContain("paie-direction");
  expect(lectures.filter((chemin) => chemin.includes("/catalog"))).toEqual([]);
  await page.getByRole("link", { name: "Retour à vos espaces" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Vos espaces" })).toBeVisible();
});

test("un espace inconnu et un espace refusé donnent la même page", async ({ page }) => {
  await introuvable(page, "inconnu");
  const premiere = await page.locator("body").innerText();
  await page.goto("/#/espaces/refuse/catalogue");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Espace introuvable" })).toBeVisible();
  await expect(selecteur(page).getByRole("option")).toHaveCount(3);
  expect(await page.locator("body").innerText()).toBe(premiere);
});

test("l'administration de la plateforme sans rôle ne lit pas le catalogue", async ({ page }) => {
  await simulerEspaces(page, { "/api/spaces": administration, "/api/spaces/finance": { status: 200, body: { ...espace.body, role: null } } });
  await simulerCatalogue(page, "finance");
  await page.goto("/#/espaces/finance/catalogue");
  await expect(page.getByRole("heading", { level: 1, name: "Finance" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "sans rôle dans cet espace" })).toContainText("son catalogue ne vous est pas lisible");
  await expect(pastille(page)).toHaveText("Rôle : Administration de la plateforme");
  await expect(page.getByRole("navigation", { name: "Fil d'Ariane" }).getByRole("listitem")).toHaveText(["Finance"]);
  await expect(page.getByRole("navigation", { name: "Navigation principale" }).getByRole("listitem").filter({ hasText: "Catalogue Atlas" })).toHaveText("Catalogue Atlassans rôle");
  await expect(page.getByRole("table")).toHaveCount(0);
  // Il gère les membres (E6, plan 08, 8.4) : seule cette entrée est offerte.
  await expect(page.getByRole("navigation", { name: "Navigation principale" }).getByRole("button")).toHaveText(["Espace & connexions"]);
  await expect(page.getByRole("link", { name: "Gérer les membres" })).toHaveAttribute("href", "#/espaces/finance/membres");
  expect(lectures.filter((chemin) => chemin.includes("/catalog"))).toEqual([]);
});

test("le mode local ouvre l'espace implicite « local »", async ({ page }) => {
  await simulerIdentite(page);
  await simulerEspaces(page, { "/api/spaces": locale, "/api/spaces/local": { status: 200, body: locale.body.spaces[0] } });
  await simulerCatalogue(page, "local");
  await page.goto("/");
  await page.getByRole("link", { name: "Local", exact: true }).click();
  await expect(page).toHaveURL(/#\/espaces\/local\/catalogue$/);
  await expect(page.getByRole("table")).toBeVisible();
  await expect(pastille(page)).toHaveText("Rôle : Administrateur");
  await expect(page.getByText(/Identité non établie/)).toBeVisible();
});

test("le prototype reste accessible hors espace, depuis l'accueil", async ({ page }) => {
  await accueil(page);
  await page.getByRole("link", { name: "Prototype graphique" }).click();
  await expect(page).toHaveURL(/#\/prototype$/);
  await expect(page.getByRole("heading", { level: 1, name: "Prototype graphique" })).toBeVisible();
  await attendreGraphiques(page);
  await expect(pastille(page)).toHaveCount(0);
  expect(lectures.filter((chemin) => chemin.startsWith("/api/spaces/"))).toEqual([]);
});

// Identifiants hors du format E1 : ni « . » ni « .. » (que le navigateur normalise en /api/spaces/ ou /api/),
// ni majuscules, ni 41 caractères ne sont demandés au serveur ; la page dit « Espace introuvable ».
for (const id of [".", "..", "%2e%2e", "Finance", "a".repeat(41), "-rh", "a%2Fb"]) {
  test(`un identifiant hors format (${id.length > 12 ? `${String(id.length)} caractères` : id}) s'affiche « Espace introuvable » sans lecture d'espace`, async ({ page }) => {
    // Réponse du serveur réel à /api/spaces/ : la liste, après redirection (FastAPI, redirect_slashes).
    await simulerEspaces(page, { "/api/spaces/": { status: 200, body: liste.body } });
    await page.goto(`/#/espaces/${id}/catalogue`);
    await expect(page.getByRole("heading", { level: 1, name: "Espace introuvable" })).toBeVisible();
    await expect(selecteur(page).getByRole("option")).toHaveCount(3);
    await expect(page.getByRole("main")).toHaveText("Espace introuvableRetour à vos espaces");
    expect(lectures.filter((chemin) => chemin !== "/api/me" && chemin !== "/api/spaces")).toEqual([]);
  });
}

test("le sélecteur, en tête de la barre latérale, dit la lecture puis l'indisponibilité de la liste", async ({ page }) => {
  let liberer: () => void = () => undefined;
  const attente = new Promise<void>((fin) => { liberer = fin; });
  await page.route("**/api/spaces", async (route) => {
    await attente;
    await route.fulfill({ status: 500, json: {} });
  });
  await page.goto("/#/prototype");
  const navigation = page.getByRole("navigation", { name: "Navigation principale" });
  await expect(navigation.getByRole("combobox", { name: "Espace" })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("combobox")).toHaveCount(0);
  await expect(selecteur(page).getByRole("option")).toHaveText(["Lecture des espaces…"]);
  liberer();
  await expect(selecteur(page).getByRole("option")).toHaveText(["Espaces indisponibles"]);
});

test("la liste est relue à chaque navigation : une liaison nouvelle apparaît sans recharger", async ({ page }) => {
  let servie = { status: 200, body: { ...liste.body, spaces: liste.body.spaces.slice(0, 1) } };
  await simulerEspaces(page);
  await page.route("**/api/spaces", async (route) => { await route.fulfill({ status: servie.status, json: servie.body }); });
  await simulerCatalogue(page, "finance");
  await page.goto("/");
  await expect(page.getByRole("list", { name: "Espaces" }).getByRole("listitem")).toHaveCount(1);
  expect(lectures.filter((chemin) => chemin === "/api/spaces")).toHaveLength(1);
  servie = liste;
  await page.getByRole("link", { name: "Finance", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(selecteur(page).getByRole("option")).toHaveText(["Choisir un espace", "Finance", "Ressources humaines"]);
  expect(lectures.filter((chemin) => chemin === "/api/spaces")).toHaveLength(2);
});

test("un espace retiré pendant la lecture du catalogue s'affiche « Espace introuvable » et quitte le sélecteur", async ({ page }) => {
  let retire = false;
  await page.route((url) => /^\/api\/spaces(\/[^/]*)?$/.test(url.pathname), async (route) => {
    const chemin = new URL(route.request().url()).pathname;
    const exemple: Exemple = chemin === "/api/spaces"
      ? (retire ? { status: 200, body: { ...liste.body, spaces: liste.body.spaces.slice(1) } } : liste)
      : chemin === "/api/spaces/finance" && !retire ? espace : absent;
    await route.fulfill({ status: exemple.status, json: exemple.body });
  });
  await page.route("**/api/spaces/finance/catalog**", async (route) => {
    retire = true;
    await route.fulfill({ status: absent.status, json: absent.body });
  });
  await page.goto("/#/espaces/finance/catalogue");
  await expect(page.getByRole("heading", { level: 1, name: "Espace introuvable" })).toBeVisible();
  await expect(page.getByText(/service du catalogue est introuvable/)).toHaveCount(0);
  await expect(pastille(page)).toHaveCount(0);
  await expect(selecteur(page).getByRole("option")).toHaveText(["Choisir un espace", "Ressources humaines"]);
  expect(lectures.filter((chemin) => chemin === "/api/spaces/finance/catalog")).toHaveLength(1);
});

for (const largeur of [390, 768, 1280]) {
  for (const etat of ["accueil", "introuvable"] as const) {
    test(`aucun défilement horizontal de page, ${etat} à ${largeur} px`, async ({ page }) => {
      await page.setViewportSize({ width: largeur, height: 900 });
      if (etat === "accueil") await accueil(page, { "/api/spaces": administration });
      else await introuvable(page);
      await expect.poll(() => page.evaluate(() => document.documentElement.clientWidth)).toBe(largeur);
      await expect.poll(() => debordement(page)).toBeLessThanOrEqual(0);
    });
  }
}

for (const etat of ["accueil", "administration", "introuvable", "sans rôle", "erreur d'espace"] as const) {
  test(`axe sur la page entière, contraste compris : ${etat}`, async ({ page }) => {
    if (etat === "accueil") await accueil(page);
    else if (etat === "administration") await accueil(page, { "/api/spaces": administration });
    else if (etat === "introuvable") await introuvable(page);
    else {
      await simulerEspaces(page, { "/api/spaces/finance": etat === "sans rôle" ? { status: 200, body: { ...espace.body, role: null } } : { status: 500, body: {} } });
      await page.goto("/#/espaces/finance/catalogue");
      await expect(page.getByRole("heading", { level: 1, name: etat === "sans rôle" ? "Finance" : "Espace indisponible" })).toBeVisible();
      await polices(page);
    }
    const resultat = await new AxeBuilder({ page }).options({ rules: { "color-contrast": { enabled: true } } }).analyze();
    expect(resultat.violations.map((violation) => violation.id), `Règles axe en échec : ${etat}`).toEqual([]);
    expect(resultat.violations, `Violations axe de la page entière : ${etat}`).toEqual([]);
  });
}

test("capture de référence de l'accueil des espaces", async ({ page }) => {
  await accueil(page, { "/api/spaces": { status: 200, body: { spaces: [...administration.body.spaces.map((item) => ({ ...item, role: "admin" })), ...liste.body.spaces.slice(1)], platform_admin: true } } });
  await expect(page).toHaveScreenshot("espaces-accueil.png", { fullPage: true });
});

test("capture de référence de l'espace introuvable", async ({ page }) => {
  await introuvable(page);
  await expect(page).toHaveScreenshot("espace-introuvable.png", { fullPage: true });
});
