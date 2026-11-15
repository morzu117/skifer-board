import { bounded, decodeName, decodePerson, type Person, type Scalar } from "../analyses/document";
import { exact, fail, identifier, items, pick, record, uuid } from "../analyses/shape";
import { COMMON_OPERATORS, decodeCommonValues, decodeDashboard, LIMITS, type CommonOperator, type Defaults, type LayoutNode } from "../dashboards/document";

export interface Slot { id: string; type: "slot"; expected: "visual" | "kpi"; label: string }
export interface TemplateColumn { id: string; span: number; children: readonly TemplateNode[] }
export interface TemplateRow { id: string; columns: readonly TemplateColumn[] }
export interface TemplateContainer { id: string; type: "container"; rows: readonly TemplateRow[] }
export type TemplateNode = Slot | TemplateContainer | Extract<LayoutNode, { type: "text" | "separator" }>;
export interface TemplateFilter { id: string; label: string; dimension: string; operator: CommonOperator; default?: Scalar | readonly Scalar[]; allowed?: readonly Scalar[] }
export interface PageTemplate { api_version: "board.page_template/v1"; id: string; name: string; description: string; owner: Person; defaults: Defaults; filters: readonly TemplateFilter[]; layout: { sections: readonly { id: string; title?: string; rows: readonly TemplateRow[] }[] } }

/** Projection limitée aux slots : les autres invariants de mise en page restent ceux du dashboard. */
function project(value: unknown, path: string, depth = 0): unknown {
  if (typeof value === "object" && value !== null && depth > 48) return fail(path, "profondeur bornée");
  if (Array.isArray(value)) return value.map((item, i) => project(item, `${path}[${String(i)}]`, depth + 1));
  if (typeof value !== "object" || value === null) return value;
  const found = record(value, path);
  if (found.type === "slot") {
    const slot = exact(found, ["id", "type", "expected", "label"], path);
    uuid(slot.id, `${path}.id`);
    pick(slot.expected, ["visual", "kpi"] as const, `${path}.expected`);
    bounded(slot.label, `${path}.label`, 1, LIMITS.label, false);
    return { id: slot.id, type: "separator" };
  }
  if (found.type === "analysis" || found.type === "kpi" || found.type === "component") return fail(path, "nœud de modèle");
  return Object.fromEntries(Object.entries(found).map(([key, item]) => [key, project(item, `${path}.${key}`, depth + 1)]));
}

/** Document fermé sans requête, analyse ni cibles, avec les bornes du format dashboard. */
export function decodePageTemplate(value: unknown, path = "modèle"): PageTemplate {
  const found = exact(value, ["api_version", "id", "name", "description", "owner", "defaults", "filters", "layout"], path);
  if (found.api_version !== "board.page_template/v1") return fail(`${path}.api_version`, "board.page_template/v1");
  const id = uuid(found.id, `${path}.id`);
  const name = decodeName(found.name, `${path}.name`);
  const description = bounded(found.description, `${path}.description`, 0, 2000, true);
  const owner = decodePerson(found.owner, `${path}.owner`);
  const layout = project(found.layout, `${path}.layout`);
  const checked = decodeDashboard({ api_version: "board.dashboard/v1", id, name, description, owner, visibility: "personal", defaults: found.defaults, filters: [], layout }, path);
  const ids = new Set<string>();
  const gather = (item: unknown): void => {
    if (Array.isArray(item)) { item.forEach(gather); return; }
    if (typeof item !== "object" || item === null) return;
    const object = item as Record<string, unknown>;
    if (typeof object.id === "string") ids.add(object.id);
    Object.values(object).forEach(gather);
  };
  gather(layout);
  const filters = items(found.filters, `${path}.filters`, LIMITS.filters).map((value, index): TemplateFilter => {
    const p = `${path}.filters[${String(index)}]`;
    const object = record(value, p);
    const allowed = ["id", "label", "dimension", "operator", "default", "allowed"];
    if (!Object.keys(object).every((key) => allowed.includes(key)) || !["id", "label", "dimension", "operator"].every((key) => Object.hasOwn(object, key))) return fail(p, `champs ${allowed.join(", ")}`);
    const filterId = uuid(object.id, `${p}.id`);
    if (ids.has(filterId)) return fail(`${p}.id`, "identifiant unique");
    ids.add(filterId);
    const operator = pick(object.operator, COMMON_OPERATORS, `${p}.operator`);
    const { preferred, allowed: values } = decodeCommonValues(operator, object, p);
    return { id: filterId, label: bounded(object.label, `${p}.label`, 1, LIMITS.label, false), dimension: identifier(object.dimension, `${p}.dimension`), operator, ...(preferred === undefined ? {} : { default: preferred }), ...(values === undefined ? {} : { allowed: values }) };
  });
  return { api_version: "board.page_template/v1", id, name, description, owner, defaults: checked.defaults, filters, layout: found.layout as PageTemplate["layout"] };
}
