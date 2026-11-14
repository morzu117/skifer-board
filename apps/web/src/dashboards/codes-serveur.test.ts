import { expect, it } from "vitest";
import { ANALYSIS_REFUSALS, VIOLATION_RULES } from "../analyses/refusal";
import { refusalOf } from "../spaces/admin";
import { DASHBOARD_RULE_LABELS } from "./labels";
import { DASHBOARD_REFUSALS, DASHBOARD_RULES } from "./refusal";
import codes from "./codes-serveur-20.json";

// Inventaire figé issu de content/errors.py, analysis.RULES, references.CATALOG_RULES,
// dashboard.RULES, dashboard_checks.CHECK_RULES, dashboard_shared.py, web.py,
// dashboard_web.py et des gardes de spaces/web.py (plan 20.2).
it("connaît toutes les règles et tous les codes émis sur les routes de contenu", () => {
  for (const rule of codes.analysis_violations) expect(VIOLATION_RULES).toContain(rule);
  for (const rule of codes.dashboard_violations) expect(DASHBOARD_RULES).toContain(rule);
  for (const code of codes.analysis_refusals) expect(ANALYSIS_REFUSALS).toContain(code);
  for (const code of codes.dashboard_refusals) expect(DASHBOARD_REFUSALS).toContain(code);
  for (const rule of ["theme_not_found", "component_not_found"] as const) {
    expect(DASHBOARD_RULE_LABELS[rule]).toBeTruthy();
    expect(refusalOf({ error: { code: "invalid_dashboard", reason: rule, violations: [{ path: "/theme", rule }] } })).toMatchObject({ code: "invalid_dashboard", reason: rule, dashboardViolations: [{ path: "/theme", rule }] });
  }
});
