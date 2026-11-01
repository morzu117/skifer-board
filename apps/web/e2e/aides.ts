import { expect, type Page } from "@playwright/test";

export const titresGraphiques = [
  "CA net par région",
  "Réalisé contre budget · CA net",
  "Du CA T2 au CA T3",
  "CA net par région et par mois",
] as const;

export const themes = [
  { nom: "Skifer clair", capture: "prototype-clair.png" },
  { nom: "Skifer ardoise", capture: "prototype-ardoise.png" },
] as const;

export async function attendreGraphiques(page: Page): Promise<void> {
  await page.evaluate(async () => { await document.fonts.ready; });
  for (const titre of titresGraphiques) {
    // Les marques ECharts n'ont pas de rôle propre : seul leur conteneur est une image.
    const svg = page.getByRole("region", { name: titre, exact: true }).getByRole("img").locator("svg");
    await expect(svg).toBeVisible();
    await expect(svg.locator("path").first()).toBeAttached();
  }
}

export async function choisirTheme(page: Page, nom: string): Promise<void> {
  const groupe = page.getByRole("group", { name: "Thème", exact: true });
  await groupe.getByRole("button", { name: nom, exact: true }).click();
  await expect(groupe.getByRole("button", { pressed: true })).toHaveText(nom);
  await expect(groupe.getByRole("button", { pressed: false })).toHaveCount(1);
}
