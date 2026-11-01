import { describe, expect, it } from "vitest";

import { formatMonthLong, formatMonthShort } from "./date";

describe("mois", () => {
  it("formate une clé de mois", () => {
    expect(formatMonthShort("2026-03")).toBe("mars");
    expect(formatMonthShort("2026-01")).toBe("janv.");
    expect(formatMonthLong("2026-09")).toBe("septembre 2026");
  });

  it("refuse une clé invalide", () => {
    expect(() => formatMonthShort("2026-13")).toThrow("Clé de mois invalide : 2026-13");
  });
});
