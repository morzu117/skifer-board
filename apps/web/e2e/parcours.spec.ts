import { expect, test, type Page } from "@playwright/test";

import { attendreGraphiques, choisirTheme, titresGraphiques } from "./aides";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Prototype graphique" })).toBeVisible();
  await attendreGraphiques(page);
});

test("la coque garde ses entrées à venir inactives et annonce DEV, TEST, PROD", async ({ page }) => {
  const navigation = page.getByRole("navigation", { name: "Navigation principale" });
  await expect(navigation.getByRole("listitem")).toHaveText([
    "Explorerà venir", "Analysesà venir", "Dashboardsà venir", "Catalogue Atlasà venir",
    "Déploiementsà venir", "Espace & connexionsà venir",
  ]);
  await expect(navigation.getByRole("link")).toHaveCount(0);
  await expect(navigation.getByRole("button", { disabled: false })).toHaveCount(0);

  const environnement = page.getByRole("group", { name: "Environnement", exact: true });
  await expect(environnement.getByRole("button")).toHaveText(["DEV", "TEST", "PROD"]);
  await expect(environnement.getByRole("button", { pressed: true })).toHaveText("DEV");
  for (const nom of ["TEST", "PROD", "DEV"]) {
    await environnement.getByRole("button", { name: nom, exact: true }).click();
    await expect(environnement.getByRole("button", { pressed: true })).toHaveText(nom);
    await expect(environnement.getByRole("button", { pressed: false })).toHaveCount(2);
  }
});

test("les valeurs des KPI et de tous les tableaux restent identiques sous les deux thèmes", async ({ page }) => {
  // On expose toutes les alternatives pour comparer leurs cellules réellement affichées.
  for (const titre of titresGraphiques) {
    await page.getByRole("region", { name: titre, exact: true }).getByRole("tab", { name: "Tableau", exact: true }).click();
  }
  const indicateurs = page.getByRole("region", { name: "Indicateurs" }).getByRole("group");
  const cellules = page.getByRole("table").getByRole("cell");
  await expect(indicateurs).toHaveCount(3);
  await expect(page.getByRole("table")).toHaveCount(5);
  const kpiAvant = await indicateurs.allTextContents();
  const cellulesAvant = await cellules.allTextContents();
  expect(cellulesAvant.length).toBeGreaterThan(0);
  for (const nom of ["Skifer ardoise", "Skifer clair"]) {
    await choisirTheme(page, nom);
    await expect(indicateurs).toHaveText(kpiAvant);
    await expect(cellules).toHaveText(cellulesAvant);
  }
});

const detail = (page: Page) => page.getByRole("region", { name: "Détail des régions", exact: true });
const lignes = (page: Page) => detail(page).getByRole("row").filter({ has: page.getByRole("cell") });

async function verifierSelection(page: Page, regions: string[]): Promise<void> {
  await expect(lignes(page)).toHaveCount(regions.length);
  for (const region of regions) {
    await expect(detail(page).getByRole("cell", { name: region, exact: true })).toBeVisible();
  }
  await expect(detail(page)).toContainText("Filtré par la sélection du graphique.");
  const barre = page.getByRole("region", { name: "Sélection", exact: true });
  await expect(barre).toContainText(`${regions.length} ${regions.length === 1 ? "région sélectionnée" : "régions sélectionnées"}`);
  await expect(barre).toContainText("Total de la sélection : non disponible");
}

test("un clic sur une barre filtre les régions et Tout désélectionner restaure les données", async ({ page }) => {
  await expect(lignes(page)).toHaveCount(13);
  const avant = await lignes(page).allTextContents();
  const graphique = page.getByRole("group", { name: "CA net par région", exact: true });
  const svg = graphique.getByRole("img").locator("svg");
  await svg.scrollIntoViewIfNeeded();
  const taille = await svg.boundingBox();
  expect(taille, "Le SVG de l'histogramme doit avoir une taille mesurable").not.toBeNull();
  if (taille === null) throw new Error("SVG de l'histogramme absent");
  // Clic souris réel, sans dispatchAction ni événement synthétique. barsOption définit
  // une grille gauche=120, droite=64, haut=8, bas=28 et 13 bandes, première en haut.
  // À 10 % de la largeur utile, on est à l'intérieur de la première barre (Île-de-France).
  // Le SVG n'expose pas de rôle par barre : la position est donc l'exception nécessaire.
  expect(taille.width).toBeGreaterThan(184);
  await svg.click({ position: { x: 120 + (taille.width - 184) * 0.1, y: 8 + (taille.height - 36) / 26 } });
  await verifierSelection(page, ["Île-de-France"]);
  await page.getByRole("button", { name: "Tout désélectionner", exact: true }).click();
  await expect(lignes(page)).toHaveText(avant);
  await expect(page.getByRole("region", { name: "Sélection", exact: true })).toHaveCount(0);
  await expect(detail(page)).toContainText("Toutes les régions");
});

test("les flèches et Entrée sélectionnent plusieurs régions, Échap restaure tout", async ({ page }) => {
  await expect(lignes(page)).toHaveCount(13);
  const avant = await lignes(page).allTextContents();
  const graphique = page.getByRole("group", { name: "CA net par région", exact: true });
  await graphique.focus();
  await expect(graphique).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await verifierSelection(page, ["Île-de-France"]);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await verifierSelection(page, ["Île-de-France", "Auvergne-Rhône-Alpes"]);
  await page.keyboard.press("Escape");
  await expect(lignes(page)).toHaveText(avant);
  await expect(page.getByRole("region", { name: "Sélection", exact: true })).toHaveCount(0);
  await expect(detail(page)).toContainText("Toutes les régions");
});

for (const titre of titresGraphiques) {
  test(`les flèches changent les panneaux et l'état de l'export : ${titre}`, async ({ page }) => {
    const carte = page.getByRole("region", { name: titre, exact: true });
    const graphique = carte.getByRole("tab", { name: "Graphique", exact: true });
    const tableau = carte.getByRole("tab", { name: "Tableau", exact: true });
    const exporter = carte.getByRole("button", { name: "Exporter l'image", exact: true });
    await expect(exporter).toBeEnabled();
    await graphique.focus();
    await page.keyboard.press("ArrowRight");
    await expect(tableau).toHaveAttribute("aria-selected", "true");
    await expect(graphique).toHaveAttribute("aria-selected", "false");
    await expect(carte.getByRole("tabpanel", { name: "Tableau", exact: true })).toBeVisible();
    await expect(carte.getByRole("tabpanel", { name: "Graphique", exact: true })).toBeHidden();
    await expect(exporter).toBeDisabled();
    await page.keyboard.press("ArrowLeft");
    await expect(graphique).toHaveAttribute("aria-selected", "true");
    await expect(tableau).toHaveAttribute("aria-selected", "false");
    await expect(carte.getByRole("tabpanel", { name: "Graphique", exact: true })).toBeVisible();
    await expect(carte.getByRole("tabpanel", { name: "Tableau", exact: true })).toBeHidden();
    await expect(exporter).toBeEnabled();
  });
}

for (const largeur of [390, 768, 1280]) {
  test(`la page ne déborde pas horizontalement à ${largeur} px`, async ({ page }) => {
    await page.setViewportSize({ width: largeur, height: 900 });
    await attendreGraphiques(page);
    await expect.poll(() => page.evaluate(() => document.documentElement.clientWidth)).toBe(largeur);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}
