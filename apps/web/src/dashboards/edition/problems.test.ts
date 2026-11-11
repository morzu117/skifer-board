import { describe, expect, it } from "vitest";
import type { AnalysisRevision } from "../../analyses/model";
import type { ExplorerModel } from "../../explorer/model";
import type { DashboardDraft } from "../document";
import { compatibleCharts, dashboardProblems } from "./problems";

const analysis = { state: "ready", analysis: { presentation: { chart: "value" }, query: { connection: "main", model: "sales", metrics: ["total"], dimensions: [], filters: [] } } } as unknown as AnalysisRevision;
const model: ExplorerModel = { name: "sales", label: "Sales", description: "", metrics: [{ name: "total", label: "Total", description: "", aggregation: "sum", additivity: "additive" }], dimensions: [{ name: "country", label: "Pays", description: "", type: "string", is_time: false }] };
const doc: DashboardDraft = { name: "Test", description: "", visibility: "personal", defaults: {}, filters: [{ id: "f", label: "Pays", dimension: "country", operator: "eq", targets: ["k"], default: "FR" }], layout: { sections: [{ id: "s", rows: [{ id: "r", columns: [{ id: "c", span: 6, children: [{ id: "k", type: "kpi", reference: { analysis_id: "a", revision: 1 }, presentation: {} }] }] }] }] } };
const known = { k: { pinned: analysis, current: 1 } };
describe("problèmes du dashboard", () => {
  it("ne traite pas span 12 comme une borne atteinte", () => {
    const d: DashboardDraft = { ...doc, filters: [], layout: { sections: [{ id: "s", rows: [{ id: "r", columns: [{ id: "c", span: 12, children: [] }] }] }] } };
    expect(dashboardProblems(d, [], {}, null)).toEqual([]);
  });
  it("ne confond pas métrique disparue et filtre incompatible", () => {
    const missing = { ...analysis, state: "unresolved_reference" as const, analysis: { ...analysis.analysis, query: { ...analysis.analysis.query, metrics: ["disparue"] } } };
    const result = dashboardProblems(doc, [], { k: { pinned: missing, current: 1 } }, [model]);
    expect(result).toEqual([{ code: "unresolved_reference", severity: "warning", nodeId: "k", path: "/layout/sections/0/rows/0/columns/0/children/0/reference" }]);
  });
  it("juge value selon la frontière zéro dimension", () => {
    expect(compatibleCharts(0)).toEqual(["value", "bars", "line", "grouped_bars"]);
    expect(compatibleCharts(1)).toEqual(["bars", "line", "grouped_bars"]);
    const d: DashboardDraft = { ...doc, filters: [], layout: { sections: [{ id: "s", rows: [{ id: "r", columns: [{ id: "c", span: 6, children: [{ id: "v", type: "analysis", reference: { analysis_id: "a", revision: 1 }, presentation: { chart: "value" } }] }] }] }] } };
    const pinned = { ...analysis, analysis: { ...analysis.analysis, query: { ...analysis.analysis.query, dimensions: ["country"] } } };
    expect(dashboardProblems(d, [], { v: { pinned, current: 1 } }, null)).toContainEqual({ code: "chart_incompatible", severity: "blocking", nodeId: "v", path: "/layout/sections/0/rows/0/columns/0/children/0/presentation/chart" });
    expect(dashboardProblems(d, [], { v: { pinned: analysis, current: 1 } }, null)).toEqual([]);
  });
  it("ne signale rien quand tout est compatible", () => { expect(dashboardProblems(doc, [{ id: "k", state: "ready" }], known, [model])).toEqual([]); });
  it("signale les états serveur et les états d'analyse", () => {
    for (const reason of ["analysis_unavailable", "unresolved_reference", "filter_incompatible"] as const) expect(dashboardProblems(doc, [{ id: "k", state: "unavailable", reason }], {}, null)).toContainEqual(expect.objectContaining({ code: reason, severity: reason === "unresolved_reference" ? "warning" : "blocking", nodeId: "k" }));
    expect(dashboardProblems(doc, [{ id: "k", state: "unverified" }], { k: { pinned: { ...analysis, state: "unresolved_reference" }, current: null } }, null).map((p) => p.code)).toEqual(["unverified", "unresolved_reference"]);
    expect(dashboardProblems(doc, [], { k: { pinned: { ...analysis, state: "unverified" }, current: null } }, null)[0]?.code).toBe("unverified");
  });
  it("signale les cibles absentes, les incompatibilités et l'écart de révision", () => {
    const changed = { ...doc, filters: [{ ...(doc.filters[0] as DashboardDraft["filters"][number]), targets: [] }, { ...(doc.filters[0] as DashboardDraft["filters"][number]), id: "f2", dimension: "missing" }] };
    const result = dashboardProblems(changed, [], { k: { pinned: analysis, current: 3 } }, [model]);
    expect(result).toContainEqual(expect.objectContaining({ code: "filter_without_target", severity: "blocking", nodeId: "f" }));
    expect(result).toContainEqual(expect.objectContaining({ code: "filter_incompatible", path: "/filters/1/targets/0" }));
    expect(result).toContainEqual(expect.objectContaining({ code: "revision_behind", severity: "warning", pinned: 1, current: 3 }));
  });
  it("vérifie les valeurs, opérateurs, catalogue et compatibilité KPI", () => {
    expect(dashboardProblems(doc, [], known, []).some((p) => p.code === "filter_incompatible")).toBe(true);
    const bad = { ...doc, filters: [{ ...(doc.filters[0] as DashboardDraft["filters"][number]), default: 5 }] };
    expect(dashboardProblems(bad, [], known, [model]).some((p) => p.code === "filter_incompatible")).toBe(true);
    const operator = { ...doc, filters: [{ ...(doc.filters[0] as DashboardDraft["filters"][number]), operator: "between" as const, default: ["a", "b"] }] };
    expect(dashboardProblems(operator, [], known, [model]).some((p) => p.code === "filter_incompatible")).toBe(true);
    const incompatible = { ...analysis, analysis: { ...analysis.analysis, presentation: { chart: "bars" as const } } };
    expect(dashboardProblems(doc, [], { k: { pinned: incompatible, current: 1 } }, [model]).some((p) => p.code === "kpi_incompatible")).toBe(true);
    const dimensions = { ...analysis, analysis: { ...analysis.analysis, query: { ...analysis.analysis.query, dimensions: ["country"] } } };
    expect(dashboardProblems(doc, [], { k: { pinned: dimensions, current: 1 } }, [model]).some((p) => p.code === "kpi_incompatible")).toBe(true);
  });
  it("parcourt aussi les composants non exécutables et les visuels", () => {
    const other: DashboardDraft = { ...doc, layout: { sections: [{ id: "s", rows: [{ id: "r", columns: [{ id: "c", span: 1, children: [{ id: "t", type: "separator" }, { id: "v", type: "analysis", reference: { analysis_id: "a", revision: 1 }, presentation: {} }] }] }] }] } };
    expect(dashboardProblems(other, [], {}, null)).toEqual([]);
  });
  it("vérifie les valeurs autorisées et les filtres sans valeur", () => {
    const filter = doc.filters[0] as DashboardDraft["filters"][number];
    const allowed = { ...doc, filters: [{ ...filter, allowed: [5] }] };
    expect(dashboardProblems(allowed, [], known, [model]).some((p) => p.code === "filter_incompatible")).toBe(true);
    const empty = { ...doc, filters: [{ id: "f", label: "Pays", dimension: "country", operator: "eq" as const, targets: ["k"] }] };
    expect(dashboardProblems(empty, [], known, [model])).toEqual([]);
  });
  it("signale les bornes atteintes et parcourt les conteneurs", () => {
    const many = { ...doc, layout: { sections: Array.from({ length: 20 }, (_, i) => ({ id: String(i), rows: [] })) } };
    expect(dashboardProblems(many, [], {}, null)).toContainEqual(expect.objectContaining({ code: "limit_reached", path: "/layout/sections" }));
    const nested: DashboardDraft = { ...doc, layout: { sections: [{ id: "s", rows: [{ id: "r", columns: [{ id: "c", span: 12, children: [{ id: "box", type: "container", rows: [] }] }] }] }] } };
    expect(dashboardProblems(nested, [], {}, null)).not.toContainEqual(expect.objectContaining({ code: "limit_reached", nodeId: "c" }));
  });
});

describe("bornes et types entre cibles", () => {
  const section = (i: number) => ({ id: `s${String(i)}`, rows: [] });
  const separator = (i: number) => ({ id: `x${String(i)}`, type: "separator" as const });
  const visual = (i: number) => ({ id: `v${String(i)}`, type: "analysis" as const, reference: { analysis_id: "a", revision: 1 }, presentation: {} });
  const withChildren = (children: DashboardDraft["layout"]["sections"][number]["rows"][number]["columns"][number]["children"]): DashboardDraft => ({ ...doc, filters: [], layout: { sections: [{ id: "s", rows: [{ id: "r", columns: [{ id: "c", span: 1, children }] }] }] } });
  it.each([[20, "warning"], [21, "blocking"]] as const)("sections : %i", (n, severity) => {
    const value = { ...doc, filters: [], layout: { sections: Array.from({ length: n }, (_, i) => section(i)) } };
    expect(dashboardProblems(value, [], {}, null)).toContainEqual(expect.objectContaining({ code: "limit_reached", severity, nodeId: "dashboard", path: "/layout/sections" }));
  });
  it.each([[40, "warning"], [41, "blocking"]] as const)("exécutables : %i", (n, severity) => {
    expect(dashboardProblems(withChildren(Array.from({ length: n }, (_, i) => visual(i))), [], {}, null)).toContainEqual({ code: "limit_reached", severity, nodeId: "dashboard", path: "/layout", limit: "executable" });
  });
  it.each([[64, "warning"], [65, "blocking"]] as const)("composants : %i", (n, severity) => {
    expect(dashboardProblems(withChildren(Array.from({ length: n }, (_, i) => separator(i))), [], {}, null)).toContainEqual({ code: "limit_reached", severity, nodeId: "dashboard", path: "/layout", limit: "components" });
  });
  it.each([[600, "warning"], [601, "blocking"]] as const)("nœuds : %i", (n, severity) => {
    const d = withChildren(Array.from({ length: n - 3 }, (_, i) => separator(i)));
    expect(dashboardProblems(d, [], {}, null)).toContainEqual({ code: "limit_reached", severity, nodeId: "dashboard", path: "/layout", limit: "nodes" });
  });
  it.each([[32, "warning"], [33, "blocking"]] as const)("filtres : %i", (n, severity) => {
    const d = { ...doc, filters: Array.from({ length: n }, (_, i) => ({ id: String(i), label: "F", dimension: "country", operator: "eq" as const, targets: ["k"] })) };
    expect(dashboardProblems(d, [], {}, null)).toContainEqual(expect.objectContaining({ code: "limit_reached", severity, nodeId: "dashboard", path: "/filters" }));
  });
  it.each([[32, "warning"], [33, "blocking"]] as const)("filtres par tuile : %i", (n, severity) => {
    const query = { ...analysis.analysis.query, filters: Array.from({ length: n - 1 }, () => ({ column: "country", operator: "eq" as const, value: "FR" })) };
    const pinned = { ...analysis, analysis: { ...analysis.analysis, query } };
    expect(dashboardProblems(doc, [], { k: { pinned, current: 1 } }, null)).toContainEqual({ code: "limit_reached", severity, nodeId: "k", path: "/layout/sections/0/rows/0/columns/0/children/0", limit: "tile_filters" });
  });
  it("compare à la première cible compatible et ignore les cibles absentes ou incompatibles", () => {
    const v = withChildren([visual(0), visual(1), visual(2), visual(3)]);
    const filter = { id: "f", label: "F", dimension: "country", operator: "eq" as const, targets: ["absent", "v0", "v1", "v2", "v3"] };
    const rev = (name: string) => ({ ...analysis, analysis: { ...analysis.analysis, query: { ...analysis.analysis.query, model: name } } });
    const models = [model, { ...model, name: "number", dimensions: [{ ...model.dimensions[0] as ExplorerModel["dimensions"][number], type: "number" as const }] }, { ...model, name: "none", dimensions: [] }];
    const revisions = { v0: { pinned: rev("none"), current: 1 }, v1: { pinned: rev("sales"), current: 1 }, v2: { pinned: rev("number"), current: 1 }, v3: { pinned: rev("sales"), current: 1 } };
    const results = dashboardProblems({ ...v, filters: [filter] }, [], revisions, models).filter((p) => p.code === "filter_incompatible");
    expect(results).toEqual([{ code: "filter_incompatible", severity: "blocking", nodeId: "f", path: "/filters/0/targets/1" }, { code: "filter_incompatible", severity: "blocking", nodeId: "f", path: "/filters/0/targets/3" }]);
  });
});
