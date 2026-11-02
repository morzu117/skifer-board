import { useMemo, useSyncExternalStore } from "react";

/**
 * Pages de l'application, adressées par l'ancre de l'URL (plan 04, C11). L'accueil liste les
 * espaces ; le catalogue se lit dans un espace (plan 08, 8.3) ; le prototype graphique reste
 * accessible hors espace, comme démonstration.
 */
export type Route = { page: "home" } | { page: "prototype" } | { page: "catalogue"; space: string };

const PROTOTYPE_HASH = "#/prototype";
const SPACE_PREFIX = "#/espaces/";

export function routeHash(route: Route): string {
  switch (route.page) {
    case "home":
      return "#/";
    case "prototype":
      return PROTOTYPE_HASH;
    case "catalogue":
      return `${SPACE_PREFIX}${encodeURIComponent(route.space)}/catalogue`;
  }
}

/** Identifiant d'espace d'une ancre ; un segment illisible est gardé tel quel, et le serveur le refusera. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function routeFromHash(hash: string): Route {
  if (hash === PROTOTYPE_HASH) {
    return { page: "prototype" };
  }
  if (hash.startsWith(SPACE_PREFIX)) {
    // `#/espaces/<id>` ouvre la seule page livrée d'un espace : son catalogue.
    const segment = /^([^/]+)(?:\/catalogue)?$/.exec(hash.slice(SPACE_PREFIX.length))?.[1];
    if (segment !== undefined) {
      return { page: "catalogue", space: decodeSegment(segment) };
    }
  }
  return { page: "home" };
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
  };
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return useMemo(() => routeFromHash(hash), [hash]);
}

export function navigate(route: Route): void {
  window.location.hash = routeHash(route);
}
