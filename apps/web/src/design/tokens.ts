/**
 * Tokens du design system, lus depuis `docs/design/tokens.json`, source de vérité déclarée
 * par `tokens.css` (plan 02, W4). Aucune valeur de couleur n'est écrite dans `apps/web`.
 */
import raw from "../../../../docs/design/tokens.json";

export type Tokens = typeof raw;

export const tokens: Tokens = raw;

/** Nom de variable CSS d'un chemin de token : `lineStrong` → `--sb-line-strong`, `success.bg` → `--sb-success-bg`. */
export function cssVariableName(path: readonly string[]): string {
  const kebab = path.map((part) => part.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase());
  return `--sb-${kebab.join("-")}`;
}

/** Couleurs à plat, indexées par leur nom de variable CSS. */
export function flatColors(colors: Record<string, unknown> = tokens.color): Map<string, string> {
  const flat = new Map<string, string>();
  const walk = (node: Record<string, unknown>, path: string[]): void => {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string") {
        flat.set(cssVariableName([...path, key]), value.toUpperCase());
      } else {
        walk(value as Record<string, unknown>, [...path, key]);
      }
    }
  };
  walk(colors, []);
  return flat;
}

/** Couleurs déclarées dans une feuille de tokens CSS (`--sb-x: #RRGGBB;`). */
export function cssColors(css: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of css.matchAll(/(--sb-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)) {
    const [, name, value] = match as unknown as [string, string, string];
    found.set(name, value.toUpperCase());
  }
  return found;
}
