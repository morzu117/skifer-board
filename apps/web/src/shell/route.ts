import { useMemo, useSyncExternalStore } from "react";

/**
 * Pages de l'application, adressées par l'ancre de l'URL (plan 04, C11). L'accueil liste les
 * espaces ; le catalogue, les membres et les environnements se lisent dans un espace (plan 08, 8.3
 * et 8.4 ; plan 09, 9.4) ; le
 * prototype graphique reste accessible hors espace, comme démonstration.
 */
export type Route =
  | { page: "home" }
  | { page: "prototype" }
  | { page: "create" }
  | { page: "catalogue"; space: string }
  | { page: "members"; space: string }
  | { page: "environments"; space: string };

const PROTOTYPE_HASH = "#/prototype";
const CREATE_HASH = "#/nouvel-espace";
const SPACE_PREFIX = "#/espaces/";

export function routeHash(route: Route): string {
  switch (route.page) {
    case "home":
      return "#/";
    case "prototype":
      return PROTOTYPE_HASH;
    case "create":
      return CREATE_HASH;
    case "catalogue":
      return `${SPACE_PREFIX}${encodeURIComponent(route.space)}/catalogue`;
    case "members":
      return `${SPACE_PREFIX}${encodeURIComponent(route.space)}/membres`;
    case "environments":
      return `${SPACE_PREFIX}${encodeURIComponent(route.space)}/environnements`;
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
  if (hash === CREATE_HASH) {
    return { page: "create" };
  }
  if (hash.startsWith(SPACE_PREFIX)) {
    // `#/espaces/<id>` ouvre le catalogue de l'espace, sa page de lecture.
    const match = /^([^/]+)(?:\/(catalogue|membres|environnements))?$/.exec(hash.slice(SPACE_PREFIX.length));
    if (match?.[1] !== undefined) {
      const space = decodeSegment(match[1]);
      return match[2] === "membres" ? { page: "members", space } : match[2] === "environnements" ? { page: "environments", space } : { page: "catalogue", space };
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
