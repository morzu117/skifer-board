import { describe, expect, it } from "vitest";
import schema from "../../../../contracts/analyses/analysis.v1.json";
import { ContractError } from "../catalogue/decode";
import { loadYaml } from "../test/yaml";
import { API_VERSION, CHART_KINDS, DENOMINATORS, FILTER_OPERATORS, OPERATIONS, SCOPES, VISIBILITIES, decodeAnalysis, decodeAnalysisDraft } from "./document";
import { changed, draftOf, explained, expectation, fixtures, ID } from "./testing";

const minimal = loadYaml(fixtures("valid").find((item) => item.name === "minimal")?.text ?? "") as Record<string, unknown>;
const complete = loadYaml(fixtures("valid").find((item) => item.name === "complete-shared")?.text ?? "") as Record<string, unknown>;
const refused = (value: unknown): void => {
  expect(() => decodeAnalysis(value)).toThrow(ContractError);
};

describe("corpus de fixtures de contracts/analyses/", () => {
  it("accepte chaque fixture valide, sans rien perdre ni ajouter", () => {
    const valid = fixtures("valid");
    expect(valid.map((item) => item.name)).toEqual(["complete-shared", "minimal", "personal-line"]);
    for (const item of valid) {
      const loaded = loadYaml(item.text);
      expect(decodeAnalysis(loaded)).toEqual(loaded);
      expect(decodeAnalysisDraft(draftOf(loaded as object))).toEqual(draftOf(loaded as object));
    }
  });

  it("lit la fixture équivalente comme le minimum, quel que soit l'ordre ou le style des clés", () => {
    const [equivalent] = fixtures("equivalent");
    expect(equivalent?.name).toBe("minimal-reordered");
    expect(decodeAnalysis(loadYaml(equivalent?.text ?? ""))).toEqual(decodeAnalysis(minimal));
  });

  it("refuse chaque fixture invalide par une erreur de contrat", () => {
    const invalid = fixtures("invalid");
    expect(invalid.length).toBeGreaterThanOrEqual(40);
    for (const item of invalid) {
      // Chaque fixture invalide a son verdict du serveur ; le web refuse ce que le serveur refuse.
      expect(expectation(item.name)?.code, item.name).toBe("invalid_analysis");
      expect(() => decodeAnalysis(loadYaml(item.text)), item.name).toThrow(ContractError);
    }
  });

  it("refuse chaque fixture invalide pour la raison que le serveur donne, au même endroit", () => {
    for (const item of fixtures("invalid")) {
      let message = "";
      try {
        decodeAnalysis(loadYaml(item.text));
      } catch (error) {
        message = error instanceof ContractError ? error.message : String(error);
      }
      const violations = expectation(item.name)?.violations ?? [];
      expect(explained(message, violations), `${item.name} : « ${message} » pour ${JSON.stringify(violations)}`).toBeDefined();
    }
  });

  it("refuse aussi les fixtures invalides une fois privées des champs que le serveur pose", () => {
    // Le corps d'une création n'a ni api_version, ni id, ni owner : les mêmes défauts y sont refusés.
    const refusedAsDraft = fixtures("invalid").filter((item) => {
      const loaded = loadYaml(item.text);
      if (typeof loaded !== "object" || loaded === null || Array.isArray(loaded)) return true;
      try {
        decodeAnalysisDraft(draftOf(loaded));
        return false;
      } catch {
        return true;
      }
    });
    // Seuls les défauts de ces trois champs passent : identifiant, version, propriétaire.
    const accepted = fixtures("invalid").map((item) => item.name).filter((name) => !refusedAsDraft.some((item) => item.name === name));
    expect(accepted).toEqual(["bad-api-version", "bad-id", "bad-id-uppercase", "owner-email", "owner-missing-subject"]);
  });

  it("garde les règles du schéma : mêmes énumérations, mêmes champs, mêmes bornes", () => {
    const defs = schema.$defs;
    expect(schema.properties.api_version.const).toBe(API_VERSION);
    expect(schema.properties.visibility.enum).toEqual([...VISIBILITIES]);
    expect(defs.filter.properties.operator.enum).toEqual([...FILTER_OPERATORS]);
    expect(defs.contextual_operation.properties.operation.enum).toEqual([...OPERATIONS]);
    expect(defs.contextual_operation.properties.scope.enum).toEqual([null, ...SCOPES]);
    expect(defs.contextual_operation.properties.denominator.enum).toEqual([...DENOMINATORS]);
    expect(defs.presentation.properties.chart.enum).toEqual([...CHART_KINDS]);
    expect(Object.keys(schema.properties).sort()).toEqual(Object.keys(complete).sort());
    expect(schema.additionalProperties).toBe(false);
    for (const part of [defs.query, defs.filter, defs.person, defs.presentation, defs.contextual_operation]) expect(part.additionalProperties).toBe(false);
    expect([schema.properties.contextual.maxItems, defs.query.properties.metrics.maxItems, defs.query.properties.dimensions.maxItems, defs.query.properties.filters.maxItems]).toEqual([32, 32, 32, 32]);
    expect([defs.name.maxLength, schema.properties.description.maxLength, defs.person_part.maxLength, defs.scalar.maxLength]).toEqual([120, 2000, 512, 1024]);
  });
});

describe("document board.analysis/v1", () => {
  it("refuse un champ en trop à chaque niveau, SQL et environnement compris", () => {
    for (const path of ["sql", "environment", "secret", "rows", "query.sql", "query.environment", "query.table", "owner.email", "presentation.option", "query.filters.0.raw", "contextual.0.selection", "contextual.1.selection"]) {
      refused(changed(complete, path, "x"));
    }
  });

  it("refuse un champ manquant ou un type inattendu à chaque niveau", () => {
    for (const path of ["api_version", "id", "owner", "name", "description", "visibility", "query", "contextual", "presentation", "query.connection", "query.model", "query.metrics", "query.dimensions", "query.filters", "owner.issuer", "presentation.chart", "query.filters.0.column", "query.filters.0.value", "contextual.0.scope", "contextual.2.denominator", "contextual.0.group_by", "contextual.0.metric", "contextual.0.operation"]) {
      refused(changed(complete, path, undefined));
    }
    for (const [path, value] of [["query", []], ["query", null], ["owner", "x"], ["contextual", {}], ["query.metrics", "revenue"], ["query.filters.0", 3], ["contextual.0", null], ["contextual.0", []], ["presentation", 1], ["name", 12], ["description", null], ["query.connection", 1], ["id", 1]] as const) {
      refused(changed(complete, path, value));
    }
    for (const value of [null, [], "x", 1]) refused(value);
  });

  it("refuse une version, une visibilité, un graphique, une opération ou un opérateur hors domaine", () => {
    for (const [path, value] of [["api_version", "board.analysis/v2"], ["visibility", "public"], ["presentation.chart", "pie"], ["contextual.0.operation", "median"], ["query.filters.0.operator", "like"], ["contextual.0.scope", "selection"], ["contextual.2.denominator", "selection"]] as const) {
      refused(changed(complete, path, value));
    }
  });

  it("borne les textes comme le schéma, en caractères et non en octets", () => {
    const named = (name: unknown) => changed(minimal, "name", name);
    expect(decodeAnalysis(named("a".repeat(120))).name).toHaveLength(120);
    expect(decodeAnalysis(named("😀".repeat(120))).name).toHaveLength(240);
    for (const name of ["", "a".repeat(121), "😀".repeat(121), "a\tb", "a\nb", "a\u0000b", "a\u007fb", "a\u0085b", "a b", "a b", "a\ud800b"]) refused(named(name));
    const described = (description: unknown) => changed(minimal, "description", description);
    expect(decodeAnalysis(described("a".repeat(2000))).description).toHaveLength(2000);
    expect(decodeAnalysis(described("a\tb\nc\n")).description).toBe("a\tb\nc\n");
    for (const description of ["a".repeat(2001), "a\u0000b", "a\rb", "a\u001fb", "a\u009fb", "a b", "\udfff", 12, new Date("2026-01-01")]) refused(described(description));
    const part = (value: unknown) => changed(minimal, "owner.subject", value);
    expect(decodeAnalysis(part("a".repeat(512))).owner.subject).toHaveLength(512);
    for (const value of ["", "a".repeat(513), "a\nb", "a\u0000b"]) refused(part(value));
  });

  it("refuse les identifiants, noms de connexion et listes de noms hors format", () => {
    for (const [path, value] of [
      ["id", "not-a-uuid"], ["id", ID.toUpperCase()], ["id", `${ID}\n`], ["query.connection", "Finance Prod"], ["query.connection", "1finance"], ["query.connection", `a${"b".repeat(63)}`],
      ["query.model", "1sales"], ["query.model", "SELECT 1"], ["query.metrics", []], ["query.metrics", ["revenue", "revenue"]], ["query.metrics", ["SELECT 1"]],
      ["query.metrics", Array.from({ length: 33 }, (_, index) => `m${String(index)}`)], ["query.dimensions", ["region", "region"]], ["query.dimensions", [1]],
      ["query.filters", Array.from({ length: 33 }, () => ({ column: "region", operator: "eq", value: "Nord" }))],
      ["contextual", Array.from({ length: 33 }, () => ({ operation: "aggregate", metric: "revenue", group_by: [], scope: null }))],
    ] as const) {
      refused(changed(complete, path, value));
    }
    const wide = Array.from({ length: 32 }, (_, index) => `m${String(index)}`);
    expect(decodeAnalysis(changed(changed(complete, "query.metrics", wide), "contextual", [])).query.metrics).toHaveLength(32);
    expect(decodeAnalysis(changed(complete, "query.connection", `a${"b".repeat(62)}`)).query.connection).toHaveLength(63);
  });

  it("applique les règles de valeurs de filtres de la soumission", () => {
    const filter = (operator: string, value: unknown) => changed(minimal, "query.filters", [{ column: "region", operator, value }]);
    const accepted: [string, unknown][] = [
      ["eq", "Nord"], ["ne", 0], ["gt", -1.5], ["gte", 10], ["lt", 1e-300], ["lte", true], ["eq", "é (été) a_b.c,d:e/f@g&h+i"], ["eq", "a".repeat(1024)], ["eq", ""],
      ["in", ["a", "b"]], ["in", [1, 2.5]], ["eq", Number.MAX_SAFE_INTEGER], ["eq", Number.MIN_SAFE_INTEGER], ["eq", 0.1], ["eq", 1 / 3], ["between", [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]], ["in", [true, false]], ["in", ["a"]], ["in", Array.from({ length: 100 }, (_, index) => String(index))],
      ["between", [1, 2]], ["between", ["a", "b"]], ["between", [2, 1]], ["between", [1, "a"]],
    ];
    for (const [operator, value] of accepted) expect(decodeAnalysis(filter(operator, value)).query.filters, `${operator} ${JSON.stringify(value)}`).toEqual([{ column: "region", operator, value }]);
    const refusedValues: [string, unknown][] = [
      ["eq", ["a"]], ["eq", null], ["eq", { a: 1 }], ["eq", "x'; DROP TABLE sales; --"], ["eq", "a\nb"], ["eq", "a".repeat(1025)], ["eq", "a-b"], ["eq", "a=b"], ["eq", Number.NaN], ["eq", Infinity], ["eq", "\ud800"],
      // Entiers non représentables exactement : refusés, jamais arrondis (1e19 sort aussi de l'intervalle int64 du serveur).
      ["eq", 1e19], ["eq", 2 ** 53 + 1], ["eq", Number.MAX_SAFE_INTEGER + 1], ["eq", Number.MIN_SAFE_INTEGER - 1], ["eq", 1e300], ["eq", -1e19], ["in", [1, 1e19]], ["between", [0, 2 ** 53 + 1]],
      ["in", "Nord"], ["in", []], ["in", ["a", "a"]], ["in", [1, "a"]], ["in", [1, true]], ["in", [1, 1]], ["in", [null]], ["in", ["a;"]], ["in", Array.from({ length: 101 }, (_, index) => String(index))],
      ["between", [1]], ["between", [1, 2, 3]], ["between", 1], ["between", []], ["between", [{ a: 1 }, 2]],
      ["like", "No%"], ["", "x"],
    ];
    for (const [operator, value] of refusedValues) refused(filter(operator, value));
  });

  it("applique les règles inter-champs des calculs contextuels", () => {
    const step = (value: unknown) => changed(complete, "contextual", [value]);
    const aggregate = { operation: "aggregate", metric: "revenue", group_by: ["region"], scope: null };
    const share = { operation: "share", metric: "revenue", group_by: ["region"], denominator: "loaded_result" };
    expect(decodeAnalysis(step({ ...aggregate, scope: "filtered_perimeter" })).contextual[0]).toEqual({ ...aggregate, scope: "filtered_perimeter" });
    expect(decodeAnalysis(step({ ...share, denominator: "filtered_perimeter" })).contextual[0]).toEqual({ ...share, denominator: "filtered_perimeter" });
    for (const value of [
      { ...aggregate, metric: "margin" }, { ...aggregate, group_by: ["channel2"] }, { ...aggregate, group_by: ["region", "region"] }, { ...aggregate, scope: undefined },
      { ...aggregate, denominator: "loaded_result" }, { ...share, scope: null }, { ...share, denominator: undefined }, { ...share, denominator: null }, { ...share, group_by: [1] },
      { operation: "aggregate", metric: "revenue", group_by: [] }, { operation: "share", metric: "revenue", group_by: [] }, { ...aggregate, extra: 1 },
    ]) {
      refused(step(value));
    }
    // `share` est le nom de la colonne produite par une part : ni métrique ni dimension ne peut le porter.
    const named = changed(changed(complete, "query.metrics", ["share"]), "query.dimensions", ["share"]);
    refused(changed(named, "contextual", [{ ...share, metric: "share", group_by: [] }]));
    refused(changed(named, "contextual", [{ ...share, metric: "share", group_by: ["share"] }]));
    refused(changed(changed(complete, "query.dimensions", ["share"]), "contextual", [{ ...share, group_by: ["share"] }]));
    expect(decodeAnalysis(changed(named, "contextual", [{ ...aggregate, metric: "share", group_by: ["share"] }])).contextual).toHaveLength(1);
  });
});

describe("corps d'une création ou d'une révision", () => {
  it("n'accepte ni api_version, ni id, ni owner : le serveur les pose", () => {
    const draft = draftOf(complete);
    expect(decodeAnalysisDraft(draft)).toEqual(draft);
    for (const [key, value] of [["api_version", API_VERSION], ["id", ID], ["owner", { issuer: "a", subject: "b" }], ["sql", "SELECT 1"]] as const) {
      expect(() => decodeAnalysisDraft({ ...draft, [key]: value })).toThrow(ContractError);
    }
    expect(() => decodeAnalysisDraft(complete)).toThrow(ContractError);
    expect(() => decodeAnalysisDraft({ ...draft, name: undefined })).toThrow(ContractError);
    expect(() => decodeAnalysisDraft(null, "corps")).toThrow("corps");
  });
});
