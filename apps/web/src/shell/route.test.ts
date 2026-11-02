import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { navigate, routeFromHash, routeHash, useRoute, type Route } from "./route";
afterEach(() => { window.history.replaceState(null, "", "/"); });

// L'accueil liste les espaces ; le prototype vit hors espace ; le catalogue se lit dans un espace (plan 08, 8.3).
it.each([
  ["", { page: "home" }],
  ["#", { page: "home" }],
  ["#/", { page: "home" }],
  ["#/inconnue", { page: "home" }],
  // Les anciennes adresses du catalogue global ne mènent plus à un catalogue (plan 08, E9).
  ["#/catalogue", { page: "home" }],
  ["#/catalogue/autre", { page: "home" }],
  ["#/prototype", { page: "prototype" }],
  ["#/prototype/", { page: "home" }],
  ["#/espaces", { page: "home" }],
  ["#/espaces/", { page: "home" }],
  ["#/espaces//catalogue", { page: "home" }],
  ["#/espaces/finance", { page: "catalogue", space: "finance" }],
  ["#/espaces/finance/catalogue", { page: "catalogue", space: "finance" }],
  ["#/espaces/finance/", { page: "home" }],
  ["#/espaces/finance/catalogue/", { page: "home" }],
  ["#/espaces/finance/catalogue/revenu-net", { page: "home" }],
  ["#/espaces/finance/membres", { page: "home" }],
  ["#/espaces/finance/catalogue?q=x", { page: "home" }],
  ["#/ESPACES/finance/catalogue", { page: "home" }],
  ["#/espaces/a%2Fb/catalogue", { page: "catalogue", space: "a/b" }],
  ["#/espaces/caf%C3%A9/catalogue", { page: "catalogue", space: "café" }],
  // Un « % » illisible est gardé tel quel : le serveur refusera l'identifiant.
  ["#/espaces/%/catalogue", { page: "catalogue", space: "%" }],
  ["#/espaces/%E0%A4%A/catalogue", { page: "catalogue", space: "%E0%A4%A" }],
] as [string, Route][])("résout l'ancre « %s »", (hash, route) => {
  expect(routeFromHash(hash)).toEqual(route);
});

it.each([
  [{ page: "home" }, "#/"],
  [{ page: "prototype" }, "#/prototype"],
  [{ page: "catalogue", space: "finance" }, "#/espaces/finance/catalogue"],
  [{ page: "catalogue", space: "a/b?c#d%e f" }, "#/espaces/a%2Fb%3Fc%23d%25e%20f/catalogue"],
  [{ page: "catalogue", space: "%" }, "#/espaces/%25/catalogue"],
  [{ page: "catalogue", space: "café" }, "#/espaces/caf%C3%A9/catalogue"],
] as [Route, string][])("construit l'ancre de %j et la relit à l'identique", (route, hash) => {
  expect(routeHash(route)).toBe(hash);
  expect(routeFromHash(routeHash(route))).toEqual(route);
});

it("un identifiant fait d'un seul « / » ne produit pas une ancre d'une autre page", () => {
  for (const space of ["/", "prototype", "..", "x/catalogue", ""]) {
    const route = routeFromHash(routeHash({ page: "catalogue", space }));
    // L'identifiant vide n'a pas d'ancre lisible : il ramène à l'accueil, jamais à un autre espace.
    expect(route).toEqual(space === "" ? { page: "home" } : { page: "catalogue", space });
  }
});

it("navigue et notifie le hook au hashchange, puis se désabonne", () => {
  const { result, unmount } = renderHook(useRoute);
  expect(result.current).toEqual({ page: "home" });
  act(() => { navigate({ page: "catalogue", space: "finance" }); window.dispatchEvent(new HashChangeEvent("hashchange")); });
  expect(window.location.hash).toBe("#/espaces/finance/catalogue");
  expect(result.current).toEqual({ page: "catalogue", space: "finance" });
  act(() => { navigate({ page: "prototype" }); window.dispatchEvent(new HashChangeEvent("hashchange")); });
  expect(window.location.hash).toBe("#/prototype");
  expect(result.current).toEqual({ page: "prototype" });
  act(() => { navigate({ page: "home" }); window.dispatchEvent(new HashChangeEvent("hashchange")); });
  expect(result.current).toEqual({ page: "home" });
  unmount();
});

it("garde la même route d'un rendu à l'autre tant que l'ancre ne change pas", () => {
  window.history.replaceState(null, "", "/#/espaces/finance/catalogue");
  const { result, rerender } = renderHook(useRoute);
  const premiere = result.current;
  rerender();
  // Une nouvelle route à chaque rendu relancerait les lectures qui en dépendent.
  expect(result.current).toBe(premiere);
});
