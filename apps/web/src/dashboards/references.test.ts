import { describe, expect, it } from "vitest";
import { decodeOwn } from "./document";
import { decodeDashboardRevision } from "./model";
import { dashboardRefusalDetails } from "./refusal";
import { ID, route } from "./testing";
import { decodeComponent } from "../components-lib/document";
import { decodeTheme } from "../themes/document";

const example = () => route("lire-references-resolues").body as Record<string, unknown>;
const resolved = () => example().resolved as { theme: Record<string, unknown>; components: Record<string, Record<string, unknown>> };

describe("références résolues", () => {
  it("décode l'exemple de lecture et les documents embarqués", () => {
    const read = decodeDashboardRevision(example(), "finance");
    const source = resolved();
    expect(read.resolved?.theme).toEqual(source.theme);
    expect(read.resolved?.components).toEqual(source.components);
    expect(read.dashboard.theme?.revision).toBe(1);
    expect(read.tiles).toHaveLength(1);
    expect(read.resolved?.theme).toMatchObject({ api_version: "board.theme/v1", base: "skifer-clair", density: "normal", formats: { number: "auto", date: "short" }, categorical: ["blue", "copper"], sequential: ["ink", "blue", "seriesMuted"], diverging: ["blue", "neutral.fg", "copper"] });
    expect(Object.values(read.resolved?.components ?? {})[0]).toMatchObject({ api_version: "board.component/v1", kind: "visual", presentation: { chart: "bars", legend: "auto" }, analysis: { revision: 1 } });
  });
  it("refuse les documents, couleurs et champs hors contrat", () => {
    const theme = resolved().theme;
    expect(() => decodeTheme({ ...theme, api_version: "other" })).toThrow();
    expect(decodeTheme({ ...theme, chart_defaults: { bars: {} } }).chart_defaults).toEqual({ bars: {} });
    expect(() => decodeTheme({ ...theme, diverging: ["blue", "neutral.fg", "copper", "blue"] })).toThrow();
    for (const invalid of [{ ...theme, extra: true }, { ...theme, base: "x" }, { ...theme, name: "#ff00ff" }, { ...theme, categorical: ["blue", "#ffffff"] }, { ...theme, diverging: ["blue", "copper", "ink"] }, { ...theme, density: "x" }, { ...theme, chart_defaults: { bars: { legend: "x" } } }, { ...theme, chart_defaults: { bars: { extra: 1 } } }, { ...theme, chart_defaults: { pie: {} } }]) expect(() => decodeTheme(invalid)).toThrow();
    const component = Object.values(resolved().components)[0] as Record<string, unknown>;
    for (const invalid of [{ ...component, extra: true }, { ...component, kind: "unknown" }, { ...component, presentation: { color: "#000000" } }, { ...component, api_version: "other" }]) expect(() => decodeComponent(invalid)).toThrow();
    expect(decodeComponent({ ...component, kind: "kpi", presentation: {} }).kind).toBe("kpi");
  });
  it("accepte une résolution partielle et décode le diff du nœud", () => {
    const body = example();
    body.resolved = { components: {} };
    (body.dashboard as Record<string, unknown>).template = { template_id: ID, revision: 1 };
    const read = decodeDashboardRevision(body, "finance");
    expect(read.resolved).toEqual({ components: {} });
    expect(read.dashboard.template).toEqual({ template_id: ID, revision: 1 });
    expect(decodeOwn("component", { type: "component", component: { component_id: ID, revision: 1 } }, "noeud", true)).toEqual({ type: "component", component: { component_id: ID, revision: 1 } });
  });
  it("refuse les détails incomplets ou incohérents", () => {
    expect(dashboardRefusalDetails("unapproved_reference", { code: "unapproved_reference", paths: ["/theme"] })).toEqual({ paths: ["/theme"] });
    expect(dashboardRefusalDetails("unapproved_reference", { code: "unapproved_reference", paths: ["invalid"] })).toBeNull();
    expect(dashboardRefusalDetails("content_in_use", { code: "content_in_use", consumers: [], others: 0 })).toBeNull();
    expect(dashboardRefusalDetails("content_in_use", { code: "content_in_use", consumers: [{ kind: "dashboard", id: ID }], others: 0 })).toMatchObject({ others: 0 });
  });
});
