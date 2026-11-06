import type { ExecutionInput } from "../executions/client";
import { buildExecution } from "../explorer/filters";
import type { ExplorerModel } from "../explorer/model";
import type { Role } from "../spaces/model";
import { chartOfGenre, genreOfChart, type ExplorerGenre } from "./chart";
import { decodeAnalysisDraft, type AnalysisDocument, type AnalysisDraft, type ContextualStep, type Visibility } from "./document";
import { READ_STATE_LABELS, stepText } from "./labels";
import type { AnalysisRevision, Permissions } from "./model";

/**
 * Correspondance entre l'état de l'Explorateur et le document `board.analysis/v1` (plan 18, 18.5b). Deux
 * fonctions pures, sans appel au serveur : ce que le format ne garde pas est dit (« non sauvegardé »), ce que
 * l'Explorateur ne sait pas représenter rend la réouverture indisponible, avec sa raison. Jamais d'approximation.
 */
export type ExplorerFilter = ExecutionInput["filters"][number];

export interface ExplorerState {
  connection: string;
  model: string;
  metrics: readonly string[];
  dimensions: readonly string[];
  filters: readonly ExplorerFilter[];
  /** Type de graphique choisi dans le résultat (genre de l'Explorateur, converti par `chart.ts` seulement). */
  genre: ExplorerGenre;
  /**
   * Calculs de sélection de l'Explorateur : total et part du résultat chargé pour chaque métrique. C'est tout ce
   * que `CalculSelection` calcule ; l'état ne porte donc qu'un drapeau, jamais une liste libre d'étapes.
   */
  calculs: boolean;
}

export interface Meta {
  name: string;
  description: string;
  visibility: Visibility;
}

/** Ce que l'Explorateur porte et que le format ne garde pas, avec la raison. */
export interface Unsaved {
  what: string;
  why: string;
}

export type Built =
  | { status: "ok"; draft: AnalysisDraft; unsaved: readonly Unsaved[] }
  | { status: "invalid"; reason: string };

/** Total (agrégat sans regroupement, sur la sélection courante) puis part du résultat chargé, pour chaque métrique. */
export function selectionCalculs(metrics: readonly string[]): readonly ContextualStep[] {
  return metrics.flatMap((metric): ContextualStep[] => [
    { operation: "aggregate", metric, group_by: [], scope: null },
    { operation: "share", metric, group_by: [], denominator: "loaded_result" },
  ]);
}

/** L'environnement n'est pas dans le format : les contenus sont identiques entre environnements (A2). */
const ENVIRONMENT = "DEV";

/** Ce que l'Explorateur porte et que le format ne garde jamais : dit dans l'aperçu avant toute sauvegarde. */
export const UNSAVED: readonly Unsaved[] = [
  { what: "Sélection de lignes ou de barres", why: "le format ne garde ni sélection ni donnée (A2) ; les calculs de sélection se refont à chaque exploration" },
  { what: "Résultat et données", why: "une analyse décrit une question, jamais ses données" },
  { what: "Environnement choisi dans la coque", why: "les contenus sont identiques entre environnements (A2) : l'analyse s'exécute dans l'environnement du moment" },
  { what: "Thème d'affichage", why: "préférence de lecture, pas contenu d'analyse" },
];

/** Brouillon d'analyse tiré de l'état de l'Explorateur, relu par le décodeur strict : ce qui n'est pas valide n'est pas envoyé. */
export function draftFromExplorer(state: ExplorerState, meta: Meta, models: readonly ExplorerModel[]): Built {
  const model = models.find((item) => item.name === state.model);
  if (model === undefined) return { status: "invalid", reason: "Le modèle choisi n'est pas dans le catalogue de l'Explorateur." };
  let query: ExecutionInput;
  try {
    // Les mêmes gardes et la même normalisation que l'exécution : ce qui est sauvegardé est ce qui s'exécute.
    query = buildExecution({ connection: state.connection, environment: ENVIRONMENT, model: state.model, metrics: state.metrics, dimensions: state.dimensions, filters: state.filters }, model);
  } catch {
    return { status: "invalid", reason: "Choisissez une connexion et au moins une métrique, puis vérifiez les filtres." };
  }
  try {
    const draft = decodeAnalysisDraft({
      name: meta.name,
      description: meta.description,
      visibility: meta.visibility,
      query: { connection: query.connection, model: query.model, metrics: query.metrics, dimensions: query.dimensions, filters: query.filters },
      contextual: state.calculs ? selectionCalculs(query.metrics) : [],
      presentation: { chart: chartOfGenre(state.genre) },
    });
    return { status: "ok", draft, unsaved: UNSAVED };
  } catch (error) {
    return { status: "invalid", reason: (error as Error).message };
  }
}

/** Empreinte du contenu d'un brouillon (requête, calculs, présentation ; ni nom, ni description, ni visibilité), ou `null` quand l'état n'en fait pas un. */
export function fingerprint(built: Built): string | null {
  if (built.status !== "ok") return null;
  const { query, contextual, presentation } = built.draft;
  return JSON.stringify({ query, contextual, presentation });
}

/** La révision ouverte dans l'Explorateur : ce qu'il faut pour la référencer, la réviser et dire si l'exploration s'en est écartée. */
export interface Opened {
  id: string;
  name: string;
  description: string;
  visibility: Visibility;
  revision: number;
  currentRevision: number;
  model: string;
  permissions: Permissions;
  /** Empreinte de l'état au moment de l'ouverture. */
  baseline: string | null;
}

export function openedFrom(found: AnalysisRevision & { currentRevision: number }, state: ExplorerState, models: readonly ExplorerModel[]): Opened {
  const { analysis } = found;
  return {
    id: found.id, name: analysis.name, description: analysis.description, visibility: analysis.visibility, revision: found.revision,
    currentRevision: found.currentRevision, model: analysis.query.model, permissions: found.permissions,
    baseline: fingerprint(draftFromExplorer(state, analysis, models)),
  };
}

export interface Catalog {
  connections: readonly string[];
  models: readonly ExplorerModel[];
}

export type Reopened =
  | { status: "ok"; state: ExplorerState }
  | { status: "unavailable"; reasons: readonly string[] };

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Raisons pour lesquelles les calculs contextuels du document ne se représentent pas dans l'Explorateur (liste vide : ils se représentent). */
export function contextualBlockers(analysis: Pick<AnalysisDraft, "contextual" | "query">): readonly string[] {
  if (analysis.contextual.length === 0 || same(analysis.contextual, selectionCalculs(analysis.query.metrics))) return [];
  return analysis.contextual.map((step, index) => `Calcul contextuel ${String(index + 1)} (${stepText(step)}) : l'Explorateur ne porte que le total et la part du résultat chargé de la sélection, pour chaque métrique, sans regroupement ni périmètre filtré.`);
}

/** Ce que la lecture seule dit déjà : analyse supprimée, ou références que le catalogue ne confirme pas. */
export function statusBlockers(found: Pick<AnalysisRevision, "state" | "currentRevision">): readonly string[] {
  const reasons: string[] = [];
  if (found.currentRevision === null) reasons.push("L'analyse est supprimée : aucune action n'est possible.");
  if (found.state === "unresolved_reference" || found.state === "unverified") reasons.push(`État « ${READ_STATE_LABELS[found.state].label} » : l'Explorateur n'ouvre pas une analyse dont les références ne sont pas confirmées par le catalogue.`);
  return reasons;
}

/** Pourquoi une révision ne s'ouvre pas dans l'Explorateur, sans catalogue : état, suppression, calculs non représentables. Vide : elle peut s'ouvrir (le catalogue a encore à confirmer). */
export function openability(found: Pick<AnalysisRevision, "state" | "currentRevision" | "analysis">): readonly string[] {
  return [...statusBlockers(found), ...contextualBlockers(found.analysis)];
}

/**
 * État de l'Explorateur tiré d'un document. Tout ce que l'Explorateur ne sait pas porter fait échouer
 * l'ouverture avec sa raison : un document n'est jamais ouvert en en perdant une partie.
 */
export function explorerFromAnalysis(analysis: AnalysisDocument, catalog: Catalog): Reopened {
  const reasons: string[] = [];
  const { query } = analysis;
  if (!catalog.connections.includes(query.connection)) reasons.push(`La connexion « ${query.connection} » n'est pas offerte par l'Explorateur.`);
  const model = catalog.models.find((item) => item.name === query.model);
  if (model === undefined) reasons.push(`Le modèle « ${query.model} » n'est pas dans le catalogue de l'Explorateur.`);
  else {
    for (const name of query.metrics) if (!model.metrics.some((item) => item.name === name)) reasons.push(`La métrique « ${name} » n'est pas offerte par le modèle « ${model.name} ».`);
    for (const name of query.dimensions) if (!model.dimensions.some((item) => item.name === name)) reasons.push(`La dimension « ${name} » n'est pas offerte par le modèle « ${model.name} ».`);
  }
  // Les filtres sont relus un à un par la même vérification que l'exécution, qui les normalise (les valeurs de `in` sont triées) : l'état garde la forme exécutable.
  const filters: ExplorerFilter[] = [];
  if (model !== undefined && reasons.length === 0) {
    query.filters.forEach((filter, index) => {
      try {
        filters.push(...buildExecution({ connection: query.connection, environment: ENVIRONMENT, model: model.name, metrics: query.metrics, dimensions: query.dimensions, filters: [filter] }, model).filters);
      } catch {
        reasons.push(`Le filtre ${String(index + 1)} (${filter.column} ${filter.operator}) n'est pas représentable dans l'Explorateur : colonne absente du modèle, opérateur ou valeur hors de ce que la saisie typée admet, ou dimension temporelle (SK-12).`);
      }
    });
  }
  reasons.push(...contextualBlockers(analysis));
  if (reasons.length > 0) return { status: "unavailable", reasons };
  return {
    status: "ok",
    state: {
      connection: query.connection,
      model: query.model,
      metrics: query.metrics,
      dimensions: query.dimensions,
      filters,
      genre: genreOfChart(analysis.presentation.chart),
      calculs: analysis.contextual.length > 0,
    },
  };
}

/** Qui peut sauvegarder : créer exige creator ou admin dans l'espace (A5) ; l'écran dit pourquoi sinon. */
export function saveRight(space: { role: Role | null; implicit: boolean }): { allowed: true } | { allowed: false; reason: string } {
  if (space.implicit) return { allowed: false, reason: "En mode local, les analyses ne sont pas disponibles." };
  if (space.role === null) return { allowed: false, reason: "Vous n'avez aucun rôle dans cet espace : sauvegarder une analyse exige le rôle creator ou admin." };
  if (space.role === "reader") return { allowed: false, reason: "Sauvegarder une analyse exige le rôle creator ou admin dans l'espace ; votre rôle est reader." };
  return { allowed: true };
}
