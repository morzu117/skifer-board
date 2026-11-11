import type { ChartKind } from "../../analyses/document";
import type { NavigableItem } from "../../charts/ChartCard";
import type { ChartOption } from "../../charts/echarts";
import { thresholdLine } from "../../charts/specs/bars";
import { baseOption, categoryAxis, narrowMedia, valueAxis, type ChartTheme } from "../../charts/theme";
import { formatNumber, formatPercent, MISSING } from "../../format/number";
import type { Legend, NumberFormat, Threshold, Tooltip } from "../document";

/**
 * Ce qu'une tuile montre d'un résultat (plan 19, 19.5a, B9) : la présentation du document n'agit que sur l'affichage. Les
 * données arrivent déjà en texte exact (`cellules` de l'Explorateur) et ne sont arrondies que si la personne qui compose a
 * demandé un format ; `auto` laisse la valeur telle que le moteur l'a rendue. Aucune option ECharts n'est exposée : elles sont
 * toutes écrites ici, depuis les propriétés sémantiques, avec les rôles visuels du thème.
 */
export type Cells = Readonly<Record<string, string>>;

/** Ce que la tuile lit de sa requête : les métriques et dimensions rendues, dans l'ordre. */
export interface Shape {
  metrics: readonly string[];
  dimensions: readonly string[];
}

/** Présentation résolue d'un visuel (B9), champ par champ. */
export interface Style {
  chart: ChartKind;
  legend: Legend;
  numberFormat: NumberFormat;
  threshold: Threshold | undefined;
  tooltip: Tooltip;
}

const NUMERIC = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i;

/** Une valeur du résultat sous son format : `auto` la garde telle quelle, les autres arrondissent à la demande. */
export function formatValue(text: string, format: NumberFormat): string {
  if (format === "auto" || !NUMERIC.test(text)) return text;
  const value = Number(text);
  switch (format) {
    case "integer": return formatNumber(value, 0);
    case "decimal_1": return formatNumber(value, 1);
    case "decimal_2": return formatNumber(value, 2);
    case "percent": return formatPercent(value, 1);
    case "compact": return new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  }
}

const escape = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Une valeur absente du résultat (`—`) reste absente : jamais zéro. */
const present = (text: string | undefined): string | null => (text === undefined || text === MISSING ? null : text);

/** Raison pour laquelle un type de graphique ne peut pas montrer ce résultat, ou `null`. */
export function chartProblem(chart: ChartKind, rows: number, shape: Shape): string | null {
  if (chart === "value" && (shape.dimensions.length > 0 || rows > 1)) return "Le type Valeur ne montre qu'un résultat sans dimension, sur une seule ligne.";
  return null;
}

function categoriesOf(rows: readonly Cells[], dimensions: readonly string[]): string[] {
  return rows.map((row, index) => dimensions.map((name) => row[name] ?? MISSING).join(" · ") || `Ligne ${String(index + 1)}`);
}

export interface Drawn {
  option: ChartOption;
  items: NavigableItem[];
  description: string;
}

/**
 * Option, éléments parcourus au clavier et description d'un graphique de tuile. `definitions` donne la définition métier de
 * chaque métrique, pour l'infobulle `value_and_definition` ; une définition absente se dit « indisponible ».
 */
export function drawChart(rows: readonly Cells[], shape: Shape, style: Style, theme: ChartTheme, definitions: Readonly<Record<string, string | undefined>>): Drawn {
  const { chart, numberFormat } = style;
  const show = (text: string | null): string => (text === null ? MISSING : formatValue(text, numberFormat));
  const metrics = shape.metrics.map((name) => ({ name, values: rows.map((row) => present(row[name])) }));
  const description = (genre: string): string => `${genre} de ${shape.metrics.join(", ")} : ${String(rows.length)} ligne${rows.length > 1 ? "s" : ""}. Les valeurs exactes figurent dans le tableau.`;
  if (chart === "value") {
    const lines = metrics.map((metric, index) => ({
      type: "text",
      left: "center",
      top: 20 + index * 40,
      style: { text: `${metric.name} : ${show(metric.values[0] ?? null)}`, fill: theme.textStrong, font: `18px ${theme.fontMono}` },
    }));
    const limit = style.threshold === undefined ? [] : [{ type: "text", left: "center", top: 20 + metrics.length * 40, style: { text: `Seuil ${style.threshold.label} : ${String(style.threshold.value)}`, fill: theme.thresholdLabel, font: `13px ${theme.fontSans}` } }];
    return {
      option: { ...baseOption(theme), graphic: [...lines, ...limit] },
      items: metrics.map((metric) => ({ key: metric.name, announcement: `${metric.name} : ${show(metric.values[0] ?? null)}` })),
      description: description("Valeur"),
    };
  }
  const grouped = chart === "grouped_bars" && shape.dimensions.length > 1;
  // Lue seulement quand les barres sont groupées, donc avec au moins deux dimensions.
  const last = shape.dimensions.at(-1) as string;
  const rowLabels = categoriesOf(rows, grouped ? shape.dimensions.slice(0, -1) : shape.dimensions);
  // Barres groupées : une catégorie par combinaison des premières dimensions, une série par valeur de la dernière.
  const labels = grouped ? [...new Set(rowLabels)] : rowLabels;
  const groupOf = (row: Cells): string => (row[last] ?? MISSING);
  const palette = [theme.series, theme.secondary];
  const type = chart === "line" ? "line" : "bar";
  const seriesList = grouped
    ? [...new Set(rows.map(groupOf))].flatMap((group) => shape.metrics.map((metric) => ({ name: `${group} · ${metric}`, metric, group })))
    : shape.metrics.map((metric) => ({ name: metric, metric, group: undefined }));
  const cell = (dataIndex: number, one: (typeof seriesList)[number]): string | null => {
    const row = grouped ? rows.find((candidate, index) => rowLabels[index] === labels[dataIndex] && groupOf(candidate) === one.group) : rows[dataIndex];
    return present(row?.[one.metric]);
  };
  const series = seriesList.map((one, index) => ({
    name: one.name,
    type,
    itemStyle: { color: palette[index % palette.length] },
    ...(type === "line" ? { lineStyle: { color: palette[index % palette.length] } } : {}),
    data: labels.map((_, dataIndex) => cell(dataIndex, one)),
    ...(index === 0 && style.threshold !== undefined ? { markLine: thresholdLine(theme, style.threshold) } : {}),
  }));
  const defined = (metric: string): string => definitions[metric] ?? "Définition indisponible";
  const tooltip = style.tooltip === "value_and_definition"
    ? { ...baseOption(theme).tooltip, trigger: "item", formatter: (params: { seriesName?: string; name?: string; value?: unknown }) => {
      const found = seriesList.find((one) => one.name === params.seriesName);
      const value = typeof params.value === "string" ? show(params.value) : MISSING;
      return `${escape(params.name ?? "")} · ${escape(params.seriesName ?? "")} : ${escape(value)}<br/>${escape(defined(found?.metric ?? ""))}`;
    } }
    : { ...baseOption(theme).tooltip, trigger: "item" };
  const legendShown = style.legend === "shown" || (style.legend === "auto" && series.length > 1);
  const option: ChartOption = {
    ...baseOption(theme),
    tooltip,
    legend: { show: legendShown, top: 0, textStyle: { color: theme.text, fontFamily: theme.fontSans, fontSize: 11 } },
    grid: { left: 56, right: 16, top: legendShown ? 40 : 28, bottom: 28 },
    xAxis: categoryAxis(theme, labels),
    yAxis: valueAxis(theme, (value) => (numberFormat === "auto" ? String(value) : formatValue(String(value), numberFormat))),
    series,
    media: narrowMedia({ grid: { bottom: 28 }, xAxis: { axisLabel: { rotate: 0 } } }, { grid: { bottom: 72 }, xAxis: { axisLabel: { rotate: 45 } } }),
  };
  const items = labels.flatMap((label, dataIndex) => seriesList.map((one, seriesIndex) => ({
    key: `${String(dataIndex)}:${String(seriesIndex)}`,
    dataIndex,
    seriesIndex,
    announcement: `${label}${seriesList.length === 1 ? "" : ` · ${one.name}`} : ${show(cell(dataIndex, one))}`,
  })));
  return { option, items, description: description(chart === "line" ? "Ligne" : grouped ? "Barres groupées" : "Barres") };
}
