import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { choisirTheme } from "./aides";
import { servirThemes } from "./serveur-themes";

test("navigue au clavier entre les listes et vérifie leur accessibilité", async ({ page }) => {
  const journal = await servirThemes(page, { consumersFail: true });
  await page.goto("/#/espaces/finance/themes");
  const modeles = page.getByRole("navigation", { name: "Bibliothèque de thèmes" }).getByRole("link", { name: "Modèles de page" });
  await modeles.focus(); await page.keyboard.press("Enter");
  await expect(page.getByText(/aucun dashboard n'en dépend/)).toBeVisible();
  for (const base of ["Skifer clair", "Skifer ardoise"]) { await choisirTheme(page, base); expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); }
  await page.getByRole("navigation", { name: "Bibliothèque de thèmes" }).getByRole("link", { name: "Composants" }).focus(); await page.keyboard.press("Enter");
  await expect(page.getByText(/indisponible :/)).toBeVisible();
  for (const base of ["Skifer clair", "Skifer ardoise"]) { await choisirTheme(page, base); expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); }
  expect(journal.inattendues).toEqual([]);
});
for (const segment of ["modeles", "composants"]) {
  test(`${segment} : vide et illisible`, async ({ page }) => {
    const journal = await servirThemes(page, { empty: true, unreadable: true });
    await page.goto(`/#/espaces/finance/${segment}`);
    await expect(page.getByText(/illisible/)).toBeVisible();
    expect(journal.inattendues).toEqual([]);
  });
  test(`${segment} : refus`, async ({ page }) => {
    const journal = await servirThemes(page, { forbidden: true });
    await page.goto(`/#/espaces/finance/${segment}`);
    await expect(page.getByText(/indisponibles : Accès refusé/)).toBeVisible();
    expect(journal.inattendues).toEqual([]);
  });
}

for (const segment of ["modeles", "composants"]) {
  test(`${segment} : liste vide`, async ({ page }) => {
    const journal = await servirThemes(page, { empty: true, role: "creator" });
    await page.goto(`/#/espaces/finance/${segment}`);
    await expect(page.getByRole("heading", { name: /Aucun .* à afficher/ })).toBeVisible();
    expect(journal.inattendues).toEqual([]);
  });
  for (const options of [{ role: "reader" as const, reason: "sans rôle" }, { local: true, reason: "mode local" }]) test(`${segment} : fermé en ${options.reason}`, async ({ page }) => {
    const journal = await servirThemes(page, options);
    await page.goto(`/#/espaces/finance/${segment}`);
    await expect(page.getByText(`Thèmes indisponibles : ${options.reason}.`)).toBeVisible();
    expect(journal.inattendues).toEqual([]);
  });
}
test("compte les consommateurs du composant", async ({ page }) => {
  const journal = await servirThemes(page);
  await page.goto("/#/espaces/finance/composants");
  await expect(page.getByRole("row", { name: /Exemple/ }).locator("td").last()).toHaveText("1");
  expect(journal.inattendues).toEqual([]);
});

for (const [segment, label] of [["modeles", "modèle de page"], ["composants", "composant"]] as const) {
  test(`${segment} : révise, conflit, historique et approbation`, async ({ page }) => {
    const journal = await servirThemes(page);
    await page.goto(`/#/espaces/finance/${segment}`);
    await page.getByRole("link", { name: "Exemple" }).click();
    await expect(page.getByRole("heading", { name: `Fiche du ${label}` })).toBeVisible();
    const nom = page.getByRole("textbox", { name: "Nom", exact: true });
    await nom.fill("Révisé");
    await expect(page.getByRole("button", { name: "Approuver" })).toBeDisabled();
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText(/Révision r2 enregistrée/)).toBeVisible();
    await expect(page.getByRole("region", { name: `Approbation du ${label}` }).getByRole("table")).toContainText("Nom");
    await nom.fill("Conflit"); await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText(/Conflit de révision/)).toBeVisible(); await expect(nom).toHaveValue("Conflit");
    await page.getByRole("button", { name: "Recharger", exact: true }).click(); await expect(nom).toHaveValue("Révisé");
    await page.getByRole("link", { name: "Historique des révisions" }).click();
    await page.getByRole("link", { name: "Lire la révision 1" }).click(); await expect(page.getByText(/Révision r1 en lecture seule/)).toBeVisible();
    await page.getByRole("link", { name: "Historique des révisions" }).click(); await page.getByRole("link", { name: "Retour à la fiche" }).click();
    await page.getByRole("button", { name: "Approuver" }).click(); await expect(page.getByText("Approuvé r2")).toBeVisible();
    expect(journal.inattendues).toEqual([]);
  });
  test(`${segment} : créateur et suppression`, async ({ page }) => {
    const journal = await servirThemes(page, { role: "creator", used: true });
    await page.goto(`/#/espaces/finance/${segment}/00000000-0000-4000-8000-000000000001`);
    await expect(page.getByRole("heading", { name: `Fiche du ${label}` })).toBeVisible();
    await expect(page.getByRole("region", { name: `Approbation du ${label}` })).toHaveCount(0);
    await page.getByRole("button", { name: `Supprimer le ${label}` }).click(); await page.getByRole("button", { name: "Confirmer la suppression" }).click();
    if (segment === "composants") await expect(page.getByText(/autres dashboards/)).toBeVisible();
    else await expect(page.getByRole("heading", { name: /Aucun .* à afficher/ })).toBeVisible();
    expect(journal.inattendues).toEqual([]);
  });
  test(`${segment} : suppression réussie`, async ({ page }) => {
    const journal = await servirThemes(page);
    await page.goto(`/#/espaces/finance/${segment}/00000000-0000-4000-8000-000000000001`);
    await page.getByRole("button", { name: `Supprimer le ${label}` }).click(); await page.getByRole("button", { name: "Confirmer la suppression" }).click();
    await expect(page.getByRole("heading", { name: /Aucun .* à afficher/ })).toBeVisible(); expect(journal.inattendues).toEqual([]);
  });
}

test("captures et accessibilité des listes et fiches", async ({ page }, testInfo) => {
  const journal = await servirThemes(page);
  for (const [segment, label] of [["modeles", "modèle de page"], ["composants", "composant"]] as const) {
    await page.goto(`/#/espaces/finance/${segment}`);
    await expect(page.getByRole("link", { name: "Exemple" })).toBeVisible();
    await page.screenshot({ path: `e2e/__screenshots__/modeles-composants.spec.ts/${segment}-liste-${testInfo.project.name}-${process.platform}.png`, fullPage: true, animations: "disabled" });
    await page.getByRole("link", { name: "Exemple" }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: `Fiche du ${label}` })).toBeVisible();
    for (const base of ["Skifer clair", "Skifer ardoise"]) { await choisirTheme(page, base); expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); }
    await choisirTheme(page, "Skifer clair");
    await page.screenshot({ path: `e2e/__screenshots__/modeles-composants.spec.ts/${segment}-fiche-${testInfo.project.name}-${process.platform}.png`, fullPage: true, animations: "disabled" });
  }
  expect(journal.inattendues).toEqual([]);
});
