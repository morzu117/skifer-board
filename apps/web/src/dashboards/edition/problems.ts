import { CHART_KINDS, type ChartKind } from "../../analyses/document";
import type { AnalysisRevision } from "../../analyses/model";
import { validateExecutionFilters, OPERATORS } from "../../explorer/filters";
import type { ExplorerModel } from "../../explorer/model";
import { LIMITS, type DashboardDraft, type ExecutableComponent, type Row } from "../document";
import type { Tile } from "../model";

/** Codes fermés des problèmes calculés sans appel au serveur. */
export type ProblemCode = "analysis_unavailable" | "unresolved_reference" | "unverified" | "filter_without_target" | "filter_incompatible" | "limit_reached" | "revision_behind" | "kpi_incompatible" | "chart_incompatible";
/** Un avertissement ne bloque pas l'enregistrement ; un problème bloquant l'empêche. */
export type Problem = { code: ProblemCode; severity: "blocking" | "warning"; nodeId: string; path: string; pinned?: number; current?: number; limit?: string };
/** Révision épinglée connue et dernière révision connue, par identifiant de composant. */
export type KnownAnalyses = Readonly<Record<string, { pinned: AnalysisRevision; current: number | null } | undefined>>;

/** Types de graphiques compatibles avec le nombre de dimensions de la requête. */
export function compatibleCharts(dimensions: number): readonly ChartKind[] {
  return CHART_KINDS.filter((chart) => chart !== "value" || dimensions === 0);
}

/**
 * Les analyses indisponibles, filtres incompatibles et présentations incompatibles bloquent l’enregistrement.
 * Une référence non résolue est un avertissement : le serveur accepte la sauvegarde mais la tuile reste indisponible.
 * Pour chaque borne, la valeur égale au maximum est un avertissement ; au-delà, le problème est bloquant.
 * Les révisions dépassées et états invérifiables sont des avertissements ; un catalogue ou une
 * analyse inconnus ne permettent pas de conclure à une incompatibilité.
 */
export function dashboardProblems(document: DashboardDraft, tiles: readonly Tile[], analyses: KnownAnalyses, catalog: readonly ExplorerModel[] | null): readonly Problem[] {
  const problems: Problem[] = [];
  const components = new Map<string, { node: ExecutableComponent; path: string }>();
  let nodes = 0;
  let count = 0;
  let executable = 0;
  function add(code: ProblemCode, severity: Problem["severity"], nodeId: string, path: string): void {
    problems.push({ code, severity, nodeId, path });
  }
  function limit(length: number, max: number, id: string, path: string, name = path): void {
    if (length >= max) problems.push({ code: "limit_reached", severity: length > max ? "blocking" : "warning", nodeId: id, path, limit: name });
  }
  function rows(list: readonly Row[], path: string, parent: string): void {
    limit(list.length, LIMITS.rows, parent, path);
    list.forEach((row, rowIndex) => {
      nodes += 1;
      const rowPath = `${path}/${String(rowIndex)}`;
      limit(row.columns.length, LIMITS.columns, row.id, `${rowPath}/columns`);
      row.columns.forEach((column, columnIndex) => {
        nodes += 1;
        const columnPath = `${rowPath}/columns/${String(columnIndex)}`;
        limit(column.children.length, LIMITS.children, column.id, `${columnPath}/children`);
        column.children.forEach((child, childIndex) => {
          nodes += 1;
          const childPath = `${columnPath}/children/${String(childIndex)}`;
          if (child.type === "container") rows(child.rows, `${childPath}/rows`, child.id);
          else {
            count += 1;
            if (child.type === "analysis" || child.type === "kpi") {
              executable += 1;
              components.set(child.id, { node: child, path: childPath });
            }
          }
        });
      });
    });
  }
  limit(document.layout.sections.length, LIMITS.sections, "dashboard", "/layout/sections");
  limit(document.filters.length, LIMITS.filters, "dashboard", "/filters");
  document.layout.sections.forEach((section, index) => {
    nodes += 1;
    rows(section.rows, `/layout/sections/${String(index)}/rows`, section.id);
  });
  limit(nodes, LIMITS.nodes, "dashboard", "/layout", "nodes");
  limit(count, LIMITS.components, "dashboard", "/layout", "components");
  limit(executable, LIMITS.executable, "dashboard", "/layout", "executable");
  for (const [id, { node, path }] of components) {
    const tile = tiles.find((item) => item.id === id);
    if (tile?.state === "unavailable") add(tile.reason, tile.reason === "unresolved_reference" ? "warning" : "blocking", id, `${path}/reference`);
    if (tile?.state === "unverified") add("unverified", "warning", id, `${path}/reference`);
    const known = analyses[id];
    if (!known) continue;
    const targeted = document.filters.filter((filter) => filter.targets.includes(id)).length;
    limit(known.pinned.analysis.query.filters.length + targeted, LIMITS.filters, id, path, "tile_filters");
    if (known.pinned.state === "unresolved_reference") add("unresolved_reference", "warning", id, `${path}/reference`);
    if (known.pinned.state === "unverified") add("unverified", "warning", id, `${path}/reference`);
    if (known.current !== null && known.current > node.reference.revision) problems.push({ code: "revision_behind", severity: "warning", nodeId: id, path: `${path}/reference`, pinned: node.reference.revision, current: known.current });
    if (node.type === "analysis" && node.presentation.chart !== undefined && !compatibleCharts(known.pinned.analysis.query.dimensions.length).includes(node.presentation.chart)) add("chart_incompatible", "blocking", id, `${path}/presentation/chart`);
    if (node.type === "kpi" && (known.pinned.analysis.presentation.chart !== "value" || known.pinned.analysis.query.dimensions.length > 0)) add("kpi_incompatible", "blocking", id, `${path}/reference`);
  }
  document.filters.forEach((filter, index) => {
    const path = `/filters/${String(index)}`;
    if (filter.targets.length === 0) add("filter_without_target", "blocking", filter.id, `${path}/targets`);
    limit(filter.targets.length, LIMITS.targets, filter.id, `${path}/targets`);
    let firstType: string | undefined;
    filter.targets.forEach((target, targetIndex) => {
      const known = analyses[target];
      if (!known || catalog === null) return;
      const query = known.pinned.analysis.query;
      const model = catalog.find((item) => item.name === query.model);
      const dimension = model?.dimensions.find((item) => item.name === filter.dimension);
      let incompatible = dimension === undefined || !OPERATORS[dimension.type].includes(filter.operator);
      if (model) {
        const probes = [
          ...(filter.default === undefined ? [] : [{ column: filter.dimension, operator: filter.operator, value: filter.default }]),
          ...(filter.allowed ?? []).map((value) => ({ column: filter.dimension, operator: "eq" as const, value })),
        ];
        try {
          probes.forEach((probe) => { validateExecutionFilters([probe], model); });
        } catch {
          incompatible = true;
        }
      }
      if (!incompatible && dimension !== undefined) {
        if (firstType === undefined) firstType = dimension.type;
        else if (firstType !== dimension.type) incompatible = true;
      }
      if (incompatible) add("filter_incompatible", "blocking", filter.id, `${path}/targets/${String(targetIndex)}`);
    });
  });
  return problems;
}
