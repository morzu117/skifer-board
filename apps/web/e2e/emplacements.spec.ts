import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { choisirTheme } from "./aides";
import { choisirContenus, scenarioNouveau } from "./serveur-nouveau-contenu";

test("remplit un emplacement avec une analyse et un composant", async ({ page }, testInfo) => {
  const server = await scenarioNouveau(page);
  await choisirContenus(page);
  await page.getByRole("dialog", { name: "Nouveau dashboard" }).getByRole("button", { name: "Ouvrir le brouillon" }).click();
  await expect(page.getByText("Brouillon local, jamais enregistré").first()).toBeVisible();
  await expect(page.getByText("Issu du modèle Exemple · r1")).toBeVisible();
  expect(server.journal.creations).toHaveLength(0);
  await expect(page.getByText("Bloquant : emplacement vide.")).toBeVisible();
  for (const base of ["Skifer clair", "Skifer ardoise"]) {
    await choisirTheme(page, base); expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "Remplir l'emplacement Ventes", exact: true }).first().click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Ventes communes · r1", exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "Choisir une analyse" }).click();
    await expect(page.getByRole("dialog", { name: "Remplir l'emplacement Ventes avec une analyse" })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("dialog").getByRole("button", { name: "Fermer" }).click();
  }
  await choisirTheme(page, "Skifer clair");
  await page.screenshot({ path: `e2e/__screenshots__/emplacements.spec.ts/vide-${testInfo.project.name}-${process.platform}.png`, fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Remplir l'emplacement Ventes", exact: true }).first().click();
  await page.getByRole("button", { name: "Choisir une analyse" }).click();
  await page.getByRole("button", { name: /Ventes · Partagée/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remplir", exact: true }).click();
  await expect(page.locator(".sb-node--analysis")).toBeVisible();
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(page.getByText("Bloquant : emplacement vide.")).toBeVisible();
  await page.getByRole("button", { name: "Remplir l'emplacement Ventes", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Ventes communes · r1" }).click();
  await expect(page.getByText("Composant : Ventes communes r1")).toBeVisible();
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(page.getByText("Bloquant : emplacement vide.")).toBeVisible();
  await page.getByRole("button", { name: "Rétablir", exact: true }).click();
  await expect(page.getByText("Composant : Ventes communes r1")).toBeVisible();
  expect(server.journal.inattendues).toEqual([]);
});
