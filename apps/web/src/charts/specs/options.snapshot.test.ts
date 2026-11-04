import { tableFromArrays } from "apache-arrow";
import { describe, expect, it } from "vitest";

import { numberColumn } from "../../data/arrow";
import { formatAmount } from "../../format/number";
import { actualVsBudget, monthlyTrend, regionMonthRevenue, revenueBridge, revenueByRegion } from "../../prototype/fixtures";
import { amountWitnesses, categoryWitnesses, sampleFunctions } from "../../test/snapshot-options";
import { THEMES } from "../theme";
import { barsOption, categoryValues } from "./bars";
import { actualVsReference, combinedOption } from "./combined";
import { gridOf, heatmapOption } from "./heatmap";
import { sparklinePath } from "./sparkline";
import { bridgeSteps, waterfallBreak, waterfallOption } from "./waterfall";

const amount = (value: number) => formatAmount(value);
const threshold = { value: 3_500_000, label: `objectif ${amount(3_500_000)}` };
const axisWitnesses = {
  "option.xAxis.axisLabel.formatter": categoryWitnesses,
  "option.yAxis.axisLabel.formatter": amountWitnesses,
};

describe.each(THEMES)("Instantanés des constructeurs · $label", (theme) => {
  for (const horizontal of [false, true]) {
    for (const withThreshold of [false, true]) {
      for (const withSelection of [false, true]) {
        it(`barres ${horizontal ? "horizontales" : "verticales"}, ${withThreshold ? "avec" : "sans"} seuil, ${withSelection ? "avec" : "sans"} sélection`, () => {
          const data = categoryValues(revenueByRegion(), "region", "ca_net");
          const option = barsOption({ data, horizontal, format: amount, selected: withSelection ? ["Occitanie"] : [], ...(withThreshold ? { threshold } : {}) }, theme);
          expect(sampleFunctions(option, {
            "option.xAxis.axisLabel.formatter": horizontal ? amountWitnesses : categoryWitnesses,
            "option.yAxis.axisLabel.formatter": horizontal ? categoryWitnesses : amountWitnesses,
            "option.series.0.label.formatter": [...amountWitnesses.map(([value]) => [{ value }]), [{ value: null }]],
          })).toMatchSnapshot();
        });
      }
    }
  }

  it.each([false, true])("combiné, présence du seuil : %s", (withThreshold) => {
    const option = combinedOption({ data: actualVsReference(actualVsBudget(), "mois", "realise", "budget"), actualLabel: "Réalisé", referenceLabel: "Budget", format: amount, ...(withThreshold ? { threshold } : {}) }, theme);
    expect(sampleFunctions(option, axisWitnesses)).toMatchSnapshot();
  });

  it.each([false, true])("waterfall, rupture d'axe : %s, formes large et étroite", (withBreak) => {
    const table = withBreak ? revenueBridge() : tableFromArrays({
      etape: ["Départ", "Hausse", "Sous-total", "Baisse", "Arrivée"],
      montant: [100_000, 400_000, 500_000, -200_000, 300_000],
      nature: ["total", "variation", "total", "variation", "total"],
    });
    const steps = bridgeSteps(table, "etape", "montant", "nature");
    expect(waterfallBreak(steps) !== null).toBe(withBreak);
    const option = waterfallOption(steps, theme);
    expect(option.media).toBeDefined();
    expect(sampleFunctions(option, {
      ...axisWitnesses,
      "option.series.1.label.formatter": steps.map((_, dataIndex) => [{ dataIndex }]),
    })).toMatchSnapshot();
  });

  it("heatmap, cellules et formes large et étroite", () => {
    const grid = gridOf(regionMonthRevenue(41, 2), "region", "mois", "ca_net");
    const option = heatmapOption(grid, theme, amount);
    expect(option.media).toBeDefined();
    expect(sampleFunctions(option, {
      "option.xAxis.axisLabel.formatter": categoryWitnesses,
      "option.yAxis.axisLabel.formatter": categoryWitnesses,
      "option.series.0.label.formatter": grid.values.flatMap((row, r) => row.map((value, c) => [{ value: [c, r, value] }])),
    })).toMatchSnapshot();
  });

  it("sparkline SVG du KPI, indépendante du thème", () => {
    // La décision 0001 retient un tracé SVG pur, sans option ECharts ni clé media.
    const values = numberColumn(monthlyTrend(3_400_000, 51), "valeur");
    expect({ tracé: sparklinePath(values, 120, 32), avecAbsence: sparklinePath([values[0] ?? null, null, ...values.slice(2)], 120, 32) }).toMatchSnapshot();
  });
});
