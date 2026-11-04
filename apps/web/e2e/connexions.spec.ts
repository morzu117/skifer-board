import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import espace from "../../../contracts/espaces/espace.json" with { type: "json" };
import administration from "../../../contracts/espaces/liste-administration.json" with { type: "json" };
import locale from "../../../contracts/espaces/liste-locale.json" with { type: "json" };
import etabli from "../../../contracts/identite/me-etabli.json" with { type: "json" };
import { catalogueHorsEspace, enregistrerLectures, simulerEspaces, simulerIdentite } from "./aides";

const AT = "2026-11-03T10:00:00+00:00";
const REF = { issuer: "https://id.example.invalid", subject: "admin" };
const CONNECTION = {
  name: "finance", created_at: AT, created_by: REF,
  bindings: [
    { environment: "DEV", connector: "databricks", endpoint_key: "warehouse-dev", identity_mode: "service", set_at: AT, set_by: REF, credential_state: "configured" },
    { environment: "TEST", connector: "databricks", endpoint_key: "warehouse-test", identity_mode: "service", set_at: AT, set_by: REF, credential_state: "unconfigured" },
    { environment: "PROD", state: "unconfigured" },
  ],
};
const ROOT = "/api/spaces/finance/connections";
const ENDPOINTS = "/api/spaces/finance/connection-endpoints";

async function simuler(page: Page, options: { refusal?: boolean; probeRefused?: boolean } = {}) {
  const endpoints: { key: string; host: string; warehouse_id: string }[] = [];
  await simulerIdentite(page, etabli);
  await simulerEspaces(page, { "/api/spaces": administration, "/api/spaces/finance": espace });
  await page.route((url) => url.pathname === "/api/spaces/finance/events", async (route) => {
    await route.fulfill({ status: 200, json: { events: [] } });
  });
  await page.route((url) => url.pathname.startsWith(ENDPOINTS), async (route) => {
    const request = route.request();
    if (options.refusal === true) {
      await route.fulfill({ status: 403, json: { error: { code: "forbidden" } } });
    } else if (request.method() === "GET") {
      await route.fulfill({ status: 200, json: { endpoints } });
    } else if (request.method() === "POST") {
      const endpoint = request.postDataJSON() as { key: string; host: string; warehouse_id: string };
      endpoints.push(endpoint);
      await route.fulfill({ status: 201, json: endpoint });
    } else if (request.method() === "DELETE") {
      endpoints.splice(endpoints.findIndex((endpoint) => request.url().endsWith(`/${endpoint.key}`)), 1);
      await route.fulfill({ status: 204 });
    }
  });
  await page.route((url) => url.pathname.startsWith(ROOT), async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      if (options.refusal === true) await route.fulfill({ status: 403, json: { error: { code: "forbidden" } } });
      else await route.fulfill({ status: 200, json: { connections: [CONNECTION] } });
    } else if (request.url().endsWith("/test")) {
      if (options.probeRefused === true) await route.fulfill({ status: 409, json: { error: { code: "credential_rejected" } } });
      else await route.fulfill({ status: 200, json: { identity: "service", credential_expires_at: null, can_cancel: true, state: "RUNNING" } });
    } else if (request.method() === "PUT" && request.url().endsWith("/credential")) {
      await route.fulfill({ status: 204 });
    } else {
      await route.fulfill({ status: 404, json: { error: { code: "route_not_found" } } });
    }
  });
}

test("un administrateur saisit son workspace et son warehouse dans Board", async ({ page }) => {
  await open(page);
  const form = page.getByRole("form", { name: "Ajouter un point d'accès Databricks" });
  await form.getByRole("textbox", { name: "Clé du point d'accès" }).fill("azure-test");
  await form.getByRole("textbox", { name: "URL du workspace" }).fill("https://adb-123.2.azuredatabricks.net");
  await form.getByRole("textbox", { name: "ID du SQL warehouse" }).fill("abc123");
  await form.getByRole("button", { name: "Enregistrer le point d'accès" }).click();
  await expect(page.getByText("Point d'accès azure-test enregistré.")).toBeVisible();
  await expect(page.getByText("https://adb-123.2.azuredatabricks.net")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

async function open(page: Page, options: { refusal?: boolean; probeRefused?: boolean } = {}) {
  await simuler(page, options);
  await page.goto("/#/espaces/finance/connexions");
  await expect(page.getByRole("heading", { level: 1, name: "Connexions" })).toBeVisible();
  if (options.refusal === true) await expect(page.getByRole("region", { name: "Connexions logiques" }).getByText("Votre rôle ne permet pas cette action.")).toBeVisible();
  else await expect(page.getByRole("region", { name: "Connexion finance" })).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
}

test("l'administration montre DEV, TEST, PROD et atteint la page depuis les onglets", async ({ page }) => {
  const reads = enregistrerLectures(page);
  await open(page);
  expect(catalogueHorsEspace(reads)).toEqual([]);
  const labels = page.getByRole("region", { name: "Connexion finance" }).getByRole("heading", { level: 4 });
  await expect(labels).toHaveText(["DEV", "TEST", "PROD"]);
  await expect(page.getByRole("navigation", { name: "Fil d'Ariane" }).getByRole("listitem")).toHaveText(["Finance", "Connexions"]);
  await expect(page.getByRole("link", { name: "Connexions" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("À configurer")).toBeVisible();
  await expect(page.getByText("Aucune liaison configurée.")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});

test("l'identifiant s'efface, puis l'essai annonce l'identité sans lire de donnée", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith(ROOT)) requests.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  await open(page);
  const dev = page.getByRole("region", { name: "finance · DEV" });
  await dev.getByRole("button", { name: "Remplacer l'identifiant" }).click();
  await dev.getByLabel("Nouvel identifiant").fill("secret-sentinelle");
  await dev.getByRole("button", { name: "Enregistrer l'identifiant" }).click();
  await expect(page.getByText("Identifiant DEV de finance enregistré.")).toBeVisible();
  await expect(dev.getByRole("form", { name: "Identifiant finance · DEV" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("secret-sentinelle");
  await dev.getByRole("button", { name: "Tester la connexion" }).click();
  await expect(dev.getByText(/Essai réussi pour l'identité service/)).toContainText("état RUNNING · expiration inconnue · annulation disponible");
  expect(requests).toContain(`POST ${ROOT}/finance/bindings/DEV/test`);
  expect(requests.filter((request) => request.includes("/test"))).toHaveLength(1);
});

test("un refus de lecture masque toute action", async ({ page }) => {
  await open(page, { refusal: true });
  await expect(page.getByRole("form", { name: "Créer une connexion" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tester la connexion" })).toHaveCount(0);
});

test("un identifiant refusé pendant l'essai est expliqué", async ({ page }) => {
  await open(page, { probeRefused: true });
  await page.getByRole("region", { name: "finance · DEV" }).getByRole("button", { name: "Tester la connexion" }).click();
  await expect(page.getByText(/Essai refusé : La source a refusé cet identifiant/)).toBeVisible();
});

test("mode local : le registre de l'espace ne se gère pas", async ({ page }) => {
  await simulerIdentite(page);
  await simulerEspaces(page, { "/api/spaces": locale, "/api/spaces/local": { status: 200, body: locale.body.spaces[0] } });
  const reads = enregistrerLectures(page);
  await page.goto("/#/espaces/local/connexions");
  await expect(page.getByText(/En mode local, les connexions d'un espace ne se gèrent pas/)).toBeVisible();
  expect(reads).not.toContain("/api/spaces/local/connections");
});

for (const refusal of [false, true]) {
  test(`axe sur la page entière : ${refusal ? "refus" : "registre"}`, async ({ page }) => {
    await open(page, { refusal });
    const result = await new AxeBuilder({ page }).options({ rules: { "color-contrast": { enabled: true } } }).analyze();
    expect(result.violations.map((violation) => violation.id)).toEqual([]);
  });
}

for (const state of ["registre", "formulaire", "refus"] as const) {
  test(`capture de référence de « Connexions » : ${state}`, async ({ page }) => {
    await open(page, { refusal: state === "refus" });
    if (state === "formulaire") await page.getByRole("region", { name: "finance · DEV" }).getByRole("button", { name: "Modifier la liaison" }).click();
    await expect(page).toHaveScreenshot(`connexions-${state}.png`, { fullPage: true });
  });
}

test("OAuth depuis l'URL : retour, warehouse unique prérempli et test personnel", async ({ page }) => {
  const host = "https://adb-1234567890123456.2.azuredatabricks.net";
  const oauth = "/api/spaces/finance/databricks-oauth";
  const expires = "2026-11-04T12:00:00+00:00";
  let connected = false;
  const selected: { key: string; host: string; warehouse_id: string }[] = [];
  await open(page);
  await page.route((url) => url.pathname === ENDPOINTS, async (route) => {
    await route.fulfill({ status: 200, json: { endpoints: selected } });
  });
  await page.route((url) => url.pathname.startsWith(oauth), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET") {
      await route.fulfill({ json: { configured: true, redirect_uri: "http://localhost:4174/auth/databricks/callback", connections: connected ? [{ host, expires_at: expires }] : [] } });
    } else if (path.endsWith("/start")) {
      expect(request.postDataJSON()).toEqual({ host });
      await route.fulfill({ json: { authorization_url: `${host}/oidc/v1/authorize?client_id=board-test&state=state-test&code_challenge=pkce-test` } });
    } else if (path.endsWith("/warehouses")) {
      await route.fulfill({ json: { host, expires_at: expires, warehouses: [{ id: "wh1", name: "Warehouse de recette", state: "RUNNING" }] } });
    } else if (path.endsWith("/select")) {
      const body = request.postDataJSON() as { host: string; warehouse_id: string; key: string };
      expect(body).toEqual({ host, warehouse_id: "wh1", key: "databricks_wh1" });
      selected.push(body);
      await route.fulfill({ status: 201, json: body });
    } else if (path.endsWith("/test")) {
      expect(request.postDataJSON()).toEqual({ host, warehouse_id: "wh1" });
      await route.fulfill({ json: { identity: "person", credential_expires_at: expires, can_cancel: true, state: "RUNNING" } });
    } else {
      throw new Error("Appel OAuth inattendu");
    }
  });
  await page.route(`${host}/oidc/v1/authorize?**`, async (route) => {
    expect(new URL(route.request().url()).searchParams.get("state")).toBe("state-test");
    await route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Autorisation Databricks simulée</h1>" });
  });
  await page.route("**/auth/databricks/callback?**", async (route) => {
    connected = true;
    await route.fulfill({ status: 303, headers: { Location: `http://localhost:4174/?databricks_oauth=connected&databricks_workspace=${encodeURIComponent(host)}#/espaces/finance/connexions` }, body: "" });
  });
  await page.getByRole("button", { name: "Se connecter à Databricks" }).click();
  await page.getByRole("textbox", { name: "URL du workspace Databricks" }).fill(host);
  await page.getByRole("button", { name: "Continuer vers Databricks" }).click();
  await expect(page).toHaveURL(new RegExp("/oidc/v1/authorize"));
  await page.goto("http://localhost:4174/auth/databricks/callback?state=state-test&code=code-test");
  const panel = page.getByRole("region", { name: "Connexion personnelle Databricks" });
  await expect(panel.getByRole("textbox", { name: "ID du warehouse détecté" })).toHaveValue("wh1");
  await expect(panel.getByRole("textbox", { name: "Clé du point d'accès OAuth" })).toHaveValue("databricks_wh1");
  await expect(panel.getByRole("combobox", { name: "Warehouse accessible" })).toHaveValue("wh1");
  await panel.getByRole("button", { name: "Tester avec ma connexion OAuth" }).click();
  await expect(panel.getByText(/Essai réussi pour l'identité person/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.map((item) => item.id)).toEqual([]);
  await panel.scrollIntoViewIfNeeded();
  await expect(panel).toHaveScreenshot("connexion-oauth-decouverte.png");
  await panel.getByRole("button", { name: "Enregistrer ce warehouse" }).click();
  await expect(page.getByText("Point d'accès databricks_wh1 enregistré depuis votre connexion OAuth.")).toBeVisible();
});

test("OAuth explique le Client ID manquant et l'adresse de retour", async ({ page }) => {
  await open(page);
  await page.route((url) => url.pathname === "/api/spaces/finance/databricks-oauth", async (route) => {
    await route.fulfill({ json: { configured: false, redirect_uri: "http://localhost:5174/auth/databricks/callback", connections: [] } });
  });
  await page.getByRole("button", { name: "Se connecter à Databricks" }).click();
  const panel = page.getByRole("region", { name: "Connexion personnelle Databricks" });
  await expect(panel.getByText(/Configuration OAuth requise/)).toBeVisible();
  await expect(panel.getByText("http://localhost:5174/auth/databricks/callback", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await expect(panel).toHaveScreenshot("connexion-oauth-configuration.png");
});
