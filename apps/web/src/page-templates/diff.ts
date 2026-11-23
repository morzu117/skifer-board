import { decodeSharedApproval, unchanged } from "../shared-content/model";
import { bounded, decodeFilterValue, decodeName } from "../analyses/document";
import { exact, fail, identifier, items, pick, uuid, word } from "../analyses/shape";
import { COMMON_OPERATORS, DEFAULT_VALUES, decodeCommonValues, decodeOwn, LIMITS } from "../dashboards/document";
import type { IndexState, ThemeChange, ThemeDiff } from "../themes/model";
import { decodePageTemplate } from "./document";

/** Genres des fragments du parcours positionnel de structured_format.diff. */
type Part = "root" | "owner" | "defaults" | "filters" | "filter" | "layout" | "sections" | "section" | "rows" | "row" | "columns" | "column" | "children" | "node" | "blocks" | "block" | "content" | "segment" | "list_items" | "segments" | "values" | "scalar" | "uuid" | "name" | "description" | "person" | "label" | "dimension" | "operator" | "default" | "span" | "node_type" | "expected" | "block_type" | "level" | "ordered" | "text" | "mark" | "default_value";
const members: Partial<Record<Part, Readonly<Record<string, Part>>>> = {
  root: { name: "name", description: "description", owner: "owner", defaults: "defaults", filters: "filters", layout: "layout" },
  owner: { issuer: "person", subject: "person" }, defaults: { legend: "default_value", number_format: "default_value", tooltip: "default_value" },
  filter: { id: "uuid", label: "label", dimension: "dimension", operator: "operator", default: "default", allowed: "values" },
  layout: { sections: "sections" }, section: { id: "uuid", title: "name", rows: "rows" }, row: { id: "uuid", columns: "columns" },
  column: { id: "uuid", span: "span", children: "children" }, node: { id: "uuid", type: "node_type", expected: "expected", label: "label", rows: "rows", blocks: "blocks" },
  block: { type: "block_type", level: "level", ordered: "ordered", content: "content", items: "list_items" }, segment: { text: "text", emphasis: "mark", strong: "mark" },
};
const sequences: Partial<Record<Part, readonly [Part, number]>> = { filters: ["filter", LIMITS.filters], sections: ["section", LIMITS.sections], rows: ["row", LIMITS.rows], columns: ["column", LIMITS.columns], children: ["node", LIMITS.children], blocks: ["block", LIMITS.blocks], content: ["segment", LIMITS.segments], list_items: ["segments", LIMITS.items], segments: ["segment", LIMITS.segments], values: ["scalar", LIMITS.values], default: ["scalar", LIMITS.values] };
function locate(path: string): Part {
  const parts = path.split("/");
  if (parts.shift() !== "" || parts.length === 0) return fail(path, "chemin du modèle");
  let current: Part = "root";
  let levels = 0;
  for (const segment of parts) {
    const seq: readonly [Part, number] | undefined = sequences[current];
    const next: Part | undefined = seq === undefined ? members[current]?.[segment] : /^(0|[1-9]\d*)$/.test(segment) && Number(segment) < seq[1] ? seq[0] : undefined;
    if (next === undefined) return fail(path, "chemin du modèle");
    if (next === "rows" && ++levels > LIMITS.levels) return fail(path, "profondeur bornée");
    current = next;
  }
  return current;
}
/** Les fragments complets réutilisent le décodeur du modèle, sans collision avec ses identifiants. */
function subtree(part: Part, value: unknown, path: string): unknown {
  const raw = JSON.stringify({ value });
  let counter = 1;
  const fresh = (): string => {
    let id: string;
    do { id = `00000000-0000-4000-8000-${(counter++).toString(16).padStart(12, "0")}`; } while (raw.includes(id));
    return id;
  };
  const column = (children: unknown) => ({ id: fresh(), span: 12, children });
  const row = (columns: unknown) => ({ id: fresh(), columns });
  const section = (rows: unknown) => ({ id: fresh(), rows });
  let sections: unknown = [];
  let filters: unknown = [];
  if (part === "filter") filters = [value];
  else if (part === "section") sections = [value];
  else {
    let rows: unknown = part === "rows" ? value : part === "row" ? [value] : part === "column" ? [row([value])] : [row([column([value])])];
    const depth = (path.split("/rows/").length - 1) - (part === "rows" ? 0 : 1);
    for (let i = 0; i < depth; i += 1) rows = [row([column([{ id: fresh(), type: "container", rows }])])];
    sections = [section(rows)];
  }
  decodePageTemplate({ api_version: "board.page_template/v1", id: fresh(), name: "Modèle", description: "", owner: { issuer: "client", subject: "client" }, defaults: {}, filters, layout: { sections } });
  return value;
}
function textFragment(part: Part, value: unknown, path: string): unknown {
  const blocks = part === "block" ? [value] : part === "segment" ? [{ type: "paragraph", content: [value] }] : part === "segments" ? [{ type: "list", ordered: false, items: [value] }] : part === "content" ? [{ type: "paragraph", content: value }] : part === "list_items" ? [{ type: "list", ordered: false, items: value }] : value;
  decodeOwn("text", { type: "text", blocks }, path, true);
  return value;
}
function valueOf(part: Part, value: unknown, path: string): unknown {
  switch (part) {
    case "section": case "row": case "column": case "node": case "filter": case "rows": return subtree(part, value, path);
    case "block": case "segment": case "segments": case "blocks": case "content": case "list_items": return textFragment(part, value, path);
    case "uuid": return uuid(value, path);
    case "name": return decodeName(value, path);
    case "description": return bounded(value, path, 0, 2000, true);
    case "person": return bounded(value, path, 1, 512, false);
    case "label": return bounded(value, path, 1, LIMITS.label, false);
    case "text": return bounded(value, path, 1, LIMITS.segment, false);
    case "dimension": return identifier(value, path);
    case "operator": return pick(value, COMMON_OPERATORS, path);
    case "expected": return pick(value, ["visual", "kpi"] as const, path);
    case "node_type": return pick(value, ["slot", "container", "text", "separator"] as const, path);
    case "block_type": return pick(value, ["heading", "paragraph", "list"] as const, path);
    case "default_value": return (DEFAULT_VALUES[path] as (value: unknown, path: string) => unknown)(value, path);
    case "span": case "level": return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= (part === "span" ? LIMITS.grid : 2) ? value : fail(path, "entier borné");
    case "ordered": return typeof value === "boolean" ? value : fail(path, "booléen");
    case "mark": return value === true ? value : fail(path, "true");
    case "scalar": return decodeFilterValue("eq", value, path);
    case "values": return decodeFilterValue("in", value, path);
    case "default": {
      if (!Array.isArray(value)) return decodeFilterValue("eq", value, path);
      if (new Set(value).size !== value.length) return decodeCommonValues("between", { default: value }, path).preferred;
      return decodeFilterValue("in", value, path);
    }
    default: return fail(path, "feuille ou élément ajouté du modèle");
  }
}
function change(value: unknown, p: string): ThemeChange {
  const f = exact(value, ["path", "kind", "node", "id", "before", "after"], p);
  const path = word(f.path, `${p}.path`);
  const part = locate(path);
  const kind = pick(f.kind, ["added", "removed", "modified"] as const, `${p}.kind`);
  if (f.node !== null || f.id !== null) return fail(p, "écart sans nœud");
  const isElement = /\/\d+$/.test(path);
  const slash = path.lastIndexOf("/");
  const field = path.slice(slash + 1);
  const parentPath = path.slice(0, slash);
  const parent = parentPath === "" ? "root" : locate(parentPath);
  const optional = (parent === "section" && field === "title")
    || (parent === "filter" && ["default", "allowed"].includes(field))
    || (parent === "defaults" && ["legend", "number_format", "tooltip"].includes(field))
    || (parent === "segment" && ["emphasis", "strong"].includes(field))
    || (parent === "node" && ["expected", "label", "rows", "blocks"].includes(field))
    || (parent === "block" && ["content", "items", "level", "ordered"].includes(field));
  if (kind !== "modified" && !isElement && !optional) return fail(p, "modification de champ obligatoire");
  if (kind === "modified" && ["section", "row", "column", "node", "filter", "block", "segment", "segments", "blocks", "rows", "content", "list_items", "values"].includes(part)) return fail(p, "différence d’une feuille");
  const before = kind === "added" ? (f.before === null ? null : fail(p, "valeur absente")) : valueOf(part, f.before, path);
  const after = kind === "removed" ? (f.after === null ? null : fail(p, "valeur absente")) : valueOf(part, f.after, path);
  // JSON ne conserve pas la distinction Python entre 1 et 1.0 dans les valeurs de filtre.
  if (kind === "modified" && unchanged(before, after)) return fail(p, "valeurs différentes");
  return { path, kind, node: null, id: null, before, after };
}
export type PageTemplateDiff = ThemeDiff;
export function decodePageTemplateDiff(value: unknown, id: string, base: number, other: number): PageTemplateDiff {
  const f = exact(value, ["id", "base", "other", "changes"], "écart");
  if (f.id !== id || f.base !== base || f.other !== other) return fail("écart", "modèle et révisions demandés");
  return { id, base, other, changes: items(f.changes, "écart.changes", Number.MAX_SAFE_INTEGER).map((entry, i) => change(entry, `écart.changes[${String(i)}]`)) };
}
export interface ApprovalResult { id: string; state: "approved"; approvedRevision: number; indexState: IndexState; diff: readonly ThemeChange[] | null }
export function decodePageTemplateApproval(value: unknown, id: string): ApprovalResult {
  return decodeSharedApproval(value, id, change);
}
