import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { navigate, routeFromHash, routeHash, useRoute, type Route } from "./route";

// Télémétrie (plan 11, 11.4) : `#/telemetrie`, hors espace.

afterEach(() => { window.history.replaceState(null, "", "/"); });

it.each([
  ["#/telemetrie", { page: "telemetry" }],
  ["#/telemetrie/", { page: "home" }],
  ["#/telemetrie/24h", { page: "home" }],
  ["#/telemetrie?window=7d", { page: "home" }],
  ["#telemetrie", { page: "home" }],
  ["#/TELEMETRIE", { page: "home" }],
  ["#/télémétrie", { page: "home" }],
  ["#/t%C3%A9l%C3%A9m%C3%A9trie", { page: "home" }],
  ["#/telemetry", { page: "home" }],
  ["#/espaces/telemetrie", { page: "catalogue", space: "telemetrie" }],
  ["#/espaces/finance/telemetrie", { page: "home" }],
  // Les autres pages ne changent pas.
  ["#/nouvel-espace", { page: "create" }],
  ["#/prototype", { page: "prototype" }],
  ["#/", { page: "home" }],
] as [string, Route][])("résout l'ancre « %s »", (hash, route) => {
  expect(routeFromHash(hash)).toEqual(route);
});

it("construit l'ancre de la télémétrie et la relit à l'identique", () => {
  expect(routeHash({ page: "telemetry" })).toBe("#/telemetrie");
  expect(routeFromHash(routeHash({ page: "telemetry" }))).toEqual({ page: "telemetry" });
});

it("un espace nommé « telemetrie » reste un espace", () => {
  for (const page of ["catalogue", "members", "environments", "parameters"] as const) {
    expect(routeFromHash(routeHash({ page, space: "telemetrie" }))).toEqual({ page, space: "telemetrie" });
  }
});

it("naviguer vers la télémétrie pose l'ancre et la route suit", () => {
  const { result } = renderHook(() => useRoute());
  expect(result.current).toEqual({ page: "home" });
  act(() => { navigate({ page: "telemetry" }); window.dispatchEvent(new HashChangeEvent("hashchange")); });
  expect(window.location.hash).toBe("#/telemetrie");
  expect(result.current).toEqual({ page: "telemetry" });
});
