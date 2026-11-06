import { boolean, ContractError, integer, list, nullable, object, oneOf, text } from "../catalogue/decode";
import { ADDITIVITIES, AGGREGATIONS } from "../executions/model";

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
export const TYPES = ["string", "number", "date", "timestamp", "boolean", "unknown"] as const;
export type LogicalType = (typeof TYPES)[number];
export const SCOPES = ["selection", "loaded_result", "filtered_perimeter"] as const;
export type Scope = (typeof SCOPES)[number];
export const REASONS = ["contract_unavailable", "result_unreadable", "grain_not_unique", "empty_selection", "unknown_aggregation", "numeric_overflow", "unsupported_value", "count_distinct_not_summable", "non_additive", "non_additive_dimension", "components_missing", "incomplete_result", "share_undefined"] as const;
const RULES = ["identity", "sum", "min", "max", "weighted_average", "share"] as const;
const NOTES = ["zero_or_null_denominator"] as const;

type Decoder<T> = (value: unknown, path: string) => T;
function exact(value: unknown, keys: readonly string[], path: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) throw new ContractError(`${path} : champs invalides`);
}
function boundedText(value: unknown, path: string): string {
  const found = text(value, path);
  if (Array.from(found).length > 1024 || /[\uD800-\uDFFF]/u.test(found)) throw new ContractError(`${path} : texte invalide`);
  return found;
}
function name(value: unknown, path: string): string {
  const found = text(value, path);
  if (!IDENTIFIER.test(found)) throw new ContractError(`${path} : nom invalide`);
  return found;
}
function boundedList<T>(decode: Decoder<T>, max: number): Decoder<readonly T[]> {
  return (value, path) => {
    const found = list(decode)(value, path);
    if (found.length > max) throw new ContractError(`${path} : liste trop longue`);
    return found;
  };
}
function unique<T extends { name: string }>(items: readonly T[], path: string): readonly T[] {
  if (new Set(items.map((item) => item.name)).size !== items.length) throw new ContractError(`${path} : noms répétés`);
  return items;
}
function metric(value: unknown, path: string) {
  exact(value, ["name", "label", "description", "aggregation", "additivity"], path);
  const result = object({ name, label: boundedText, description: boundedText, aggregation: nullable(oneOf(AGGREGATIONS)), additivity: oneOf(ADDITIVITIES) })(value, path);
  if (result.aggregation !== "sum" && result.aggregation !== "count" && result.additivity !== "non_additive") throw new ContractError(`${path} : additivité incohérente`);
  return result;
}
function dimension(value: unknown, path: string) {
  exact(value, ["name", "label", "description", "type", "is_time"], path);
  const found = object({ name, label: boundedText, description: boundedText, type: oneOf(TYPES), is_time: boolean })(value, path);
  if ((found.type === "date" || found.type === "timestamp") && !found.is_time) throw new ContractError(`${path} : dimension temporelle incohérente`);
  return found;
}
function model(value: unknown, path: string) {
  exact(value, ["name", "label", "description", "metrics", "dimensions"], path);
  const found = object({ name, label: boundedText, description: boundedText, metrics: boundedList(metric, 500), dimensions: boundedList(dimension, 500) })(value, path);
  unique(found.metrics, path); unique(found.dimensions, path);
  return found;
}
export type ExplorerModel = ReturnType<typeof model>;
export function decodeFields(value: unknown): { models: readonly ExplorerModel[] } {
  exact(value, ["models"], "champs");
  const found = object({ models: boundedList(model, 100) })(value, "champs");
  if (found.models.length === 0) throw new ContractError("champs : catalogue vide");
  unique(found.models, "champs");
  return found;
}

export type ExactNumber = { type: "decimal" | "integer"; value: string };
export type Cell = string | number | boolean | null | ExactNumber;
function cell(value: unknown, path: string): Cell {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  exact(value, ["type", "value"], path);
  const found = object({ type: oneOf(["decimal", "integer"] as const), value: text })(value, path);
  if (!(found.type === "integer" ? /^-?(?:0|[1-9]\d*)$/ : /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/).test(found.value)) throw new ContractError(`${path} : nombre exact invalide`);
  return found;
}
function row(value: unknown, path: string): Readonly<Record<string, Cell>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ContractError(`${path} : ligne invalide`);
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > 34) throw new ContractError(`${path} : colonnes invalides`);
  return Object.fromEntries(entries.map(([key, item]) => [name(key, path), cell(item, path)]));
}
export type Selection = Readonly<Record<string, readonly (string | number | boolean)[]>>;
export interface ContextualBody { operation: "aggregate" | "share"; metric: string; group_by: readonly string[]; selection: Selection | null; scope: "filtered_perimeter" | null; denominator: Scope | null }
function selection(value: unknown, path: string): Selection | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new ContractError(`${path} : sélection invalide`);
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 32) throw new ContractError(`${path} : sélection invalide`);
  return Object.fromEntries(entries.map(([key, values]) => {
    name(key, path);
    if (!Array.isArray(values) || !values.length || values.length > 100 || values.some((item: unknown) => !["string", "number", "boolean"].includes(typeof item) || (typeof item === "number" && !Number.isFinite(item)) || (typeof item === "string" && (Array.from(item).length > 1024 || item.includes("\0"))))) throw new ContractError(`${path} : valeurs invalides`);
    return [key, values as (string | number | boolean)[]];
  }));
}
const names = boundedList(name, 32);
export function decodeContextualBody(value: unknown): ContextualBody {
  exact(value, ["operation", "metric", "group_by", "selection", "scope", "denominator"], "calcul");
  const found = object({ operation: oneOf(["aggregate", "share"] as const), metric: name, group_by: names, selection, scope: nullable(oneOf(["filtered_perimeter"] as const)), denominator: nullable(oneOf(SCOPES)) })(value, "calcul");
  if (new Set(found.group_by).size !== found.group_by.length || (found.selection !== null && found.scope !== null) || (found.operation === "share" && (found.scope !== null || found.denominator === null || found.metric === "share" || found.group_by.includes("share"))) || (found.operation === "aggregate" && found.denominator !== null) || (found.denominator === "selection" && found.selection === null)) throw new ContractError("calcul : paramètres incohérents");
  return found;
}
function engineSelection(value: unknown, path: string): Readonly<Record<string, readonly Cell[]>> | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new ContractError(`${path} : sélection invalide`);
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 32) throw new ContractError(`${path} : sélection invalide`);
  return Object.fromEntries(entries.map(([key, values]) => {
    name(key, path);
    const decoded = boundedList(cell, 100)(values, path);
    if (!decoded.length || decoded.some((item) => item === null)) throw new ContractError(`${path} : valeurs invalides`);
    return [key, decoded];
  }));
}
function engineRequest(value: unknown, path: string) {
  exact(value, ["metric", "group_by", "selection", "scope"], path);
  return object({ metric: name, group_by: names, selection: engineSelection, scope: oneOf(SCOPES) })(value, path);
}
export function decodeContextual(value: unknown) {
  if (typeof value !== "object" || value === null || !("status" in value)) throw new ContractError("calcul : statut absent");
  if (value.status === "unavailable") {
    exact(value, ["status", "reason", "engine_request"], "calcul");
    return object({ status: oneOf(["unavailable"] as const), reason: oneOf(REASONS), engine_request: engineRequest })(value, "calcul");
  }
  exact(value, ["status", "rows", "row_count", "scope", "rule", "partial", "source_evidence_id", "denominator", "notes"], "calcul");
  const found = object({ status: oneOf(["derived"] as const), rows: boundedList(row, 1000), row_count: integer, scope: oneOf(SCOPES), rule: oneOf(RULES), partial: boolean, source_evidence_id: text, denominator: nullable(oneOf(SCOPES)), notes: boundedList(oneOf(NOTES), 1) })(value, "calcul");
  if (found.row_count < 0 || found.row_count > 1000 || !found.source_evidence_id || (found.partial && found.scope !== "loaded_result") || (found.rule === "share") !== (found.denominator !== null)) throw new ContractError("calcul : résultat incohérent");
  return found;
}
export type ContextualResult = ReturnType<typeof decodeContextual>;
