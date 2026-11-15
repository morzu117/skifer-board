import contract from "../../../../contracts/themes/tokens.v1.json";
import schema from "../../../../contracts/themes/theme.v1.json";
import { exact, fail, record } from "../analyses/shape";

/** Catalogue publié avec l'application ; les valeurs sont des luminances et contrastes, jamais des couleurs. */
export const BASES = ["skifer-clair", "skifer-ardoise"] as const;
export const ROLES = ["mark", "text"] as const;
export type Base = (typeof BASES)[number];
export type Role = (typeof ROLES)[number];
export type Token = string;
export interface TokenCatalog {
  api_version: "board.theme_tokens/v1";
  bases: Readonly<Record<Base, { surface: Token; mark: Readonly<Record<Token, number>>; text: Readonly<Record<Token, number>> }>>;
  luminance: Readonly<Record<Token, number>>;
}

const names = schema.$defs.token.enum;
function scalar(value: unknown, path: string, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : fail(path, `nombre de ${String(min)} à ${String(max)}`);
}
function ratio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Refuse les clés inconnues, les tables incomplètes et les contrastes incohérents. */
export function decodeTokenCatalog(value: unknown): TokenCatalog {
  const found = exact(value, ["api_version", "bases", "luminance"], "catalogue");
  if (found.api_version !== "board.theme_tokens/v1") return fail("catalogue.api_version", "board.theme_tokens/v1");
  const values = exact(found.luminance, names, "catalogue.luminance");
  const luminance = Object.fromEntries(names.map((name) => [name, scalar(values[name], `catalogue.luminance.${name}`, 0, 1)]));
  const bases = exact(found.bases, BASES, "catalogue.bases");
  function base(name: Base) {
    const path = `catalogue.bases.${name}`;
    const entry = exact(bases[name], ["surface", "mark", "text"], path);
    const surface = name === "skifer-clair" ? "surface" : "slate900";
    if (entry.surface !== surface) return fail(`${path}.surface`, surface);
    function role(roleName: Role, threshold: number): Readonly<Record<string, number>> {
      const pathRole = `${path}.${roleName}`;
      const table = record(entry[roleName], pathRole);
      const expected = names.filter((token) => ratio(luminance[token] as number, luminance[surface] as number) >= threshold);
      exact(table, expected, pathRole);
      return Object.fromEntries(expected.map((token) => {
        const value = scalar(table[token], `${pathRole}.${token}`, threshold, 21);
        if (Math.abs(value - ratio(luminance[token] as number, luminance[surface] as number)) > 1e-12) return fail(`${pathRole}.${token}`, "contraste cohérent");
        return [token, value];
      }));
    }
    return { surface, mark: role("mark", 3), text: role("text", 4.5) };
  }
  return { api_version: "board.theme_tokens/v1", bases: { "skifer-clair": base("skifer-clair"), "skifer-ardoise": base("skifer-ardoise") }, luminance };
}

export const TOKEN_CATALOG = decodeTokenCatalog(contract);
export const admissible = (catalog: TokenCatalog, base: Base, role: Role): readonly Token[] => Object.keys(catalog.bases[base][role]);
export function contrastOf(catalog: TokenCatalog, base: Base, token: Token): number {
  if (!Object.hasOwn(catalog.luminance, token)) return fail("token", "token connu");
  const value = catalog.luminance[token] as number;
  return ratio(value, catalog.luminance[catalog.bases[base].surface] as number);
}
