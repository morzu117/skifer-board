/**
 * Jeux de démonstration du prototype, générés de façon déterministe et construits en Arrow comme
 * le seront les résultats reçus au lot 05 (plan 02, W6). Aucune valeur n'est recopiée des
 * maquettes (RULES §7) ; l'écran les présente comme des données de démonstration.
 */
import { tableFromArrays, type Table } from "apache-arrow";

export const REGIONS = [
  "Île-de-France",
  "Auvergne-Rhône-Alpes",
  "Occitanie",
  "Hauts-de-France",
  "Nouvelle-Aquitaine",
  "Grand Est",
  "Provence-Alpes-Côte d'Azur",
  "Bretagne",
  "Normandie",
  "Pays de la Loire",
  "Bourgogne-Franche-Comté",
  "Centre-Val de Loire",
  "Corse",
] as const;

export const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"] as const;

/** Générateur pseudo-aléatoire à graine (mulberry32) : mêmes données à chaque chargement. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (value: number, step: number): number => Math.round(value / step) * step;

/** Poids décroissant d'une région, pour des ordres de grandeur vraisemblables. */
const weight = (index: number): number => 1 / (1 + index * 0.28);

/** CA net et commandes par région. */
export function revenueByRegion(seed = 11): Table {
  const random = seeded(seed);
  const revenue = REGIONS.map((_, index) => round(8_000_000 * weight(index) * (0.85 + random() * 0.3), 10_000));
  return tableFromArrays({
    region: [...REGIONS],
    ca_net: Float64Array.from(revenue),
    commandes: Int32Array.from(revenue.map((value) => Math.round(value / (180 + random() * 60)))),
  });
}

/** Réalisé et budget mensuels. */
export function actualVsBudget(seed = 23): Table {
  const random = seeded(seed);
  const budget = MONTHS.map((_, index) => round(3_200_000 + index * 60_000, 10_000));
  return tableFromArrays({
    mois: [...MONTHS],
    realise: Float64Array.from(budget.map((value) => round(value * (0.9 + random() * 0.2), 10_000))),
    budget: Float64Array.from(budget),
  });
}

export type StepKind = "total" | "variation";

/** Passage du CA d'un trimestre au suivant : totaux et contributions signées, cohérents. */
export function revenueBridge(seed = 37): Table {
  const random = seeded(seed);
  const labels = ["Effet volume", "Effet prix", "Effet mix", "Effet change", "Remises"];
  const start = 9_600_000;
  const deltas = labels.map((_, index) => round((random() - (index === 4 ? 0.9 : 0.4)) * 900_000, 10_000));
  const end = deltas.reduce((total, delta) => total + delta, start);
  return tableFromArrays({
    etape: ["CA T2", ...labels, "CA T3"],
    montant: Float64Array.from([start, ...deltas, end]),
    nature: ["total", ...labels.map(() => "variation"), "total"],
  });
}

/** CA net par région et par mois, au format long. */
export function regionMonthRevenue(seed = 41, regions = 8): Table {
  const random = seeded(seed);
  const region: string[] = [];
  const month: string[] = [];
  const revenue: number[] = [];
  REGIONS.slice(0, regions).forEach((name, index) => {
    for (const key of MONTHS) {
      region.push(name);
      month.push(key);
      revenue.push(round((8_000_000 / 9) * weight(index) * (0.7 + random() * 0.6), 10_000));
    }
  });
  return tableFromArrays({ region, mois: month, ca_net: Float64Array.from(revenue) });
}

/** Série mensuelle d'un indicateur, pour une tuile KPI. */
export function monthlyTrend(base: number, seed: number): Table {
  const random = seeded(seed);
  let value = base;
  const values = MONTHS.map(() => {
    value *= 0.97 + random() * 0.07;
    return Math.round(value);
  });
  return tableFromArrays({ mois: [...MONTHS], valeur: Float64Array.from(values) });
}

/** Série de mesure : `points` catégories, pour éprouver le rendu (2.5). */
export function benchSeries(points: number, seed = 5): Table {
  const random = seeded(seed);
  return tableFromArrays({
    cle: Array.from({ length: points }, (_, index) => `p${index}`),
    valeur: Float64Array.from({ length: points }, () => round(random() * 1_000_000, 1)),
  });
}

export interface KpiSnapshot {
  label: string;
  /** Valeur du dernier mois et son unité d'affichage. */
  value: number;
  unit: "amount" | "count";
  trend: Table;
  /** Écart relatif au mois précédent, fourni avec le résultat comme le ferait le moteur. */
  delta: number;
}

/** Indicateurs du mois, avec leur tendance et leur écart, cohérents entre eux. */
export function kpiSnapshots(): KpiSnapshot[] {
  return [
    { label: "CA net", base: 3_400_000, seed: 51, unit: "amount" as const },
    { label: "Clients actifs", base: 12_000, seed: 53, unit: "count" as const },
  ].map(({ label, base, seed, unit }) => {
    const trend = monthlyTrend(base, seed);
    const values = trend.getChild("valeur")?.toArray() as Float64Array;
    const last = values[values.length - 1] as number;
    const previous = values[values.length - 2] as number;
    return { label, value: last, unit, trend, delta: (last - previous) / previous };
  });
}
