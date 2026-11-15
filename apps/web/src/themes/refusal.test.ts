import { describe, expect, it } from "vitest";
import { decodeThemeRefusal, THEME_REFUSALS, THEME_RULES } from "./refusal";

const routes = import.meta.glob<{ status: number; body: unknown }>("../../../../contracts/themes/routes/refus-*.json", { eager: true, import: "default" });
const ID = "00000000-0000-4000-8000-000000000001";
const unmask = (value: unknown): unknown => JSON.parse(JSON.stringify(value).replaceAll("<uuid>", ID)) as unknown;

describe("refus de thèmes", () => {
  it("décode chacun des refus publiés", () => {
    expect(Object.keys(routes)).toHaveLength(10);
    for (const item of Object.values(routes)) expect(THEME_REFUSALS).toContain(decodeThemeRefusal(unmask(item.body)).code);
    expect([...THEME_RULES].sort()).toEqual(["wrong_type", "value_not_allowed", "bad_format", "out_of_bounds", "duplicate_item", "unknown_field", "missing_field", "field_not_allowed", "schema_violation", "invalid_filter", "metric_not_in_query", "group_by_not_in_query", "reserved_name", "unsupported_value", "unreadable_document", "not_representable", "id_mismatch", "bad_identifier", "bad_revision", "bad_actor", "token_not_admissible", "not_monotone", "even_diverging", "non_neutral", "hex_color", "diverging_sides", "duplicate_color"].sort());
  });
  it("juge les champs fermés et les refus des paramètres", () => {
    for (const [input, expected] of [
      [{ code: "forbidden", required: "admin" }, { code: "forbidden", required: "admin" }],
      [{ code: "invalid_request", field: "body" }, { code: "invalid_request", field: "body" }],
      [{ code: "invalid_parameter", parameter: "from", detail: "invalide" }, { code: "invalid_parameter", parameter: "from", detail: "invalide" }],
      [{ code: "space_not_found" }, { code: "space_not_found" }],
    ]) expect(decodeThemeRefusal({ error: input })).toEqual(expected);
    expect(decodeThemeRefusal({ error: { code: "invalid_theme", reason: "wrong_type", violations: [{ path: "/a", rule: "wrong_type" }, { path: "/a/b", rule: "wrong_type" }] } }).code).toBe("invalid_theme");
    expect(decodeThemeRefusal({ error: { code: "invalid_theme", reason: "missing_field", violations: [{ path: "/a", rule: "missing_field" }, { path: "/a", rule: "wrong_type" }] } }).code).toBe("invalid_theme");
    for (const error of [null, [], {}, { code: "inventé" }, { code: "theme_not_found", extra: true }, { code: "forbidden", required: "reader" }, { code: "invalid_request", field: "" }, { code: "revision_conflict", reason: "head_changed" }, { code: "content_in_use", consumers: [], others: 0 }, { code: "content_in_use", consumers: [{ kind: "component", id: ID }], others: 0 }, { code: "invalid_theme", reason: "wrong_type", violations: [] }, { code: "invalid_theme", reason: "wrong_type", violations: [{ path: "/a", rule: "wrong_type" }, { path: "/a", rule: "wrong_type" }] }, { code: "invalid_theme", reason: "wrong_type", violations: [{ path: "/a", rule: "missing_field" }] }, { code: "invalid_theme", reason: "wrong_type", violations: [{ path: "/z", rule: "wrong_type" }, { path: "/a", rule: "wrong_type" }] }]) expect(() => decodeThemeRefusal({ error })).toThrow();
  });
});
