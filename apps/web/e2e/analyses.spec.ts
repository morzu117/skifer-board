import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { tableFromIPC } from "apache-arrow";
import { choisirTheme } from "./aides";
import { AUCUN, AUTRE_ID, ID, MOI, TOUS, TROISIEME_ID, brouillon, empreinte, entree, executionDe, executionN, preuveDe, resultat, servirAnalyses, Refus, type Entree, type Reglages, type Requete, type Serveur } from "./serveur-analyses";

const THEMES = ["Skifer clair", "Skifer ardoise"] as const;
const LARGEURS = [390, 768, 1280] as const;
const FILTRE = { column: "region", operator: "in", value: ["Nord", "Sud"] };
const REQUETE = { connection: "finance", model: "sales", metrics: ["revenue"], dimensions: ["region"], filters: [FILTRE] };
const EXECUTION = { ...REQUETE, environment: "DEV" } satisfies Requete;
const CALCULS = [
  { operation: "aggregate", metric: "revenue", group_by: [], scope: null },
  { operation: "share", metric: "revenue", group_by: [], denominator: "loaded_result" },
];
/** Une analyse dont les calculs contextuels et la présentation ne sont pas ceux par défaut. */
const RICHE = { contextual: CALCULS, presentation: { chart: "line" } };
/** La révision 2 d'une autre personne : nom, description, un filtre (opérateur et valeur) et le genre changent. */
const REVISION_CORA = brouillon("Révisée par Cora", {
  description: "Autre suivi.", query: { ...REQUETE, filters: [{ column: "region", operator: "eq", value: "Nord" }] }, presentation: { chart: "line" }, contextual: CALCULS,
});

const OUVERTURE = "POST /analyses/:id/opened";
const EXECUTION_POST = "POST /executions";
const CREATION = "POST /analyses";
const REVISION = "POST /analyses/:id/revisions";

// Chaque test déclare, en servant, la liste exacte de ses écritures ; à la fin du test, une demande hors scénario ou une écriture en
// plus, en moins ou dans un autre ordre le fait échouer.
const serveurs: { serveur: Serveur; ecritures: readonly string[] }[] = [];
test.afterEach(() => {
  for (const { serveur, ecritures } of serveurs.splice(0)) {
    expect(serveur.journal.inattendues).toEqual([]);
    expect(serveur.ecritures()).toEqual(ecritures);
  }
});

async function servir(page: Page, reglages: Reglages, ecritures: readonly string[]): Promise<Serveur> {
  const serveur = await servirAnalyses(page, reglages);
  serveurs.push({ serveur, ecritures });
  return serveur;
}
async function axe(page: Page) {
  const report = await new AxeBuilder({ page }).analyze();
  expect(report.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => [n.target, n.failureSummary]) }))).toEqual([]);
}
async function sansDebordement(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
}
/** Active un contrôle au clavier : focus, puis Entrée. */
async function activer(page: Page, controle: Locator) {
  await controle.focus();
  await page.keyboard.press("Enter");
}
async function cocher(page: Page, controle: Locator) {
  await controle.focus();
  await page.keyboard.press("Space");
}
async function aller(page: Page, hash: string) {
  await page.goto(`/#/espaces/finance/${hash}`);
  await page.evaluate(async () => { await document.fonts.ready; });
}
/** Le tableau du résultat de l'Explorateur : on passe par l'onglet « Tableau », le graphique étant la vue d'abord montrée. */
async function tableau(page: Page) {
  await page.getByRole("tab", { name: "Tableau" }).click();
  return page.getByRole("table").first();
}
/** Entrée de la navigation principale, au clavier. */
async function naviguer(page: Page, nom: string) {
  await activer(page, page.getByRole("navigation", { name: "Navigation principale" }).getByRole("button", { name: nom, exact: true }));
}
async function exploration(page: Page) {
  await expect(page.getByText(/Exploration à partir de/)).toBeVisible();
}
async function composer(page: Page) {
  await cocher(page, page.getByRole("checkbox", { name: /Chiffre d'affaires/ }));
  await cocher(page, page.getByRole("checkbox", { name: /Région/ }));
  await page.getByLabel("Dimension du filtre").selectOption("region");
  await page.getByLabel("Opérateur").selectOption("in");
  await page.getByLabel(/^Valeur/).fill("Sud, Nord");
  await page.getByLabel(/^Valeur/).press("Enter");
  await expect(page.getByRole("button", { name: "Retirer le filtre region" })).toBeVisible();
}
const panneau = (page: Page, nom: string) => page.getByRole("group", { name: nom, exact: true });
const lui = (nom: string, extra: Partial<Entree> = {}, visibilite: "personal" | "shared" = "personal") => entree(ID, [brouillon(nom, { visibility: visibilite })], { proprietaire: MOI, droits: TOUS, ...extra });
const partagee = (extra: Partial<Entree> = {}, id = ID) => entree(id, [brouillon("Chiffre d'affaires")], { droits: AUCUN, ...extra });

test("créateur : sauvegarde personnelle, réouverture, révision et partage, au clavier", async ({ page }) => {
  // Deux exécutions, une création, une révision, et une ouverture par affichage de la fiche.
  const serveur = await servir(page, { role: "creator" }, [EXECUTION_POST, CREATION, OUVERTURE, EXECUTION_POST, REVISION, OUVERTURE]);
  await aller(page, "analyses");
  await expect(page.getByText("Aucune analyse à afficher pour vous dans cet espace")).toBeVisible();
  await axe(page);
  // De la liste à l'Explorateur, composition et exécution au clavier.
  await naviguer(page, "Explorer");
  await expect(page.getByRole("heading", { level: 1, name: "Explorer" })).toBeVisible();
  await composer(page);
  await cocher(page, page.getByRole("checkbox", { name: /Enregistrer comme calculs contextuels/ }));
  await activer(page, page.getByRole("button", { name: "Exécuter", exact: true }));
  await expect(page.getByRole("tab", { name: "Tableau" })).toBeVisible();
  await page.getByLabel("Type de graphique").selectOption("ligne");
  // Sauvegarde : l'aperçu et ce qui n'est pas gardé avant toute écriture.
  await activer(page, page.getByRole("button", { name: "Sauvegarder comme analyse", exact: true }));
  const sauvegarde = panneau(page, "Sauvegarder comme analyse");
  await expect(sauvegarde.getByRole("heading", { name: "Sauvegarder comme analyse" })).toBeFocused();
  await expect(sauvegarde.getByRole("button", { name: "Sauvegarder l'analyse" })).toBeDisabled();
  await expect(sauvegarde.getByText(/Aperçu indisponible : analyse\.name/)).toBeVisible();
  // L'ordre du clavier suit celui de la page : nom, description, visibilité, puis l'action.
  await page.keyboard.press("Tab");
  await expect(sauvegarde.getByLabel("Nom de l'analyse")).toBeFocused();
  await page.keyboard.type("Ventes par région");
  await page.keyboard.press("Tab");
  await expect(sauvegarde.getByLabel("Description")).toBeFocused();
  await page.keyboard.type("Suivi mensuel.");
  await page.keyboard.press("Tab");
  await expect(sauvegarde.getByRole("radio", { name: "Personnelle" })).toBeFocused();
  const apercu = sauvegarde.getByRole("group", { name: "Aperçu de l'analyse" });
  await expect(apercu).toContainText("Ventes par région");
  await expect(apercu).toContainText("Personnelle");
  await expect(apercu).toContainText("Ligne (line)");
  // La puce reprend la saisie ; l'aperçu montre les valeurs du corps envoyé, dans l'ordre canonique de la requête d'exécution.
  await expect(page.getByText("region in Sud,Nord")).toBeVisible();
  await expect(apercu).toContainText("region parmi Nord, Sud");
  await expect(apercu).not.toContainText("Sud, Nord");
  await expect(apercu).toContainText("Agrégat de revenue par sans regroupement · périmètre : sélection courante");
  await expect(apercu).toContainText("Part de revenue par sans regroupement · dénominateur : résultat chargé");
  for (const absent of ["Sélection de lignes ou de barres", "Résultat et données", "Environnement choisi dans la coque", "Thème d'affichage"]) await expect(apercu.getByRole("listitem").filter({ hasText: absent })).toHaveCount(1);
  await axe(page);
  // Le double clic ne produit qu'une écriture.
  await sauvegarde.getByRole("button", { name: "Sauvegarder l'analyse" }).dblclick();
  await expect(sauvegarde.getByText("Analyse sauvegardée.")).toBeVisible();
  expect(serveur.journal.creations).toEqual([{
    name: "Ventes par région", description: "Suivi mensuel.", visibility: "personal",
    query: REQUETE, contextual: CALCULS, presentation: { chart: "line" },
  }]);
  // Rouverte depuis la fiche, dans l'Explorateur, avec la même intention.
  await activer(page, sauvegarde.getByRole("link", { name: "Ouvrir la fiche" }));
  await expect(page.getByRole("heading", { level: 1, name: "Ventes par région" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Requête" })).toHaveAttribute("aria-selected", "true");
  await activer(page, page.getByRole("button", { name: "Ouvrir dans l'Explorateur", exact: true }));
  await exploration(page);
  await expect(page.getByText(/Exploration à partir de « Ventes par région », révision 1/)).toBeVisible();
  await expect(page.getByText("Identique à la révision ouverte")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Modèle", exact: true })).toHaveValue("sales");
  await expect(page.getByRole("checkbox", { name: /Chiffre d'affaires/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Région/ })).toBeChecked();
  await expect(page.getByRole("button", { name: "Retirer le filtre region" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Enregistrer comme calculs contextuels/ })).toBeChecked();
  await activer(page, page.getByRole("button", { name: "Exécuter", exact: true }));
  await expect(page.getByLabel("Type de graphique")).toHaveValue("ligne");
  await expect.poll(() => serveur.journal.executions.length).toBe(2);
  // Avant la sauvegarde l'exécution part sans référence ; rouverte, elle porte l'analyse et sa révision.
  expect(serveur.journal.executions[0]).toEqual(EXECUTION);
  expect(serveur.journal.executions[1]).toEqual({ ...EXECUTION, analysis: { id: ID, revision: 1 } });
  // L'Explorateur n'enregistre aucune ouverture : celle de la fiche est la seule.
  expect(serveur.compte("POST /analyses/:id/opened")).toBe(1);
  // Nouvelle révision par l'écran d'impact, puis partage.
  await activer(page, page.getByRole("button", { name: "Nouvelle révision", exact: true }));
  const revision = panneau(page, "Nouvelle révision");
  const impact = revision.getByRole("region", { name: "Impact de la révision" });
  await expect(impact).toContainText("r1 de « Ventes par région » ; elle reste lisible dans l'historique.");
  await expect(impact).toContainText("Consommateurs");
  await expect(impact).toContainText("Indisponible : aucune route ne lit les consommateurs avant le lot 07.");
  await expect(impact.getByRole("radio", { name: "Nouvelle révision de l'analyse" })).toBeChecked();
  await expect(revision.getByRole("radio", { name: "Personnelle" })).toBeChecked();
  await axe(page);
  await revision.getByLabel("Nom de l'analyse").fill("Ventes partagées");
  await revision.getByRole("radio", { name: "Partagée" }).focus();
  await page.keyboard.press("Space");
  await expect(revision.getByRole("radio", { name: "Partagée" })).toBeChecked();
  await activer(page, revision.getByRole("button", { name: "Enregistrer la nouvelle révision" }));
  await expect(revision.getByText("Révision 2 enregistrée.")).toBeVisible();
  expect(serveur.journal.revisions).toEqual([{ id: ID, corps: {
    expected_revision: 1, name: "Ventes partagées", description: "Suivi mensuel.", visibility: "shared",
    query: REQUETE, contextual: CALCULS, presentation: { chart: "line" },
  } }]);
  await expect(page.getByText(/Exploration à partir de « Ventes partagées », révision 2/)).toBeVisible();
  await expect(page.getByText(/Les exécutions sont liées à l'analyse \(révision 2\)/)).toBeVisible();
  await activer(page, revision.getByRole("link", { name: "Voir les révisions dans la fiche" }));
  await expect(page.getByRole("tab", { name: "Révisions" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("list", { name: "Historique des révisions" }).getByRole("listitem")).toHaveCount(2);
  await axe(page);
});

test("lecteur : fiche partagée sans écriture, exécution avec référence, détachement au changement de modèle", async ({ page }) => {
  // Une ouverture (la fiche), deux exécutions, un résultat lu par exécution, et rien d'autre ne s'écrit.
  const serveur = await servir(page, { role: "reader", entrees: [partagee()] }, [OUVERTURE, EXECUTION_POST, EXECUTION_POST]);
  await aller(page, `analyses/${ID}`);
  await expect(page.getByRole("heading", { level: 1, name: "Chiffre d'affaires" })).toBeVisible();
  await expect(page.getByText("Partagée", { exact: true }).first()).toBeVisible();
  for (const absent of ["Nouvelle révision", "Dupliquer", "Supprimer"]) await expect(page.getByRole("button", { name: absent, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ouvrir dans l'Explorateur", exact: true })).toBeEnabled();
  expect(serveur.journal.ouvertures).toHaveLength(1);
  expect(serveur.journal.ouvertures[0]?.corps).toMatchObject({ revision: 1 });
  await axe(page);
  await activer(page, page.getByRole("button", { name: "Ouvrir dans l'Explorateur", exact: true }));
  await exploration(page);
  // Aucune écriture dans l'Explorateur : sauvegarde désactivée avec sa raison, ni révision ni copie.
  const sauvegarde = page.getByRole("button", { name: "Sauvegarder comme analyse", exact: true });
  await expect(sauvegarde).toBeDisabled();
  await expect(sauvegarde).toHaveAccessibleDescription(/votre rôle est reader/);
  for (const absent of ["Nouvelle révision", "Dupliquer"]) await expect(page.getByRole("button", { name: absent, exact: true })).toHaveCount(0);
  await expect(page.getByText(/Les exécutions sont liées à l'analyse \(révision 1\)/)).toBeVisible();
  await activer(page, page.getByRole("button", { name: "Exécuter", exact: true }));
  await expect(page.getByRole("tab", { name: "Tableau" })).toBeVisible();
  expect(serveur.journal.executions).toEqual([{ ...EXECUTION, analysis: { id: ID, revision: 1 } }]);
  // Premier résultat et sa provenance : ceux de la requête exécutée (ventes, chiffre d'affaires par région).
  const premiere = executionN(1);
  const resultat1 = await tableau(page);
  await expect(resultat1).toContainText("Nord");
  await expect(resultat1).toContainText("12");
  await expect(resultat1).toContainText("Sud");
  await expect(resultat1).toContainText("5");
  let provenance = page.getByRole("region", { name: "Provenance" });
  await expect(provenance).toContainText(preuveDe(premiere));
  await expect(provenance).toContainText(empreinte(EXECUTION));
  await page.getByRole("button", { name: "Preuves", exact: true }).click();
  let preuves = page.getByRole("region", { name: "Preuves", exact: true });
  await expect(preuves).toContainText("revenue · sales");
  await expect(preuves).toContainText("main.sales");
  await expect(preuves).toContainText(`${premiere} · réussie`);
  await expect(preuves).toContainText("region in");
  await axe(page);
  // Un autre modèle détache, et l'exécution part sans référence.
  await page.getByRole("combobox", { name: "Modèle", exact: true }).selectOption("sales_orders");
  await expect(page.getByText(/Le modèle a changé : les exécutions ne sont plus liées à l'analyse/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Détacher de l'analyse" })).toHaveCount(0);
  await cocher(page, page.getByRole("checkbox", { name: /Commandes · count/ }));
  await activer(page, page.getByRole("button", { name: "Exécuter", exact: true }));
  await expect.poll(() => serveur.journal.executions.length).toBe(2);
  const commandes = { connection: "finance", environment: "DEV", model: "sales_orders", metrics: ["orders"], dimensions: [], filters: [] } satisfies Requete;
  expect(serveur.journal.executions[1]).toEqual(commandes);
  // Le second résultat et sa provenance sont ceux de la requête sur les commandes, jamais ceux du premier.
  const seconde = executionN(2);
  provenance = page.getByRole("region", { name: "Provenance" });
  await expect(provenance).toContainText(preuveDe(seconde));
  await expect(provenance).toContainText(empreinte(commandes));
  await expect(provenance).not.toContainText(empreinte(EXECUTION));
  await expect(provenance).not.toContainText(preuveDe(premiere));
  expect(empreinte(commandes)).not.toBe(empreinte(EXECUTION));
  const resultat2 = await tableau(page);
  await expect(resultat2).toContainText("orders");
  await expect(resultat2).toContainText("5");
  await expect(resultat2).not.toContainText("Nord");
  await page.getByRole("button", { name: "Preuves", exact: true }).click();
  preuves = page.getByRole("region", { name: "Preuves", exact: true });
  await expect(preuves).toContainText("orders · sales_orders");
  await expect(preuves).toContainText("main.sales_orders");
  await expect(preuves).toContainText(`${seconde} · réussie`);
  await expect(preuves).not.toContainText("revenue · sales");
  await expect(preuves).not.toContainText("region in");
  await axe(page);
  // Revenir au modèle d'origine ne rattache pas.
  await page.getByRole("combobox", { name: "Modèle", exact: true }).selectOption("sales");
  await expect(page.getByText(/Revenir au modèle d'origine ne rétablit pas le lien/)).toBeVisible();
  await axe(page);
  expect(serveur.compte(OUVERTURE)).toBe(1);
  expect(serveur.journal.resultats).toEqual([premiere, seconde]);
});

/** Ce que le brouillon du conflit écrit, révision ou copie : le contenu entier, calculs et genre compris. */
const BROUILLON_COPIE = { name: "Mon brouillon", description: "Suivi.", visibility: "shared", query: REQUETE, contextual: CALCULS, presentation: { chart: "line" } };
async function conflit(page: Page, ecritures: readonly string[]): Promise<Serveur> {
  const serveur = await servir(page, { role: "creator", entrees: [entree(ID, [brouillon("Chiffre d'affaires", RICHE)], { proprietaire: MOI, droits: TOUS })] }, ecritures);
  await aller(page, `explorer/analyses/${ID}`);
  await exploration(page);
  await activer(page, page.getByRole("button", { name: "Nouvelle révision", exact: true }));
  const revision = panneau(page, "Nouvelle révision");
  await expect(revision.getByRole("radio", { name: "Nouvelle révision de l'analyse" })).toBeChecked();
  await revision.getByLabel("Nom de l'analyse").fill("Mon brouillon");
  // Une autre personne enregistre la révision 2 entre-temps.
  serveur.publierAilleurs(ID, REVISION_CORA);
  await activer(page, revision.getByRole("button", { name: "Enregistrer la nouvelle révision" }));
  await expect(page.getByRole("region", { name: "Révision courante différente" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir la révision courante (r2)" })).toBeVisible();
  return serveur;
}

test("conflit : deux issues seulement, aucune seconde écriture, copie indépendante, écart du serveur", async ({ page }) => {
  // La révision refusée, puis la copie : ni autre révision ni ouverture.
  const serveur = await conflit(page, [REVISION, CREATION]);
  const divergence = page.getByRole("region", { name: "Révision courante différente" });
  // L'alerte dit que la révision n'est pas possible et renvoie aux deux issues, sans proposer de relire ; l'impact ne promet aucun remplacement.
  const alerte = page.getByRole("alert").first();
  await expect(alerte).toContainText("la révision n'est pas possible depuis cette exploration. Choisissez l'une des deux issues ci-dessous.");
  await expect(alerte).not.toContainText(/relisez/i);
  const impact = page.getByRole("region", { name: "Impact de la révision" });
  await expect(impact).toContainText("Aucune : la révision n'est pas possible depuis cette exploration, rien ne sera remplacé.");
  await expect(impact).not.toContainText("r1 de");
  // Ni relecture pour écraser, ni nouvelle écriture de révision : une seule requête est partie.
  await expect(page.getByRole("button", { name: /Relire/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Enregistrer la nouvelle révision" })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Nouvelle révision de l'analyse" })).toBeDisabled();
  await page.waitForTimeout(400);
  expect(serveur.journal.revisions).toEqual([{ id: ID, corps: { expected_revision: 1, ...BROUILLON_COPIE } }]);
  // Le bandeau et les exécutions disent toujours la révision ouverte.
  await expect(page.getByText(/Exploration à partir de « Chiffre d'affaires », révision 1/)).toBeVisible();
  await expect(page.getByText(/Les exécutions sont liées à l'analyse \(révision 1\)/)).toBeVisible();
  await axe(page);
  // Abandon : l'avertissement précède l'ouverture, qu'on peut annuler.
  await activer(page, divergence.getByRole("button", { name: "Ouvrir la révision courante (r2)" }));
  const abandon = panneau(page, "Abandonner le brouillon");
  await expect(abandon).toContainText("Ouvrir la révision courante (r2) abandonne votre brouillon");
  await axe(page);
  await activer(page, abandon.getByRole("button", { name: "Annuler" }));
  await expect(abandon).toHaveCount(0);
  await expect(page.getByLabel("Nom de l'analyse")).toHaveValue("Mon brouillon");
  // La copie indépendante garde le brouillon, sans toucher la révision courante.
  await activer(page, divergence.getByRole("button", { name: "Copie indépendante" }));
  await expect(page.getByRole("alert")).toHaveCount(0);
  await activer(page, page.getByRole("button", { name: "Enregistrer la copie" }));
  await expect(page.getByText("Analyse sauvegardée.")).toBeVisible();
  // La copie porte tout le brouillon (calculs contextuels et genre compris), la révision n'est écrite qu'une fois, la courante reste la r2.
  expect(serveur.journal.creations).toEqual([BROUILLON_COPIE]);
  expect(serveur.journal.revisions).toHaveLength(1);
  expect(serveur.entree(ID).revisions).toEqual([brouillon("Chiffre d'affaires", RICHE), REVISION_CORA]);
});

test("conflit : le lien de l'écart lance la comparaison du serveur entre la révision ouverte et la courante", async ({ page }) => {
  // Le lien affiche la fiche, qui consigne son ouverture ; hors de cela, seule la révision refusée a été écrite.
  const serveur = await conflit(page, [REVISION, OUVERTURE]);
  const lien = page.getByRole("link", { name: /Voir ce qui a changé/ });
  await expect(lien).toHaveAttribute("href", `#/espaces/finance/analyses/${ID}/historique/1/2`);
  await expect(lien).toHaveAttribute("target", "_blank");
  // Le lien s'ouvre dans un autre onglet ; le navigateur de test n'y rejoue pas les réponses simulées, on suit l'adresse ici.
  await page.goto(`/${(await lien.getAttribute("href")) ?? ""}`);
  await expect(page.getByRole("tab", { name: "Révisions" })).toHaveAttribute("aria-selected", "true");
  const table = page.getByRole("table", { name: "Écart entre r1 et r2" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("row", { name: /\/name/ })).toContainText("Révisée par Cora");
  // Le serveur compare toute la révision : la description, mais aussi la requête (opérateur et valeur d'un filtre).
  await expect(table.getByRole("row", { name: /\/description/ })).toContainText("Autre suivi.");
  await expect(table.getByRole("row", { name: /\/query\/filters\/0\/operator/ })).toContainText("eq");
  await expect(table.getByRole("row", { name: /\/query\/filters\/0\/value/ })).toContainText("Nord");
  await expect(table.getByRole("row", { name: /\/visibility|\/contextual|\/presentation/ })).toHaveCount(0);
  await expect(page.getByLabel("Révision de base")).toHaveValue("1");
  await expect(page.getByLabel("Révision comparée")).toHaveValue("2");
  expect(serveur.journal.ecarts).toEqual(["1:2"]);
  expect(serveur.compte("GET /analyses/:id/diff")).toBe(1);
  await axe(page);
});

test("conflit : l'abandon confirmé rouvre la révision courante par l'API", async ({ page }) => {
  const serveur = await conflit(page, [REVISION, EXECUTION_POST]);
  await activer(page, page.getByRole("button", { name: "Ouvrir la révision courante (r2)" }));
  await expect(panneau(page, "Abandonner le brouillon")).toContainText("abandonne votre brouillon");
  await activer(page, page.getByRole("button", { name: "Abandonner le brouillon et ouvrir" }));
  await expect(page).toHaveURL(new RegExp(`#/espaces/finance/explorer/analyses/${ID}/revisions/2$`));
  await expect(page.getByText(/Exploration à partir de « Révisée par Cora », révision 2/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Révision courante différente" })).toHaveCount(0);
  // La révision 2 rouverte porte le filtre et le genre de l'autre personne.
  await expect(page.getByText("region eq Nord")).toBeVisible();
  await activer(page, page.getByRole("button", { name: "Exécuter", exact: true }));
  await expect(page.getByLabel("Type de graphique")).toHaveValue("ligne");
  expect(serveur.journal.executions).toEqual([{ ...EXECUTION, filters: [{ column: "region", operator: "eq", value: "Nord" }], analysis: { id: ID, revision: 2 } }]);
  expect(serveur.journal.revisions).toHaveLength(1);
  expect(serveur.journal.creations).toHaveLength(0);
});

for (const [etat, id, libelle] of [["unresolved_reference", AUTRE_ID, "Référence non résolue"], ["unverified", TROISIEME_ID, "Non vérifiée"]] as const) {
  test(`analyse ${etat} : signalée sur la fiche et jamais ouverte à moitié dans l'Explorateur`, async ({ page }) => {
    // La fiche consigne son ouverture ; l'Explorateur, qui refuse d'ouvrir, n'écrit rien.
    await servir(page, { role: "creator", entrees: [entree(id, [brouillon("Chiffre d'affaires")], { etat, nonResolues: etat === "unresolved_reference" ? [{ path: "/query/metrics/0", rule: "unknown_metric" }] : [] })] }, [OUVERTURE]);
    await aller(page, `analyses/${id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Chiffre d'affaires" })).toBeVisible();
    await expect(page.getByText(libelle, { exact: true }).first()).toBeVisible();
    if (etat === "unresolved_reference") await expect(page.getByText("Références que le catalogue ne confirme pas")).toBeVisible();
    const ouvrir = page.getByRole("button", { name: "Ouvrir dans l'Explorateur", exact: true });
    await expect(ouvrir).toBeDisabled();
    await expect(ouvrir).toHaveAccessibleDescription(/l'Explorateur n'ouvre pas une analyse dont les références ne sont pas confirmées par le catalogue/);
    await axe(page);
    await aller(page, `explorer/analyses/${id}`);
    await expect(page.getByText("Cette analyse ne s'ouvre pas dans l'Explorateur : rien n'est ouvert à moitié.")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: /l'Explorateur n'ouvre pas une analyse dont les références/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Exécuter", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Retour à la fiche" })).toHaveAttribute("href", `#/espaces/finance/analyses/${id}`);
    await axe(page);
  });
}

const QUATRIEME_ID = "c1d2e3f4-0a1b-4c2d-8e3f-5a6b7c8d9e0f";
test("Preuves : exécution réussie avec sa provenance, décisions DENY et REQUIRE_HUMAN telles quelles, aucune exécution", async ({ page }) => {
  const serveur = await servir(page, { role: "reader", entrees: [
    partagee({ derniere: "reussie" }),
    entree(AUTRE_ID, [brouillon("Refusée")], { derniere: "refusee" }),
    entree(TROISIEME_ID, [brouillon("Jamais exécutée")], { derniere: "aucune" }),
    entree(QUATRIEME_ID, [brouillon("À valider")], { derniere: "require_human" }),
  ] }, Array.from({ length: 4 }, () => OUVERTURE));
  await aller(page, `analyses/${ID}`);
  await expect(page.getByRole("heading", { level: 1, name: "Chiffre d'affaires" })).toBeVisible();
  // Les onglets se parcourent aux flèches.
  await page.getByRole("tab", { name: "Requête" }).focus();
  await page.keyboard.press("End");
  const preuves = page.getByRole("tabpanel");
  await expect(page.getByRole("tab", { name: "Preuves" })).toHaveAttribute("aria-selected", "true");
  await expect(preuves).toContainText("Révision exécutée");
  await expect(preuves).toContainText("r1");
  await expect(preuves).toContainText("Réussie");
  const provenance = preuves.getByRole("region", { name: "Provenance" });
  await expect(provenance).toBeVisible();
  // La preuve est celle de la requête de l'analyse : son exécution, son empreinte, son modèle et ses colonnes.
  await expect(preuves).toContainText(executionDe(ID));
  await expect(provenance).toContainText(preuveDe(executionDe(ID)));
  await expect(provenance).toContainText(empreinte(EXECUTION));
  await expect(provenance).toContainText("CERTIFIED");
  await expect(provenance).toContainText("revenue · sales");
  await expect(provenance).toContainText("main.sales");
  await axe(page);
  await aller(page, `analyses/${AUTRE_ID}`);
  await expect(page.getByRole("heading", { level: 1, name: "Refusée" })).toBeVisible();
  await page.getByRole("tab", { name: "Preuves" }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Décision : DENY");
  await expect(page.getByRole("tabpanel")).toContainText("Aucun résultat n'a été produit.");
  await expect(page.getByRole("tabpanel")).not.toContainText("REQUIRE_HUMAN");
  await expect(page.getByRole("tabpanel").getByRole("region", { name: "Provenance" })).toHaveCount(0);
  await axe(page);
  await aller(page, `analyses/${QUATRIEME_ID}`);
  await expect(page.getByRole("heading", { level: 1, name: "À valider" })).toBeVisible();
  await page.getByRole("tab", { name: "Preuves" }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Décision : REQUIRE_HUMAN");
  await expect(page.getByRole("tabpanel")).toContainText("Aucun résultat n'a été produit.");
  await expect(page.getByRole("tabpanel")).not.toContainText("Décision : DENY");
  await expect(page.getByRole("tabpanel").getByRole("region", { name: "Provenance" })).toHaveCount(0);
  await axe(page);
  await aller(page, `analyses/${TROISIEME_ID}`);
  await expect(page.getByRole("heading", { level: 1, name: "Jamais exécutée" })).toBeVisible();
  await page.getByRole("tab", { name: "Preuves" }).click();
  await expect(page.getByText("Aucune exécution de votre part depuis cette analyse.")).toBeVisible();
  await axe(page);
  // La fiche ne lit que la dernière exécution : jamais de résultat, et rien ne s'écrit sinon l'ouverture de chaque fiche (4 déclarées).
  expect(serveur.journal.resultats).toEqual([]);
});

for (const refus of ["deny", "require_human"] as const) {
  test(`fail-closed : une exécution liée à une analyse refusée ${refus} est rendue telle quelle, sans résultat ni nouvel essai`, async ({ page }) => {
    const serveur = await servir(page, { role: "reader", entrees: [partagee()], execution: refus }, [EXECUTION_POST, EXECUTION_POST]);
    await aller(page, `explorer/analyses/${ID}`);
    await exploration(page);
    await activer(page, page.getByRole("button", { name: "Exécuter", exact: true }));
    const code = refus === "deny" ? "DENY" : "REQUIRE_HUMAN";
    const autre = refus === "deny" ? "REQUIRE_HUMAN" : "DENY";
    await expect(page.getByText(`Décision : ${code}`)).toBeVisible();
    await expect(page.getByText(`Décision : ${code}`)).toContainText("Raisons détaillées non fournies");
    await expect(page.getByText(`Décision : ${autre}`)).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Provenance" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Preuves", exact: true })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Tableau" })).toHaveCount(0);
    await axe(page);
    // Aucun nouvel essai de lui-même : une seule soumission, liée à la révision ouverte, et aucune lecture de résultat.
    await page.waitForTimeout(600);
    expect(serveur.journal.executions).toEqual([{ ...EXECUTION, analysis: { id: ID, revision: 1 } }]);
    expect(serveur.compte("POST /executions")).toBe(1);
    expect(serveur.journal.resultats).toEqual([]);
    expect(serveur.compte("GET /executions/:id/result")).toBe(0);
    // La décision n'est jamais mise en cache comme un succès : la suivante, explicitement demandée, est jugée à son tour.
    serveur.mode(refus === "deny" ? "require_human" : "deny");
    await activer(page, page.getByRole("button", { name: "Exécuter", exact: true }));
    await expect(page.getByText(`Décision : ${autre}`)).toBeVisible();
    await expect(page.getByText(`Décision : ${code}`)).toHaveCount(0);
    await page.waitForTimeout(600);
    expect(serveur.compte("POST /executions")).toBe(2);
    expect(serveur.journal.resultats).toEqual([]);
    await axe(page);
  });
}

test("liste : « Mes analyses », « Partagées » et l'avertissement des analyses illisibles", async ({ page }) => {
  // La liste n'écrit rien ; la fiche ouverte à la fin consigne son ouverture.
  await servir(page, { role: "creator", illisibles: 2, entrees: [lui("Mon suivi"), partagee({}, AUTRE_ID)] }, [OUVERTURE]);
  await aller(page, "analyses");
  await expect(page.getByRole("heading", { level: 1, name: "Analyses" })).toBeVisible();
  await expect(page.getByRole("alert").or(page.getByRole("status")).filter({ hasText: "2 de vos analyses n'ont pas pu être relues et ne sont pas listées." })).toBeVisible();
  const miennes = page.getByRole("region", { name: "Mes analyses · 1" });
  const autres = page.getByRole("region", { name: "Partagées · 1" });
  await expect(miennes.getByRole("link", { name: "Mon suivi" })).toBeVisible();
  await expect(miennes).toContainText("Vous");
  await expect(miennes).toContainText("Personnelle");
  await expect(autres.getByRole("link", { name: "Chiffre d'affaires" })).toBeVisible();
  await expect(autres).toContainText("cora");
  await expect(miennes.getByRole("link", { name: "Chiffre d'affaires" })).toHaveCount(0);
  await axe(page);
  // Ouverture d'une fiche au clavier.
  await autres.getByRole("link", { name: "Chiffre d'affaires" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Chiffre d'affaires" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/espaces/finance/analyses/${AUTRE_ID}$`));
});

// Le simulateur calcule le résultat sur un petit jeu de données : filtres d'abord, puis regroupement et agrégation.
const lignes = (requete: Partial<Requete>) => {
  const table = tableFromIPC(resultat({ ...EXECUTION, model: "sales_orders", metrics: ["revenue"], dimensions: [], filters: [], ...requete }).octets);
  return Array.from({ length: table.numRows }, (_, i) => Object.fromEntries(table.schema.fields.map((champ) => [champ.name, table.getChild(champ.name)?.get(i)])) as Record<string, unknown>);
};
const filtre = (column: string, operator: string, value: unknown) => ({ column, operator, value });
test("simulateur : les filtres s'appliquent avant la projection et l'agrégation, sur toute colonne du jeu", () => {
  expect(lignes({})).toEqual([{ revenue: 17 }]);
  // Sans dimension, un filtre sur une région réduit le total : le total des deux régions n'est jamais rendu.
  expect(lignes({ filters: [filtre("region", "eq", "Nord")] })).toEqual([{ revenue: 12 }]);
  expect(lignes({ filters: [filtre("region", "ne", "Nord")] })).toEqual([{ revenue: 5 }]);
  expect(lignes({ filters: [filtre("region", "in", ["Sud"])] })).toEqual([{ revenue: 5 }]);
  // Un filtre sur une dimension non rendue compte, lui aussi.
  expect(lignes({ filters: [filtre("channel", "eq", "Web")] })).toEqual([{ revenue: 13 }]);
  expect(lignes({ dimensions: ["region"], filters: [filtre("channel", "eq", "Web")] })).toEqual([{ region: "Nord", revenue: 10 }, { region: "Sud", revenue: 3 }]);
  expect(lignes({ dimensions: ["region"], filters: [filtre("region", "in", ["Nord", "Sud"]), filtre("channel", "ne", "Web")] })).toEqual([{ region: "Nord", revenue: 2 }, { region: "Sud", revenue: 2 }]);
  expect(lignes({ dimensions: ["channel", "region"] })).toHaveLength(4);
  // Les commandes sont un décompte de lignes, jamais une somme de montants.
  expect(lignes({ metrics: ["orders"] })).toEqual([{ orders: 5 }]);
  expect(lignes({ metrics: ["orders", "revenue"], dimensions: ["region"], filters: [filtre("channel", "eq", "Web")] })).toEqual([{ region: "Nord", orders: 2, revenue: 10 }, { region: "Sud", orders: 1, revenue: 3 }]);
  expect(resultat({ ...EXECUTION, model: "sales_orders", dimensions: [], filters: [filtre("region", "eq", "Nord")] }).lignes).toBe(1);
});

test("simulateur : une requête qu'il ne sait pas calculer est refusée, jamais devinée", () => {
  const sansReponse = (requete: Partial<Requete>) => resultat({ ...EXECUTION, model: "sales_orders", ...requete });
  for (const requete of [
    { filters: [filtre("region", "gt", "Nord")] }, { filters: [filtre("region", "between", ["A", "B"])] },
    { filters: [filtre("absente", "eq", "x")] }, { filters: [filtre("order_month", "eq", "2026-01-01")] },
    { filters: [filtre("region", "eq", 1)] }, { filters: [filtre("region", "in", [])] }, { filters: [filtre("region", "in", "Nord")] },
    { filters: [filtre("region", "eq", "Est")] },
    { dimensions: ["order_month"] }, { dimensions: ["absente"] }, { metrics: ["absente"] }, { model: "inconnu" },
    { model: "sales", filters: [filtre("channel", "eq", "Web")] },
  ] as Partial<Requete>[]) expect(() => sansReponse(requete), JSON.stringify(requete)).toThrow(Refus);
});

test("simulateur : le serveur simulé consigne comme imprévu un appel hors forme canonique ou hors route", async ({ page }) => {
  const serveur = await servir(page, { role: "reader", entrees: [partagee()] }, []);
  await aller(page, "analyses");
  const appeler = (chemin: string, methode = "GET") => page.evaluate(async ({ url, method }) => fetch(url, { method }).then((reponse) => reponse.status, () => "refusé"), { url: `/api/spaces/finance/analyses/${ID}${chemin}`, method: methode });
  expect(await appeler("/diff?base=1&other=1")).toBe(200);
  expect(serveur.journal.ecarts).toEqual(["1:1"]);
  const refusees = [
    "/diff?base=02&other=1", "/diff?base=1&other=01", "/diff?base=0&other=1", "/diff?base=%2B1&other=1", "/diff?base=1&other=1.0", "/diff?base=&other=1",
    "/diff?base=1234567890&other=1", "/diff?base=1&base=1&other=1", "/diff?base=1", "/diff?base=1&other=1&autre=1", "/revisions/02", "/revisions/0",
  ];
  for (const chemin of refusees) expect(await appeler(chemin), chemin).toBe("refusé");
  expect(await appeler("/diff?base=1&other=1", "POST")).toBe("refusé");
  expect(serveur.journal.inattendues).toHaveLength(refusees.length + 1);
  expect(serveur.journal.ecarts).toEqual(["1:1"]);
  expect(serveur.compte("GET /analyses/:id/diff")).toBe(1);
  // Ces refus sont ceux du test : le contrôle de fin de test reste exigeant pour tout le reste.
  serveur.journal.inattendues.splice(0);
});

test("cohérence : le résultat et la preuve sont ceux de la requête filtrée, sans dimension", async ({ page }) => {
  const serveur = await servir(page, { role: "reader" }, [EXECUTION_POST]);
  await aller(page, "explorer");
  await expect(page.getByRole("heading", { level: 1, name: "Explorer" })).toBeVisible();
  await cocher(page, page.getByRole("checkbox", { name: /Chiffre d'affaires/ }));
  await page.getByLabel("Dimension du filtre").selectOption("region");
  await page.getByLabel("Opérateur").selectOption("eq");
  await page.getByLabel(/^Valeur/).fill("Nord");
  await page.getByLabel(/^Valeur/).press("Enter");
  await expect(page.getByRole("button", { name: "Retirer le filtre region" })).toBeVisible();
  await activer(page, page.getByRole("button", { name: "Exécuter", exact: true }));
  const filtree = { connection: "finance", environment: "DEV", model: "sales", metrics: ["revenue"], dimensions: [], filters: [{ column: "region", operator: "eq", value: "Nord" }] } satisfies Requete;
  const total = await tableau(page);
  // Le total de la seule région Nord (12), jamais celui des deux (17) que rendrait un filtre ignoré.
  await expect(total).toContainText("12");
  await expect(total).not.toContainText("17");
  expect(serveur.journal.executions).toEqual([filtree]);
  const provenance = page.getByRole("region", { name: "Provenance" });
  await expect(provenance).toContainText(empreinte(filtree));
  await expect(provenance).not.toContainText(empreinte({ ...filtree, filters: [] }));
  await page.getByRole("button", { name: "Preuves", exact: true }).click();
  await expect(page.getByRole("region", { name: "Preuves", exact: true })).toContainText("region eq");
  expect(serveur.journal.resultats).toEqual([executionN(1)]);
});

/** Les six états photographiés, chacun préparé au clavier ou par adresse ; chacun passe Axe. */
type Etat = "liste" | "fiche" | "preuves" | "sauvegarde" | "impact" | "conflit";
const ETATS: readonly Etat[] = ["liste", "fiche", "preuves", "sauvegarde", "impact", "conflit"];
async function amener(page: Page, serveur: Serveur, etat: Etat, theme: (typeof THEMES)[number]) {
  switch (etat) {
    case "liste":
      await aller(page, "analyses");
      await expect(page.getByRole("region", { name: "Partagées · 1" })).toBeVisible();
      break;
    case "fiche":
      await aller(page, `analyses/${ID}`);
      await expect(page.getByRole("heading", { level: 1, name: "Chiffre d'affaires" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Requête" })).toHaveAttribute("aria-selected", "true");
      break;
    case "preuves":
      await aller(page, `analyses/${ID}`);
      await expect(page.getByRole("heading", { level: 1, name: "Chiffre d'affaires" })).toBeVisible();
      await page.getByRole("tab", { name: "Preuves" }).click();
      await expect(page.getByRole("region", { name: "Provenance" })).toBeVisible();
      break;
    case "sauvegarde":
      await aller(page, "explorer");
      await expect(page.getByRole("heading", { level: 1, name: "Explorer" })).toBeVisible();
      await composer(page);
      await choisirTheme(page, theme);
      await activer(page, page.getByRole("button", { name: "Sauvegarder comme analyse", exact: true }));
      await panneau(page, "Sauvegarder comme analyse").getByLabel("Nom de l'analyse").fill("Ventes par région");
      await expect(page.getByRole("group", { name: "Aperçu de l'analyse" })).toContainText("Ventes par région");
      break;
    case "impact":
      await aller(page, `explorer/analyses/${ID}`);
      await exploration(page);
      await choisirTheme(page, theme);
      await activer(page, page.getByRole("button", { name: "Nouvelle révision", exact: true }));
      await expect(page.getByRole("region", { name: "Impact de la révision" })).toBeVisible();
      break;
    case "conflit":
      await aller(page, `explorer/analyses/${ID}`);
      await exploration(page);
      await choisirTheme(page, theme);
      await activer(page, page.getByRole("button", { name: "Nouvelle révision", exact: true }));
      await panneau(page, "Nouvelle révision").getByLabel("Nom de l'analyse").fill("Mon brouillon");
      // Une autre personne enregistre la révision 2 avant la nôtre.
      serveur.publierAilleurs(ID, REVISION_CORA);
      await activer(page, page.getByRole("button", { name: "Enregistrer la nouvelle révision" }));
      await expect(page.getByRole("button", { name: "Ouvrir la révision courante (r2)" })).toBeVisible();
      break;
  }
  if (etat === "liste" || etat === "fiche" || etat === "preuves") await choisirTheme(page, theme);
}
function servirTout(page: Page, ecritures: readonly string[]): Promise<Serveur> {
  return servir(page, { role: "creator", illisibles: 1, entrees: [lui("Chiffre d'affaires", { derniere: "reussie" }, "shared"), entree(AUTRE_ID, [brouillon("Budget 2026")], { derniere: "refusee" })] }, ecritures);
}
const nomCapture = (etat: Etat, theme: (typeof THEMES)[number]) => `analyses-${etat}-${theme === "Skifer clair" ? "clair" : "ardoise"}.png`;

for (const theme of THEMES) {
  test(`captures pleine page et axe, ${theme}`, async ({ page }) => {
    // Les fiches « fiche » et « preuves » consignent chacune une ouverture ; l'état « conflit » écrit la révision refusée.
    const serveur = await servirTout(page, [OUVERTURE, OUVERTURE, REVISION]);
    for (const etat of ETATS) {
      await page.goto("about:blank");
      await amener(page, serveur, etat, theme);
      await axe(page);
      await expect(page).toHaveScreenshot(nomCapture(etat, theme), { fullPage: true });
    }
  });
}

for (const theme of THEMES) {
  test(`axe sur chaque onglet de la fiche, l'ouverture refusée et la lecture seule, ${theme}`, async ({ page }) => {
    await servir(page, { role: "reader", entrees: [
      partagee({ derniere: "reussie" }),
      entree(AUTRE_ID, [brouillon("Chiffre d'affaires")], { etat: "unresolved_reference", nonResolues: [{ path: "/query/metrics/0", rule: "unknown_metric" }] }),
      entree(TROISIEME_ID, [brouillon("Budget 2026")], { derniere: "refusee" }),
    ] }, [OUVERTURE, OUVERTURE, OUVERTURE, EXECUTION_POST]);
    await aller(page, `analyses/${ID}`);
    await expect(page.getByRole("heading", { level: 1, name: "Chiffre d'affaires" })).toBeVisible();
    // Trois fiches affichées (trois ouvertures), puis une exécution depuis l'Explorateur ; les deux refus d'ouverture n'écrivent rien.
    await choisirTheme(page, theme);
    for (const onglet of ["Requête", "Calculs contextuels", "Présentation par défaut", "Révisions", "Consommateurs", "Usage", "Preuves"]) {
      await page.getByRole("tab", { name: onglet }).click();
      await expect(page.getByRole("tab", { name: onglet })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tabpanel")).toBeVisible();
      await expect(page.getByText(/^Lecture de/)).toHaveCount(0);
      await axe(page);
    }
    await aller(page, `analyses/${AUTRE_ID}`);
    await choisirTheme(page, theme);
    await expect(page.getByText("Références que le catalogue ne confirme pas")).toBeVisible();
    await axe(page);
    await aller(page, `explorer/analyses/${AUTRE_ID}`);
    await choisirTheme(page, theme);
    await expect(page.getByText("Cette analyse ne s'ouvre pas dans l'Explorateur : rien n'est ouvert à moitié.")).toBeVisible();
    await axe(page);
    await aller(page, `analyses/${TROISIEME_ID}`);
    await choisirTheme(page, theme);
    await page.getByRole("tab", { name: "Preuves" }).click();
    await expect(page.getByText("Décision : DENY")).toBeVisible();
    await axe(page);
    await aller(page, `explorer/analyses/${ID}`);
    await exploration(page);
    await choisirTheme(page, theme);
    await activer(page, page.getByRole("button", { name: "Exécuter", exact: true }));
    await expect(page.getByRole("tab", { name: "Tableau" })).toBeVisible();
    await axe(page);
  });
}

test("aucun débordement horizontal à 390, 768 et 1 280 px : liste, fiche et ses onglets, sauvegarde, impact et conflit", async ({ page }) => {
  // La fiche consigne son ouverture (une seule, les onglets n'en font pas) ; l'état « conflit » écrit la révision refusée.
  const serveur = await servirTout(page, [OUVERTURE, REVISION]);
  const mesures: Record<string, string> = {};
  const mesurer = async (etat: string) => {
    for (const largeur of LARGEURS) {
      await page.setViewportSize({ width: largeur, height: 900 });
      const [defile, visible] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      mesures[`${etat} @${String(largeur)}`] = `${String(defile)}/${String(visible)}`;
      await sansDebordement(page);
    }
  };
  await amener(page, serveur, "liste", "Skifer clair");
  await mesurer("liste");
  await aller(page, `analyses/${ID}`);
  await expect(page.getByRole("heading", { level: 1, name: "Chiffre d'affaires" })).toBeVisible();
  for (const onglet of ["Requête", "Calculs contextuels", "Présentation par défaut", "Révisions", "Consommateurs", "Usage", "Preuves"]) {
    await page.getByRole("tab", { name: onglet }).click();
    await expect(page.getByRole("tab", { name: onglet })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(/^Lecture de/)).toHaveCount(0);
    await mesurer(`fiche ${onglet}`);
  }
  await amener(page, serveur, "sauvegarde", "Skifer clair");
  await mesurer("sauvegarde");
  await amener(page, serveur, "impact", "Skifer clair");
  await mesurer("impact");
  await amener(page, serveur, "conflit", "Skifer clair");
  await mesurer("conflit");
  await test.info().attach("debordement.json", { body: JSON.stringify(mesures, null, 2), contentType: "application/json" });
  console.log(JSON.stringify(mesures));
});
