import { describe, expect, it } from "vitest";

import { deltaTone, formatAmount, formatDelta, formatNumber, formatPercent, formatSignedAmount, MISSING } from "./number";

/** Remplace les espaces insécables pour lire les attentes. */
const plain = (text: string): string => text.replace(/[\u00a0\u202f]/g, " ");

describe("formatNumber", () => {
  it("sépare les milliers et utilise la virgule", () => {
    expect(plain(formatNumber(3920))).toBe("3 920");
    expect(plain(formatNumber(24.06, 1))).toBe("24,1");
  });

  it("écrit le vrai signe moins", () => {
    expect(formatNumber(-5)).toBe("−5");
  });

  it("affiche une valeur absente", () => {
    expect(formatNumber(null)).toBe(MISSING);
  });
});

describe("formatAmount", () => {
  it("compacte selon l'échelle", () => {
    expect(plain(formatAmount(16_500_000))).toBe("16,5 M€");
    expect(plain(formatAmount(412_000))).toBe("412 k€");
    expect(plain(formatAmount(2_300_000_000))).toBe("2,3 Md€");
    expect(plain(formatAmount(830))).toBe("830 €");
    expect(plain(formatAmount(0))).toBe("0 €");
    expect(plain(formatAmount(0.4))).toBe("0 €");
  });

  it("passe à l'échelle supérieure quand l'arrondi l'atteint", () => {
    expect(plain(formatAmount(999_700))).toBe("1,0 M€");
    expect(plain(formatAmount(999.7))).toBe("1 k€");
  });

  it("garde le signe des montants négatifs", () => {
    expect(plain(formatAmount(-1_200_000))).toBe("−1,2 M€");
  });

  it("accepte une autre unité et une valeur absente", () => {
    expect(plain(formatAmount(1500, "u"))).toBe("2 ku");
    expect(formatAmount(null)).toBe(MISSING);
  });
});

describe("formatPercent", () => {
  it("formate un ratio", () => {
    expect(plain(formatPercent(0.525))).toBe("52,5 %");
    expect(formatPercent(null)).toBe(MISSING);
  });
});

describe("formatDelta", () => {
  it("signe chaque type d'écart", () => {
    expect(plain(formatDelta(0.031, "percent"))).toBe("+3,1 %");
    expect(plain(formatDelta(-0.6, "points"))).toBe("−0,6 pt");
    expect(formatDelta(120, "number")).toBe("+120");
  });

  it("ne signe pas un écart nul et affiche l'absence", () => {
    expect(formatDelta(0, "number")).toBe("0");
    expect(formatDelta(null, "number")).toBe(MISSING);
  });

  it("donne le sens de l'écart", () => {
    expect(deltaTone(2)).toBe("positive");
    expect(deltaTone(-2)).toBe("negative");
    expect(deltaTone(0)).toBe("neutral");
    expect(deltaTone(null)).toBe("neutral");
  });
});

describe("formatSignedAmount", () => {
  it("signe une contribution", () => {
    expect(plain(formatSignedAmount(400_000))).toBe("+400 k€");
    expect(plain(formatSignedAmount(-180_000))).toBe("\u2212180 k€");
    expect(plain(formatSignedAmount(0))).toBe("0 €");
    expect(formatSignedAmount(null)).toBe(MISSING);
  });
});
