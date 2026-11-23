import { describe, expect, it, vi } from "vitest";
import * as analysisDocument from "../../analyses/document";
import type { AnalysisRevision } from "../../analyses/model";
import type { ComponentDocument } from "../../components-lib/document";
import type { CommonFilter, ExecutableComponent } from "../document";
import type { Tile } from "../model";
import { composeExecution } from "./execution";
import { drawChart, type Style } from "./tileChart";
import { chartThemeOf } from "../../themes/chartTheme";
import { decodeTheme } from "../../themes/document";
import { TOKEN_CATALOG } from "../../themes/catalog";
import light from "../../../../../contracts/themes/fixtures/valid/skifer_clair.json";
import dark from "../../../../../contracts/themes/fixtures/valid/skifer_ardoise.json";
import custom from "../../../../../contracts/themes/fixtures/valid/clair.json";

const component: ExecutableComponent = { id: "tile", type: "analysis", reference: { analysis_id: "analysis", revision: 2 }, presentation: {} };
const revision = { id: "analysis", revision: 2, state: "ready", analysis: { query: { connection: "main", model: "sales", metrics: ["total"], dimensions: [], filters: [{ column: "country", operator: "eq", value: "FR" }] } } } as unknown as AnalysisRevision;
const filter: CommonFilter = { id: "filter", label: "Pays", dimension: "country", operator: "eq", default: "DE", targets: ["tile"] };
const tile: Tile = { id: "tile", state: "ready" };
const compose = (c: ExecutableComponent = component, r = revision, f: readonly CommonFilter[] = [filter], v: Readonly<Record<string, unknown>> = {}, t: Tile = tile) => composeExecution(c, r, f, v, t, "DEV");

describe("composition des tuiles", () => {
  it.each(["value", "bars", "line", "grouped_bars"] as const)("conserve la requête et les données du graphique %s entre thèmes", (chart) => {
    const themes = [light, dark, custom].map((fixture) => chartThemeOf(decodeTheme(fixture), TOKEN_CATALOG));
    const shape = { metrics: ["revenue"], dimensions: chart === "value" ? [] : chart === "grouped_bars" ? ["region", "country"] : ["region"] };
    const rows = chart === "value" ? [{ revenue: "12" }] : [{ region: "Nord", country: "FR", revenue: "12" }, { region: "Sud", country: "DE", revenue: "5" }];
    const style: Style = { chart, legend: "auto", numberFormat: "auto", threshold: undefined, tooltip: "value" };
    const withoutVisualStyle = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(withoutVisualStyle);
      if (typeof value !== "object" || value === null) return value;
      return Object.fromEntries(Object.entries(value).filter(([key]) => !["color", "backgroundColor", "borderColor", "fontFamily", "font", "fill", "stroke"].includes(key)).map(([key, item]) => [key, withoutVisualStyle(item)]));
    };
    const results = themes.map((theme) => {
      const request = compose(component, revision, [filter]);
      const chartResult = drawChart(rows, shape, style, theme, {});
      const option = chartResult.option as Record<string, unknown>;
      const series = (option.series ?? []) as { name: string; type: string; data: unknown }[];
      const axes = option.xAxis as { data?: unknown } | undefined;
      const graphic = (option.graphic ?? []) as { style: { text: string } }[];
      return JSON.stringify({ request, option: withoutVisualStyle(option), series: series.map(({ name, type, data }) => ({ name, type, data })), categories: axes?.data, text: graphic.map((item) => item.style.text), items: chartResult.items });
    });
    expect(new Set(results).size).toBe(1);
  });
  it("garde la requête et les données avec un format de date différent", () => {
    const first = decodeTheme(light);
    const second = { ...first, formats: { ...first.formats, date: "long" as const } };
    const shape = { metrics: ["revenue"], dimensions: ["jour"], temporalDimensions: ["jour"] };
    const rows = [{ jour: "2026-01-15", revenue: "12" }];
    const style: Style = { chart: "line", legend: "auto", numberFormat: "auto", threshold: undefined, tooltip: "value" };
    const option = (theme: typeof first) => drawChart(rows, shape, { ...style, dateFormat: theme.formats.date }, chartThemeOf(theme, TOKEN_CATALOG), {}).option as { xAxis: { data: unknown }; series: { data: unknown }[] };
    const requests = [first, second].map((theme) => { option(theme); return compose(); });
    expect(requests[0]).toEqual(requests[1]);
    expect(option(first).xAxis.data).toEqual(option(second).xAxis.data);
    expect(option(first).series.map((entry) => entry.data)).toEqual(option(second).series.map((entry) => entry.data));
  });
  it("compose la même requête pour un composant résolu, avec ou sans filtre", () => {
    const node = { id: "tile", type: "component" as const, component: { component_id: "shared", revision: 1 } };
    const resolved = { revision: 1, document: { id: "shared", kind: "visual", analysis: component.reference, presentation: component.presentation } as ComponentDocument };
    for (const filters of [[], [filter]]) {
      expect(JSON.stringify(composeExecution(node, revision, filters, {}, tile, "DEV", resolved))).toBe(JSON.stringify(compose(component, revision, filters)));
    }
    expect(composeExecution(node, revision, [], {}, tile, "DEV")).toMatchObject({ reason: "component_unavailable" });
    expect(composeExecution(node, revision, [], {}, tile, "DEV", { ...resolved, revision: 2 })).toMatchObject({ reason: "component_unavailable" });
    expect(composeExecution(node, revision, [], {}, tile, "DEV", { ...resolved, document: { ...resolved.document, id: "other" } })).toMatchObject({ reason: "component_unavailable" });
    expect(composeExecution(node, { ...revision, revision: 3 }, [], {}, tile, "DEV", resolved)).toMatchObject({ reason: "reference_mismatch" });
  });
  it("ajoute les filtres ciblés sans retirer ceux de l'analyse et indique le recouvrement", () => {
    const result = compose();
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw Error("attendu");
    expect(result.input.filters).toEqual([{ column: "country", operator: "eq", value: "FR" }, { column: "country", operator: "eq", value: "DE" }]);
    expect(result.input.analysis).toEqual({ id: "analysis", revision: 2 });
    expect(result.overlaps).toEqual(["country"]);
    const distinct = compose(component, revision, [{ ...filter, dimension: "region" }]);
    expect(distinct.status === "ready" && distinct.overlaps).toEqual([]);
    expect(result.input.environment).toBe("DEV");
    const another = compose({ ...component, presentation: { title: "Autre", chart: "line" } });
    expect(JSON.stringify(another)).toBe(JSON.stringify(result));
  });
  it("prend la valeur de travail, ignore les filtres non ciblés ou sans valeur et accepte un KPI", () => {
    const kpi: ExecutableComponent = { ...component, type: "kpi", presentation: {} };
    const result = compose(kpi, revision, [filter, { ...filter, id: "absent", default: undefined, targets: ["other"] } as unknown as CommonFilter, { ...filter, id: "vide", default: undefined } as unknown as CommonFilter], { filter: "ES" });
    expect(result.status === "ready" && result.input.filters[1]?.value).toBe("ES");
    expect(result.status === "ready" && result.input.filters).toHaveLength(2);
  });
  it.each(["analysis_unavailable", "unresolved_reference", "filter_incompatible"] as const)("reprend le refus serveur %s", (reason) => {
    expect(compose(component, revision, [], {}, { id: "tile", state: "unavailable", reason })).toEqual({ status: "unavailable", reason });
  });
  it("refuse les états et identités incohérents", () => {
    expect(compose(component, revision, [], {}, { id: "wrong", state: "ready" })).toMatchObject({ reason: "tile_mismatch" });
    expect(compose(component, revision, [], {}, { id: "tile", state: "unverified" })).toMatchObject({ reason: "unverified" });
    expect(compose(component, { ...revision, revision: 3 })).toMatchObject({ reason: "reference_mismatch" });
    expect(compose(component, { ...revision, id: "other" })).toMatchObject({ reason: "reference_mismatch" });
    for (const state of ["unverified", "unresolved_reference"] as const) expect(compose(component, { ...revision, state })).toMatchObject({ reason: state });
    expect(compose(component, { ...revision, state: "index_stale" }).status).toBe("ready");
  });
  it("refuse les bornes inversées et les valeurs hors allowed", () => {
    const range = { ...filter, operator: "between" as const, default: [1, 2] };
    expect(compose(component, revision, [range], { filter: [2, 1] })).toMatchObject({ reason: "invalid_filter_value" });
    expect(compose(component, revision, [{ ...filter, allowed: ["DE", "FR"] }], { filter: "ES" })).toMatchObject({ reason: "invalid_filter_value" });
  });
  it("efface explicitement un filtre avec null et garde le défaut avec undefined", () => {
    const cleared = compose(component, revision, [filter], { filter: null });
    const fallback = compose(component, revision, [filter], { filter: undefined });
    expect(cleared.status === "ready" && cleared.input.filters).toHaveLength(1);
    expect(fallback.status === "ready" && fallback.input.filters).toHaveLength(2);
  });
  it("refuse une valeur invalide et plus de 32 filtres sans soumission partielle", () => {
    expect(compose(component, revision, [filter], { filter: "<script>" })).toMatchObject({ status: "unavailable", reason: "invalid_filter_value" });

    const spy = vi.spyOn(analysisDocument, "decodeFilterValue").mockImplementation(() => { throw new Error("panne"); });
    expect(() => compose()).toThrow("panne");
    spy.mockRestore();
    const many = Array.from({ length: 32 }, (_, i) => ({ ...filter, id: String(i) }));
    expect(compose(component, revision, many)).toMatchObject({ status: "unavailable", reason: "too_many_filters" });
    expect(compose(component, revision, many.slice(0, 31)).status).toBe("ready");
  });
});
