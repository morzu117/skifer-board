import { executionN } from "./serveur-analyses";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { choisirTheme } from "./aides";
import {
  AUTRE_DASHBOARD_ID, DASHBOARD_ID, entreeDashboard, pageDe, servirDashboards, texte, uuid, visuel,
  type AnalysePinglee, type ReglagesDashboards, type ServeurDashboards,
} from "./serveur-dashboards";

const THEMES = ["Skifer clair", "Skifer ardoise"] as const;
const LARGEURS = [390, 768, 1280] as const;
const ANALYSE = uuid(21);
const ANALYSE_DENY = uuid(22);
const ANALYSE_HUMAINE = uuid(23);
const ANALYSE_RETIREE = uuid(24);
const ANALYSE_NON_VERIFIEE = uuid(25);
const ANALYSE_TRONQUEE = uuid(26);
const ANALYSE_PERDUE = uuid(27);
const ANALYSES: Record<string, AnalysePinglee> = {
  [ANALYSE]: { nom: "Ventes réalisées" },
  [ANALYSE_DENY]: { nom: "Ventes refusées", issue: "deny" },
  [ANALYSE_HUMAINE]: { nom: "Ventes à valider", issue: "require_human" },
  [ANALYSE_RETIREE]: { nom: "Ventes retirées", tuile: "indisponible" },
  [ANALYSE_NON_VERIFIEE]: { nom: "Ventes non vérifiées", tuile: "non_verifie" },
  [ANALYSE_TRONQUEE]: { nom: "Ventes tronquées", issue: "tronque" },
  [ANALYSE_PERDUE]: { nom: "Ventes sans résultat", issue: "resultat_perdu" },
};
const TUILES = pageDe("Tuiles", [visuel(uuid(31), ANALYSE), visuel(uuid(32), ANALYSE_DENY), visuel(uuid(33), ANALYSE_HUMAINE), visuel(uuid(34), ANALYSE_RETIREE)]);
// Le catalogue n'ayant pas pu être lu, aucune tuile n'est ni confirmée ni infirmée : l'état « non vérifié » est celui du dashboard entier.
const NON_VERIFIE = pageDe("Catalogue illisible", [visuel(uuid(35), ANALYSE_NON_VERIFIEE, { title: "Première" }), visuel(uuid(36), ANALYSE_NON_VERIFIEE, { title: "Seconde" })]);

// Chaque test déclare, en servant, la liste exacte de ses écritures ; à la fin du test, une demande hors scénario ou une écriture en
// plus, en moins ou dans un autre ordre le fait échouer.
const serveurs: { serveur: ServeurDashboards; ecritures: readonly string[] }[] = [];
test.afterEach(() => {
  for (const { serveur, ecritures } of serveurs.splice(0)) {
    expect(serveur.journal.inattendues).toEqual([]);
    expect(serveur.ecritures()).toEqual(ecritures);
  }
});

async function servir(page: Page, reglages: ReglagesDashboards, ecritures: readonly string[]): Promise<ServeurDashboards> {
  const serveur = await servirDashboards(page, reglages);
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
async function aller(page: Page, hash: string) {
  await page.goto(`/#/espaces/finance/${hash}`);
  await page.evaluate(async () => { await document.fonts.ready; });
}
/** Une tuile : la région d'un graphique, ou le groupe d'une tuile sans graphique (valeur, refus, indisponibilité). */
const tuile = (page: Page, nom: string) => page.getByRole("region", { name: nom, exact: true }).or(page.locator(".sb-tile", { has: page.getByRole("heading", { name: nom, exact: true }) }));
const annonce = (page: Page) => page.locator(".sb-editor__announce");
const ajouter = (page: Page, nom: string) => activer(page, page.getByRole("button", { name: nom, exact: true }));
const noeud = (page: Page, nom: string | RegExp) => page.locator(".sb-node__select").filter({ hasText: nom }).first();
/** Forme d'un document, sans identifiants : genre de chaque nœud et titres des sections. */
const forme = (corps: unknown): unknown => JSON.parse(JSON.stringify(corps, (cle, valeur: unknown) => (cle === "id" ? undefined : valeur)));

test("créer depuis la liste, composer deux sections au clavier, annuler, rétablir, enregistrer et rouvrir", async ({ page }) => {
  const serveur = await servir(page, { role: "creator" }, ["POST /dashboards", "POST /dashboards/:id/revisions"]);
  await aller(page, "dashboards");
  await expect(page.getByText("Aucun dashboard à afficher pour vous dans cet espace")).toBeVisible();
  // Création : nom, description et visibilité au clavier, puis l'éditeur s'ouvre.
  await activer(page, page.getByRole("button", { name: "Nouveau dashboard", exact: true }));
  const dialogue = page.getByRole("dialog", { name: "Nouveau dashboard" });
  await expect(dialogue.getByRole("textbox", { name: "Nom du dashboard" })).toBeFocused();
  await page.keyboard.type("Pilotage commercial");
  await page.keyboard.press("Tab");
  await expect(dialogue.getByRole("textbox", { name: "Description" })).toBeFocused();
  await page.keyboard.type("Suivi des ventes.");
  await page.keyboard.press("Tab");
  await expect(dialogue.getByRole("radio", { name: "Personnel" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(dialogue.getByRole("radio", { name: "Partagé" })).toBeChecked();
  await activer(page, dialogue.getByRole("button", { name: "Créer et ouvrir" }));
  await expect(page).toHaveURL(new RegExp(`#/espaces/finance/dashboards/${DASHBOARD_ID}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Pilotage commercial" })).toBeVisible();
  await expect(page.getByText("Aucune section : ajoutez-en une avec la palette.")).toBeVisible();
  expect(serveur.journal.creations).toEqual([{ name: "Pilotage commercial", description: "Suivi des ventes.", visibility: "shared", defaults: {}, filters: [], layout: { sections: [] } }]);
  // Composition : une section, sa rangée, sa colonne et un texte, puis une seconde section.
  await ajouter(page, "Ajouter une section");
  await expect(annonce(page)).toHaveText("Section ajouté : Section 1, position 1 sur 1.");
  await ajouter(page, "Ajouter une rangée");
  await ajouter(page, "Ajouter une colonne");
  await ajouter(page, "Ajouter un texte");
  await expect(annonce(page)).toHaveText("Texte ajouté : Texte, position 1 sur 1, dans Colonne 1 · 12/12.");
  await ajouter(page, "Ajouter une section");
  await expect(annonce(page)).toHaveText("Section ajouté : Section 2, position 2 sur 2.");
  await expect(page.getByText("Modifications non enregistrées")).toBeVisible();
  // Titre de la seconde section, validé en quittant le champ.
  await expect(page.getByRole("heading", { name: "Propriétés · Section 2" })).toBeVisible();
  await page.getByRole("textbox", { name: /^Titre de la section/ }).focus();
  await page.keyboard.type("Détail");
  await page.keyboard.press("Enter");
  await expect(noeud(page, "Section 2 · Détail")).toBeVisible();
  // Annuler puis rétablir, par le raccourci puis par le bouton.
  await noeud(page, "Section 2 · Détail").focus();
  await page.keyboard.press("Control+z");
  await expect(annonce(page)).toHaveText("Dernière modification annulée.");
  await expect(noeud(page, "Section 2 · Détail")).toHaveCount(0);
  await expect(noeud(page, /^Section 2$/)).toBeVisible();
  await activer(page, page.getByRole("button", { name: "Rétablir", exact: true }));
  await expect(noeud(page, "Section 2 · Détail")).toBeVisible();
  // Enregistrer avec la révision attendue.
  await activer(page, page.getByRole("button", { name: "Enregistrer", exact: true }));
  await expect(page.getByText("Révision 2 enregistrée.")).toBeVisible();
  await expect(page.getByText("Tout est enregistré")).toBeVisible();
  expect(serveur.journal.revisions).toHaveLength(1);
  const envoye = serveur.journal.revisions[0]?.corps as Record<string, unknown>;
  expect(envoye.expected_revision).toBe(1);
  expect(Object.keys(envoye).sort()).toEqual(["defaults", "description", "expected_revision", "filters", "layout", "name", "visibility"]);
  expect(forme({ ...envoye, expected_revision: undefined })).toEqual({
    name: "Pilotage commercial", description: "Suivi des ventes.", visibility: "shared", defaults: {}, filters: [],
    layout: { sections: [
      { rows: [{ columns: [{ span: 12, children: [{ type: "text", blocks: [] }] }] }] },
      { title: "Détail", rows: [] },
    ] },
  });
  expect(serveur.entree(DASHBOARD_ID).revisions).toHaveLength(2);
  // Réouverture : ce que le serveur a gardé est ce qui s'affiche.
  await page.reload();
  await expect(page.getByText(/Éditeur de dashboard · Partagé · révision 2/)).toBeVisible();
  await expect(noeud(page, "Section 2 · Détail")).toBeVisible();
  await expect(page.getByText("Tout est enregistré")).toBeVisible();
  // Déplacer au clavier : la section passe avant l'autre, annoncée, et garde le focus.
  await noeud(page, "Section 2 · Détail").focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(annonce(page)).toHaveText("Déplacé : Section 1 · Détail, position 1 sur 2.");
  await expect(page.locator(".sb-node__select").filter({ hasText: "Détail" })).toBeFocused();
  await expect(page.locator(".sb-node__select").filter({ hasText: /^Section 1 · Détail$/ })).toBeVisible();
  await expect(page.getByText("Modifications non enregistrées")).toBeVisible();
});

test("les tuiles prêtes, indisponibles et non vérifiées, les refus DENY et REQUIRE_HUMAN, sans exécution inutile ni nouvel essai", async ({ page }) => {
  const serveur = await servir(page, { role: "creator", analyses: ANALYSES, dashboards: [entreeDashboard(DASHBOARD_ID, TUILES), entreeDashboard(AUTRE_DASHBOARD_ID, NON_VERIFIE)] }, []);
  await aller(page, `dashboards/${DASHBOARD_ID}`);
  await expect(page.getByRole("heading", { level: 1, name: "Tuiles" })).toBeVisible();
  await expect(page.getByText("Référence non résolue")).toBeVisible();
  // Prête : la valeur et sa provenance (preuve, empreinte SQL, certification, âge).
  const prete = tuile(page, "Ventes réalisées");
  await expect(prete.getByText("Preuve", { exact: true })).toBeVisible();
  await expect(prete.getByText("Empreinte SQL", { exact: true })).toBeVisible();
  await expect(prete.getByText("Certification des sources", { exact: true })).toBeVisible();
  await expect(prete.getByText("Âge des données", { exact: true })).toBeVisible();
  await expect(prete.locator("dd.sb-mono").nth(0)).toHaveText(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  await expect(prete.locator("dd .sb-mono").first()).toHaveText(/^sha256:v1:[0-9a-f]{64}$/);
  // Les refus du moteur s'affichent tels quels.
  await expect(tuile(page, "Ventes refusées")).toContainText("DENY · accès refusé");
  await expect(tuile(page, "Ventes à valider")).toContainText("REQUIRE_HUMAN · validation humaine requise");
  await expect(tuile(page, "Ventes refusées").getByText("Preuve", { exact: true })).toHaveCount(0);
  // Indisponible : sa raison, sans exécution.
  await expect(tuile(page, "Visuel épinglé")).toContainText("L'analyse épinglée n'est pas disponible pour vous");
  // Trois exécutions seulement, une par tuile exécutable, et aucune de plus après coup : pas de nouvel essai.
  await expect.poll(() => serveur.journal.executions.length).toBe(3);
  await page.waitForTimeout(1500);
  expect(serveur.journal.executions).toHaveLength(3);
  await expect(page.getByRole("button", { name: /Réessayer|Relancer|Ré-exécuter/ })).toHaveCount(0);
  expect(serveur.journal.executions.map((corps) => (corps.analysis as { id: string }).id).sort()).toEqual([ANALYSE, ANALYSE_DENY, ANALYSE_HUMAINE].sort());
  expect(serveur.journal.resultats).toHaveLength(1);
  expect(serveur.enCours()).toBe(0);
  // Non vérifié : chaque tuile dit sa raison, et rien n'est exécuté de plus.
  await aller(page, `dashboards/${AUTRE_DASHBOARD_ID}`);
  await expect(page.getByRole("heading", { level: 1, name: "Catalogue illisible" })).toBeVisible();
  await expect(page.locator(".sb-badge", { hasText: /^Non vérifié$/ })).toBeVisible();
  await expect(tuile(page, "Première")).toContainText("Le catalogue n'a pas pu être lu");
  await expect(tuile(page, "Seconde")).toContainText("Le catalogue n'a pas pu être lu");
  await page.waitForTimeout(1000);
  expect(serveur.journal.executions).toHaveLength(3);
});

test("quatre exécutions au plus en même temps, observées côté serveur", async ({ page }) => {
  const analyses = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [uuid(90 + index), { nom: `Analyse ${String(index + 1)}` }]));
  const six = Array.from({ length: 6 }, (_, index) => visuel(uuid(40 + index), uuid(90 + index), { title: `Tuile ${String(index + 1)}` }));
  const serveur = await servir(page, { role: "creator", analyses, retenir: true, dashboards: [entreeDashboard(DASHBOARD_ID, pageDe("Six tuiles", six))] }, []);
  await aller(page, `dashboards/${DASHBOARD_ID}`);
  await expect(page.getByRole("heading", { level: 1, name: "Six tuiles" })).toBeVisible();
  await expect.poll(() => serveur.enCours()).toBe(4);
  // Les deux dernières attendent une place : le serveur n'en voit toujours que quatre, et la page le dit.
  await page.waitForTimeout(1500);
  expect(serveur.enCours()).toBe(4);
  expect(serveur.journal.executions).toHaveLength(4);
  await expect(page.getByText("En attente d'une place : quatre exécutions au plus tournent en même temps.")).toHaveCount(2);
  serveur.liberer();
  await expect.poll(() => serveur.journal.executions.length, { timeout: 15_000 }).toBe(6);
  await expect(page.getByText("Preuve", { exact: true })).toHaveCount(6, { timeout: 15_000 });
  expect(serveur.maximum()).toBe(4);
  expect(serveur.enCours()).toBe(0);
});

test("un problème bloquant empêche l'enregistrement, et le cliquer mène au nœud", async ({ page }) => {
  const serveur = await servir(page, { role: "creator", analyses: ANALYSES, dashboards: [entreeDashboard(DASHBOARD_ID, pageDe("Avec un blocage", [visuel(uuid(51), ANALYSE), visuel(uuid(52), ANALYSE_RETIREE)]))] }, []);
  await aller(page, `dashboards/${DASHBOARD_ID}`);
  await expect(page.getByRole("heading", { level: 1, name: "Avec un blocage" })).toBeVisible();
  await ajouter(page, "Ajouter une section");
  await expect(page.getByText("Modifications non enregistrées")).toBeVisible();
  const enregistrer = page.getByRole("button", { name: "Enregistrer", exact: true });
  await expect(enregistrer).toBeDisabled();
  await expect(page.getByText(/Enregistrement impossible : 1 problème bloquant/)).toBeVisible();
  await activer(page, page.getByRole("button", { name: "Voir les problèmes" }));
  await expect(page.getByRole("tab", { name: /^Problèmes/ })).toBeFocused();
  const probleme = page.getByRole("button", { name: /Bloquant.*Analyse indisponible/ });
  await expect(probleme).toBeVisible();
  await expect(page.getByText("Un problème bloquant empêche l'enregistrement : corrigez-le d'abord.")).toBeVisible();
  await activer(page, probleme);
  await expect(page.getByRole("heading", { name: /^Propriétés · Visuel/ })).toBeVisible();
  await expect(page.locator(`#sb-node-${uuid(52)}`)).toBeFocused();
  await expect(page.locator(`#sb-node-${uuid(52)}`)).toHaveAttribute("aria-pressed", "true");
  await expect(enregistrer).toBeDisabled();
  expect(serveur.journal.revisions).toEqual([]);
});

test("la garde de sortie retient les modifications non enregistrées, et laisse partir sur demande", async ({ page }) => {
  const serveur = await servir(page, { role: "creator", analyses: ANALYSES, dashboards: [entreeDashboard(DASHBOARD_ID, pageDe("À garder", [texte(uuid(61), "Bonjour")]))] }, []);
  await aller(page, `dashboards/${DASHBOARD_ID}`);
  await expect(page.getByRole("heading", { level: 1, name: "À garder" })).toBeVisible();
  // Sans modification, la sortie est libre ; avec une modification, elle est retenue.
  await ajouter(page, "Ajouter une section");
  await expect(page.getByText("Modifications non enregistrées")).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Navigation principale" });
  await activer(page, navigation.getByRole("button", { name: "Dashboards", exact: true }));
  const garde = page.getByRole("dialog", { name: "Quitter sans enregistrer ?" });
  await expect(garde).toBeVisible();
  await expect(garde.getByRole("button", { name: "Rester" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(garde).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`dashboards/${DASHBOARD_ID}$`));
  await expect(noeud(page, "Section 2")).toBeVisible();
  // La même demande est retenue de nouveau, puis on quitte en connaissance de cause.
  await activer(page, navigation.getByRole("button", { name: "Dashboards", exact: true }));
  await expect(garde).toBeVisible();
  await activer(page, garde.getByRole("button", { name: "Quitter sans enregistrer" }));
  await expect(page.getByRole("heading", { level: 1, name: "Dashboards" })).toBeVisible();
  await expect(page).toHaveURL(/#\/espaces\/finance\/dashboards$/);
  // Rien n'a été envoyé : la révision enregistrée est intacte.
  expect(serveur.entree(DASHBOARD_ID).revisions).toHaveLength(1);
  await page.getByRole("link", { name: "À garder" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "À garder" })).toBeVisible();
  await expect(noeud(page, /^Section 2$/)).toHaveCount(0);
  await expect(page.getByText("Tout est enregistré")).toBeVisible();
});

/** Un dashboard ouvert depuis la liste, avec une section ajoutée : des modifications non enregistrées, et une entrée d'historique avant l'éditeur. */
async function ouvrirModifie(page: Page): Promise<ServeurDashboards> {
  const serveur = await servir(page, { role: "creator", analyses: ANALYSES, dashboards: [entreeDashboard(DASHBOARD_ID, pageDe("À garder", [texte(uuid(61), "Bonjour")]))] }, []);
  await page.goto("/#/");
  await expect(page.getByRole("heading", { level: 1, name: "Vos espaces" })).toBeVisible();
  await page.goto("/#/espaces/finance/dashboards");
  await page.getByRole("link", { name: "À garder" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "À garder" })).toBeVisible();
  // Sans modification, Précédent part sans question.
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Dashboards" })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { level: 1, name: "À garder" })).toBeVisible();
  await ajouter(page, "Ajouter une section");
  await expect(page.getByText("Modifications non enregistrées")).toBeVisible();
  return serveur;
}

test("le bouton Précédent passe par la garde : refusé, l'éditeur et ses modifications restent ; accepté, on quitte", async ({ page }) => {
  const serveur = await ouvrirModifie(page);
  const garde = page.getByRole("dialog", { name: "Quitter sans enregistrer ?" });
  await page.goBack();
  await expect(garde).toBeVisible();
  // L'adresse de l'éditeur est rétablie sur place : ni rechargement, ni perte de l'état.
  await expect(page).toHaveURL(new RegExp(`dashboards/${DASHBOARD_ID}$`));
  await expect(noeud(page, "Section 2")).toBeVisible();
  await activer(page, garde.getByRole("button", { name: "Rester" }));
  await expect(garde).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "À garder" })).toBeVisible();
  await expect(noeud(page, "Section 2")).toBeVisible();
  await expect(page.getByText("Modifications non enregistrées")).toBeVisible();
  // Après ce refus, l'entrée visitée porte l'adresse de l'éditeur : le pas suivant en arrière mène à l'accueil.
  await page.goBack();
  await expect(garde).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`dashboards/${DASHBOARD_ID}$`));
  await activer(page, garde.getByRole("button", { name: "Quitter sans enregistrer" }));
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "Vos espaces" })).toBeVisible();
  expect(serveur.entree(DASHBOARD_ID).revisions).toHaveLength(1);
});

test("une adresse saisie à la main passe par la garde : refusée, rien ne change ; acceptée, on quitte", async ({ page }) => {
  const serveur = await ouvrirModifie(page);
  const garde = page.getByRole("dialog", { name: "Quitter sans enregistrer ?" });
  await page.evaluate(() => { window.location.hash = "#/espaces/finance/dashboards"; });
  await expect(garde).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`dashboards/${DASHBOARD_ID}$`));
  await expect(noeud(page, "Section 2")).toBeVisible();
  await activer(page, garde.getByRole("button", { name: "Rester" }));
  await expect(garde).toHaveCount(0);
  await expect(noeud(page, "Section 2")).toBeVisible();
  await expect(page.getByText("Modifications non enregistrées")).toBeVisible();
  await page.evaluate(() => { window.location.hash = "#/espaces/finance/dashboards"; });
  await expect(garde).toBeVisible();
  await activer(page, garde.getByRole("button", { name: "Quitter sans enregistrer" }));
  await expect(page).toHaveURL(/#\/espaces\/finance\/dashboards$/);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboards" })).toBeVisible();
  expect(serveur.entree(DASHBOARD_ID).revisions).toHaveLength(1);
});

test("déplacer une tuile, annuler ou rétablir ne resoumet ni le refus du moteur ni aucune requête inchangée", async ({ page }) => {
  const serveur = await servir(page, { role: "creator", analyses: ANALYSES, dashboards: [entreeDashboard(DASHBOARD_ID, pageDe("Refus gardé", [visuel(uuid(71), ANALYSE_DENY), visuel(uuid(72), ANALYSE)]))] }, []);
  await aller(page, `dashboards/${DASHBOARD_ID}`);
  await expect(tuile(page, "Ventes refusées")).toContainText("DENY · accès refusé");
  await expect(tuile(page, "Ventes réalisées").getByText("Preuve", { exact: true })).toBeVisible();
  await expect.poll(() => serveur.journal.executions.length).toBe(2);
  // Le visuel réussi passe devant le refus : l'ordre des tuiles change, pas leurs requêtes.
  await noeud(page, /^Visuel · Ventes réalisées/).focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(annonce(page)).toContainText("Déplacé : Visuel · Ventes réalisées");
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await page.getByRole("button", { name: "Rétablir", exact: true }).click();
  await page.waitForTimeout(1500);
  expect(serveur.journal.executions).toHaveLength(2);
  await expect(tuile(page, "Ventes refusées")).toContainText("DENY · accès refusé");
  await expect(tuile(page, "Ventes réalisées").getByText("Preuve", { exact: true })).toBeVisible();
  expect(serveur.journal.resultats).toHaveLength(1);
});

test("un résultat tronqué le dit ; un résultat illisible garde l'identifiant de l'exécution pour le diagnostic", async ({ page }) => {
  const serveur = await servir(page, { role: "creator", analyses: ANALYSES, dashboards: [entreeDashboard(DASHBOARD_ID, pageDe("Résultats", [visuel(uuid(73), ANALYSE_TRONQUEE), visuel(uuid(74), ANALYSE_PERDUE)]))] }, []);
  await aller(page, `dashboards/${DASHBOARD_ID}`);
  const tronquee = tuile(page, "Ventes tronquées");
  await expect(tronquee).toContainText("Résultat partiel : une limite de la source ou du résultat a été atteinte");
  // Le résultat reste affiché, avec sa provenance : le bandeau ne le remplace pas.
  await expect(tronquee.getByText("Preuve", { exact: true })).toBeVisible();
  const perdue = tuile(page, "Ventes sans résultat");
  await expect(perdue.getByRole("alert")).toContainText("Échec de la tuile");
  await expect(perdue.getByRole("alert")).toContainText(/Exécution [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\./);
  await expect(perdue.getByText("Preuve", { exact: true })).toHaveCount(0);
  await page.waitForTimeout(1000);
  expect(serveur.journal.executions).toHaveLength(2);
});

test("annuler après l'enregistrement d'une suppression rend le visuel sans faire tomber l'éditeur", async ({ page }) => {
  const erreurs: string[] = [];
  page.on("pageerror", (erreur) => { erreurs.push(erreur.message); });
  const serveur = await servir(page, { role: "creator", analyses: ANALYSES, dashboards: [entreeDashboard(DASHBOARD_ID, pageDe("À rétablir", [visuel(uuid(75), ANALYSE), visuel(uuid(76), ANALYSE_DENY)]))] }, ["POST /dashboards/:id/revisions"]);
  await aller(page, `dashboards/${DASHBOARD_ID}`);
  await expect(tuile(page, "Ventes refusées")).toContainText("DENY · accès refusé");
  await noeud(page, /^Visuel · Ventes refusées/).focus();
  await page.keyboard.press("Delete");
  await expect(noeud(page, /^Visuel · Ventes refusées/)).toHaveCount(0);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Révision 2 enregistrée.")).toBeVisible();
  // Le serveur ne connaît plus la tuile supprimée : « Annuler » la rétablit dans le document, sans tuile enregistrée.
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(noeud(page, /^Visuel · Ventes refusées/)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "À rétablir" })).toBeVisible();
  await expect(tuile(page, "Ventes refusées")).toContainText("DENY · accès refusé");
  await page.waitForTimeout(1000);
  expect(erreurs).toEqual([]);
  // Le refus du moteur n'a pas été resoumis : une exécution par requête, la suppression et le rétablissement n'y changent rien.
  expect(serveur.journal.executions).toHaveLength(2);
});

test("une saisie en cours dans un champ est un changement non enregistré : Précédent, adresse saisie et rechargement sont retenus", async ({ page }) => {
  const serveur = await servir(page, { role: "creator", analyses: ANALYSES, dashboards: [entreeDashboard(DASHBOARD_ID, pageDe("À garder", [texte(uuid(61), "Bonjour")]))] }, []);
  await page.goto("/#/");
  await expect(page.getByRole("heading", { level: 1, name: "Vos espaces" })).toBeVisible();
  await page.goto("/#/espaces/finance/dashboards");
  await page.getByRole("link", { name: "À garder" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "À garder" })).toBeVisible();
  const garde = page.getByRole("dialog", { name: "Quitter sans enregistrer ?" });
  const retenu = () => page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });
  expect(await retenu()).toBe(false);
  // Le champ n'est pas quitté : rien n'est encore validé vers le document.
  const nom = page.getByRole("textbox", { name: "Nom du dashboard" });
  await nom.click();
  await page.keyboard.type(" bis");
  await expect(nom).toBeFocused();
  await expect(page.getByText("Modifications non enregistrées")).toBeVisible();
  expect(await retenu()).toBe(true);
  await page.goBack();
  await expect(garde).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`dashboards/${DASHBOARD_ID}$`));
  await activer(page, garde.getByRole("button", { name: "Rester" }));
  await expect(garde).toHaveCount(0);
  await expect(nom).toHaveValue("À garder bis");
  await page.evaluate(() => { window.location.hash = "#/espaces/finance/dashboards"; });
  await expect(garde).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`dashboards/${DASHBOARD_ID}$`));
  await activer(page, garde.getByRole("button", { name: "Quitter sans enregistrer" }));
  await expect(page.getByRole("heading", { level: 1, name: "Dashboards" })).toBeVisible();
  expect(serveur.entree(DASHBOARD_ID).revisions).toHaveLength(1);
});

test("accessibilité : la liste, la création et l'éditeur, dans les deux thèmes", async ({ page }) => {
  await servir(page, {
    role: "creator", analyses: ANALYSES,
    dashboards: [entreeDashboard(DASHBOARD_ID, TUILES), entreeDashboard(AUTRE_DASHBOARD_ID, pageDe("Autre", [texte(uuid(71), "Texte")]), { proprietaire: "cora", droits: { owner: false, revise: false, delete: false, duplicate: false } })],
  }, []);
  await aller(page, "dashboards");
  await expect(page.getByRole("heading", { name: /Mes dashboards/ })).toBeVisible();
  await axe(page);
  await activer(page, page.getByRole("button", { name: "Nouveau dashboard", exact: true }));
  await expect(page.getByRole("dialog", { name: "Nouveau dashboard" })).toBeVisible();
  await axe(page);
  await page.keyboard.press("Escape");
  await aller(page, `dashboards/${DASHBOARD_ID}`);
  await expect(page.getByRole("heading", { level: 1, name: "Tuiles" })).toBeVisible();
  await expect(page.getByText("Preuve", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("DENY · accès refusé")).toBeVisible();
  for (const theme of THEMES) {
    await choisirTheme(page, theme);
    await axe(page);
    await noeud(page, "Ventes réalisées").click();
    await expect(page.getByRole("heading", { name: /^Propriétés · Visuel/ })).toBeVisible();
    await axe(page);
    await page.getByRole("tab", { name: /^Structure/ }).click();
    await axe(page);
    await page.getByRole("tab", { name: /^Filtres/ }).click();
    await axe(page);
    await page.getByRole("tab", { name: /^Problèmes/ }).click();
  }
  // Un dashboard en lecture seule est lisible de la même façon.
  await aller(page, `dashboards/${AUTRE_DASHBOARD_ID}`);
  await expect(page.getByText(/il s'ouvre en lecture seule/)).toBeVisible();
  await axe(page);
});

test("aucun débordement horizontal à 390, 768 et 1280 pixels", async ({ page }) => {
  await servir(page, { role: "creator", analyses: ANALYSES, dashboards: [entreeDashboard(DASHBOARD_ID, TUILES)] }, []);
  for (const largeur of LARGEURS) {
    await page.setViewportSize({ width: largeur, height: 900 });
    await aller(page, "dashboards");
    await expect(page.getByRole("heading", { name: /Mes dashboards/ })).toBeVisible();
    await sansDebordement(page);
    await aller(page, `dashboards/${DASHBOARD_ID}`);
    await expect(page.getByRole("heading", { level: 1, name: "Tuiles" })).toBeVisible();
    await expect(page.getByText("DENY · accès refusé")).toBeVisible();
    await expect(tuile(page, "Ventes réalisées").getByText("Preuve", { exact: true })).toBeVisible();
    await sansDebordement(page);
    for (const onglet of [/^Structure/, /^Filtres/, /^Problèmes/]) {
      await page.getByRole("tab", { name: onglet }).click();
      await sansDebordement(page);
    }
  }
});


test("deux tuiles identiques partagent le refus, même après suppression de l'une", async ({ page }) => {
  const document = pageDe("Refus partagé", [visuel(uuid(110), ANALYSE_DENY, { title: "Première" }), visuel(uuid(111), ANALYSE_DENY, { title: "Seconde" })]);
  const serveur = await servir(page, { role: "creator", analyses: ANALYSES, dashboards: [entreeDashboard(DASHBOARD_ID, document)] }, []);
  await aller(page, `dashboards/${DASHBOARD_ID}`);
  await expect(tuile(page, "Première")).toContainText("DENY · accès refusé");
  await expect(tuile(page, "Seconde")).toContainText("DENY · accès refusé");
  await noeud(page, /^Visuel · Seconde/).focus();
  await page.keyboard.press("Delete");
  await expect(noeud(page, /^Visuel · Seconde/)).toHaveCount(0);
  await expect(tuile(page, "Première")).toContainText("DENY · accès refusé");
  expect(serveur.journal.executions).toHaveLength(1);
});

test("un filtre incompatible sans défaut rend sa cible indisponible", async ({ page }) => {
  const id = uuid(112);
  const document = pageDe("Filtre incompatible", [visuel(id, ANALYSE)], { filters: [{ id: uuid(113), label: "Absente", dimension: "absente", operator: "eq", targets: [id] }] });
  const serveur = await servir(page, { role: "creator", analyses: ANALYSES, dashboards: [entreeDashboard(DASHBOARD_ID, document)] }, []);
  await aller(page, `dashboards/${DASHBOARD_ID}`);
  await expect(tuile(page, "Ventes réalisées")).toContainText("Un filtre commun ne s'applique pas à cette tuile");
  expect(serveur.journal.executions).toHaveLength(0);
});


test("retirer une tuile pendant les exécutions ne resoumet pas les autres", async ({ page }) => {
  const document = pageDe("En cours", [visuel(uuid(120), ANALYSE, { title: "Gardée" }), visuel(uuid(121), ANALYSE_DENY, { title: "Retirée" })]);
  const serveur = await servir(page, { role: "creator", analyses: ANALYSES, retenir: true, dashboards: [entreeDashboard(DASHBOARD_ID, document)] }, []);
  await aller(page, `dashboards/${DASHBOARD_ID}`);
  await expect.poll(() => serveur.journal.executions.length).toBe(2);
  await noeud(page, /^Visuel · Retirée/).focus();
  await page.keyboard.press("Delete");
  await expect(noeud(page, /^Visuel · Retirée/)).toHaveCount(0);
  await expect.poll(() => serveur.enCours()).toBe(1);
  expect(serveur.journal.executions).toHaveLength(2);
  serveur.liberer();
  await expect(tuile(page, "Gardée").getByText("Preuve", { exact: true })).toBeVisible({ timeout: 15_000 });
  expect(serveur.journal.executions).toHaveLength(2);
});

test("annuler une exécution ne touche pas à l'autre tuile", async ({ page }) => {
  const document = pageDe("Exécutions", [visuel(uuid(130), ANALYSE, { title: "À annuler" }), visuel(uuid(131), ANALYSE_DENY, { title: "À garder" })]);
  const serveur = await servir(page, { role: "creator", analyses: ANALYSES, retenir: true, dashboards: [entreeDashboard(DASHBOARD_ID, document)] }, []);
  await aller(page, `dashboards/${DASHBOARD_ID}`);
  await expect.poll(() => serveur.enCours()).toBe(2);
  await tuile(page, "À annuler").getByRole("button", { name: "Annuler l’exécution" }).click();
  await expect(tuile(page, "À annuler")).toContainText("Exécution annulée");
  await expect.poll(() => serveur.enCours()).toBe(1);
  expect(serveur.journal.annulations).toEqual([executionN(1)]);
  serveur.liberer();
  await expect(tuile(page, "À garder")).toContainText("DENY · accès refusé");
  expect(serveur.journal.executions).toHaveLength(2);
});

test("annuler une création en cours ne navigue pas et le dashboard apparaît au rafraîchissement", async ({ page }) => {
  const serveur = await servir(page, { role: "creator" }, ["POST /dashboards"]);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/spaces/finance/dashboards", async (route) => {
    if (route.request().method() === "POST") await hold;
    await route.fallback();
  });
  await aller(page, "dashboards");
  await page.getByRole("button", { name: "Nouveau dashboard" }).click();
  const dialog = page.getByRole("dialog", { name: "Nouveau dashboard" });
  await dialog.getByRole("textbox", { name: "Nom du dashboard" }).fill("Création différée");
  await dialog.getByRole("button", { name: "Créer et ouvrir" }).click();
  await dialog.getByRole("button", { name: "Annuler" }).click();
  release();
  await expect.poll(() => serveur.journal.creations.length).toBe(1);
  await expect(page).toHaveURL(/#\/espaces\/finance\/dashboards$/);
  await page.getByRole("button", { name: "Actualiser" }).click();
  await expect(page.getByRole("link", { name: "Création différée" })).toBeVisible();
});

test("un clic modifié sur un lien ne déclenche pas la garde", async ({ page, context }) => {
  await servir(page, { role: "creator", dashboards: [entreeDashboard(DASHBOARD_ID, pageDe("Garde", []))] }, []);
  await aller(page, `dashboards/${DASHBOARD_ID}`);
  await ajouter(page, "Ajouter une section");
  const lien = page.getByRole("link", { name: "Skifer Board" });
  const popup = context.waitForEvent("page");
  await lien.click({ modifiers: ["ControlOrMeta"] });
  const autre = await popup;
  await expect(page.getByRole("dialog", { name: "Quitter sans enregistrer ?" })).toHaveCount(0);
  await autre.close();
});

test("une lecture d'analyse en échec peut être réessayée explicitement", async ({ page }) => {
  const serveur = await servir(page, { role: "creator", analyses: ANALYSES, dashboards: [entreeDashboard(DASHBOARD_ID, pageDe("Réessai", [visuel(uuid(132), ANALYSE)]))] }, []);
  let attempts = 0;
  await page.route(`**/api/spaces/finance/analyses/${ANALYSE}/revisions/1`, async (route) => {
    attempts += 1;
    if (attempts === 1) await route.fulfill({ status: 500, json: {} }); else await route.fallback();
  });
  await aller(page, `dashboards/${DASHBOARD_ID}`);
  await tuile(page, "Visuel épinglé").getByRole("button", { name: "Réessayer" }).click();
  await expect(tuile(page, "Ventes réalisées").getByText("Preuve", { exact: true })).toBeVisible();
  expect(attempts).toBe(2);
  expect(serveur.journal.executions).toHaveLength(1);
});

test("annuler une tuile laisse en cours une requête partagée et Relancer la rejoint", async ({ page }) => {
  const document = pageDe("Partagée", [visuel(uuid(140), ANALYSE, { title: "Première" }), visuel(uuid(141), ANALYSE, { title: "Seconde" })]);
  const serveur = await servir(page, { role: "creator", analyses: ANALYSES, retenir: true, dashboards: [entreeDashboard(DASHBOARD_ID, document)] }, []);
  await aller(page, `dashboards/${DASHBOARD_ID}`);
  await expect.poll(() => serveur.enCours()).toBe(1);
  await tuile(page, "Première").getByRole("button", { name: "Annuler l’exécution" }).click();
  await expect(tuile(page, "Première")).toContainText("Exécution annulée");
  await expect(tuile(page, "Seconde")).toContainText("Exécution en cours");
  expect(serveur.journal.annulations).toEqual([]);
  await tuile(page, "Première").getByRole("button", { name: "Relancer" }).click();
  await expect(tuile(page, "Première")).toContainText("Exécution en cours");
  expect(serveur.journal.executions).toHaveLength(1);
  serveur.liberer();
  await expect(tuile(page, "Première").getByText("Preuve", { exact: true })).toBeVisible();
  await expect(tuile(page, "Seconde").getByText("Preuve", { exact: true })).toBeVisible();
  expect(serveur.journal.annulations).toEqual([]);
});

test("relancer une exécution annulée par le serveur soumet une nouvelle requête", async ({ page }) => {
  const serveur = await servir(page, { role: "creator", analyses: { [ANALYSE]: { nom: "Ventes", issue: "annulee" } }, dashboards: [entreeDashboard(DASHBOARD_ID, pageDe("Annulation serveur", [visuel(uuid(150), ANALYSE)]))] }, []);
  await aller(page, `dashboards/${DASHBOARD_ID}`);
  await expect(tuile(page, "Ventes")).toContainText("Exécution annulée");
  expect(serveur.journal.executions).toHaveLength(1);
  await tuile(page, "Ventes").getByRole("button", { name: "Relancer" }).click();
  await expect(tuile(page, "Ventes").getByText("Preuve", { exact: true })).toBeVisible();
  expect(serveur.journal.executions).toHaveLength(2);
});
