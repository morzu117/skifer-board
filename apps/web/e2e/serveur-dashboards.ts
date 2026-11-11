import type { Page, Route } from "@playwright/test";
import creer from "../../../contracts/dashboards/routes/creer.json" with { type: "json" };
import lire from "../../../contracts/dashboards/routes/lire.json" with { type: "json" };
import lister from "../../../contracts/dashboards/routes/lister.json" with { type: "json" };
import listeAnalyses from "../../../contracts/analyses/routes/lister.json" with { type: "json" };
import historiqueAnalyses from "../../../contracts/analyses/routes/historique.json" with { type: "json" };
import personnel from "../../../contracts/dashboards/routes/refus-reference-personnelle.json" with { type: "json" };
import historiqueDashboard from "../../../contracts/dashboards/routes/historique.json" with { type: "json" };
import ecartReel from "../src/dashboards/ecart-reel.json" with { type: "json" };
import ecartDashboard from "../../../contracts/dashboards/routes/ecart.json" with { type: "json" };
import conflit from "../../../contracts/dashboards/routes/refus-revision-conflit.json" with { type: "json" };
import espace from "../../../contracts/espaces/espace.json" with { type: "json" };
import liste from "../../../contracts/espaces/liste.json" with { type: "json" };
import etabli from "../../../contracts/identite/me-etabli.json" with { type: "json" };
import { simulerEspaces, simulerIdentite } from "./aides";
import {
  AUCUN, EMETTEUR, MODELES, MOI, RACINE, TOUS, brouillon, entree, executionN, executionTerminee, fixe, resultat, revisionJson,
  type Brouillon, type Droits, type Mode, type Requete, Refus,
} from "./serveur-analyses";

/**
 * Serveur simulé des dashboards pour les parcours navigateur (plan 19, 19.5a). Chaque réponse est un exemple réel de
 * `contracts/dashboards/routes/` dont seuls les champs qui varient sont remplacés ; le dépôt de contenus est un petit état en
 * mémoire, de sorte que ce que le navigateur écrit est ce qu'il relit. Les analyses épinglées, le catalogue et les exécutions
 * reprennent le simulateur des analyses. Toute demande hors scénario est consignée : un test qui en voit une échoue.
 */
export const DASHBOARD_ID = "7a4e2c91-5d3b-4f68-8c10-2e9b6a7d3f41";
export const AUTRE_DASHBOARD_ID = "3c8d1f05-9e2a-4b74-a6d3-5f0e8c2b7a19";
export const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/** Document d'un dashboard, tel que le serveur le stocke et que la révision le renvoie (hors identité et auteur). */
export interface Document {
  name: string;
  description: string;
  visibility: "personal" | "shared";
  defaults: Record<string, unknown>;
  filters: object[];
  layout: { sections: object[] };
}
export interface EntreeDashboard {
  id: string;
  proprietaire: string;
  revisions: Document[];
  droits: Droits;
}
/** Analyse épinglée : son contenu, l'issue de ses exécutions, et ce que le serveur dit de sa tuile. */
export interface AnalysePinglee {
  nom: string;
  droits?: Droits;
  contenu?: Partial<Brouillon>;
  revisions?: Partial<Brouillon>[];
  /** `tronque` : le résultat est partiel (limite atteinte) ; `resultat_perdu` : l'exécution réussit mais son résultat ne peut pas être lu. */
  issue?: Mode | "tronque" | "resultat_perdu" | "annulee";
  /** `indisponible` : la tuile est indisponible (raison `analysis_unavailable`) ; `non_verifie` : le catalogue n'a pas été lu. */
  tuile?: "prete" | "indisponible" | "non_verifie";
}
export interface ReglagesDashboards {
  role: "admin" | "creator" | "reader";
  dashboards?: EntreeDashboard[];
  analyses?: Record<string, AnalysePinglee>;
  identifiants?: string[];
  masquerPremiere?: boolean;
  /** Les exécutions restent en cours tant que `liberer()` n'a pas été appelé. */
  retenir?: boolean;
}
export interface JournalDashboards {
  creations: Record<string, unknown>[];
  revisions: { id: string; corps: Record<string, unknown> }[];
  /** Corps des exécutions soumises, dans l'ordre. */
  executions: Record<string, unknown>[];
  resultats: string[];
  annulations: string[];
  ecarts: { id: string; base: number; other: number }[];
  appels: string[];
  inattendues: string[];
}
export interface ServeurDashboards {
  journal: JournalDashboards;
  entree: (id: string) => EntreeDashboard;
  /** Laisse terminer les exécutions retenues. */
  liberer: () => void;
  /** Exécutions soumises et pas encore terminées, selon le serveur. */
  enCours: () => number;
  /** Plus grand nombre d'exécutions simultanément en cours observé par le serveur. */
  maximum: () => number;
  /** Les appels qui écrivent dans le dépôt, dans l'ordre (une exécution n'écrit pas : elle se lit dans `journal.executions`). */
  ecritures: () => string[];
}

const COMPOSANTS = ["analysis", "kpi"];
interface Noeud { id: string; type: string; children?: Noeud[]; rows?: Noeud[]; columns?: Noeud[]; sections?: Noeud[]; reference?: { analysis_id: string } }

/** Les composants exécutables d'un document, dans l'ordre du document. */
export function executables(document: Document): { id: string; analyse: string }[] {
  const trouves: { id: string; analyse: string }[] = [];
  const parcourir = (noeud: Noeud) => {
    if (COMPOSANTS.includes(noeud.type) && noeud.reference !== undefined) trouves.push({ id: noeud.id, analyse: noeud.reference.analysis_id });
    for (const fils of [...(noeud.rows ?? []), ...(noeud.columns ?? []), ...(noeud.children ?? [])]) parcourir(fils);
  };
  for (const section of document.layout.sections as { rows: Noeud[] }[]) for (const rangee of section.rows) parcourir(rangee);
  return trouves;
}

/** Document d'une section sans titre : une rangée, une colonne pleine, et le contenu donné. */
export function pageDe(nom: string, contenu: object[], extra: Partial<Document> = {}): Document {
  return {
    name: nom, description: "Suivi.", visibility: "shared", defaults: {}, filters: [],
    layout: { sections: [{ id: uuid(1), title: "Ventes", rows: [{ id: uuid(2), columns: [{ id: uuid(3), span: 12, children: contenu }] }] }] },
    ...extra,
  };
}
export const visuel = (id: string, analyse: string, presentation: object = {}) => ({ id, type: "analysis", reference: { analysis_id: analyse, revision: 1 }, presentation });
export const texte = (id: string, mots: string) => ({ id, type: "text", blocks: [{ type: "paragraph", content: [{ text: mots }] }] });

export function entreeDashboard(id: string, document: Document, extra: Partial<EntreeDashboard> = {}): EntreeDashboard {
  return { id, proprietaire: MOI, revisions: [document], droits: TOUS, ...extra };
}
export { AUCUN, TOUS };

const memeContenu = (a: Document, b: Document) => JSON.stringify(a) === JSON.stringify(b);

export async function servirDashboards(page: Page, reglages: ReglagesDashboards): Promise<ServeurDashboards> {
  const dashboards = new Map((reglages.dashboards ?? []).map((e) => [e.id, e]));
  const analyses = reglages.analyses ?? {};
  const entreesAnalyses = new Map(Object.entries(analyses).map(([id, a]) => [id, entree(id, (a.revisions ?? [a.contenu ?? {}]).map((revision) => brouillon(a.nom, revision)), { proprietaire: "cora", droits: a.droits ?? (a.contenu?.visibility === "personal" ? TOUS : AUCUN) })]));
  const supprimees = new Set<string>();
  const identifiants = (reglages.identifiants ?? [DASHBOARD_ID, AUTRE_DASHBOARD_ID]).filter((id) => !dashboards.has(id));
  const journal: JournalDashboards = { creations: [], revisions: [], executions: [], resultats: [], annulations: [], ecarts: [], appels: [], inattendues: [] };
  const lancees = new Map<string, { requete: Requete; issue: NonNullable<AnalysePinglee["issue"]> }>();
  const actives = new Set<string>();
  let maximum = 0;
  let liberee = reglages.retenir !== true;
  const ENTIER = /^[1-9]\d{0,8}$/;

  const tuiles = (document: Document) => executables(document).map(({ id, analyse }) => {
    const tuile = analyses[analyse]?.tuile ?? "prete";
    if (tuile === "indisponible") return { id, state: "unavailable", reason: "analysis_unavailable" };
    return { id, state: tuile === "non_verifie" ? "unverified" : "ready" };
  });
  const etat = (document: Document) => {
    const lues = tuiles(document);
    return lues.some((one) => one.state === "unavailable") ? "unresolved_reference" : lues.some((one) => one.state === "unverified") ? "unverified" : "ready";
  };
  const revisionDe = (e: EntreeDashboard, numero: number) => {
    const document = e.revisions[numero - 1] as Document;
    return {
      ...fixe(lire, e.id).body,
      id: e.id, revision: numero, current_revision: e.revisions.length, state: etat(document), components: tuiles(document), permissions: e.droits,
      revised_by: { issuer: EMETTEUR, subject: e.proprietaire },
      dashboard: { api_version: "board.dashboard/v1", id: e.id, owner: { issuer: EMETTEUR, subject: e.proprietaire }, ...structuredClone(document) },
    };
  };

  await page.clock.setFixedTime(new Date("2026-11-04T12:30:00Z"));
  const traiter = async (route: Route) => {
    const requete = route.request();
    const url = new URL(requete.url());
    const methode = requete.method();
    const chemin = url.pathname.startsWith(RACINE) ? url.pathname.slice(RACINE.length) : url.pathname;
    const corps = (): Record<string, unknown> => requete.postDataJSON() as Record<string, unknown>;
    const cles = [...url.searchParams.keys()].sort().join(",");
    const reconnu = (attendue: string, gabarit: string) => {
      if (methode !== attendue || cles !== "") return false;
      journal.appels.push(`${methode} ${gabarit}`);
      return true;
    };
    if (chemin === "/explorer/fields" && reconnu("GET", "/explorer/fields")) return route.fulfill({ json: { models: MODELES } });
    if (chemin === "/executions" && reconnu("POST", "/executions")) {
      const recu = corps();
      journal.executions.push(recu);
      const lancee = { connection: recu.connection, environment: recu.environment, model: recu.model, metrics: recu.metrics, dimensions: recu.dimensions, filters: recu.filters } as unknown as Requete;
      const analyse = (recu.analysis as { id: string } | undefined)?.id ?? "";
      const id = executionN(lancees.size + 1);
      const issue = analyses[analyse]?.issue ?? "reussie";
      const dejaSoumise = journal.executions.filter((one) => (one.analysis as { id: string } | undefined)?.id === analyse).length > 1;
      lancees.set(id, { requete: lancee, issue: issue === "annulee" && dejaSoumise ? "reussie" : issue });
      actives.add(id);
      maximum = Math.max(maximum, actives.size);
      const { space_id: espaceId, connection, environment, created_at: creee, started_at: demarree, deadline_at: echeance } = executionTerminee(lancee, id, "reussie");
      return route.fulfill({ status: 202, json: { id, space_id: espaceId, environment, connection, state: "running", created_at: creee, started_at: demarree, finished_at: null, deadline_at: echeance, can_cancel: true, cancel_requested: false, error_code: null, rows: null, size: null, truncated: null } });
    }
    const annulation = /^\/executions\/([^/]+)\/cancel$/.exec(chemin);
    const aAnnuler = annulation?.[1] === undefined ? undefined : lancees.get(annulation[1]);
    if (annulation?.[1] !== undefined && aAnnuler !== undefined && reconnu("POST", "/executions/:id/cancel")) {
      journal.annulations.push(annulation[1]);
      actives.delete(annulation[1]);
      const { space_id, connection, environment, created_at, started_at, deadline_at, finished_at } = executionTerminee(aAnnuler.requete, annulation[1], "reussie");
      return route.fulfill({ json: { id: annulation[1], space_id, connection, environment, created_at, started_at, deadline_at, finished_at, state: "cancelled", can_cancel: false, cancel_requested: true, error_code: "cancelled", rows: null, size: null, truncated: null } });
    }
    const lancement = /^\/executions\/([^/]+)(\/result)?$/.exec(chemin);
    const connue = lancement?.[1] === undefined ? undefined : lancees.get(lancement[1]);
    if (lancement?.[1] !== undefined && connue !== undefined) {
      if (lancement[2] === undefined && reconnu("GET", "/executions/:id")) {
        if (!liberee) {
          const { space_id: espaceId, connection, environment, created_at: creee, started_at: demarree, deadline_at: echeance } = executionTerminee(connue.requete, lancement[1], "reussie");
          return route.fulfill({ json: { id: lancement[1], space_id: espaceId, environment, connection, state: "running", created_at: creee, started_at: demarree, finished_at: null, deadline_at: echeance, can_cancel: true, cancel_requested: false, error_code: null, rows: null, size: null, truncated: null } });
        }
        actives.delete(lancement[1]);
        if (connue.issue === "annulee") {
          const { space_id, connection, environment, created_at, started_at, deadline_at, finished_at } = executionTerminee(connue.requete, lancement[1], "reussie");
          return route.fulfill({ json: { id: lancement[1], space_id, connection, environment, created_at, started_at, deadline_at, finished_at, state: "cancelled", can_cancel: false, cancel_requested: false, error_code: "cancelled", rows: null, size: null, truncated: null } });
        }
        if (connue.issue !== "tronque") return route.fulfill({ json: executionTerminee(connue.requete, lancement[1], connue.issue === "resultat_perdu" ? "reussie" : connue.issue) });
        const entiere = executionTerminee(connue.requete, lancement[1], "reussie") as { result_contract: Record<string, unknown> };
        return route.fulfill({ json: { ...entiere, truncated: true, result_contract: { ...entiere.result_contract, completeness: "truncated" } } });
      }
      if (lancement[2] !== undefined && connue.issue === "resultat_perdu" && reconnu("GET", "/executions/:id/result")) {
        return route.fulfill({ status: 409, json: { error: { code: "result_unavailable" } } });
      }
      if (lancement[2] !== undefined && (connue.issue === "reussie" || connue.issue === "tronque") && reconnu("GET", "/executions/:id/result")) {
        journal.resultats.push(lancement[1]);
        return route.fulfill({ contentType: "application/vnd.apache.arrow.stream", body: Buffer.from(resultat(connue.requete).octets) });
      }
    }
    if (chemin === "/analyses" && reconnu("GET", "/analyses")) {
      return route.fulfill({ json: { analyses: [...entreesAnalyses.values()].map((entry) => {
        const last = entry.revisions.at(-1) as Brouillon;
        return { ...fixe(listeAnalyses, entry.id).body.analyses[0], id: entry.id, name: last.name, visibility: last.visibility, is_owner: last.visibility === "personal", revision: entry.revisions.length, model: last.query.model, metrics: last.query.metrics };
      }), unreadable: 0 } });
    }
    const ficheAnalyse = /^\/analyses\/([^/]+)(?:\/(opened|consumers))?$/.exec(chemin);
    const fiche = ficheAnalyse?.[1] === undefined ? undefined : entreesAnalyses.get(ficheAnalyse[1]);
    if (fiche !== undefined && ficheAnalyse?.[1] !== undefined) {
      const id = ficheAnalyse[1];
      const dependants = [...dashboards.values()].filter((entry) => executables(entry.revisions.at(-1) as Document).some((one) => one.analyse === id));
      const visibles = dependants.filter((entry) => entry.proprietaire === MOI || (entry.revisions.at(-1) as Document).visibility === "shared");
      const consumers = visibles.map((entry) => ({ kind: "dashboard", id: entry.id }));
      const others = dependants.length - visibles.length;
      if (ficheAnalyse[2] === "consumers" && reconnu("GET", "/analyses/:id/consumers")) return route.fulfill({ json: { id, consumers, others } });
      if (ficheAnalyse[2] === "opened" && reconnu("POST", "/analyses/:id/opened")) return route.fulfill({ status: 202, json: { recorded: true } });
      if (ficheAnalyse[2] === undefined && methode === "DELETE" && cles === "expected_revision") {
        journal.appels.push("DELETE /analyses/:id");
        if (dependants.length > 0) return route.fulfill({ status: 409, json: { error: { code: "analysis_in_use", consumers, others } } });
        supprimees.add(id); return route.fulfill({ status: 204 });
      }
      if (ficheAnalyse[2] === undefined && reconnu("GET", "/analyses/:id")) return supprimees.has(id) ? route.fulfill({ status: 404, json: { error: { code: "analysis_not_found", reason: "not_visible" } } }) : route.fulfill({ json: revisionJson(fiche, fiche.revisions.length) });
    }
    const historique = /^\/analyses\/([^/]+)\/revisions$/.exec(chemin);
    const trouvee = historique?.[1] === undefined ? undefined : entreesAnalyses.get(historique[1]);
    if (historique?.[1] !== undefined && trouvee !== undefined && reconnu("GET", "/analyses/:id/revisions")) {
      const example = fixe(historiqueAnalyses, historique[1]).body;
      return route.fulfill({ json: { ...example, current_revision: trouvee.revisions.length, revisions: trouvee.revisions.map((_, i) => ({ ...example.revisions[0], revision: i + 1 })) } });
    }
    if (chemin === "/dashboards" && reconnu("GET", "/dashboards")) {
      const visibles = [...dashboards.values()].filter((e) => e.proprietaire === MOI || (e.revisions.at(-1) as Document).visibility === "shared");
      return route.fulfill({ json: {
        dashboards: visibles.map((e) => {
          const dernier = e.revisions.at(-1) as Document;
          return { ...fixe(lister, e.id).body.dashboards[0], id: e.id, name: dernier.name, visibility: dernier.visibility, owner: { issuer: EMETTEUR, subject: e.proprietaire }, is_owner: e.proprietaire === MOI, revision: e.revisions.length, state: "indexed" };
        }),
        unreadable: 0,
      } });
    }
    if (chemin === "/dashboards" && reconnu("POST", "/dashboards")) {
      const id = identifiants.shift() as string;
      const recu = corps() as unknown as Document;
      journal.creations.push(corps());
      const cree = entreeDashboard(id, recu);
      dashboards.set(id, cree);
      return route.fulfill({ status: creer.status, json: revisionDe(cree, 1) });
    }
    const copie = /^\/dashboards\/([^/]+)\/duplicate$/.exec(chemin);
    const source = copie?.[1] === undefined ? undefined : dashboards.get(copie[1]);
    if (copie?.[1] !== undefined && source !== undefined && reconnu("POST", "/dashboards/:id/duplicate")) {
      const original = source.revisions.at(-1) as Document;
      const id = identifiants.shift() as string;
      const clone = entreeDashboard(id, { ...structuredClone(original), name: `Copie de ${original.name}`, visibility: "personal" });
      dashboards.set(id, clone);
      return route.fulfill({ status: 201, json: revisionDe(clone, 1) });
    }
    const diff = /^\/dashboards\/([^/]+)\/diff$/.exec(chemin);
    if (diff?.[1] !== undefined && dashboards.has(diff[1]) && methode === "GET" && cles === "base,other") {
      journal.appels.push("GET /dashboards/:id/diff");
      const base = Number(url.searchParams.get("base"));
      const other = Number(url.searchParams.get("other"));
      journal.ecarts.push({ id: diff[1], base, other });
      return route.fulfill({ json: { ...fixe(ecartDashboard, diff[1]).body, base, other, changes: reglages.masquerPremiere ? ecartReel : fixe(ecartDashboard, diff[1]).body.changes } });
    }
    const historiqueDash = /^\/dashboards\/([^/]+)\/revisions(?:\/([1-9]\d{0,8}))?$/.exec(chemin);
    const entry = historiqueDash?.[1] === undefined ? undefined : dashboards.get(historiqueDash[1]);
    if (historiqueDash?.[1] !== undefined && entry !== undefined && methode === "GET" && cles === "") {
      if (historiqueDash[2] !== undefined) {
        journal.appels.push("GET /dashboards/:id/revisions/:n");
        const n = Number(historiqueDash[2]);
        return route.fulfill({ json: revisionDe(entry, n) });
      }
      journal.appels.push("GET /dashboards/:id/revisions");
      const example = fixe(historiqueDashboard, historiqueDash[1]).body;
      return route.fulfill({ json: { ...example, current_revision: entry.revisions.length, revisions: entry.revisions.map((_, i) => reglages.masquerPremiere && i === 0 ? { revision: 1, available: false } : { ...example.revisions[0], revision: i + 1 }) } });
    }
    const lu = /^\/dashboards\/([^/]+)(\/revisions)?$/.exec(chemin);
    const courant = lu?.[1] === undefined ? undefined : dashboards.get(lu[1]);
    if (lu?.[1] !== undefined && courant !== undefined) {
      const nombre = courant.revisions.length;
      if (lu[2] === undefined && reconnu("GET", "/dashboards/:id")) return route.fulfill({ json: revisionDe(courant, nombre) });
      if (lu[2] !== undefined && reconnu("POST", "/dashboards/:id/revisions")) {
        const recu = corps();
        journal.revisions.push({ id: courant.id, corps: recu });
        const { expected_revision: attendue, ...contenu } = recu;
        if (attendue !== nombre) return route.fulfill({ status: conflit.status, json: conflit.body });
        const references = executables(contenu as unknown as Document).filter((one) => analyses[one.analyse]?.contenu?.visibility === "personal");
        if ((contenu as unknown as Document).visibility === "shared" && references.length > 0) return route.fulfill({ status: personnel.status, json: { error: { ...personnel.body.error, components: references.map((one) => one.id) } } });
        if (memeContenu(contenu as unknown as Document, courant.revisions.at(-1) as Document)) return route.fulfill({ status: 200, json: revisionDe(courant, nombre) });
        courant.revisions.push(contenu as unknown as Document);
        return route.fulfill({ status: 201, json: revisionDe(courant, nombre + 1) });
      }
    }
    const analyse = /^\/analyses\/([^/]+)\/revisions\/([^/]+)$/.exec(chemin);
    const epinglee = analyse?.[1] === undefined ? undefined : entreesAnalyses.get(analyse[1]);
    if (analyse?.[2] !== undefined && epinglee !== undefined && ENTIER.test(analyse[2]) && reconnu("GET", "/analyses/:id/revisions/:n")) {
      return supprimees.has(analyse[1] as string) || Number(analyse[2]) > epinglee.revisions.length
        ? route.fulfill({ status: 404, json: { error: { code: "analysis_not_found", reason: "unknown_revision" } } })
        : route.fulfill({ json: revisionJson(epinglee, Number(analyse[2])) });
    }
    journal.inattendues.push(`${methode} ${url.pathname}${url.search}`);
    return route.abort();
  };
  await page.route("**/api/**", async (route) => {
    try {
      await traiter(route);
    } catch (erreur) {
      if (!(erreur instanceof Refus)) throw erreur;
      journal.inattendues.push(`${route.request().method()} ${new URL(route.request().url()).pathname} : ${erreur.message}`);
      await route.abort();
    }
  });
  await simulerIdentite(page, etabli);
  const lui = { ...espace.body, role: reglages.role };
  await simulerEspaces(page, {
    "/api/spaces/finance": { status: 200, body: lui },
    "/api/spaces": { status: 200, body: { spaces: liste.body.spaces.map((s) => (s.id === "finance" ? { ...s, role: reglages.role } : s)) } },
  });
  return {
    journal,
    entree: (id) => dashboards.get(id) as EntreeDashboard,
    liberer: () => { liberee = true; },
    enCours: () => actives.size,
    maximum: () => maximum,
    ecritures: () => journal.appels.filter((fait) => !fait.startsWith("GET ") && fait !== "POST /executions" && fait !== "POST /executions/:id/cancel"),
  };
}
