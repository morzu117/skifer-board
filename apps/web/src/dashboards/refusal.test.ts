import { describe, expect, it } from "vitest";
import { ANALYSIS_CODES } from "../analyses/refusal";
import { REFUSAL_LABELS, REFUSALS, refusalOf } from "../spaces/admin";
import { DASHBOARD_CODES, DASHBOARD_REFUSALS, DASHBOARD_RULES, dashboardRefusalDetails, isDashboardCode } from "./refusal";
import { ID, OTHER_ID, route } from "./testing";

const error = (body: Record<string, unknown>) => ({ error: body });
const invalid = (body: Record<string, unknown> = {}) => error({ code: "invalid_dashboard", reason: "unknown_field", violations: [{ path: "/owner", rule: "unknown_field" }], ...body });
const personal = (body: Record<string, unknown> = {}) => error({ code: "personal_reference", components: [ID], ...body });

describe("refus des dashboards", () => {
  it("lit les refus d'exemple du serveur avec leur forme exacte", () => {
    expect(refusalOf(route("refus-dashboard-inconnu").body)).toEqual({ code: "dashboard_not_found", field: null });
    expect(refusalOf(route("refus-champ-reserve").body)).toEqual({
      code: "invalid_dashboard", field: null, reason: "field_not_allowed", dashboardViolations: [{ path: "/owner", rule: "field_not_allowed" }],
    });
    expect(refusalOf(route("refus-dashboard-invalide-analyse").body)).toMatchObject({
      code: "invalid_dashboard", reason: "analysis_unavailable", dashboardViolations: [{ path: "/layout/sections/0/rows/0/columns/0/children/0/reference", rule: "analysis_unavailable" }],
    });
    expect(refusalOf(route("refus-dashboard-invalide-filtre").body)).toMatchObject({
      code: "invalid_dashboard", reason: "dimension_not_exposed", dashboardViolations: [{ path: "/filters/0/targets/0", rule: "dimension_not_exposed" }],
    });
    const found = refusalOf(route("refus-reference-personnelle").body);
    expect(found).toMatchObject({ code: "personal_reference", field: null });
    expect(found).toHaveProperty("components");
    expect(refusalOf(route("refus-revision-conflit").body)).toEqual({ code: "revision_conflict", field: null, reason: "stale" });
    expect(refusalOf(route("refus-depot-indisponible").body)).toEqual({ code: "content_unavailable", field: null });
    expect(refusalOf(route("refus-moteur-indisponible").body)).toEqual({ code: "engine_unavailable", field: null });
    expect(refusalOf(route("refus-mode-local").body)).toEqual({ code: "local_mode", field: null });
    expect(refusalOf(route("refus-pas-proprietaire").body)).toEqual({ code: "forbidden", field: null, required: "owner" });
    expect(refusalOf(route("refus-interdit").body)).toEqual({ code: "forbidden", field: null, required: "creator" });
  });

  it("a une union fermée : trois codes propres, ceux des analyses que les routes rendent, aucun autre", () => {
    expect([...DASHBOARD_CODES]).toEqual(["dashboard_not_found", "invalid_dashboard", "personal_reference"]);
    expect([...DASHBOARD_REFUSALS].sort()).toEqual([
      "content_unavailable", "dashboard_not_found", "engine_unavailable", "forbidden", "invalid_dashboard", "invalid_parameter", "invalid_request", "local_mode", "personal_reference", "revision_conflict", "space_not_found",
    ]);
    expect(new Set(DASHBOARD_REFUSALS).size).toBe(DASHBOARD_REFUSALS.length);
    for (const code of DASHBOARD_REFUSALS) {
      expect(REFUSALS, code).toContain(code);
      expect(REFUSAL_LABELS[code as keyof typeof REFUSAL_LABELS], code).toBeTruthy();
    }
    // Aucune route de dashboard ne rend un code propre aux analyses.
    for (const code of ANALYSIS_CODES.filter((known) => !(DASHBOARD_REFUSALS as readonly string[]).includes(known))) expect(DASHBOARD_REFUSALS).not.toContain(code);
    expect(DASHBOARD_CODES.every(isDashboardCode)).toBe(true);
    for (const code of ["analysis_not_found", "revision_conflict", "forbidden", "", "Invalid_dashboard"]) expect(isDashboardCode(code)).toBe(false);
    expect(new Set(DASHBOARD_RULES).size).toBe(DASHBOARD_RULES.length);
  });

  it("emploie des règles de violation qui sont toutes les règles que le serveur rend", () => {
    // Les règles des fixtures invalides et des refus d'exemple sont dans la liste fermée.
    for (const rule of [
      "unknown_field", "missing_field", "value_not_allowed", "bad_format", "out_of_bounds", "wrong_type", "duplicate_item", "invalid_filter", "duplicate_id", "container_not_alone", "row_overflow", "too_deep",
      "filter_without_target", "unknown_target", "target_not_executable", "default_not_allowed", "field_not_allowed", "analysis_unavailable", "dimension_not_exposed",
    ]) expect(DASHBOARD_RULES, rule).toContain(rule);
  });

  it("lit un refus de dashboard inconnu sans raison : un dashboard invisible ressemble à un inconnu", () => {
    expect(dashboardRefusalDetails("dashboard_not_found", { code: "dashboard_not_found" })).toEqual({});
    for (const extra of [{ reason: "personal" }, { field: "id" }, { required: "reader" }, { detail: "x" }, { message: "introuvable" }]) {
      expect(refusalOf(error({ code: "dashboard_not_found", ...extra })), JSON.stringify(extra)).toBeNull();
    }
  });

  it("lit les violations d'un dashboard invalide : chemin et règle fermés, triées, la première donne la raison", () => {
    expect(refusalOf(invalid({
      reason: "bad_format", violations: [{ path: "/id", rule: "bad_format" }, { path: "/name", rule: "bad_format" }, { path: "/name", rule: "out_of_bounds" }, { path: "/owner", rule: "unknown_field" }],
    }))).toMatchObject({ code: "invalid_dashboard", reason: "bad_format", dashboardViolations: [{ path: "/id" }, { path: "/name", rule: "bad_format" }, { path: "/name", rule: "out_of_bounds" }, { path: "/owner" }] });
    // Un chemin du document entier (`""`) et un jeton `*` sont des chemins du serveur.
    expect(refusalOf(invalid({ reason: "missing_field", violations: [{ path: "", rule: "missing_field" }] }))).toMatchObject({ dashboardViolations: [{ path: "" }] });
    expect(refusalOf(invalid({ reason: "too_deep", violations: [{ path: "/layout/sections/*", rule: "too_deep" }] }))).toMatchObject({ reason: "too_deep" });
  });

  it("refuse comme illisible chaque refus de dashboard invalide à la forme forgée", () => {
    const base = { code: "invalid_dashboard", reason: "unknown_field", violations: [{ path: "/owner", rule: "unknown_field" }] };
    const forged: Record<string, unknown>[] = [
      { ...base, extra: 1 }, { ...base, field: "owner" }, { ...base, field: null }, { ...base, consumers: [] },
      { code: "invalid_dashboard", violations: base.violations }, { code: "invalid_dashboard", reason: base.reason },
      { ...base, reason: "sql" }, { ...base, reason: null }, { ...base, reason: 3 }, { ...base, reason: "unknown_model" },
      // La raison est la règle de la première violation, rien d'autre.
      { ...base, reason: "bad_format" },
      { ...base, violations: [] }, { ...base, violations: {} }, { ...base, violations: "x" }, { ...base, violations: null },
      { ...base, violations: [{ path: "/owner" }] }, { ...base, violations: [{ rule: "unknown_field" }] }, { ...base, violations: [{ path: "/owner", rule: "unknown_field", value: "x" }] },
      { ...base, violations: [{ path: "/owner", rule: "sql" }] }, { ...base, violations: [{ path: "owner", rule: "unknown_field" }] }, { ...base, violations: [{ path: "/own er", rule: "unknown_field" }] },
      { ...base, violations: [{ path: "/a b", rule: "unknown_field" }] }, { ...base, violations: [{ path: 1, rule: "unknown_field" }] }, { ...base, violations: [null] }, { ...base, violations: ["/owner"] },
      { ...base, violations: [{ path: `/${"a".repeat(65)}`, rule: "unknown_field" }] },
      // Triées strictement par chemin puis par règle : ni désordre, ni doublon.
      { ...base, violations: [{ path: "/owner", rule: "unknown_field" }, { path: "/id", rule: "bad_format" }] },
      { ...base, violations: [{ path: "/owner", rule: "unknown_field" }, { path: "/owner", rule: "unknown_field" }] },
      { ...base, reason: "unknown_field", violations: [{ path: "/owner", rule: "unknown_field" }, { path: "/owner", rule: "missing_field" }] },
    ];
    for (const body of forged) {
      expect(refusalOf(error(body)), JSON.stringify(body)).toBeNull();
      expect(dashboardRefusalDetails("invalid_dashboard", body), JSON.stringify(body)).toBeNull();
    }
    expect(refusalOf(invalid())).not.toBeNull();
  });

  it("lit les composants d'une référence personnelle : de 1 à 40 identifiants distincts", () => {
    expect(refusalOf(personal())).toEqual({ code: "personal_reference", field: null, components: [ID] });
    expect(refusalOf(personal({ components: [ID, OTHER_ID] }))).toMatchObject({ components: [ID, OTHER_ID] });
    const forty = Array.from({ length: 40 }, (_, index) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`);
    expect(refusalOf(personal({ components: forty }))).toMatchObject({ components: forty });
  });

  it("refuse comme illisible chaque référence personnelle à la forme forgée", () => {
    const forty = Array.from({ length: 41 }, (_, index) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`);
    const forged: Record<string, unknown>[] = [
      { code: "personal_reference" }, { code: "personal_reference", components: [] }, { code: "personal_reference", components: forty }, { code: "personal_reference", components: [ID, ID] },
      { code: "personal_reference", components: ["x"] }, { code: "personal_reference", components: [ID.toUpperCase()] }, { code: "personal_reference", components: [1] }, { code: "personal_reference", components: ID },
      { code: "personal_reference", components: {} }, { code: "personal_reference", components: null }, { code: "personal_reference", components: [ID], extra: 1 }, { code: "personal_reference", components: [ID], reason: "x" },
      { code: "personal_reference", components: [ID], field: "components" }, { code: "personal_reference", components: [ID], analyses: [OTHER_ID] },
    ];
    for (const body of forged) {
      expect(refusalOf(error(body)), JSON.stringify(body)).toBeNull();
      expect(dashboardRefusalDetails("personal_reference", body), JSON.stringify(body)).toBeNull();
    }
  });

  it("n'expose pas head_changed : un conflit de révision n'a que la raison stale", () => {
    expect(refusalOf(error({ code: "revision_conflict", reason: "stale" }))).toMatchObject({ code: "revision_conflict", reason: "stale" });
    for (const reason of ["head_changed", "fresh", "", null]) expect(refusalOf(error({ code: "revision_conflict", reason })), String(reason)).toBeNull();
    expect(refusalOf(error({ code: "revision_conflict" }))).toBeNull();
    expect(refusalOf(error({ code: "revision_conflict", reason: "stale", current: 3 }))).toBeNull();
  });

  it("garde un dépôt indisponible sans détail : un détail en plus rend le refus illisible", () => {
    expect(refusalOf(error({ code: "content_unavailable" }))).toEqual({ code: "content_unavailable", field: null });
    expect(refusalOf(error({ code: "content_unavailable", detail: "git: fatal" }))).toBeNull();
    expect(refusalOf(error({ code: "engine_unavailable" }))).toEqual({ code: "engine_unavailable", field: null });
  });

  it("n'accepte un code de dashboard que par son décodeur, jamais celui des analyses", () => {
    // Même corps, un autre code : `invalid_analysis` exige `violations` des analyses, `invalid_dashboard` celles des dashboards.
    expect(refusalOf(error({ code: "invalid_analysis", reason: "unknown_field", violations: [{ path: "/owner", rule: "unknown_field" }] }))).toMatchObject({ code: "invalid_analysis", violations: [{ rule: "unknown_field" }] });
    expect(refusalOf(error({ code: "invalid_analysis", reason: "analysis_unavailable", violations: [{ path: "/x", rule: "analysis_unavailable" }] }))).toBeNull();
    expect(refusalOf(error({ code: "invalid_dashboard", reason: "unknown_model", violations: [{ path: "/x", rule: "unknown_model" }] }))).toBeNull();
    expect(refusalOf(error({ code: "dashboard_unknown" }))).toBeNull();
  });
});
