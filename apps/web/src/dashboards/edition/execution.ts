import { type AnalysisFilter } from "../../analyses/document";
import type { AnalysisRevision } from "../../analyses/model";
import { ContractError } from "../../catalogue/decode";
import type { ExecutionInput } from "../../executions/client";
import type { Environment } from "../../shell/sections";
import { decodeCommonValues, type CommonFilter, type ExecutableComponent } from "../document";
import type { Tile, TileReason } from "../model";

/** Raisons fermées empêchant la construction d'une soumission. */
export type ExecutionRefusal = TileReason | "unverified" | "too_many_filters" | "invalid_filter_value" | "reference_mismatch" | "tile_mismatch";
/** Soumission avec ses recouvrements, ou indisponibilité sans soumission partielle. */
export type ComposedExecution =
  | { status: "ready"; input: ExecutionInput; overlaps: readonly string[] }
  | { status: "unavailable"; reason: ExecutionRefusal };

/**
 * Compose une tuile avec les filtres qui la ciblent. L'environnement vient de la coque ; les valeurs de travail
 * `undefined` reprend le défaut ; `null` efface explicitement le filtre. La référence et l'identité de la tuile sont vérifiées avant toute composition.
 */
export function composeExecution(component: ExecutableComponent, revision: AnalysisRevision, filters: readonly CommonFilter[], values: Readonly<Record<string, unknown>>, tile: Tile, environment: Environment): ComposedExecution {
  if (tile.id !== component.id) return { status: "unavailable", reason: "tile_mismatch" };
  if (tile.state === "unavailable") return { status: "unavailable", reason: tile.reason };
  if (tile.state === "unverified") return { status: "unavailable", reason: "unverified" };
  if (revision.id !== component.reference.analysis_id || revision.revision !== component.reference.revision) return { status: "unavailable", reason: "reference_mismatch" };
  if (revision.state === "unverified" || revision.state === "unresolved_reference") return { status: "unavailable", reason: revision.state };
  const query = revision.analysis.query;
  const additions: AnalysisFilter[] = [];
  const overlaps = new Set<string>();
  for (const filter of filters) {
    if (!filter.targets.includes(component.id)) continue;
    const working = values[filter.id];
    const value = working === undefined ? filter.default : working;
    if (value === undefined || value === null) continue;
    try {
      additions.push({ column: filter.dimension, operator: filter.operator, value: decodeCommonValues(filter.operator, { ...filter, default: value }, `filtre.${filter.id}`).preferred as AnalysisFilter["value"] });
    } catch (error) {
      if (!(error instanceof ContractError)) throw error;
      return { status: "unavailable", reason: "invalid_filter_value" };
    }
    if (query.filters.some((existing) => existing.column === filter.dimension)) overlaps.add(filter.dimension);
  }
  if (query.filters.length + additions.length > 32) return { status: "unavailable", reason: "too_many_filters" };
  return {
    status: "ready",
    input: { ...query, environment, filters: [...query.filters, ...additions], analysis: { id: revision.id, revision: revision.revision } },
    overlaps: [...overlaps],
  };
}
