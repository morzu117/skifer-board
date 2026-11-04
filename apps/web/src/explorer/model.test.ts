import { describe, expect, it } from "vitest";
import fields from "../../../../contracts/executions/champs.json";
import selection from "../../../../contracts/executions/contextuel-selection.json";
import subtotals from "../../../../contracts/executions/contextuel-sous-totaux.json";
import share from "../../../../contracts/executions/contextuel-part.json";
import truncated from "../../../../contracts/executions/contextuel-tronque.json";
import unavailable from "../../../../contracts/executions/contextuel-indisponible.json";
import selectionVide from "../../../../contracts/executions/contextuel-selection-vide.json";
import contratAbsent from "../../../../contracts/executions/contextuel-contrat-absent.json";
import illisible from "../../../../contracts/executions/contextuel-resultat-illisible.json";
import partIndefinie from "../../../../contracts/executions/contextuel-part-indefinie.json";
import { decodeContextual, decodeContextualBody, decodeFields } from "./model";

const body = { operation: "aggregate", metric: "revenue", group_by: [], selection: null, scope: null, denominator: null };
const model = fields.body.models[0] as (typeof fields.body.models)[number];
const derive = selection.body;
const missing = unavailable.body;

describe("contrats de l'explorateur", () => {
  it("décode les exemples du serveur sans changer l'ordre ou les nombres exacts", () => {
    expect(decodeFields(fields.body)).toEqual(fields.body);
    expect(decodeFields({ models: [{ ...model, dimensions: [{ ...model.dimensions[0], type: "timestamp", is_time: true }] }] }).models[0]?.dimensions[0]?.type).toBe("timestamp");
    expect(decodeContextual({ ...derive, rows: [{ valeur: 1e100 }] })).toMatchObject({ status: "derived" });
    for (const example of [selection, subtotals, share, truncated, unavailable, selectionVide, contratAbsent, illisible, partIndefinie]) expect(decodeContextual(example.body)).toEqual(example.body);
    expect(decodeContextual({ ...derive, rows: [{ revenue: { type: "integer", value: "9007199254740993" }, montant: { type: "decimal", value: "0.0000001" } }] })).toMatchObject({ rows: [{ revenue: { value: "9007199254740993" }, montant: { value: "0.0000001" } }] });
    expect(decodeContextual({ ...missing, engine_request: { ...missing.engine_request, selection: { montant: [{ type: "decimal", value: "1.23" }] } } })).toMatchObject({ status: "unavailable" });
  });
  it.each([
    "contract_unavailable", "result_unreadable", "grain_not_unique", "empty_selection",
    "unknown_aggregation", "numeric_overflow", "unsupported_value", "count_distinct_not_summable",
    "non_additive", "non_additive_dimension", "components_missing", "incomplete_result", "share_undefined",
  ])("accepte la raison fermée %s", (reason) => {
    expect(decodeContextual({ ...missing, reason })).toMatchObject({ status: "unavailable", reason });
  });
  it("accepte la règle de moyenne pondérée", () => {
    expect(decodeContextual({ ...derive, rule: "weighted_average" })).toMatchObject({ rule: "weighted_average" });
  });
  it.each(["1E-7", "1e5", "+1", ".5", "1."])("refuse le décimal non positionnel %s", (value) => {
    expect(() => decodeContextual({ ...derive, rows: [{ valeur: { type: "decimal", value } }] })).toThrow();
  });
  it.each([
    null, {}, { ...fields.body, secret: true }, { models: [] }, { models: Array(101).fill(model) }, { models: [model, model] },
    { models: [{ ...model, name: "x.y" }] }, { models: [{ ...model, label: "a".repeat(1025) }] },
    { models: [{ ...model, label: "\ud800" }] }, { models: [{ ...model, metrics: Array.from({ length: 501 }, () => model.metrics[0]) }] },
    { models: [{ ...model, metrics: [model.metrics[0], model.metrics[0]] }] }, { models: [{ ...model, dimensions: [model.dimensions[0], model.dimensions[0]] }] },
    { models: [{ ...model, metrics: [{ ...model.metrics[0], sql: "secret" }] }] },
    { models: [{ ...model, metrics: [{ ...model.metrics[0], aggregation: "ratio" }] }] },
    { models: [{ ...model, metrics: [{ ...model.metrics[0], aggregation: "avg", additivity: "additive" }] }] },
    { models: [{ ...model, dimensions: [{ ...model.dimensions[0], type: "other" }] }] },
    { models: [{ ...model, dimensions: [{ ...model.dimensions[0], is_time: false }] }] },
  ])("refuse un catalogue hors contrat %#", (value) => { expect(() => decodeFields(value)).toThrow(); });
  it.each([
    null, {}, { ...derive, extra: true }, { ...derive, status: "autre" }, { ...derive, rows: [null] },
    { ...derive, rows: [{}] }, { ...derive, rows: [{ "bad.name": 1 }] }, { ...derive, rows: Array(1001).fill({ valeur: 1 }) },
    { ...derive, rows: [{ x: Infinity }] }, { ...derive, rows: [{ x: { type: "integer", value: "1e9" } }] },
    { ...derive, rows: [{ x: { type: "decimal", value: "NaN" } }] }, { ...derive, rows: [{ x: { type: "decimal", value: "1", extra: 1 } }] },
    { ...derive, row_count: -1 }, { ...derive, row_count: 1001 }, { ...derive, row_count: 1.2 },
    { ...derive, scope: "autre" }, { ...derive, rule: "autre" }, { ...derive, notes: ["autre"] },
    { ...derive, source_evidence_id: "" }, { ...derive, partial: true }, { ...derive, denominator: "selection" },
    { ...missing, reason: "autre" }, { ...missing, engine_request: { ...missing.engine_request, extra: 1 } },
    { ...missing, engine_request: { ...missing.engine_request, selection: [] } },
    { ...missing, engine_request: { ...missing.engine_request, selection: {} } },
    { ...missing, engine_request: { ...missing.engine_request, selection: { x: [] } } },
    { ...missing, engine_request: { ...missing.engine_request, selection: { x: [null] } } },
  ])("refuse un résultat hors contrat %#", (value) => { expect(() => decodeContextual(value)).toThrow(); });
  it("valide les corps des deux opérations", () => {
    expect(decodeContextualBody(body)).toEqual(body);
    expect(decodeContextualBody({ ...body, operation: "share", group_by: ["region"], selection: { region: ["Nord", "Sud"] }, denominator: "selection" })).toMatchObject({ operation: "share" });
    expect(decodeContextualBody({ ...body, scope: "filtered_perimeter" })).toMatchObject({ scope: "filtered_perimeter" });
  });
  it.each([
    null, {}, { ...body, extra: 1 }, { ...body, operation: "delete" }, { ...body, metric: "!" },
    { ...body, group_by: ["a", "a"] }, { ...body, group_by: Array(33).fill("a") },
    { ...body, selection: [] }, { ...body, selection: {} }, { ...body, selection: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`x${i}`, [1]])) },
    { ...body, selection: { x: [] } }, { ...body, selection: { x: Array(101).fill(1) } },
    { ...body, selection: { x: [null] } }, { ...body, selection: { x: [Infinity] } }, { ...body, selection: { x: ["a".repeat(1025)] } },
    { ...body, selection: { x: ["\0"] } }, { ...body, scope: "selection" },
    { ...body, selection: { x: [1] }, scope: "filtered_perimeter" }, { ...body, denominator: "loaded_result" },
    { ...body, operation: "share" }, { ...body, operation: "share", scope: "filtered_perimeter", denominator: "loaded_result" },
    { ...body, operation: "share", denominator: "selection" }, { ...body, operation: "share", metric: "share", denominator: "loaded_result" },
    { ...body, operation: "share", group_by: ["share"], denominator: "loaded_result" },
  ])("refuse un corps invalide %#", (value) => { expect(() => decodeContextualBody(value)).toThrow(); });
});
