import type { Table } from "apache-arrow";

import { numberColumn, stringColumn } from "../../data/arrow";
import { MISSING } from "../../format/number";
import type { NavigableItem } from "../ChartCard";
import type { ChartOption } from "../echarts";
import { baseOption, categoryAxis, valueAxis, type ChartTheme } from "../theme";

/** Valeurs d'une métrique par catégorie, dans l'ordre du résultat. */
export interface CategoryValues {
  categories: string[];
  values: (number | null)[];
}

export function categoryValues(table: Table, dimension: string, metric: string): CategoryValues {
  return { categories: stringColumn(table, dimension), values: numberColumn(table, metric) };
}

export interface Threshold {
  value: number;
  label: string;
}

/** Style d'une barre selon la sélection : cuivre si sélectionnée, atténuée et bordée sinon. */
export function barStyle(theme: ChartTheme, selected: readonly string[], category: string) {
  if (selected.length === 0) {
    return { color: theme.series };
  }
  return selected.includes(category) ? { color: theme.selected } : { color: theme.unselectedFill, borderColor: theme.unselectedEdge, borderWidth: 1 };
}

/** Ligne de seuil : pointillé cuivre, étiquette en cuivre foncé (DESIGN-SYSTEM §5). */
export function thresholdLine(theme: ChartTheme, threshold: Threshold, horizontal = false) {
  return {
    silent: true,
    symbol: "none",
    lineStyle: { color: theme.threshold, type: "dashed", width: 1.5 },
    label: { formatter: threshold.label, color: theme.thresholdLabel, position: "insideStartTop", fontSize: 11 },
    data: [horizontal ? { xAxis: threshold.value } : { yAxis: threshold.value }],
  };
}

/** Au-delà, les étiquettes de valeur se chevauchent : le tableau et l'infobulle les portent. */
export const MAX_LABELLED_BARS = 40;

export interface BarsInput {
  data: CategoryValues;
  selected: readonly string[];
  format: (value: number) => string;
  threshold?: Threshold;
  /** Barres horizontales, pour des libellés de catégorie longs ; la première catégorie en haut. */
  horizontal?: boolean;
}

export function barsOption({ data, selected, format, threshold, horizontal = false }: BarsInput, theme: ChartTheme): ChartOption {
  const categories = categoryAxis(theme, data.categories);
  const values = valueAxis(theme, format);
  return {
    ...baseOption(theme),
    grid: horizontal ? { left: 120, right: 64, top: 8, bottom: 28 } : { left: 56, right: 16, top: 28, bottom: 28 },
    xAxis: horizontal ? values : categories,
    yAxis: horizontal ? { ...categories, inverse: true } : values,
    tooltip: { ...baseOption(theme).tooltip, trigger: "item" },
    series: [
      {
        type: "bar",
        barMaxWidth: 48,
        data: data.categories.map((category, index) => ({ value: data.values[index] ?? null, itemStyle: barStyle(theme, selected, category) })),
        label: {
          show: data.categories.length <= MAX_LABELLED_BARS,
          position: horizontal ? "right" : "top",
          color: theme.textStrong,
          fontFamily: theme.fontMono,
          fontSize: 11,
          formatter: ({ value }: { value: unknown }) => (typeof value === "number" ? format(value) : MISSING),
        },
        ...(threshold === undefined ? {} : { markLine: thresholdLine(theme, threshold, horizontal) }),
      },
    ],
  };
}

/** Extrêmes d'une série, valeurs nulles écartées. */
export function extremes(data: CategoryValues): { max: [string, number]; min: [string, number] } | null {
  const present = data.categories.flatMap((category, index) => {
    const value = data.values[index];
    return value === null || value === undefined ? [] : [[category, value] as [string, number]];
  });
  if (present.length === 0) {
    return null;
  }
  const sorted = [...present].sort((a, b) => b[1] - a[1]);
  return { max: sorted[0] as [string, number], min: sorted.at(-1) as [string, number] };
}

/** Description accessible : contenu, extrêmes et sélection, en français. */
export function barsDescription(subject: string, data: CategoryValues, selected: readonly string[], format: (value: number) => string): string {
  const range = extremes(data);
  const content =
    range === null
      ? "aucune valeur"
      : `valeur la plus forte ${range.max[0]} (${format(range.max[1])}), la plus faible ${range.min[0]} (${format(range.min[1])})`;
  const selection = selected.length === 0 ? "Aucune sélection." : `Sélection : ${selected.join(", ")}.`;
  return `Histogramme de ${subject}, ${data.categories.length} catégories, ${content}. ${selection}`;
}

/** Éléments parcourus au clavier : une barre par catégorie. */
export function categoryItems(data: CategoryValues, format: (value: number) => string): NavigableItem[] {
  return data.categories.map((category, index) => {
    const value = data.values[index] ?? null;
    return { key: category, announcement: `${category} : ${value === null ? MISSING : format(value)}` };
  });
}
