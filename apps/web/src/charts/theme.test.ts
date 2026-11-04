import { describe, expect, it } from "vitest";

import { flatColors } from "../design/tokens";
import { baseOption, categoryAxis, contrastRatio, MARK_ROLES, SKIFER_CLAIR, TEXT_ROLES, THEMES, valueAxis } from "./theme";
import { LABEL_LINE_CHARS, NARROW_CHART_WIDTH, narrowMedia, wrapLabel } from "./theme";

const TOKEN_COLORS = new Set(flatColors().values());

describe("thèmes", () => {
  it.each(THEMES)("$label n'utilise que des couleurs du design system", (theme) => {
    const colors = Object.entries(theme)
      .filter(([key]) => !["id", "label", "fontSans", "fontMono"].includes(key))
      .flatMap(([, value]) => (Array.isArray(value) ? (value as string[]) : [value as string]));
    for (const color of colors) {
      expect(TOKEN_COLORS, color).toContain(color.toUpperCase());
    }
  });

  it.each(THEMES)("$label garde 3:1 pour les marques et 4,5:1 pour les textes", (theme) => {
    for (const role of MARK_ROLES) {
      expect(contrastRatio(theme[role], theme.surface), role).toBeGreaterThanOrEqual(3);
    }
    for (const role of TEXT_ROLES) {
      expect(contrastRatio(theme[role], theme.surface), role).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(THEMES)("$label ordonne l'échelle séquentielle du plus faible au plus fort contraste", (theme) => {
    const ratios = theme.sequential.map((color) => contrastRatio(color, theme.surface));
    expect(ratios).toEqual([...ratios].sort((a, b) => a - b));
  });
});

describe("contrastRatio", () => {
  it("calcule le rapport WCAG", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#A4521F", "#FFFFFF")).toBeCloseTo(5.52, 2);
  });
});

describe("options communes", () => {
  it("désactive l'aria générée et applique les polices", () => {
    const option = baseOption(SKIFER_CLAIR);
    expect(option.aria.enabled).toBe(false);
    expect(option.textStyle.fontFamily).toBe(SKIFER_CLAIR.fontSans);
  });

  it("construit les axes aux couleurs du thème", () => {
    expect(categoryAxis(SKIFER_CLAIR, ["a"]).data).toEqual(["a"]);
    expect(categoryAxis(SKIFER_CLAIR, ["a"]).axisLabel.interval).toBe(0);
    expect(categoryAxis(SKIFER_CLAIR, Array.from({ length: 41 }, String)).axisLabel).not.toHaveProperty("overflow");
    const axis = valueAxis(SKIFER_CLAIR, (value) => `${value} €`);
    expect(axis.axisLabel.formatter(3)).toBe("3 €");
    expect(axis.splitLine.lineStyle.color).toBe(SKIFER_CLAIR.grid);
  });
});

describe("étiquettes et forme étroite", () => {
  it("revient à la ligne entre les mots, jamais au milieu", () => {
    expect(LABEL_LINE_CHARS).toBe(16);
    expect(wrapLabel("Corse")).toBe("Corse");
    expect(wrapLabel("Île-de-France")).toBe("Île-de-France");
    expect(wrapLabel("Provence-Alpes-Côte d'Azur")).toBe("Provence-Alpes-\nCôte d'Azur");
    expect(wrapLabel("Bourgogne-Franche-Comté")).toBe("Bourgogne-\nFranche-Comté");
    expect(wrapLabel("Centre-Val de Loire", 8)).toBe("Centre-\nVal de\nLoire");
    expect(wrapLabel("Anticonstitutionnellement", 8)).toBe("Anticonstitutionnellement");
    expect(wrapLabel("")).toBe("");
  });

  it("formate les catégories par ce retour à la ligne", () => {
    const axis = categoryAxis(SKIFER_CLAIR, ["Auvergne-Rhône-Alpes"]).axisLabel as { formatter: (value: string) => string };
    expect(axis.formatter("Auvergne-Rhône-Alpes")).toBe("Auvergne-Rhône-\nAlpes");
  });

  it("masque une graduation de valeurs qui en chevauche une autre", () => {
    expect(valueAxis(SKIFER_CLAIR, String).axisLabel.hideOverlap).toBe(true);
  });

  it("déclare une forme large par défaut et une forme étroite sous 480 px", () => {
    expect(NARROW_CHART_WIDTH).toBe(480);
    expect(narrowMedia({ a: 1 }, { a: 2 })).toEqual([{ option: { a: 1 } }, { query: { maxWidth: 480 }, option: { a: 2 } }]);
  });
});
