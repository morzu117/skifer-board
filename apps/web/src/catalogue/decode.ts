/**
 * Décodage strict des réponses de l'API du catalogue (plan 04, C10). Une réponse hors
 * contrat lève `ContractError` : l'écran affiche une erreur, jamais une donnée partielle.
 */

export class ContractError extends Error {
  override name = "ContractError";
}

type Decoder<T> = (value: unknown, path: string) => T;

function fail(path: string, expected: string): never {
  throw new ContractError(`${path} : ${expected} attendu`);
}

function record(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(path, "objet");
  }
  return value as Readonly<Record<string, unknown>>;
}

export const text: Decoder<string> = (value, path) => (typeof value === "string" ? value : fail(path, "texte"));

export const integer: Decoder<number> = (value, path) =>
  typeof value === "number" && Number.isInteger(value) ? value : fail(path, "entier");

/** Valeur JSON quelconque, recopiée sans interprétation : une valeur de définition Atlas. */
export const json: Decoder<unknown> = (value) => value;

export const boolean: Decoder<boolean> = (value, path) => (typeof value === "boolean" ? value : fail(path, "booléen"));

/** Horodatage ISO 8601 avec fuseau explicite. */
export const instant: Decoder<Date> = (value, path) => {
  const raw = text(value, path);
  const parsed = new Date(raw);
  return /(Z|[+-]\d{2}:\d{2})$/.test(raw) && !Number.isNaN(parsed.getTime()) ? parsed : fail(path, "horodatage avec fuseau");
};

export function oneOf<T extends string>(values: readonly T[]): Decoder<T> {
  return (value, path) => ((values as readonly unknown[]).includes(value) ? (value as T) : fail(path, values.join(" | ")));
}

export function nullable<T>(decode: Decoder<T>): Decoder<T | null> {
  return (value, path) => (value === null ? null : decode(value, path));
}

export function list<T>(decode: Decoder<T>): Decoder<readonly T[]> {
  return (value, path) => (Array.isArray(value) ? value.map((item, index) => decode(item, `${path}[${String(index)}]`)) : fail(path, "liste"));
}

type Shape<T> = { readonly [K in keyof T]: Decoder<T[K]> };

/** Objet dont chaque champ est présent et décodé ; les champs inconnus sont ignorés. */
export function object<T>(shape: Shape<T>): Decoder<T> {
  return (value, path) => {
    const source = record(value, path);
    const result: Partial<T> = {};
    for (const key of Object.keys(shape) as (keyof T & string)[]) {
      if (!Object.hasOwn(source, key)) {
        fail(`${path}.${key}`, "champ");
      }
      result[key] = shape[key](source[key], `${path}.${key}`);
    }
    return result as T;
  };
}
