import { describe, expect, it, vi } from "vitest";
import * as analysisDocument from "../../analyses/document";
import type { AnalysisRevision } from "../../analyses/model";
import type { CommonFilter, ExecutableComponent } from "../document";
import type { Tile } from "../model";
import { composeExecution } from "./execution";

const component: ExecutableComponent = { id: "tile", type: "analysis", reference: { analysis_id: "analysis", revision: 2 }, presentation: {} };
const revision = { id: "analysis", revision: 2, state: "ready", analysis: { query: { connection: "main", model: "sales", metrics: ["total"], dimensions: [], filters: [{ column: "country", operator: "eq", value: "FR" }] } } } as unknown as AnalysisRevision;
const filter: CommonFilter = { id: "filter", label: "Pays", dimension: "country", operator: "eq", default: "DE", targets: ["tile"] };
const tile: Tile = { id: "tile", state: "ready" };
const compose = (c: ExecutableComponent = component, r = revision, f: readonly CommonFilter[] = [filter], v: Readonly<Record<string, unknown>> = {}, t: Tile = tile) => composeExecution(c, r, f, v, t, "DEV");

describe("composition des tuiles", () => {
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
