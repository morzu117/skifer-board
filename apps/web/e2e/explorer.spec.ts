import AxeBuilder from "@axe-core/playwright";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import { expect, test, type Page, type Route } from "@playwright/test";
import catalogue from "../../../contracts/catalogue/liste.json" with { type: "json" };
import refusLocal from "../../../contracts/executions/champs-mode-local.json" with { type: "json" };
import champs from "../../../contracts/executions/champs.json" with { type: "json" };
import connexions from "../../../contracts/executions/explorer-connexions.json" with { type: "json" };
import detail from "../../../contracts/executions/contextuel-detail.json" with { type: "json" };
import total from "../../../contracts/executions/contextuel-selection.json" with { type: "json" };
import part from "../../../contracts/executions/contextuel-part.json" with { type: "json" };
import indisponible from "../../../contracts/executions/contextuel-indisponible.json" with { type: "json" };
import etabli from "../../../contracts/identite/me-etabli.json" with { type: "json" };
import local from "../../../contracts/identite/me-local.json" with { type: "json" };
import locale from "../../../contracts/espaces/liste-locale.json" with { type: "json" };
import { choisirTheme, simulerEspaces, simulerIdentite } from "./aides";

const ID = detail.body.id;
const ROOT = "/api/spaces/finance/executions";
const PREUVE = detail.body.evidence.evidence_id;
const DATE = "2026-11-04T12:00:00Z";
const SENTINELLE = "SELECT secret FROM source";
const FILTRE = { column: "prix", operator: "eq", value: 10 };
const MODELE = champs.body.models[0];
if (MODELE === undefined || MODELE.metrics[0] === undefined) throw new Error("Contrat incomplet");
const CHAMPS_SENTINELLE = {
  models: [{
    ...MODELE,
    metrics: [{ ...MODELE.metrics[0], description: SENTINELLE }],
    dimensions: [
      ...MODELE.dimensions,
      { name: "region", label: "Région", description: "Région commerciale", type: "string", is_time: false },
      { name: "prix", label: "Prix", description: "Prix unitaire", type: "number", is_time: false },
    ],
  }],
};
const CHAMPS = {
  models: [{ ...CHAMPS_SENTINELLE.models[0], metrics: MODELE.metrics }],
};
const CHAMPS_NON_ADDITIFS = {
  models: [{
    ...CHAMPS.models[0],
    metrics: [{ ...MODELE.metrics[0], aggregation: "avg", additivity: "non_additive" }],
  }],
};
const EVIDENCE = {
  ...detail.body.evidence,
  dimensions: ["region"],
  metrics: [detail.body.evidence.metrics[0]],
  compiled_at: DATE,
  executed_at: DATE,
  policy: { ...detail.body.evidence.policy, evaluated_at: DATE },
};
const BASE = {
  id: ID,
  space_id: "finance",
  environment: "DEV",
  connection: "source",
  created_at: DATE,
  started_at: DATE,
  deadline_at: "2026-11-04T12:01:00Z",
  cancel_requested: false,
  error_code: null,
};
const RUNNING = {
  ...BASE,
  state: "running",
  finished_at: null,
  rows: null,
  size: null,
  truncated: null,
  can_cancel: true,
};
const TOTAL = { ...total.body, rows: [{ revenue: 12 }] };
const PART = { ...part.body, rows: [{ revenue: 12, share: 12 / 17 }], row_count: 1 };
const INDISPONIBLE = {
  ...indisponible.body,
  reason: "non_additive",
  engine_request: { ...indisponible.body.engine_request, metric: "revenue" },
};
type Mode = "success" | "deny" | "require_human" | "error" | "truncated" | "empty" | "unavailable";
type Compteurs = { posts: number; results: number; contextual: unknown[] };

function resultat(mode: Mode) {
  const regions = mode === "empty" ? [] : ["Nord", "Sud"];
  const chiffres = mode === "empty" ? new Float64Array() : [12, 5];
  return tableToIPC(tableFromArrays({ region: regions, revenue: chiffres }), "stream");
}
function detailTerminal(mode: Mode, taille: number) {
  if (mode === "deny" || mode === "require_human" || mode === "error") {
    return {
      ...RUNNING,
      state: mode === "error" ? "failed" : "denied",
      error_code: mode === "error" ? "execution_failed" : mode,
      finished_at: DATE,
      can_cancel: false,
      evidence: null,
      connector_run_id: null,
    };
  }
  return {
    ...detail.body,
    ...BASE,
    state: "succeeded",
    finished_at: DATE,
    can_cancel: false,
    evidence: EVIDENCE,
    rows: mode === "empty" ? 0 : 2,
    size: taille,
    truncated: mode === "truncated",
    result_contract: {
      ...detail.body.result_contract,
      dimensions: ["region"],
      metrics: mode === "unavailable"
        ? [{ name: "revenue", aggregation: "avg", additivity: "non_additive" }]
        : [detail.body.result_contract.metrics[0]],
      completeness: mode === "truncated" ? "truncated" : "complete",
    },
  };
}
async function calcul(route: Route, mode: Mode, compteurs: Compteurs) {
  const body: unknown = route.request().postDataJSON();
  compteurs.contextual.push(body);
  const attendu = {
    metric: "revenue",
    group_by: [],
    selection: { region: ["Nord"] },
    scope: null,
  };
  const aggregate = { ...attendu, operation: "aggregate", denominator: null };
  const share = { ...attendu, operation: "share", denominator: "loaded_result" };
  expect([aggregate, share]).toContainEqual(body);
  if (mode === "unavailable") {
    await route.fulfill({ json: INDISPONIBLE });
    return;
  }
  const isTotal = (body as { operation: string }).operation === "aggregate";
  const reponse = isTotal ? TOTAL : PART;
  await route.fulfill({ json: mode === "truncated" ? { ...reponse, partial: true, scope: "loaded_result" } : reponse });
}
async function mockExecutions(page: Page, mode: Mode, filtres: unknown[], compteurs: Compteurs) {
  const arrow = resultat(mode);
  await page.route(`${ROOT}**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === ROOT && request.method() === "POST") {
      compteurs.posts += 1;
      expect(request.postDataJSON()).toEqual({
        connection: "source", environment: "DEV", model: "orders",
        metrics: ["revenue"], dimensions: ["region"], filters: filtres,
      });
      await route.fulfill({ status: 202, json: RUNNING });
    } else if (path.endsWith("/result")) {
      compteurs.results += 1;
      await route.fulfill({ contentType: "application/vnd.apache.arrow.stream", body: Buffer.from(arrow) });
    } else if (path.endsWith("/contextual")) {
      await calcul(route, mode, compteurs);
    } else if (path === `${ROOT}/${ID}`) {
      await route.fulfill({ json: detailTerminal(mode, arrow.byteLength) });
    } else {
      throw new Error(`Exécution inattendue : ${request.method()} ${path}`);
    }
  });
}
async function interdireReseau(page: Page) {
  await page.route("**/api/**", async (route) => {
    await route.abort();
    throw new Error(`Appel API inattendu : ${route.request().url()}`);
  });
}
async function setup(page: Page, mode: Mode = "success", filtres: unknown[] = [], sentinelle = false) {
  const compteurs: Compteurs = { posts: 0, results: 0, contextual: [] };
  await page.clock.setFixedTime(new Date("2026-11-04T12:30:00Z"));
  await interdireReseau(page);
  await simulerIdentite(page, etabli);
  await simulerEspaces(page);
  await page.route("**/api/spaces/finance/catalog**", async (route) => {
    await route.fulfill({ json: catalogue.body });
  });
  await page.route("**/api/spaces/finance/explorer/*", async (route) => {
    const fields = route.request().url().endsWith("/fields");
    let reponse: unknown = connexions.body;
    if (fields) {
      reponse = CHAMPS;
      if (sentinelle) reponse = CHAMPS_SENTINELLE;
      if (mode === "unavailable") reponse = CHAMPS_NON_ADDITIFS;
    }
    await route.fulfill({ json: reponse });
  });
  await mockExecutions(page, mode, filtres, compteurs);
  await page.goto("/#/espaces/finance/catalogue");
  const navigation = page.getByRole("navigation", { name: "Navigation principale" });
  await navigation.getByRole("button", { name: "Explorer" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Explorer" })).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
  return compteurs;
}
async function composer(page: Page, filtre = false) {
  await page.getByRole("combobox", { name: "Connexion", exact: true }).selectOption("source");
  await page.getByRole("combobox", { name: "Modèle", exact: true }).selectOption("orders");
  const recherche = page.getByLabel("Rechercher un champ");
  await recherche.fill("chiffre");
  await page.getByRole("checkbox", { name: /Chiffre d'affaires/ }).focus();
  await page.keyboard.press("Space");
  await recherche.fill("région");
  await page.getByRole("checkbox", { name: /Région/ }).focus();
  await page.keyboard.press("Space");
  await recherche.fill("");
  if (filtre) {
    await page.getByLabel("Dimension du filtre").selectOption("prix");
    await page.getByLabel("Valeur", { exact: true }).fill("10");
  }
}
async function ajouterFiltre(page: Page) {
  await page.getByLabel("Valeur", { exact: true }).press("Enter");
  await expect(page.getByRole("button", { name: "Retirer le filtre prix" })).toBeVisible();
}
async function executer(page: Page) {
  await page.getByRole("button", { name: "Exécuter", exact: true }).focus();
  await page.keyboard.press("Enter");
}
async function selection(page: Page) {
  await expect(page.getByRole("tab", { name: "Tableau" })).toBeVisible();
  await page.getByRole("tab", { name: "Tableau" }).click();
  await page.getByRole("checkbox", { name: /^Sélectionner la ligne 1/ }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("table", { name: "Calculs contextuels" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Total : revenue/ })).toBeVisible();
}
async function axe(page: Page) {
  const report = await new AxeBuilder({ page }).analyze();
  expect(report.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.failureSummary) }))).toEqual([]);
}
async function sansDebordement(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
}

test("parcours clavier, calcul et preuves", async ({ page }) => {
  const appels = await setup(page, "success", [FILTRE], true);
  await composer(page, true);
  await page.getByLabel("Rechercher un champ").press("Enter");
  await page.waitForTimeout(350);
  expect(appels.posts).toBe(0);
  await ajouterFiltre(page);
  await page.waitForTimeout(350);
  expect(appels.posts).toBe(0);
  await executer(page);
  await expect(page.getByText(/Chargement du résultat/)).toBeVisible();
  await selection(page);
  const totalRow = page.getByRole("row", { name: /Total : revenue/ });
  const partRow = page.getByRole("row", { name: /Part : revenue/ });
  await expect(totalRow).toContainText("12 · 1 ligne");
  await expect(totalRow).toContainText(PREUVE);
  await expect(partRow).toContainText("≈ 70,59 %");
  await expect(partRow).toContainText("rapport exact : 0,7058823529411765");
  await expect(partRow).toContainText(PREUVE);
  expect(appels.contextual).toHaveLength(2);
  await page.getByRole("button", { name: "Effacer la sélection" }).click();
  await page.getByRole("tab", { name: "Graphique" }).click();
  const graphique = page.getByRole("group", { name: "Résultat" });
  await expect(graphique.getByRole("img").locator("svg")).toBeVisible();
  await graphique.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("Nord : 12", { exact: true })).toHaveAttribute("aria-live", "polite");
  await page.keyboard.press("Enter");
  await expect(totalRow).toContainText(PREUVE);
  const bouton = page.getByRole("button", { name: "Preuves", exact: true });
  await bouton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Preuves" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(bouton).toBeFocused();
  // Les formes de preuve sont fermées : la sentinelle est un libellé public légitime.
  await expect(page.getByRole("region", { name: "Champs" })).toContainText(SENTINELLE);
  await expect(page.locator("main").getByText(SENTINELLE)).toHaveCount(1);
  expect(appels.posts).toBe(1);
});
for (const mode of ["deny", "require_human"] as const) {
  test(`refus ${mode}`, async ({ page }) => {
    const appels = await setup(page, mode);
    await composer(page);
    await executer(page);
    const code = mode === "deny" ? "DENY" : "REQUIRE_HUMAN";
    const autre = mode === "deny" ? "REQUIRE_HUMAN" : "DENY";
    await expect(page.getByText(`Décision : ${code}`, { exact: false })).toContainText("Raisons détaillées non fournies");
    await expect(page.getByText(`Décision : ${autre}`, { exact: false })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Provenance" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Preuves", exact: true })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Tableau" })).toHaveCount(0);
    expect(appels.results).toBe(0);
    await axe(page);
  });
}
test("erreur", async ({ page }) => {
  await setup(page, "error");
  await composer(page);
  await executer(page);
  await expect(page.getByText(/Échec de l'exécution/)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Tableau" })).toHaveCount(0);
  await axe(page);
});
test("résultat tronqué", async ({ page }) => {
  await setup(page, "truncated");
  await composer(page);
  await executer(page);
  await expect(page.getByText(/Résultat partiel/)).toBeVisible();
  await selection(page);
  await expect(page.getByRole("row", { name: /Total : revenue/ })).toContainText("sur le résultat chargé");
  await axe(page);
});
test("résultat vide avec filtre", async ({ page }) => {
  await setup(page, "empty", [FILTRE]);
  await composer(page, true);
  await ajouterFiltre(page);
  await executer(page);
  await expect(page.getByText(/Aucune ligne pour ce contexte/)).toBeVisible();
  await expect(page.getByText(/prix · eq · 10/)).toBeVisible();
  await axe(page);
});
test("calcul indisponible sans nouvelle exécution", async ({ page }) => {
  const appels = await setup(page, "unavailable");
  await composer(page);
  await executer(page);
  await selection(page);
  const totalRow = page.getByRole("row", { name: /Total : revenue/ });
  await expect(totalRow).toContainText("La métrique n'est pas additive");
  await expect(totalRow).not.toContainText("12");
  const partRow = page.getByRole("row", { name: /Part : revenue/ });
  await expect(partRow).toContainText("La métrique n'est pas additive");
  await expect(partRow).not.toContainText("70,59");
  await page.waitForTimeout(400);
  expect(appels.posts).toBe(1);
  await axe(page);
});
test("SK-12 et changement d'environnement", async ({ page }) => {
  const appels = await setup(page);
  await expect(page.getByText(/Filtre temporel indisponible.*SK-12/)).toBeVisible();
  await expect(page.getByLabel("Dimension du filtre").locator('option[value="jour"]')).toHaveCount(0);
  await composer(page);
  await executer(page);
  await expect(page.getByRole("region", { name: "Provenance" })).toBeVisible();
  await page.getByRole("banner").getByRole("button", { name: "TEST", exact: true }).click();
  await expect(page.getByText(/Environnement : TEST/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Provenance" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Tableau" })).toHaveCount(0);
  await page.waitForTimeout(350);
  expect(appels.posts).toBe(1);
  await axe(page);
});
test("mode local", async ({ page }) => {
  let posts = 0;
  page.on("request", (request) => { if (request.method() === "POST") posts += 1; });
  await interdireReseau(page);
  await simulerIdentite(page, local);
  await simulerEspaces(page, { "/api/spaces": locale, "/api/spaces/local": { status: 200, body: locale.body.spaces[0] } });
  await page.route("**/api/spaces/local/explorer/*", async (route) => {
    await route.fulfill({ status: refusLocal.status, json: refusLocal.body });
  });
  await page.goto("/?mode=local#/espaces/local/explorer");
  await expect(page.getByText(/exploration n’est pas disponible en mode local/i)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Navigation principale" }).getByText(/mode local/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Exécuter" })).toHaveCount(0);
  expect(posts).toBe(0);
  await axe(page);
});
test("largeurs, graphique, preuves et défilement", async ({ page }) => {
  await setup(page);
  await composer(page);
  await executer(page);
  await selection(page);
  await page.getByRole("button", { name: "Preuves", exact: true }).click();
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await sansDebordement(page);
    await page.getByRole("tab", { name: "Graphique" }).click();
    await expect(page.getByRole("group", { name: "Résultat" }).getByRole("img").locator("svg")).toBeVisible();
    await sansDebordement(page);
    await page.getByRole("tab", { name: "Tableau" }).click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const tableau = page.getByRole("group", { name: "Valeurs du résultat" });
  const sizes = await tableau.evaluate((element) => ({ scroll: element.scrollWidth, visible: element.clientWidth }));
  expect(sizes.scroll).toBeGreaterThan(sizes.visible);
  const calculs = page.getByRole("region", { name: "Calculs contextuels" });
  await expect(calculs).toHaveAttribute("tabindex", "0");
  const mesures = await calculs.evaluate((element) => {
    const boite = element.getBoundingClientRect();
    const cellules = [...element.querySelectorAll("tbody th, tbody td")];
    return {
      disposition: getComputedStyle(cellules[0] as Element).display,
      largeur: element.clientWidth,
      debordement: element.scrollWidth - element.clientWidth,
      visibles: cellules.every((cell) => {
        const rect = cell.getBoundingClientRect();
        return rect.left >= boite.left && rect.right <= boite.right;
      }),
    };
  });
  expect(mesures.disposition).toBe("block");
  expect(mesures.largeur).toBeGreaterThan(280);
  expect(mesures.debordement).toBe(0);
  expect(mesures.visibles).toBe(true);
  await expect(calculs.getByRole("columnheader", { name: "Preuve source" })).toBeAttached();
  await expect(calculs.getByRole("row", { name: /Total : revenue/ })).toContainText(PREUVE);
  await expect(calculs.getByRole("row", { name: /Part : revenue/ })).toContainText("≈ 70,59 %");
  await axe(page);
  await tableau.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => tableau.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
});
for (const theme of ["Skifer clair", "Skifer ardoise"] as const) {
  test(`capture et axe ${theme}`, async ({ page }) => {
    await setup(page);
    await composer(page);
    await executer(page);
    await selection(page);
    await choisirTheme(page, theme);
    await page.getByRole("button", { name: "Preuves", exact: true }).click();
    await expect(page.getByRole("region", { name: "Preuves" })).toBeFocused();
    await axe(page);
    await expect(page).toHaveScreenshot(`explorer-${theme === "Skifer clair" ? "clair" : "ardoise"}.png`, { fullPage: true });
  });
}
