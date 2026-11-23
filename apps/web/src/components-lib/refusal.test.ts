import { expect, it } from "vitest";
import { decodeComponentRefusal } from "./refusal";

const ID = "00000000-0000-4000-8000-000000000001";
it("juge les refus propres aux composants et à leur analyse", () => {
  expect(decodeComponentRefusal({ error: { code: "component_not_found" } })).toEqual({ code: "component_not_found" });
  expect(decodeComponentRefusal({ error: { code: "analysis_not_found" } })).toEqual({ code: "analysis_not_found" });
  expect(decodeComponentRefusal({ error: { code: "personal_reference", components: [ID] } })).toEqual({ code: "personal_reference", components: [ID] });
  expect(decodeComponentRefusal({ error: { code: "invalid_component", reason: "missing_field", violations: [{ path: "/name", rule: "missing_field" }] } }).code).toBe("invalid_component");
  for (const error of [null, {}, { code: "theme_not_found" }, { code: "invalid_theme", reason: "missing_field", violations: [{ path: "/name", rule: "missing_field" }] }, { code: "personal_reference", components: [] }, { code: "invalid_component", reason: "hex_color", violations: [{ path: "/name", rule: "hex_color" }] }]) expect(() => decodeComponentRefusal({ error })).toThrow();
});
