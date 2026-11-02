import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import catalogue from "../../../contracts/catalogue/liste.json" with { type: "json" };
import espace from "../../../contracts/espaces/espace.json" with { type: "json" };
import liste from "../../../contracts/espaces/liste.json" with { type: "json" };
import locale from "../../../contracts/espaces/liste-locale.json" with { type: "json" };
import etabli from "../../../contracts/identite/me-etabli.json" with { type: "json" };
import local from "../../../contracts/identite/me-local.json" with { type: "json" };
import { catalogueHorsEspace, enregistrerLectures, simulerEspaces, simulerIdentite, type Exemple } from "./aides";

// Environnements dans la coque (plan 09, 9.3) : la bascule DEV | TEST | PROD marque, dans un espace,
// les environnements où la personne peut déployer ; la ligne « Déploiement » le dit sous le rôle.
// Les deux projets de playwright.config.ts exécutent ces parcours : ordinateur et téléphone (390 px).

/** Finance telle que le serveur la rend à cette session dans la liste : créatrice, accord en DEV. */
const financeCreateur: Exemple = { status: 200, body: liste.body.spaces[0] };
const espaceLocal: Exemple = { status: 200, body: locale.body.spaces[0] };

let lectures: string[] = [];
test.beforeEach(async ({ page }) => {
  lectures = enregistrerLectures(page);
  await page.clock.setFixedTime(new Date("2026-11-01T12:30:00Z"));
});
test.afterEach(() => {
  expect(catalogueHorsEspace(lectures)).toEqual([]);
});

async function simulerCatalogue(page: Page, espaceId: string): Promise<void> {
  await page.route(`**/api/spaces/${espaceId}/catalog**`, async (route) => {
    await route.fulfill({ status: catalogue.status, json: catalogue.body });
  });
}
async function polices(page: Page) {
  await page.evaluate(async () => { await document.fonts.ready; });
}
async function ouvrirCatalogue(page: Page, espaceId: string) {
  await page.goto(`/#/espaces/${espaceId}/catalogue`);
  await expect(page.getByRole("heading", { level: 1, name: "Catalogue Atlas" })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await polices(page);
}
/** Créatrice de finance, accord en DEV (exemples du serveur réel). */
async function createur(page: Page) {
  await simulerIdentite(page, etabli);
  await simulerEspaces(page, { "/api/spaces/finance": financeCreateur });
  await simulerCatalogue(page, "finance");
  await ouvrirCatalogue(page, "finance");
}
/** Mode local : la personne locale déploie dans les trois environnements (V8). */
async function modeLocal(page: Page) {
  await simulerIdentite(page, local);
  await simulerEspaces(page, { "/api/spaces": locale, "/api/spaces/local": espaceLocal });
  await simulerCatalogue(page, "local");
  await ouvrirCatalogue(page, "local");
}
const bascule = (page: Page) => page.getByRole("banner").getByRole("group", { name: "Environnement" });
const segment = (page: Page, code: string) => bascule(page).getByRole("button", { name: code, exact: true });
/** Marques « ● » affichées ; la place de la marque est toujours réservée, vide sans droit. */
const marques = (page: Page) => bascule(page).locator(".sb-env__deploy").filter({ hasText: "●" });
const AUTORISE = "Déploiement autorisé";
/** Chaque segment garde son nom exact ; le droit est sa description, seulement sur les segments autorisés. */
async function droitsDecrits(page: Page, autorises: readonly string[]) {
  for (const code of ["DEV", "TEST", "PROD"]) {
    await expect(segment(page, code)).toHaveAccessibleName(code);
    await expect(segment(page, code)).toHaveAccessibleDescription(autorises.includes(code) ? AUTORISE : "");
    if (!autorises.includes(code)) await expect(segment(page, code)).not.toHaveAttribute("aria-describedby");
  }
}
const ligne = (page: Page) => page.getByText(/^Déploiement :/);
const debordement = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** Les rectangles des trois segments ne se chevauchent pas et restent dans la fenêtre, dans l'ordre. */
async function segmentsEnPlace(page: Page) {
  const boites = await bascule(page).getByRole("button").evaluateAll((boutons) => boutons.map((bouton) => bouton.getBoundingClientRect()).map(({ left, right, top, bottom }) => ({ left, right, top, bottom })));
  const largeur = await page.evaluate(() => document.documentElement.clientWidth);
  expect(boites).toHaveLength(3);
  for (const [rang, boite] of boites.entries()) {
    expect(boite.left).toBeGreaterThanOrEqual(0);
    expect(boite.right).toBeLessThanOrEqual(largeur);
    const suivante = boites[rang + 1];
    if (suivante !== undefined) {
      expect(suivante.left).toBeGreaterThanOrEqual(boite.right - 0.5);
      expect(suivante.top).toBe(boite.top);
    }
  }
}

test("un créateur avec un accord en DEV voit DEV marqué ; la marque ne choisit pas l'environnement", async ({ page }) => {
  await createur(page);
  await expect(bascule(page).getByRole("button")).toHaveText(["DEV●", "TEST", "PROD"]);
  await droitsDecrits(page, ["DEV"]);
  await expect(segment(page, "DEV")).toHaveAttribute("aria-pressed", "true");
  await expect(segment(page, "TEST")).toHaveAttribute("aria-pressed", "false");
  await expect(marques(page)).toHaveCount(1);
  await expect(marques(page)).toBeVisible();
  // La description n'apparaît pas à l'écran.
  await expect(bascule(page).getByText(AUTORISE)).toBeHidden();
  await expect(ligne(page)).toHaveText("Déploiement : DEV");
  await expect(ligne(page)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Navigation principale" }).getByText("Déploiement : DEV")).toBeVisible();
  // Au clavier : PROD se choisit, la marque reste sur DEV.
  await segment(page, "PROD").focus();
  await page.keyboard.press("Enter");
  await expect(segment(page, "PROD")).toHaveAttribute("aria-pressed", "true");
  await expect(segment(page, "DEV")).toHaveAttribute("aria-pressed", "false");
  await droitsDecrits(page, ["DEV"]);
  await expect(marques(page)).toHaveCount(1);
  await expect(ligne(page)).toHaveText("Déploiement : DEV");
  expect(await debordement(page)).toBeLessThanOrEqual(0);
  await segmentsEnPlace(page);
  // Choisir un environnement ne lit rien de plus : c'est un état de la coque.
  expect(lectures.filter((chemin) => chemin.startsWith("/api/spaces/finance") && !chemin.includes("/catalog"))).toEqual(["/api/spaces/finance"]);
});

test("l'espace confirmé par le serveur décide, pas la liste : administrateur sans accord, aucune marque", async ({ page }) => {
  await simulerIdentite(page, etabli);
  await simulerEspaces(page, { "/api/spaces/finance": espace });
  await simulerCatalogue(page, "finance");
  await ouvrirCatalogue(page, "finance");
  await expect(page.getByText(/^Rôle :/)).toHaveText("Rôle : Administrateur");
  await expect(ligne(page)).toHaveText("Déploiement : aucun");
  await expect(ligne(page).locator(".sb-mono")).toHaveCount(0);
  await expect(bascule(page).getByRole("button")).toHaveText(["DEV", "TEST", "PROD"]);
  await expect(marques(page)).toHaveCount(0);
  await droitsDecrits(page, []);
});

test("mode local : les trois environnements sont marqués", async ({ page }) => {
  await modeLocal(page);
  await expect(bascule(page).getByRole("button")).toHaveText(["DEV●", "TEST●", "PROD●"]);
  await droitsDecrits(page, ["DEV", "TEST", "PROD"]);
  await expect(ligne(page)).toHaveText("Déploiement : DEV, TEST, PROD");
  // Les codes en IBM Plex Mono (RULES §5), le reste de la ligne en Plex Sans.
  await expect(ligne(page).locator(".sb-mono")).toHaveText("DEV, TEST, PROD");
  await expect(ligne(page).locator(".sb-mono")).toHaveCSS("font-family", /IBM Plex Mono/);
  await expect(ligne(page)).toHaveCSS("font-family", /IBM Plex Sans/);
  expect(await debordement(page)).toBeLessThanOrEqual(0);
  await segmentsEnPlace(page);
});

test("l'accueil n'a ni marque ni ligne « Déploiement », même si la liste porte des droits", async ({ page }) => {
  await simulerIdentite(page, etabli);
  await simulerEspaces(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Vos espaces" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Espaces" }).getByRole("listitem")).toHaveCount(2);
  await expect(bascule(page).getByRole("button")).toHaveText(["DEV", "TEST", "PROD"]);
  await expect(marques(page)).toHaveCount(0);
  await droitsDecrits(page, []);
  await expect(ligne(page)).toHaveCount(0);
});

test("changer d'espace : les marques suivent l'espace, l'environnement choisi reste", async ({ page }) => {
  await simulerCatalogue(page, "rh");
  await createur(page);
  await segment(page, "TEST").click();
  await page.getByRole("combobox", { name: "Espace" }).selectOption("rh");
  await expect(page).toHaveURL(/#\/espaces\/rh\/catalogue$/);
  await expect(page.getByText(/^Rôle :/)).toHaveText("Rôle : Lecteur");
  await expect(ligne(page)).toHaveText("Déploiement : aucun");
  await expect(marques(page)).toHaveCount(0);
  await expect(segment(page, "TEST")).toHaveAttribute("aria-pressed", "true");
  // Retour à l'accueil par le fil : la bascule garde TEST, sans marque.
  await page.goto("/#/");
  await expect(page.getByRole("heading", { level: 1, name: "Vos espaces" })).toBeVisible();
  await expect(marques(page)).toHaveCount(0);
});

// Défaut corrigé (nom « DEV , déploiement autorisé » dans Chrome) : le nom reste le libellé, le
// droit est la description. Vérifié aussi dans l'arbre d'accessibilité de Chrome, par CDP.
test("nom accessible exact « DEV » et description « Déploiement autorisé », arbre de Chrome compris", async ({ page }) => {
  await createur(page);
  await droitsDecrits(page, ["DEV"]);
  const cdp = await page.context().newCDPSession(page);
  const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as { nodes: { role?: { value: string }; name?: { value: string }; description?: { value: string } }[] };
  const boutons = nodes
    .filter((noeud) => noeud.role?.value === "button" && ["DEV", "TEST", "PROD"].includes(noeud.name?.value ?? ""))
    .map((noeud) => [noeud.name?.value, noeud.description?.value ?? ""]);
  expect(boutons).toEqual([["DEV", AUTORISE], ["TEST", ""], ["PROD", ""]]);
});

/** Rectangle de la bascule et de chacun de ses segments, arrondi au demi-pixel. */
async function geometrie(page: Page) {
  await polices(page);
  const arrondi = (valeur: number) => Math.round(valeur * 2) / 2;
  const boite = await bascule(page).boundingBox();
  const segments = await bascule(page).getByRole("button").evaluateAll((boutons) => boutons.map((bouton) => bouton.getBoundingClientRect().width));
  return { x: arrondi(boite?.x ?? -1), y: arrondi(boite?.y ?? -1), largeur: arrondi(boite?.width ?? -1), hauteur: arrondi(boite?.height ?? -1), segments: segments.map(arrondi) };
}

test("la bascule garde sa largeur et sa place avec ou sans marques (DESIGN-SYSTEM §1.5)", async ({ page }) => {
  await simulerIdentite(page, etabli);
  // Même identité partout : accueil (hors espace), puis le même administrateur sans accord et avec
  // un accord en DEV (droits de l'exemple réel de la liste), pour que seule la marque change.
  await simulerEspaces(page, { "/api/spaces/finance": espace, "/api/spaces/deployeur": { status: 200, body: { ...espace.body, id: "deployeur", environments: liste.body.spaces[0]?.environments } } });
  await simulerCatalogue(page, "finance");
  await simulerCatalogue(page, "deployeur");
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Vos espaces" })).toBeVisible();
  const accueil = await geometrie(page);
  await ouvrirCatalogue(page, "finance");
  await expect(ligne(page)).toHaveText("Déploiement : aucun");
  const administrateur = await geometrie(page);
  await ouvrirCatalogue(page, "deployeur");
  await expect(marques(page)).toHaveCount(1);
  await expect(ligne(page)).toHaveText("Déploiement : DEV");
  const administrateurDev = await geometrie(page);
  // Avec et sans marques, dans un espace : même rectangle, même largeur de chaque segment.
  expect(administrateurDev).toEqual(administrateur);
  // Hors espace : même largeur et même abscisse. Sur téléphone, la navigation est empilée au-dessus
  // de la barre et grandit dans un espace (pastille du rôle, ligne « Déploiement ») : seule
  // l'ordonnée y diffère, et pas à cause des marques.
  const sansOrdonnee = ({ x, largeur, hauteur, segments }: Awaited<ReturnType<typeof geometrie>>) => ({ x, largeur, hauteur, segments });
  expect(sansOrdonnee(administrateurDev)).toEqual(sansOrdonnee(accueil));
  if (page.viewportSize()?.width === 1280) expect(administrateurDev.y).toBe(accueil.y);

  // Mode local, trois marques : une autre identité, donc une autre pastille à droite ; la largeur
  // de la bascule et de ses segments reste la même.
  const autre = await page.context().newPage();
  await autre.clock.setFixedTime(new Date("2026-11-01T12:30:00Z"));
  await modeLocal(autre);
  await expect(marques(autre)).toHaveCount(3);
  const locale3 = await geometrie(autre);
  expect({ largeur: locale3.largeur, hauteur: locale3.hauteur, segments: locale3.segments }).toEqual({ largeur: accueil.largeur, hauteur: accueil.hauteur, segments: accueil.segments });
  await autre.close();
});

for (const [nom, ouvrir] of [["créateur", createur], ["mode local", modeLocal]] as const) {
  test(`axe sur la page entière, contraste compris : bascule marquée (${nom})`, async ({ page }) => {
    await ouvrir(page);
    const resultats = await new AxeBuilder({ page }).analyze();
    expect(resultats.violations).toEqual([]);
  });
}

test("capture de référence de la coque : DEV marqué, ligne « Déploiement : DEV »", async ({ page }) => {
  await createur(page);
  await expect(page).toHaveScreenshot("coque-deploiement-createur.png", { fullPage: true });
});

test("capture de référence de la coque en mode local : trois marques, PROD choisi", async ({ page }) => {
  await modeLocal(page);
  await segment(page, "PROD").click();
  await expect(segment(page, "PROD")).toHaveAttribute("aria-pressed", "true");
  await segment(page, "PROD").blur();
  await expect(page).toHaveScreenshot("coque-deploiement-local.png", { fullPage: true });
});
