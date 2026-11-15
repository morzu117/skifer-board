import { describe, expect, it } from "vitest";
import raw from "../../../../contracts/themes/tokens.v1.json";
import { contrastRatio, SKIFER_ARDOISE, SKIFER_CLAIR } from "../charts/theme";
import { tokens } from "../design/tokens";
import { admissible, BASES, contrastOf, decodeTokenCatalog, TOKEN_CATALOG } from "./catalog";

function flatten(value: object, prefix = ""): Record<string, string> {
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    const name = prefix === "" ? key : `${prefix}.${key}`;
    return typeof child === "string" ? [[name, child]] : Object.entries(flatten(child as object, name));
  }));
}
const colors = flatten(tokens.color);
describe("catalogue de tokens", () => {
  it("recalcule tous les contrastes et les deux ensembles admissibles sur chaque base", () => {
    expect(Object.keys(TOKEN_CATALOG.luminance).sort()).toEqual(Object.keys(colors).sort());
    for (const [base, surface] of [["skifer-clair", SKIFER_CLAIR.surface], ["skifer-ardoise", SKIFER_ARDOISE.surface]] as const) {
      for (const [name, hex] of Object.entries(colors)) expect(contrastOf(TOKEN_CATALOG, base, name)).toBeCloseTo(contrastRatio(hex, surface), 12);
      for (const [role, threshold] of [["mark", 3], ["text", 4.5]] as const) {
        const expected = Object.entries(colors).filter(([, hex]) => contrastRatio(hex, surface) >= threshold).map(([name]) => name).sort();
        expect([...admissible(TOKEN_CATALOG, base, role)].sort()).toEqual(expected);
        for (const name of expected) expect(TOKEN_CATALOG.bases[base][role][name]).toBeCloseTo(contrastRatio(colors[name] as string, surface), 12);
      }
    }
  });
  it("refuse les champs et valeurs incohérents", () => {
    expect(BASES).toHaveLength(2);
    const clone = () => structuredClone(raw) as unknown as Record<string, unknown>;
    const badVersion = clone(); badVersion.api_version = "autre";
    const extra = clone(); extra.extra = true;
    const surface = clone(); ((surface.bases as Record<string, Record<string, unknown>>)["skifer-clair"] as Record<string, unknown>).surface = "autre";
    const lum = clone(); (lum.luminance as Record<string, unknown>).ink = NaN;
    const missing = clone(); delete (missing.luminance as Record<string, unknown>).ink;
    const contrast = clone(); ((contrast.bases as Record<string, { mark: Record<string, number> }>)["skifer-clair"] as { mark: Record<string, number> }).mark.blue = 5;
    for (const value of [badVersion, extra, surface, lum, missing, contrast]) expect(() => decodeTokenCatalog(value)).toThrow();
    expect(() => contrastOf(TOKEN_CATALOG, "skifer-clair", "inconnu")).toThrow();
  });
});

it("contrôle les ensembles, les contrastes publiés et les bornes inclusives", () => {
  const clone = () => structuredClone(raw);
  const extra = clone(); (extra.bases["skifer-clair"].mark as Record<string, number>).surface = 3;
  const missing = clone(); delete (missing.bases["skifer-clair"].mark as Record<string, number>).blue;
  const offset = clone(); offset.bases["skifer-clair"].mark.blue += 0.001;
  const outOfRange = clone(); outOfRange.luminance.blue = 1.001;
  for (const value of [extra, missing, offset, outOfRange]) expect(() => decodeTokenCatalog(value)).toThrow();
  const edges = clone();
  const luminance = edges.luminance as Record<string, number>;
  luminance.surface = 0.03; luminance.ink = 0.19; luminance.ink2 = 0.31; luminance.blue = 0.186;
  for (const base of BASES) {
    const table = edges.bases[base]; const background = luminance[table.surface] as number;
    for (const [role, threshold] of [["mark", 3], ["text", 4.5]] as const) {
      const ratios = Object.fromEntries(Object.entries(luminance).map(([name, value]): [string, number] => [name, (Math.max(value, background) + 0.05) / (Math.min(value, background) + 0.05)]).filter(([, value]) => value >= threshold));
      (table as unknown as Record<string, unknown>)[role] = ratios;
    }
  }
  const decoded = decodeTokenCatalog(edges);
  expect(decoded.bases["skifer-clair"].mark.ink).toBe(3);
  const below = structuredClone(edges);
  (below.bases["skifer-clair"].mark as Record<string, number>).blue = (0.186 + 0.05) / (0.03 + 0.05);
  expect(() => decodeTokenCatalog(below)).toThrow();
  expect(decoded.bases["skifer-clair"].text.ink2).toBe(4.5);
  expect(() => contrastOf(TOKEN_CATALOG, "skifer-clair", "constructor")).toThrow();
  expect(() => contrastOf(TOKEN_CATALOG, "skifer-clair", "toString")).toThrow();
});
