import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { simulerEspaces, simulerIdentite, attendreGraphiques, choisirTheme, themes } from "./aides";

test.beforeEach(async ({ page }) => {
  await simulerIdentite(page);
  await simulerEspaces(page);
});

for (const theme of themes) {
  test(`la page entière respecte axe, contraste inclus, sous ${theme.nom}`, async ({ page }) => {
    await page.goto("/#/prototype");
    await choisirTheme(page, theme.nom);
    await attendreGraphiques(page);
    // Aucune exclusion, aucun filtrage par tags : toutes les règles axe sont conservées.
    // color-contrast est activée explicitement, contrairement aux contrôles jsdom.
    const resultat = await new AxeBuilder({ page }).options({ rules: { "color-contrast": { enabled: true } } }).analyze();
    expect(resultat.violations, "Violations axe de la page entière, contraste inclus").toEqual([]);
  });

  test(`capture de référence de la page principale sous ${theme.nom}`, async ({ page }) => {
    await page.goto("/#/prototype");
    await choisirTheme(page, theme.nom);
    await attendreGraphiques(page);
    await expect(page).toHaveScreenshot(theme.capture, { fullPage: true });
  });
}
