import { ContractError } from "../catalogue/decode";

/** Briques communes aux décodeurs des analyses (plan 18, 18.4) : formes fermées, aucun champ complété. */

export const MAX_REVISION = 999_999_999;
export const MAX_NAMES = 32;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function fail(path: string, expected: string): never {
  throw new ContractError(`${path} : ${expected} attendu`);
}

export function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_REVISION;
}

export function record(value: unknown, path: string): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : fail(path, "objet");
}

/** Objet dont les champs sont exactement `keys` : un champ inconnu ou absent est refusé. */
export function exact(value: unknown, keys: readonly string[], path: string): Readonly<Record<string, unknown>> {
  const found = record(value, path);
  const present = Object.keys(found);
  return present.length === keys.length && keys.every((key) => Object.hasOwn(found, key)) ? found : fail(path, `champs ${keys.join(", ")}`);
}

export function items(value: unknown, path: string, max: number, min = 0): readonly unknown[] {
  if (!Array.isArray(value)) return fail(path, "liste");
  if (value.length < min || value.length > max) return fail(path, `liste de ${String(min)} à ${String(max)} éléments`);
  return value as readonly unknown[];
}

export function word(value: unknown, path: string): string {
  return typeof value === "string" ? value : fail(path, "texte");
}

export function flag(value: unknown, path: string): boolean {
  return typeof value === "boolean" ? value : fail(path, "booléen");
}

export function pick<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : fail(path, allowed.join(" | "));
}

export const isUuid = (value: string): boolean => UUID.test(value);

export function uuid(value: unknown, path: string): string {
  const found = word(value, path);
  return UUID.test(found) ? found : fail(path, "UUID en minuscules");
}

export function commit(value: unknown, path: string): string {
  const found = word(value, path);
  return COMMIT.test(found) ? found : fail(path, "empreinte de commit");
}

export function identifier(value: unknown, path: string): string {
  const found = word(value, path);
  return IDENTIFIER.test(found) ? found : fail(path, "identifiant");
}

export function revision(value: unknown, path: string): number {
  return isRevision(value) ? value : fail(path, "numéro de révision");
}

export function count(value: unknown, path: string): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fail(path, "entier positif ou nul");
}

export function distinct<T>(values: readonly T[], path: string): readonly T[] {
  return new Set(values).size === values.length ? values : fail(path, "valeurs distinctes");
}
