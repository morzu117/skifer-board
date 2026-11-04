import AxeBuilder from "@axe-core/playwright";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import { expect, test, type Page } from "@playwright/test";
import espace from "../../../contracts/espaces/espace.json" with { type: "json" };
import exemple from "../../../contracts/executions/contextuel-detail.json" with { type: "json" };
import liste from "../../../contracts/espaces/liste.json" with { type: "json" };
import etabli from "../../../contracts/identite/me-etabli.json" with { type: "json" };
import locale from "../../../contracts/espaces/liste-locale.json" with { type: "json" };
import { choisirTheme, simulerEspaces, simulerIdentite } from "./aides";

const ID = "11111111-1111-1111-1111-111111111111";
const ROOT = "/api/spaces/finance/executions";
const COLUMNS = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`mesure_${index + 1}`, [index + 1, index + 2]]));
const ARROW = tableToIPC(tableFromArrays(COLUMNS), "stream");
const RUN = {
  id: ID, space_id: "finance", environment: "DEV", connection: "source", state: "succeeded",
  created_at: "2026-11-04T00:00:00Z", started_at: "2026-11-04T00:00:01Z", finished_at: "2026-11-04T00:00:02Z",
  deadline_at: "2026-11-04T00:00:30Z", can_cancel: false, cancel_requested: false,
  error_code: null, rows: 2, size: ARROW.byteLength, truncated: true,
};
const DETAIL = { ...RUN, evidence: { evidence_id: "preuve-123", sql_hash: "empreinte-456", execution_status: "succeeded", model_keys: ["orders"] }, connector_run_id: null, result_contract: { ...exemple.body.result_contract, completeness: "truncated" } };
const RUNNING = { ...RUN, state: "running", finished_at: null, rows: null, size: null, truncated: null, can_cancel: true };

type Mode = "reader" | "admin" | "refused" | "session" | "failure" | "local" | "running";
async function simulate(page: Page, mode: Mode): Promise<string[]> {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith(ROOT)) requests.push(`${request.method()} ${url.pathname}${url.search}`);
  });
  await simulerIdentite(page, etabli);
  if (mode === "local") {
    await simulerEspaces(page, { "/api/spaces": locale, "/api/spaces/local": { status: 200, body: locale.body.spaces[0] } });
    return requests;
  }
  const readerSpace = { ...espace.body, role: "reader" };
  await simulerEspaces(page, { "/api/spaces": liste, "/api/spaces/finance": { status: 200, body: mode === "admin" ? espace.body : readerSpace } });
  await page.route((url) => url.pathname.startsWith(ROOT), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (mode === "failure") { await route.abort("failed"); return; }
    if (mode === "session") { await route.fulfill({ status: 401, json: { error: { code: "unauthenticated" } } }); return; }
    if (mode === "refused") { await route.fulfill({ status: 403, json: { error: { code: "forbidden" } } }); return; }
    if (path.endsWith("/result")) {
      await route.fulfill({ status: 200, contentType: "application/vnd.apache.arrow.stream", body: Buffer.from(ARROW) });
    } else if (path.endsWith("/cancel") && request.method() === "POST") {
      await route.fulfill({ status: 200, json: { ...RUNNING, can_cancel: false, cancel_requested: true, evidence: null, connector_run_id: null } });
    } else if (path === `${ROOT}/${ID}`) {
      await route.fulfill({ status: 200, json: mode === "admin" ? RUN : mode === "running" ? { ...RUNNING, evidence: null, connector_run_id: null } : DETAIL });
    } else if (path === ROOT && request.method() === "GET") {
      await route.fulfill({ status: 200, json: { executions: [mode === "running" ? RUNNING : RUN] } });
    } else {
      await route.fulfill({ status: 404, json: { error: { code: "execution_not_found" } } });
    }
  });
  return requests;
}

async function open(page: Page, mode: Mode) {
  const requests = await simulate(page, mode);
  await page.goto(mode === "local" ? "/?mode=local#/espaces/local/executions" : `/?mode=${mode}#/espaces/finance/executions`);
  if (mode === "session") await expect(page.getByText(/Votre session a expiré/)).toBeVisible();
  else await expect(page.getByRole("heading", { level: 1, name: "Exécutions" })).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
  return requests;
}

test("le lecteur ouvre ses exécutions depuis l'accueil, lit la preuve et un résultat sans SQL", async ({ page }) => {
  const requests = await simulate(page, "reader");
  await page.goto("/");
  await page.getByRole("link", { name: "Exécutions de Finance" }).click();
  await expect(page).toHaveURL(/#\/espaces\/finance\/executions$/);
  await page.getByRole("button", { name: /source · DEV/ }).click();
  const detail = page.getByRole("region", { name: "Détail de l'exécution" });
  await expect(detail).toContainText("preuve-123");
  await expect(detail).toContainText("tronqué");
  await expect(detail).not.toContainText("SELECT");
  await expect(page.getByRole("group", { name: "Portée des exécutions" })).toHaveCount(0);
  await detail.getByRole("button", { name: "Aperçu du résultat" }).click();
  await expect(page.getByRole("region", { name: "Aperçu du résultat" }).getByRole("row")).toHaveCount(3);
  expect(requests).toContain(`GET ${ROOT}/${ID}/result`);
});

test("l'administration lit la portée espace sans résultat d'autrui", async ({ page }) => {
  const requests = await open(page, "admin");
  await page.getByRole("button", { name: "Espace", exact: true }).click();
  await page.getByRole("button", { name: /source · DEV/ }).click();
  const detail = page.getByRole("region", { name: "Détail de l'exécution" });
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("button", { name: "Aperçu du résultat" })).toHaveCount(0);
  expect(requests).toContain(`GET ${ROOT}?scope=space`);
  expect(requests.some((request) => request.endsWith("/result"))).toBe(false);
});

test("l'annulation reste une demande jusqu'à confirmation", async ({ page }) => {
  await open(page, "running");
  await page.getByRole("button", { name: /source · DEV/ }).click();
  await page.getByRole("button", { name: "Demander l'annulation" }).click();
  await expect(page.getByText("Annulation demandée, en attente de confirmation de la source.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Demander l'annulation" })).toHaveCount(0);
});

test("refus, session expirée, mode local et panne sont annoncés", async ({ page }) => {
  await open(page, "refused");
  await expect(page.getByText("Votre rôle ne permet pas cette action.")).toBeVisible();
  await page.unrouteAll();
  await open(page, "session");
  await expect(page.getByText(/Votre session a expiré/)).toBeVisible();
  await page.unrouteAll();
  const localRequests = await open(page, "local");
  await expect(page.getByText("Les exécutions suivies ne sont pas disponibles en mode local.")).toBeVisible();
  expect(localRequests).toEqual([]);
  await page.unrouteAll();
  await open(page, "failure");
  await expect(page.getByText(/Le serveur Board ne répond pas/)).toBeVisible();
});

test("axe, largeurs et défilement du résultat restent dans la carte", async ({ page }) => {
  await open(page, "reader");
  await page.getByRole("button", { name: /source · DEV/ }).click();
  await page.getByRole("button", { name: "Aperçu du résultat" }).click();
  const region = page.getByRole("region", { name: "Aperçu du résultat" });
  await expect(region.getByRole("row")).toHaveCount(3);
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const sizes = await page.evaluate(() => ({ page: document.documentElement.scrollWidth - document.documentElement.clientWidth, card: document.querySelector<HTMLElement>(".sb-executions__result")?.scrollWidth ?? 0, visible: document.querySelector<HTMLElement>(".sb-executions__result")?.clientWidth ?? 0 }));
    expect(sizes.page).toBe(0);
    expect(sizes.card).toBeGreaterThan(sizes.visible);
  }
  await region.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  const report = await new AxeBuilder({ page }).options({ rules: { "color-contrast": { enabled: true } } }).analyze();
  expect(report.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
});

for (const theme of ["Skifer clair", "Skifer ardoise"] as const) {
  test(`capture et axe sous ${theme}`, async ({ page }) => {
    await open(page, "reader");
    await page.getByRole("button", { name: /source · DEV/ }).click();
    await page.getByRole("button", { name: "Aperçu du résultat" }).click();
    await expect(page.getByRole("region", { name: "Aperçu du résultat" }).getByRole("row")).toHaveCount(3);
    await choisirTheme(page, theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    const report = await new AxeBuilder({ page }).options({ rules: { "color-contrast": { enabled: true } } }).analyze();
    expect(report.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
    await expect(page).toHaveScreenshot(`executions-${theme === "Skifer clair" ? "clair" : "ardoise"}.png`, { fullPage: true });
  });
}

test("le lecteur connecte OAuth, revient à Exécutions et lance sa lecture sans configurer les points partagés", async ({ page }) => {
  const host = "https://adb-1234567890123456.2.azuredatabricks.net";
  const oauth = "/api/spaces/finance/databricks-oauth";
  const expires = "2026-11-04T12:00:00Z";
  let connected = false;
  const sharedWrites: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("connection-endpoints")) sharedWrites.push(request.url());
  });
  await open(page, "reader");
  await page.route((url) => url.pathname.startsWith(oauth), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET") {
      await route.fulfill({ json: { configured: true, redirect_uri: "http://localhost:4174/auth/databricks/callback", connections: connected ? [{ host, expires_at: expires }] : [] } });
    } else if (path.endsWith("/start")) {
      expect(request.postDataJSON()).toEqual({ host, return_to: "executions" });
      await route.fulfill({ json: { authorization_url: `${host}/oidc/v1/authorize?client_id=board-test&state=reader-state` } });
    } else if (path.endsWith("/warehouses")) {
      await route.fulfill({ json: { host, expires_at: expires, warehouses: [{ id: "warehouse", name: "Warehouse du lecteur", state: "RUNNING" }] } });
    } else if (path.endsWith("/test")) {
      await route.fulfill({ json: { identity: "person", credential_expires_at: expires, can_cancel: true, state: "RUNNING" } });
    } else {
      throw new Error("Un lecteur ne doit pas enregistrer de point partagé");
    }
  });
  await page.route((url) => url.pathname === ROOT, async (route) => {
    if (route.request().method() !== "POST") { await route.fallback(); return; }
    expect(route.request().postDataJSON()).toEqual({ connection: "source", environment: "DEV", model: "orders", metrics: ["revenue"], dimensions: [], filters: [] });
    await route.fulfill({ status: 202, json: RUNNING });
  });
  await page.route(`${host}/oidc/v1/authorize?**`, async (route) => {
    await route.fulfill({ contentType: "text/html", body: "<h1>Consentement Databricks simulé</h1>" });
  });
  await page.route("**/auth/databricks/callback?**", async (route) => {
    connected = true;
    await route.fulfill({ status: 303, headers: { Location: `http://localhost:4174/?databricks_oauth=connected&databricks_workspace=${encodeURIComponent(host)}#/espaces/finance/executions` }, body: "" });
  });
  await page.getByRole("button", { name: "Se connecter à Databricks" }).click();
  await page.getByRole("textbox", { name: "URL du workspace Databricks" }).fill(host);
  await page.getByRole("button", { name: "Continuer vers Databricks" }).click();
  await expect(page).toHaveURL(/\/oidc\/v1\/authorize/);
  await page.goto("http://localhost:4174/auth/databricks/callback?state=reader-state&code=reader-code");
  await expect(page).toHaveURL(/#\/espaces\/finance\/executions$/);
  await expect(page.getByRole("heading", { level: 1, name: "Exécutions" })).toBeVisible();
  const personal = page.getByRole("region", { name: "Connexion personnelle Databricks" });
  await expect(personal.getByRole("group", { name: "Warehouse personnel" })).toBeVisible();
  await expect(personal.getByRole("button", { name: "Enregistrer ce warehouse" })).toHaveCount(0);
  await expect(personal.getByRole("textbox", { name: "Clé du point d'accès OAuth" })).toHaveCount(0);
  await personal.getByRole("button", { name: "Tester avec ma connexion OAuth" }).click();
  await expect(personal.getByText(/Essai réussi pour l'identité person/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await personal.scrollIntoViewIfNeeded();
  await expect(personal).toHaveScreenshot("oauth-personnel-lecteur.png");
  await choisirTheme(page, "Skifer ardoise");
  expect((await new AxeBuilder({ page }).analyze()).violations.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => node.failureSummary) }))).toEqual([]);
  await choisirTheme(page, "Skifer clair");
  const submit = page.getByRole("region", { name: "Lancer une exécution" });
  await submit.getByRole("textbox", { name: "Connexion", exact: true }).fill("source");
  await submit.getByRole("textbox", { name: "Modèle sémantique" }).fill("orders");
  await submit.getByRole("textbox", { name: /Métriques/ }).fill("revenue");
  await submit.getByRole("button", { name: "Lancer", exact: true }).click();
  await expect(page.getByText("Exécution soumise. Son état est suivi ci-dessous.")).toBeVisible();
  await page.getByRole("button", { name: "Aperçu du résultat" }).click();
  await expect(page.getByRole("region", { name: "Aperçu du résultat" }).getByRole("row")).toHaveCount(3);
  expect(sharedWrites).toEqual([]);
  expect((await new AxeBuilder({ page }).analyze()).violations.map((item) => item.id)).toEqual([]);
});
