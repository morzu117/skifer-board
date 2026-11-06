import { describe, expect, it } from "vitest";
import fields from "../../../../contracts/executions/champs.json";
import { decodeFields } from "./model";
import { buildExecution, compareValues, OPERATORS, TEMPORAL_FILTER_REASON } from "./filters";
import type { ExecutionInput } from "../executions/client";

const original = decodeFields(fields.body).models[0] as ReturnType<typeof decodeFields>["models"][number];
const model = { ...original, dimensions: [
  ...original.dimensions, ...(["string", "number", "boolean", "unknown", "timestamp"] as const).map((type) => ({ name: type, type, label: type, description: "", is_time: type === "timestamp" })),
] };
const body: ExecutionInput = { connection: "source", environment: "DEV", model: "orders", metrics: ["revenue"], dimensions: [], filters: [] };
const withFilter = (column: string, operator: ExecutionInput["filters"][number]["operator"], value: ExecutionInput["filters"][number]["value"]): ExecutionInput => ({ ...body, filters: [{ column, operator, value }] });

describe("filtres typés", () => {
  it("décrit les opérateurs et la raison temporelle", () => {
    expect(OPERATORS).toEqual({ string: ["eq", "ne", "in"], number: ["eq", "ne", "gt", "gte", "lt", "lte", "in", "between"], boolean: ["eq", "ne"], unknown: ["eq", "ne"], date: [], timestamp: [] });
    expect(TEMPORAL_FILTER_REASON).toBe("SK-12");
  });
  it.each(["école 東京", "٣", "１２", "_ . , : / @ & + ( )", "", " espaces "])("accepte le texte autorisé %s", (value) => {
    expect(buildExecution(withFilter("string", "eq", value), model).filters[0]?.value).toBe(value);
  });
  it.each(["a-b", "a\\b", "a'b", 'a"b', "a;b", "a%b", "a*b", "a$b", "😀", "e\u0301", "a\nb", "a\tb", "a\u00a0b", "a\u200bb", "x".repeat(1025)])("refuse le texte interdit %s", (value) => {
    expect(() => buildExecution(withFilter("string", "eq", value), model)).toThrow();
  });
  it("construit les listes et les plages sans changer la demande initiale", () => {
    const request = withFilter("number", "in", [3, 1, 2]);
    expect(buildExecution(request, model).filters[0]?.value).toEqual([1, 2, 3]);
    expect(request.filters[0]?.value).toEqual([3, 1, 2]);
    expect(buildExecution(withFilter("number", "between", [1, 2]), model).filters[0]?.value).toEqual([1, 2]);
    expect(buildExecution(withFilter("boolean", "ne", false), model).filters).toHaveLength(1);
    expect(buildExecution(withFilter("unknown", "eq", "a"), model).filters).toHaveLength(1);
    expect(buildExecution(withFilter("number", "gt", 1.2), model).filters).toHaveLength(1);
  });
  it.each([
    withFilter("jour", "eq", "2026-01-01"), withFilter("timestamp", "eq", "x"), withFilter("absente", "eq", "x"),
    withFilter("string", "gt", "x"), withFilter("number", "eq", true), withFilter("boolean", "eq", 1), withFilter("string", "eq", 1),
    withFilter("number", "eq", Infinity), withFilter("number", "eq", Number.MAX_SAFE_INTEGER + 1),
    withFilter("number", "in", []), withFilter("number", "in", Array.from({ length: 101 }, (_, i) => i)),
    withFilter("number", "in", [1, 1]), withFilter("number", "in", [1, 1.5]), withFilter("number", "in", 1), withFilter("number", "between", [2, 1]),
    withFilter("number", "between", [1]), withFilter("number", "eq", [1]),
    { ...body, connection: "BAD" }, { ...body, environment: "BAD" }, { ...body, model: "other" },
    { ...body, metrics: [] }, { ...body, metrics: ["revenue", "revenue"] }, { ...body, metrics: ["inconnue"] },
    { ...body, dimensions: ["inconnue"] }, { ...body, filters: Array(33).fill({ column: "string", operator: "eq", value: "a" }) },
  ])("refuse une demande incohérente %#", (request) => { expect(() => buildExecution(request as ExecutionInput, model)).toThrow(); });
});

it("applique toute la matrice opérateurs et types", () => {
  const operators = ["eq", "ne", "gt", "gte", "lt", "lte", "in", "between"] as const;
  for (const dimension of model.dimensions) {
    for (const operator of operators) {
      const scalar = dimension.type === "number" ? 1 : dimension.type === "boolean" ? true : "valeur";
      const value = operator === "between" ? [1, 2] : operator === "in" ? [scalar] : scalar;
      const request = withFilter(dimension.name, operator, value);
      if (OPERATORS[dimension.type].includes(operator)) expect(buildExecution(request, model).filters).toHaveLength(1);
      else expect(() => buildExecution(request, model)).toThrow();
    }
  }
});

describe("ordre des valeurs de `in`", () => {
  // Ordre de `sorted()` de Python (`query_validation.py`) : les textes par point de code, les nombres par valeur.
  const parPointDeCode = (valeurs: readonly string[]) => [...valeurs].sort((a, b) => {
    const [x, y] = [Array.from(a, (c) => c.codePointAt(0) as number), Array.from(b, (c) => c.codePointAt(0) as number)];
    for (let i = 0; i < Math.min(x.length, y.length); i += 1) if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number);
    return x.length - y.length;
  });
  it("range un caractère hors du plan multilingue de base après un caractère de plein pied, comme Python", () => {
    // U+FF21 (Ａ) et U+10400 (𐐀) : par unités UTF-16 `𐐀` (D801 DC00) précède `Ａ` (FF21), par points de code il le suit.
    expect(["𐐀", "Ａ"].sort()).toEqual(["𐐀", "Ａ"]);
    for (const saisie of [["𐐀", "Ａ"], ["Ａ", "𐐀"]]) {
      expect(buildExecution(withFilter("string", "in", saisie), model).filters[0]?.value).toEqual(["Ａ", "𐐀"]);
    }
  });
  it("trie les textes par point de code, un préfixe avant ses prolongements, comme Python", () => {
    const saisie = ["b", "𐐀a", "ab", "Ａ", "a", "Z", "école", "𐐀", "٣"];
    expect(buildExecution(withFilter("string", "in", saisie), model).filters[0]?.value).toEqual(parPointDeCode(saisie));
    expect(parPointDeCode(saisie)).toEqual(["Z", "a", "ab", "b", "école", "٣", "Ａ", "𐐀", "𐐀a"]);
  });
  it("trie les nombres par valeur, entiers ou décimaux, sans passer par le texte", () => {
    expect(buildExecution(withFilter("number", "in", [10, 9, 100, -1]), model).filters[0]?.value).toEqual([-1, 9, 10, 100]);
    expect(buildExecution(withFilter("number", "in", [1.5, 0.25, 10.5]), model).filters[0]?.value).toEqual([0.25, 1.5, 10.5]);
  });
  it("compare deux valeurs : texte par point de code, autre type par valeur", () => {
    expect(compareValues("Ａ", "𐐀")).toBe(-1);
    expect(compareValues("𐐀", "Ａ")).toBe(1);
    expect(compareValues("a", "ab")).toBeLessThan(0);
    expect(compareValues("ab", "a")).toBeGreaterThan(0);
    expect(compareValues(1, 2)).toBe(-1);
    expect(compareValues(2, 1)).toBe(1);
    expect(compareValues(false, true)).toBe(-1);
  });
});
