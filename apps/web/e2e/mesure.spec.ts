import { expect, test } from "@playwright/test";

test("la page de mesure affiche les 24 configurations", async ({ page }) => {
  // Le travail de mesure précède le rendu React ; délai maximal, sans attente fixe.
  test.setTimeout(120_000);
  const reponse = await page.goto("/bench.html");
  expect(reponse?.ok(), "La page de mesure doit être servie sans erreur").toBe(true);
  await expect(page.getByRole("heading", { level: 1, name: "Mesure du rendu graphique" })).toBeVisible();
  const tableau = page.getByRole("table", { name: "Temps de rendu et mémoire par configuration", exact: true });
  await expect(tableau).toBeVisible();
  await expect(tableau.getByRole("row").filter({ has: page.getByRole("cell") })).toHaveCount(24);
  await expect(tableau.getByRole("row")).toHaveCount(25);
});
