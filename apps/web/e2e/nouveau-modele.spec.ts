import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { choisirTheme } from "./aides";
import { choisirContenus, COMPONENT, MODEL, scenarioNouveau, THEME } from "./serveur-nouveau-contenu";

test("crée depuis un modèle, remplit et enregistre", async ({ page }, testInfo) => {
  const server = await scenarioNouveau(page, { slots: 2 });
  for (const base of ["Skifer clair", "Skifer ardoise"]) {
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("dialog").getByRole("button", { name: "Annuler" }).click(); await choisirTheme(page, base); await page.getByRole("button", { name: "Nouveau dashboard" }).click();
  }
  await choisirContenus(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: `e2e/__screenshots__/nouveau-modele.spec.ts/dialogue-${testInfo.project.name}-${process.platform}.png`, animations: "disabled" });
  await expect(page.getByRole("dialog").getByText("Le dashboard sera créé au premier enregistrement, une fois les emplacements remplis.")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Ouvrir le brouillon" }).click();
  await expect(page.getByText("Brouillon local, jamais enregistré").first()).toBeVisible();
  await expect(page.getByText("Issu du modèle Exemple · r1")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Fil d'Ariane" }).getByRole("listitem")).toHaveText(["Finance", "Dashboards", "Éditeur"]);
  expect(server.journal.creations).toHaveLength(0); await expect(page.getByRole("link", { name: "Historique des révisions" })).toHaveCount(0);
  await page.screenshot({ path: `e2e/__screenshots__/nouveau-modele.spec.ts/brouillon-${testInfo.project.name}-${process.platform}.png`, fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Retour aux dashboards" }).click();
  await expect(page.getByRole("dialog", { name: "Quitter sans enregistrer ?" })).toBeVisible(); await page.getByRole("button", { name: "Rester" }).click();
  const slots = page.locator(".sb-node--slot");
  await slots.first().getByRole("button", { name: /Remplir l.emplacement/ }).click(); await page.getByRole("button", { name: "Choisir une analyse" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Ventes · Partagée/ }).click(); await page.getByRole("dialog").getByRole("button", { name: "Remplir", exact: true }).click();
  expect(server.journal.creations).toHaveLength(0);
  await slots.first().getByRole("button", { name: /Remplir l.emplacement/ }).click(); await page.getByRole("dialog").getByRole("button", { name: "Ventes communes · r1" }).click();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("link", { name: "Historique des révisions" })).toBeVisible();
  await expect(page.getByText("Issu du modèle Exemple · r1")).toBeVisible();
  expect(server.journal.creations).toHaveLength(1);
  expect(server.journal.creations[0]).toMatchObject({ template: { template_id: MODEL, revision: 1 }, theme: { theme_id: THEME, revision: 1 }, layout: { sections: [{ rows: [{ columns: [{ children: [{ type: "analysis" }, { type: "component", component: { component_id: COMPONENT, revision: 1 } }] }] }] }] } });
  expect(server.journal.inattendues).toEqual([]);
});

test("signale un brouillon devenu interdit", async ({ page }) => {
  await scenarioNouveau(page, { draft: true }); await choisirContenus(page, false);
  const dialog = page.getByRole("dialog"); await dialog.getByRole("radio", { name: "Partagé" }).check();
  await expect(dialog.getByText(/Un brouillon ne peut pas/)).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Modèle de page" })).toHaveValue(`${MODEL}:1`);
  await expect(dialog.getByRole("button", { name: "Ouvrir le brouillon" })).toBeDisabled();
  await dialog.getByRole("combobox", { name: "Modèle de page" }).selectOption(""); await expect(dialog.getByRole("button", { name: "Créer et ouvrir" })).toBeEnabled();
});

test("une liste en erreur permet la création vide", async ({ page }) => {
  const server = await scenarioNouveau(page, { themeError: true });
  const dialog = page.getByRole("dialog"); await dialog.getByRole("textbox", { name: "Nom du dashboard" }).fill("Sans thème");
  await dialog.getByRole("combobox", { name: "Thème", exact: true }).focus(); await expect(dialog.getByText(/Thèmes indisponibles/)).toBeVisible();
  await dialog.getByRole("button", { name: "Créer et ouvrir" }).click(); await expect(page.getByRole("link", { name: "Historique des révisions" })).toBeVisible(); expect(server.journal.creations).toHaveLength(1);
});

test("quitter abandonne le brouillon sans créer de dashboard", async ({ page }) => {
  const server = await scenarioNouveau(page); await choisirContenus(page, false);
  await page.getByRole("dialog").getByRole("button", { name: "Ouvrir le brouillon" }).click();
  await expect(page.getByText("Brouillon local, jamais enregistré").first()).toBeVisible();
  await page.getByRole("button", { name: "Retour aux dashboards" }).click();
  await page.getByRole("dialog", { name: "Quitter sans enregistrer ?" }).getByRole("button", { name: "Quitter sans enregistrer" }).click();
  await expect(page.getByRole("heading", { name: "Dashboards" })).toBeVisible(); expect(server.journal.creations).toHaveLength(0);
});
