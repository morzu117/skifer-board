import type { Table } from "apache-arrow";

import { numberColumn, stringColumn } from "../../data/arrow";
import { formatMonthLong, formatMonthShort } from "../../format/date";
import { MISSING } from "../../format/number";
import type { NavigableItem } from "../ChartCard";
import type { ChartOption } from "../echarts";
import { baseOption, categoryAxis, valueAxis, type ChartTheme } from "../theme";
import { thresholdLine, type Threshold } from "./bars";

/** Réalisé et référence par période : deux métriques d'un même résultat. */
export interface ActualVsReference {
  periods: string[];
  actual: (number | null)[];
  reference: (number | null)[];
}

export function actualVsReference(table: Table, period: string, actual: string, reference: string): ActualVsReference {
  return { periods: stringColumn(table, period), actual: numberColumn(table, actual), reference: numberColumn(table, reference) };
}

export interface CombinedInput {
  data: ActualVsReference;
  actualLabel: string;
  referenceLabel: string;
  format: (value: number) => string;
  threshold?: Threshold;
}

/** Graphique combiné : réalisé en barres, référence en ligne, seuil éventuel. */
export function combinedOption({ data, actualLabel, referenceLabel, format, threshold }: CombinedInput, theme: ChartTheme): ChartOption {
  return {
    ...baseOption(theme),
    grid: { left: 56, right: 16, top: 28, bottom: 28 },
    tooltip: { ...baseOption(theme).tooltip, trigger: "axis" },
    xAxis: categoryAxis(theme, data.periods.map(formatMonthShort)),
    yAxis: valueAxis(theme, format),
    series: [
      {
        type: "bar",
        name: actualLabel,
        barMaxWidth: 40,
        itemStyle: { color: theme.series },
        data: [...data.actual],
        ...(threshold === undefined ? {} : { markLine: thresholdLine(theme, threshold) }),
      },
      {
        type: "line",
        name: referenceLabel,
        symbol: "circle",
        symbolSize: 6,
        lineStyle: { color: theme.secondary, width: 2 },
        itemStyle: { color: theme.secondary },
        data: [...data.reference],
      },
    ],
  };
}

const show = (value: number | null | undefined, format: (value: number) => string): string => (value === null || value === undefined ? MISSING : format(value));

export function combinedDescription(input: CombinedInput): string {
  const { data, actualLabel, referenceLabel } = input;
  const above = data.periods.filter((_, index) => {
    const actual = data.actual[index];
    const reference = data.reference[index];
    return actual !== null && actual !== undefined && reference !== null && reference !== undefined && actual >= reference;
  });
  const first = data.periods[0];
  const last = data.periods.at(-1);
  const span = first === undefined || last === undefined ? "aucune période" : `de ${formatMonthLong(first)} à ${formatMonthLong(last)}`;
  return `Graphique combiné, ${actualLabel} en barres et ${referenceLabel} en ligne, ${span}. ${actualLabel} atteint ou dépasse ${referenceLabel} sur ${above.length} période(s) sur ${data.periods.length}.`;
}

export function periodItems({ data, actualLabel, referenceLabel, format }: CombinedInput): NavigableItem[] {
  return data.periods.map((period, index) => ({
    key: period,
    announcement: `${formatMonthLong(period)} : ${actualLabel} ${show(data.actual[index], format)}, ${referenceLabel} ${show(data.reference[index], format)}`,
  }));
}
