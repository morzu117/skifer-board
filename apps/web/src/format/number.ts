/**
 * Formatage des nombres selon le design system : virgule décimale, espace fine insécable des
 * milliers, unités compactes (`16,5 M€`), écarts signés avec le vrai signe moins (`−0,6 pt`).
 */

const NBSP = "\u00a0";
const MINUS = "\u2212";
/** Valeur absente : affichée explicitement, jamais comme zéro. */
export const MISSING = "—";

function fixed(value: number, decimals: number): string {
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
    .format(value)
    .replace("-", MINUS);
}

/** Nombre entier ou décimal : `3 920`, `24,1`. */
export function formatNumber(value: number | null, decimals = 0): string {
  return value === null ? MISSING : fixed(value, decimals);
}

const SCALES = [
  { factor: 1, suffix: "", decimals: 0 },
  { factor: 1e3, suffix: "k", decimals: 0 },
  { factor: 1e6, suffix: "M", decimals: 1 },
  { factor: 1e9, suffix: "Md", decimals: 1 },
] as const;

type Scale = (typeof SCALES)[number];

/** Montant compact : `16,5 M€`, `412 k€`, `830 €`. Un arrondi qui atteint l'échelle supérieure y passe. */
export function formatAmount(value: number | null, unit = "€"): string {
  if (value === null) {
    return MISSING;
  }
  const magnitude = Math.abs(value);
  // Une valeur inférieure à 1 (zéro compris) reste à l'unité.
  let scale: Scale = SCALES.filter((candidate) => magnitude >= candidate.factor).at(-1) ?? SCALES[0];
  const upper = SCALES[SCALES.indexOf(scale) + 1];
  if (upper !== undefined && Number((magnitude / scale.factor).toFixed(scale.decimals)) >= 1000) {
    scale = upper;
  }
  return `${fixed(value / scale.factor, scale.decimals)}${NBSP}${scale.suffix}${unit}`;
}

/** Montant signé, pour une contribution : `+0,4 M€`, `−180 k€`. */
export function formatSignedAmount(value: number | null, unit = "€"): string {
  return value !== null && value > 0 ? `+${formatAmount(value, unit)}` : formatAmount(value, unit);
}

/** Part ou taux, à partir d'un ratio : `0.525` → `52,5 %`. */
export function formatPercent(ratio: number | null, decimals = 1): string {
  return ratio === null ? MISSING : `${fixed(ratio * 100, decimals)}${NBSP}%`;
}

export type DeltaKind = "percent" | "points" | "number";

/** Sens d'un écart, pour la couleur ; le signe reste toujours écrit. */
export type Tone = "positive" | "negative" | "neutral";

export function deltaTone(value: number | null): Tone {
  if (value === null || value === 0) {
    return "neutral";
  }
  return value > 0 ? "positive" : "negative";
}

/**
 * Écart signé : `+3,1 %` (ratio 0.031), `−0,6 pt` (points), `+120` (nombre). Un écart nul n'a
 * pas de signe.
 */
export function formatDelta(value: number | null, kind: DeltaKind, decimals = 1): string {
  if (value === null) {
    return MISSING;
  }
  const sign = value > 0 ? "+" : "";
  switch (kind) {
    case "percent":
      return `${sign}${formatPercent(value, decimals)}`;
    case "points":
      return `${sign}${fixed(value, decimals)}${NBSP}pt`;
    case "number":
      return `${sign}${fixed(value, 0)}`;
  }
}
