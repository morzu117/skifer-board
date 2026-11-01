import { describe, expect, it } from "vitest";

import { bridgeSteps } from "../charts/specs/waterfall";
import { numberColumn, stringColumn } from "../data/arrow";
import { actualVsBudget, benchSeries, kpiSnapshots, MONTHS, REGIONS, regionMonthRevenue, revenueBridge, revenueByRegion, seeded } from "./fixtures";

describe("jeux de démonstration", () => {
  it("sont déterministes", () => {
    expect(seeded(1)()).toBe(seeded(1)());
    expect(numberColumn(revenueByRegion(), "ca_net")).toEqual(numberColumn(revenueByRegion(), "ca_net"));
  });

  it("ont la forme attendue", () => {
    expect(stringColumn(revenueByRegion(), "region")).toEqual([...REGIONS]);
    expect(actualVsBudget().numRows).toBe(MONTHS.length);
    expect(regionMonthRevenue(41, 3).numRows).toBe(3 * MONTHS.length);
    expect(benchSeries(1000).numRows).toBe(1000);
  });

  it("forment un pont cohérent", () => {
    expect(bridgeSteps(revenueBridge(), "etape", "montant", "nature")).toHaveLength(7);
  });

  it("donnent un écart cohérent avec la tendance", () => {
    for (const snapshot of kpiSnapshots()) {
      const values = numberColumn(snapshot.trend, "valeur") as number[];
      const [previous, last] = values.slice(-2) as [number, number];
      expect(snapshot.delta).toBeCloseTo((last - previous) / previous, 10);
      expect(snapshot.value).toBe(last);
    }
  });
});
