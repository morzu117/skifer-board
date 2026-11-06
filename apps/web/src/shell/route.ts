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
  | { page: "executions"; space: string }
  /** Explorateur, éventuellement ouvert sur une analyse : sa révision courante, ou une révision numérotée (plan 18, 18.5b). */
  | { page: "explorer"; space: string; analysis?: { id: string; revision?: number } }
  | { page: "analyses"; space: string }
  /** Fiche d'une analyse : la courante, ou une révision numérotée (plan 18, 18.5a) ; `view: "history"` ouvre l'onglet Révisions (de la courante, jamais d'une révision numérotée) ; avec `compare`, il lance l'écart du serveur entre ces deux révisions (`…/historique/<a>/<b>`). */
  | { page: "analysis"; space: string; id: string; revision?: number; view?: "history"; compare?: { base: number; other: number } };

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
  explorer: "explorer",
  analyses: "analyses",
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
    case "explorer":
      return `${SPACE_PREFIX}${encodeURIComponent(route.space)}/explorer${route.analysis === undefined ? "" : `/analyses/${encodeURIComponent(route.analysis.id)}${route.analysis.revision === undefined ? "" : `/revisions/${String(route.analysis.revision)}`}`}`;
    case "executions":
      return `${SPACE_PREFIX}${encodeURIComponent(route.space)}/executions`;
    case "analyses":
      return `${SPACE_PREFIX}${encodeURIComponent(route.space)}/analyses`;
    case "analysis":
      return `${SPACE_PREFIX}${encodeURIComponent(route.space)}/analyses/${encodeURIComponent(route.id)}${route.revision !== undefined ? `/revisions/${String(route.revision)}` : route.view === undefined ? "" : route.compare === undefined ? "/historique" : `/historique/${String(route.compare.base)}/${String(route.compare.other)}`}`;
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
    // La fiche d'une analyse : `analyses/<id>`, ou `analyses/<id>/revisions/<n>` pour une révision numérotée.
    // `analyses/<id>/historique` ouvre l'onglet Révisions de la fiche ; `…/historique/<a>/<b>` y lance l'écart entre deux révisions.
    const analysis = /^([^/]+)\/analyses\/([^/]+)(?:\/revisions\/([1-9]\d{0,8})|\/(historique)(?:\/([1-9]\d{0,8})\/([1-9]\d{0,8}))?)?$/.exec(hash.slice(SPACE_PREFIX.length));
    if (analysis?.[1] !== undefined && analysis[2] !== undefined) {
      const found = { page: "analysis", space: decodeSegment(analysis[1]), id: decodeSegment(analysis[2]) } as const;
      if (analysis[4] !== undefined) return analysis[5] === undefined || analysis[6] === undefined ? { ...found, view: "history" } : { ...found, view: "history", compare: { base: Number(analysis[5]), other: Number(analysis[6]) } };
      return analysis[3] === undefined ? found : { ...found, revision: Number(analysis[3]) };
    }
    // L'Explorateur ouvert sur une analyse : `explorer/analyses/<id>`, ou `…/revisions/<n>`.
    const exploring = /^([^/]+)\/explorer\/analyses\/([^/]+)(?:\/revisions\/([1-9]\d{0,8}))?$/.exec(hash.slice(SPACE_PREFIX.length));
    if (exploring?.[1] !== undefined && exploring[2] !== undefined) {
      const reopened = { id: decodeSegment(exploring[2]) };
      return { page: "explorer", space: decodeSegment(exploring[1]), analysis: exploring[3] === undefined ? reopened : { ...reopened, revision: Number(exploring[3]) } };
    }
    // `#/espaces/<id>` ouvre le catalogue de l'espace, sa page de lecture.
    const match = /^([^/]+)(?:\/(catalogue|membres|environnements|parametres|connexions|executions|explorer|analyses))?$/.exec(hash.slice(SPACE_PREFIX.length));
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
