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
  // Membres et rôles d'un espace, et création d'un espace (plan 08, 8.4).
  ["#/espaces/finance/membres", { page: "members", space: "finance" }],
  ["#/espaces/finance/membres/", { page: "home" }],
  ["#/espaces/finance/MEMBRES", { page: "home" }],
  ["#/espaces/finance/membres?x=1", { page: "home" }],
  ["#/espaces//membres", { page: "home" }],
  ["#/espaces/a%2Fb/membres", { page: "members", space: "a/b" }],
  ["#/espaces/membres", { page: "catalogue", space: "membres" }],
  ["#/espaces/%/membres", { page: "members", space: "%" }],
  ["#/nouvel-espace", { page: "create" }],
  ["#/nouvel-espace/", { page: "home" }],
  ["#nouvel-espace", { page: "home" }],
  ["#/espaces/nouvel-espace", { page: "catalogue", space: "nouvel-espace" }],
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
  [{ page: "create" }, "#/nouvel-espace"],
  [{ page: "members", space: "finance" }, "#/espaces/finance/membres"],
  [{ page: "members", space: "a/b?c#d%e f" }, "#/espaces/a%2Fb%3Fc%23d%25e%20f/membres"],
  [{ page: "members", space: "membres" }, "#/espaces/membres/membres"],
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

it("l'ancre des membres d'un identifiant piégé reste celle des membres de cet identifiant", () => {
  for (const space of ["/", "catalogue", "x/membres", "x/catalogue", "..", "nouvel-espace"]) {
    expect(routeFromHash(routeHash({ page: "members", space }))).toEqual({ page: "members", space });
  }
  // Sans identifiant, l'ancre ne désigne aucun espace : retour à l'accueil.
  expect(routeFromHash(routeHash({ page: "members", space: "" }))).toEqual({ page: "home" });
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
