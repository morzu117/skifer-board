import { describe, expect, it } from "vitest";

import { flatColors } from "../design/tokens";
import { baseOption, categoryAxis, contrastRatio, MARK_ROLES, SKIFER_CLAIR, TEXT_ROLES, THEMES, valueAxis } from "./theme";

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
    const axis = valueAxis(SKIFER_CLAIR, (value) => `${value} €`);
    expect(axis.axisLabel.formatter(3)).toBe("3 €");
    expect(axis.splitLine.lineStyle.color).toBe(SKIFER_CLAIR.grid);
  });
});
