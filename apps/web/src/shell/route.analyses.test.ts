import { expect, it } from "vitest";
import { routeFromHash, routeHash, type Route } from "./route";

// Analyses d'un espace (plan 18, 18.5a) : liste et fiche, courante ou numérotée.
const ID = "5f1d7c52-3b0e-4d36-9a54-0c7a3e1b9d20";

it.each([
  ["#/espaces/finance/analyses", { page: "analyses", space: "finance" }],
  [`#/espaces/finance/analyses/${ID}`, { page: "analysis", space: "finance", id: ID }],
  [`#/espaces/finance/analyses/${ID}/revisions/3`, { page: "analysis", space: "finance", id: ID, revision: 3 }],
  [`#/espaces/finance/analyses/${ID}/revisions/123456789`, { page: "analysis", space: "finance", id: ID, revision: 123456789 }],
  ["#/espaces/a%2Fb/analyses/x%20y", { page: "analysis", space: "a/b", id: "x y" }],
  ["#/espaces/finance/analyses/", { page: "home" }],
  [`#/espaces/finance/analyses/${ID}/`, { page: "home" }],
  [`#/espaces/finance/analyses/${ID}/revisions`, { page: "home" }],
  [`#/espaces/finance/analyses/${ID}/revisions/0`, { page: "home" }],
  [`#/espaces/finance/analyses/${ID}/revisions/01`, { page: "home" }],
  [`#/espaces/finance/analyses/${ID}/revisions/1234567890`, { page: "home" }],
  [`#/espaces/finance/analyses/${ID}/revisions/-1`, { page: "home" }],
  [`#/espaces/finance/analyses/${ID}/revisions/1/x`, { page: "home" }],
  [`#/espaces/finance/analyses/${ID}/autre/1`, { page: "home" }],
  ["#/espaces/finance/analyse", { page: "home" }],
  ["#/espaces/finance/Analyses", { page: "home" }],
] as [string, Route][])("résout l'ancre « %s »", (hash, route) => {
  expect(routeFromHash(hash)).toEqual(route);
});

it.each([
  [{ page: "analyses", space: "finance" }, "#/espaces/finance/analyses"],
  [{ page: "analyses", space: "a/b" }, "#/espaces/a%2Fb/analyses"],
  [{ page: "analysis", space: "finance", id: ID }, `#/espaces/finance/analyses/${ID}`],
  [{ page: "analysis", space: "finance", id: ID, revision: 2 }, `#/espaces/finance/analyses/${ID}/revisions/2`],
  [{ page: "analysis", space: "a b", id: "x/y" }, "#/espaces/a%20b/analyses/x%2Fy"],
] as [Route, string][])("construit l'ancre de %j et la relit à l'identique", (route, hash) => {
  expect(routeHash(route)).toBe(hash);
  expect(routeFromHash(routeHash(route))).toEqual(route);
});
