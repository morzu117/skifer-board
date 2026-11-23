import parity from "../../../../contracts/themes/fixtures/palette-parity.json";
import { describe, expect, it } from "vitest";
import { contrastRatio, MARK_ROLES, SKIFER_ARDOISE, SKIFER_CLAIR, TEXT_ROLES } from "../charts/theme";
import { TOKEN_CATALOG, type TokenCatalog } from "./catalog";
import { tokens } from "../design/tokens";
import { chartThemeOf, dashboardChartTheme, increasingContrast, MIN_STEP_RATIO, themePaletteProblems, themeProblems, ThemePaletteError, ThemeTokenError } from "./chartTheme";
import { decodeTheme, type ThemeDocument } from "./document";

const fixtures = import.meta.glob<unknown>("../../../../contracts/themes/fixtures/valid/*.json", { eager: true, import: "default" });
const themes = Object.values(fixtures).map((value) => decodeTheme(value));
const clair = themes.find((theme) => theme.base === "skifer-clair") as ThemeDocument;

describe("construction du thème graphique", () => {
  it("reproduit les deux thèmes de base champ par champ", () => {
    const light = decodeTheme(fixtures["../../../../contracts/themes/fixtures/valid/skifer_clair.json"]);
    const dark = decodeTheme(fixtures["../../../../contracts/themes/fixtures/valid/skifer_ardoise.json"]);
    expect(chartThemeOf(light, TOKEN_CATALOG)).toEqual(SKIFER_CLAIR);
    expect(chartThemeOf(dark, TOKEN_CATALOG)).toEqual(SKIFER_ARDOISE);
  });
  it("respecte les contrastes des fixtures publiées", () => {
    expect(themes.length).toBeGreaterThan(0);
    for (const theme of themes) {
      const chart = chartThemeOf(theme, TOKEN_CATALOG);
      for (const role of MARK_ROLES) expect(contrastRatio(chart[role], chart.surface), `${theme.name} ${role}`).toBeGreaterThanOrEqual(3);
      for (const role of TEXT_ROLES) expect(contrastRatio(chart[role], chart.surface), `${theme.name} ${role}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("applique les quatre rôles de texte du document", () => {
    const changed = { ...clair, roles: { ...clair.roles, text: { text: "ink", textStrong: "ink2", textMuted: "ink", thresholdLabel: "ink2" } } };
    const result = chartThemeOf(changed, TOKEN_CATALOG);
    expect(result.text).toBe(tokens.color.ink);
    expect(result.textStrong).toBe(tokens.color.ink2);
    expect(result.textMuted).toBe(tokens.color.ink);
    expect(result.thresholdLabel).toBe(tokens.color.ink2);
    for (const role of TEXT_ROLES) expect(contrastRatio(result[role], result.surface)).toBeGreaterThanOrEqual(4.5);
  });
  it("refuse les tokens inconnus ou hors rôle et dérive une bordure contrastée", () => {
    const malformed = (name: string) => ({ ...clair, roles: { ...clair.roles, marks: { ...clair.roles.marks, series: name } } });
    expect(() => chartThemeOf(malformed("inconnu"), TOKEN_CATALOG)).toThrow(ThemeTokenError);
    try { chartThemeOf(malformed("inconnu"), TOKEN_CATALOG); } catch (error) { expect(error).toMatchObject({ code: "unknown_token" }); }
    expect(() => chartThemeOf(malformed("surface"), TOKEN_CATALOG)).toThrow("inadmissible_token");
    const changed = chartThemeOf(malformed("ink"), TOKEN_CATALOG);
    expect(changed.unselectedEdge).toBe(changed.series);
    expect(changed.unselectedFill).toBe(SKIFER_CLAIR.grid);
    const faulty = { ...TOKEN_CATALOG, bases: { ...TOKEN_CATALOG.bases, "skifer-clair": { ...TOKEN_CATALOG.bases["skifer-clair"], mark: { ...TOKEN_CATALOG.bases["skifer-clair"].mark, surface: 3 } } } } as TokenCatalog;
    expect(chartThemeOf(malformed("surface"), faulty).unselectedEdge).toBe(SKIFER_CLAIR.unselectedEdge);
    expect(() => chartThemeOf({ ...clair, roles: { ...clair.roles, text: { ...clair.roles.text, text: "surface" } } }, TOKEN_CATALOG)).toThrow("inadmissible_token");
    expect(() => chartThemeOf({ ...clair, sequential: ["inconnu"] }, TOKEN_CATALOG)).toThrow("token_not_admissible");
    expect(() => chartThemeOf(malformed("constructor"), TOKEN_CATALOG)).toThrow("unknown_token");
    const forged = { ...TOKEN_CATALOG, luminance: { ...TOKEN_CATALOG.luminance, "blue.bad": 0, success: 0 } };
    expect(() => chartThemeOf(malformed("blue.bad"), forged)).toThrow("unknown_token");
    expect(() => chartThemeOf(malformed("success"), forged)).toThrow("unknown_token");
  });
  it("signale une référence non résolue", () => {
    expect(dashboardChartTheme({}, undefined, TOKEN_CATALOG)).toEqual({ theme: SKIFER_CLAIR });
    const reference = { theme: { theme_id: clair.id, revision: 1 } };
    expect(dashboardChartTheme(reference, undefined, TOKEN_CATALOG)).toEqual({ theme: SKIFER_CLAIR, problem: "theme_unavailable" });
    expect(dashboardChartTheme(reference, undefined, TOKEN_CATALOG)).toEqual({ theme: SKIFER_CLAIR, problem: "theme_unavailable" });
    expect(dashboardChartTheme(reference, undefined, TOKEN_CATALOG)).toEqual({ theme: SKIFER_CLAIR, problem: "theme_unavailable" });
    expect(dashboardChartTheme(reference, { components: {}, theme: { ...clair, id: "autre" } }, TOKEN_CATALOG).problem).toBe("theme_unavailable");
    expect(dashboardChartTheme(reference, { components: {}, theme: clair }, TOKEN_CATALOG)).toEqual({ theme: chartThemeOf(clair, TOKEN_CATALOG) });
  });
  it("signale les erreurs de palette ou de token sans masquer les autres erreurs", () => {
    const ref = { theme: { theme_id: clair.id, revision: 1 } };
    const invalidPalette = { ...clair, sequential: ["blue", "blue", "blue"] };
    expect(dashboardChartTheme(ref, { components: {}, theme: invalidPalette }, TOKEN_CATALOG)).toEqual({ theme: SKIFER_CLAIR, problem: "theme_unavailable" });
    const invalidRole = { ...clair, roles: { ...clair.roles, text: { ...clair.roles.text, text: "inconnu" } } };
    expect(dashboardChartTheme(ref, { components: {}, theme: invalidRole }, TOKEN_CATALOG)).toEqual({ theme: SKIFER_CLAIR, problem: "theme_unavailable" });
    const broken = new Proxy(clair, { get(target, key, receiver): unknown { if (key === "sequential") throw new Error("panne"); return Reflect.get(target, key, receiver) as unknown; } });
    expect(() => dashboardChartTheme(ref, { components: {}, theme: broken }, TOKEN_CATALOG)).toThrow("panne");
  });
});

const invalid = import.meta.glob<ThemeDocument>("../../../../contracts/themes/fixtures/invalid/*.json", { eager: true, import: "default" });
it("restitue les mêmes chemins et codes que le serveur pour les palettes", () => {
  for (const [name, path, rule] of [
    ["sequential_last_under", "/sequential/2", "token_not_admissible"],
    ["sequential_contrast_order", "/sequential", "not_monotone"],
    ["sequential_equal", "/sequential", "not_monotone"],
    ["sequential_small_step", "/sequential", "not_monotone"],
    ["diverging_wing_equal", "/diverging", "not_monotone"],
    ["diverging_center_equal", "/diverging", "diverging_sides"],
    ["diverging_endpoint_under", "/diverging/0", "token_not_admissible"],
    ["palette_unknown", "/sequential/1", "token_not_admissible"],
    ["diverging_unknown", "/diverging/0", "token_not_admissible"],
    ["diverging_even", "/diverging", "even_diverging"],
    ["diverging_center", "/diverging/1", "non_neutral"],
    ["diverging_sides", "/diverging", "diverging_sides"],
    ["diverging_order", "/diverging", "not_monotone"],
    ["categorical_same_color", "/categorical", "duplicate_color"],
  ] as const) {
    const value = invalid[`../../../../contracts/themes/fixtures/invalid/${name}.json`] as ThemeDocument;
    expect(themePaletteProblems(value, TOKEN_CATALOG), name).toContainEqual({ path, rule });
    expect(() => chartThemeOf(value, TOKEN_CATALOG)).toThrow(ThemePaletteError);
    if (name === "palette_unknown") {
      try { chartThemeOf(value, TOKEN_CATALOG); } catch (error) { expect(error).toMatchObject({ code: "token_not_admissible", path: "/sequential/1" }); }
    }
  }
});

it("inclut exactement le facteur minimal et refuse un pas inférieur", () => {
  expect(MIN_STEP_RATIO).toBe(1.1);
  expect(increasingContrast([1, 1.1])).toBe(true);
  expect(increasingContrast([1, 1.100001])).toBe(true);
  expect(increasingContrast([1, 1.099999])).toBe(false);
  expect(increasingContrast([1, 1])).toBe(false);
});

it("aligne toutes les violations sémantiques des fixtures de palettes sur le serveur", () => {
  expect(Object.keys(parity).sort()).toEqual(Object.keys(invalid).map((path) => path.split("/").at(-1)?.replace(/\.json$/, "")).sort());
  for (const [name, expected] of Object.entries(parity)) {
    const value = invalid[`../../../../contracts/themes/fixtures/invalid/${name}.json`] as ThemeDocument;
    const actual = themeProblems(value, TOKEN_CATALOG);
    expect(actual, name).toEqual(expected);
  }
});

it("ordonne les violations structurelles et les chemins de couleurs brutes", () => {
  const many = { ...clair, categorical: Array.from({ length: 9 }, () => "blue"), sequential: ["surface", "absent", "ink"] };
  expect(themeProblems(many, TOKEN_CATALOG)).toEqual([
    { path: "/categorical", rule: "duplicate_item" },
    { path: "/categorical", rule: "out_of_bounds" },
    { path: "/sequential/1", rule: "token_not_admissible" },
  ]);
  const withHex = { ...clair, "x/y~z": "#123456", nullable: null, name: "#abcdef" };
  expect(themeProblems(withHex, TOKEN_CATALOG)).toEqual([
    { path: "/name", rule: "hex_color" },
    { path: "/x~1y~0z", rule: "hex_color" },
  ]);
});
