import { CONNECTION_NAME } from "../spaces/connections";
import { distinct, exact, fail, identifier, items, MAX_NAMES, pick, record, uuid, word } from "./shape";

/**
 * Document `board.analysis/v1` (plan 18, A2), décodé strictement et aligné sur
 * `contracts/analyses/analysis.v1.json`. Aucun champ inconnu, aucune valeur hors domaine ; ni SQL,
 * ni environnement, ni sélection, ni donnée, ni secret. Le serveur reste l'autorité : ce décodeur
 * refuse, il ne complète ni ne corrige.
 */
export const API_VERSION = "board.analysis/v1";
export const VISIBILITIES = ["personal", "shared"] as const;
export const FILTER_OPERATORS = ["eq", "ne", "gt", "gte", "lt", "lte", "in", "between"] as const;
export const OPERATIONS = ["aggregate", "share"] as const;
export const SCOPES = ["filtered_perimeter"] as const;
export const DENOMINATORS = ["loaded_result", "filtered_perimeter"] as const;
export const CHART_KINDS = ["value", "bars", "line", "grouped_bars"] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export type FilterOperator = (typeof FILTER_OPERATORS)[number];
export type ChartKind = (typeof CHART_KINDS)[number];
export type Scalar = string | number | boolean;

export interface Person {
  issuer: string;
  subject: string;
}
export interface AnalysisFilter {
  column: string;
  operator: FilterOperator;
  value: Scalar | readonly Scalar[];
}
export interface AnalysisQuery {
  connection: string;
  model: string;
  metrics: readonly string[];
  dimensions: readonly string[];
  filters: readonly AnalysisFilter[];
}
export type ContextualStep =
  | { operation: "aggregate"; metric: string; group_by: readonly string[]; scope: "filtered_perimeter" | null }
  | { operation: "share"; metric: string; group_by: readonly string[]; denominator: (typeof DENOMINATORS)[number] };
/** Ce que le navigateur envoie pour créer ou réviser : le serveur pose `api_version`, `id` et `owner`. */
export interface AnalysisDraft {
  name: string;
  description: string;
  visibility: Visibility;
  query: AnalysisQuery;
  contextual: readonly ContextualStep[];
  presentation: { chart: ChartKind };
}
export interface AnalysisDocument extends AnalysisDraft {
  api_version: typeof API_VERSION;
  id: string;
  owner: Person;
}

const DRAFT_KEYS = ["name", "description", "visibility", "query", "contextual", "presentation"] as const;
const FILTER_TEXT = /^[\p{L}\p{N} _.,:/@&+()]*$/u;

/** Longueur en caractères (points de code), comme JSON Schema. */
const length = (text: string): number => Array.from(text).length;

/** Caractères que le schéma refuse : contrôles C0 et C1, séparateurs de ligne et de paragraphe, demi-paires. */
function clean(text: string, lines: boolean): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if ((code <= 0x1f && !(lines && (code === 0x09 || code === 0x0a))) || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 || (code >= 0xd800 && code <= 0xdfff)) return false;
  }
  return true;
}

export function decodeName(value: unknown, path: string): string {
  return bounded(value, path, 1, 120, false);
}

/** Texte borné en caractères et sans caractère interdit du schéma ; `lines` admet la tabulation et le saut de ligne. */
export function bounded(value: unknown, path: string, min: number, max: number, lines: boolean): string {
  const found = word(value, path);
  const size = length(found);
  return size >= min && size <= max && clean(found, lines) ? found : fail(path, "texte conforme au schéma");
}

export function decodePerson(value: unknown, path: string): Person {
  const found = exact(value, ["issuer", "subject"], path);
  return { issuer: bounded(found.issuer, `${path}.issuer`, 1, 512, false), subject: bounded(found.subject, `${path}.subject`, 1, 512, false) };
}

export function decodeNames(value: unknown, path: string, min: number): readonly string[] {
  return distinct(items(value, path, MAX_NAMES, min).map((item, index) => identifier(item, `${path}[${String(index)}]`)), path);
}

/** Même règle que la soumission (E3) : un texte de lettres, de chiffres et de ponctuation simple, jamais du SQL. */
function scalar(value: unknown, path: string): Scalar {
  if (typeof value === "boolean") return value;
  // Un entier doit être exactement représentable : au-delà, `JSON.parse` l'aurait déjà arrondi (aucune approximation silencieuse).
  if (typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return value;
  if (typeof value === "string" && length(value) <= 1024 && FILTER_TEXT.test(value)) return value;
  return fail(path, "valeur de filtre");
}

/**
 * Valeur d'un filtre selon son opérateur, jugée comme la soumission d'exécution : un scalaire, ou pour `in` une liste
 * d'un même type sans doublon (1 à 100), ou pour `between` deux bornes. Les dashboards (plan 19) la réemploient pour
 * les valeurs par défaut et autorisées de leurs filtres communs.
 */
export function decodeFilterValue(operator: FilterOperator, value: unknown, path: string): Scalar | readonly Scalar[] {
  if (operator !== "in" && operator !== "between") return scalar(value, path);
  const values = items(value, path, 100, 1).map((item, index) => scalar(item, `${path}[${String(index)}]`));
  if (operator === "between" && values.length !== 2) return fail(path, "deux bornes");
  if (operator === "in" && (values.some((item) => typeof item !== typeof values[0]) || new Set(values).size !== values.length)) return fail(path, "valeurs distinctes d'un même type");
  return values;
}

function filter(value: unknown, path: string): AnalysisFilter {
  const found = exact(value, ["column", "operator", "value"], path);
  const column = identifier(found.column, `${path}.column`);
  const operator = pick(found.operator, FILTER_OPERATORS, `${path}.operator`);
  return { column, operator, value: decodeFilterValue(operator, found.value, `${path}.value`) };
}

function query(value: unknown, path: string): AnalysisQuery {
  const found = exact(value, ["connection", "model", "metrics", "dimensions", "filters"], path);
  const connection = word(found.connection, `${path}.connection`);
  if (!CONNECTION_NAME.test(connection)) return fail(`${path}.connection`, "nom de connexion");
  return {
    connection,
    model: identifier(found.model, `${path}.model`),
    metrics: decodeNames(found.metrics, `${path}.metrics`, 1),
    dimensions: decodeNames(found.dimensions, `${path}.dimensions`, 0),
    filters: items(found.filters, `${path}.filters`, 32).map((item, index) => filter(item, `${path}.filters[${String(index)}]`)),
  };
}

function step(value: unknown, path: string, source: AnalysisQuery): ContextualStep {
  const operation = pick(record(value, path).operation, OPERATIONS, `${path}.operation`);
  const found = exact(value, operation === "share" ? ["operation", "metric", "group_by", "denominator"] : ["operation", "metric", "group_by", "scope"], path);
  const metric = identifier(found.metric, `${path}.metric`);
  const groupBy = decodeNames(found.group_by, `${path}.group_by`, 0);
  // Règles inter-champs que le schéma n'exprime pas : la requête porte la métrique et les dimensions.
  if (!source.metrics.includes(metric)) return fail(`${path}.metric`, "métrique de la requête");
  if (!groupBy.every((name) => source.dimensions.includes(name))) return fail(`${path}.group_by`, "dimensions de la requête");
  if (operation === "aggregate") {
    return { operation, metric, group_by: groupBy, scope: found.scope === null ? null : pick(found.scope, SCOPES, `${path}.scope`) };
  }
  // `share` est le nom de la colonne produite : ni métrique ni dimension ne peut le porter.
  if (metric === "share" || groupBy.includes("share")) return fail(path, "nom autre que share");
  return { operation, metric, group_by: groupBy, denominator: pick(found.denominator, DENOMINATORS, `${path}.denominator`) };
}

function draftOf(found: Readonly<Record<string, unknown>>, path: string): AnalysisDraft {
  const source = query(found.query, `${path}.query`);
  const presentation = exact(found.presentation, ["chart"], `${path}.presentation`);
  return {
    name: decodeName(found.name, `${path}.name`),
    description: bounded(found.description, `${path}.description`, 0, 2000, true),
    visibility: pick(found.visibility, VISIBILITIES, `${path}.visibility`),
    query: source,
    contextual: items(found.contextual, `${path}.contextual`, 32).map((item, index) => step(item, `${path}.contextual[${String(index)}]`, source)),
    presentation: { chart: pick(presentation.chart, CHART_KINDS, `${path}.presentation.chart`) },
  };
}

/** Corps d'une création ou d'une révision : `api_version`, `id` et `owner` n'y ont pas leur place. */
export function decodeAnalysisDraft(value: unknown, path = "analyse"): AnalysisDraft {
  return draftOf(exact(value, DRAFT_KEYS, path), path);
}

/** Document complet, tel que le serveur le lit dans le dépôt. */
export function decodeAnalysis(value: unknown, path = "analyse"): AnalysisDocument {
  const found = exact(value, ["api_version", "id", "owner", ...DRAFT_KEYS], path);
  if (found.api_version !== API_VERSION) return fail(`${path}.api_version`, API_VERSION);
  return { api_version: API_VERSION, id: uuid(found.id, `${path}.id`), owner: decodePerson(found.owner, `${path}.owner`), ...draftOf(found, path) };
}
