import { bounded, CHART_KINDS, decodeFilterValue, decodeName, decodePerson, VISIBILITIES, type ChartKind, type Person, type Scalar, type Visibility } from "../analyses/document";
import { distinct, fail, flag, identifier, items, MAX_REVISION, pick, record, uuid } from "../analyses/shape";

/**
 * Document `board.dashboard/v1` (plan 19, B2), décodé strictement et aligné sur `contracts/dashboards/dashboard.v1.json`.
 * Aucun champ inconnu, aucune valeur hors domaine ; ni SQL, ni requête, ni donnée, ni environnement, ni thème, ni couleur
 * brute, ni option de rendu, ni secret. Le décodeur refuse, il ne complète ni ne corrige : le serveur reste l'autorité.
 *
 * Il juge aussi les règles inter-champs que le serveur applique sans catalogue (`dashboard.py`) : identifiants uniques,
 * somme des largeurs, profondeur, conteneur seul, cibles existantes et exécutables, filtre sans cible, valeurs de filtres,
 * `default` inclus dans `allowed`, bornes. Les règles qui demandent les analyses ou le catalogue (`dashboard_checks.py` :
 * analyse disponible, KPI sur une valeur, graphique compatible, dimension exposée, opérateur permis, type des valeurs,
 * borne de filtres par tuile) restent au serveur, seul à les connaître. Trois autres ne peuvent pas se juger dans le
 * navigateur : `span`, `reference.revision` et `heading.level` écrits `2.0` (le serveur refuse un flottant, `JSON.parse` ne
 * distingue pas `2.0` de `2`), et la distinction entre `1` et `1.0` dans les valeurs d'un filtre. Le serveur ne rend jamais
 * un tel document, et le web ne sait pas en émettre un.
 */
export const API_VERSION = "board.dashboard/v1";
export const LEGENDS = ["auto", "shown", "hidden"] as const;
export const NUMBER_FORMATS = ["auto", "integer", "decimal_1", "decimal_2", "percent", "compact"] as const;
export const TOOLTIPS = ["value", "value_and_definition"] as const;
export const COMMON_OPERATORS = ["eq", "in", "between"] as const;
export const NODE_TYPES = ["container", "analysis", "kpi", "text", "separator"] as const;
export const BLOCK_TYPES = ["paragraph", "heading", "list"] as const;
export const HEADING_LEVELS = [1, 2] as const;
/** Composants dont la tuile s'exécute : ceux qui référencent une analyse. */
export const EXECUTABLE_TYPES = ["analysis", "kpi"] as const;

/** Bornes du schéma (plan 19, B2) et de ses règles inter-champs. */
export const LIMITS = {
  sections: 20,
  rows: 24,
  columns: 12,
  children: 16,
  filters: 32,
  targets: 40,
  values: 100,
  blocks: 30,
  segments: 20,
  items: 30,
  grid: 12,
  levels: 3,
  nodes: 600,
  components: 64,
  executable: 40,
  text: 5000,
  title: 120,
  label: 80,
  segment: 1000,
  threshold: 1e15,
  string: 1024,
} as const;

export type Legend = (typeof LEGENDS)[number];
export type NumberFormat = (typeof NUMBER_FORMATS)[number];
export type Tooltip = (typeof TOOLTIPS)[number];
export type CommonOperator = (typeof COMMON_OPERATORS)[number];
export type NodeType = (typeof NODE_TYPES)[number];

export interface Threshold {
  value: number;
  label: string;
}
/** Défauts de présentation du dashboard : chaque surcharge d'un composant peut être retirée. */
export interface Defaults {
  legend?: Legend;
  number_format?: NumberFormat;
  tooltip?: Tooltip;
}
export interface VisualPresentation {
  chart?: ChartKind;
  title?: string;
  legend?: Legend;
  number_format?: NumberFormat;
  threshold?: Threshold;
  tooltip?: Tooltip;
}
export interface KpiPresentation {
  title?: string;
  number_format?: NumberFormat;
  threshold?: Threshold;
  tooltip?: Tooltip;
}
export interface Reference {
  analysis_id: string;
  revision: number;
}

/** Texte d'auteur : paragraphes, intertitres et listes de segments simples, jamais de HTML, de lien ni d'image. */
export interface Segment {
  text: string;
  emphasis?: true;
  strong?: true;
}
export type Block =
  | { type: "paragraph"; content: readonly Segment[] }
  | { type: "heading"; level: (typeof HEADING_LEVELS)[number]; content: readonly Segment[] }
  | { type: "list"; ordered: boolean; items: readonly (readonly Segment[])[] };

export interface AnalysisComponent {
  id: string;
  type: "analysis";
  reference: Reference;
  presentation: VisualPresentation;
}
export interface KpiComponent {
  id: string;
  type: "kpi";
  reference: Reference;
  presentation: KpiPresentation;
}
export interface TextComponent {
  id: string;
  type: "text";
  blocks: readonly Block[];
}
export interface SeparatorComponent {
  id: string;
  type: "separator";
}
export interface Container {
  id: string;
  type: "container";
  rows: readonly Row[];
}
export type Component = AnalysisComponent | KpiComponent | TextComponent | SeparatorComponent;
export type ExecutableComponent = AnalysisComponent | KpiComponent;
export type LayoutNode = Container | Component;
export interface Column {
  id: string;
  span: number;
  children: readonly LayoutNode[];
}
export interface Row {
  id: string;
  columns: readonly Column[];
}
export interface Section {
  id: string;
  title?: string;
  rows: readonly Row[];
}

/** Filtre commun (B7) : une dimension, un opérateur fermé, et les composants auxquels il s'applique. */
export interface CommonFilter {
  id: string;
  label: string;
  dimension: string;
  operator: CommonOperator;
  default?: Scalar | readonly Scalar[];
  allowed?: readonly Scalar[];
  targets: readonly string[];
}

/** Ce que le navigateur envoie pour créer ou réviser : le serveur pose `api_version`, `id` et `owner`. */
export interface DashboardDraft {
  name: string;
  description: string;
  visibility: Visibility;
  defaults: Defaults;
  filters: readonly CommonFilter[];
  layout: { sections: readonly Section[] };
}
export interface DashboardDocument extends DashboardDraft {
  api_version: typeof API_VERSION;
  id: string;
  owner: Person;
}

const DRAFT_KEYS = ["name", "description", "visibility", "defaults", "filters", "layout"] as const;
const THRESHOLD_KEYS = ["value", "label"] as const;
const SEGMENT_KEYS = ["text", "emphasis", "strong"] as const;
const FILTER_KEYS = ["id", "label", "dimension", "operator", "default", "allowed", "targets"] as const;

const has = (found: Readonly<Record<string, unknown>>, key: string): boolean => Object.hasOwn(found, key);

/**
 * Objet dont les champs sont parmi `allowed`, `required` y compris : un champ inconnu ou un champ requis absent est
 * refusé avec la liste des champs du schéma.
 */
function fields(value: unknown, allowed: readonly string[], required: readonly string[], path: string): Readonly<Record<string, unknown>> {
  const found = record(value, path);
  return Object.keys(found).every((key) => allowed.includes(key)) && required.every((key) => has(found, key)) ? found : fail(path, `champs ${allowed.join(", ")}`);
}

/** Entier du schéma (`type: integer`, `minimum`, `maximum`) : le type d'abord, puis l'intervalle. */
function integer(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fail(path, "entier");
  return value >= min && value <= max ? value : fail(path, `entier de ${String(min)} à ${String(max)}`);
}

function threshold(value: unknown, path: string): Threshold {
  const found = fields(value, THRESHOLD_KEYS, THRESHOLD_KEYS, path);
  if (typeof found.value !== "number") return fail(`${path}.value`, "nombre");
  if (!(Math.abs(found.value) <= LIMITS.threshold)) return fail(`${path}.value`, "nombre de -1e15 à 1e15");
  return { value: found.value, label: bounded(found.label, `${path}.label`, 1, LIMITS.label, false) };
}

/** Champs de présentation communs au visuel et au KPI. */
function shared(found: Readonly<Record<string, unknown>>, path: string): Pick<VisualPresentation, "title" | "number_format" | "threshold" | "tooltip"> {
  return {
    ...(has(found, "title") ? { title: decodeName(found.title, `${path}.title`) } : {}),
    ...(has(found, "number_format") ? { number_format: pick(found.number_format, NUMBER_FORMATS, `${path}.number_format`) } : {}),
    ...(has(found, "threshold") ? { threshold: threshold(found.threshold, `${path}.threshold`) } : {}),
    ...(has(found, "tooltip") ? { tooltip: pick(found.tooltip, TOOLTIPS, `${path}.tooltip`) } : {}),
  };
}

function defaults(value: unknown, path: string): Defaults {
  const found = fields(value, ["legend", "number_format", "tooltip"], [], path);
  return {
    ...(has(found, "legend") ? { legend: pick(found.legend, LEGENDS, `${path}.legend`) } : {}),
    ...(has(found, "number_format") ? { number_format: pick(found.number_format, NUMBER_FORMATS, `${path}.number_format`) } : {}),
    ...(has(found, "tooltip") ? { tooltip: pick(found.tooltip, TOOLTIPS, `${path}.tooltip`) } : {}),
  };
}

function visual(value: unknown, path: string): VisualPresentation {
  const found = fields(value, ["chart", "title", "legend", "number_format", "threshold", "tooltip"], [], path);
  return {
    ...(has(found, "chart") ? { chart: pick(found.chart, CHART_KINDS, `${path}.chart`) } : {}),
    ...(has(found, "legend") ? { legend: pick(found.legend, LEGENDS, `${path}.legend`) } : {}),
    ...shared(found, path),
  };
}

function kpi(value: unknown, path: string): KpiPresentation {
  return shared(fields(value, ["title", "number_format", "threshold", "tooltip"], [], path), path);
}

function reference(value: unknown, path: string): Reference {
  const found = fields(value, ["analysis_id", "revision"], ["analysis_id", "revision"], path);
  return { analysis_id: uuid(found.analysis_id, `${path}.analysis_id`), revision: integer(found.revision, `${path}.revision`, 1, MAX_REVISION) };
}

// -- texte --------------------------------------------------------------------------------------

/** `emphasis` et `strong` ne valent que `true` : absent ou `true`, jamais `false`. */
function mark(value: unknown, path: string): true {
  return value === true ? true : fail(path, "true");
}

function segment(value: unknown, path: string): Segment {
  const found = fields(value, SEGMENT_KEYS, ["text"], path);
  return {
    text: bounded(found.text, `${path}.text`, 1, LIMITS.segment, false),
    ...(has(found, "emphasis") ? { emphasis: mark(found.emphasis, `${path}.emphasis`) } : {}),
    ...(has(found, "strong") ? { strong: mark(found.strong, `${path}.strong`) } : {}),
  };
}

const segments = (value: unknown, path: string): readonly Segment[] => items(value, path, LIMITS.segments, 1).map((item, index) => segment(item, `${path}[${String(index)}]`));

function block(value: unknown, path: string): Block {
  const found = record(value, path);
  if (!has(found, "type")) return fail(path, "champs type");
  const type = pick(found.type, BLOCK_TYPES, `${path}.type`);
  if (type === "paragraph") {
    const exact = fields(found, ["type", "content"], ["type", "content"], path);
    return { type, content: segments(exact.content, `${path}.content`) };
  }
  if (type === "heading") {
    const exact = fields(found, ["type", "level", "content"], ["type", "level", "content"], path);
    // Le schéma énumère 1 et 2 : un niveau écrit autrement est hors domaine, non d'un autre type.
    const level = HEADING_LEVELS.find((known) => known === exact.level);
    if (level === undefined) return fail(`${path}.level`, HEADING_LEVELS.join(" | "));
    return { type, level, content: segments(exact.content, `${path}.content`) };
  }
  const exact = fields(found, ["type", "ordered", "items"], ["type", "ordered", "items"], path);
  return {
    type,
    ordered: flag(exact.ordered, `${path}.ordered`),
    items: items(exact.items, `${path}.items`, LIMITS.items, 1).map((item, index) => segments(item, `${path}.items[${String(index)}]`)),
  };
}

/** Nombre de caractères (points de code) de tout le texte d'un composant, comme le serveur. */
const textLength = (blocks: readonly Block[]): number =>
  blocks.reduce((sum, item) => sum + (item.type === "list" ? item.items.flat() : item.content).reduce((part, one) => part + Array.from(one.text).length, 0), 0);

/** Blocs d'un composant de texte : bornés en nombre et en caractères, tous blocs confondus. */
function blocksOf(value: unknown, path: string): readonly Block[] {
  const found = items(value, path, LIMITS.blocks).map((item, index) => block(item, `${path}[${String(index)}]`));
  return textLength(found) > LIMITS.text ? fail(path, `au plus ${String(LIMITS.text)} caractères de texte`) : found;
}

// -- mise en page -------------------------------------------------------------------------------

/** Ce que le parcours de la mise en page apprend : identifiants et genres, comptes (règles inter-champs). */
interface Scan {
  kinds: Map<string, string>;
  nodes: number;
  components: number;
  executable: number;
}

/** Un identifiant sert une seule fois dans tout le document. */
function claim(scan: Scan, id: string, kind: string, path: string): string {
  if (scan.kinds.has(id)) return fail(path, "identifiant unique");
  scan.kinds.set(id, kind);
  return id;
}

function count(scan: Scan, path: string): void {
  scan.nodes += 1;
  if (scan.nodes > LIMITS.nodes) fail(path, `au plus ${String(LIMITS.nodes)} éléments de mise en page`);
}

function component(found: Readonly<Record<string, unknown>>, type: Exclude<NodeType, "container">, path: string, scan: Scan): Component {
  const keys = type === "separator" ? ["id", "type"] : type === "text" ? ["id", "type", "blocks"] : ["id", "type", "reference", "presentation"];
  const own = fields(found, keys, keys, path);
  const id = claim(scan, uuid(own.id, `${path}.id`), type, `${path}.id`);
  count(scan, path);
  scan.components += 1;
  if (scan.components > LIMITS.components) fail(path, `au plus ${String(LIMITS.components)} composants`);
  if (type === "separator") return { id, type };
  if (type === "text") {
    return { id, type, blocks: blocksOf(own.blocks, `${path}.blocks`) };
  }
  scan.executable += 1;
  if (scan.executable > LIMITS.executable) fail(path, `au plus ${String(LIMITS.executable)} composants exécutables`);
  const pinned = reference(own.reference, `${path}.reference`);
  return type === "analysis" ? { id, type, reference: pinned, presentation: visual(own.presentation, `${path}.presentation`) } : { id, type, reference: pinned, presentation: kpi(own.presentation, `${path}.presentation`) };
}

/** `level` est le niveau de rangées où le nœud se trouve : un conteneur du troisième niveau ne peut plus en porter. */
function node(value: unknown, path: string, level: number, scan: Scan): LayoutNode {
  const found = record(value, path);
  if (!has(found, "type")) return fail(path, "champs type");
  const type = pick(found.type, NODE_TYPES, `${path}.type`);
  if (type !== "container") return component(found, type, path, scan);
  const own = fields(found, ["id", "type", "rows"], ["id", "type", "rows"], path);
  const id = claim(scan, uuid(own.id, `${path}.id`), type, `${path}.id`);
  count(scan, path);
  if (level >= LIMITS.levels) return fail(path, `${String(LIMITS.levels)} niveaux de rangées au plus`);
  return { id, type, rows: rows(own.rows, `${path}.rows`, level + 1, scan) };
}

function column(value: unknown, path: string, level: number, scan: Scan): Column {
  const found = fields(value, ["id", "span", "children"], ["id", "span", "children"], path);
  const id = claim(scan, uuid(found.id, `${path}.id`), "column", `${path}.id`);
  count(scan, path);
  const span = integer(found.span, `${path}.span`, 1, LIMITS.grid);
  const children = items(found.children, `${path}.children`, LIMITS.children).map((item, index) => node(item, `${path}.children[${String(index)}]`, level, scan));
  // Un conteneur occupe seul sa colonne : il ne partage pas la largeur avec un autre élément.
  if (children.length > 1 && children.some((child) => child.type === "container")) return fail(`${path}.children`, "conteneur seul dans sa colonne");
  return { id, span, children };
}

function row(value: unknown, path: string, level: number, scan: Scan): Row {
  const found = fields(value, ["id", "columns"], ["id", "columns"], path);
  const id = claim(scan, uuid(found.id, `${path}.id`), "row", `${path}.id`);
  count(scan, path);
  const columns = items(found.columns, `${path}.columns`, LIMITS.columns).map((item, index) => column(item, `${path}.columns[${String(index)}]`, level, scan));
  if (columns.reduce((sum, one) => sum + one.span, 0) > LIMITS.grid) return fail(path, `largeurs de colonnes de somme au plus ${String(LIMITS.grid)}`);
  return { id, columns };
}

function rows(value: unknown, path: string, level: number, scan: Scan): readonly Row[] {
  return items(value, path, LIMITS.rows).map((item, index) => row(item, `${path}[${String(index)}]`, level, scan));
}

function section(value: unknown, path: string, scan: Scan): Section {
  const found = fields(value, ["id", "title", "rows"], ["id", "rows"], path);
  const id = claim(scan, uuid(found.id, `${path}.id`), "section", `${path}.id`);
  count(scan, path);
  return { id, ...(has(found, "title") ? { title: decodeName(found.title, `${path}.title`) } : {}), rows: rows(found.rows, `${path}.rows`, 1, scan) };
}

// -- filtres communs ----------------------------------------------------------------------------

/** Valeur scalaire du schéma : type et longueur seulement (le contenu se juge ensuite, comme la soumission). */
function atom(value: unknown, path: string): void {
  if (typeof value === "string") {
    if (Array.from(value).length > LIMITS.string) fail(path, `au plus ${String(LIMITS.string)} caractères`);
  } else if (typeof value !== "number" && typeof value !== "boolean") {
    fail(path, "texte, nombre ou booléen");
  }
}

/**
 * Forme de `default` ou de `allowed` selon le schéma : un scalaire pour `eq`, une liste de `min` à `max` scalaires sinon.
 * Les valeurs elles-mêmes se jugent après, par `decodeFilterValue`.
 */
function shaped(value: unknown, path: string, many: boolean, min: number, max: number): void {
  if (many) items(value, path, max, min).forEach((item, index) => { atom(item, `${path}[${String(index)}]`); });
  else if (Array.isArray(value)) fail(path, "texte, nombre ou booléen");
  else atom(value, path);
}

/** Les deux bornes de `between` ont le même type et, quand ce sont des nombres, sont ordonnées. */
function bounds(value: readonly Scalar[], path: string): void {
  const [low, high] = value as readonly [Scalar, Scalar];
  if (typeof low !== typeof high) fail(path, "bornes de même type");
  if (typeof low === "number" && typeof high === "number" && low > high) fail(path, "bornes ordonnées");
}

function commonValueShapes(operator: CommonOperator, found: Readonly<Record<string, unknown>>, path: string): void {
  if (has(found, "default")) shaped(found.default, `${path}.default`, operator !== "eq", operator === "between" ? 2 : 1, operator === "between" ? 2 : LIMITS.values);
  if (has(found, "allowed")) shaped(found.allowed, `${path}.allowed`, true, 1, LIMITS.values);
}

function commonValueContents(operator: CommonOperator, found: Readonly<Record<string, unknown>>, path: string): { preferred: Scalar | readonly Scalar[] | undefined; allowed: readonly Scalar[] | undefined } {
  const preferred = has(found, "default") ? decodeFilterValue(operator, found.default, `${path}.default`) : undefined;
  if (operator === "between" && preferred !== undefined) bounds(preferred as readonly Scalar[], `${path}.default`);
  const allowed = has(found, "allowed") ? (decodeFilterValue("in", found.allowed, `${path}.allowed`) as readonly Scalar[]) : undefined;
  if (preferred !== undefined && allowed !== undefined && (Array.isArray(preferred) ? (preferred as readonly Scalar[]) : [preferred as Scalar]).some((one) => !allowed.includes(one))) {
    return fail(`${path}.default`, "valeur par défaut parmi les valeurs autorisées");
  }
  return { preferred, allowed };
}

/** Valide forme et contenu des valeurs communes, comme le document. */
export function decodeCommonValues(operator: CommonOperator, found: Readonly<Record<string, unknown>>, path: string): { preferred: Scalar | readonly Scalar[] | undefined; allowed: readonly Scalar[] | undefined } {
  commonValueShapes(operator, found, path);
  return commonValueContents(operator, found, path);
}

/**
 * Champs d'un filtre hors identifiant, jugés sans le reste du document : types, bornes, forme de `default` et de `allowed`
 * selon l'opérateur, bornes de `between`, `default` parmi `allowed`, au moins une cible. L'existence des cibles dans la
 * mise en page ne se juge qu'avec le document entier.
 */
export function filterValues(found: Readonly<Record<string, unknown>>, path: string): Omit<CommonFilter, "id"> {
  const label = bounded(found.label, `${path}.label`, 1, LIMITS.label, false);
  const dimension = identifier(found.dimension, `${path}.dimension`);
  const operator = pick(found.operator, COMMON_OPERATORS, `${path}.operator`);
  const targets = distinct(items(found.targets, `${path}.targets`, LIMITS.targets).map((item, index) => uuid(item, `${path}.targets[${String(index)}]`)), `${path}.targets`);
  commonValueShapes(operator, found, path);
  if (targets.length === 0) return fail(`${path}.targets`, "au moins une cible");
  const { preferred, allowed } = commonValueContents(operator, found, path);
  return { label, dimension, operator, ...(preferred === undefined ? {} : { default: preferred }), ...(allowed === undefined ? {} : { allowed }), targets };
}

function commonFilter(value: unknown, path: string, scan: Scan): CommonFilter {
  const found = fields(value, FILTER_KEYS, ["id", "label", "dimension", "operator", "targets"], path);
  const id = claim(scan, uuid(found.id, `${path}.id`), "filter", `${path}.id`);
  const filter = filterValues(found, path);
  // Règles inter-champs : les cibles sont des tuiles du document, les valeurs passent par la soumission d'exécution.
  filter.targets.forEach((target, index) => {
    const kind = scan.kinds.get(target);
    if (kind === undefined) fail(`${path}.targets[${String(index)}]`, "composant du document");
    if (kind !== "analysis" && kind !== "kpi") fail(`${path}.targets[${String(index)}]`, "composant exécutable (visuel ou KPI)");
  });
  return { id, ...filter };
}

// -- document -----------------------------------------------------------------------------------

function draftOf(found: Readonly<Record<string, unknown>>, path: string): DashboardDraft {
  const scan: Scan = { kinds: new Map(), nodes: 0, components: 0, executable: 0 };
  const name = decodeName(found.name, `${path}.name`);
  const description = bounded(found.description, `${path}.description`, 0, 2000, true);
  const visibility = pick(found.visibility, VISIBILITIES, `${path}.visibility`);
  const preferences = defaults(found.defaults, `${path}.defaults`);
  // La mise en page d'abord : les cibles des filtres y sont cherchées (le serveur juge de même, filtres après mise en page).
  const layout = fields(found.layout, ["sections"], ["sections"], `${path}.layout`);
  const sections = items(layout.sections, `${path}.layout.sections`, LIMITS.sections).map((item, index) => section(item, `${path}.layout.sections[${String(index)}]`, scan));
  const filters = items(found.filters, `${path}.filters`, LIMITS.filters).map((item, index) => commonFilter(item, `${path}.filters[${String(index)}]`, scan));
  return { name, description, visibility, defaults: preferences, filters, layout: { sections } };
}

/** Corps d'une création ou d'une révision : `api_version`, `id` et `owner` n'y ont pas leur place. */
export function decodeDashboardDraft(value: unknown, path = "dashboard"): DashboardDraft {
  return draftOf(fields(value, DRAFT_KEYS, DRAFT_KEYS, path), path);
}

/** Document complet, tel que le serveur le lit dans le dépôt. */
export function decodeDashboard(value: unknown, path = "dashboard"): DashboardDocument {
  const found = fields(value, ["api_version", "id", "owner", ...DRAFT_KEYS], ["api_version", "id", "owner", ...DRAFT_KEYS], path);
  if (found.api_version !== API_VERSION) return fail(`${path}.api_version`, API_VERSION);
  return { api_version: API_VERSION, id: uuid(found.id, `${path}.id`), owner: decodePerson(found.owner, `${path}.owner`), ...draftOf(found, path) };
}

// -- champs propres d'un nœud, pour l'écart de révisions ----------------------------------------

/** Genres de nœuds à identifiant que l'écart de révisions nomme, hors en-tête et défauts. */
export type OwnNode = "section" | "row" | "column" | "filter" | NodeType;
type ValueDecoder = (value: unknown, path: string) => unknown;

const literal = (type: string): ValueDecoder => (value, path) => (value === type ? value : fail(path, type));
const text = (min: number, max: number, lines: boolean): ValueDecoder => (value, path) => bounded(value, path, min, max, lines);
const oneOf = (allowed: readonly string[]): ValueDecoder => (value, path) => pick(value, allowed, path);

/** `default` d'un filtre jugé seul, sans son opérateur : un scalaire, ou de un à cent scalaires. */
const looseDefault: ValueDecoder = (value, path) => (Array.isArray(value)
  ? items(value, path, LIMITS.values, 1).map((item, index) => decodeFilterValue("eq", item, `${path}[${String(index)}]`))
  : decodeFilterValue("eq", value, path));
const looseTargets: ValueDecoder = (value, path) => distinct(items(value, path, LIMITS.targets, 1).map((item, index) => uuid(item, `${path}[${String(index)}]`)), path);

/** Champs propres de chaque genre de nœud (tout sauf l'identifiant et les enfants) et ceux que le schéma rend facultatifs. */
const OWN: Readonly<Record<OwnNode, { fields: Readonly<Record<string, ValueDecoder>>; optional: readonly string[] }>> = {
  section: { fields: { title: decodeName }, optional: ["title"] },
  row: { fields: {}, optional: [] },
  column: { fields: { span: (value, path) => integer(value, path, 1, LIMITS.grid) }, optional: [] },
  filter: {
    fields: {
      label: text(1, LIMITS.label, false), dimension: identifier, operator: oneOf(COMMON_OPERATORS), default: looseDefault,
      allowed: (value, path) => decodeFilterValue("in", value, path), targets: looseTargets,
    },
    optional: ["default", "allowed"],
  },
  container: { fields: { type: literal("container") }, optional: [] },
  analysis: { fields: { type: literal("analysis"), reference, presentation: visual }, optional: [] },
  kpi: { fields: { type: literal("kpi"), reference, presentation: kpi }, optional: [] },
  text: { fields: { type: literal("text"), blocks: blocksOf }, optional: [] },
  separator: { fields: { type: literal("separator") }, optional: [] },
};

/** Champs propres d'un nœud que le schéma rend facultatifs : les seuls qu'une modification peut ajouter ou retirer. */
export const optionalOwn = (node: OwnNode): readonly string[] => OWN[node].optional;

/**
 * Champs propres d'un nœud, tels que `dashboard.diff` les rend : un nœud entier (`complete`, ajout ou retrait : `type`
 * compris, les champs requis tous présents, un filtre jugé comme dans un document) ou ceux d'une modification (jamais
 * `type`, un sous-ensemble, chaque valeur jugée seule). Un champ inconnu ou une valeur hors domaine est refusé.
 */
export function decodeOwn(node: OwnNode, value: unknown, path: string, complete: boolean): Readonly<Record<string, unknown>> {
  const { fields: known, optional } = OWN[node];
  const names = Object.keys(known).filter((name) => complete || name !== "type");
  const found = fields(value, names, complete ? names.filter((name) => !optional.includes(name)) : [], path);
  if (complete && node === "filter") return filterValues(found, path);
  return Object.fromEntries(Object.keys(found).map((name) => [name, (known[name] as ValueDecoder)(found[name], `${path}.${name}`)]));
}

/** Champs de l'en-tête que l'écart compare, par chemin de feuille : `owner` se compare par `issuer` et `subject`. */
export const HEADER_VALUES: Readonly<Record<string, ValueDecoder>> = {
  "/name": decodeName,
  "/description": text(0, 2000, true),
  "/visibility": oneOf(VISIBILITIES),
  "/owner/issuer": text(1, 512, false),
  "/owner/subject": text(1, 512, false),
};
/** Défauts de présentation que l'écart compare, par chemin de feuille. */
export const DEFAULT_VALUES: Readonly<Record<string, ValueDecoder>> = {
  "/defaults/legend": oneOf(LEGENDS),
  "/defaults/number_format": oneOf(NUMBER_FORMATS),
  "/defaults/tooltip": oneOf(TOOLTIPS),
};

// -- composants exécutables ---------------------------------------------------------------------

function inRows(list: readonly Row[]): readonly ExecutableComponent[] {
  return list.flatMap((one) => one.columns.flatMap((cell) => cell.children.flatMap((child) => (child.type === "container" ? inRows(child.rows) : child.type === "analysis" || child.type === "kpi" ? [child] : []))));
}

/** Composants exécutables (visuels et KPI) d'un document, dans l'ordre du document : celui des états de tuiles. */
export function executables(document: DashboardDraft): readonly ExecutableComponent[] {
  return document.layout.sections.flatMap((one) => inRows(one.rows));
}
