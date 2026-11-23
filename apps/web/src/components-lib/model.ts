import { decodeSharedApproval, unchanged } from "../shared-content/model";
import { decodeSharedRevision } from "../shared-content/model";
import { bounded, decodeName, type Person } from "../analyses/document";
import { exact, fail, items, pick, revision, uuid, word } from "../analyses/shape";
import { LEGENDS, NUMBER_FORMATS, TOOLTIPS } from "../dashboards/document";
import { decodeThemeList, type IndexState, type ThemeChange, type ThemeDiff, type ThemeListItem, type ThemeState } from "../themes/model";
import { decodeComponent, type ComponentDocument } from "./document";

export { decodeThemeApprovals as decodeComponentApprovals, decodeThemeConsumers as decodeComponentConsumers, decodeThemeHistory as decodeComponentHistory, type ThemeApprovals as ComponentApprovals, type ThemeHistory as ComponentHistory } from "../themes/model";
export interface ComponentRevision { id: string; space: string; revision: number; commit: string; committedAt: Date; revisedBy: Person; state: ThemeState; approvedRevision: number | null; indexState: IndexState; component: ComponentDocument }
export function decodeComponentRevision(value: unknown, space: string): ComponentRevision {
  const { document, ...metadata } = decodeSharedRevision(value, space, "component", decodeComponent);
  return { ...metadata, component: document };
}
export interface ComponentList { components: readonly ThemeListItem[]; unreadable: number }
export function decodeComponentList(value: unknown): ComponentList {
  const f = exact(value, ["components", "unreadable"], "liste");
  const list = decodeThemeList({ themes: f.components, unreadable: f.unreadable });
  return { components: list.themes, unreadable: list.unreadable };
}
function diffValue(path: string, value: unknown): unknown {
  if (path === "/name" || path === "/presentation/title") return decodeName(value, path);
  if (path === "/description") return bounded(value, path, 0, 2000, true);
  if (path === "/owner/issuer" || path === "/owner/subject") return bounded(value, path, 1, 512, false);
  if (path === "/kind") return pick(value, ["visual", "kpi"] as const, path);
  if (path === "/analysis/analysis_id") return uuid(value, path);
  if (path === "/analysis/revision") return revision(value, path);
  if (path === "/presentation/chart") return pick(value, ["value", "bars", "line", "grouped_bars"] as const, path);
  if (path === "/presentation/legend") return pick(value, LEGENDS, path);
  if (path === "/presentation/number_format") return pick(value, NUMBER_FORMATS, path);
  if (path === "/presentation/tooltip") return pick(value, TOOLTIPS, path);
  if (path === "/presentation/threshold/label") return bounded(value, path, 1, 80, false);
  if (path === "/presentation/threshold/value") return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e15 ? value : fail(path, "nombre borné");
  if (path === "/presentation/threshold") {
    const found = exact(value, ["value", "label"], path);
    return { value: diffValue(`${path}/value`, found.value), label: diffValue(`${path}/label`, found.label) };
  }
  return fail(path, "chemin du composant");
}
function change(value: unknown, p: string): ThemeChange {
  const f = exact(value, ["path", "kind", "node", "id", "before", "after"], p);
  const path = word(f.path, `${p}.path`);
  const kind = pick(f.kind, ["added", "removed", "modified"] as const, `${p}.kind`);
  if (f.node !== null || f.id !== null) return fail(p, "écart sans nœud");
  const optional = /^\/presentation\/(?:chart|title|legend|number_format|tooltip|threshold)$/.test(path);
  if (kind !== "modified" && !optional) return fail(p, "modification de champ obligatoire");
  if (kind === "modified" && path === "/presentation/threshold") return fail(p, "différence d'une feuille");
  const before = kind === "added" ? (f.before === null ? null : fail(p, "valeur absente")) : diffValue(path, f.before);
  const after = kind === "removed" ? (f.after === null ? null : fail(p, "valeur absente")) : diffValue(path, f.after);
  if (kind === "modified" && unchanged(before, after)) return fail(p, "valeurs différentes");
  return { path, kind, node: null, id: null, before, after };
}
export type ComponentDiff = ThemeDiff;
export function decodeComponentDiff(value: unknown, id: string, base: number, other: number): ThemeDiff {
  const f = exact(value, ["id", "base", "other", "changes"], "écart");
  if (f.id !== id || f.base !== base || f.other !== other) return fail("écart", "composant et révisions demandés");
  return { id, base, other, changes: items(f.changes, "écart.changes", Number.MAX_SAFE_INTEGER).map((entry, i) => change(entry, `écart.changes[${String(i)}]`)) };
}
export interface ApprovalResult { id: string; state: "approved"; approvedRevision: number; indexState: IndexState; diff: readonly ThemeChange[] | null }
export function decodeComponentApproval(value: unknown, id: string): ApprovalResult {
  return decodeSharedApproval(value, id, change);
}
