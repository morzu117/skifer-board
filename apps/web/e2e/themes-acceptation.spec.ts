import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { servirPlan20 } from "./serveur-plan20";
import { choisirTheme, verifierDashboard } from "./aides";
import { DASHBOARD_ID } from "./serveur-dashboards";
import templateExample from "../../../contracts/page_templates/routes/creer.json" with { type: "json" };
import componentExample from "../../../contracts/components/routes/creer.json" with { type: "json" };

const journaux: { inattendues: string[] }[] = [];
test.afterEach(() => { for (const journal of journaux.splice(0)) expect(journal.inattendues).toEqual([]); });

/** Les filtres structurés du modèle sont autorisés à la racine, comme dans un dashboard. */
function verifierContenu(value: unknown): void {
  verifierDashboard(value);
  const couleurs = (item: unknown): void => {
    if (typeof item === "string") { expect(item).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\s*\(/i); return; }
    if (Array.isArray(item)) { item.forEach(couleurs); return; }
    if (item !== null && typeof item === "object") { for (const [key, child] of Object.entries(item)) { expect(["requete", "request"]).not.toContain(key.toLowerCase()); couleurs(child); } }
  };
  couleurs(value);
}

test.describe.serial("parcours partagé", () => {
let context: BrowserContext;
let page: Page;
let serveur: Awaited<ReturnType<typeof servirPlan20>>;
let modelId = "";
let nouveauId = "";
let componentId = "";
let autreId = "";
const themeId = "00000000-0000-4000-8000-000000000001";
const executions = () => serveur.journal.corps.filter((entry) => entry.path === "/api/spaces/finance/executions");
test.beforeAll(async ({ browser, baseURL }, info) => {
  if (baseURL === undefined) throw new Error("baseURL Playwright manquante");
  const { viewport, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId } = info.project.use;
  context = await browser.newContext({ baseURL, ...(viewport === undefined ? {} : { viewport }), ...(deviceScaleFactor === undefined ? {} : { deviceScaleFactor }), ...(isMobile === undefined ? {} : { isMobile }), ...(hasTouch === undefined ? {} : { hasTouch }), ...(locale === undefined ? {} : { locale }), ...(timezoneId === undefined ? {} : { timezoneId }) });
  page = await context.newPage();
  serveur = await servirPlan20(page);
});
test.afterAll(async () => { await context.close(); });
test("un créateur crée et applique un thème, puis un administrateur l’approuve pour le partage", async () => {
  journaux.push(serveur.journal);
  let forger = true;
  await page.route("**/api/spaces/finance/themes", async (route) => {
    if (route.request().method() === "POST" && forger) {
      forger = false;
      const draft = route.request().postDataJSON() as { roles: { marks: { series: string } } };
      draft.roles.marks.series = "surface";
      await route.fallback({ postData: JSON.stringify(draft) }); return;
    }
    await route.fallback();
  });
  await page.goto("/#/espaces/finance/themes/nouveau");
  await page.getByRole("textbox", { name: "Nom", exact: true }).fill("Thème du créateur");
  const serie = page.getByRole("combobox", { name: "Série", exact: true });
  await expect(serie.getByRole("option", { name: /^surface ·/ })).toHaveCount(0);
  await serie.selectOption("ink");
  for (const base of ["Skifer clair", "Skifer ardoise"]) {
    await choisirTheme(page, base);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText(/Thème invalide · raison : Ce token n.est pas admissible pour cette base/)).toBeVisible();
  await expect(page.getByText(/roles\/marks\/series/)).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page).toHaveURL(/themes\/00000000-0000-4000-8000-000000000001/);
  expect(serveur.journal.corps).toHaveLength(2);
  expect(serveur.journal.corps[0]?.body).toMatchObject({ roles: { marks: { series: "surface" } } });
  serveur.journal.corps.forEach((entry) => { verifierContenu(entry.body); });
  expect(serveur.journal.inattendues).toEqual([]);

  // Étape 2 : le même brouillon est appliqué au dashboard personnel.
  await page.goto(`/#/espaces/finance/dashboards/${DASHBOARD_ID}`);
  await expect(page.getByRole("heading", { name: "Pilotage", level: 1 })).toBeVisible();
  const tile = page.locator(".sb-node--analysis");
  const graphic = tile.locator(".sb-chart-focus svg").first();
  await expect(graphic).toBeVisible();
  await expect.poll(() => executions().length).toBe(1);
  const beforeRequest = executions()[0]?.brut;
  expect(beforeRequest).toBeTruthy();
  const markFills = () => graphic.locator("path").evaluateAll((paths) => paths.map((path) => path.getAttribute("fill")));
  const beforeFills = await markFills();
  await tile.getByRole("tab", { name: "Tableau" }).click();
  const beforeValues = await tile.getByRole("table").locator("tbody").innerText();
  expect(beforeValues.trim()).not.toBe("");
  await tile.getByRole("tab", { name: "Graphique" }).click();
  const selectTheme = page.getByRole("combobox", { name: "Thème", exact: true });
  await expect(selectTheme.getByRole("option", { name: /Thème du créateur · r1 · brouillon/ })).toBeAttached();
  await selectTheme.selectOption(`${themeId}:1`);
  await expect.poll(markFills).not.toEqual(beforeFills);
  await tile.getByRole("tab", { name: "Tableau" }).click();
  await expect.poll(() => tile.getByRole("table").locator("tbody").innerText()).toBe(beforeValues);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Révision 2 enregistrée.")).toBeVisible();
  const saved = serveur.journal.corps.filter((entry) => entry.path === `/api/spaces/finance/dashboards/${DASHBOARD_ID}/revisions`).at(-1);
  expect(saved?.body).toMatchObject({ theme: { theme_id: themeId, revision: 1 } });
  await page.reload();
  await expect.poll(() => executions().length).toBe(2);
  expect(executions()[1]?.brut).toBe(beforeRequest);
  await tile.getByRole("tab", { name: "Tableau" }).click();
  await expect.poll(() => tile.getByRole("table").locator("tbody").innerText()).toBe(beforeValues);
  for (const base of ["Skifer clair", "Skifer ardoise"]) { await choisirTheme(page, base); expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); }
  expect(serveur.journal.inattendues).toEqual([]);

  // Étape 3 : une lecture retardée laisse le serveur juger la référence lors du passage en partagé.
  let liberer = () => {};
  const attente = new Promise<void>((resolve) => { liberer = resolve; });
  const themeRoute = `**/api/spaces/finance/themes/${themeId}*`;
  await page.route(themeRoute, async (route) => { if (route.request().method() === "GET") await attente; await route.fallback(); });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Pilotage", level: 1 })).toBeVisible();
  await page.getByRole("radio", { name: "Partagé" }).check();
  const refusServeur = page.waitForResponse((response) => response.url().endsWith(`/dashboards/${DASHBOARD_ID}/revisions`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  const reponse = await refusServeur;
  expect(reponse.status()).toBe(422);
  expect(await reponse.json()).toMatchObject({ error: { code: "unapproved_reference", paths: ["/theme"] } });
  await expect(page.getByText(/Références concernées : \/theme/)).toBeVisible();
  const refusal = serveur.journal.corps.filter((entry) => entry.path === `/api/spaces/finance/dashboards/${DASHBOARD_ID}/revisions`).at(-1);
  expect(refusal?.body).toMatchObject({ visibility: "shared", theme: { theme_id: themeId, revision: 1 } });
  for (const base of ["Skifer clair", "Skifer ardoise"]) { await choisirTheme(page, base); expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); }
  expect(serveur.journal.inattendues).toEqual([]);
  liberer(); await page.unroute(themeRoute);
  await page.getByRole("tab", { name: /^Problèmes/ }).click();
  await expect(page.getByText("Référence non approuvée pour un dashboard partagé.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enregistrer", exact: true })).toBeDisabled();
  serveur.identite("admin");
  await page.goto(`/#/espaces/finance/themes/${themeId}`);
  await page.getByRole("dialog", { name: "Quitter sans enregistrer ?" }).getByRole("button", { name: "Quitter sans enregistrer" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Première approbation" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Approbation du thème" })).toContainText("Thème du créateur · base Skifer clair · révision r1");
  await page.getByRole("button", { name: "Approuver", exact: true }).click();
  await expect(page.getByText(/Approuvé r1/).first()).toBeVisible();
  serveur.identite("createur");
  await page.goto(`/#/espaces/finance/dashboards/${DASHBOARD_ID}`);
  await page.reload();
  await expect(page.getByRole("radio", { name: "Partagé" })).toBeVisible();
  await page.getByRole("radio", { name: "Partagé" }).check();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Révision 3 enregistrée.")).toBeVisible();
  const shared = serveur.journal.corps.filter((entry) => entry.path === `/api/spaces/finance/dashboards/${DASHBOARD_ID}/revisions`).at(-1);
  expect(shared?.body).toMatchObject({ visibility: "shared", theme: { theme_id: themeId, revision: 1 } });
  for (const base of ["Skifer clair", "Skifer ardoise"]) { await choisirTheme(page, base); expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); }
  expect(serveur.journal.inattendues).toEqual([]);
 });

test("extrait un modèle, l’approuve et crée un dashboard depuis ce modèle", async () => {
  const verifier = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(verifier); return; }
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) { expect(["analysis_id", "targets", "component_id"]).not.toContain(key); verifier(child); }
  };
  await expect(page.getByRole("button", { name: "Enregistrer comme modèle" })).toBeEnabled();
  await page.getByRole("button", { name: "Enregistrer comme modèle" }).click();
  const dialog = page.getByRole("dialog", { name: "Enregistrer comme modèle" });
  await dialog.getByRole("textbox", { name: "Nom" }).fill("Modèle du parcours");
  const creation = page.waitForResponse((response) => response.url().endsWith("/page-templates") && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Créer" }).click();
  const created = await creation; expect(created.status()).toBe(201);
  modelId = ((await created.json()) as { id: string }).id;
  const sent = serveur.journal.corps.filter((item) => item.path.endsWith("/page-templates") && item.method === "POST").at(-1);
  expect(sent).toBeDefined(); verifier(sent?.body);
  await expect(page.getByRole("link", { name: "Ouvrir la fiche du modèle" })).toBeVisible();
  serveur.identite("admin");
  await page.goto(`/#/espaces/finance/modeles/${modelId}`); await page.reload();
  await expect(page.getByRole("heading", { name: "Première approbation" })).toBeVisible();
  await page.getByRole("button", { name: "Approuver", exact: true }).click();
  await expect(page.getByText(/Approuvé r1/).first()).toBeVisible();
  serveur.identite("createur");
  await page.goto("/#/espaces/finance/dashboards"); await page.reload();
  await page.getByRole("button", { name: "Nouveau dashboard" }).click();
  const nouveau = page.getByRole("dialog", { name: "Nouveau dashboard" });
  await nouveau.getByRole("textbox", { name: "Nom du dashboard" }).fill("Issu du modèle");
  const model = nouveau.getByRole("combobox", { name: "Modèle de page" });
  await model.focus(); await expect(model.getByRole("option", { name: /Modèle du parcours · r1/ })).toBeAttached();
  await model.selectOption(`${modelId}:1`);
  const theme = nouveau.getByRole("combobox", { name: "Thème", exact: true });
  await theme.focus(); await expect(theme.getByRole("option", { name: /Thème du créateur · r1/ })).toBeAttached();
  await theme.selectOption(`${themeId}:1`);
  const creations = () => serveur.journal.corps.filter((entry) => entry.path === "/api/spaces/finance/dashboards" && entry.method === "POST");
  expect(creations()).toHaveLength(0);
  await nouveau.getByRole("button", { name: "Ouvrir le brouillon" }).click();
  await expect(page.getByText("Brouillon local, jamais enregistré").first()).toBeVisible();
  const slots = page.locator(".sb-node--slot");
  await expect(slots).toHaveCount(1);
  await slots.first().getByRole("button", { name: /Remplir l.emplacement/ }).click();
  await page.getByRole("button", { name: "Choisir une analyse" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Ventes · Partagée/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remplir", exact: true }).click();
  expect(creations()).toHaveLength(0);
  const dashboardResponse = page.waitForResponse((response) => response.url().endsWith("/dashboards") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  const result = await dashboardResponse; expect(result.status()).toBe(201);
  nouveauId = ((await result.json()) as { id: string }).id;
  expect(creations()).toHaveLength(1);
  expect(creations()[0]?.body).toMatchObject({ template: { template_id: modelId, revision: 1 }, theme: { theme_id: themeId, revision: 1 } });
  await expect(page.getByRole("link", { name: "Historique des révisions" })).toBeVisible();
  for (const base of ["Skifer clair", "Skifer ardoise"]) { await choisirTheme(page, base); expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); }
  expect(serveur.journal.inattendues).toEqual([]);
 });

test("approuve, insère et met à jour un composant", async () => {
  await page.locator(".sb-node__select").filter({ hasText: /Visuel/ }).first().click();
  const action = page.getByRole("button", { name: "Enregistrer comme composant" });
  await expect(action).toBeEnabled(); await action.click();
  const dialog = page.getByRole("dialog", { name: "Enregistrer comme composant" });
  await dialog.getByRole("textbox", { name: "Nom" }).fill("Composant du parcours");
  const componentResponse = page.waitForResponse((response) => response.url().endsWith("/components") && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Créer" }).click();
  const result = await componentResponse; expect(result.status()).toBe(201);
  componentId = ((await result.json()) as { id: string }).id;
  await expect(page.getByRole("link", { name: "Ouvrir la fiche du composant" })).toBeVisible();
  serveur.identite("admin"); await page.goto(`/#/espaces/finance/composants/${componentId}`); await page.reload();
  await expect(page.getByRole("heading", { name: "Première approbation" })).toBeVisible();
  await page.getByRole("button", { name: "Approuver", exact: true }).click();
  await expect(page.getByText(/Approuvé r1/).first()).toBeVisible();
  serveur.identite("createur"); await page.goto(`/#/espaces/finance/dashboards/${nouveauId}`); await page.reload();
  await expect(page.locator(".sb-node--analysis .sb-chart-focus svg")).toBeVisible();
  const original = executions().at(-1)?.brut; expect(original).toBeTruthy();
  await page.locator(".sb-node__select").filter({ hasText: /Colonne/ }).first().click();
  await page.getByRole("button", { name: /Composant du parcours · r1/ }).click();
  await expect(page.getByText("Composant : Composant du parcours r1")).toBeVisible();
  await page.getByRole("button", { name: "Détacher" }).click();
  await expect(page.getByText("Composant détaché.")).toBeAttached();
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(page.getByText("Composant : Composant du parcours r1")).toBeVisible();
  // Les deux tuiles identiques partagent une exécution : on retire le visuel pour observer le composant seul.
  const visual = page.getByRole("button", { name: "Visuel · Ventes" });
  await visual.focus(); await page.keyboard.press("Delete");
  await expect(visual).toHaveCount(0);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Révision 2 enregistrée.")).toBeVisible();
  const count = executions().length;
  await page.reload();
  await expect(page.locator(".sb-node--component .sb-chart-focus svg")).toBeVisible();
  await expect.poll(() => executions().length).toBeGreaterThan(count);
  expect(executions().at(-1)?.brut).toBe(original);
  await page.goto(`/#/espaces/finance/composants/${componentId}`);
  await expect(page.getByRole("heading", { name: "Fiche du composant" })).toBeVisible();
  await page.getByRole("textbox", { name: "Nom", exact: true }).fill("Composant révisé");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText(/Révision r2 enregistrée/)).toBeVisible();
  serveur.identite("admin"); await page.reload();
  const approvalDiff = page.getByRole("table", { name: "Diff entre r1 et r2" });
  await expect(approvalDiff).toBeVisible();
  await expect(approvalDiff.getByRole("row", { name: /Nom.*Composant du parcours.*Composant révisé/ })).toBeVisible();
  await page.getByRole("button", { name: "Approuver", exact: true }).click();
  await expect(page.getByText(/Approuvé r2/).first()).toBeVisible();
  serveur.identite("createur"); await page.goto(`/#/espaces/finance/dashboards/${nouveauId}`); await page.reload();
  await page.locator(".sb-node__select").filter({ hasText: /Composant/ }).first().click();
  await expect(page.getByText("Composant épinglé r1 ; révision courante r2.")).toBeVisible();
  await page.getByRole("button", { name: "Comparer les révisions" }).click();
  await expect(page.getByRole("table", { name: "Diff entre r1 et r2" })).toContainText("Composant révisé");
  await page.getByRole("button", { name: "Adopter r2" }).click();
  await expect(page.getByText("Composant : Composant révisé r2")).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Révision 3 enregistrée.")).toBeVisible();
  const revision = serveur.journal.corps.filter((entry) => entry.path === `/api/spaces/finance/dashboards/${nouveauId}/revisions`).at(-1);
  expect(JSON.stringify(revision?.body)).toContain(JSON.stringify({ component_id: componentId, revision: 2 }));
  for (const base of ["Skifer clair", "Skifer ardoise"]) { await choisirTheme(page, base); expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); }
  expect(serveur.journal.inattendues).toEqual([]);
});

test("refuse la suppression des contenus utilisés", async () => {
  const source = serveur.dashboard.entree(nouveauId).revisions.at(-1);
  serveur.identite("autre");
  const hidden = await page.evaluate(async (document_) => {
    const response = await fetch("/api/spaces/finance/dashboards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...document_, name: "Privé d’une autre personne", visibility: "personal" }) });
    return { status: response.status, id: (await response.json() as { id: string }).id };
  }, source);
  expect(hidden.status).toBe(201); autreId = hidden.id;
  serveur.identite("createur"); await page.goto(`/#/espaces/finance/themes/${themeId}`); await page.reload();
  await page.getByRole("button", { name: "Supprimer le thème" }).click();
  const themeRefusal = page.waitForResponse((response) => response.request().method() === "DELETE" && response.url().includes(`/themes/${themeId}?`));
  await page.getByRole("dialog").getByRole("button", { name: "Confirmer la suppression" }).click();
  const themeResult = await themeRefusal; expect(themeResult.status()).toBe(409);
  expect(await themeResult.json()).toMatchObject({ error: { code: "content_in_use", others: 1, consumers: expect.arrayContaining([{ kind: "dashboard", id: nouveauId }]) } });
  await expect(page.getByRole("link", { name: `Dashboard ${nouveauId}` })).toHaveAttribute("href", new RegExp(`dashboards/${nouveauId}`));
  await expect(page.getByText("et 1 autres dashboards que vous ne voyez pas")).toBeVisible();
  for (const base of ["Skifer clair", "Skifer ardoise"]) { await choisirTheme(page, base); expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); }
  await page.goto(`/#/espaces/finance/composants/${componentId}`);
  await page.getByRole("button", { name: "Supprimer le composant" }).click();
  const componentRefusal = page.waitForResponse((response) => response.request().method() === "DELETE" && response.url().includes(`/components/${componentId}?`));
  await page.getByRole("dialog").getByRole("button", { name: "Confirmer la suppression" }).click();
  const componentResult = await componentRefusal; expect(componentResult.status()).toBe(409);
  expect(await componentResult.json()).toMatchObject({ error: { code: "content_in_use", others: 1, consumers: expect.arrayContaining([{ kind: "dashboard", id: nouveauId }]) } });
  await expect(page.getByRole("link", { name: `Dashboard ${nouveauId}` })).toHaveAttribute("href", new RegExp(`dashboards/${nouveauId}`));
  await expect(page.getByText("et 1 autres dashboards que vous ne voyez pas")).toBeVisible();
  for (const base of ["Skifer clair", "Skifer ardoise"]) { await choisirTheme(page, base); expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); }
  expect(serveur.contents.themes.has(themeId)).toBe(true); expect(serveur.contents.components.has(componentId)).toBe(true);
  expect(serveur.journal.inattendues).toEqual([]);
 });

test("crée un dashboard issu du modèle au clavier seul", async () => {
  serveur.identite("createur"); await page.goto("/#/espaces/finance/dashboards"); await page.reload();
  const tabTo = async (locator: ReturnType<Page["getByRole"]>) => {
    for (let i = 0; i < 150; i += 1) {
      if (await locator.count() === 1 && await locator.evaluate((node) => node === document.activeElement)) return;
      await page.keyboard.press("Tab");
    }
    throw new Error("Contrôle non atteint au clavier");
  };
  await tabTo(page.getByRole("button", { name: "Nouveau dashboard" })); await page.keyboard.press("Space");
  const dialog = page.getByRole("dialog", { name: "Nouveau dashboard" });
  await expect(dialog.getByRole("textbox", { name: "Nom du dashboard" })).toBeFocused();
  await page.keyboard.type("Clavier modèle"); await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowRight");
  const model = dialog.getByRole("combobox", { name: "Modèle de page" });
  await tabTo(model); await expect(model.getByRole("option", { name: /Modèle du parcours · r1/ })).toBeAttached(); await tabTo(model);
  await page.keyboard.press(test.info().project.name === "ordinateur" ? "m" : "ArrowDown");
  await expect(model).toHaveValue(`${modelId}:1`);
  const theme = dialog.getByRole("combobox", { name: "Thème", exact: true });
  await tabTo(theme); await expect(theme.getByRole("option", { name: /Thème du créateur · r1/ })).toBeAttached(); await tabTo(theme);
  await page.keyboard.press(test.info().project.name === "ordinateur" ? "t" : "ArrowDown");
  await expect(theme).toHaveValue(`${themeId}:1`);
  await tabTo(dialog.getByRole("button", { name: "Ouvrir le brouillon" })); await page.keyboard.press("Enter");
  await expect(page.getByText("Brouillon local, jamais enregistré").first()).toBeVisible();
  const creations = () => serveur.journal.corps.filter((entry) => entry.path === "/api/spaces/finance/dashboards" && entry.method === "POST");
  const count = creations().length;
  await tabTo(page.getByRole("button", { name: /Remplir l.emplacement/, exact: false }).first()); await page.keyboard.press("Enter");
  await tabTo(page.getByRole("dialog").getByRole("button", { name: "Choisir une analyse" })); await page.keyboard.press("Enter");
  await tabTo(page.getByRole("dialog").getByRole("button", { name: /Ventes · Partagée/ })); await page.keyboard.press("Enter");
  await tabTo(page.getByRole("dialog").getByRole("button", { name: "Remplir", exact: true })); await page.keyboard.press("Enter");
  expect(creations()).toHaveLength(count);
  await tabTo(page.getByRole("button", { name: "Enregistrer", exact: true })); await page.keyboard.press("Enter");
  await expect.poll(() => creations().length).toBe(count + 1);
  expect(creations().at(-1)?.body).toMatchObject({ template: { template_id: modelId, revision: 1 }, theme: { theme_id: themeId, revision: 1 } });
  await expect(page.getByRole("link", { name: "Historique des révisions" })).toBeVisible();
  for (const base of ["Skifer clair", "Skifer ardoise"]) { const toggle = page.getByRole("group", { name: "Thème", exact: true }).getByRole("button", { name: base, exact: true }); await tabTo(toggle); await page.keyboard.press("Enter"); await expect(toggle).toHaveAttribute("aria-pressed", "true"); expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); }
  expect(serveur.journal.inattendues).toEqual([]);
});

test("aucun débordement sur les écrans et le dialogue", async () => {
  const initial = page.viewportSize();
  if (initial === null) throw new Error("Viewport initial indisponible");
  const width = async () => { try { for (const w of [1280, 768, 390]) { await page.setViewportSize({ width: w, height: 900 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { message: `largeur ${String(w)}` }).toBe(0); } } finally { await page.setViewportSize(initial); } };
  for (const [path, heading] of [[`themes/${themeId}`, "Éditeur de thème"], [`modeles/${modelId}`, "Fiche du modèle de page"], [`composants/${componentId}`, "Fiche du composant"], [`dashboards/${nouveauId}`, "Issu du modèle"]] as const) {
    await page.goto(`/#/espaces/finance/${path}`); await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await width();
  }
  await expect(page.getByText("Composant : Composant révisé r2")).toBeVisible();
  await page.goto("/#/espaces/finance/dashboards");
  await page.getByRole("button", { name: "Nouveau dashboard" }).click();
  await expect(page.getByRole("dialog", { name: "Nouveau dashboard" })).toBeVisible();
  await width();
  await page.getByRole("dialog").getByRole("button", { name: "Annuler" }).click();
  for (const base of ["Skifer clair", "Skifer ardoise"]) { await choisirTheme(page, base); expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); }
  expect(serveur.journal.inattendues).toEqual([]);
 });

test("les brouillons ne fuient pas vers une autre créatrice", async () => {
  serveur.identite("createur");
  for (const [path, title, draft, revision] of [[`themes/${themeId}`, "Éditeur de thème", "Secret thème", 2], [`modeles/${modelId}`, "Fiche du modèle de page", "Secret modèle", 2], [`composants/${componentId}`, "Fiche du composant", "Secret composant", 3]] as const) {
    await page.goto(`/#/espaces/finance/${path}`);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Nom", exact: true }).fill(draft);
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.getByText(new RegExp(`Révision r${String(revision)} enregistrée`))).toBeVisible();
  }
  serveur.identite("autre"); await page.goto("/#/espaces/finance/themes"); await page.reload();
  for (const [segment, approved, draft] of [["themes", "Thème du créateur", "Secret thème"], ["modeles", "Modèle du parcours", "Secret modèle"], ["composants", "Composant révisé", "Secret composant"]] as const) {
    await page.goto(`/#/espaces/finance/${segment}`);
    await expect(page.getByRole("link", { name: approved, exact: true })).toBeVisible();
    await expect(page.getByText(draft, { exact: false })).toHaveCount(0);
  }
  for (const [segment, api, id, revision, code] of [["themes", "themes", themeId, 2, "theme_not_found"], ["modeles", "page-templates", modelId, 2, "page_template_not_found"], ["composants", "components", componentId, 3, "component_not_found"]] as const) {
    const responsePromise = page.waitForResponse((response) => response.url().includes(`/api/spaces/finance/${api}/${id}?revision=${String(revision)}`));
    await page.goto(`/#/espaces/finance/${segment}/${id}/revisions/${String(revision)}`);
    const response = await responsePromise; expect(response.status()).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code } });
    await expect(page.getByText(/indisponible : .*introuvable/i)).toBeVisible();
  }
  await page.goto(`/#/espaces/finance/dashboards/${autreId}`);
  await expect(page.getByRole("heading", { name: "Privé d’une autre personne", level: 1 })).toBeVisible();
  const themeChoice = page.getByRole("combobox", { name: "Thème", exact: true });
  await expect(themeChoice.getByRole("option", { name: /Thème du créateur · r1/ })).toBeAttached();
  await expect(themeChoice.getByRole("option", { name: /Secret thème/ })).toHaveCount(0);
  const palette = page.getByRole("region", { name: "Composants approuvés" });
  await expect(palette.getByRole("button", { name: /Composant révisé · r2/ })).toBeVisible();
  await expect(palette.getByText(/Secret composant/)).toHaveCount(0);
  for (const base of ["Skifer clair", "Skifer ardoise"]) { await choisirTheme(page, base); expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); }
  await page.goto("/#/espaces/finance/dashboards"); await page.getByRole("button", { name: "Nouveau dashboard" }).click();
  const dialog = page.getByRole("dialog", { name: "Nouveau dashboard" });
  const model = dialog.getByRole("combobox", { name: "Modèle de page" }); await model.focus();
  await expect(model.getByRole("option", { name: /Modèle du parcours · r1/ })).toBeAttached();
  await expect(model.getByRole("option", { name: /Secret modèle/ })).toHaveCount(0);
  const theme = dialog.getByRole("combobox", { name: "Thème", exact: true }); await theme.focus();
  await expect(theme.getByRole("option", { name: /Thème du créateur · r1/ })).toBeAttached();
  await expect(theme.getByRole("option", { name: /Secret thème/ })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Annuler" }).click();
  expect(serveur.journal.inattendues).toEqual([]);
});

test("aucun contenu envoyé ne contient de couleur brute, SQL ou requête", () => {
  const entries = serveur.journal.corps.filter((entry) => /^\/api\/spaces\/finance\/(themes|page-templates|components)(?:\/|$)/.test(entry.path));
  for (const genre of ["themes", "page-templates", "components"]) expect(entries.some((entry) => entry.path.includes(`/${genre}`))).toBe(true);
  for (const entry of entries) verifierContenu(entry.body);
  const dashboards = serveur.journal.corps.filter((entry) => entry.method === "POST" && /^\/api\/spaces\/finance\/dashboards(?:\/[^/]+\/revisions)?$/.test(entry.path)).map((entry) => entry.body as Record<string, unknown>);
  for (const dashboard of dashboards) verifierDashboard(dashboard);
  expect(dashboards.some((dashboard) => dashboard.theme !== undefined)).toBe(true);
  expect(dashboards.some((dashboard) => dashboard.template !== undefined)).toBe(true);
  expect(serveur.journal.inattendues).toEqual([]);
});
});

test("le serveur isole les brouillons et contrôle les révisions et les approbations", async ({ page }) => {
  const serveur = await servirPlan20(page); journaux.push(serveur.journal);
  await page.goto("/#/espaces/finance/themes/nouveau");
  await page.getByRole("textbox", { name: "Nom", exact: true }).fill("Privé");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page).toHaveURL(/themes\/00000000-0000-4000-8000-000000000001/);
  const request = async (path: string, method = "GET", body?: object) => page.evaluate(async ({ path: p, method: m, body: b }) => {
    const response = await fetch(`/api/spaces/finance/${p}`, { method: m, ...(b === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(b) }) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }, { path, method, body });
  const id = "00000000-0000-4000-8000-000000000001";
  expect((await request(`themes/${id}/approvals`, "POST", { revision: 1, expected_revision: 1 })).status).toBe(403);
  expect((await request(`themes/${id}`, "PUT", { expected_revision: 9 })).status).toBe(409);
  const forged = structuredClone(serveur.journal.corps[0]?.body) as { roles: { marks: { series: string } } };
  forged.roles.marks.series = "surface";
  expect(await request(`themes/${id}`, "PUT", { ...forged, expected_revision: 1 })).toMatchObject({ status: 422, body: { error: { code: "invalid_theme", reason: "token_not_admissible" } } });
  serveur.identite("autre");
  expect((await request("themes")).body.themes).toEqual([]);
  expect((await request("dashboards")).body.dashboards).toEqual([]);
  expect((await request("dashboards/7a4e2c91-5d3b-4f68-8c10-2e9b6a7d3f41")).status).toBe(404);
  expect((await request(`themes/${id}`)).status).toBe(404);
  serveur.identite("admin");
  expect((await request(`themes/${id}`)).status).toBe(200);
  expect((await request(`themes/${id}/approvals`, "POST", { revision: 1, expected_revision: 1 })).status).toBe(201);
  serveur.identite("autre");
  expect((await request(`themes/${id}`)).status).toBe(200);
});

test("le serveur refuse une référence partagée non approuvée et la suppression d'un thème consommé", async ({ page }) => {
  const serveur = await servirPlan20(page); journaux.push(serveur.journal);
  await page.goto("/#/espaces/finance/themes/nouveau");
  await page.getByRole("textbox", { name: "Nom", exact: true }).fill("Dépendance");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page).toHaveURL(/themes\/00000000-0000-4000-8000-000000000001/);
  const id = "00000000-0000-4000-8000-000000000001";
  const dashboardId = "7a4e2c91-5d3b-4f68-8c10-2e9b6a7d3f41";
  const original = serveur.dashboard.entree(dashboardId).revisions[0];
  const envoyer = async (path: string, method: string, body?: object) => page.evaluate(async ({ path: p, method: m, body: b }) => {
    const response = await fetch(`/api/spaces/finance/${p}`, { method: m, ...(b === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(b) }) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() as Record<string, unknown> };
  }, { path, method, body });
  const draft = { ...original, theme: { theme_id: id, revision: 1 }, expected_revision: 1 };
  const slot = { id: "00000000-0000-4000-8000-000000000099", type: "slot", slot: { expected: "visual", label: "Ventes" } };
  const withSlot = { ...draft, layout: { sections: [{ id: "00000000-0000-4000-8000-000000000091", rows: [{ id: "00000000-0000-4000-8000-000000000092", columns: [{ id: "00000000-0000-4000-8000-000000000093", span: 12, children: [slot] }] }] }] } };
  expect((await envoyer(`dashboards/${dashboardId}/revisions`, "POST", withSlot)).status).toBe(422);
  const refused = await envoyer(`dashboards/${dashboardId}/revisions`, "POST", { ...draft, visibility: "shared" });
  expect(refused.status).toBe(422); expect(refused.body).toMatchObject({ error: { code: "unapproved_reference", paths: ["/theme"] } });
  expect((await envoyer(`dashboards/${dashboardId}/revisions`, "POST", draft)).status).toBe(201);
  const deletion = await envoyer(`themes/${id}?expected_revision=1`, "DELETE");
  expect(deletion.status).toBe(409); expect(deletion.body).toMatchObject({ error: { code: "content_in_use", consumers: [{ id: dashboardId }] } });
});


test("le serveur versionne les modèles et composants et suit leurs consommateurs", async ({ page }) => {
  const serveur = await servirPlan20(page); journaux.push(serveur.journal);
  await page.goto("/#/espaces/finance/themes");
  const envoyer = async (path: string, method = "GET", body?: object) => page.evaluate(async ({ path: p, method: m, body: b }) => {
    const response = await fetch(`/api/spaces/finance/${p}`, { method: m, ...(b === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(b) }) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() as Record<string, unknown> };
  }, { path, method, body });
  for (const [kind, example, field] of [["page-templates", templateExample.body.page_template, "page_template"], ["components", componentExample.body.component, "component"]] as const) {
    const draft: Record<string, unknown> = { ...example };
    delete draft.api_version; delete draft.id; delete draft.owner;
    if (kind === "components") draft.analysis = { analysis_id: "00000000-0000-4000-8000-000000000015", revision: 1 };
    const created = await envoyer(kind, "POST", draft);
    expect(created.status).toBe(201);
    const id = created.body?.id as string;
    serveur.identite("autre"); expect((await envoyer(kind)).body).toMatchObject({ [kind === "components" ? "components" : "page_templates"]: [] });
    serveur.identite("admin"); expect((await envoyer(`${kind}/${id}/approvals`, "POST", { revision: 1, expected_revision: 1 })).status).toBe(201);
    serveur.identite("createur");
    const revised = await envoyer(`${kind}/${id}`, "PUT", { name: "Révisé", description: draft.description, expected_revision: 1 });
    expect(revised.status).toBe(201); expect(revised.body).toMatchObject({ revision: 2, state: "draft", approved_revision: 1, [field]: { name: "Révisé" } });
    expect((await envoyer(`${kind}/${id}/diff?from=1&to=2`)).body).toMatchObject({ changes: [{ path: "/name", before: example.name, after: "Révisé" }] });
    if (kind === "components") {
      serveur.identite("admin"); expect((await envoyer(`${kind}/${id}/approvals`, "POST", { revision: 2, expected_revision: 2 })).status).toBe(201); serveur.identite("createur");
      const dashboardId = "7a4e2c91-5d3b-4f68-8c10-2e9b6a7d3f41";
      const original = serveur.dashboard.entree(dashboardId).revisions[0];
      const child = { id: "00000000-0000-4000-8000-000000000031", type: "component", component: { component_id: id, revision: 2 } };
      const layout = { sections: [{ id: "00000000-0000-4000-8000-000000000001", rows: [{ id: "00000000-0000-4000-8000-000000000002", columns: [{ id: "00000000-0000-4000-8000-000000000003", span: 12, children: [child] }] }] }] };
      expect((await envoyer(`dashboards/${dashboardId}/revisions`, "POST", { ...original, visibility: "shared", layout, expected_revision: 1 })).status).toBe(201);
      expect(await envoyer(`${kind}/${id}?expected_revision=2`, "DELETE")).toMatchObject({ status: 409, body: { error: { code: "content_in_use", consumers: [{ id: dashboardId }] } } });
    }
  }
});
