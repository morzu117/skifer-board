import { expect, it } from "vitest";
import { ERROR_LABELS, STATE_LABELS, STATE_TONES } from "./labels";
import { STATES } from "./model";

it("chaque état d'exécution a un libellé et un ton", () => {
  expect(Object.keys(STATE_LABELS).sort()).toEqual([...STATES].sort());
  expect(Object.keys(STATE_TONES).sort()).toEqual([...STATES].sort());
  expect(STATE_LABELS.denied).toBe("Refusée");
  expect(STATE_TONES.succeeded).toBe("success");
  expect(ERROR_LABELS.deny).toBe("Accès refusé");
  expect(ERROR_LABELS.require_human).toBe("Validation humaine requise");
});
