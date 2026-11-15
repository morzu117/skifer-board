import rawTheme from "../../../../../contracts/themes/fixtures/valid/clair.json";
import { decodeTheme } from "../../themes/document";
import { expect, it } from "vitest";
import { analysisBody, ANALYSES, N } from "./testing";
import { decodeRevision } from "../../analyses/model";
import { effective, styleOf, themePresentation, THEME_KPI, THEME_VISUAL, titleOf, withField, withoutField } from "./presentation";
import type { AnalysisComponent, KpiComponent } from "../document";

const pinned = (id: string) => decodeRevision(analysisBody(id, ANALYSES[id] as never), "finance");
const visual = (presentation: AnalysisComponent["presentation"] = {}): AnalysisComponent => ({ id: N.visual, type: "analysis", reference: { analysis_id: N.bars, revision: 1 }, presentation });
const kpi = (presentation: KpiComponent["presentation"] = {}): KpiComponent => ({ id: N.kpi, type: "kpi", reference: { analysis_id: N.total, revision: 1 }, presentation });

it("résout un visuel : thème, analyse, défauts du dashboard et surcharge, avec l'origine", () => {
  const found = effective(visual({ legend: "hidden", threshold: { value: 3, label: "Cible" } }), pinned(N.bars), { number_format: "percent" });
  if (found.type !== "analysis") throw new Error("visuel attendu");
  expect(titleOf(found)).toBe("Chiffre d'affaires par région");
  expect(found.fields.title.origin).toBe("analysis");
  expect(found.fields.legend).toMatchObject({ value: "hidden", origin: "component" });
  expect(found.fields.number_format).toMatchObject({ value: "percent", origin: "dashboard" });
  expect(found.fields.tooltip.origin).toBe("theme");
  expect(styleOf(found)).toEqual({ chart: "bars", legend: "hidden", numberFormat: "percent", threshold: { value: 3, label: "Cible" }, tooltip: "value" });
});

it("un KPI se lit toujours comme une valeur, sans légende ni type de graphique", () => {
  const found = effective(kpi({ title: "Mon total", number_format: "integer" }), pinned(N.total), {});
  expect(found.type).toBe("kpi");
  expect(titleOf(found)).toBe("Mon total");
  expect(styleOf(found)).toEqual({ chart: "value", legend: "auto", numberFormat: "integer", threshold: undefined, tooltip: "value" });
  expect(THEME_VISUAL.legend).toBe("auto");
  expect(THEME_KPI.number_format).toBe("auto");
});

it("pose ou retire une surcharge sans toucher aux autres, et sans clé indéfinie", () => {
  const base = { legend: "shown" as const, tooltip: "value" as const };
  expect(withField(base, "number_format", "integer")).toEqual({ ...base, number_format: "integer" });
  expect(withField(base, "legend", "hidden")).toEqual({ legend: "hidden", tooltip: "value" });
  const removed = withoutField(base, "legend");
  expect(removed).toEqual({ tooltip: "value" });
  expect("legend" in removed).toBe(false);
  expect(withoutField(base, "title")).toEqual(base);
});


it("applique les défauts par graphique et garde le nom du thème", () => {
  const theme = decodeTheme(rawTheme);
  expect(themePresentation(undefined, "bars")).toEqual(THEME_VISUAL);
  expect(themePresentation(theme, "bars")).toEqual({ legend: "auto", number_format: "integer", tooltip: "value" });
  expect(themePresentation(theme, "line")).toEqual({ legend: "auto", number_format: "auto", tooltip: "value" });
  const baseline = effective(visual(), pinned(N.bars), {}, theme);
  expect(baseline.themeName).toBe("Clair");
  if (baseline.type !== "analysis") throw new Error("visuel attendu");
  expect(baseline.fields.chart).toEqual({ value: "bars", origin: "analysis" });
  expect(baseline.fields.title.origin).toBe("analysis");
  expect(baseline.fields.number_format).toEqual({ value: "integer", origin: "theme" });
  const dashboard = effective(visual(), pinned(N.bars), { number_format: "percent" }, theme);
  expect(dashboard.fields.number_format).toEqual({ value: "percent", origin: "dashboard" });
  const overridden = effective(visual({ chart: "line", number_format: "decimal_2" }), pinned(N.bars), { number_format: "percent" }, theme);
  if (overridden.type !== "analysis") throw new Error("visuel attendu");
  expect(overridden.fields.chart).toEqual({ value: "line", origin: "component" });
  expect(overridden.fields.number_format).toEqual({ value: "decimal_2", origin: "component" });
  const total = effective(kpi(), pinned(N.total), {}, theme);
  expect(total.themeName).toBe("Clair");
  expect(total.fields.number_format).toEqual({ value: "auto", origin: "theme" });
});
