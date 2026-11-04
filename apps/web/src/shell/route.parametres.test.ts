import { expect, it } from "vitest";
import { routeFromHash, routeHash, type Route } from "./route";

// Paramètres d'un espace (plan 10, 10.3) : `#/espaces/<id>/parametres`.

it.each([
  ["#/espaces/finance/parametres", { page: "parameters", space: "finance" }],
  ["#/espaces/finance/parametres/", { page: "home" }],
  ["#/espaces/finance/parametres/x", { page: "home" }],
  ["#/espaces/finance/parametre", { page: "home" }],
  ["#/espaces/finance/paramètres", { page: "home" }],
  ["#/espaces/finance/param%C3%A8tres", { page: "home" }],
  ["#/espaces/finance/PARAMETRES", { page: "home" }],
  ["#/espaces/finance/parameters", { page: "home" }],
  ["#/espaces/finance/parametres?x=1", { page: "home" }],
  ["#/espaces//parametres", { page: "home" }],
  ["#/espaces/parametres", { page: "catalogue", space: "parametres" }],
  ["#/espaces/a%2Fb/parametres", { page: "parameters", space: "a/b" }],
  ["#/espaces/caf%C3%A9/parametres", { page: "parameters", space: "café" }],
  ["#/espaces/%/parametres", { page: "parameters", space: "%" }],
  // Les autres pages d'un espace ne changent pas.
  ["#/espaces/finance", { page: "catalogue", space: "finance" }],
  ["#/espaces/finance/catalogue", { page: "catalogue", space: "finance" }],
  ["#/espaces/finance/membres", { page: "members", space: "finance" }],
  ["#/espaces/finance/environnements", { page: "environments", space: "finance" }],
] as [string, Route][])("résout l'ancre « %s »", (hash, route) => {
  expect(routeFromHash(hash)).toEqual(route);
});

it.each([
  [{ page: "parameters", space: "finance" }, "#/espaces/finance/parametres"],
  [{ page: "parameters", space: "a/b?c#d%e f" }, "#/espaces/a%2Fb%3Fc%23d%25e%20f/parametres"],
  [{ page: "parameters", space: "parametres" }, "#/espaces/parametres/parametres"],
  [{ page: "parameters", space: "café" }, "#/espaces/caf%C3%A9/parametres"],
] as [Route, string][])("construit l'ancre de %j et la relit à l'identique", (route, hash) => {
  expect(routeHash(route)).toBe(hash);
  expect(routeFromHash(routeHash(route))).toEqual(route);
});

it("l'ancre des paramètres d'un identifiant piégé reste celle des paramètres de cet identifiant", () => {
  for (const space of ["/", "catalogue", "membres", "x/parametres", "x/environnements", "..", "nouvel-espace", "%", "parametres"]) {
    expect(routeFromHash(routeHash({ page: "parameters", space }))).toEqual({ page: "parameters", space });
  }
  expect(routeFromHash(routeHash({ page: "parameters", space: "" }))).toEqual({ page: "home" });
});
