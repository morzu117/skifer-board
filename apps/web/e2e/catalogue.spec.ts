import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

interface Exemple {
  status: number;
  body: {
    entries?: { id: string; label: string; description: string | null; synonyms: string[]; domain: string | null; owner: string | null; status: string; kind: string }[];
  };
}
function exemple(name: string): Exemple {
  return JSON.parse(readFileSync(new URL(`../../../contracts/catalogue/${name}.json`, import.meta.url), "utf8")) as Exemple;
}
async function simulerCatalogue(page: Page, state = "liste") {
  await page.clock.setFixedTime(new Date("2026-11-01T12:30:00Z"));
  await page.route("**/api/catalog**", async (route) => {
    const url = new URL(route.request().url());
    const id = decodeURIComponent(url.pathname.slice("/api/catalog/".length));
    const document = url.pathname !== "/api/catalog";
    const sample = exemple(document ? (["revenu-net", "invalide", "commande"].includes(id) ? `fiche-${id}` : "fiche-inconnue") : state);
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
  return button;
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
