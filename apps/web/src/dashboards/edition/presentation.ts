import type { ChartKind } from "../../analyses/document";
import type { AnalysisRevision } from "../../analyses/model";
import type { Defaults, ExecutableComponent, KpiPresentation, Legend, NumberFormat, Tooltip, VisualPresentation } from "../document";
import { resolveKpi, resolveVisual, type Resolved } from "./commands";
import type { Style } from "./tileChart";

/**
 * Présentation effective d'un composant exécutable (plan 19, B9) : le thème, l'analyse épinglée, les défauts du dashboard et
 * la surcharge du composant, du plus faible au plus fort, avec l'origine de chaque champ. Le thème de l'éditeur ne porte que des
 * valeurs d'affichage : aucune ne change la requête.
 */
export const THEME_VISUAL: VisualPresentation = { legend: "auto", number_format: "auto", tooltip: "value" };
export const THEME_KPI: KpiPresentation = { number_format: "auto", tooltip: "value" };

/** Le résultat est celui de `resolveVisual` pour un visuel et de `resolveKpi` pour un KPI, que le type de `component` désigne. */
export type Effective = { type: "analysis"; fields: Resolved<VisualPresentation> } | { type: "kpi"; fields: Resolved<KpiPresentation> };

export function effective(component: ExecutableComponent, pinned: AnalysisRevision, defaults: Defaults): Effective {
  const analysis = { chart: pinned.analysis.presentation.chart, title: pinned.analysis.name };
  if (component.type === "kpi") return { type: "kpi", fields: resolveKpi(THEME_KPI, { title: analysis.title }, defaults, component.presentation) };
  return { type: "analysis", fields: resolveVisual(THEME_VISUAL, analysis, defaults, component.presentation) };
}

/** Titre effectif d'une tuile (surcharge du composant, sinon nom de l'analyse épinglée). */
export const titleOf = (found: Effective): string => found.fields.title.value as string;

/** Ce que la tuile dessine, champ par champ ; un KPI se lit toujours comme une valeur. */
export function styleOf(found: Effective): Style {
  const { fields } = found;
  return {
    chart: found.type === "analysis" ? (found.fields.chart.value as ChartKind) : "value",
    legend: found.type === "analysis" ? (found.fields.legend.value as Legend) : "auto",
    numberFormat: fields.number_format.value as NumberFormat,
    threshold: fields.threshold.value,
    tooltip: fields.tooltip.value as Tooltip,
  };
}

type Overrides = VisualPresentation & KpiPresentation;

/** La surcharge `field` posée à `value`, les autres intactes. */
export function withField<T extends Overrides>(presentation: T, field: keyof Overrides, value: unknown): T {
  return { ...presentation, [field]: value };
}

/** La surcharge `field` retirée : la clé disparaît (le décodeur refuse un `undefined` explicite). */
export function withoutField<T extends Overrides>(presentation: T, field: keyof Overrides): T {
  return Object.fromEntries(Object.entries(presentation).filter(([key]) => key !== field)) as T;
}
