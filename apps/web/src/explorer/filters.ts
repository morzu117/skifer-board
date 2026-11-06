import { ContractError } from "../catalogue/decode";
import type { ExecutionInput } from "../executions/client";
import { CONNECTION_NAME } from "../spaces/connections";
import { ENVIRONMENTS } from "../shell/sections";
import type { ExplorerModel, LogicalType } from "./model";

type Operator = ExecutionInput["filters"][number]["operator"];
export const OPERATORS: Readonly<Record<LogicalType, readonly Operator[]>> = {
  string: ["eq", "ne", "in"], number: ["eq", "ne", "gt", "gte", "lt", "lte", "in", "between"],
  boolean: ["eq", "ne"], unknown: ["eq", "ne"], date: [], timestamp: [],
};
export const TEMPORAL_FILTER_REASON = "SK-12";
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const TEXT = /^[\p{L}\p{N} _.,:/@&+()]*$/u;
const invalid = (): never => { throw new ContractError("Demande d'exploration invalide"); };
function scalar(value: unknown): value is string | number | boolean {
  if (typeof value === "string") return Array.from(value).length <= 1024 && TEXT.test(value);
  if (typeof value === "boolean") return true;
  return typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value));
}
function names(values: readonly string[], allowed: readonly string[], required: boolean): boolean {
  return values.length <= 32 && (!required || values.length > 0) && new Set(values).size === values.length && values.every((item) => IDENTIFIER.test(item) && allowed.includes(item));
}
/** La vérification locale assiste la saisie ; le serveur conserve l'autorité. */
export function buildExecution(input: ExecutionInput, model: ExplorerModel): ExecutionInput {
  if (!CONNECTION_NAME.test(input.connection) || !ENVIRONMENTS.includes(input.environment) || input.model !== model.name || !names(input.metrics, model.metrics.map((item) => item.name), true) || !names(input.dimensions, model.dimensions.map((item) => item.name), false) || !Array.isArray(input.filters) || input.filters.length > 32) invalid();
  const filters = input.filters.map(({ column, operator, value }) => {
    const dimension = model.dimensions.find((item) => item.name === column);
    if (dimension === undefined || !OPERATORS[dimension.type].includes(operator)) return invalid();
    const values: readonly (string | number | boolean)[] = Array.isArray(value) ? value as readonly (string | number | boolean)[] : [value as string | number | boolean];
    if (operator === "in" || operator === "between") {
      if (!Array.isArray(value) || !values.length || values.length > 100 || (operator === "between" && values.length !== 2) || (operator === "in" && new Set(values).size !== values.length)) return invalid();
    } else if (Array.isArray(value)) return invalid();
    if (values.some((item) => !scalar(item) || (dimension.type === "number" && typeof item !== "number") || (dimension.type === "string" && typeof item !== "string") || (dimension.type === "boolean" && typeof item !== "boolean"))) return invalid();
    if (operator === "in" && dimension.type === "number" && values.some((item) => Number.isInteger(item) !== Number.isInteger(values[0]))) return invalid();
    if (operator === "between" && (values[0] as number) > (values[1] as number)) return invalid();
    const normalized = operator === "in" ? [...values].sort((a, b) => a < b ? -1 : 1) : value;
    return { column, operator, value: normalized };
  });
  return { connection: input.connection, environment: input.environment, model: input.model, metrics: [...input.metrics], dimensions: [...input.dimensions], filters };
}
