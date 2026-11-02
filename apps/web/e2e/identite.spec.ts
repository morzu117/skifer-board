import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import etabli from "../../../contracts/identite/me-etabli.json" with { type: "json" };
import anonyme from "../../../contracts/identite/non-authentifie.json" with { type: "json" };
import deconnexion from "../../../contracts/identite/deconnexion.json" with { type: "json" };
import { attendreGraphiques, simulerEspaces, simulerIdentite } from "./aides";

test.beforeEach(async ({ page }) => {
  await simulerEspaces(page);
});

// Les deux projets de playwright.config.ts exécutent tous ces parcours : ordinateur et téléphone.
async function aucuneDonnee(page: Page) {
  await expect(page.getByRole("navigation", { name: "Navigation principale" })).toHaveCount(0);
  await expect(page.getByText("Catalogue Atlas", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Prototype graphique", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
}
async function connexion(page: Page, raison = "") {
  await simulerIdentite(page, anonyme);
  await page.goto(raison === "" ? "/" : `/?login_error=${raison}`);
  await expect(page.getByRole("heading", { level: 1, name: "Connexion requise" })).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
}
test("l'identité établie est visible dans la pastille", async ({ page }) => {
  await simulerIdentite(page, etabli);
  await page.goto("/");
  await expect(page.getByText(`Données évaluées pour ${etabli.body.identity.name}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Se déconnecter" })).toBeVisible();
});
test("le mode local dit identité non établie et ne propose pas de déconnexion", async ({ page }) => {
  await simulerIdentite(page);
  await page.goto("/");
  await expect(page.getByText(/Identité non établie/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Se déconnecter" })).toHaveCount(0);
});
test("le 401 ferme la page principale et propose le chemin de connexion du serveur", async ({ page }) => {
  await connexion(page);
  await aucuneDonnee(page);
  await expect(page.getByRole("link", { name: "Se connecter" })).toHaveAttribute("href", anonyme.body.error.login_url);
});
test("le refus du fournisseur affiche un libellé fermé", async ({ page }) => {
  await connexion(page, "provider_unavailable");
  await expect(page.getByRole("alert")).toHaveText("Le fournisseur d'identité ne répond pas. Réessayez plus tard.");
  await aucuneDonnee(page);
});
test("la déconnexion envoie POST et suit / avant de constater l'absence de session", async ({ page }) => {
  await simulerIdentite(page, etabli);
  await page.route("**/auth/logout", async (route) => {
    await simulerIdentite(page, anonyme);
    await route.fulfill({ status: deconnexion.status, json: deconnexion.body });
  });
  await page.goto("/?avant=deconnexion");
  const requete = page.waitForRequest((request) => new URL(request.url()).pathname === "/auth/logout");
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  expect((await requete).method()).toBe("POST");
  await expect(page).toHaveURL(new URL("/", page.url()).href);
  await expect(page.getByRole("heading", { name: "Connexion requise" })).toBeVisible();
  await aucuneDonnee(page);
});
test("le 401 du catalogue retire les données et annonce la session expirée", async ({ page }) => {
  await simulerIdentite(page, etabli);
  await page.route("**/api/spaces/finance/catalog**", async (route) => {
    await route.fulfill({ status: anonyme.status, json: anonyme.body });
  });
  await page.goto("/");
  await expect(page.getByText(`Données évaluées pour ${etabli.body.identity.name}`, { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Finance", exact: true }).click();
  await expect(page).toHaveURL(/#\/espaces\/finance\/catalogue$/);
  await expect(page.getByRole("heading", { name: "Connexion requise" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Votre session a expiré. Reconnectez-vous pour continuer.");
  await expect(page.getByRole("link", { name: "Se connecter" })).toHaveAttribute("href", "/auth/login");
  await aucuneDonnee(page);
});
for (const largeur of [390, 1280]) {
  test(`la connexion ne déborde pas horizontalement à ${largeur} px`, async ({ page }) => {
    await page.setViewportSize({ width: largeur, height: 900 });
    await connexion(page, "provider_unavailable");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}
for (const etat of ["connexion avec raison", "coque établie"]) {
  test(`axe sur la page entière, contraste compris : ${etat}`, async ({ page }) => {
    if (etat === "connexion avec raison") await connexion(page, "provider_unavailable");
    else {
      await simulerIdentite(page, etabli);
      await page.goto("/#/prototype");
      await expect(page.getByRole("button", { name: "Se déconnecter" })).toBeVisible();
      await attendreGraphiques(page);
    }
    const resultat = await new AxeBuilder({ page }).options({ rules: { "color-contrast": { enabled: true } } }).analyze();
    expect(resultat.violations, "Violations axe de la page entière").toEqual([]);
  });
}
test("capture de référence de la connexion sans raison", async ({ page }) => {
  await connexion(page);
  await expect(page).toHaveScreenshot("login-ecran.png", { fullPage: true });
});
test("capture de référence de la connexion avec raison", async ({ page }) => {
  await connexion(page, "provider_unavailable");
  await expect(page).toHaveScreenshot("login-raison.png", { fullPage: true });
});
