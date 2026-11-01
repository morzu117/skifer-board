import type { Table } from "apache-arrow";

import { numberColumn, stringColumn } from "../../data/arrow";
import { formatMonthLong, formatMonthShort } from "../../format/date";
import type { NavigableItem } from "../ChartCard";
import type { ChartOption } from "../echarts";
import { baseOption, categoryAxis, contrastRatio, narrowMedia, type ChartTheme } from "../theme";

/** Grille ligne × colonne d'une métrique, lue depuis un résultat au format long. */
export interface Grid {
  rows: string[];
  columns: string[];
  /** `values[r][c]`, nulle si la combinaison est absente du résultat. */
  values: (number | null)[][];
}

export function gridOf(table: Table, row: string, column: string, metric: string): Grid {
  const rowKeys = stringColumn(table, row);
  const columnKeys = stringColumn(table, column);
  const metricValues = numberColumn(table, metric);
  const rows = [...new Set(rowKeys)];
  const columns = [...new Set(columnKeys)];
  const values = rows.map(() => columns.map((): number | null => null));
  metricValues.forEach((value, index) => {
    const cells = values[rows.indexOf(rowKeys[index] as string)] as (number | null)[];
    cells[columns.indexOf(columnKeys[index] as string)] = value;
  });
  return { rows, columns, values };
}

/** Classe d'une échelle quantifiée : un intervalle, une couleur du thème. */
export interface Bin {
  from: number;
  to: number;
  color: string;
}

/**
 * Échelle quantifiée à intervalles égaux, un palier du thème par classe : chaque couleur de
 * cellule est un token, sans interpolation (RULES §5.4).
 */
export function binsOf(grid: Grid, theme: ChartTheme): Bin[] {
  const present = grid.values.flat().filter((value): value is number => value !== null);
  if (present.length === 0) {
    return [];
  }
  const min = Math.min(...present);
  const max = Math.max(...present);
  const count = min === max ? 1 : theme.sequential.length;
  const width = (max - min) / count;
  return theme.sequential.slice(0, count).map((color, index) => ({ from: min + index * width, to: index === count - 1 ? max : min + (index + 1) * width, color }));
}

export function binOf(bins: readonly Bin[], value: number): Bin {
  return bins.find((bin) => value <= bin.to) ?? (bins.at(-1) as Bin);
}

/** Couleur de texte lisible sur une cellule : la plus contrastée des deux textes du thème. */
export function labelColor(theme: ChartTheme, cell: string): string {
  return contrastRatio(theme.textStrong, cell) >= contrastRatio(theme.surface, cell) ? theme.textStrong : theme.surface;
}

export function heatmapOption(grid: Grid, theme: ChartTheme, format: (value: number) => string): ChartOption {
  const bins = binsOf(grid, theme);
  const data = grid.values.flatMap((cells, row) =>
    cells.flatMap((value, column) => {
      if (value === null) {
        return [];
      }
      return [{ value: [column, row, value], label: { color: labelColor(theme, binOf(bins, value).color) } }];
    }),
  );
  return {
    ...baseOption(theme),
    grid: { left: 150, right: 16, top: 8, bottom: 28 },
    tooltip: { show: false },
    // ECharts colore une heatmap par un visualMap : par paliers, un token par classe, masqué au
    // profit de la légende HTML.
    visualMap: { type: "piecewise", show: false, dimension: 2, pieces: bins.map((bin) => ({ gte: bin.from, lte: bin.to, color: bin.color })) },
    xAxis: { ...categoryAxis(theme, grid.columns.map(formatMonthShort)), splitArea: { show: false } },
    yAxis: { ...categoryAxis(theme, grid.rows), inverse: true },
    series: [
      {
        type: "heatmap",
        data,
        itemStyle: { borderColor: theme.surface, borderWidth: 2 },
        label: {
          show: true,
          fontFamily: theme.fontMono,
          fontSize: 10,
          formatter: ({ value }: { value: [number, number, number] }) => format(value[2]),
        },
      },
    ],
    // Forme étroite : montants retirés des cellules, trop petites pour les porter ; la couleur
    // et la légende par paliers restent, et le tableau donne chaque valeur.
    media: narrowMedia(
      { grid: { left: 150, bottom: 28 }, xAxis: { axisLabel: { rotate: 0 } }, series: [{ label: { show: true } }] },
      { grid: { left: 112, bottom: 48 }, xAxis: { axisLabel: { rotate: 45 } }, series: [{ label: { show: false } }] },
    ),
  };
}

/** Cellules présentes, avec leurs clés de ligne et de colonne. */
function cellsOf(grid: Grid): { row: string; column: string; value: number }[] {
  return grid.rows.flatMap((row, r) =>
    grid.columns.flatMap((column, c) => {
      const value = grid.values[r]?.[c] ?? null;
      return value === null ? [] : [{ row, column, value }];
    }),
  );
}

export function heatmapDescription(subject: string, grid: Grid, format: (value: number) => string): string {
  const cells = cellsOf(grid).sort((a, b) => a.value - b.value);
  const size = `${grid.rows.length} lignes sur ${grid.columns.length} colonnes`;
  const low = cells[0];
  const high = cells.at(-1);
  if (low === undefined || high === undefined) {
    return `Carte de chaleur de ${subject}, ${size}, aucune valeur.`;
  }
  return `Carte de chaleur de ${subject}, ${size}, de ${format(low.value)} (${low.row}, ${formatMonthLong(low.column)}) à ${format(high.value)} (${high.row}, ${formatMonthLong(high.column)}).`;
}

/** Éléments parcourus au clavier : les cellules, ligne par ligne. */
export function cellItems(grid: Grid, format: (value: number) => string): NavigableItem[] {
  return grid.rows.flatMap((row, r) =>
    grid.columns.map((column, c) => {
      const value = grid.values[r]?.[c] ?? null;
      return { key: `${row}|${column}`, announcement: `${row}, ${formatMonthLong(column)} : ${value === null ? "aucune valeur" : format(value)}` };
    }),
  );
}
