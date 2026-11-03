import { ContractError, instant, integer, list, nullable, object, oneOf, text } from "../catalogue/decode";
import { formatNumber } from "../format/number";

/**
 * Télémétrie de Board (plan 11, T7 et T8) : un résumé par genre, opération et méthode, sur une
 * fenêtre glissante. Les nombres sont rendus tels que la base les a calculés ; seul l'affichage
 * les arrondit.
 */

export const WINDOWS = ["24h", "7d", "30d"] as const;
export type Window = (typeof WINDOWS)[number];

export const WINDOW_LABELS: Record<Window, string> = { "24h": "24 h", "7d": "7 j", "30d": "30 j" };
/** Fenêtre dite en toutes lettres, pour l'état vide et la période. */
export const WINDOW_SPANS: Record<Window, string> = { "24h": "les dernières 24 heures", "7d": "les 7 derniers jours", "30d": "les 30 derniers jours" };

export type Kind = "http" | "atlas";

export const KIND_LABELS: Record<Kind, string> = { http: "Requête de l'API", atlas: "Lecture d'Atlas" };

export interface Distribution {
  p50: number | null;
  max: number | null;
}

export interface OperationSummary {
  kind: Kind;
  operation: string;
  method: string | null;
  count: number;
  errors: number;
  refusals: number;
  duration: { p50: number; p95: number; max: number };
  size: Distribution;
  rows: Distribution;
}

export interface Summary {
  window: Window;
  start: Date;
  end: Date;
  /** Plus ancienne et plus récente mesure de la fenêtre ; `null` sans aucune mesure. */
  period: { oldest: Date; newest: Date } | null;
  operations: readonly OperationSummary[];
}

/** Nombre fini et positif : une durée, une médiane. */
function measure(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ContractError(`${path} : nombre positif attendu`);
  }
  return value;
}

function count(value: unknown, path: string): number {
  const found = integer(value, path);
  if (found < 0) {
    throw new ContractError(`${path} : entier positif attendu`);
  }
  return found;
}

const distribution = object<Distribution>({ p50: nullable(measure), max: nullable(count) });

const operation = object<Omit<OperationSummary, "duration"> & { duration_ms: OperationSummary["duration"] }>({
  kind: oneOf<Kind>(["http", "atlas"]),
  operation: text,
  method: nullable(text),
  count,
  errors: count,
  refusals: count,
  duration_ms: object({ p50: measure, p95: measure, max: measure }),
  size: distribution,
  rows: distribution,
});

const summary = object({
  window: oneOf(WINDOWS),
  start: instant,
  end: instant,
  oldest: nullable(instant),
  newest: nullable(instant),
  operations: list(operation),
});

/** Résumé de la fenêtre demandée ; un résumé d'une autre fenêtre est hors contrat. */
export function decodeSummary(value: unknown, requested: Window): Summary {
  const found = summary(value, "télémétrie");
  if (found.window !== requested) {
    throw new ContractError("télémétrie.window : fenêtre demandée attendue");
  }
  const operations = found.operations.map(({ duration_ms, ...rest }, index) => {
    const path = `télémétrie.operations[${String(index)}]`;
    if (rest.errors > rest.count || rest.refusals > rest.count) {
      throw new ContractError(`${path} : erreurs et refus au plus égaux aux mesures`);
    }
    if (duration_ms.p50 > duration_ms.p95 || duration_ms.p95 > duration_ms.max) {
      throw new ContractError(`${path}.duration_ms : médiane, p95 et maximum dans cet ordre attendus`);
    }
    return { ...rest, duration: duration_ms };
  });
  if (found.start > found.end) {
    throw new ContractError("télémétrie : début de fenêtre avant sa fin attendu");
  }
  const { oldest, newest } = found;
  // Des mesures et leur période vont ensemble, ses deux bornes aussi : l'une sans l'autre est hors contrat.
  if ((oldest === null) !== (newest === null) || (oldest === null) !== (operations.length === 0)) {
    throw new ContractError("télémétrie : période et opérations attendues ensemble");
  }
  const period = oldest === null || newest === null ? null : { oldest, newest };
  if (period !== null && period.oldest > period.newest) {
    throw new ContractError("télémétrie : plus ancienne mesure avant la plus récente attendue");
  }
  return { window: found.window, start: found.start, end: found.end, period, operations };
}

/** Les plus lentes d'abord ; à p95 égal, l'ordre du serveur est gardé (T8). */
export function byP95(operations: readonly OperationSummary[]): readonly OperationSummary[] {
  return [...operations].sort((left, right) => right.duration.p95 - left.duration.p95);
}

/** Durée en millisecondes, au dixième. */
export function formatDuration(value: number): string {
  return formatNumber(value, 1);
}

const NBSP = "\u00a0";
const KIB = 1024;
const MIB = 1024 * KIB;

/**
 * Taille en octets : `412 o`, `3,5 kio`, `1,5 Mio` ; absente, un tiret. Un arrondi qui atteint
 * l'unité supérieure y passe, comme pour les montants : jamais `1 024 o` ni `1 024,0 kio`.
 */
export function formatSize(value: number | null): string {
  if (value === null) {
    return formatNumber(null);
  }
  if (Math.round(value) < KIB) {
    return `${formatNumber(value)}${NBSP}o`;
  }
  if (Math.round((value / KIB) * 10) / 10 < KIB) {
    return `${formatNumber(value / KIB, 1)}${NBSP}kio`;
  }
  return `${formatNumber(value / MIB, 1)}${NBSP}Mio`;
}

/** Nombre de documents : entier tel quel, médiane entre deux au dixième. */
export function formatCount(value: number | null): string {
  return formatNumber(value, value === null || Number.isInteger(value) ? 0 : 1);
}
