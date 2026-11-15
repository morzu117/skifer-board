import { expect, it } from "vitest";
import { decodePageTemplateRefusal } from "./refusal";
const refusal = (error: unknown) => ({ error });
it("décode les refus fermés des modèles et leurs violations", () => {
  expect(decodePageTemplateRefusal(refusal({ code: "page_template_not_found" }))).toEqual({ code: "page_template_not_found" });
  expect(decodePageTemplateRefusal(refusal({ code: "forbidden", required: "creator" }))).toEqual({ code: "forbidden", required: "creator" });
  expect(decodePageTemplateRefusal(refusal({ code: "invalid_page_template", reason: "duplicate_id", violations: [{ path: "/id", rule: "duplicate_id" }] }))).toMatchObject({ reason: "duplicate_id" });
  expect(decodePageTemplateRefusal(refusal({ code: "invalid_page_template", reason: "duplicate_id", violations: [{ path: "/id", rule: "duplicate_id" }, { path: "/id", rule: "wrong_type" }] }))).toMatchObject({ reason: "duplicate_id" });
  for (const value of [null, {}, [], { code: "page_template_not_found", extra: true }, { code: "theme_not_found" }, { code: "invalid_theme", reason: "wrong_type", violations: [{ path: "/x", rule: "wrong_type" }] }, { code: "content_in_use", consumers: [{ kind: "dashboard", id: "00000000-0000-4000-8000-000000000001" }], others: 0 }, { code: "invalid_page_template", reason: "wrong_type", violations: [{ path: "/id", rule: "duplicate_id" }] }, { code: "invalid_page_template", reason: "wrong_type", violations: [{ path: "/z", rule: "wrong_type" }, { path: "/a", rule: "wrong_type" }] }]) expect(() => decodePageTemplateRefusal(refusal(value))).toThrow();
});

const routes = import.meta.glob<{ status: number; body: unknown }>("../../../../contracts/page_templates/routes/refus-*.json", { eager: true, import: "default" });
it("décode chacun des refus publiés", () => {
  expect(Object.keys(routes)).toHaveLength(8);
  for (const [path, route] of Object.entries(routes)) {
    expect(route.status, path).toBeGreaterThanOrEqual(400);
    expect(() => decodePageTemplateRefusal(route.body), path).not.toThrow();
  }
});
