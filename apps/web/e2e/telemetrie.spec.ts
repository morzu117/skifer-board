import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import administration from "../../../contracts/espaces/liste-administration.json" with { type: "json" };
import liste from "../../../contracts/espaces/liste.json" with { type: "json" };
import locale from "../../../contracts/espaces/liste-locale.json" with { type: "json" };
import etabli from "../../../contracts/identite/me-etabli.json" with { type: "json" };
import fenetreInvalide from "../../../contracts/telemetrie/fenetre-invalide.json" with { type: "json" };
import interdit from "../../../contracts/telemetrie/interdit.json" with { type: "json" };
import lecture7j from "../../../contracts/telemetrie/lecture-7j.json" with { type: "json" };
import lecture from "../../../contracts/telemetrie/lecture.json" with { type: "json" };
import modeLocal from "../../../contracts/telemetrie/mode-local.json" with { type: "json" };
import vide from "../../../contracts/telemetrie/vide.json" with { type: "json" };
import { catalogueHorsEspace, enregistrerLectures, simulerEspaces, simulerIdentite, type Exemple } from "./aides";

// Écran « Télémétrie » (plan 11, 11.4). Les deux projets de playwright.config.ts exécutent ces
// parcours : ordinateur (1280 px) et téléphone (390 px, émulation d'appareil). Les réponses sont
// les exemples du serveur réel (contracts/telemetrie).

type Fenetre = "24h" | "7d" | "30d";
type Reponse = Exemple | "panne";
const TRENTE_JOURS: Exemple = { status: 200, body: { ...vide.body, window: "30d" } };
const LECTURES: Readonly<Record<Fenetre, Reponse>> = { "24h": lecture, "7d": lecture7j, "30d": TRENTE_JOURS };

/** Télémétrie simulée : une réponse par fenêtre, une panne réseau pour « panne ». */
async function simulerTelemetrie(page: Page, table: Partial<Record<Fenetre, Reponse>> = {}): Promise<void> {
  const reponses = { ...LECTURES, ...table };
  await page.route((url) => url.pathname === "/api/telemetry", async (route) => {
    const fenetre = new URL(route.request().url()).searchParams.get("window") as Fenetre;
    const exemple = reponses[fenetre];
    if (exemple === "panne") await route.abort("failed");
    else await route.fulfill({ status: exemple.status, json: exemple.body });
  });
}

let lectures: string[] = [];
test.beforeEach(async ({ page }) => {
  await simulerIdentite(page, etabli);
  lectures = enregistrerLectures(page);
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00Z"));
});
test.afterEach(() => {
  expect(catalogueHorsEspace(lectures)).toEqual([]);
  // Aucune lecture d'un espace : la télémétrie se lit hors espace.
  expect(lectures.filter((chemin) => chemin.startsWith("/api/spaces/"))).toEqual([]);
});

async function polices(page: Page) {
  await page.evaluate(async () => { await document.fonts.ready; });
}
const tableau = (page: Page) => page.getByRole("table", { name: "Opérations, les plus lentes d'abord (p95 décroissant)" });
const conteneur = (page: Page) => page.getByRole("group", { name: "Opérations, les plus lentes d'abord" });
const fenetre = (page: Page) => page.getByRole("group", { name: "Fenêtre", exact: true });
const choix = (page: Page, nom: string) => fenetre(page).getByRole("button", { name: nom, exact: true });
const debordement = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const telemetrie = () => lectures.filter((chemin) => chemin.startsWith("/api/telemetry"));

type Etat = "tableau" | "vide" | "refus" | "mode local" | "autre refus" | "panne";

/** Ouvre `#/telemetrie` dans l'état demandé, et attend qu'il soit affiché. */
async function ouvrirEtat(page: Page, etat: Etat): Promise<void> {
  if (etat === "mode local") {
    await simulerIdentite(page);
    await simulerEspaces(page, { "/api/spaces": locale });
    await simulerTelemetrie(page, { "24h": modeLocal });
  } else {
    await simulerEspaces(page, { "/api/spaces": etat === "refus" ? liste : administration });
    const table: Partial<Record<Fenetre, Reponse>> = { tableau: {}, vide: { "24h": vide }, refus: { "24h": interdit }, "autre refus": { "24h": fenetreInvalide }, panne: { "24h": "panne" } }[etat] as Partial<Record<Fenetre, Reponse>>;
    await simulerTelemetrie(page, table);
  }
  await page.goto("/#/telemetrie");
  await expect(page.getByRole("heading", { level: 1, name: "Télémétrie" })).toBeVisible();
  const attendu = {
    tableau: tableau(page),
    vide: page.getByRole("region", { name: "Aucune mesure" }),
    refus: page.getByText("La télémétrie est réservée à l'administration de la plateforme."),
    "mode local": page.getByText(/^En mode local, sans fournisseur d'identité/),
    "autre refus": page.getByRole("alert"),
    panne: page.getByRole("alert"),
  }[etat];
  await expect(attendu).toBeVisible();
  await polices(page);
}

test("parcours : l'accueil de l'administration mène à la télémétrie ; la fenêtre se change de 24 h à 7 j puis 30 j", async ({ page }) => {
  await simulerEspaces(page, { "/api/spaces": administration });
  await simulerTelemetrie(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Télémétrie", exact: true }).click();
  await expect(page).toHaveURL(/#\/telemetrie$/);
  await expect(tableau(page)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Fil d'Ariane" }).getByRole("listitem")).toHaveText(["Vos espaces", "Télémétrie"]);
  await expect(page.getByRole("region", { name: "Opérations sur les dernières 24 heures" })).toBeVisible();
  await expect(tableau(page).getByRole("rowheader").locator("code")).toHaveText(["GET /api/spaces/{space_id}/members", "atlas.list", "GET /api/me", "atlas.document"]);
  await expect(page.locator(".sb-telemetry__period")).toHaveText(/dernière mesure il y a 4 min\.$/);
  await expect(choix(page, "24 h")).toHaveAttribute("aria-pressed", "true");

  await choix(page, "7 j").click();
  await expect(choix(page, "7 j")).toHaveAttribute("aria-pressed", "true");
  await expect(choix(page, "24 h")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("region", { name: "Opérations sur les 7 derniers jours" })).toBeVisible();
  await expect(tableau(page).getByRole("rowheader")).toHaveCount(5);

  await choix(page, "30 j").click();
  await expect(page.getByRole("region", { name: "Aucune mesure" })).toHaveText(/Aucune mesure sur les 30 derniers jours\./);
  await expect(fenetre(page).getByRole("button", { pressed: true })).toHaveText("30 j");
  // La fenêtre n'est pas gardée dans l'adresse (écart de 11.4).
  await expect(page).toHaveURL(/#\/telemetrie$/);
  expect(telemetrie()).toEqual(["/api/telemetry?window=24h", "/api/telemetry?window=7d", "/api/telemetry?window=30d"]);
});

test("la fenêtre se choisit au clavier", async ({ page }) => {
  await ouvrirEtat(page, "tableau");
  await choix(page, "24 h").focus();
  await page.keyboard.press("Tab");
  await expect(choix(page, "7 j")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Opérations sur les 7 derniers jours" })).toBeVisible();
  await expect(choix(page, "7 j")).toHaveAttribute("aria-pressed", "true");
});

test("sans administration de la plateforme, l'accueil n'offre pas la télémétrie, et l'adresse directe dit le refus", async ({ page }) => {
  await simulerEspaces(page, { "/api/spaces": liste });
  await simulerTelemetrie(page, { "24h": interdit });
  await page.goto("/");
  await expect(page.getByRole("list", { name: "Espaces" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Télémétrie" })).toHaveCount(0);
  expect(telemetrie()).toEqual([]);
  await page.goto("/#/telemetrie");
  await expect(page.getByText("La télémétrie est réservée à l'administration de la plateforme.")).toBeVisible();
  await expect(tableau(page)).toHaveCount(0);
});

test("mode local : ni lien à l'accueil, ni mesure lue ici", async ({ page }) => {
  await simulerIdentite(page);
  await simulerEspaces(page, { "/api/spaces": locale });
  await simulerTelemetrie(page, { "24h": modeLocal });
  await page.goto("/");
  await expect(page.getByRole("list", { name: "Espaces" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Télémétrie" })).toHaveCount(0);
  await page.goto("/#/telemetrie");
  await expect(page.getByText(/^En mode local, sans fournisseur d'identité, les mesures ne vont que sur la sortie standard du serveur/)).toBeVisible();
  await expect(tableau(page)).toHaveCount(0);
});

test("panne : indisponible, aucune donnée affichée", async ({ page }) => {
  await ouvrirEtat(page, "panne");
  await expect(page.getByRole("alert")).toHaveText("Télémétrie indisponible : Le serveur Board ne répond pas. Aucune donnée n'est affichée.");
  await expect(tableau(page)).toHaveCount(0);
});

test("les segments de la bascule sont des cibles d'au moins 44 px", async ({ page }) => {
  await ouvrirEtat(page, "tableau");
  for (const nom of ["24 h", "7 j", "30 j"]) {
    const boite = await choix(page, nom).boundingBox();
    expect(boite?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(boite?.width ?? 0).toBeGreaterThanOrEqual(44);
  }
  const lien = await page.getByRole("link", { name: "Télémétrie" }).count();
  expect(lien).toBe(0);
});

for (const etat of ["tableau", "vide", "refus", "mode local", "autre refus", "panne"] as const) {
  test(`axe sur la page entière, contraste compris : ${etat}`, async ({ page }) => {
    await ouvrirEtat(page, etat);
    const resultat = await new AxeBuilder({ page }).options({ rules: { "color-contrast": { enabled: true } } }).analyze();
    expect(resultat.violations.map((violation) => violation.id), `Règles axe en échec : ${etat}`).toEqual([]);
  });
}

test("axe sur la page entière, contraste compris : 7 j choisi, tableau défilé", async ({ page }) => {
  await ouvrirEtat(page, "tableau");
  await choix(page, "7 j").click();
  await expect(page.getByRole("region", { name: "Opérations sur les 7 derniers jours" })).toBeVisible();
  await conteneur(page).evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  const resultat = await new AxeBuilder({ page }).options({ rules: { "color-contrast": { enabled: true } } }).analyze();
  expect(resultat.violations.map((violation) => violation.id)).toEqual([]);
});

test("axe sur l'accueil de l'administration, avec le lien « Télémétrie »", async ({ page }) => {
  await simulerEspaces(page, { "/api/spaces": administration });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Télémétrie", exact: true })).toBeVisible();
  await polices(page);
  const resultat = await new AxeBuilder({ page }).options({ rules: { "color-contrast": { enabled: true } } }).analyze();
  expect(resultat.violations.map((violation) => violation.id)).toEqual([]);
});

for (const largeur of [320, 390, 768, 1280]) {
  for (const etat of ["tableau", "vide", "refus", "mode local"] as const) {
    test(`aucun défilement horizontal de page, ${etat} à ${largeur} px`, async ({ page }) => {
      await page.setViewportSize({ width: largeur, height: 900 });
      await ouvrirEtat(page, etat);
      await expect.poll(() => page.evaluate(() => document.documentElement.clientWidth)).toBe(largeur);
      await expect.poll(() => debordement(page)).toBeLessThanOrEqual(0);
      if (etat === "refus" || etat === "mode local") {
        // Ni le droit ni le mode local ne dépendent de la fenêtre : la bascule n'est pas offerte.
        await expect(fenetre(page)).toHaveCount(0);
      } else {
        // La bascule tient dans la page.
        const bascule = await fenetre(page).boundingBox();
        expect(bascule).not.toBeNull();
        expect((bascule?.x ?? 0) + (bascule?.width ?? 0)).toBeLessThanOrEqual(largeur);
      }
      if (etat === "tableau") {
        // Le conteneur du tableau ne sort pas de sa carte ; s'il est trop étroit, c'est lui qui défile.
        const [boite, carte] = [await conteneur(page).boundingBox(), await page.getByRole("region", { name: "Opérations sur les dernières 24 heures" }).boundingBox()];
        expect((boite?.x ?? 0) + (boite?.width ?? 0)).toBeLessThanOrEqual((carte?.x ?? 0) + (carte?.width ?? 0) + 0.5);
        const defile = await conteneur(page).evaluate((element) => ({ contenu: element.scrollWidth, visible: element.clientWidth, style: getComputedStyle(element).overflowX }));
        expect(["auto", "scroll"]).toContain(defile.style);
        if (largeur <= 768) expect(defile.contenu).toBeGreaterThan(defile.visible);
      }
    });
  }
}

for (const largeur of [320, 390, 768, 1280]) {
  test(`accueil de l'administration à ${largeur} px : « Télémétrie » et « Créer un espace » tiennent dans la page, cibles de 44 px`, async ({ page }) => {
    await page.setViewportSize({ width: largeur, height: 900 });
    await simulerEspaces(page, { "/api/spaces": administration });
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Télémétrie", exact: true })).toBeVisible();
    await polices(page);
    await expect.poll(() => debordement(page)).toBeLessThanOrEqual(0);
    for (const nom of ["Télémétrie", "Créer un espace"]) {
      const boite = await page.getByRole("link", { name: nom, exact: true }).boundingBox();
      expect(boite?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect((boite?.x ?? 0) + (boite?.width ?? 0)).toBeLessThanOrEqual(largeur);
    }
  });
}

test("à 1280 px, le tableau de l'exemple « lecture » tient entier dans son conteneur, sans défilement horizontal", async ({ page }, info) => {
  test.skip(info.project.name !== "ordinateur", "Largeur de bureau : projet ordinateur seul.");
  await page.setViewportSize({ width: 1280, height: 900 });
  await ouvrirEtat(page, "tableau");
  const mesure = await conteneur(page).evaluate((element) => ({ contenu: element.scrollWidth, visible: element.clientWidth }));
  expect(mesure.contenu, `largeur manquante : ${String(mesure.contenu - mesure.visible)} px`).toBeLessThanOrEqual(mesure.visible);
  // Toutes les colonnes se voient, la dernière comprise.
  await expect(tableau(page).getByRole("columnheader", { name: "Documents max" })).toBeInViewport({ ratio: 1 });
  await expect(tableau(page).getByRole("row").nth(1).getByRole("cell").last()).toBeInViewport({ ratio: 1 });
  // Les nombres restent sur une ligne ; les en-têtes, en texte courant, peuvent passer à la ligne.
  const cellule = tableau(page).getByRole("row").nth(1).getByRole("cell").nth(4);
  await expect(cellule).toHaveCSS("white-space", "nowrap");
  await expect(cellule).toHaveCSS("font-variant-numeric", "tabular-nums");
  const entete = tableau(page).getByRole("columnheader", { name: "Taille médiane" });
  await expect(entete).not.toHaveCSS("white-space", "nowrap");
  const police = await entete.evaluate((element) => getComputedStyle(element).fontFamily);
  expect(police).not.toMatch(/Mono/i);
});

test("à 1280 px avec 7 j choisi, la page ne défile pas non plus", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await ouvrirEtat(page, "tableau");
  await choix(page, "7 j").click();
  await expect(tableau(page).getByRole("rowheader")).toHaveCount(5);
  await expect.poll(() => debordement(page)).toBeLessThanOrEqual(0);
});

test("la colonne Opération reste collée quand le tableau défile, en-tête compris, et opaque", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await ouvrirEtat(page, "tableau");
  const entete = tableau(page).getByRole("rowheader").first();
  const titre = tableau(page).getByRole("columnheader").first();
  const avant = await entete.boundingBox();
  await conteneur(page).evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect.poll(() => conteneur(page).evaluate((element) => element.scrollLeft)).toBeGreaterThan(100);
  const [apres, titreApres] = [await entete.boundingBox(), await titre.boundingBox()];
  expect(apres?.x).toBeCloseTo(avant?.x ?? -1, 0);
  expect(titreApres?.x).toBeCloseTo(apres?.x ?? -1, 0);
  await expect(entete).toHaveCSS("position", "sticky");
  await expect(titre).toHaveCSS("position", "sticky");
  for (const cellule of [entete, titre]) {
    const fond = await cellule.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(fond).not.toBe("rgba(0, 0, 0, 0)");
  }
  // Défilé jusqu'au bout, la dernière colonne se voit dans le conteneur, à droite de la colonne collée.
  const derniere = await tableau(page).getByRole("row").nth(1).getByRole("cell").last().boundingBox();
  const boite = await conteneur(page).boundingBox();
  expect(derniere?.x ?? -1).toBeGreaterThanOrEqual((apres?.x ?? 0) + (apres?.width ?? 0) - 0.5);
  expect((derniere?.x ?? 0) + (derniere?.width ?? 0)).toBeLessThanOrEqual((boite?.x ?? 0) + (boite?.width ?? 0) + 0.5);
});

test("le conteneur du tableau se fait défiler au clavier", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await ouvrirEtat(page, "tableau");
  await conteneur(page).focus();
  await expect(conteneur(page)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => conteneur(page).evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
});

test("les nombres sont en chiffres tabulaires, alignés à droite", async ({ page }) => {
  await ouvrirEtat(page, "tableau");
  const cellule = tableau(page).getByRole("row").nth(1).getByRole("cell").first();
  await expect(cellule).toHaveCSS("font-variant-numeric", "tabular-nums");
  await expect(cellule).toHaveCSS("text-align", "right");
  await expect(tableau(page).getByRole("columnheader").nth(1)).toHaveCSS("text-align", "right");
});

for (const [etat, capture] of [["tableau", "telemetrie-tableau-24h.png"], ["vide", "telemetrie-vide.png"], ["refus", "telemetrie-refus.png"], ["mode local", "telemetrie-mode-local.png"]] as const) {
  test(`capture de référence de « Télémétrie » : ${etat}`, async ({ page }) => {
    await ouvrirEtat(page, etat);
    await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });
    await expect(page).toHaveScreenshot(capture, { fullPage: true });
  });
}
