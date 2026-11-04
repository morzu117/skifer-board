import type { Table } from "apache-arrow";

import { numberColumn, stringColumn } from "../../data/arrow";
import { formatAmount, formatSignedAmount } from "../../format/number";
import type { NavigableItem } from "../ChartCard";
import type { ChartOption } from "../echarts";
import { baseOption, categoryAxis, narrowMedia, valueAxis, type ChartTheme } from "../theme";

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
/**
 * Rupture d'axe quand toutes les variations flottent au-dessus de la moitié du plus haut point :
 * sans elle, elles seraient illisibles à côté des totaux. La rupture est dessinée, donc visible ;
 * les totaux gardent un pied sous la rupture pour rester reconnaissables comme partant de zéro.
 */
/** Plus haut point du pont, totaux et cumuls intermédiaires compris. */
export function bridgeTop(steps: readonly BridgeStep[]): number {
  let running = 0;
  let top = 0;
  for (const step of steps) {
    running = step.kind === "total" ? step.value : running + step.value;
    top = Math.max(top, running);
  }
  return top;
}

/** Maximum d'axe arrondi au chiffre significatif suivant : 10,24 M → 11 M. Évite des graduations dont l'étiquette arrondie se répète. */
export function niceMax(value: number): number {
  if (value <= 0) {
    return 1;
  }
  const step = 10 ** (Math.floor(Math.log10(value)) - 1);
  return Math.ceil(value / step) * step;
}

export function waterfallBreak(steps: readonly BridgeStep[]): { start: number; end: number; gap: string } | null {
  let running = 0;
  let floor = Number.POSITIVE_INFINITY;
  let top = 0;
  for (const step of steps) {
    const start = step.kind === "total" ? 0 : running;
    running = step.kind === "total" ? step.value : running + step.value;
    top = Math.max(top, start, running);
    if (step.kind === "variation") {
      floor = Math.min(floor, start, running);
    }
  }
  if (!Number.isFinite(floor) || floor < top / 2) {
    return null;
  }
  return { start: floor * 0.1, end: floor * 0.95, gap: "6%" };
}

export function waterfallOption(steps: readonly BridgeStep[], theme: ChartTheme): ChartOption {
  const axisBreak = waterfallBreak(steps);
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
    yAxis: { ...valueAxis(theme, (value) => formatAmount(value)), min: 0, max: niceMax(bridgeTop(steps)), ...(axisBreak === null ? {} : { breaks: [axisBreak], breakArea: { itemStyle: { color: theme.surface, borderColor: theme.axis } } }) },
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
    // Forme étroite : étiquettes d'étapes inclinées, montants retirés des barres car ils se
    // chevauchent ; ils restent dans le tableau et dans l'annonce clavier.
    media: narrowMedia(
      { grid: { bottom: 28 }, xAxis: { axisLabel: { rotate: 0 } }, series: [{}, { label: { show: true } }] },
      { grid: { bottom: 72 }, xAxis: { axisLabel: { rotate: 45 } }, series: [{}, { label: { show: false } }] },
    ),
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
