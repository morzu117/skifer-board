import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { simulerIdentite } from "./aides";

test.beforeEach(async ({ page }) => {
  await simulerIdentite(page);
});

interface Exemple {
  status: number;
  body: {
    entries?: { id: string; label: string; description: string | null; synonyms: string[]; domain: string | null; owner: string | null; status: string; kind: string }[];
  };
}
function exemple(name: string): Exemple {
  return JSON.parse(readFileSync(new URL(`../../../contracts/catalogue/${name}.json`, import.meta.url), "utf8")) as Exemple;
}
/** Exemple servi pour l'historique ou l'écart d'une définition (plan 05, V6) ; `historique` en remplace l'historique. */
function exempleVersions(id: string, route: string, url: URL, historique?: string): string {
  if (route === "versions") return historique ?? ({ "revenu-net": "versions-revenu-net", commande: "versions-concept" } as Record<string, string>)[id] ?? "fiche-inconnue";
  if (id === "commande") return "ecart-concept";
  if (id !== "revenu-net") return "fiche-inconnue";
  const [base, other] = [url.searchParams.get("base"), url.searchParams.get("other")];
  if (base === null || other === null || !/^[1-9]\d*$/.test(base) || !/^[1-9]\d*$/.test(other)) return "ecart-parametre-invalide";
  if (base === other) return "ecart-identique";
  return ({ "4-5": "ecart-revenu-net", "3-5": "ecart-irresoluble" } as Record<string, string>)[`${base}-${other}`] ?? "ecart-version-inconnue";
}
async function simulerCatalogue(page: Page, state = "liste", historique?: string) {
  await page.clock.setFixedTime(new Date("2026-11-01T12:30:00Z"));
  await page.route("**/api/catalog**", async (route) => {
    const url = new URL(route.request().url());
    // La fiche lit aussi `/{id}/versions` et `/{id}/diff` (plan 05) : l'identifiant s'arrête au premier « / ».
    const [id = "", sous = ""] = url.pathname.slice("/api/catalog/".length).split("/").map(decodeURIComponent);
    const document = url.pathname !== "/api/catalog";
    const sample = exemple(!document ? state
      : sous !== "" ? exempleVersions(id, sous, url, historique)
        : ["revenu-net", "invalide", "commande"].includes(id) ? `fiche-${id}` : "fiche-inconnue");
    if (!document && sample.body.entries) {
      const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr");
      const q = normalize(url.searchParams.get("q") ?? "");
      sample.body.entries = sample.body.entries.filter((entry) =>
        normalize([entry.id, entry.label, entry.description, ...entry.synonyms].join(" ")).includes(q)
        && (["domain", "owner", "status", "kind"] as const).every((key) => !url.searchParams.has(key) || entry[key] === url.searchParams.get(key)));
    }
    await route.fulfill({ status: sample.status, json: sample.body });
  });
}
async function ouvrirFiche(page: Page) {
  const button = page.getByRole("button", { name: "Revenu net", exact: true });
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: "Revenu net" })).toBeFocused();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(button).toHaveAttribute("aria-controls", "catalogue-fiche");
  // La fiche lit ensuite son historique (plan 05, 5.3) : elle n'est complète qu'une fois les versions lues.
  await expect(page.getByRole("heading", { level: 3, name: /^Versions/ })).toBeVisible();
  await expect(page.getByText("Lecture des versions dans le clone…")).toHaveCount(0);
  return button;
}
/** Ouvre au clavier l'écart de la v4 avec la v5, le premier proposé, et attend le rapport d'Atlas. */
async function ouvrirEcart(page: Page) {
  const fiche = page.getByRole("complementary", { name: "Revenu net" });
  const v4 = fiche.getByRole("button", { name: "Écart avec la v5", exact: true }).first();
  const demande = page.waitForRequest((request) => request.url().endsWith("/api/catalog/revenu-net/diff?base=4&other=5"));
  for (let pas = 0; pas < 10 && !(await v4.evaluate((element) => element === document.activeElement)); pas += 1) await page.keyboard.press("Tab");
  await expect(v4).toBeFocused();
  await page.keyboard.press("Enter");
  await demande;
  await expect(v4).toHaveAttribute("aria-expanded", "true");
  await expect(fiche.getByText(/^2 écarts entre la v4 et la v5/)).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
  return { fiche, v4 };
}
async function ouvrirCatalogue(page: Page, state = "liste") {
  await simulerCatalogue(page, state);
  await page.goto("/#/catalogue");
  await expect(page.getByRole("heading", { level: 1, name: "Catalogue Atlas" })).toBeVisible();
  if (state === "indisponible") await expect(page.getByRole("alert")).toBeVisible();
  else await expect(page.getByRole("table")).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
}

test("navigue depuis la coque vers le catalogue puis revient par la marque", async ({ page }) => {
  await simulerCatalogue(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Catalogue Atlas", exact: true }).click();
  await expect(page).toHaveURL(/#\/catalogue$/);
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Fil d'Ariane" })).toContainText("Catalogue Atlas");
  await page.getByRole("link", { name: "Skifer Board" }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "Prototype graphique" })).toBeVisible();
});
test("recherche puis filtre les définitions avec les URL attendues", async ({ page }) => {
  await ouvrirCatalogue(page);
  const search = page.waitForRequest((request) => new URL(request.url()).searchParams.get("q") === "revenu");
  await page.getByLabel("Rechercher", { exact: true }).fill("revenu");
  await search;
  await expect(page.getByRole("button", { name: "Commande", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Revenu net", exact: true })).toBeVisible();
  const filter = page.waitForRequest((request) => new URL(request.url()).searchParams.get("domain") === "finance");
  await page.getByLabel("Domaine", { exact: true }).selectOption("finance");
  await filter;
  await expect(page.getByRole("button", { name: "Brouillon", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Revenu net", exact: true })).toBeVisible();
  await page.getByLabel("Rechercher", { exact: true }).fill("aucune correspondance");
  await expect(page.getByText("Aucune définition ne correspond à ces critères.")).toBeVisible();
});
test("ouvre au clavier et Échap rend le focus à la ligne", async ({ page }) => {
  await ouvrirCatalogue(page);
  const button = await ouvrirFiche(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute("aria-expanded", "false");
});
test("annonce la fiche absente avec le contrat 404", async ({ page }) => {
  await ouvrirCatalogue(page);
  await page.getByRole("button", { name: "Marge brute", exact: true }).click();
  await expect(page.getByRole("complementary")).toContainText("n'est plus dans l'index Atlas");
});
test("sert la liste ancienne avec bandeau, âge figé et provenance", async ({ page }) => {
  await ouvrirCatalogue(page, "liste-ancienne");
  await expect(page.getByText("Atlas indisponible", { exact: true })).toBeVisible();
  await expect(page.getByText(/Catalogue servi depuis le dernier index connu/)).toContainText("il y a 2 h (commit d7eba96)");
  await expect(page.getByRole("table")).toContainText("Non résolue");
});
test("annonce l'indisponibilité sans tableau vide", async ({ page }) => {
  await ouvrirCatalogue(page, "indisponible");
  await expect(page.getByRole("alert")).toContainText("aucun index antérieur");
  await expect(page.getByRole("table")).toHaveCount(0);
});
for (const width of [390, 768, 1280]) {
  test(`aucun défilement horizontal de page, fiche ouverte à ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await ouvrirCatalogue(page);
    await ouvrirFiche(page);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}
for (const state of ["liste", "fiche", "indisponible"]) {
  test(`axe sur la page entière, contraste compris : ${state}`, async ({ page }) => {
    await ouvrirCatalogue(page, state === "fiche" ? "liste" : state);
    if (state === "fiche") await ouvrirFiche(page);
    const result = await new AxeBuilder({ page }).options({ rules: { "color-contrast": { enabled: true } } }).analyze();
    expect(result.violations, "Violations axe sur toute la page du catalogue").toEqual([]);
  });
}
test("capture de référence de la liste avec fiche ouverte", async ({ page }) => {
  await ouvrirCatalogue(page);
  await ouvrirFiche(page);
  await expect(page).toHaveScreenshot("catalogue-fiche.png", { fullPage: true });
});
test("capture de référence du catalogue ancien", async ({ page }) => {
  await ouvrirCatalogue(page, "liste-ancienne");
  await expect(page).toHaveScreenshot("catalogue-ancien.png", { fullPage: true });
});
test("lit l'historique de la fiche et ouvre l'écart au clavier", async ({ page }) => {
  await ouvrirCatalogue(page);
  await ouvrirFiche(page);
  const versions = page.getByRole("region", { name: "Versions · 3" });
  const lignes = versions.getByRole("listitem").filter({ hasText: /^v\d/ });
  await expect(lignes).toHaveCount(3);
  await expect(lignes.nth(0)).toContainText("v5 Courante · Revenu net v5");
  await expect(lignes.nth(1)).toContainText("v4 · Revenu net v4");
  await expect(lignes.nth(2)).toContainText("v3 · Revenu net v3");
  await expect(lignes.nth(0)).toContainText("Tests catalogue · 01/11/2026 21:38 UTC · commit e4f30c9");
  await expect(lignes.nth(0).getByRole("button")).toHaveCount(0);
  await expect(versions).toContainText("Versions lues dans le clone au commit e4f30c9, le 01/11/2026 10:30 UTC.");
  const { fiche, v4 } = await ouvrirEcart(page);
  const panneau = page.locator(`#${await v4.getAttribute("aria-controls") ?? "absent"}`);
  await expect(panneau).toBeVisible();
  await expect(panneau).toContainText("Critique 0 · Attention 1 · Information 1");
  const ecarts = panneau.locator(".sb-catalogue__diff > ul > li");
  await expect(ecarts).toHaveCount(2);
  await expect(ecarts.nth(0)).toContainText("Information Filtre « Factures validées » : label modifié(s). Sans effet sur le résultat.");
  await expect(ecarts.nth(0)).toContainText("label : Factures validées → Factures émises");
  await expect(ecarts.nth(1)).toContainText("Attention Calcul « déduction des taxes » : expr modifié(s).");
  await expect(ecarts.nth(1)).toContainText("expr : montant_ttc - montant_taxes - avoirs → montant_ttc - montant_taxes");
  await expect(panneau).toContainText("Empreintes Atlas : v4 sha256:atlas1:a248");
  await page.keyboard.press("Enter");
  await expect(v4).toHaveAttribute("aria-expanded", "false");
  await expect(fiche.getByText(/écarts entre/)).toHaveCount(0);
});
test("dit le refus d'Atlas pour une version qui ne se résout pas", async ({ page }) => {
  await ouvrirCatalogue(page);
  await ouvrirFiche(page);
  await page.getByRole("button", { name: "Écart avec la v5", exact: true }).last().click();
  await expect(page.getByRole("complementary")).toContainText("Écart indisponible : La version 3 de « revenu-net » n'est pas un document valide.");
});
test("annonce l'historique indisponible et garde la fiche", async ({ page }) => {
  await simulerCatalogue(page, "liste", "versions-indisponible");
  await page.goto("/#/catalogue");
  await page.getByRole("button", { name: "Revenu net", exact: true }).click();
  const fiche = page.getByRole("complementary", { name: "Revenu net" });
  await expect(fiche).toContainText("Historique indisponible : le clone de l'espace est introuvable. Les versions ne sont lues que dans un clone relu.");
  await expect(fiche).toContainText("Le clone de l'espace Atlas est introuvable à l'emplacement configuré.");
  await expect(fiche).toContainText("Déclinaisons · 2");
  await expect(fiche).toContainText("Index Atlas du commit d7eba96");
  await expect(fiche.getByRole("button", { name: /Écart avec/ })).toHaveCount(0);
});
test("ne propose aucun écart pour un concept sans version taguée", async ({ page }) => {
  await ouvrirCatalogue(page);
  await page.getByRole("button", { name: "Commande", exact: true }).click();
  const fiche = page.getByRole("complementary", { name: "Commande" });
  await expect(fiche).toContainText("Aucune version taguée dans Atlas.");
  await expect(fiche).toContainText("Sans objet : un concept n'a pas de graphe.");
  await expect(fiche.getByRole("button", { name: /Écart avec/ })).toHaveCount(0);
});
for (const width of [390, 768, 1280]) {
  test(`aucun défilement horizontal de page, écart ouvert à ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await ouvrirCatalogue(page);
    await ouvrirFiche(page);
    await ouvrirEcart(page);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}
test("axe sur la page entière, contraste compris : écart ouvert", async ({ page }) => {
  await ouvrirCatalogue(page);
  await ouvrirFiche(page);
  await ouvrirEcart(page);
  const result = await new AxeBuilder({ page }).options({ rules: { "color-contrast": { enabled: true } } }).analyze();
  expect(result.violations, "Violations axe sur toute la page du catalogue, écart ouvert").toEqual([]);
});
test("axe sur la page entière, contraste compris : historique indisponible", async ({ page }) => {
  await simulerCatalogue(page, "liste", "versions-indisponible");
  await page.goto("/#/catalogue");
  await page.getByRole("button", { name: "Revenu net", exact: true }).click();
  await expect(page.getByText(/Historique indisponible/)).toBeVisible();
  const result = await new AxeBuilder({ page }).options({ rules: { "color-contrast": { enabled: true } } }).analyze();
  expect(result.violations, "Violations axe, historique indisponible").toEqual([]);
});
test("capture de référence de la fiche avec l'écart ouvert", async ({ page }) => {
  await ouvrirCatalogue(page);
  await ouvrirFiche(page);
  const { v4 } = await ouvrirEcart(page);
  await v4.blur();
  await expect(page).toHaveScreenshot("catalogue-ecart.png", { fullPage: true });
});
