import { tableFromArrays } from "apache-arrow";
import { describe, expect, it } from "vitest";

import { formatAmount } from "../../format/number";
import { SKIFER_ARDOISE, SKIFER_CLAIR } from "../theme";
import { barsDescription, barsOption, barStyle, categoryItems, categoryValues, extremes, type CategoryValues } from "./bars";
import { actualVsReference, combinedDescription, combinedOption, periodItems, type CombinedInput } from "./combined";
import { binOf, binsOf, cellItems, gridOf, heatmapDescription, heatmapOption, labelColor, type Grid } from "./heatmap";
import { sparklinePath } from "./sparkline";
import { BridgeError, bridgeSteps, checkBridge, stepItems, stepText, waterfallDescription, waterfallOption, type BridgeStep } from "./waterfall";

const plain = (text: string): string => text.replace(/[\u00a0\u202f]/g, " ");
const amount = (value: number): string => formatAmount(value);

interface Series {
  data: unknown[];
  label: { formatter: (params: unknown) => string };
  markLine?: { data: unknown[] };
}
const series = (option: object, index = 0): Series => (option as { series: Series[] }).series[index] as Series;

const regions: CategoryValues = { categories: ["IDF", "ARA", "OCC"], values: [7_200_000, 5_400_000, null] };

describe("histogramme", () => {
  it("lit les catégories d'un résultat Arrow", () => {
    const table = tableFromArrays({ region: ["IDF"], ca: Float64Array.from([1]) });
    expect(categoryValues(table, "region", "ca")).toEqual({ categories: ["IDF"], values: [1] });
  });

  it("colore selon la sélection", () => {
    expect(barStyle(SKIFER_CLAIR, [], "IDF")).toEqual({ color: SKIFER_CLAIR.series });
    expect(barStyle(SKIFER_CLAIR, ["IDF"], "IDF")).toEqual({ color: SKIFER_CLAIR.selected });
    expect(barStyle(SKIFER_CLAIR, ["IDF"], "ARA")).toEqual({ color: SKIFER_CLAIR.unselectedFill, borderColor: SKIFER_CLAIR.unselectedEdge, borderWidth: 1 });
  });

  it("place les axes et le seuil selon l'orientation", () => {
    const vertical = barsOption({ data: regions, selected: [], format: amount, threshold: { value: 4, label: "objectif" } }, SKIFER_CLAIR) as { xAxis: { type: string } };
    expect(vertical.xAxis.type).toBe("category");
    expect(series(vertical).markLine?.data).toEqual([{ yAxis: 4 }]);
    const horizontal = barsOption({ data: regions, selected: [], format: amount, threshold: { value: 4, label: "objectif" }, horizontal: true }, SKIFER_CLAIR) as { yAxis: { inverse: boolean } };
    expect(horizontal.yAxis.inverse).toBe(true);
    expect(series(horizontal).markLine?.data).toEqual([{ xAxis: 4 }]);
    expect(series(barsOption({ data: regions, selected: [], format: amount }, SKIFER_CLAIR)).markLine).toBeUndefined();
  });

  it("étiquette les valeurs et les absences", () => {
    const { formatter } = series(barsOption({ data: regions, selected: [], format: amount }, SKIFER_CLAIR)).label;
    expect(plain(formatter({ value: 7_200_000 }))).toBe("7,2 M€");
    expect(formatter({ value: null })).toBe("—");
  });

  it("décrit les extrêmes et la sélection", () => {
    expect(plain(barsDescription("CA net", regions, ["IDF"], amount))).toBe(
      "Histogramme de CA net, 3 catégories, valeur la plus forte IDF (7,2 M€), la plus faible ARA (5,4 M€). Sélection : IDF.",
    );
    expect(barsDescription("CA net", { categories: ["a"], values: [null] }, [], amount)).toBe("Histogramme de CA net, 1 catégories, aucune valeur. Aucune sélection.");
    expect(extremes({ categories: ["a", "b"], values: [1] })).toEqual({ max: ["a", 1], min: ["a", 1] });
  });

  it("annonce chaque barre", () => {
    expect(categoryItems(regions, amount).map((item) => plain(item.announcement))).toEqual(["IDF : 7,2 M€", "ARA : 5,4 M€", "OCC : —"]);
    expect(categoryItems({ categories: ["a"], values: [] }, amount)[0]?.announcement).toBe("a : —");
  });
});

const combined: CombinedInput = {
  data: { periods: ["2026-01", "2026-02", "2026-03"], actual: [3, null, 5], reference: [2, 4, 6] },
  actualLabel: "Réalisé",
  referenceLabel: "Budget",
  format: (value) => `${value}`,
};

describe("graphique combiné", () => {
  it("lit deux métriques d'un résultat", () => {
    const table = tableFromArrays({ mois: ["2026-01"], r: Float64Array.from([1]), b: Float64Array.from([2]) });
    expect(actualVsReference(table, "mois", "r", "b")).toEqual({ periods: ["2026-01"], actual: [1], reference: [2] });
  });

  it("superpose barres et ligne, avec ou sans seuil", () => {
    const option = combinedOption({ ...combined, threshold: { value: 4, label: "objectif" } }, SKIFER_CLAIR) as { xAxis: { data: string[] } };
    expect(option.xAxis.data).toEqual(["janv.", "févr.", "mars"]);
    expect(series(option, 1).data).toEqual([2, 4, 6]);
    expect(series(option).markLine).toBeDefined();
    expect(series(combinedOption(combined, SKIFER_CLAIR)).markLine).toBeUndefined();
  });

  it("décrit la période et les dépassements", () => {
    expect(combinedDescription(combined)).toBe("Graphique combiné, Réalisé en barres et Budget en ligne, de janvier 2026 à mars 2026. Réalisé atteint ou dépasse Budget sur 1 période(s) sur 3.");
    expect(combinedDescription({ ...combined, data: { periods: [], actual: [], reference: [] } })).toContain("aucune période");
    expect(combinedDescription({ ...combined, data: { periods: ["2026-01"], actual: [3], reference: [] } })).toContain("sur 0 période(s) sur 1");
  });

  it("annonce chaque période, valeurs absentes comprises", () => {
    expect(periodItems(combined).map((item) => item.announcement)).toEqual([
      "janvier 2026 : Réalisé 3, Budget 2",
      "février 2026 : Réalisé —, Budget 4",
      "mars 2026 : Réalisé 5, Budget 6",
    ]);
    expect(periodItems({ ...combined, data: { periods: ["2026-01"], actual: [], reference: [] } })[0]?.announcement).toBe("janvier 2026 : Réalisé —, Budget —");
  });
});

const bridge: BridgeStep[] = [
  { label: "T2", value: 100, kind: "total" },
  { label: "Volume", value: 30, kind: "variation" },
  { label: "Prix", value: -20, kind: "variation" },
  { label: "T3", value: 110, kind: "total" },
];

describe("waterfall", () => {
  it("lit un pont depuis Arrow et le contrôle", () => {
    const table = tableFromArrays({ e: ["T2", "Volume", "T3"], m: Float64Array.from([100, 10, 110]), n: ["total", "variation", "total"] });
    expect(bridgeSteps(table, "e", "m", "n")).toHaveLength(3);
    const missing = tableFromArrays({ e: ["T2"], m: [null], n: ["total"] });
    expect(() => bridgeSteps(missing, "e", "m", "n")).toThrow("Étape sans valeur : T2");
    const unknown = tableFromArrays({ e: ["T2"], m: Float64Array.from([1]), n: ["autre"] });
    expect(() => bridgeSteps(unknown, "e", "m", "n")).toThrow("Nature d'étape inconnue : autre");
  });

  it("refuse un pont incohérent", () => {
    expect(() => {
      checkBridge([{ label: "x", value: 1, kind: "variation" }]);
    }).toThrow(BridgeError);
    expect(() => {
      checkBridge([bridge[0] as BridgeStep, bridge[1] as BridgeStep]);
    }).toThrow("commence et finit par un total");
    expect(() => {
      checkBridge([bridge[0] as BridgeStep, { label: "T3", value: 150, kind: "total" }]);
    }).toThrow("ne recoupe pas les variations");
    expect(() => {
      checkBridge([bridge[0] as BridgeStep, { label: "Choc", value: -150, kind: "variation" }, { label: "T3", value: -50, kind: "total" }]);
    }).toThrow("Cumul négatif à l'étape « Choc »");
  });

  it("empile sur une base invisible", () => {
    const option = waterfallOption(bridge, SKIFER_CLAIR);
    expect(series(option, 0).data).toEqual([0, 100, 110, 0]);
    expect(series(option, 1).data).toEqual([
      { value: 100, itemStyle: { color: SKIFER_CLAIR.total } },
      { value: 30, itemStyle: { color: SKIFER_CLAIR.positive } },
      { value: 20, itemStyle: { color: SKIFER_CLAIR.negative } },
      { value: 110, itemStyle: { color: SKIFER_CLAIR.total } },
    ]);
    expect(series(option, 1).label.formatter({ dataIndex: 2 })).toBe("−20 €");
  });

  it("décrit, étiquette et annonce les étapes", () => {
    expect(stepText(bridge[1] as BridgeStep)).toBe("+30 €");
    expect(plain(waterfallDescription("CA", bridge))).toBe("Waterfall de CA, de T2 (100 €) à T3 (110 €), 2 variations. Contribution la plus forte : Volume (+30 €).");
    expect(waterfallDescription("CA", [bridge[0] as BridgeStep, { label: "T3", value: 100, kind: "total" }])).not.toContain("Contribution");
    expect(stepItems(bridge).map((item) => item.key)).toEqual(["T2", "Volume", "Prix", "T3"]);
  });
});

const grid: Grid = { rows: ["IDF", "OCC"], columns: ["2026-01", "2026-02"], values: [[10, 50], [30, null]] };

describe("heatmap", () => {
  it("construit la grille depuis un résultat long", () => {
    const table = tableFromArrays({ r: ["IDF", "IDF", "OCC"], m: ["2026-01", "2026-02", "2026-01"], v: Float64Array.from([10, 50, 30]) });
    expect(gridOf(table, "r", "m", "v")).toEqual(grid);
  });

  it("quantifie sur les paliers du thème", () => {
    const bins = binsOf(grid, SKIFER_CLAIR);
    expect(bins.map((bin) => bin.color)).toEqual(SKIFER_CLAIR.sequential);
    expect(bins[0]).toEqual({ from: 10, to: 18, color: SKIFER_CLAIR.sequential[0] });
    expect(bins.at(-1)?.to).toBe(50);
    expect(binOf(bins, 50).color).toBe(SKIFER_CLAIR.sequential.at(-1));
    expect(binOf(bins, 99).color).toBe(SKIFER_CLAIR.sequential.at(-1));
    expect(binsOf({ rows: ["a"], columns: ["2026-01"], values: [[5]] }, SKIFER_CLAIR)).toEqual([{ from: 5, to: 5, color: SKIFER_CLAIR.sequential[0] }]);
    expect(binsOf({ rows: [], columns: [], values: [] }, SKIFER_CLAIR)).toEqual([]);
  });

  it("choisit le texte le plus lisible sur chaque cellule", () => {
    expect(labelColor(SKIFER_CLAIR, SKIFER_CLAIR.sequential[0] as string)).toBe(SKIFER_CLAIR.textStrong);
    expect(labelColor(SKIFER_CLAIR, SKIFER_CLAIR.sequential.at(-1) as string)).toBe(SKIFER_CLAIR.surface);
  });

  it("ne dessine que les cellules présentes", () => {
    const option = heatmapOption(grid, SKIFER_CLAIR, (value) => `${value}`);
    const cells = series(option).data as { value: number[] }[];
    expect(cells.map((cell) => cell.value)).toEqual([[0, 0, 10], [1, 0, 50], [0, 1, 30]]);
    expect(series(option).label.formatter({ value: [0, 0, 10] })).toBe("10");
  });

  it("décrit les extrêmes et annonce chaque cellule", () => {
    expect(heatmapDescription("CA", grid, (value) => `${value}`)).toBe("Carte de chaleur de CA, 2 lignes sur 2 colonnes, de 10 (IDF, janvier 2026) à 50 (IDF, février 2026).");
    expect(heatmapDescription("CA", { rows: ["a"], columns: ["2026-01"], values: [[null]] }, String)).toBe("Carte de chaleur de CA, 1 lignes sur 1 colonnes, aucune valeur.");
    expect(cellItems(grid, (value) => `${value}`).map((item) => item.announcement)).toEqual([
      "IDF, janvier 2026 : 10",
      "IDF, février 2026 : 50",
      "OCC, janvier 2026 : 30",
      "OCC, février 2026 : aucune valeur",
    ]);
    expect(cellItems({ rows: ["a"], columns: ["2026-01"], values: [] }, String)[0]?.announcement).toBe("a, janvier 2026 : aucune valeur");
  });
});

describe("sparkline", () => {
  it("trace, interrompt sur les absences et gère les cas limites", () => {
    expect(sparklinePath([0, 10], 100, 20)).toBe("M2.0 18.0L98.0 2.0");
    expect(sparklinePath([0, null, 10], 100, 20)).toBe("M2.0 18.0M98.0 2.0");
    expect(sparklinePath([5, 5], 100, 20)).toBe("M2.0 10.0L98.0 10.0");
    expect(sparklinePath([5], 100, 20)).toBe("M2.0 10.0");
    expect(sparklinePath([null], 100, 20)).toBe("");
  });
});

describe("un thème ne change pas les valeurs (W8)", () => {
  /** Les valeurs de données d'une option, sans aucun attribut de style. */
  const dataOf = (option: object): unknown => {
    const strip = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        return value.map(strip);
      }
      if (value !== null && typeof value === "object") {
        return "value" in value ? strip(value.value) : value;
      }
      return value;
    };
    const typed = option as { series: { data: unknown[] }[]; xAxis: { data?: unknown }; yAxis: { data?: unknown } };
    return { series: typed.series.map((item) => strip(item.data)), x: typed.xAxis.data, y: typed.yAxis.data };
  };

  it.each([
    ["histogramme", (theme: typeof SKIFER_CLAIR) => barsOption({ data: regions, selected: ["IDF"], format: amount }, theme)],
    ["combiné", (theme: typeof SKIFER_CLAIR) => combinedOption(combined, theme)],
    ["waterfall", (theme: typeof SKIFER_CLAIR) => waterfallOption(bridge, theme)],
    ["heatmap", (theme: typeof SKIFER_CLAIR) => heatmapOption(grid, theme, String)],
  ])("%s", (_, build) => {
    expect(dataOf(build(SKIFER_ARDOISE))).toEqual(dataOf(build(SKIFER_CLAIR)));
    expect(build(SKIFER_ARDOISE)).not.toEqual(build(SKIFER_CLAIR));
  });
});
