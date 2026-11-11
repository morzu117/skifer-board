import { expect, it } from "vitest";
import type { Refusal } from "../spaces/admin";
import { dashboardRefusalText } from "./Failure";

const refusal = (extra: Partial<Refusal>): Refusal => ({ code: "invalid_dashboard", field: null, ...extra });

it("dit le conflit de révision sans rien écraser", () => {
  expect(dashboardRefusalText(refusal({ code: "revision_conflict" }))).toMatch(/rien n'a été écrasé/);
});

it("dit la règle et le chemin de chaque violation", () => {
  const text = dashboardRefusalText(refusal({ dashboardViolations: [{ path: "/layout", rule: "row_overflow" }, { path: "", rule: "wrong_type" }] }));
  expect(text).toContain("/layout : rangée de plus de 12 douzièmes ; / : type de valeur incorrect.");
});

it("nomme les composants qui épinglent une analyse personnelle", () => {
  expect(dashboardRefusalText(refusal({ code: "personal_reference", components: ["a", "b"] }))).toContain("Composants : a, b.");
});

it("sans détail, garde le texte de base", () => {
  const plain = dashboardRefusalText(refusal({ code: "forbidden" }));
  expect(plain).not.toContain("Composants");
  expect(dashboardRefusalText(refusal({}))).toBe(dashboardRefusalText(refusal({ dashboardViolations: undefined })));
  expect(dashboardRefusalText(refusal({ code: "personal_reference" }))).not.toContain("Composants");
});
