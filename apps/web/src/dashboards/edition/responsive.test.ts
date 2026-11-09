import { describe, expect, it } from "vitest";
import type { DashboardDraft } from "../document";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const cssPath = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const shellCss = readFileSync(cssPath("../../shell/shell.css"), "utf8");
const identityCss = readFileSync(cssPath("../../identity/identity.css"), "utf8");
import { PREVIEW_WIDTHS, SHELL_WIDTH, responsiveLayout } from "./responsive";

const doc: DashboardDraft = { name: "Test", description: "", visibility: "personal", defaults: {}, filters: [], layout: { sections: [{ id: "s", rows: [{ id: "r", columns: [{ id: "a", span: 4, children: [{ id: "v", type: "analysis", reference: { analysis_id: "a", revision: 1 }, presentation: {} }] }, { id: "b", span: 8, children: [{ id: "c", type: "container", rows: [{ id: "inside", columns: [] }] }] }] }] }] } };
describe("mise en page responsive", () => {
  it("lie le seuil de coque à shell.css et applique les max-width inclusifs", () => {
    expect([...shellCss.matchAll(/max-width:\s*(\d+)px/g)].map((match) => Number(match[1]))).toEqual([SHELL_WIDTH, SHELL_WIDTH]);
    expect([...identityCss.matchAll(/max-width:\s*(\d+)px/g)].map((match) => Number(match[1]))).toEqual([SHELL_WIDTH]);
    expect(responsiveLayout(doc, 760)[0]?.rows[0]?.stacked).toBe(true);
    expect(responsiveLayout(doc, 761)[0]?.rows[0]?.stacked).toBe(false);
  });
  it("juge la forme étroite sur la largeur effective de colonne", () => {
    expect(responsiveLayout(doc, 1280)[0]?.rows[0]?.columns[0]?.children[0]?.narrow).toBe(true);
    expect(responsiveLayout(doc, 1500)[0]?.rows[0]?.columns[0]?.children[0]?.narrow).toBe(false);
    expect(responsiveLayout(doc, 480)[0]?.rows[0]?.columns[0]?.children[0]?.narrow).toBe(true);
    expect(responsiveLayout(doc, 481)[0]?.rows[0]?.columns[0]?.children[0]?.narrow).toBe(false);
  });
  it("empile aussi les colonnes imbriquées dans leur ordre et respecte leurs fractions au bureau", () => {
    const nested: DashboardDraft = { ...doc, layout: { sections: [{ id: "s", rows: [{ id: "r", columns: [{ id: "c", span: 12, children: [{ id: "container", type: "container", rows: [{ id: "nested", columns: [{ id: "one", span: 3, children: [] }, { id: "two", span: 9, children: [] }] }] }] }] }] }] } };
    for (const [width, expected] of [[390, [1, 1]], [1280, [0.25, 0.75]]] as const) {
      const row = responsiveLayout(nested, width)[0]?.rows[0]?.columns[0]?.children[0]?.rows?.[0];
      expect(row?.columns.map((column) => column.id)).toEqual(["one", "two"]);
      expect(row?.columns.map((column) => column.fraction)).toEqual(expected);
    }
  });
  it("laisse les séparateurs sans indicateur graphique", () => {
    const other: DashboardDraft = { ...doc, layout: { sections: [{ id: "s", rows: [{ id: "r", columns: [{ id: "c", span: 12, children: [{ id: "sep", type: "separator" }] }] }] }] } };
    expect(responsiveLayout(other, 390)[0]?.rows[0]?.columns[0]?.children[0]).toEqual({ id: "sep", type: "separator" });
  });
  it.each([[PREVIEW_WIDTHS.desktop, false, true], [PREVIEW_WIDTHS.tablet, false, true], [PREVIEW_WIDTHS.phone, true, true], [759, true, false], [760, true, false], [479, true, true], [480, true, true]])("calcule %i px", (width, stacked, narrow) => {
    const row = responsiveLayout(doc, width)[0]?.rows[0];
    expect(row?.stacked).toBe(stacked);
    expect(row?.columns.map((column) => column.id)).toEqual(["a", "b"]);
    expect(row?.columns[0]?.fraction).toBe(stacked ? 1 : 4 / 12);
    expect(row?.columns[0]?.children[0]?.narrow).toBe(narrow);
    expect(row?.columns[1]?.children[0]?.rows?.[0]?.id).toBe("inside");
  });
});
