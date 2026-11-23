import type { Page } from "@playwright/test";
import templateRead from "../../../contracts/page_templates/routes/lire.json" with { type: "json" };
import templateList from "../../../contracts/page_templates/routes/lister.json" with { type: "json" };
import themeRead from "../../../contracts/themes/routes/lire.json" with { type: "json" };
import themeList from "../../../contracts/themes/routes/lister.json" with { type: "json" };
import componentRead from "../../../contracts/components/routes/lire.json" with { type: "json" };
import componentList from "../../../contracts/components/routes/lister.json" with { type: "json" };
import { servirDashboards, uuid } from "./serveur-dashboards";

export const MODEL = uuid(50), THEME = uuid(51), COMPONENT = uuid(52), ANALYSIS = uuid(21), COMMIT = "a".repeat(40);
const expand = (value: unknown, id: string): unknown => JSON.parse(JSON.stringify(value).replaceAll("<uuid>", id).replaceAll("<commit>", COMMIT)) as unknown;
export async function scenarioNouveau(page: Page, options: { slots?: number; draft?: boolean; themeError?: boolean } = {}) {
  const server = await servirDashboards(page, { role: "admin", analyses: { [ANALYSIS]: { nom: "Ventes" } }, composants: { [COMPONENT]: ANALYSIS } });
  const model = expand(templateRead.body, MODEL) as { state: string; approved_revision: number | null; revised_by: { subject: string }; page_template: { owner: { subject: string }; filters: unknown[]; layout: unknown } };
  const models = expand(templateList.body, MODEL) as { page_templates: [{ name: string; state: string; approved_revision: number | null; owner: { subject: string } }] };
  model.state = options.draft ? "draft" : "approved"; model.approved_revision = options.draft ? null : 1; model.revised_by.subject = "00u1a2b3c4"; model.page_template.owner.subject = "00u1a2b3c4";
  models.page_templates[0].state = model.state; models.page_templates[0].approved_revision = model.approved_revision; models.page_templates[0].owner.subject = "00u1a2b3c4";
  model.page_template.filters = [];
  model.page_template.layout = { sections: [{ id: uuid(1), rows: [{ id: uuid(2), columns: [{ id: uuid(3), span: 12, children: Array.from({ length: options.slots ?? 1 }, (_, i) => ({ id: uuid(4 + i), type: "slot", expected: "visual", label: i ? "Détail" : "Ventes" })) }] }] }] };
  const theme = expand(themeRead.body, THEME) as { state: string; approved_revision: number | null };
  const themes = expand(themeList.body, THEME) as { themes: [{ state: string; approved_revision: number | null }] };
  theme.state = "approved"; theme.approved_revision = 1; themes.themes[0].state = "approved"; themes.themes[0].approved_revision = 1;
  const component = expand(componentRead.body, COMPONENT) as { state: string; approved_revision: number | null; component: { name: string; analysis: { analysis_id: string } } };
  const components = expand(componentList.body, COMPONENT) as { components: [{ state: string; approved_revision: number | null; name: string }] };
  component.state = "approved"; component.approved_revision = 1; component.component.name = "Ventes communes"; component.component.analysis.analysis_id = ANALYSIS;
  components.components[0].state = "approved"; components.components[0].approved_revision = 1; components.components[0].name = component.component.name;
  await page.route("**/api/spaces/finance/page-templates**", async (route) => { const url = new URL(route.request().url()); await route.fulfill({ json: url.pathname.endsWith("/page-templates") ? models : model, headers: { ETag: `"${COMMIT}"` } }); });
  await page.route("**/api/spaces/finance/themes**", async (route) => { const url = new URL(route.request().url()); if (options.themeError && url.pathname.endsWith("/themes")) { await route.fulfill({ status: 403, json: { error: { code: "forbidden", required: "creator" } } }); return; } await route.fulfill({ json: url.pathname.endsWith("/themes") ? themes : theme, headers: { ETag: `"${COMMIT}"` } }); });
  await page.route("**/api/spaces/finance/components**", async (route) => { const url = new URL(route.request().url()); await route.fulfill({ json: url.pathname.endsWith("/components") ? components : component, headers: { ETag: `"${COMMIT}"` } }); });
  await page.goto("/#/espaces/finance/dashboards");
  await page.getByRole("button", { name: "Nouveau dashboard" }).click();
  return server;
}
export async function choisirContenus(page: Page, theme = true) {
  const dialog = page.getByRole("dialog", { name: "Nouveau dashboard" });
  await dialog.getByRole("textbox", { name: "Nom du dashboard" }).fill("Pilotage");
  const model = dialog.getByRole("combobox", { name: "Modèle de page" }); await model.focus(); await dialog.getByRole("option", { name: /Exemple · r1/ }).waitFor({ state: "attached" }); await model.selectOption(`${MODEL}:1`);
  if (theme) { const select = dialog.getByRole("combobox", { name: "Thème", exact: true }); await select.focus(); await dialog.getByRole("option", { name: "Clair · r1" }).waitFor({ state: "attached" }); await select.selectOption(`${THEME}:1`); }
}
