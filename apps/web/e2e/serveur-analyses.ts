import { createHash } from "node:crypto";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import type { Page, Route } from "@playwright/test";
import creer from "../../../contracts/analyses/routes/creer.json" with { type: "json" };
import ecart from "../../../contracts/analyses/routes/ecart.json" with { type: "json" };
import execution from "../../../contracts/analyses/routes/derniere-execution.json" with { type: "json" };
import executionAucune from "../../../contracts/analyses/routes/derniere-execution-aucune.json" with { type: "json" };
import executionRefusee from "../../../contracts/analyses/routes/derniere-execution-refusee.json" with { type: "json" };
import conflit from "../../../contracts/analyses/routes/refus-revision-conflit.json" with { type: "json" };
import historique from "../../../contracts/analyses/routes/historique.json" with { type: "json" };
import lister from "../../../contracts/analyses/routes/lister.json" with { type: "json" };
import ouvrir from "../../../contracts/analyses/routes/ouvrir.json" with { type: "json" };
import usage from "../../../contracts/analyses/routes/usage.json" with { type: "json" };
import espace from "../../../contracts/espaces/espace.json" with { type: "json" };
import liste from "../../../contracts/espaces/liste.json" with { type: "json" };
import etabli from "../../../contracts/identite/me-etabli.json" with { type: "json" };
import { simulerEspaces, simulerIdentite } from "./aides";

/**
 * Serveur simulé des analyses pour les parcours navigateur (plan 18, 18.5c). Chaque réponse est un exemple réel de
 * `contracts/analyses/routes/` dont seuls les champs qui varient sont remplacés ; le dépôt de contenus est un petit état en
 * mémoire, de sorte que ce que le navigateur écrit est ce qu'il relit.
 */
export const ID = "5f1d7c52-3b0e-4d36-9a54-0c7a3e1b9d20";
export const AUTRE_ID = "0b9e4a77-1c3d-4e58-b2f6-7a8d9c0e1f23";
export const TROISIEME_ID = "8c2f6b10-4d7a-4a35-9e81-3b5c7d9e1f42";
export const COMMIT = "0123456789abcdef0123456789abcdef01234567";
export const MOI = etabli.body.identity.subject;
export const EMETTEUR = etabli.body.identity.issuer;
export const RACINE = "/api/spaces/finance";

export type Role = "admin" | "creator" | "reader";
export type Etat = "ready" | "index_stale" | "unverified" | "unresolved_reference";
export interface Brouillon {
  name: string;
  description: string;
  visibility: "personal" | "shared";
  query: { connection: string; model: string; metrics: string[]; dimensions: string[]; filters: { column: string; operator: string; value: unknown }[] };
  contextual: object[];
  presentation: { chart: string };
}
export interface Droits { owner: boolean; revise: boolean; delete: boolean; duplicate: boolean }
/** Issue d'une exécution : réussie, ou refusée par la politique (`deny`, `require_human`), sans résultat ni preuve. */
export type Mode = "reussie" | "deny" | "require_human";
export interface Entree {
  id: string;
  proprietaire: string;
  etat: Etat;
  nonResolues: { path: string; rule: string }[];
  revisions: Brouillon[];
  droits: Droits;
  /** Dernière exécution de la personne depuis cette analyse (onglet Preuves) : aucune, ou l'issue de la requête de la révision courante. */
  derniere: "aucune" | "reussie" | "refusee" | "require_human";
}
export interface Reglages {
  role: Role;
  entrees?: Entree[];
  illisibles?: number;
  identifiants?: string[];
  /** Issue des exécutions de l'Explorateur : réussie (défaut) ; `serveur.mode` la change en cours de parcours. */
  execution?: Mode;
}
export interface Journal {
  creations: Record<string, unknown>[];
  revisions: { id: string; corps: Record<string, unknown> }[];
  executions: Record<string, unknown>[];
  ouvertures: { id: string; corps: Record<string, unknown> }[];
  ecarts: string[];
  /** Identifiants des exécutions dont le résultat a été lu, dans l'ordre. */
  resultats: string[];
  /** Chaque appel reconnu, au gabarit de sa route (`POST /analyses/:id/opened`), dans l'ordre : méthode, chemin et paramètres déjà contrôlés. */
  appels: string[];
  /** Demandes hors scénario : un parcours qui sortirait de ce qui est simulé le dit ici. */
  inattendues: string[];
}

export const TOUS: Droits = { owner: true, revise: true, delete: true, duplicate: true };
export const AUCUN: Droits = { owner: false, revise: false, delete: false, duplicate: false };

/** Brouillon de la requête « Chiffre d'affaires par région » du modèle `sales`, tel que l'Explorateur sait le porter. */
export function brouillon(nom: string, extra: Partial<Brouillon> = {}): Brouillon {
  return {
    name: nom, description: "Suivi.", visibility: "shared",
    query: { connection: "finance", model: "sales", metrics: ["revenue"], dimensions: ["region"], filters: [{ column: "region", operator: "in", value: ["Nord", "Sud"] }] },
    contextual: [], presentation: { chart: "bars" },
    ...extra,
  };
}
export function entree(id: string, revisions: Brouillon[], extra: Partial<Entree> = {}): Entree {
  return { id, proprietaire: "cora", etat: "ready", nonResolues: [], revisions, droits: AUCUN, derniere: "aucune", ...extra };
}

export const MODELES = [
  {
    name: "sales", label: "Ventes", description: "Ventes",
    metrics: [{ name: "revenue", label: "Chiffre d'affaires", description: "Montant", aggregation: "sum", additivity: "additive" }],
    dimensions: [{ name: "order_month", label: "Mois", description: "Mois de commande", type: "date", is_time: true }, { name: "region", label: "Région", description: "Région", type: "string", is_time: false }],
  },
  {
    name: "sales_orders", label: "Commandes", description: "Commandes",
    metrics: [
      { name: "revenue", label: "Chiffre d'affaires", description: "Montant", aggregation: "sum", additivity: "additive" },
      { name: "orders", label: "Commandes", description: "Nombre", aggregation: "count", additivity: "additive" },
    ],
    dimensions: [{ name: "region", label: "Région", description: "Région", type: "string", is_time: false }, { name: "channel", label: "Canal", description: "Canal", type: "string", is_time: false }],
  },
];

export const fixe = <T>(valeur: T, uuid = ID): T => JSON.parse(JSON.stringify(valeur).replaceAll("<uuid>", uuid).replaceAll("<commit>", COMMIT)) as T;

/** Requête d'une exécution, telle que l'Explorateur la soumet (hors référence d'analyse). */
export interface Requete {
  connection: string;
  environment: string;
  model: string;
  metrics: string[];
  dimensions: string[];
  filters: { column: string; operator: string; value: unknown }[];
}

const sha = (texte: string) => createHash("sha256").update(texte).digest("hex");
/** Empreinte SQL simulée : une par requête, jamais celle d'une autre. */
export const empreinte = (requete: Requete) => `sha256:v1:${sha(JSON.stringify([requete.connection, requete.environment, requete.model, requete.metrics, requete.dimensions, requete.filters.map(({ column, operator, value }) => [column, operator, value])]))}`;
const uuid = (chiffre: string, fin: string) => `${chiffre.repeat(8)}-${chiffre.repeat(4)}-4${chiffre.repeat(3)}-8${chiffre.repeat(3)}-${fin}`;
const suffixe = (n: number) => n.toString(16).padStart(12, "0");
/** Identifiant de l'exécution d'une analyse (onglet Preuves) : un par analyse. */
export const executionDe = (idAnalyse: string) => uuid("2", idAnalyse.slice(-12));
/** Identifiants des exécutions de l'Explorateur : un compteur, distinct de ceux des analyses. */
export const executionN = (n: number) => uuid("2", suffixe(n));
export const preuveDe = (execution: string) => uuid("3", execution.slice(-12));

const COLONNES_SOURCE: Record<string, string[]> = { revenue: ["amount"], orders: ["order_id"] };

/**
 * Le jeu de données sous-jacent : une ligne par commande. Les deux modèles simulés (`sales`, `sales_orders`) le lisent ; le chiffre
 * d'affaires est la somme de `amount`, les commandes en sont le nombre de lignes. Nord 12 et Sud 5, soit 17 en tout et 5 commandes.
 */
export const FAITS = [
  { region: "Nord", channel: "Web", amount: 7 },
  { region: "Nord", channel: "Web", amount: 3 },
  { region: "Nord", channel: "Magasin", amount: 2 },
  { region: "Sud", channel: "Web", amount: 3 },
  { region: "Sud", channel: "Magasin", amount: 2 },
];
type Fait = (typeof FAITS)[number];
const COLONNES: readonly string[] = ["region", "channel"];
const MESURES: Record<string, (faits: Fait[]) => number> = {
  revenue: (faits) => faits.reduce((somme, fait) => somme + fait.amount, 0),
  orders: (faits) => faits.length,
};

/** Une forme de requête que le simulateur ne sait pas calculer : il la refuse plutôt que d'inventer une réponse. */
export class Refus extends Error {}
const refuse = (raison: string): never => { throw new Refus(`Résultat non simulé : ${raison}`); };

/**
 * Résultat de la requête, calculé sur `FAITS` comme le ferait un moteur : les filtres s'appliquent d'abord, sur toute colonne du
 * jeu (rendue ou non), puis les lignes retenues sont regroupées par les dimensions demandées et chaque métrique agrégée. Sans
 * dimension, une ligne de totaux. Sont refusés (`Refus`) : un modèle, une métrique, une dimension ou une colonne de filtre inconnus ou
 * sans données (`order_month`), un opérateur autre que `eq`, `ne`, `in`, une valeur qui n'est pas du texte, et une sélection vide.
 */
export function resultat(requete: Requete) {
  const modele = MODELES.find((item) => item.name === requete.model) ?? refuse(`modèle ${requete.model}`);
  for (const dimension of requete.dimensions) {
    if (!modele.dimensions.some((item) => item.name === dimension) || !COLONNES.includes(dimension)) refuse(`dimension ${dimension} du modèle ${requete.model}`);
  }
  for (const metrique of requete.metrics) {
    if (!modele.metrics.some((item) => item.name === metrique) || MESURES[metrique] === undefined) refuse(`métrique ${metrique} du modèle ${requete.model}`);
  }
  for (const filtre of requete.filters) {
    if (!COLONNES.includes(filtre.column) || !modele.dimensions.some((item) => item.name === filtre.column)) refuse(`filtre sur la colonne ${filtre.column} du modèle ${requete.model}`);
    if (filtre.operator !== "eq" && filtre.operator !== "ne" && filtre.operator !== "in") refuse(`opérateur ${filtre.operator}`);
    const valeurs = filtre.operator === "in" ? filtre.value : [filtre.value];
    if (!Array.isArray(valeurs) || valeurs.length === 0 || !valeurs.every((valeur) => typeof valeur === "string")) refuse(`valeur du filtre ${filtre.column} ${filtre.operator}`);
  }
  const retenus = FAITS.filter((fait) => requete.filters.every((filtre) => {
    const valeurs = (filtre.operator === "in" ? filtre.value : [filtre.value]) as string[];
    return valeurs.includes(fait[filtre.column as "region" | "channel"]) === (filtre.operator !== "ne");
  }));
  if (retenus.length === 0) refuse("sélection vide");
  const groupes = new Map<string, Fait[]>();
  for (const fait of retenus) {
    const cle = JSON.stringify(requete.dimensions.map((dimension) => fait[dimension as "region" | "channel"]));
    groupes.set(cle, [...(groupes.get(cle) ?? []), fait]);
  }
  const lignes = [...groupes.values()];
  const colonnes: Record<string, string[] | Float64Array> = {};
  for (const dimension of requete.dimensions) colonnes[dimension] = lignes.map((groupe) => (groupe[0] as Fait)[dimension as "region" | "channel"]);
  for (const metrique of requete.metrics) colonnes[metrique] = Float64Array.from(lignes.map((groupe) => (MESURES[metrique] as (faits: Fait[]) => number)(groupe)));
  return { octets: tableToIPC(tableFromArrays(colonnes), "stream"), lignes: lignes.length };
}

/** Une exécution terminée, cohérente avec sa requête : contrat de résultat, preuve, volumétrie et données viennent de la même requête. */
export function executionTerminee(requete: Requete, id: string, mode: Mode) {
  const modele = MODELES.find((item) => item.name === requete.model);
  const base = fixe(execution, id).body.execution;
  const commun = { ...base, id, connection: requete.connection, environment: requete.environment };
  if (mode !== "reussie") return { ...fixe(executionRefusee, id).body.execution, id, connection: requete.connection, environment: requete.environment, error_code: mode };
  const { octets, lignes } = resultat(requete);
  const metriques = requete.metrics.map((nom) => modele?.metrics.find((item) => item.name === nom) ?? { name: nom, aggregation: "sum", additivity: "additive" });
  const exemple = base.evidence.metrics[0];
  const politique = base.evidence.normalized_filters[0];
  return {
    ...commun, rows: lignes, size: octets.byteLength,
    result_contract: { metrics: metriques.map(({ name, additivity, aggregation }) => ({ name, additivity, aggregation })), dimensions: requete.dimensions, completeness: "complete" },
    evidence: {
      ...base.evidence,
      metrics: metriques.map(({ name }) => ({ ...exemple, name, model_key: requete.model, source_columns: COLONNES_SOURCE[name] ?? [name], definition_hash: `sha256:v1:${sha(`${requete.model}:${name}`)}` })),
      dimensions: requete.dimensions, model_keys: [requete.model],
      sources: base.evidence.sources.map((source) => ({ ...source, dataset: `main.${requete.model}` })),
      normalized_filters: [{ ...politique, model_key: requete.model }, ...requete.filters.map((filtre) => ({ column: filtre.column, operator: filtre.operator, origin: "exploration", model_key: requete.model, value: "<redacted>" }))],
      sql_hash: empreinte(requete), evidence_id: preuveDe(id), statement_id: uuid("4", id.slice(-12)),
    },
    connector_run_id: uuid("5", id.slice(-12)),
  };
}

const requeteDe = (revision: Brouillon): Requete => ({ ...structuredClone(revision.query), environment: "DEV" });

export function revisionJson(e: Entree, numero: number) {
  const brouillonLu = e.revisions[numero - 1] as Brouillon;
  return {
    ...fixe(creer, e.id).body,
    id: e.id, revision: numero, current_revision: e.revisions.length, state: e.etat, unresolved: e.nonResolues, permissions: e.droits,
    revised_by: { issuer: EMETTEUR, subject: e.proprietaire },
    analysis: { api_version: "board.analysis/v1", id: e.id, owner: { issuer: EMETTEUR, subject: e.proprietaire }, ...structuredClone(brouillonLu) },
  };
}

const memeContenu = (a: Brouillon, b: Brouillon) => JSON.stringify(a) === JSON.stringify(b);

interface Ecart { path: string; kind: "added" | "removed" | "modified"; before: unknown; after: unknown }
/**
 * Écarts structurels entre deux documents, sur le modèle de `diff` du serveur (`content/analysis.py`) : les clés dans l'ordre d'insertion,
 * puis les listes position par position. Ce n'est pas un portage complet : ni l'ordre `_RANK` du serveur, ni la distinction entre `1` et
 * `1.0` ne sont reproduits. Il ne vaut que pour les cas simulés ici (révisions qui diffèrent par des textes, un opérateur, une valeur
 * ou un genre) ; une équivalence générale avec l'API n'est pas recherchée.
 */
export function ecarts(avant: unknown, apres: unknown, chemin = "", sortie: Ecart[] = []): Ecart[] {
  const objet = (valeur: unknown): valeur is Record<string, unknown> => typeof valeur === "object" && valeur !== null && !Array.isArray(valeur);
  if (objet(avant) && objet(apres)) {
    for (const cle of [...Object.keys(avant), ...Object.keys(apres).filter((nom) => !(nom in avant))]) {
      if (!(cle in apres)) sortie.push({ path: `${chemin}/${cle}`, kind: "removed", before: avant[cle], after: null });
      else if (!(cle in avant)) sortie.push({ path: `${chemin}/${cle}`, kind: "added", before: null, after: apres[cle] });
      else ecarts(avant[cle], apres[cle], `${chemin}/${cle}`, sortie);
    }
  } else if (Array.isArray(avant) && Array.isArray(apres)) {
    for (let i = 0; i < Math.max(avant.length, apres.length); i += 1) {
      if (i >= apres.length) sortie.push({ path: `${chemin}/${i}`, kind: "removed", before: avant[i], after: null });
      else if (i >= avant.length) sortie.push({ path: `${chemin}/${i}`, kind: "added", before: null, after: apres[i] });
      else ecarts(avant[i], apres[i], `${chemin}/${i}`, sortie);
    }
  } else if (JSON.stringify(avant) !== JSON.stringify(apres)) sortie.push({ path: chemin, kind: "modified", before: avant, after: apres });
  return sortie;
}

export interface Serveur {
  journal: Journal;
  entree: (id: string) => Entree;
  /** Une autre personne enregistre une révision entre-temps. */
  publierAilleurs: (id: string, brouillonSuivant: Brouillon) => void;
  /** Change l'issue des exécutions suivantes de l'Explorateur. */
  mode: (mode: Mode) => void;
  /** Nombre d'appels reconnus au gabarit donné. */
  compte: (appel: string) => number;
  /** Les appels qui écrivent, dans l'ordre : tout ce qui n'est pas une lecture. */
  ecritures: () => string[];
}

/** Enregistre dans le journal toute demande hors scénario ; les tests vérifient qu'il reste vide. */
export async function servirAnalyses(page: Page, reglages: Reglages): Promise<Serveur> {
  const entrees = new Map((reglages.entrees ?? []).map((e) => [e.id, e]));
  const identifiants = (reglages.identifiants ?? [ID, AUTRE_ID, TROISIEME_ID]).filter((id) => !entrees.has(id));
  const journal: Journal = { creations: [], revisions: [], executions: [], ouvertures: [], ecarts: [], resultats: [], appels: [], inattendues: [] };
  const lancees = new Map<string, { requete: Requete; mode: Mode }>();
  let mode: Mode = reglages.execution ?? "reussie";
  const trouver = (id: string) => entrees.get(id);
  const refus = (route: Route, exemple: { status: number; body: unknown }) => route.fulfill({ status: exemple.status, json: exemple.body });
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  /** Numéro de révision en forme canonique, celle de `route.ts` : entier positif sans zéro de tête, neuf chiffres au plus (`02`, `0`, `+1` refusés). */
  const ENTIER = /^[1-9]\d{0,8}$/;

  await page.clock.setFixedTime(new Date("2026-11-04T12:30:00Z"));
  const traiter = async (route: Route) => {
    const requete = route.request();
    const url = new URL(requete.url());
    const methode = requete.method();
    const chemin = url.pathname.startsWith(RACINE) ? url.pathname.slice(RACINE.length) : url.pathname;
    const corps = (): Record<string, unknown> => requete.postDataJSON() as Record<string, unknown>;
    // Méthode, chemin, paramètres (noms exacts) et valeurs (forme canonique attendue) sont contrôlés pour chaque route ; un appel
    // reconnu est consigné au gabarit de sa route, tout autre finit dans `inattendues`.
    const cles = [...url.searchParams.keys()].sort().join(",");
    const reconnu = (attendue: string, gabarit: string, parametres = "", formes: Record<string, RegExp> = {}) => {
      if (methode !== attendue || cles !== parametres) return false;
      if (!Object.entries(formes).every(([nom, forme]) => url.searchParams.getAll(nom).length === 1 && forme.test(url.searchParams.get(nom) as string))) return false;
      journal.appels.push(`${methode} ${gabarit}`);
      return true;
    };
    const sur = (chemins: string) => chemin === chemins;
    if (sur("/explorer/connections") && reconnu("GET", "/explorer/connections")) return route.fulfill({ json: { connections: ["finance"] } });
    if (sur("/explorer/fields") && reconnu("GET", "/explorer/fields")) return route.fulfill({ json: { models: MODELES } });
    if (sur("/executions") && reconnu("POST", "/executions")) {
      const recu = corps();
      journal.executions.push(recu);
      // La référence d'analyse accompagne la demande mais n'en change ni le résultat ni la preuve.
      const lancee = { connection: recu.connection, environment: recu.environment, model: recu.model, metrics: recu.metrics, dimensions: recu.dimensions, filters: recu.filters } as unknown as Requete;
      const id = executionN(lancees.size + 1);
      lancees.set(id, { requete: lancee, mode });
      const { space_id: espaceId, connection, environment, created_at: creee, started_at: demarree, deadline_at: echeance } = executionTerminee(lancee, id, "reussie");
      return route.fulfill({ status: 202, json: { id, space_id: espaceId, environment, connection, state: "running", created_at: creee, started_at: demarree, finished_at: null, deadline_at: echeance, can_cancel: true, cancel_requested: false, error_code: null, rows: null, size: null, truncated: null } });
    }
    const lancement = /^\/executions\/([^/]+)(\/result)?$/.exec(chemin);
    const connue = lancement?.[1] === undefined ? undefined : lancees.get(lancement[1]);
    if (lancement?.[1] !== undefined && connue !== undefined) {
      if (lancement[2] === undefined && reconnu("GET", "/executions/:id")) return route.fulfill({ json: executionTerminee(connue.requete, lancement[1], connue.mode) });
      if (lancement[2] !== undefined && connue.mode === "reussie" && reconnu("GET", "/executions/:id/result")) {
        journal.resultats.push(lancement[1]);
        return route.fulfill({ contentType: "application/vnd.apache.arrow.stream", body: Buffer.from(resultat(connue.requete).octets) });
      }
    }
    if (sur("/analyses") && reconnu("GET", "/analyses")) {
      const visibles = [...entrees.values()].filter((e) => e.proprietaire === MOI || (e.revisions.at(-1) as Brouillon).visibility === "shared");
      return route.fulfill({ json: {
        analyses: visibles.map((e) => {
          const dernier = e.revisions.at(-1) as Brouillon;
          return { ...fixe(lister, e.id).body.analyses[0], id: e.id, name: dernier.name, visibility: dernier.visibility, owner: { issuer: EMETTEUR, subject: e.proprietaire }, is_owner: e.proprietaire === MOI, revision: e.revisions.length, model: dernier.query.model, metrics: dernier.query.metrics, state: e.etat === "index_stale" ? "index_stale" : "indexed" };
        }),
        unreadable: reglages.illisibles ?? 0,
      } });
    }
    if (sur("/analyses") && reconnu("POST", "/analyses")) {
      const id = identifiants.shift() as string;
      const brouillonRecu = corps() as unknown as Brouillon;
      journal.creations.push(corps());
      const cree = entree(id, [brouillonRecu], { proprietaire: MOI, droits: TOUS });
      entrees.set(id, cree);
      return route.fulfill({ status: 201, json: revisionJson(cree, 1) });
    }
    const analyse = /^\/analyses\/([^/]+)(\/.*)?$/.exec(chemin);
    const courante = analyse?.[1] === undefined ? undefined : trouver(analyse[1]);
    if (analyse?.[1] !== undefined && courante !== undefined) {
      const suite = analyse[2] ?? "";
      const nombre = courante.revisions.length;
      if (suite === "" && reconnu("GET", "/analyses/:id")) return route.fulfill({ json: revisionJson(courante, nombre) });
      const numero = /^\/revisions\/([1-9]\d{0,8})$/.exec(suite);
      if (numero?.[1] !== undefined && reconnu("GET", "/analyses/:id/revisions/:n")) {
        const n = Number(numero[1]);
        return n > nombre ? refus(route, { status: 404, body: { error: { code: "analysis_not_found", reason: "unknown_revision" } } }) : route.fulfill({ json: revisionJson(courante, n) });
      }
      if (suite === "/revisions" && reconnu("GET", "/analyses/:id/revisions")) {
        return route.fulfill({ json: { ...fixe(historique, courante.id).body, current_revision: nombre, revisions: courante.revisions.map((_, i) => ({ ...fixe(historique, courante.id).body.revisions[0], revision: i + 1, actor: { issuer: EMETTEUR, subject: courante.proprietaire } })) } });
      }
      if (suite === "/revisions" && reconnu("POST", "/analyses/:id/revisions")) {
        const recu = corps();
        journal.revisions.push({ id: courante.id, corps: recu });
        const { expected_revision: attendue, ...contenu } = recu;
        if (attendue !== nombre) return refus(route, conflit);
        if (memeContenu(contenu as unknown as Brouillon, courante.revisions.at(-1) as Brouillon)) return route.fulfill({ status: 200, json: revisionJson(courante, nombre) });
        courante.revisions.push(contenu as unknown as Brouillon);
        return route.fulfill({ status: 201, json: revisionJson(courante, nombre + 1) });
      }
      if (suite === "/diff" && reconnu("GET", "/analyses/:id/diff", "base,other", { base: ENTIER, other: ENTIER })) {
        const base = Number(url.searchParams.get("base"));
        const autre = Number(url.searchParams.get("other"));
        journal.ecarts.push(`${String(base)}:${String(autre)}`);
        const avant = courante.revisions[base - 1];
        const apres = courante.revisions[autre - 1];
        if (avant === undefined || apres === undefined) { journal.inattendues.push(`écart entre r${String(base)} et r${String(autre)} d'une analyse de ${String(nombre)} révisions`); return route.abort(); }
        return route.fulfill({ json: { ...fixe(ecart, courante.id).body, base, other: autre, changes: ecarts(avant, apres) } });
      }
      if (suite === "/usage" && reconnu("GET", "/analyses/:id/usage")) return route.fulfill({ json: fixe(usage, courante.id).body });
      if (suite === "/last-execution" && reconnu("GET", "/analyses/:id/last-execution")) {
        if (courante.derniere === "aucune") return route.fulfill({ json: fixe(executionAucune, courante.id).body });
        const issue: Mode = courante.derniere === "reussie" ? "reussie" : courante.derniere === "refusee" ? "deny" : "require_human";
        return route.fulfill({ json: { id: courante.id, revision: nombre, execution: executionTerminee(requeteDe(courante.revisions[nombre - 1] as Brouillon), executionDe(courante.id), issue) } });
      }
      if (suite === "/opened" && reconnu("POST", "/analyses/:id/opened")) {
        const recu = corps();
        if (Object.keys(recu).sort().join(",") !== "event_id,revision" || typeof recu.event_id !== "string" || !UUID.test(recu.event_id) || typeof recu.revision !== "number") {
          journal.inattendues.push(`POST ${url.pathname} avec un corps hors contrat : ${JSON.stringify(recu)}`);
          return route.abort();
        }
        journal.ouvertures.push({ id: courante.id, corps: recu });
        return route.fulfill({ status: ouvrir.status, json: ouvrir.body });
      }
    }
    journal.inattendues.push(`${methode} ${url.pathname}${url.search}`);
    return route.abort();
  };
  // Une forme de requête que le simulateur ne sait pas calculer (`Refus`) est une demande hors scénario, jamais une réponse inventée.
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
    entree: (id) => entrees.get(id) as Entree,
    publierAilleurs: (id, suivant) => { (entrees.get(id) as Entree).revisions.push(suivant); },
    mode: (suivant) => { mode = suivant; },
    compte: (appel) => journal.appels.filter((fait) => fait === appel).length,
    ecritures: () => journal.appels.filter((fait) => !fait.startsWith("GET ")),
  };
}
