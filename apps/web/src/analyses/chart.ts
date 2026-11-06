import { ContractError } from "../catalogue/decode";
import type { ChartKind } from "./document";

/** Types de graphique de l'Explorateur, en français (écran) ; le document porte les noms du schéma. */
export const EXPLORER_GENRES = ["valeur", "barres", "ligne", "groupees"] as const;
export type ExplorerGenre = (typeof EXPLORER_GENRES)[number];

/** Table fermée et bijective : chaque genre a un type de graphique, chaque type un genre. */
export const CHART_OF_GENRE: Readonly<Record<ExplorerGenre, ChartKind>> = {
  valeur: "value",
  barres: "bars",
  ligne: "line",
  groupees: "grouped_bars",
};
export const GENRE_OF_CHART: Readonly<Record<ChartKind, ExplorerGenre>> = {
  value: "valeur",
  bars: "barres",
  line: "ligne",
  grouped_bars: "groupees",
};

export function chartOfGenre(genre: unknown): ChartKind {
  if (typeof genre !== "string" || !Object.hasOwn(CHART_OF_GENRE, genre)) throw new ContractError("genre : genre de l'Explorateur attendu");
  return CHART_OF_GENRE[genre as ExplorerGenre];
}

export function genreOfChart(chart: unknown): ExplorerGenre {
  if (typeof chart !== "string" || !Object.hasOwn(GENRE_OF_CHART, chart)) throw new ContractError("graphique : type de graphique du schéma attendu");
  return GENRE_OF_CHART[chart as ChartKind];
}
