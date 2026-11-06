import { describe, expect, it } from "vitest";
import schema from "../../../../contracts/analyses/analysis.v1.json";
import { ContractError } from "../catalogue/decode";
import { CHART_OF_GENRE, EXPLORER_GENRES, GENRE_OF_CHART, chartOfGenre, genreOfChart } from "./chart";
import { CHART_KINDS } from "./document";

const PAIRS = [["valeur", "value"], ["barres", "bars"], ["ligne", "line"], ["groupees", "grouped_bars"]] as const;

describe("correspondance des types de graphique", () => {
  it("couvre exactement les valeurs du schéma et celles de l'Explorateur", () => {
    expect([...CHART_KINDS]).toEqual(schema.$defs.presentation.properties.chart.enum);
    expect(Object.keys(CHART_OF_GENRE).sort()).toEqual([...EXPLORER_GENRES].sort());
    expect(Object.keys(GENRE_OF_CHART).sort()).toEqual([...CHART_KINDS].sort());
    expect(PAIRS.map(([genre]) => genre).sort()).toEqual([...EXPLORER_GENRES].sort());
    expect(PAIRS.map(([, chart]) => chart).sort()).toEqual([...CHART_KINDS].sort());
  });

  it.each(PAIRS)("fait correspondre %s et %s dans les deux sens", (genre, chart) => {
    expect(chartOfGenre(genre)).toBe(chart);
    expect(genreOfChart(chart)).toBe(genre);
  });

  it("est bijective : aller puis retour rend la valeur de départ", () => {
    for (const genre of EXPLORER_GENRES) expect(genreOfChart(chartOfGenre(genre))).toBe(genre);
    for (const chart of CHART_KINDS) expect(chartOfGenre(genreOfChart(chart))).toBe(chart);
    expect(new Set(Object.values(CHART_OF_GENRE)).size).toBe(EXPLORER_GENRES.length);
  });

  it("refuse toute valeur inconnue, y compris le nom de l'autre côté et les clés du prototype", () => {
    for (const unknown of ["pie", "Valeur", "", " valeur", "barres ", "constructor", "__proto__", "toString", "hasOwnProperty", 1, null, undefined, {}, ["value"]]) {
      expect(() => chartOfGenre(unknown)).toThrow(ContractError);
      expect(() => genreOfChart(unknown)).toThrow(ContractError);
    }
    for (const [genre, chart] of PAIRS) {
      expect(() => chartOfGenre(chart)).toThrow(ContractError);
      expect(() => genreOfChart(genre)).toThrow(ContractError);
    }
  });
});
