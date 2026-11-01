/**
 * Sélection dans un graphique : un événement typé, réduit par une fonction pure, traduisible en
 * argument `selection` de l'opération `aggregate` de `skifer_board.contextual` (plan 02, W9).
 */

/** Ce qu'un graphique émet quand le lecteur agit sur un élément. */
export type SelectionEvent =
  | { type: "toggle"; source: string; dimension: string; key: string }
  | { type: "replace"; source: string; dimension: string; key: string }
  | { type: "clear"; source: string };

/** Sélection courante : des valeurs d'une dimension, issues d'une vue source. */
export interface Selection {
  source: string;
  dimension: string;
  keys: readonly string[];
}

export function reduceSelection(state: Selection | null, event: SelectionEvent): Selection | null {
  if (event.type === "clear") {
    return null;
  }
  const sameAxis = state !== null && state.source === event.source && state.dimension === event.dimension;
  if (event.type === "replace" || !sameAxis) {
    return { source: event.source, dimension: event.dimension, keys: [event.key] };
  }
  const keys = state.keys.includes(event.key) ? state.keys.filter((key) => key !== event.key) : [...state.keys, event.key];
  return keys.length === 0 ? null : { ...state, keys };
}

export function isSelected(selection: Selection | null, dimension: string, key: string): boolean {
  return selection !== null && selection.dimension === dimension && selection.keys.includes(key);
}

/** Argument `selection` d'`aggregate` : `Mapping[str, Sequence[Any]]`. */
export function toContextualSelection(selection: Selection | null): Record<string, string[]> | null {
  return selection === null ? null : { [selection.dimension]: [...selection.keys] };
}

/** Demande de calcul contextuel que Board adresse à sa couche de calcul pour une sélection. */
export interface ContextualRequest {
  operation: "aggregate" | "share_of_total";
  metric: string;
  group_by: string[];
  selection: Record<string, string[]> | null;
  scope: "selection" | "loaded_result" | "filtered_perimeter";
}

/** Total de la sélection pour une métrique : `aggregate(result, metric, selection=…)`. */
export function selectionTotalRequest(selection: Selection, metric: string): ContextualRequest {
  return { operation: "aggregate", metric, group_by: [], selection: toContextualSelection(selection), scope: "selection" };
}
