import { ContractError } from "../../catalogue/decode";
import { decodeDashboard, decodeDashboardDraft, type DashboardDocument, type DashboardDraft, type CommonFilter, type Defaults, type KpiPresentation, type VisualPresentation } from "../document";

/** Document complet ou brouillon décodé. */
export type Document = DashboardDocument | DashboardDraft;
/** Genres de nœuds de la mise en page. */
export type Kind = "section" | "row" | "column" | "container" | "analysis" | "kpi" | "text" | "separator";
/** Une commande modifie une copie, jamais le document fourni. */
export type SimpleCommand =
  | { type: "add"; kind: Kind; parent: string | null; index: number; value?: object }
  | { type: "move"; id: string; parent: string | null; index: number }
  | { type: "resize"; id: string; span: number }
  | { type: "delete"; id: string }
  | { type: "add_filter"; value: Omit<CommonFilter, "id"> }
  | { type: "update_filter"; id: string; value: Partial<Omit<CommonFilter, "id">>; remove?: readonly ("default" | "allowed")[] }
  | { type: "delete_filter"; id: string }
  | { type: "adopt_revision"; id: string; revision: number }
  | { type: "update_blocks"; id: string; blocks: unknown }
  | { type: "update"; id: string | null; property: "title" | "presentation" | "name" | "description" | "visibility" | "defaults"; value: unknown };
/** Une liste atomique ne peut contenir que des commandes simples. */
export type Command = SimpleCommand | { type: "batch"; commands: readonly SimpleCommand[] };
/** Cibles retirées et filtres supprimés par les suppressions de nœuds. */
export interface Removed { filters: readonly CommonFilter[]; targets: readonly { filterId: string; targets: readonly string[] }[] }
/** Les refus propres à l'éditeur ; le décodeur détaille un document invalide. */
export type Refusal = "not_found" | "incompatible_parent" | "invalid_index" | "invalid_property" | "invalid_document";
/** Résultat d'une commande, avec le document initial en cas de refus. */
export type Result<T extends Document> = { ok: true; document: T; removed?: Removed } | { ok: false; reason: Refusal; detail?: string; index?: number; document: T };
type MutableNode = { id: string; type?: string; rows?: MutableNode[]; columns?: MutableNode[]; children?: MutableNode[]; [key: string]: unknown };
type Location = { node: MutableNode; list: MutableNode[]; kind: Kind };
type Context = { sections: MutableNode[]; document: Document; removed: { filters: CommonFilter[]; targets: { filterId: string; targets: string[] }[] }; deleted: boolean };

function locate(list: MutableNode[], id: string, kind: "section" | "row" | "column" | "node"): Location | undefined {
  for (const node of list) {
    const actual = kind === "node" ? node.type as Kind : kind;
    if (node.id === id) return { node, list, kind: actual };
    let found: Location | undefined;
    if (node.rows) found = locate(node.rows, id, "row");
    if (node.columns) found = locate(node.columns, id, "column");
    if (node.children) found = locate(node.children, id, "node");
    if (found) return found;
  }
  return undefined;
}

function childList(sections: MutableNode[], parent: string | null, kind: Kind): MutableNode[] | Refusal {
  if (parent === null) return kind === "section" ? sections : "incompatible_parent";
  const found = locate(sections, parent, "section");
  if (!found) return "not_found";
  if (kind === "row" && (found.kind === "section" || found.kind === "container")) return found.node.rows as MutableNode[];
  if (kind === "column" && found.kind === "row") return found.node.columns as MutableNode[];
  if (["container", "analysis", "kpi", "text", "separator"].includes(kind) && found.kind === "column") return found.node.children as MutableNode[];
  return "incompatible_parent";
}

function newNode(kind: Kind, id: string, value: object | undefined): MutableNode {
  let base: object;
  switch (kind) {
    case "section":
      base = { rows: [] };
      break;
    case "row":
      base = { columns: [] };
      break;
    case "column":
      base = { span: 12, children: [] };
      break;
    case "container":
      base = { type: kind, rows: [] };
      break;
    case "text":
      base = { type: kind, blocks: [] };
      break;
    default: base = { type: kind };
  }
  if (["section", "row", "column"].includes(kind)) return { ...base, ...value, id };
  return { ...base, ...value, type: kind, id };
}

function validIndex(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index <= length;
}

function add(context: Context, command: Extract<Command, { type: "add" }>, uuid: () => string): Refusal | undefined {
  const list = childList(context.sections, command.parent, command.kind);
  if (typeof list === "string") return list;
  if (!validIndex(command.index, list.length)) return "invalid_index";
  list.splice(command.index, 0, newNode(command.kind, uuid(), command.value));
  return undefined;
}

function move(context: Context, found: Location, command: Extract<Command, { type: "move" }>): Refusal | undefined {
  if (command.parent !== null && locate([found.node], command.parent, "node")) return "incompatible_parent";
  found.list.splice(found.list.indexOf(found.node), 1);
  const list = childList(context.sections, command.parent, found.kind);
  if (typeof list === "string") return list;
  if (!validIndex(command.index, list.length)) return "invalid_index";
  list.splice(command.index, 0, found.node);
  return undefined;
}

function resize(found: Location, command: Extract<Command, { type: "resize" }>): Refusal | undefined {
  if (found.kind !== "column") return "invalid_property";
  found.node.span = command.span;
  return undefined;
}

function remove(context: Context, found: Location): void {
  found.list.splice(found.list.indexOf(found.node), 1);
  const ids = new Set<string>();
  function collect(node: MutableNode): void {
    ids.add(node.id);
    (node.rows ?? node.columns ?? node.children ?? []).forEach(collect);
  }
  collect(found.node);
  context.deleted = true;
  context.document.filters = context.document.filters.flatMap((filter) => {
    const targets = filter.targets.filter((target) => !ids.has(target));
    if (targets.length === 0) {
      context.removed.filters.push(filter);
      return [];
    }
    const removed = filter.targets.filter((target) => ids.has(target));
    if (removed.length > 0) context.removed.targets.push({ filterId: filter.id, targets: removed });
    return [{ ...filter, targets }];
  });
}

function update(context: Context, command: Extract<Command, { type: "update" }>, found?: Location): Refusal | undefined {
  if (command.id === null) {
    if (!["name", "description", "visibility", "defaults"].includes(command.property)) return "invalid_property";
    Object.assign(context.document, { [command.property]: command.value });
    return undefined;
  }
  const target = found as Location;
  const title = command.property === "title" && target.kind === "section";
  const presentation = command.property === "presentation" && (target.kind === "analysis" || target.kind === "kpi");
  if (!title && !presentation) return "invalid_property";
  if (command.value === undefined && title) delete target.node.title;
  else target.node[command.property] = command.value;
  return undefined;
}

function execute(context: Context, command: SimpleCommand, uuid: () => string): Refusal | undefined {
  if (command.type === "add_filter") {
    context.document.filters = [...context.document.filters, { ...command.value, id: uuid() }];
    return undefined;
  }
  if (command.type === "update_filter" || command.type === "delete_filter") {
    const filter = context.document.filters.find((item) => item.id === command.id);
    if (!filter) return "not_found";
    if (command.type === "delete_filter") context.document.filters = context.document.filters.filter((item) => item.id !== command.id);
    else context.document.filters = context.document.filters.map((item) => {
      if (item.id !== command.id) return item;
      const updated = { ...item, ...command.value, id: item.id };
      if (command.remove?.includes("default")) delete updated.default;
      if (command.remove?.includes("allowed")) delete updated.allowed;
      return updated;
    });
    return undefined;
  }
  if (command.type === "add") return add(context, command, uuid);
  if (command.type === "update" && command.id === null) return update(context, command);
  const found = locate(context.sections, command.id as string, "section");
  if (!found) return "not_found";
  switch (command.type) {
    case "move": return move(context, found, command);
    case "resize": return resize(found, command);
    case "delete":
      remove(context, found);
      return undefined;
    case "update": return update(context, command, found);
    case "adopt_revision":
      if (found.kind !== "analysis" && found.kind !== "kpi") return "invalid_property";
      found.node.reference = { ...(found.node.reference as object), revision: command.revision };
      return undefined;
    case "update_blocks":
      if (found.kind !== "text") return "invalid_property";
      found.node.blocks = command.blocks;
      return undefined;
  }
}

/**
 * Applique une commande sur une copie, validée par le décodeur. Un batch est validé à la fin : un refus de
 * validation porte le premier index depuis lequel la violation finale persiste. Les UUID produits dans l'ordre par le générateur injectable peuvent être
 * connus à l'avance et réutilisés par les commandes suivantes du batch.
 */
export function applyCommand<T extends Document>(document: T, command: Command, uuid: () => string = () => crypto.randomUUID()): Result<T> {
  const copy = structuredClone(document);
  const sections = copy.layout.sections as unknown as MutableNode[];
  const context: Context = { sections, document: copy, removed: { filters: [], targets: [] }, deleted: false };
  const commands = command.type === "batch" ? command.commands : [command];
  let invalid: { detail: string; index: number } | undefined;
  for (const [index, item] of commands.entries()) {
    const refusal = (item as Command).type === "batch" ? "invalid_property" : execute(context, item, uuid);
    if (refusal) return { ok: false, reason: refusal, document, ...(command.type === "batch" ? { index } : {}) };
    if (command.type === "batch") {
      try {
        if ("api_version" in copy) decodeDashboard(copy);
        else decodeDashboardDraft(copy);
        invalid = undefined;
      } catch (error) {
        if (!(error instanceof ContractError)) throw error;
        if (invalid?.detail !== error.message) invalid = { detail: error.message, index };
      }
    }
  }
  try {
    const decoded = "api_version" in copy ? decodeDashboard(copy) : decodeDashboardDraft(copy);
    return { ok: true, document: decoded as T, ...(context.deleted ? { removed: context.removed } : {}) };
  } catch (error) {
    if (!(error instanceof ContractError)) throw error;
    return { ok: false, reason: "invalid_document", detail: error.message, document, ...(command.type === "batch" ? { index: invalid?.index ?? Math.max(0, commands.length - 1) } : {}) };
  }
}

/** États précédents, courant, rétablissables et dernier état enregistré. */
export interface History<T extends Document> { past: readonly T[]; present: T; future: readonly T[]; saved: T }
/** Crée un historique dont le document est déjà enregistré. */
export const createHistory = <T extends Document>(document: T): History<T> => ({ past: [], present: document, future: [], saved: document });
/** Applique une commande et ne conserve que les cent derniers états. */
export function dispatch<T extends Document>(history: History<T>, command: Command, uuid?: () => string): { history: History<T>; result: Result<T> } {
  const result = applyCommand(history.present, command, uuid);
  if (!result.ok || JSON.stringify(result.document) === JSON.stringify(history.present)) return { history, result };
  return { history: { ...history, past: [...history.past, history.present].slice(-99), present: result.document, future: [] }, result };
}
/** Revient à l'état précédent s'il existe. */
export function undo<T extends Document>(history: History<T>): History<T> {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return { ...history, past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}
/** Rétablit l'état suivant s'il existe. */
export function redo<T extends Document>(history: History<T>): History<T> {
  const next = history.future[0];
  if (next === undefined) return history;
  return { ...history, past: [...history.past, history.present], present: next, future: history.future.slice(1) };
}
/** Marque l'état courant comme enregistré. */
export const markSaved = <T extends Document>(history: History<T>): History<T> => ({ ...history, saved: history.present });
/** Indique si le document diffère de l'état enregistré. */
export const isDirty = <T extends Document>(history: History<T>): boolean => JSON.stringify(history.present) !== JSON.stringify(history.saved);

/** Niveau d'origine d'une valeur de présentation. */
export type Origin = "theme" | "analysis" | "dashboard" | "component";
/** Valeurs effectives et leur origine, champ par champ. */
export type Resolved<T> = { [K in keyof T]-?: { value: T[K] | undefined; origin: Origin } };
/** Valeurs issues de l'analyse épinglée, indépendantes du thème. */
export type AnalysisPresentation = { chart: NonNullable<VisualPresentation["chart"]>; title: string };
/** Défauts de présentation autorisés dans le document. */
export type PresentationDefaults = Defaults;
function resolve<T extends object>(keys: readonly (keyof T)[], theme: Partial<T>, analysis: Partial<T>, defaults: Partial<T>, component: Partial<T>): Resolved<T> {
  const all = new Set([...keys, ...Object.keys(theme), ...Object.keys(analysis), ...Object.keys(defaults), ...Object.keys(component)] as (keyof T)[]);
  return Object.fromEntries([...all].map((field) => {
    let origin: Origin = "theme";
    let value = theme[field];
    if (analysis[field] !== undefined) { origin = "analysis"; value = analysis[field]; }
    if (defaults[field] !== undefined) { origin = "dashboard"; value = defaults[field]; }
    if (component[field] !== undefined) { origin = "component"; value = component[field]; }
    return [field, { value, origin }];
  })) as Resolved<T>;
}
/** Résout un visuel. Pour retirer une surcharge, omettre sa clé : le décodeur refuse `undefined` explicite. */
export function resolveVisual(theme: VisualPresentation, analysis: AnalysisPresentation, defaults: PresentationDefaults, component: VisualPresentation): Resolved<VisualPresentation> {
  const { legend, number_format, tooltip } = defaults;
  const reduced: Defaults = { ...(legend === undefined ? {} : { legend }), ...(number_format === undefined ? {} : { number_format }), ...(tooltip === undefined ? {} : { tooltip }) };
  return resolve<VisualPresentation>(["chart", "title", "legend", "number_format", "threshold", "tooltip"], theme, analysis, reduced, component);
}
/** Résout les seuls champs du KPI ; retirer une surcharge consiste à omettre sa clé. */
export function resolveKpi(theme: KpiPresentation, analysis: Pick<AnalysisPresentation, "title">, defaults: PresentationDefaults, component: KpiPresentation): Resolved<KpiPresentation> {
  const { number_format, tooltip } = defaults;
  const reduced: KpiPresentation = { ...(number_format === undefined ? {} : { number_format }), ...(tooltip === undefined ? {} : { tooltip }) };
  return resolve<KpiPresentation>(["title", "number_format", "threshold", "tooltip"], theme, analysis, reduced, component);
}
