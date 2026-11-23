import { expect, test } from "@playwright/test";
import { servirThemes } from "./serveur-themes";
import { scenarioNouveau } from "./serveur-nouveau-contenu";

for (const segment of ["themes", "modeles", "composants"]) {
  for (const state of ["vide", "refus"] as const) {
    test(`${segment} : capture ${state}`, async ({ page }, info) => {
      const journal = await servirThemes(page, state === "vide" ? { empty: true } : { forbidden: true });
      await page.goto(`/#/espaces/finance/${segment}`);
      if (state === "vide") await expect(page.getByRole("heading", { name: /Aucun .* à afficher/ })).toBeVisible();
      else await expect(page.getByText(/indisponibles : Accès refusé/)).toBeVisible();
      await page.screenshot({ path: `e2e/__screenshots__/themes-etats-captures.spec.ts/${segment}-${state}-${info.project.name}-${process.platform}.png`, fullPage: true, animations: "disabled" });
      expect(journal.inattendues).toEqual([]);
    });
  }
}

test("capture le dialogue lorsque la liste des thèmes est en erreur", async ({ page }, info) => {
  const server = await scenarioNouveau(page, { themeError: true });
  const dialog = page.getByRole("dialog", { name: "Nouveau dashboard" });
  await dialog.getByRole("combobox", { name: "Thème", exact: true }).focus();
  await expect(dialog.getByText(/Thèmes indisponibles/)).toBeVisible();
  await page.screenshot({ path: `e2e/__screenshots__/themes-etats-captures.spec.ts/dialogue-erreur-${info.project.name}-${process.platform}.png`, animations: "disabled" });
  expect(server.journal.inattendues).toEqual([]);
});

for (const [segment, api] of [["themes", "themes"], ["modeles", "page-templates"], ["composants", "components"]] as const) {
  test(`${segment} : liste en lecture`, async ({ page }, info) => {
    const journal = await servirThemes(page);
    let release = () => {};
    const pending = new Promise<void>((resolve) => { release = resolve; });
    await page.route(`**/api/spaces/finance/${api}`, async (route) => { await pending; await route.fallback(); });
    await page.goto(`/#/espaces/finance/${segment}`);
    await expect(page.getByText(/^Lecture des /)).toBeVisible();
    await page.screenshot({ path: `e2e/__screenshots__/themes-etats-captures.spec.ts/${segment}-lecture-${info.project.name}-${process.platform}.png`, fullPage: true, animations: "disabled" });
    release();
    expect(journal.inattendues).toEqual([]);
  });
  test(`${segment} : fiche en refus`, async ({ page }, info) => {
    const journal = await servirThemes(page);
    const id = "00000000-0000-4000-8000-000000000001";
    await page.route(`**/api/spaces/finance/${api}/${id}`, async (route) => { await route.fulfill({ status: 403, json: { error: { code: "forbidden", required: "creator" } } }); });
    await page.goto(`/#/espaces/finance/${segment}/${id}`);
    await expect(page.getByText(/indisponible : Accès refusé/)).toBeVisible();
    await page.screenshot({ path: `e2e/__screenshots__/themes-etats-captures.spec.ts/${segment}-fiche-refus-${info.project.name}-${process.platform}.png`, fullPage: true, animations: "disabled" });
    expect(journal.inattendues).toEqual([]);
  });
}
