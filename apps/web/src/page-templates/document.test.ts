import { describe, expect, it } from "vitest";
import { decodePageTemplate } from "./document";

const valid = import.meta.glob<unknown>("../../../../contracts/page_templates/fixtures/valid/*.json", { eager: true, import: "default" });
const invalid = import.meta.glob<unknown>("../../../../contracts/page_templates/fixtures/invalid/*.json", { eager: true, import: "default" });
const sample = () => structuredClone(valid["../../../../contracts/page_templates/fixtures/valid/base.json"]) as Record<string, unknown>;
describe("document de modèle de page", () => {
  it("lit toutes les fixtures valides et refuse toutes les invalides", () => {
    expect(Object.keys(valid)).toHaveLength(2);
    expect(Object.keys(invalid)).toHaveLength(7);
    for (const [path, value] of Object.entries(valid)) expect(() => decodePageTemplate(value), path).not.toThrow();
    for (const [path, value] of Object.entries(invalid)) expect(() => decodePageTemplate(value), path).toThrow();
  });
  it("refuse les identifiants répétés et les champs hors contrat", () => {
    const value = sample();
    const filters = value.filters as Record<string, unknown>[];
    expect(() => decodePageTemplate({ ...value, filters: [filters[0], filters[0]] })).toThrow();
    expect(() => decodePageTemplate({ ...value, filters: [{ ...filters[0], id: (value.layout as { sections: { id: string }[] }).sections[0]?.id }] })).toThrow();
    expect(() => decodePageTemplate({ ...value, api_version: "board.dashboard/v1" })).toThrow();
    expect(() => decodePageTemplate({ ...value, sql: "SELECT 1" })).toThrow();
    let deep: unknown = {};
    for (let index = 0; index < 50; index += 1) deep = { nested: deep };
    expect(() => decodePageTemplate({ ...value, layout: { sections: [], extra: deep } })).toThrow("profondeur bornée");
    expect(() => decodePageTemplate({ ...value, filters: [{ ...filters[0], extra: true }] })).toThrow();
    expect(() => decodePageTemplate({ ...value, filters: [{}] })).toThrow();
  });
  it("compte les slots à la borne de composants", () => {
    const value = sample();
    const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
    const make = (amount: number) => ({ ...value, filters: [], layout: { sections: [{ id: id(1), rows: Array.from({ length: 5 }, (_, r) => ({ id: id(10 + r), columns: [{ id: id(20 + r), span: 12, children: Array.from({ length: Math.min(16, Math.max(0, amount - r * 16)) }, (_, n) => ({ id: id(100 + r * 16 + n), type: "slot", expected: "visual", label: "Vue" })) }] })) }] } });
    expect(decodePageTemplate(make(64)).layout.sections).toHaveLength(1);
    expect(() => decodePageTemplate(make(65))).toThrow();
  });
  it("accepte les bornes et valide les valeurs de filtre", () => {
    const value = sample();
    const one = (value.filters as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(decodePageTemplate({ ...value, filters: [{ ...one, operator: "between", default: [1, 2], allowed: [1, 2] }] }).filters[0]?.default).toEqual([1, 2]);
    expect(() => decodePageTemplate({ ...value, filters: [{ ...one, operator: "between", default: [2, 1] }] })).toThrow();
    expect(() => decodePageTemplate({ ...value, filters: [{ ...one, allowed: ["est"] }] })).toThrow();
    expect(decodePageTemplate({ ...value, filters: [] }).filters).toEqual([]);
    const withoutDefault = Object.fromEntries(Object.entries(one).filter(([key]) => key !== "default"));
    expect(decodePageTemplate({ ...value, filters: [withoutDefault] }).filters[0]).not.toHaveProperty("default");
  });
});

it("refuse un nœud composant dans un modèle", () => {
  const value = sample();
  const layout = value.layout as { sections: { rows: { columns: { children: unknown[] }[] }[] }[] };
  const firstSection = layout.sections[0] as { rows: { columns: { children: unknown[] }[] }[] };
  const firstRow = firstSection.rows[0] as { columns: { children: unknown[] }[] };
  const children = (firstRow.columns[0] as { children: unknown[] }).children;
  children[0] = { id: "00000000-0000-4000-8000-000000000099", type: "component", component: { component_id: "00000000-0000-4000-8000-000000000098", revision: 1 } };
  expect(() => decodePageTemplate(value)).toThrow();
});
