import { mkdir, writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { choisirTheme } from "./aides";
import { servirThemes } from "./serveur-themes";

const journaux: { inattendues: string[] }[] = [];
test.afterEach(() => { for (const journal of journaux.splice(0)) expect(journal.inattendues).toEqual([]); });
async function servir(...args: Parameters<typeof servirThemes>) {
  const journal = await servirThemes(...args);
  journaux.push(journal);
  return journal;
}

test("liste les thèmes et rend les consommateurs indisponibles sans inventer zéro", async ({ page }) => {
  const serveur = await servir(page, { role: "creator", consumersFail: true });
  await page.goto("/#/espaces/finance/themes");
  await expect(page.getByRole("heading", { name: "Thèmes", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Clair" })).toBeVisible();
  await expect(page.getByText(/indisponible :/)).toBeVisible();
  for (const theme of ["Skifer clair", "Skifer ardoise"]) {
    await choisirTheme(page, theme);
    const report = await new AxeBuilder({ page }).analyze();
    expect(report.violations).toEqual([]);
  }
  expect(serveur.inattendues).toEqual([]);
});

test("la liste vide et les contenus illisibles ont des états distincts", async ({ page }) => {
  await servir(page, { empty: true, unreadable: true });
  await page.goto("/#/espaces/finance/themes");
  await expect(page.getByText(/illisible/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Aucun thème à afficher" })).toHaveCount(0);
});

test("une liste vide sans contenu illisible l'indique", async ({ page }) => {
  await servir(page, { empty: true });
  await page.goto("/#/espaces/finance/themes");
  await expect(page.getByRole("heading", { name: "Aucun thème à afficher" })).toBeVisible();
});

test("compte les dashboards consommateurs dans la liste", async ({ page }) => {
  await servir(page);
  await page.goto("/#/espaces/finance/themes");
  await expect(page.getByRole("row", { name: /Clair/ }).locator("td").last()).toHaveText("1");
});

test("affiche le refus de la liste", async ({ page }) => {
  await servir(page, { forbidden: true });
  await page.goto("/#/espaces/finance/themes");
  await expect(page.getByText(/Thèmes indisponibles : Accès refusé/)).toBeVisible();
});

for (const options of [{ role: "reader" as const, reason: "sans rôle" }, { local: true, reason: "mode local" }]) test(`ferme l'entrée : ${options.reason}`, async ({ page }) => {
  await servir(page, options);
  await page.goto("/#/espaces/finance/themes");
  await expect(page.getByText(`Thèmes indisponibles : ${options.reason}.`)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Navigation principale" }).getByText("Thèmes")).toContainText(options.reason);
});

test("ouvre et modifie le nouveau thème sous les deux bases", async ({ page }) => {
  await servir(page);
  await page.goto("/#/espaces/finance/themes");
  await page.getByRole("button", { name: "Nouveau thème" }).click();
  await expect(page.getByRole("heading", { name: "Éditeur de thème" })).toBeVisible();
  const nom = page.getByRole("textbox", { name: "Nom", exact: true });
  await nom.fill("");
  await expect(page.getByText("Nom requis.")).toBeVisible();
  await nom.fill("Mon thème");
  await expect(page.getByText("Nom requis.")).toHaveCount(0);
  const serie = page.getByRole("combobox", { name: "Série", exact: true });
  await expect(serie.getByRole("option", { name: /^surface ·/ })).toHaveCount(0);
  await serie.selectOption("ink");
  for (const base of ["skifer-clair", "skifer-ardoise"]) {
    await page.getByRole("combobox", { name: /^Base/ }).selectOption(base);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
});

test("crée, annule, rétablit, enregistre et recharge après un conflit", async ({ page }) => {
  const serveur = await servir(page);
  await page.goto("/#/espaces/finance/themes/nouveau");
  const nom = page.getByRole("textbox", { name: "Nom" });
  await nom.fill("Mon thème");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page).toHaveURL(/themes\/00000000-0000-4000-8000-000000000001/);
  await expect(nom).toHaveValue("Mon thème");
  const serie = page.getByRole("combobox", { name: "Série", exact: true });
  await serie.selectOption("ink");
  await page.getByRole("button", { name: "Annuler", exact: true }).focus();
  await page.keyboard.press("Control+z");
  await expect(serie).toHaveValue("blue");
  await page.keyboard.press("Control+Shift+z");
  await expect(serie).toHaveValue("ink");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText(/Révision r2 enregistrée en brouillon/)).toBeVisible();
  await serie.selectOption("blue");
  serveur.conflictOnNextSave();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText(/Conflit de révision/)).toBeVisible();
  await expect(serie).toHaveValue("blue");
  await page.getByRole("button", { name: "Recharger" }).click();
  await expect(serie).toHaveValue("ink");
});

test("la garde retient la sortie et permet de rester ou de quitter", async ({ page }) => {
  await servir(page);
  await page.goto("/#/espaces/finance/themes/nouveau");
  await page.getByRole("textbox", { name: "Nom" }).fill("À garder");
  await page.getByRole("link", { name: "Retour à la liste des thèmes" }).click();
  const dialogue = page.getByRole("dialog", { name: "Quitter sans enregistrer ?" });
  await expect(dialogue).toBeVisible();
  await dialogue.getByRole("button", { name: "Rester" }).click();
  await expect(page.getByRole("textbox", { name: "Nom" })).toHaveValue("À garder");
  await page.getByRole("link", { name: "Retour à la liste des thèmes" }).click();
  await dialogue.getByRole("button", { name: "Quitter sans enregistrer" }).click();
  await expect(page.getByRole("heading", { name: "Thèmes", exact: true, level: 1 })).toBeVisible();
});

test("utilise l’éditeur au clavier seul", async ({ page }) => {
  await servir(page);
  await page.goto("/#/espaces/finance/themes/nouveau");
  const nom = page.getByRole("textbox", { name: "Nom", exact: true });
  for (let i = 0; i < 50 && !(await nom.evaluate((element) => element === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(nom).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.type("x");
  const edited = await nom.inputValue();
  expect(edited).not.toBe("Skifer clair");
  const annuler = page.getByRole("button", { name: "Annuler", exact: true });
  for (let i = 0; i < 10 && !(await annuler.evaluate((element) => element === document.activeElement)); i++) await page.keyboard.press("Shift+Tab");
  await expect(annuler).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(nom).toHaveValue("Skifer clair");
  await page.keyboard.press("Control+y");
  await expect(nom).toHaveValue(edited);
});

test("l’aperçu suit la série et disparaît quand le thème est invalide", async ({ page }) => {
  await servir(page);
  await page.goto("/#/espaces/finance/themes/nouveau");
  const preview = page.getByRole("region", { name: "Aperçu du thème" });
  const grid = preview.locator("[data-series-token]");
  await expect(grid).toHaveAttribute("data-series-token", "blue");
  await page.getByRole("combobox", { name: "Série", exact: true }).selectOption("ink");
  await expect(grid).toHaveAttribute("data-series-token", "ink");
  await page.getByRole("textbox", { name: "Nom", exact: true }).fill("");
  await expect(preview.getByText(/Aperçu indisponible/)).toBeVisible();
  await expect(grid).toHaveCount(0);
  await preview.getByRole("button", { name: "Voir la liste des problèmes" }).click();
  await expect(page.locator("#theme-problemes")).toBeFocused();
});

test("consulte l’historique et une révision en lecture seule", async ({ page }) => {
  await servir(page);
  await page.goto("/#/espaces/finance/themes/nouveau");
  await page.getByRole("textbox", { name: "Nom", exact: true }).fill("Premier");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("link", { name: "Historique des révisions" })).toBeVisible();
  await page.getByRole("textbox", { name: "Nom", exact: true }).fill("Deuxième");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText(/Révision r2 enregistrée/)).toBeVisible();
  await page.getByRole("link", { name: "Historique des révisions" }).click();
  await expect(page.getByRole("heading", { name: "Historique du thème" })).toBeVisible();
  await page.getByRole("link", { name: "Lire la révision 1" }).click();
  await expect(page.getByText(/Révision r1 en lecture seule/)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Nom", exact: true })).toHaveValue("Premier");
  await expect(page.getByRole("textbox", { name: "Nom", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Enregistrer" })).toHaveCount(0);
});

test("un administrateur examine le diff puis approuve", async ({ page }) => {
  await servir(page, { role: "admin", previous: true });
  await page.goto("/#/espaces/finance/themes/00000000-0000-4000-8000-000000000001");
  const approval = page.getByRole("region", { name: "Approbation du thème" });
  await expect(approval.getByRole("table")).toContainText("/roles/marks/series");
  await expect(approval.getByRole("table")).toContainText("Modifié");
  const box = await approval.boundingBox();
  const button = await approval.getByRole("button", { name: "Approuver" }).boundingBox();
  if (box === null || button === null) throw new Error("Approbation inaccessible");
  if (page.viewportSize()?.width === 1280) { expect(button.width).toBeLessThan(box.width / 2); expect(box.x + box.width - (button.x + button.width)).toBeLessThan(32); }
  for (const theme of ["Skifer clair", "Skifer ardoise"]) {
    await choisirTheme(page, theme);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  await approval.getByRole("button", { name: "Approuver" }).click();
  await expect(page.getByText("Approuvé r2")).toBeVisible();
  await expect(page.getByRole("region", { name: "Approbation du thème" })).toHaveCount(0);
  await page.getByRole("link", { name: "Retour à la liste des thèmes" }).click();
  await expect(page.getByRole("row", { name: /Révisé/ })).toContainText("Approuvé · r2");
});

test("la première approbation présente le document", async ({ page }) => {
  await servir(page, { role: "admin" });
  await page.goto("/#/espaces/finance/themes/00000000-0000-4000-8000-000000000001");
  await expect(page.getByRole("heading", { name: "Première approbation" })).toBeVisible();
  await page.getByRole("button", { name: "Approuver" }).click();
  await expect(page.getByText("Approuvé r1")).toBeVisible();
});

test("un conflit d’approbation invalide le diff", async ({ page }) => {
  await servir(page, { previous: true, approvalConflict: true });
  await page.goto("/#/espaces/finance/themes/00000000-0000-4000-8000-000000000001");
  const region = page.getByRole("region", { name: "Approbation du thème" });
  await expect(region.getByRole("table")).toBeVisible();
  await region.getByRole("button", { name: "Approuver" }).click();
  await expect(region.getByText(/Conflit de révision/)).toBeVisible();
  await expect(region.getByRole("table")).toHaveCount(0);
  await expect(region.getByRole("button", { name: "Approuver" })).toBeDisabled();
});

test("la suppression d’un thème utilisé montre ses consommateurs", async ({ page }) => {
  await servir(page, { used: true });
  await page.goto("/#/espaces/finance/themes/00000000-0000-4000-8000-000000000001");
  await page.getByRole("button", { name: "Supprimer le thème" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmer la suppression" }).click();
  await expect(page.getByRole("link", { name: /Dashboard 00000000/ })).toHaveAttribute("href", /dashboards\/00000000/);
  await expect(page.getByText("et 2 autres dashboards que vous ne voyez pas")).toBeVisible();
});

test("supprime après confirmation et retourne à la liste", async ({ page }) => {
  await servir(page);
  await page.goto("/#/espaces/finance/themes/00000000-0000-4000-8000-000000000001");
  await page.getByRole("button", { name: "Supprimer le thème" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmer la suppression" }).click();
  await expect(page.getByRole("heading", { name: "Aucun thème à afficher" })).toBeVisible();
});

test("un créateur ne voit pas l’approbation", async ({ page }) => {
  await servir(page, { role: "creator", previous: true });
  await page.goto("/#/espaces/finance/themes/00000000-0000-4000-8000-000000000001");
  await expect(page.getByRole("heading", { name: "Éditeur de thème" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Approbation du thème" })).toHaveCount(0);
});

test("captures de la liste, de l’éditeur et du diff", async ({ page }, testInfo) => {
  await servir(page, { previous: true });
  if (testInfo.project.name === "telephone") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  }
  const path = (name: string) => `e2e/__screenshots__/themes.spec.ts/${name}-${testInfo.project.name}-${process.platform}.png`;
  await page.goto("/#/espaces/finance/themes");
  await expect(page.getByRole("row", { name: /Révisé/ })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path("liste"), fullPage: true, animations: "disabled" });
  await page.getByRole("link", { name: "Révisé" }).click();
  const approval = page.getByRole("region", { name: "Approbation du thème" });
  await expect(approval.getByRole("table")).toBeVisible();
  const box = await approval.boundingBox();
  if (box === null) throw new Error("Carte d’approbation absente");
  const scrollY = await page.evaluate(() => window.scrollY);
  const width = page.viewportSize()?.width ?? 1280;
  const capture = await page.context().newCDPSession(page);
  const result = await capture.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.ceil(box.y + scrollY + box.height + 24), scale: 1 } });
  await mkdir("e2e/__screenshots__/themes.spec.ts", { recursive: true });
  await writeFile(path("approbation"), Buffer.from(result.data, "base64"));
  await capture.detach();
  await expect(page.getByRole("region", { name: "Aperçu du thème" }).locator(".sb-chart-focus > [role=img]")).toHaveCount(3);
  await page.screenshot({ path: path("editeur"), fullPage: true, animations: "disabled" });
  if (testInfo.project.name === "ordinateur") {
    const preview = page.getByRole("region", { name: "Aperçu du thème" });
    const original = await preview.getAttribute("style");
    await preview.evaluate((element) => { element.style.maxHeight = "none"; element.style.overflowY = "visible"; element.style.position = "static"; });
    await preview.screenshot({ path: path("apercu"), animations: "disabled" });
    await preview.evaluate((element, style) => { if (style === null) element.removeAttribute("style"); else element.setAttribute("style", style); }, original);
  }
});

test("l’aperçu se parcourt au clavier et la légende reste séparée de l’axe", async ({ page }, testInfo) => {
  await servir(page, { previous: true });
  await page.goto("/#/espaces/finance/themes/00000000-0000-4000-8000-000000000001");
  const preview = page.getByRole("region", { name: "Aperçu du thème" });
  await expect(preview.getByText("1234.5")).toBeVisible();
  await expect(preview.getByRole("button", { name: "Exporter l'image" })).toHaveCount(0);
  await expect(preview.getByRole("tab", { name: "Tableau" })).toHaveCount(3);
  if (testInfo.project.name === "ordinateur") {
    await preview.focus();
    await page.keyboard.press("End");
    await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  }
  const chart = preview.getByRole("region", { name: "Barres groupées fictives" });
  await chart.scrollIntoViewIfNeeded();
  const overlap = await chart.locator("svg").first().evaluate((svg) => {
    const labels = [...svg.querySelectorAll("text")];
    const legend = labels.find((one) => one.textContent.includes("G1 fictif"));
    const axis = labels.find((one) => one.textContent.trim() === "18");
    if (!legend || !axis) return null;
    const a = legend.getBoundingClientRect(); const b = axis.getBoundingClientRect();
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  });
  expect(overlap).toBe(false);
});
