import { afterEach, expect, it, vi } from "vitest";
import { guardNavigation, navigate, routeFromHash, routeHash, type Route } from "./route";

// Dashboards d'un espace (plan 19, 19.5a) : liste et éditeur, et garde de sortie.
const ID = "5f1d7c52-3b0e-4d36-9a54-0c7a3e1b9d20";
afterEach(() => { guardNavigation(null); window.history.replaceState(null, "", "/"); });

it.each([
  ["#/espaces/finance/dashboards", { page: "dashboards", space: "finance" }],
  [`#/espaces/finance/dashboards/${ID}`, { page: "dashboard", space: "finance", id: ID }],
  ["#/espaces/a%2Fb/dashboards/x%20y", { page: "dashboard", space: "a/b", id: "x y" }],
  ["#/espaces/finance/dashboards/", { page: "home" }],
  [`#/espaces/finance/dashboards/${ID}/`, { page: "home" }],
  [`#/espaces/finance/dashboards/${ID}/revisions/2`, { page: "dashboard", space: "finance", id: ID, revision: 2 }],
  [`#/espaces/finance/dashboards/${ID}/historique`, { page: "dashboard", space: "finance", id: ID, view: "history" }],
  [`#/espaces/finance/dashboards/${ID}/historique/1/2`, { page: "dashboard", space: "finance", id: ID, view: "history", compare: { base: 1, other: 2 } }],
  [`#/espaces/finance/dashboards/${ID}/revisions/0`, { page: "home" }],
  [`#/espaces/finance/dashboards/${ID}/historique/1/02`, { page: "home" }],
] satisfies [string, Route][])("lit l'adresse %s", (hash, route) => {
  expect(routeFromHash(hash)).toEqual(route);
});

it.each([
  [{ page: "dashboard", space: "finance", id: ID, revision: 2 }, `#/espaces/finance/dashboards/${ID}/revisions/2`],
  [{ page: "dashboard", space: "finance", id: ID, view: "history" }, `#/espaces/finance/dashboards/${ID}/historique`],
  [{ page: "dashboard", space: "finance", id: ID, view: "history", compare: { base: 1, other: 2 } }, `#/espaces/finance/dashboards/${ID}/historique/1/2`],
  [{ page: "dashboards", space: "a/b" }, "#/espaces/a%2Fb/dashboards"],
  [{ page: "dashboard", space: "finance", id: "x y" }, "#/espaces/finance/dashboards/x%20y"],
] satisfies [Route, string][])("écrit l'adresse de %j", (route, hash) => {
  expect(routeHash(route)).toBe(hash);
  expect(routeFromHash(hash)).toEqual(route);
});

it("navigate consulte la garde : refus, accord, retrait", () => {
  const refuse = vi.fn(() => false);
  const release = guardNavigation(refuse);
  navigate({ page: "dashboards", space: "finance" });
  expect(refuse).toHaveBeenCalledWith("#/espaces/finance/dashboards");
  expect(window.location.hash).toBe("");
  const accept = vi.fn(() => true);
  guardNavigation(accept);
  release(); // retirer une garde remplacée laisse la nouvelle en place
  navigate({ page: "dashboards", space: "finance" });
  expect(accept).toHaveBeenCalledTimes(1);
  expect(window.location.hash).toBe("#/espaces/finance/dashboards");
  guardNavigation(null);
  navigate({ page: "home" });
  expect(accept).toHaveBeenCalledTimes(1);
});
