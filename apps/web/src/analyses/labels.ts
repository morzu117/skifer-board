import type { BadgeTone } from "../ui/Badge";
import { genreOfChart, type ExplorerGenre } from "./chart";
import type { ChartKind, FilterOperator, Visibility } from "./document";
import type { ListState, ReadState } from "./model";
import type { REFERENCE_RULES } from "./refusal";

/**
 * Libellés des écrans d'analyses (plan 18, 18.5a). Chaque table est indexée par une union fermée du
 * contrat : une valeur nouvelle du serveur ne compile pas sans libellé, et le décodeur refuse déjà
 * toute valeur hors domaine, donc aucun libellé n'est inventé pour ce qu'on ne connaît pas.
 */
export interface StateLabel {
  label: string;
  tone: BadgeTone;
  /** Ce que l'état veut dire, affiché avec lui : un état n'est jamais montré sans sa raison. */
  reason: string;
}

export const READ_STATE_LABELS: Readonly<Record<ReadState, StateLabel>> = {
  index_stale: {
    label: "Index en retard",
    tone: "warning",
    reason: "L'index de la base est en retard sur le dépôt : le contenu affiché vient du dépôt (git) et la liste peut être en retard. Les actions offertes restent celles que le serveur accorde.",
  },
  unverified: {
    label: "Non vérifiée",
    tone: "warning",
    reason: "Le catalogue sémantique n'a pas pu être lu : les références de la requête ne sont ni confirmées ni infirmées.",
  },
  unresolved_reference: {
    label: "Référence non résolue",
    tone: "danger",
    reason: "Le catalogue ne confirme pas certains éléments de la requête (la règle de chacun est indiquée). Ils sont montrés tels qu'enregistrés : rien n'est remplacé ni deviné, et l'analyse ne s'exécute pas par approximation.",
  },
  ready: {
    label: "Prête",
    tone: "success",
    reason: "Les références de la requête existent dans le catalogue de l'espace.",
  },
};

export const LIST_STATE_LABELS: Readonly<Record<ListState, StateLabel>> = {
  indexed: { label: "Indexée", tone: "success", reason: "L'index correspond au dépôt." },
  index_stale: { label: READ_STATE_LABELS.index_stale.label, tone: "warning", reason: "L'index ne correspond plus au dépôt : cette ligne peut être périmée, relisez la fiche." },
};

export const RULE_LABELS: Readonly<Record<(typeof REFERENCE_RULES)[number], string>> = {
  unknown_connection: "Connexion introuvable dans le catalogue",
  unknown_model: "Modèle introuvable dans le catalogue",
  unknown_metric: "Métrique introuvable dans le catalogue",
  unknown_dimension: "Dimension introuvable dans le catalogue",
  filter_not_allowed: "Filtre non permis (colonne, opérateur ou valeur)",
};

export const VISIBILITY_LABELS: Readonly<Record<Visibility, string>> = { personal: "Personnelle", shared: "Partagée" };

export const OPERATOR_LABELS: Readonly<Record<FilterOperator, string>> = {
  eq: "égal à", ne: "différent de", gt: "supérieur à", gte: "supérieur ou égal à", lt: "inférieur à", lte: "inférieur ou égal à", in: "parmi", between: "entre",
};

export const OPERATION_LABELS = { aggregate: "Agrégat", share: "Part" } as const;
export const SCOPE_LABELS = { filtered_perimeter: "périmètre filtré" } as const;
export const DENOMINATOR_LABELS = { loaded_result: "résultat chargé", filtered_perimeter: "périmètre filtré" } as const;

const GENRE_LABELS: Readonly<Record<ExplorerGenre, string>> = { valeur: "Valeur", barres: "Barres", ligne: "Ligne", groupees: "Barres groupées" };

/** Libellé de l'Explorateur pour un type de graphique du schéma, par la table fermée de `chart.ts`. */
export function chartLabel(chart: ChartKind): string {
  return GENRE_LABELS[genreOfChart(chart)];
}

export const CHANGE_LABELS = { added: "Ajouté", removed: "Retiré", modified: "Modifié" } as const;
export const ACTION_LABELS = { save: "Sauvegarde", delete: "Suppression" } as const;
export const USAGE_LABELS = { saved: "Sauvegardes", opened: "Ouvertures", executed: "Exécutions" } as const;

/** Lecture d'un pointeur JSON (`/query/metrics/0`) dans un document, ou `null` si le chemin n'y mène pas. */
export function valueAt(document: unknown, pointer: string): unknown {
  let at: unknown = document;
  for (const part of pointer.split("/").slice(1)) {
    if (typeof at !== "object" || at === null || !Object.hasOwn(at, part)) return null;
    at = (at as Record<string, unknown>)[part];
  }
  return at;
}
