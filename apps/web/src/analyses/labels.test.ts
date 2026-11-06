import { expect, it } from "vitest";
import { CHART_KINDS, DENOMINATORS, FILTER_OPERATORS, OPERATIONS, SCOPES, VISIBILITIES } from "./document";
import { ACTION_LABELS, CHANGE_LABELS, chartLabel, DENOMINATOR_LABELS, LIST_STATE_LABELS, OPERATION_LABELS, OPERATOR_LABELS, READ_STATE_LABELS, RULE_LABELS, SCOPE_LABELS, stepText, USAGE_LABELS, valueAt, VIOLATION_LABELS, VISIBILITY_LABELS } from "./labels";
import { LIST_STATES, READ_STATES, USAGE_KINDS } from "./model";
import { REFERENCE_RULES, VIOLATION_RULES } from "./refusal";

it("chaque valeur fermée du contrat a un libellé, et chaque état a sa raison", () => {
  expect(Object.keys(READ_STATE_LABELS).sort()).toEqual([...READ_STATES].sort());
  expect(Object.keys(LIST_STATE_LABELS).sort()).toEqual([...LIST_STATES].sort());
  expect(Object.keys(RULE_LABELS).sort()).toEqual([...REFERENCE_RULES].sort());
  expect(Object.keys(VISIBILITY_LABELS).sort()).toEqual([...VISIBILITIES].sort());
  expect(Object.keys(OPERATOR_LABELS).sort()).toEqual([...FILTER_OPERATORS].sort());
  expect(Object.keys(OPERATION_LABELS).sort()).toEqual([...OPERATIONS].sort());
  expect(Object.keys(SCOPE_LABELS).sort()).toEqual([...SCOPES].sort());
  expect(Object.keys(DENOMINATOR_LABELS).sort()).toEqual([...DENOMINATORS].sort());
  expect(Object.keys(USAGE_LABELS).sort()).toEqual([...USAGE_KINDS].sort());
  expect(Object.keys(CHANGE_LABELS).sort()).toEqual(["added", "modified", "removed"]);
  expect(Object.keys(ACTION_LABELS).sort()).toEqual(["delete", "save"]);
  for (const label of [...Object.values(READ_STATE_LABELS), ...Object.values(LIST_STATE_LABELS)]) expect(label.reason.length).toBeGreaterThan(20);
});

it("les libellés d'état ne se confondent pas", () => {
  const labels = Object.values(READ_STATE_LABELS).map((state) => state.label);
  expect(new Set(labels).size).toBe(labels.length);
  expect(READ_STATE_LABELS.unresolved_reference.tone).toBe("danger");
  expect(READ_STATE_LABELS.ready.tone).toBe("success");
});

it("chaque type de graphique du schéma a un libellé distinct, refus hors du schéma", () => {
  expect(CHART_KINDS.map(chartLabel)).toEqual(["Valeur", "Barres", "Ligne", "Barres groupées"]);
  expect(() => chartLabel("pie" as never)).toThrow();
});

it("valueAt suit un pointeur JSON et rend null quand le chemin ne mène nulle part", () => {
  const document = { query: { metrics: ["revenue"], nested: { a: 1 }, empty: null, text: "x" } };
  expect(valueAt(document, "/query/metrics/0")).toBe("revenue");
  expect(valueAt(document, "/query/nested")).toEqual({ a: 1 });
  expect(valueAt(document, "")).toBe(document);
  expect(valueAt(document, "/query/metrics/3")).toBeNull();
  expect(valueAt(document, "/query/absent")).toBeNull();
  expect(valueAt(document, "/query/empty/x")).toBeNull();
  expect(valueAt(document, "/query/text/length")).toBeNull();
  expect(valueAt(document, "/query/__proto__")).toBeNull();
  expect(valueAt(document, "/query/toString")).toBeNull();
});

it("chaque règle de violation du serveur a un libellé", () => {
  expect(Object.keys(VIOLATION_LABELS).sort()).toEqual([...VIOLATION_RULES].sort());
});

it("dit chaque calcul contextuel avec son regroupement et son périmètre ou dénominateur", () => {
  expect(stepText({ operation: "aggregate", metric: "revenue", group_by: [], scope: null })).toBe("Agrégat de revenue par sans regroupement · périmètre : sélection courante");
  expect(stepText({ operation: "aggregate", metric: "revenue", group_by: ["region", "channel"], scope: "filtered_perimeter" })).toBe("Agrégat de revenue par region, channel · périmètre : périmètre filtré");
  expect(stepText({ operation: "share", metric: "orders", group_by: ["region"], denominator: "loaded_result" })).toBe("Part de orders par region · dénominateur : résultat chargé");
});
