import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { choisirTheme } from "./aides";
import { AUTRE_DASHBOARD_ID, DASHBOARD_ID, entreeDashboard, pageDe, servirDashboards, texte, uuid, visuel, type AnalysePinglee, type ServeurDashboards } from "./serveur-dashboards";

const A = uuid(21); const B = uuid(22); const C = uuid(23); const KPI = uuid(24);
const ANALYSES: Record<string, AnalysePinglee> = {
  [A]: { nom: "Ventes par région" }, [B]: { nom: "Marge par région" }, [C]: { nom: "Commandes par région" },
  [KPI]: { nom: "Total des ventes", contenu: { presentation: { chart: "value" }, query: { connection: "finance", model: "sales", metrics: ["revenue"], dimensions: [], filters: [] } } },
};
const THEMES = ["Skifer clair", "Skifer ardoise"] as const;
const attendus: ServeurDashboards[] = [];
test.afterEach(() => { for (const serveur of attendus.splice(0)) expect(serveur.journal.inattendues).toEqual([]); });
async function servir(page: Page, dashboards = [entreeDashboard(DASHBOARD_ID, pageDe("Pilotage", [visuel(uuid(31), A), texte(uuid(32), "Présentation des ventes")]))], analyses = ANALYSES) {
  const serveur = await servirDashboards(page, { role: "creator", dashboards, analyses }); attendus.push(serveur); return serveur;
}
async function aller(page: Page, path: string) {
  await page.goto(`/#/espaces/finance/${path}`);
  await page.evaluate(async () => { await document.fonts.ready; });
  await expect(page.getByRole("navigation", { name: "Navigation principale" }).getByRole("button", { name: "Dashboards", exact: true })).toBeVisible();
}
async function axe(page: Page) { const result = await new AxeBuilder({ page }).analyze(); expect(result.violations.map((one) => ({ id: one.id, nodes: one.nodes.map((node) => node.target) }))).toEqual([]); }
async function sansDebordement(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0); }
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Actions de l'éditeur" });
async function ajouterAnalyse(page: Page, nom: string, kpi = false) {
  await page.getByRole("button", { name: "Ajouter une analyse" }).click();
  const dialog = page.getByRole("dialog", { name: "Ajouter une analyse" });
  await dialog.getByRole("button", { name: new RegExp(nom) }).click();
  await expect(dialog.getByText(/Modèle : sales/)).toBeVisible();
  if (kpi) await dialog.getByRole("radio", { name: "KPI" }).check();
  await dialog.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

/** Le document comporte des filtres communs à sa racine, jamais des filtres de requête d'analyse. */
function verifierDashboard(value: unknown, path = "racine"): void {
  if (Array.isArray(value)) { for (const [i, one] of value.entries()) verifierDashboard(one, `${path}[${String(i)}]`); return; }
  if (typeof value === "string") { expect(value).not.toMatch(/\b(?:select\s+.+\bfrom|insert\s+into|update\s+.+\bset|delete\s+from|(?:drop|alter|create)\s+(?:table|view|schema))\b/i); return; }
  if (value === null || typeof value !== "object") return;
  for (const [key, one] of Object.entries(value)) {
    expect(["sql", "query", "metrics", "dimensions"]).not.toContain(key.toLowerCase());
    if (key === "filters") expect(path).toBe("racine");
    verifierDashboard(one, `${path}.${key}`);
  }
}

test("Un créateur compose, annule et rétablit chaque étape, enregistre puis crée une révision ; chaque tuile garde sa provenance et aucun SQL ni aucune requête n'est écrit", async ({ page }) => {
  const serveur = await servir(page, [], ANALYSES);
  await aller(page, "dashboards");
  await page.getByRole("button", { name: "Nouveau dashboard" }).click();
  const nouveau = page.getByRole("dialog", { name: "Nouveau dashboard" });
  await nouveau.getByRole("textbox", { name: "Nom du dashboard" }).fill("Ventes composées");
  await nouveau.getByRole("radio", { name: "Partagé" }).check();
  await nouveau.getByRole("button", { name: "Créer et ouvrir" }).click();
  await expect(page.getByText("Aucune section : ajoutez-en une avec la palette.")).toBeVisible();
  await expect(page.getByText("Données évaluées pour Camille Martin", { exact: true })).toBeVisible();
  const etat = async () => ({ nodes: await page.locator("[data-node]").evaluateAll((items) => items.map((item) => ({ id: item.getAttribute("data-node"), kind: [...item.classList].find((name) => name.startsWith("sb-node--") && name !== "sb-node--selected") }))), filters: await page.getByRole("tab", { name: /^Filtres/ }).innerText() });
  const etapes = [await etat()];
  for (const name of ["Ajouter une section", "Ajouter une rangée", "Ajouter une colonne", "Ajouter un texte"]) { await page.getByRole("button", { name }).click(); etapes.push(await etat()); }
  for (const name of ["Ventes par région", "Marge par région", "Commandes par région"]) { await ajouterAnalyse(page, name); etapes.push(await etat()); }
  await ajouterAnalyse(page, "Total des ventes", true); etapes.push(await etat());
  await page.getByRole("button", { name: "Ajouter une section" }).click(); etapes.push(await etat());
  await page.getByRole("tab", { name: /^Filtres/ }).click();
  await page.getByRole("button", { name: "Nouveau filtre" }).click();
  await page.getByRole("textbox", { name: "Libellé" }).fill("Région commune");
  await page.getByRole("combobox", { name: "Dimension" }).selectOption("region:string");
  await page.getByRole("textbox", { name: "Valeur par défaut" }).fill("Nord");
  await page.getByRole("checkbox", { name: /Visuel · Ventes par région/ }).check();
  await page.getByRole("button", { name: "Ajouter le filtre" }).click();
  etapes.push(await etat());
  await expect.poll(() => serveur.journal.executions.filter((one) => (one.analysis as { id: string }).id === A).length).toBe(2);
  const filtreAnalyse = { column: "region", operator: "in", value: ["Nord", "Sud"] };
  for (const id of [A, B, C, KPI]) {
    const envoyees = serveur.journal.executions.filter((one) => (one.analysis as { id: string }).id === id);
    const derniere = envoyees.at(-1);
    expect(derniere).toEqual({ connection: "finance", model: "sales", metrics: ["revenue"], dimensions: id === KPI ? [] : ["region"], filters: id === KPI ? [] : id === A ? [filtreAnalyse, { column: "region", operator: "eq", value: "Nord" }] : [filtreAnalyse], environment: "DEV", analysis: { id, revision: 1 } });
  }
  const undo = toolbar(page).getByRole("button", { name: "Annuler", exact: true });
  let count = 0;
  while (await undo.isEnabled()) { await undo.click(); count += 1; expect(count).toBeLessThan(30); expect(await etat()).toEqual(etapes[etapes.length - 1 - count]); }
  expect(count).toBe(10);
  await expect(page.getByText("Aucune section : ajoutez-en une avec la palette.")).toBeVisible();
  const redo = toolbar(page).getByRole("button", { name: "Rétablir" });
  for (let i = 0; i < count; i += 1) { await redo.click(); expect(await etat()).toEqual(etapes[i + 1]); }
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Révision 2 enregistrée.")).toBeVisible();
  expect(serveur.journal.revisions[0]?.corps.expected_revision).toBe(1);
  const sauvegarde = serveur.journal.revisions[0]?.corps as { filters: { targets: string[] }[]; layout: { sections: unknown[] } };
  expect(sauvegarde.layout.sections).toHaveLength(2);
  expect(sauvegarde.filters).toHaveLength(1);
  expect(sauvegarde.filters[0]?.targets).toHaveLength(1);
  for (const id of [A, B, C, KPI]) expect(JSON.stringify(sauvegarde.layout)).toContain(JSON.stringify({ analysis_id: id, revision: 1 }));
  await page.getByRole("button", { name: "Ajouter une section" }).click();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Révision 3 enregistrée.")).toBeVisible();
  expect(serveur.journal.revisions[1]?.corps.expected_revision).toBe(2);
  for (const body of [...serveur.journal.creations, ...serveur.journal.revisions.map((one) => one.corps)]) verifierDashboard(body);
  expect(serveur.journal.executions.some((one) => (one.analysis as { id: string }).id === A && JSON.stringify(one.filters).includes("Nord"))).toBe(true);
  for (const name of ["Ventes par région", "Marge par région", "Commandes par région", "Total des ventes"]) {
    const tile = page.getByRole("region", { name, exact: true }).or(page.locator(".sb-tile").filter({ hasText: name }));
    await expect(tile.getByText("Preuve", { exact: true })).toBeVisible();
    await expect(tile.getByText("Empreinte SQL", { exact: true })).toBeVisible();
    await expect(tile.getByText("Certification des sources", { exact: true })).toBeVisible();
    await expect(tile.getByText("Âge des données", { exact: true })).toBeVisible();
    await expect(tile.locator("dd.sb-mono").first()).toHaveText(/^[0-9a-f-]{36}$/);
    await expect(tile.locator("dd .sb-mono").first()).toHaveText(/^sha256:v1:[0-9a-f]{64}$/);
    await expect(tile.getByText("Certification des sources", { exact: true }).locator("+ dd")).not.toBeEmpty();
    await expect(tile.getByText("Âge des données", { exact: true }).locator("+ dd")).not.toBeEmpty();
  }
  const executions = structuredClone(serveur.journal.executions);
  await page.getByRole("button", { name: "Aperçu lecteur" }).click();
  for (const [label, stacked, narrow] of [["Bureau · 1 280 px", "false", "false"], ["Tablette · 768 px", "false", "false"], ["Téléphone · 390 px", "true", "true"]] as const) {
    await page.getByRole("radio", { name: label }).check(); await sansDebordement(page);
    await expect(page.locator(".sb-preview__row").first()).toHaveAttribute("data-stacked", stacked);
    await expect(page.locator(".sb-preview__tile[data-narrow]").first()).toHaveAttribute("data-narrow", narrow);
  }
  expect(serveur.journal.executions).toEqual(executions);
});

type Etat = "liste" | "nouveau" | "editeur" | "ajouter-analyse" | "filtres" | "conflit" | "historique-diff" | "apercu-lecteur" | "apercu-telephone" | "epingler" | "consommateurs";
const ETATS: readonly Etat[] = ["liste", "nouveau", "editeur", "ajouter-analyse", "filtres", "conflit", "historique-diff", "apercu-lecteur", "apercu-telephone", "epingler", "consommateurs"];
const nomCapture = (etat: Etat, theme: (typeof THEMES)[number]) => `dashboards-${etat}-${theme === "Skifer clair" ? "clair" : "ardoise"}.png`;

async function amener(page: Page, serveur: ServeurDashboards, etat: Etat, theme: (typeof THEMES)[number]) {
  if (etat === "liste" || etat === "nouveau") {
    await aller(page, "dashboards"); await expect(page.getByRole("heading", { name: "Dashboards", level: 1 })).toBeVisible();
    await choisirTheme(page, theme);
    await expect(page.getByRole("link", { name: "Pilotage" })).toBeVisible();
    if (etat === "nouveau") { await page.getByRole("button", { name: "Nouveau dashboard" }).click(); await expect(page.getByRole("dialog", { name: "Nouveau dashboard" })).toBeVisible(); }
    return;
  }
  if (etat === "epingler" || etat === "consommateurs") {
    await aller(page, `analyses/${A}`); await expect(page.getByRole("heading", { name: "Ventes par région", level: 1 })).toBeVisible();
    await choisirTheme(page, theme);
    if (etat === "epingler") { await page.getByRole("button", { name: "Épingler à un dashboard" }).click(); await page.getByRole("dialog").getByRole("combobox", { name: "Dashboard" }).selectOption(DASHBOARD_ID); await expect(page.getByRole("button", { name: "Épingler", exact: true })).toBeVisible(); }
    else { await page.getByRole("tab", { name: "Consommateurs" }).click(); await expect(page.getByRole("link", { name: "Pilotage" })).toBeVisible(); await expect(page.getByText("Autres dépendants que vous ne voyez pas : 1.")).toBeVisible(); }
    return;
  }
  if (etat === "historique-diff") {
    await aller(page, `dashboards/${DASHBOARD_ID}/historique/1/2`);
    await expect(page.getByRole("table", { name: "Écart entre r1 et r2" })).toBeVisible();
    await choisirTheme(page, theme); return;
  }
  await aller(page, `dashboards/${DASHBOARD_ID}`);
  await expect(page.getByRole("heading", { level: 1, name: "Pilotage" })).toBeVisible();
  await expect(page.getByText("Preuve", { exact: true }).first()).toBeVisible();
  await choisirTheme(page, theme);
  if (etat === "editeur") await page.locator(".sb-node__select").filter({ hasText: /Visuel/ }).first().click();
  if (etat === "ajouter-analyse") {
    await page.getByRole("button", { name: "Ajouter une analyse" }).click();
    const dialog = page.getByRole("dialog", { name: "Ajouter une analyse" });
    await dialog.getByRole("button", { name: /Marge par région/ }).click();
    await dialog.getByRole("combobox", { name: "Révision" }).selectOption("1");
    await expect(dialog.getByText(/révision courante : 2/)).toBeVisible();
  }
  if (etat === "filtres") { await page.getByRole("tab", { name: /^Filtres/ }).click(); await expect(page.getByText("Région commune", { exact: true }).first()).toBeVisible(); }
  if (etat === "conflit") {
    await page.getByRole("button", { name: "Ajouter une section" }).click();
    const courante = serveur.entree(DASHBOARD_ID).revisions.at(-1);
    if (courante === undefined) throw new Error("Dashboard absent");
    serveur.entree(DASHBOARD_ID).revisions.push({ ...structuredClone(courante), description: "Modification concurrente." });
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.getByRole("region", { name: "Conflit de révision" })).toBeVisible();
  }
  if (etat === "apercu-lecteur" || etat === "apercu-telephone") {
    await page.getByRole("button", { name: "Aperçu lecteur" }).click();
    if (etat === "apercu-telephone") await page.getByRole("radio", { name: "Téléphone · 390 px" }).check();
    await expect(page.getByRole("heading", { name: "Aperçu lecteur · Pilotage" })).toBeVisible();
  }
}

for (const theme of THEMES) {
  test(`captures pleine page et axe, ${theme}`, async ({ page }) => {
    test.setTimeout(120_000);
    const document = pageDe("Pilotage", [visuel(uuid(31), A), texte(uuid(32), "Suivi des ventes.")], { filters: [{ id: uuid(40), label: "Région commune", dimension: "region", operator: "eq", default: "Nord", targets: [uuid(31)] }] });
    const entry = entreeDashboard(DASHBOARD_ID, document);
    entry.revisions.push(structuredClone(document));
    const cache = entreeDashboard(AUTRE_DASHBOARD_ID, pageDe("Masqué", [visuel(uuid(83), A)], { visibility: "personal" }), { proprietaire: "autre" });
    const serveur = await servir(page, [entry, cache], { ...ANALYSES, [B]: { ...ANALYSES[B], revisions: [{}, {}] } as AnalysePinglee });
    for (const etat of ETATS) {
      await page.goto("about:blank");
      serveur.entree(DASHBOARD_ID).revisions.splice(2);
      await amener(page, serveur, etat, theme);
      await axe(page);
      await expect(page).toHaveScreenshot(nomCapture(etat, theme), { fullPage: true });
    }
  });
}

test("Un refus reste un refus, une analyse invisible ou disparue est signalée sans être exécutée ; deux mises en page utilisent les mêmes analyses", async ({ page }) => {
  const absent = uuid(25); const invisible = uuid(26);
  const analyses: Record<string, AnalysePinglee> = {
    [A]: { nom: "Analyse lisible" }, [B]: { nom: "Analyse refusée", issue: "deny" }, [C]: { nom: "Analyse à valider", issue: "require_human" },
    [absent]: { nom: "Analyse disparue", tuile: "indisponible" }, [invisible]: { nom: "Analyse invisible", tuile: "indisponible" },
  };
  const premier = pageDe("Refus et références", [visuel(uuid(51), A), visuel(uuid(52), B), visuel(uuid(53), C), visuel(uuid(54), absent), visuel(uuid(55), invisible)]);
  const second = pageDe("Autre mise en page", [], { layout: { sections: [
    { id: uuid(61), title: "Vue différente", rows: [{ id: uuid(62), columns: [{ id: uuid(63), span: 12, children: [texte(uuid(64), "Autre présentation"), visuel(uuid(65), A)] }] }] },
  ] } });
  const serveur = await servir(page, [entreeDashboard(DASHBOARD_ID, premier), entreeDashboard(AUTRE_DASHBOARD_ID, second)], analyses);
  await aller(page, `dashboards/${DASHBOARD_ID}`);
  await expect(page.getByText("DENY · accès refusé")).toBeVisible();
  await expect(page.getByText("REQUIRE_HUMAN · validation humaine requise")).toBeVisible();
  await expect(page.getByText(/L'analyse épinglée n'est pas disponible pour vous/)).toHaveCount(2);
  await expect.poll(() => serveur.journal.executions.length).toBe(3);
  const ids = serveur.journal.executions.map((one) => (one.analysis as { id: string }).id).sort();
  expect(ids).toEqual([A, B, C].sort());
  await page.getByRole("button", { name: "Aperçu lecteur" }).click();
  const preview = page.getByRole("region", { name: "Aperçu lecteur" });
  await expect(preview.getByText("DENY · accès refusé")).toBeVisible();
  await expect(preview.getByText("REQUIRE_HUMAN · validation humaine requise")).toBeVisible();
  expect(serveur.journal.executions).toHaveLength(3);
  await page.getByRole("button", { name: "Retour à l'éditeur" }).click();
  await aller(page, `dashboards/${AUTRE_DASHBOARD_ID}`);
  await expect(page.getByText("Autre présentation")).toBeVisible();
  await expect(page.getByText("Preuve", { exact: true })).toBeVisible();
  expect(serveur.journal.executions.filter((one) => (one.analysis as { id: string }).id === A)).toHaveLength(2);
});

test("Changer la présentation ne change aucun résultat ni la requête soumise", async ({ page }) => {
  const octets: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/executions")) octets.push(request.postData() ?? ""); });
  const serveur = await servir(page);
  await aller(page, `dashboards/${DASHBOARD_ID}`);
  await expect(page.getByText("Preuve", { exact: true })).toBeVisible();
  const requete = JSON.stringify(serveur.journal.executions[0]);
  await page.getByRole("tab", { name: "Tableau" }).click();
  const valeurs = await page.getByRole("table", { name: /Valeurs de Ventes par région/ }).locator("tbody").innerText();
  await page.locator(".sb-node__select").filter({ hasText: /Visuel · Ventes par région/ }).click();
  const titre = page.getByRole("textbox", { name: "Titre", exact: true });
  await titre.fill("Ventes présentées"); await titre.press("Enter");
  await page.getByRole("combobox", { name: "Type de graphique" }).selectOption("line");
  await page.getByRole("spinbutton", { name: "Valeur du seuil" }).fill("10");
  await page.getByRole("textbox", { name: "Libellé du seuil" }).fill("Sous le seuil");
  await page.getByRole("button", { name: "Appliquer le seuil" }).click();
  await expect(page.getByRole("heading", { name: "Ventes présentées", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Tableau" }).click();
  expect(await page.getByRole("table", { name: /Valeurs de Ventes présentées/ }).locator("tbody").innerText()).toBe(valeurs);
  await expect.poll(() => serveur.journal.executions.length).toBe(1);
  expect(JSON.stringify(serveur.journal.executions[0])).toBe(requete);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Révision 2 enregistrée.")).toBeVisible();
  verifierDashboard(serveur.journal.revisions[0]?.corps);
  const presentation = JSON.stringify(serveur.journal.revisions[0]?.corps);
  expect(presentation).toContain('"title":"Ventes présentées"');
  expect(presentation).toContain('"chart":"line"');
  expect(presentation).toContain('"threshold":{"value":10,"label":"Sous le seuil"}');
  await page.reload();
  await expect(page.getByText("Preuve", { exact: true })).toBeVisible();
  await expect.poll(() => octets.length).toBe(2);
  expect(octets[1]).toBe(octets[0]);
});

test("La suppression d'une analyse utilisée est refusée avec ses consommateurs ; un dashboard partagé ne peut pas référencer une analyse personnelle", async ({ page }) => {
  const privee = uuid(80);
  const analyses: Record<string, AnalysePinglee> = { [A]: { nom: "Ventes par région", droits: { owner: true, revise: true, delete: true, duplicate: true } }, [privee]: { nom: "Analyse personnelle", contenu: { visibility: "personal" } } };
  const cache = entreeDashboard(AUTRE_DASHBOARD_ID, pageDe("Masqué", [visuel(uuid(82), A)], { visibility: "personal" }), { proprietaire: "autre" });
  const serveur = await servir(page, [entreeDashboard(DASHBOARD_ID, pageDe("Partagé", [visuel(uuid(81), A)])), cache], analyses);
  await aller(page, `analyses/${A}`);
  await page.getByRole("button", { name: "Supprimer", exact: true }).click();
  await page.getByRole("button", { name: "Confirmer la suppression" }).click();
  await expect(page.getByRole("alert")).toContainText("Cette analyse est encore utilisée");
  await expect(page.getByRole("link", { name: "Partagé" })).toBeVisible();
  await expect(page.getByText("Autres dépendants que vous ne voyez pas : 1.")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(AUTRE_DASHBOARD_ID);
  await aller(page, `dashboards/${DASHBOARD_ID}`);
  await ajouterAnalyse(page, "Analyse personnelle");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/personnelle/);
  expect(serveur.entree(DASHBOARD_ID).revisions).toHaveLength(1);
  expect(serveur.journal.revisions).toHaveLength(1);
  verifierDashboard(serveur.journal.revisions[0]?.corps);
});

test("Deux sauvegardes concurrentes ne s'écrasent pas ; l'historique et le diff sont relus depuis le serveur", async ({ page, browser }) => {
  const shared = entreeDashboard(DASHBOARD_ID, pageDe("Concurrence", []));
  const first = await servir(page, [shared]);
  const contexte = await browser.newContext();
  const autre = await contexte.newPage();
  const second = await servir(autre, [shared]);
  await aller(page, `dashboards/${DASHBOARD_ID}`); await aller(autre, `dashboards/${DASHBOARD_ID}`);
  await page.getByRole("button", { name: "Ajouter une section" }).click();
  await autre.getByRole("button", { name: "Ajouter une section" }).click();
  await autre.getByRole("button", { name: "Ajouter une section" }).click();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Révision 2 enregistrée.")).toBeVisible();
  const revisionEcrite = structuredClone(shared.revisions.at(-1));
  await autre.getByRole("button", { name: "Enregistrer", exact: true }).click();
  const conflit = autre.getByRole("region", { name: "Conflit de révision" });
  await expect(conflit).toBeVisible();
  expect(second.journal.revisions).toHaveLength(1);
  expect(shared.revisions).toHaveLength(2);
  expect(shared.revisions.at(-1)).toEqual(revisionEcrite);
  await conflit.getByRole("button", { name: "Voir l'écart" }).click();
  await expect(conflit.getByRole("table", { name: "Écart entre r1 et r2" })).toBeVisible();
  expect(second.journal.ecarts).toEqual([{ id: DASHBOARD_ID, base: 1, other: 2 }]);
  await conflit.getByRole("button", { name: "Rouvrir la révision courante" }).click();
  await conflit.getByRole("button", { name: "Abandonner et rouvrir" }).click();
  await autre.getByRole("link", { name: "Historique des révisions" }).click();
  await expect(autre.getByRole("list", { name: "Historique des révisions" })).toContainText("r2");
  await autre.getByRole("button", { name: "Comparer", exact: true }).click();
  await expect(autre.getByRole("table", { name: "Écart entre r1 et r2" })).toBeVisible();
  expect(second.journal.ecarts).toHaveLength(2);
  expect(first.journal.revisions[0]?.corps.expected_revision).toBe(1);
  expect(second.journal.revisions[0]?.corps.expected_revision).toBe(1);
  for (const body of [...first.journal.revisions, ...second.journal.revisions]) verifierDashboard(body.corps);
  await contexte.close();
});
