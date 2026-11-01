import type { Table } from "apache-arrow";

import { numberColumn, stringColumn } from "../../data/arrow";
import { formatAmount, formatSignedAmount } from "../../format/number";
import type { NavigableItem } from "../ChartCard";
import type { ChartOption } from "../echarts";
import { baseOption, categoryAxis, valueAxis, type ChartTheme } from "../theme";

export interface BridgeStep {
  label: string;
  value: number;
  kind: "total" | "variation";
}

/** Le pont ne se dessine pas si ses totaux ne se recoupent pas : il mentirait. */
export class BridgeError extends Error {}

/** Tolérance d'arrondi entre un total et le précédent augmenté des variations. */
const TOLERANCE = 0.5;

export function bridgeSteps(table: Table, label: string, value: string, kind: string): BridgeStep[] {
  const labels = stringColumn(table, label);
  const values = numberColumn(table, value);
  const kinds = stringColumn(table, kind);
  const steps = labels.map((stepLabel, index): BridgeStep => {
    const amount = values[index] ?? null;
    const stepKind = kinds[index];
    if (amount === null) {
      throw new BridgeError(`Étape sans valeur : ${stepLabel}`);
    }
    if (stepKind !== "total" && stepKind !== "variation") {
      throw new BridgeError(`Nature d'étape inconnue : ${String(stepKind)}`);
    }
    return { label: stepLabel, value: amount, kind: stepKind };
  });
  checkBridge(steps);
  return steps;
}

/** Vérifie qu'un pont commence et finit par un total et que chaque total recoupe le cumul. */
export function checkBridge(steps: readonly BridgeStep[]): void {
  if (steps[0]?.kind !== "total" || steps.at(-1)?.kind !== "total") {
    throw new BridgeError("Un pont commence et finit par un total");
  }
  let running = 0;
  for (const [index, step] of steps.entries()) {
    if (step.kind === "variation") {
      running += step.value;
    } else {
      if (index > 0 && Math.abs(step.value - running) > TOLERANCE) {
        throw new BridgeError(`Le total « ${step.label} » ne recoupe pas les variations : écart ${formatSignedAmount(step.value - running)}`);
      }
      running = step.value;
    }
    // L'empilement sur une base invisible ne sait pas dessiner un cumul négatif (limite du lot 01).
    if (running < 0) {
      throw new BridgeError(`Cumul négatif à l'étape « ${step.label} » : non pris en charge par ce waterfall`);
    }
  }
}

/**
 * Waterfall : barres empilées sur une base invisible. La base est une aide de dessin, ni
 * annoncée, ni dans l'infobulle, ni dans le tableau.
 */
export function waterfallOption(steps: readonly BridgeStep[], theme: ChartTheme): ChartOption {
  let running = 0;
  const base: number[] = [];
  const visible = steps.map((step) => {
    if (step.kind === "total") {
      running = step.value;
      base.push(0);
      return { value: step.value, itemStyle: { color: theme.total } };
    }
    const start = running;
    running += step.value;
    base.push(Math.min(start, running));
    return { value: Math.abs(step.value), itemStyle: { color: step.value >= 0 ? theme.positive : theme.negative } };
  });
  return {
    ...baseOption(theme),
    grid: { left: 56, right: 16, top: 28, bottom: 28 },
    tooltip: { show: false },
    xAxis: categoryAxis(theme, steps.map((step) => step.label)),
    yAxis: valueAxis(theme, (value) => formatAmount(value)),
    series: [
      { type: "bar", stack: "pont", silent: true, itemStyle: { color: "transparent" }, data: base },
      {
        type: "bar",
        stack: "pont",
        barMaxWidth: 48,
        data: visible,
        label: {
          show: true,
          position: "top",
          color: theme.textStrong,
          fontFamily: theme.fontMono,
          fontSize: 11,
          formatter: ({ dataIndex }: { dataIndex: number }) => stepText(steps[dataIndex] as BridgeStep),
        },
      },
    ],
  };
}

/** Texte d'une étape : un total en montant, une variation signée. */
export function stepText(step: BridgeStep): string {
  return step.kind === "total" ? formatAmount(step.value) : formatSignedAmount(step.value);
}

export function waterfallDescription(subject: string, steps: readonly BridgeStep[]): string {
  const first = steps[0] as BridgeStep;
  const last = steps.at(-1) as BridgeStep;
  const variations = steps.filter((step) => step.kind === "variation");
  const largest = [...variations].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
  const driver = largest === undefined ? "" : ` Contribution la plus forte : ${largest.label} (${stepText(largest)}).`;
  return `Waterfall de ${subject}, de ${first.label} (${stepText(first)}) à ${last.label} (${stepText(last)}), ${variations.length} variations.${driver}`;
}

export function stepItems(steps: readonly BridgeStep[]): NavigableItem[] {
  return steps.map((step) => ({ key: step.label, announcement: `${step.label} : ${stepText(step)}` }));
}
