import { describe, expect, it, vi } from "vitest";

import { onSpaceLost, reportSpaceLost } from "./lost";

describe("Espace perdu pendant l'usage (plan 08, E4)", () => {
  it("prévient chaque abonné, une fois par signalement", () => {
    const premier = vi.fn();
    const second = vi.fn();
    const quitter1 = onSpaceLost(premier);
    const quitter2 = onSpaceLost(second);
    try {
      reportSpaceLost();
      reportSpaceLost();
      expect(premier).toHaveBeenCalledTimes(2);
      expect(second).toHaveBeenCalledTimes(2);
    } finally {
      quitter1();
      quitter2();
    }
  });

  it("un abonné désinscrit n'est plus prévenu, les autres le restent", () => {
    const parti = vi.fn();
    const reste = vi.fn();
    const quitter = onSpaceLost(parti);
    const garder = onSpaceLost(reste);
    quitter();
    reportSpaceLost();
    expect(parti).not.toHaveBeenCalled();
    expect(reste).toHaveBeenCalledOnce();
    garder();
    reportSpaceLost();
    expect(reste).toHaveBeenCalledOnce();
  });

  it("un abonné qui se désinscrit pendant le signalement n'empêche pas les suivants", () => {
    const suivant = vi.fn();
    const quitter = onSpaceLost(() => { quitter(); });
    const garder = onSpaceLost(suivant);
    reportSpaceLost();
    expect(suivant).toHaveBeenCalledOnce();
    garder();
  });

  it("sans abonné, un signalement est sans effet", () => {
    expect(() => { reportSpaceLost(); }).not.toThrow();
  });
});
