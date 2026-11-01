import { useSyncExternalStore } from "react";

/** Pages de l'application, adressées par l'ancre de l'URL (plan 04, C11). */
export type Route = "prototype" | "catalogue";

export const ROUTE_HASHES: Record<Route, string> = { prototype: "#/", catalogue: "#/catalogue" };

export function routeFromHash(hash: string): Route {
  return hash === ROUTE_HASHES.catalogue ? "catalogue" : "prototype";
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
  };
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => routeFromHash(window.location.hash));
}

export function navigate(route: Route): void {
  window.location.hash = ROUTE_HASHES[route];
}
