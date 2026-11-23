import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import modele from "../../../contracts/page_templates/routes/creer.json" with { type: "json" };
import composant from "../../../contracts/components/routes/creer.json" with { type: "json" };
import { choisirTheme } from "./aides";
import { AUCUN, DASHBOARD_ID, entreeDashboard, pageDe, servirDashboards, uuid, visuel } from "./serveur-dashboards";

const ANALYSE = uuid(21);
const CREATED = uuid(40);
async function scenario(page: Page, denied = false, readOnly = false) {
  const serveur = await servirDashboards(page, { role: "creator", dashboards: [entreeDashboard(DASHBOARD_ID, pageDe("Pilotage", [visuel(uuid(31), ANALYSE, { title: "Ventes" })]), readOnly ? { proprietaire: "autre", droits: AUCUN } : {})], analyses: { [ANALYSE]: { nom: "Ventes" } } });
  const created: Record<string, unknown>[] = [];
  for (const [segment, fixture, field, version] of [["page-templates", modele, "page_template", "board.page_template/v1"], ["components", composant, "component", "board.component/v1"]] as const) {
    let saved: Record<string, unknown> | undefined;
    await page.route(`**/api/spaces/finance/${segment}**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === "GET" && segment === "components" && path.endsWith("/components")) { await route.fallback(); return; }
      if (route.request().method() === "POST" && path.endsWith(`/${segment}`)) {
        const draft = route.request().postDataJSON() as Record<string, unknown>; created.push(draft);
        if (denied) { await route.fulfill({ status: 403, json: { error: { code: "forbidden", required: "creator" } } }); return; }
        const body = JSON.parse(JSON.stringify(fixture.body).replaceAll("<uuid>", CREATED).replaceAll("<commit>", "a".repeat(40))) as Record<string, unknown>;
        body[field] = { ...draft, api_version: version, id: CREATED, owner: { issuer: "https://id.example.invalid", subject: "cora" } };
        body.revised_by = { issuer: "https://id.example.invalid", subject: "cora" }; saved = body;
        await route.fulfill({ status: 201, json: body, headers: { ETag: `"${"a".repeat(40)}"` } }); return;
      }
      if (route.request().method() === "GET" && path.endsWith(`/${CREATED}`) && saved) { await route.fulfill({ status: 200, json: saved, headers: { ETag: `"${"a".repeat(40)}"` } }); return; }
      serveur.journal.inattendues.push(`${route.request().method()} ${path}`); await route.fulfill({ status: 500 });
    });
  }
  await page.goto(`/#/espaces/finance/dashboards/${DASHBOARD_ID}`);
  await expect(page.getByRole("heading", { name: "Pilotage", level: 1 })).toBeVisible();
  return { serveur, created };
}
for (const kind of ["modèle", "composant"] as const) {
  test(`${kind} : création, garde, accessibilité et fiche`, async ({ page }, testInfo) => {
    const { serveur, created } = await scenario(page);
    if (kind === "composant") await page.locator(".sb-node__select").filter({ hasText: /Visuel/ }).first().click();
    const action = page.getByRole("button", { name: `Enregistrer comme ${kind}` }); await expect(action).toBeEnabled();
    await action.focus(); await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: `Enregistrer comme ${kind}` }); await expect(dialog.getByRole("textbox", { name: "Nom" })).toBeFocused();
    for (const theme of ["Skifer clair", "Skifer ardoise"]) { await page.keyboard.press("Escape"); await choisirTheme(page, theme); await action.click(); expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); }
    await page.keyboard.press("Escape"); await choisirTheme(page, "Skifer clair"); await action.click();
    await page.screenshot({ path: `e2e/__screenshots__/enregistrer-contenus.spec.ts/${kind === "modèle" ? "modele" : kind}-${testInfo.project.name}-${process.platform}.png`, animations: "disabled" });
    await dialog.getByRole("button", { name: "Créer" }).click();
    const link = page.getByRole("link", { name: `Ouvrir la fiche du ${kind}` }); await expect(link).toBeVisible();
    expect(created).toHaveLength(1);
    if (kind === "composant") expect(created[0]).toMatchObject({ kind: "visual", analysis: { analysis_id: ANALYSE, revision: 1 }, presentation: { title: "Ventes" } });
    await link.click(); await expect(page.getByRole("heading", { name: kind === "modèle" ? "Fiche du modèle de page" : "Fiche du composant" })).toBeVisible();
    expect(serveur.journal.inattendues).toEqual([]);
  });
  test(`${kind} : refus et modifications non enregistrées`, async ({ page }) => {
    const { serveur, created } = await scenario(page, true);
    if (kind === "composant") await page.locator(".sb-node__select").filter({ hasText: /Visuel/ }).first().click();
    const action = page.getByRole("button", { name: `Enregistrer comme ${kind}` }); await expect(action).toBeEnabled(); await action.click();
    await page.getByRole("dialog").getByRole("button", { name: "Créer" }).click(); await expect(page.getByText(/Accès refusé/)).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("textbox", { name: "Nom" })).toBeFocused(); await page.keyboard.press("Escape");
    const field = page.getByRole("textbox", { name: kind === "modèle" ? "Nom du dashboard" : "Titre", exact: true }); await field.fill("Modifié"); await expect(action).toBeDisabled(); await expect(action.locator("..").getByText(/Enregistrez les modifications du dashboard/)).toBeVisible();
    expect(created).toHaveLength(1); expect(serveur.journal.inattendues).toEqual([]);
  });
}

test("un créateur extrait un modèle d'un dashboard en lecture seule", async ({ page }) => {
  const { serveur, created } = await scenario(page, false, true);
  await expect(page.getByText(/il s'ouvre en lecture seule/)).toBeVisible();
  const action = page.getByRole("button", { name: "Enregistrer comme modèle" }); await expect(action).toBeEnabled(); await action.click();
  await page.getByRole("dialog").getByRole("button", { name: "Créer" }).click();
  await expect(page.getByRole("link", { name: "Ouvrir la fiche du modèle" })).toBeVisible();
  expect(created).toHaveLength(1); expect(serveur.journal.inattendues).toEqual([]);
});
