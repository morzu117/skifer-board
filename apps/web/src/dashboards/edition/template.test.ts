import { describe, expect, it, vi } from "vitest";
import type { PageTemplate } from "../../page-templates/document";
import { applyCommand, createHistory, dispatch, undo } from "./commands";
import { dashboardProblems } from "./problems";
import { instantiateTemplate } from "./template";
import { findLayoutNode } from "./tree";
import { createDashboard } from "../client";
import { uuid } from "./testing";

const source: PageTemplate = { api_version: "board.page_template/v1", id: uuid(1), name: "Modèle", description: "Description", owner: { issuer: "issuer", subject: "subject" }, defaults: {}, filters: [{ id: uuid(2), label: "Pays", dimension: "country", operator: "eq", default: "FR" }], layout: { sections: [{ id: uuid(3), title: "Section", rows: [{ id: uuid(4), columns: [{ id: uuid(5), span: 6, children: [{ id: uuid(6), type: "slot", expected: "visual", label: "Visuel" }, { id: uuid(7), type: "text", blocks: [] }, { id: uuid(8), type: "separator" }] }, { id: uuid(9), span: 6, children: [{ id: uuid(10), type: "container", rows: [{ id: uuid(11), columns: [{ id: uuid(12), span: 12, children: [{ id: uuid(13), type: "slot", expected: "kpi", label: "KPI" }] }] }] }] }] }] }] } };
const make = () => { let n = 100; return instantiateTemplate({ pageTemplate: source, revision: 3 }, { name: "Créé", visibility: "personal", theme: { theme_id: uuid(14), revision: 1 } }, () => uuid(n++)); };

describe("instanciation et remplissage", () => {
  it("conserve structure, filtres et provenance avec de nouveaux identifiants", () => {
    const result = make();
    expect(result.template).toEqual({ template_id: source.id, revision: 3 });
    expect(result.theme).toEqual({ theme_id: uuid(14), revision: 1 });
    expect(result.filters).toMatchObject([{ label: "Pays", default: "FR", targets: [] }]);
    const sourceIds: string[] = [];
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) { value.forEach(collect); return; }
      if (typeof value !== "object" || value === null) return;
      const record = value as Record<string, unknown>;
      if (typeof record.id === "string") sourceIds.push(record.id);
      Object.values(record).forEach(collect);
    };
    collect(source.layout); collect(source.filters);
    for (const id of sourceIds) expect(JSON.stringify(result)).not.toContain(id);
    const strip = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(strip);
      if (typeof value !== "object" || value === null) return value;
      const record = value as Record<string, unknown>;
      if (record.type === "slot" && "slot" in record) return { type: "slot", ...(record.slot as object) };
      return Object.fromEntries(Object.entries(record).filter(([key]) => key !== "id").map(([key, item]) => [key, strip(item)]));
    };
    expect(strip(result.layout)).toEqual(strip(source.layout));
    let next = 500;
    const random = vi.spyOn(crypto, "randomUUID").mockImplementation(() => uuid(next++) as `${string}-${string}-${string}-${string}-${string}`);
    expect(() => instantiateTemplate({ pageTemplate: source, revision: 1 }, { name: "Nom", visibility: "personal" })).not.toThrow();
    random.mockRestore();
  });
  it("refuse un genre incompatible, remplit les deux genres et annule en une étape", () => {
    let history = createHistory(make());
    const slots = dashboardProblems(history.present, [], {}, null).filter((item) => item.code === "empty_slot");
    expect(slots).toHaveLength(2);
    const visual = slots[0]?.nodeId as string; const kpi = slots[1]?.nodeId as string;
    const bad = dispatch(history, { type: "fill_slot", id: visual, value: { source: "component", kind: "kpi", component: { component_id: uuid(20), revision: 1 } } });
    expect(bad.result).toMatchObject({ ok: false, reason: "incompatible_slot" });
    expect(bad.history).toBe(history);
    expect(applyCommand(history.present, { type: "fill_slot", id: uuid(100), value: { source: "analysis", kind: "visual", reference: { analysis_id: uuid(20), revision: 1 }, presentation: {} } })).toMatchObject({ ok: false });
    expect(applyCommand(history.present, { type: "fill_slot", id: history.present.layout.sections[0]?.id ?? "", value: { source: "analysis", kind: "visual", reference: { analysis_id: uuid(20), revision: 1 }, presentation: {} } })).toMatchObject({ reason: "invalid_property" });
    const changed = dispatch(history, { type: "fill_slot", id: visual, value: { source: "analysis", kind: "visual", reference: { analysis_id: uuid(20), revision: 1 }, presentation: {} } });
    expect(findLayoutNode(history.present, visual)).toMatchObject({ id: visual, type: "slot" });
    expect(changed.result.ok).toBe(true); expect(undo(changed.history).present).toEqual(history.present); history = changed.history;
    expect(findLayoutNode(history.present, visual)).toMatchObject({ id: visual, type: "analysis" });
    expect(applyCommand(history.present, { type: "fill_slot", id: kpi, value: { source: "analysis", kind: "kpi", reference: { analysis_id: uuid(20), revision: 1 }, presentation: {} } }).ok).toBe(true);
    const resolved = { revision: 1, document: { api_version: "board.component/v1" as const, id: uuid(21), name: "KPI", description: "", owner: { issuer: "i", subject: "s" }, kind: "kpi" as const, analysis: { analysis_id: uuid(20), revision: 1 }, presentation: {} } };
    expect(applyCommand(history.present, { type: "fill_slot", id: kpi, value: { source: "component", kind: "kpi", component: { component_id: uuid(21), revision: 1 } } })).toMatchObject({ reason: "component_unavailable" });
    expect(applyCommand(history.present, { type: "fill_slot", id: kpi, value: { source: "component", kind: "kpi", component: { component_id: uuid(21), revision: 1 }, resolved: { ...resolved, document: { ...resolved.document, kind: "visual" } } } })).toMatchObject({ reason: "incompatible_slot" });
    expect(applyCommand(history.present, { type: "fill_slot", id: kpi, value: { source: "component", kind: "kpi", component: { component_id: uuid(21), revision: 1 }, resolved: { ...resolved, revision: 2 } } })).toMatchObject({ reason: "component_unavailable" });
    expect(applyCommand(history.present, { type: "fill_slot", id: kpi, value: { source: "component", kind: "kpi", component: { component_id: uuid(21), revision: 1 }, resolved: { ...resolved, document: { ...resolved.document, id: uuid(99) } } } })).toMatchObject({ reason: "component_unavailable" });
    expect(findLayoutNode(history.present, kpi)).toMatchObject({ id: kpi, type: "slot" });
    history = dispatch(history, { type: "fill_slot", id: kpi, value: { source: "component", kind: "kpi", component: { component_id: uuid(21), revision: 1 }, resolved } }).history;
    expect(findLayoutNode(history.present, kpi)).toMatchObject({ id: kpi, type: "component" });
    expect(dashboardProblems(history.present, [], {}, null).filter((item) => item.code === "empty_slot")).toEqual([]);
  });
  it("refuse localement un filtre de modèle sans cible", async () => {
    const fetcher = vi.fn();
    expect(await createDashboard("finance", make(), fetcher)).toMatchObject({ status: "error" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
