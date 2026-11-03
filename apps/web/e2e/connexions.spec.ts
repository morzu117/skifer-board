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

async function simuler(page: Page, options: { refusal?: boolean; probeRefused?: boolean } = {}) {
  await simulerIdentite(page, etabli);
  await simulerEspaces(page, { "/api/spaces": administration, "/api/spaces/finance": espace });
  await page.route((url) => url.pathname === "/api/spaces/finance/events", async (route) => {
    await route.fulfill({ status: 200, json: { events: [] } });
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

async function open(page: Page, options: { refusal?: boolean; probeRefused?: boolean } = {}) {
  await simuler(page, options);
  await page.goto("/#/espaces/finance/connexions");
  await expect(page.getByRole("heading", { level: 1, name: "Connexions" })).toBeVisible();
  if (options.refusal === true) await expect(page.getByText("Votre rôle ne permet pas cette action.")).toBeVisible();
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
