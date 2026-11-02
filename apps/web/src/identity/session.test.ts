import { afterEach, expect, it, vi } from "vitest";
import { onSessionLost, reportSessionLost } from "./session";

const desabonnements: (() => void)[] = [];
function abonner(listener: () => void) {
  const quitter = onSessionLost(listener);
  desabonnements.push(quitter);
  return quitter;
}
afterEach(() => { desabonnements.splice(0).forEach((quitter) => { quitter(); }); });
it("prévient un abonné à chaque perte de session", () => {
  const listener = vi.fn();
  abonner(listener);
  reportSessionLost();
  reportSessionLost();
  expect(listener).toHaveBeenCalledTimes(2);
});
it("prévient plusieurs abonnés", () => {
  const premier = vi.fn(); const second = vi.fn();
  abonner(premier); abonner(second);
  reportSessionLost();
  expect(premier).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();
});
it("respecte le désabonnement", () => {
  const listener = vi.fn();
  abonner(listener)();
  reportSessionLost();
  expect(listener).not.toHaveBeenCalled();
});
it("continue la notification quand un abonné se désabonne lui-même", () => {
  const premier = vi.fn(() => { quitter(); });
  const quitter = abonner(premier);
  const second = vi.fn();
  abonner(second);
  reportSessionLost();
  reportSessionLost();
  expect(premier).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledTimes(2);
});
