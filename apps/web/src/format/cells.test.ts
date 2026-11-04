import { describe, expect, it } from "vitest";

import { amountCell, monthCell } from "./cells";
import { MISSING } from "./number";

describe("cellules", () => {
  it("formate montants et mois", () => {
    expect(amountCell(1500)).toBe("2 k€");
    expect(monthCell("2026-02")).toBe("février 2026");
  });

  it("affiche une valeur absente ou d'un autre type", () => {
    expect(amountCell(null)).toBe(MISSING);
    expect(amountCell("x")).toBe(MISSING);
    expect(monthCell(null)).toBe(MISSING);
  });
});
