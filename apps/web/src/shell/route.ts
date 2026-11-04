import { useMemo, useSyncExternalStore } from "react";

/**
 * Pages de l'application, adressées par l'ancre de l'URL (plan 04, C11). L'accueil liste les
 * espaces ; le catalogue, les membres, les environnements et les paramètres se lisent dans un
 * espace (plan 08, 8.3 et 8.4 ; plan 09, 9.4 ; plan 10, 10.3) ; le prototype graphique reste
 * accessible hors espace, comme démonstration. La télémétrie se lit hors espace, par
 * l'administration de la plateforme (plan 11, 11.4).
 */
export type Route =
  | { page: "home" }
  | { page: "prototype" }
  | { page: "create" }
  | { page: "telemetry" }
  | { page: "catalogue"; space: string }
  | { page: "members"; space: string }
  | { page: "environments"; space: string }
  | { page: "parameters"; space: string }
  | { page: "connections"; space: string }
  | { page: "executions"; space: string };

const PROTOTYPE_HASH = "#/prototype";
const CREATE_HASH = "#/nouvel-espace";
const TELEMETRY_HASH = "#/telemetrie";
const SPACE_PREFIX = "#/espaces/";
/** Page d'un espace selon le dernier segment de l'ancre. */
const SPACE_PAGES = {
  catalogue: "catalogue",
  membres: "members",
  environnements: "environments",
  parametres: "parameters",
  connexions: "connections",
  executions: "executions",
} as const;

export function routeHash(route: Route): string {
  switch (route.page) {
    case "home":
      return "#/";
    case "prototype":
      return PROTOTYPE_HASH;
    case "create":
      return CREATE_HASH;
    case "telemetry":
      return TELEMETRY_HASH;
    case "catalogue":
      return `${SPACE_PREFIX}${encodeURIComponent(route.space)}/catalogue`;
    case "members":
      return `${SPACE_PREFIX}${encodeURIComponent(route.space)}/membres`;
    case "environments":
      return `${SPACE_PREFIX}${encodeURIComponent(route.space)}/environnements`;
    case "parameters":
      return `${SPACE_PREFIX}${encodeURIComponent(route.space)}/parametres`;
    case "connections":
      return `${SPACE_PREFIX}${encodeURIComponent(route.space)}/connexions`;
    case "executions":
      return `${SPACE_PREFIX}${encodeURIComponent(route.space)}/executions`;
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
  if (hash === TELEMETRY_HASH) {
    return { page: "telemetry" };
  }
  if (hash.startsWith(SPACE_PREFIX)) {
    // `#/espaces/<id>` ouvre le catalogue de l'espace, sa page de lecture.
    const match = /^([^/]+)(?:\/(catalogue|membres|environnements|parametres|connexions|executions))?$/.exec(hash.slice(SPACE_PREFIX.length));
    if (match?.[1] !== undefined) {
      const space = decodeSegment(match[1]);
      // Le motif n'admet que les segments de `SPACE_PAGES`.
      const segment = (match[2] ?? "catalogue") as keyof typeof SPACE_PAGES;
      return { page: SPACE_PAGES[segment], space };
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
