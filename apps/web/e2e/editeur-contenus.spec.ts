import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import themeRead from "../../../contracts/themes/routes/lire.json" with { type: "json" };
import componentRead from "../../../contracts/components/routes/lire.json" with { type: "json" };
import themeList from "../../../contracts/themes/routes/lister.json" with { type: "json" };
import componentList from "../../../contracts/components/routes/lister.json" with { type: "json" };
import diff from "../../../contracts/components/routes/diff.json" with { type: "json" };
import approval from "../../../contracts/themes/routes/approver.json" with { type: "json" };
import { choisirTheme } from "./aides";
import { DASHBOARD_ID, entreeDashboard, pageDe, servirDashboards, uuid, visuel } from "./serveur-dashboards";

const THEME = uuid(51), COMPONENT = uuid(52), ANALYSIS = uuid(21), NODE = uuid(31), COMMIT = "a".repeat(40);
type Metadata = { state: string; approved_revision: number | null; revision: number };
type Theme = Metadata & { revised_by: { issuer: string; subject: string }; theme: { owner: { issuer: string; subject: string }; formats: { number: string }; chart_defaults: { bars: { number_format: string } } } };
type Component = Metadata & { component: { name: string; analysis: { analysis_id: string }; presentation: { title?: string } } };
type List = { themes: [{ state: string; approved_revision: number | null; owner: { issuer: string; subject: string } }] };
type Components = { components: [{ state: string; approved_revision: number | null; name: string }] };
const expand = (value: unknown, id: string): unknown => JSON.parse(JSON.stringify(value).replaceAll("<uuid>", id).replaceAll("<commit>", COMMIT)) as unknown;

test("thème, composant exécuté, détachement et révision", async ({ page }, testInfo) => {
  const server = await servirDashboards(page, { role: "creator", dashboards: [entreeDashboard(DASHBOARD_ID, pageDe("Pilotage", [visuel(NODE, ANALYSIS, { title: "Ventes" })]))], analyses: { [ANALYSIS]: { nom: "Ventes" } } });
  const theme = (expand(themeRead.body, THEME) as Theme); theme.state = "approved"; theme.approved_revision = 1; theme.theme.formats.number = "decimal_2"; theme.theme.chart_defaults.bars.number_format = "decimal_2";
  const component = (expand(componentRead.body, COMPONENT) as Component); component.state = "approved"; component.approved_revision = 1; component.component.analysis.analysis_id = ANALYSIS; component.component.name = "Ventes réutilisables"; component.component.presentation.title = "Ventes du composant";
  const newer = structuredClone(component); newer.revision = 2; newer.approved_revision = 2; newer.component.name = "Ventes révisées";
  const themes = (expand(themeList.body, THEME) as List); themes.themes[0].state = "approved"; themes.themes[0].approved_revision = 1;
  const components = (expand(componentList.body, COMPONENT) as Components); components.components[0].state = "approved"; components.components[0].approved_revision = 1; components.components[0].name = component.component.name;
  await page.route("**/api/spaces/finance/themes**", async (route) => { const url = new URL(route.request().url()); await route.fulfill({ json: url.pathname.endsWith("/themes") ? themes : theme, headers: { ETag: `"${COMMIT}"` } }); });
  await page.route("**/api/spaces/finance/components**", async (route) => { const url = new URL(route.request().url()); const body = url.pathname.endsWith("/components") ? components : url.pathname.endsWith("/diff") ? expand(diff.body, COMPONENT) : url.searchParams.get("revision") === "1" ? component : newer; await route.fulfill({ json: body, headers: { ETag: `"${COMMIT}"` } }); });
  await page.goto(`/#/espaces/finance/dashboards/${DASHBOARD_ID}`);
  await expect(page.getByRole("heading", { name: "Pilotage", level: 1 })).toBeVisible();
  await expect.poll(() => server.journal.executions.length).toBe(1);
  const original = structuredClone(server.journal.executions[0]);
  const graphic = page.locator(".sb-node--analysis .sb-chart-focus svg").first();
  const before = await graphic.screenshot({ animations: "disabled" });
  await page.getByRole("combobox", { name: "Thème", exact: true }).selectOption(`${THEME}:1`);
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Thème", exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Rétablir", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Thème", exact: true })).toHaveValue(`${THEME}:1`);
  await page.locator(".sb-node__select").filter({ hasText: /Visuel/ }).first().click();
  await expect(page.getByRole("combobox", { name: "Format des nombres", exact: true })).toHaveValue("decimal_2");
  await expect(page.getByText("Origine : Thème : Clair").first()).toBeVisible();
  await expect.poll(async () => (await graphic.screenshot({ animations: "disabled" })).equals(before)).toBe(false);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Révision 2 enregistrée.")).toBeVisible();
  await page.reload();
  await expect.poll(() => server.journal.executions.length).toBe(2);
  expect(server.journal.executions[1]).toEqual(original);
  await page.locator(".sb-node__select").filter({ hasText: /Colonne/ }).first().click();
  await page.getByRole("button", { name: /Ventes réutilisables · r1/ }).click();
  await expect(page.getByText("Composant : Ventes réutilisables r1")).toBeVisible();
  await expect(page.locator(".sb-node--component").getByText("Provenance · Ventes du composant")).toBeVisible();
  await expect(page.getByText(/Composant épinglé r1/)).toBeVisible();
  await expect.poll(() => server.journal.executions.length).toBeGreaterThanOrEqual(1);
  expect(server.journal.executions[0]).toEqual(original);
  for (const base of ["Skifer clair", "Skifer ardoise"]) { await choisirTheme(page, base); expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); }
  await choisirTheme(page, "Skifer clair");
  await page.screenshot({ path: `e2e/__screenshots__/editeur-contenus.spec.ts/editeur-${testInfo.project.name}-${process.platform}.png`, fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Détacher" }).click(); await expect(page.getByText("Composant détaché.")).toBeAttached();
  await page.getByRole("button", { name: "Annuler", exact: true }).click(); await expect(page.getByText("Composant : Ventes réutilisables r1")).toBeVisible();
  await page.getByRole("button", { name: "Comparer les révisions" }).click(); await expect(page.getByRole("table", { name: "Diff entre r1 et r2" })).toBeVisible();
  await page.getByRole("button", { name: "Adopter r2" }).click(); await expect(page.getByText("Composant : Ventes révisées r2")).toBeVisible();
  expect(server.journal.inattendues).toEqual([]);
});

test("refus d'un brouillon partagé puis enregistrement après approbation", async ({ page }) => {
  const server = await servirDashboards(page, { role: "admin", dashboards: [entreeDashboard(DASHBOARD_ID, pageDe("Pilotage", [visuel(NODE, ANALYSIS, { title: "Ventes" })], { visibility: "personal" }))], analyses: { [ANALYSIS]: { nom: "Ventes" } } });
  const theme = expand(themeRead.body, THEME) as Theme;
  const themes = expand(themeList.body, THEME) as List;
  themes.themes[0].owner.subject = "00u1a2b3c4"; theme.theme.owner.subject = "00u1a2b3c4"; theme.revised_by.subject = "00u1a2b3c4";
  let approved = false;
  let release = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/spaces/finance/themes**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/approvals")) {
      expect(route.request().postDataJSON()).toEqual({ revision: 1, expected_revision: 1 });
      approved = true; theme.state = "approved"; theme.approved_revision = 1; release();
      await route.fulfill({ status: 201, json: expand(approval.body, THEME) }); return;
    }
    if (!url.pathname.endsWith("/themes")) await pending;
    await route.fulfill({ json: url.pathname.endsWith("/themes") ? themes : theme, headers: { ETag: `"${COMMIT}"` } });
  });
  await page.route(`**/api/spaces/finance/dashboards/${DASHBOARD_ID}/revisions`, async (route) => {
    if (!approved) { await route.fulfill({ status: 422, json: { error: { code: "unapproved_reference", paths: ["/theme"] } } }); return; }
    await route.fallback();
  });
  await page.goto(`/#/espaces/finance/dashboards/${DASHBOARD_ID}`);
  await expect(page.getByRole("option", { name: "Clair · r1 · brouillon" })).toBeAttached();
  await page.getByRole("combobox", { name: "Thème", exact: true }).selectOption(`${THEME}:1`);
  await page.getByRole("radio", { name: "Partagé" }).check();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText(/Références concernées : \/theme/)).toBeVisible();
  await page.evaluate(async (id) => { await fetch(`/api/spaces/finance/themes/${id}/approvals`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: 1, expected_revision: 1 }) }); }, THEME);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Révision 2 enregistrée.")).toBeVisible();
  expect(server.journal.revisions).toHaveLength(1);
});
