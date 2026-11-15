import { contrastRatio, SKIFER_ARDOISE, SKIFER_CLAIR, type ChartTheme } from "../charts/theme";
import { tokens } from "../design/tokens";
import type { DashboardDocument } from "../dashboards/document";
import type { DashboardRevision } from "../dashboards/model";
import type { TokenCatalog } from "./catalog";
import type { ThemeDocument } from "./document";

/** Erreur fermée : aucun token absent ou non admissible ne devient une couleur de repli. */
export type PaletteRule = "token_not_admissible" | "not_monotone" | "even_diverging" | "non_neutral" | "diverging_sides" | "duplicate_color" | "out_of_bounds" | "duplicate_item" | "hex_color";
export interface PaletteProblem { path: string; rule: PaletteRule }
/** Hausse minimale de contraste entre deux paliers, partagée avec theme.py. */
export const MIN_STEP_RATIO = 1.10;
export const increasingContrast = (values: readonly number[]): boolean => values.every((value, i) => i === 0 || value >= (values[i - 1] as number) * MIN_STEP_RATIO);
/** Valide les contrastes des palettes selon la surface de la base, sans accès au serveur. */
export function themePaletteProblems(theme: ThemeDocument, catalog: TokenCatalog): PaletteProblem[] {
  const problems: PaletteProblem[] = [];
  const mark = catalog.bases[theme.base].mark;
  const lights = catalog.luminance;
  const surface = lights[catalog.bases[theme.base].surface] as number;
  const ratio = (name: string) => (Math.max(lights[name] as number, surface) + 0.05) / (Math.min(lights[name] as number, surface) + 0.05);
  for (const palette of ["categorical", "sequential", "diverging"] as const) {
    const values = theme[palette];
    values.forEach((name, i) => {
      const required = palette === "categorical" || (palette === "sequential" && i === values.length - 1) || (palette === "diverging" && (i === 0 || i === values.length - 1));
      if (!Object.hasOwn(lights, name) || (required && !Object.hasOwn(mark, name))) problems.push({ path: `/${palette}/${String(i)}`, rule: "token_not_admissible" });
    });
  }
  const categorical = theme.categorical.filter((name) => Object.hasOwn(lights, name)).map((name) => color(name, catalog).toLowerCase());
  if (new Set(categorical).size !== categorical.length) problems.push({ path: "/categorical", rule: "duplicate_color" });
  if (theme.sequential.every((name) => Object.hasOwn(lights, name)) && !increasingContrast(theme.sequential.map(ratio))) problems.push({ path: "/sequential", rule: "not_monotone" });
  const diverging = theme.diverging;
  if (diverging.length % 2 === 0) problems.push({ path: "/diverging", rule: "even_diverging" });
  else {
    const middle = Math.floor(diverging.length / 2);
    if (!["neutral.fg", "neutral.bg"].includes(diverging[middle] as string)) problems.push({ path: `/diverging/${String(middle)}`, rule: "non_neutral" });
    if (diverging.every((name) => Object.hasOwn(lights, name))) {
      const values = diverging.map(ratio);
      if ((values[0] as number) <= (values[middle] as number) || (values.at(-1) as number) <= (values[middle] as number)) problems.push({ path: "/diverging", rule: "diverging_sides" });
      if (!increasingContrast(values.slice(0, middle + 1).reverse()) || !increasingContrast(values.slice(middle))) problems.push({ path: "/diverging", rule: "not_monotone" });
    }
  }
  return problems;
}
/** Contrôles du format nécessaires avant la validation sémantique des palettes. */
export function themeProblems(theme: ThemeDocument, catalog: TokenCatalog): PaletteProblem[] {
  const hex: PaletteProblem[] = [];
  function scan(value: unknown, path: string): void {
    if (typeof value === "string") { if (/#(?:[0-9a-fA-F]){6}/.test(value)) hex.push({ path, rule: "hex_color" }); }
    else if (Array.isArray(value)) value.forEach((item, i) => { scan(item, `${path}/${String(i)}`); });
    else if (typeof value === "object" && value !== null) Object.entries(value).forEach(([key, item]) => { scan(item, `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`); });
  }
  scan(theme, "");
  if (hex.length > 0) return hex.sort((a, b) => a.path.localeCompare(b.path));
  const structural: PaletteProblem[] = [];
  for (const palette of ["categorical", "sequential", "diverging"] as const) {
    const values = theme[palette];
    const min = palette === "categorical" ? 2 : 3;
    const max = palette === "categorical" ? 8 : 7;
    if (values.length < min || values.length > max) structural.push({ path: `/${palette}`, rule: "out_of_bounds" });
    if (palette === "categorical" && new Set(values).size !== values.length) structural.push({ path: `/${palette}`, rule: "duplicate_item" });
    values.forEach((name, i) => { if (!Object.hasOwn(catalog.luminance, name)) structural.push({ path: `/${palette}/${String(i)}`, rule: "token_not_admissible" }); });
  }
  if (structural.length > 0) return structural.sort((a, b) => a.path.localeCompare(b.path) || a.rule.localeCompare(b.rule));
  const roles: PaletteProblem[] = [];
  for (const [role, category] of [["marks", "mark"], ["text", "text"]] as const) {
    for (const [name, token] of Object.entries(theme.roles[role])) {
      if (!Object.hasOwn(catalog.bases[theme.base][category], token)) roles.push({ path: `/roles/${role}/${name}`, rule: "token_not_admissible" });
    }
  }
  return [...roles, ...themePaletteProblems(theme, catalog)].sort((a, b) => a.path.localeCompare(b.path) || a.rule.localeCompare(b.rule));
}
export class ThemePaletteError extends Error {
  readonly code: PaletteRule;
  readonly path: string;
  constructor(readonly problem: PaletteProblem) { super(problem.rule); this.code = problem.rule; this.path = problem.path; }
}
export class ThemeTokenError extends Error {
  readonly code: "unknown_token" | "inadmissible_token";
  constructor(code: "unknown_token" | "inadmissible_token") { super(code); this.code = code; }
}
function color(name: string, catalog: TokenCatalog): string {
  if (!Object.hasOwn(catalog.luminance, name)) throw new ThemeTokenError("unknown_token");
  let value: unknown = tokens.color;
  for (const part of name.split(".")) {
    if (typeof value !== "object" || value === null || !Object.hasOwn(value, part)) throw new ThemeTokenError("unknown_token");
    value = (value as Record<string, unknown>)[part];
  }
  if (typeof value !== "string") throw new ThemeTokenError("unknown_token");
  return value;
}
/**
 * La base fournit fond et axes. Son id et son label restent inchangés : l'id détermine la classe CSS sb-theme-… .
 * Les palettes catégorielle et divergente n'ont pas encore d'équivalent dans ChartTheme : aucun graphique ne les utilise.
 * L'échelle typographique et la densité n'ont pas non plus d'équivalent ici ; les formats et les défauts par graphique
 * sont appliqués séparément à la présentation des tuiles.
 * Le remplissage non sélectionné utilise celui de la base pour sa série par défaut,
 * sinon le token de grille de la base ;
 * sa bordure est celle de la base lorsque la série est inchangée, sinon la série du thème si
 * son contraste atteint 3:1, et la bordure de la base dans le cas contraire.
 */
export function chartThemeOf(theme: ThemeDocument, catalog: TokenCatalog): ChartTheme {
  const problems = themePaletteProblems(theme, catalog);
  if (problems.length > 0) throw new ThemePaletteError(problems[0] as PaletteProblem);
  const base = theme.base === "skifer-clair" ? SKIFER_CLAIR : SKIFER_ARDOISE;
  const marks = Object.fromEntries(Object.entries(theme.roles.marks).map(([role, name]) => {
    const resolved = color(name, catalog);
    if (!Object.hasOwn(catalog.bases[theme.base].mark, name)) throw new ThemeTokenError("inadmissible_token");
    return [role, resolved];
  }));
  const textRoles = Object.fromEntries(Object.entries(theme.roles.text).map(([role, name]) => {
    const resolved = color(name, catalog);
    if (!Object.hasOwn(catalog.bases[theme.base].text, name)) throw new ThemeTokenError("inadmissible_token");
    return [role, resolved];
  }));
  for (const name of [...theme.categorical, ...theme.diverging]) color(name, catalog);
  const sequential = theme.sequential.map((name) => color(name, catalog));
  const series = marks.series as string;
  const unselectedEdge = series === base.series || contrastRatio(series, base.surface) < 3 ? base.unselectedEdge : series;
  return { ...base, ...marks, ...textRoles, series, unselectedFill: series === base.series ? base.unselectedFill : base.grid, unselectedEdge, sequential, fontSans: tokens.font[theme.typography.sans], fontMono: tokens.font[theme.typography.mono] };
}
export type DashboardThemeResult = { theme: ChartTheme; problem?: "theme_unavailable" };
/** Une référence absente ou invalide est signalée ; le repli est toujours Skifer clair. */
export function dashboardChartTheme(document: Pick<DashboardDocument, "theme">, resolved: DashboardRevision["resolved"], catalog: TokenCatalog): DashboardThemeResult {
  if (document.theme === undefined) return { theme: SKIFER_CLAIR };
  if (resolved?.theme === undefined || resolved.theme.id !== document.theme.theme_id) return { theme: SKIFER_CLAIR, problem: "theme_unavailable" };
  try { return { theme: chartThemeOf(resolved.theme, catalog) }; }
  catch (error) {
    if (error instanceof ThemePaletteError || error instanceof ThemeTokenError) return { theme: SKIFER_CLAIR, problem: "theme_unavailable" };
    throw error;
  }
}
