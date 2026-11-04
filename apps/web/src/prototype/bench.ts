/**
 * Mesure du rendu (plan 02, 2.5). Tailles fixées avant l'essai, comme le demande le §6.3 :
 * 100, 1 000 et 10 000 points ; 1 et 12 tuiles ; rendus SVG et canvas. Le temps mesuré est
 * celui d'ECharts jusqu'au dessin (`setOption` est synchrone), sans la peinture du navigateur.
 */
import { CanvasRenderer } from "echarts/renderers";

import { echarts, type ChartOption } from "../charts/echarts";
import { barsOption, categoryValues } from "../charts/specs/bars";
import { baseOption, categoryAxis, SKIFER_CLAIR, valueAxis, type ChartTheme } from "../charts/theme";
import { numberColumn, stringColumn } from "../data/arrow";
import { formatAmount } from "../format/number";
import { benchSeries } from "./fixtures";

echarts.use([CanvasRenderer]);

export type BenchChart = "barres" | "ligne";
export type BenchRenderer = "svg" | "canvas";

export interface BenchCase {
  chart: BenchChart;
  points: number;
  tiles: number;
  renderer: BenchRenderer;
}

export interface BenchResult extends BenchCase {
  /** Temps total pour initialiser et dessiner toutes les tuiles. */
  totalMs: number;
  perTileMs: number;
  /** Tas JavaScript occupé par les tuiles vivantes ; `null` hors Chrome. */
  heapMb: number | null;
}

export const BENCH_PLAN: readonly BenchCase[] = (["barres", "ligne"] as const).flatMap((chart) =>
  [100, 1000, 10_000].flatMap((points) => [1, 12].flatMap((tiles) => (["svg", "canvas"] as const).map((renderer) => ({ chart, points, tiles, renderer })))),
);

const amount = (value: number): string => formatAmount(value);

export function benchOption(chart: BenchChart, points: number, theme: ChartTheme = SKIFER_CLAIR): ChartOption {
  const table = benchSeries(points);
  if (chart === "barres") {
    return barsOption({ data: categoryValues(table, "cle", "valeur"), selected: [], format: amount }, theme);
  }
  return {
    ...baseOption(theme),
    grid: { left: 56, right: 16, top: 16, bottom: 28 },
    xAxis: categoryAxis(theme, stringColumn(table, "cle")),
    yAxis: valueAxis(theme, amount),
    series: [{ type: "line", showSymbol: false, lineStyle: { color: theme.series, width: 1.5 }, data: numberColumn(table, "valeur") }],
  };
}

export interface BenchProbes {
  now: () => number;
  /** Octets du tas JavaScript, ou `null` si le navigateur ne l'expose pas. */
  heap: () => number | null;
  /** Ramasse-miettes explicite, si le navigateur l'expose (`--js-flags=--expose-gc`). */
  collect: () => void;
}

interface ChromePerformance extends Performance {
  memory?: { usedJSHeapSize: number };
}

export const BROWSER_PROBES: BenchProbes = {
  now: () => performance.now(),
  heap: () => (performance as ChromePerformance).memory?.usedJSHeapSize ?? null,
  collect: () => {
    (globalThis as { gc?: () => void }).gc?.();
  },
};

/** Exécute le plan de mesure dans `host`, synchronement, et libère chaque tuile après mesure. */
export function runBench(host: HTMLElement, plan: readonly BenchCase[] = BENCH_PLAN, probes: BenchProbes = BROWSER_PROBES): BenchResult[] {
  return plan.map((benchCase) => {
    const option = benchOption(benchCase.chart, benchCase.points);
    probes.collect();
    const heapBefore = probes.heap();
    const start = probes.now();
    const charts = Array.from({ length: benchCase.tiles }, () => {
      const element = document.createElement("div");
      element.style.width = "600px";
      element.style.height = "240px";
      host.append(element);
      const chart = echarts.init(element, undefined, { renderer: benchCase.renderer });
      chart.setOption(option);
      return chart;
    });
    const totalMs = probes.now() - start;
    const heapAfter = probes.heap();
    for (const chart of charts) {
      chart.dispose();
    }
    host.replaceChildren();
    const heapMb = heapBefore === null || heapAfter === null ? null : (heapAfter - heapBefore) / 1_048_576;
    return { ...benchCase, totalMs, perTileMs: totalMs / benchCase.tiles, heapMb };
  });
}
