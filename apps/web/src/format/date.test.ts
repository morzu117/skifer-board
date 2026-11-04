import { describe, expect, it } from "vitest";

import { formatAge, formatInstant, formatMonthLong, formatMonthShort } from "./date";

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


describe("âge et instant de provenance", () => {
  it.each([
    [59, "à l'instant"], [60, "il y a 1 min"], [3540, "il y a 59 min"],
    [3600, "il y a 1 h"], [82800, "il y a 23 h"], [86400, "il y a 1 j"], [-60, "à l'instant"],
  ] as const)("formate un âge de %i secondes", (seconds, expected) => {
    const now = new Date("2026-11-01T12:00:00Z");
    expect(formatAge(new Date(now.getTime() - seconds * 1000), now)).toBe(expected);
  });
  it("affiche explicitement l'instant en UTC indépendamment du fuseau source", () => {
    expect(formatInstant(new Date("2026-11-01T21:46:23+02:00"))).toBe("01/11/2026 19:46 UTC");
  });
});
