import { ContractError } from "../catalogue/decode";
import { decodeViolations, SHARED_CODES, type RefusalDetails } from "../analyses/refusal";
import { distinct, exact, items, pick, uuid } from "../analyses/shape";

/**
 * Refus des routes de dashboards (plan 19, 19.2) : une union fermée, celle que les contrats d'exemple emploient. Elle
 * reprend de celle des analyses (plan 18) le conflit de révision, le dépôt indisponible et les codes que la garde de
 * lecture rend aussi ; elle n'en reprend aucun code d'analyse, qu'une route de dashboard ne rend jamais. Chaque code a une
 * forme exacte : un champ en plus, un champ en moins ou une valeur hors domaine rend le refus illisible, donc une erreur,
 * jamais un refus partiel.
 */
export const DASHBOARD_CODES = ["dashboard_not_found", "invalid_dashboard", "personal_reference"] as const;
export type DashboardCode = (typeof DASHBOARD_CODES)[number];

/**
 * `revision_conflict` ne porte ici que `stale`. `head_changed`, que le dépôt lève sous son verrou quand la tête a bougé,
 * n'est jamais exposé : la route de suppression d'une analyse le rejuge puis le rend `stale`, et aucune route de dashboard
 * ne le demande. Un `head_changed` reçu est donc un refus illisible.
 */
export const DASHBOARD_REFUSALS = [...DASHBOARD_CODES, "revision_conflict", "content_unavailable", ...SHARED_CODES] as const;

/**
 * Règles fermées des violations d'un `invalid_dashboard` : celles du format commun aux deux genres de contenu, celles de
 * `board.dashboard/v1` (plan 19.1) et celles des contrôles qui demandent les analyses et le catalogue (plan 19.2, B4 et B7).
 */
export const DASHBOARD_RULES = [
  "wrong_type", "value_not_allowed", "bad_format", "out_of_bounds", "duplicate_item", "unknown_field", "missing_field",
  "field_not_allowed", "schema_violation", "invalid_filter", "metric_not_in_query", "group_by_not_in_query", "reserved_name",
  "unsupported_value", "unreadable_document", "not_representable", "id_mismatch", "bad_identifier", "bad_revision", "bad_actor",
  "duplicate_id", "row_overflow", "too_deep", "container_not_alone", "filter_without_target", "unknown_target",
  "target_not_executable", "default_not_allowed",
  "analysis_unavailable", "kpi_requires_value", "chart_incompatible", "dimension_not_exposed", "filter_type_mismatch",
  "operator_not_allowed", "filter_value_incompatible", "too_many_filters",
] as const;
export type DashboardRule = (typeof DASHBOARD_RULES)[number];

/** Au plus autant de composants que de composants exécutables d'un dashboard (plan 19, B2). */
const MAX_COMPONENTS = 40;

export const isDashboardCode = (code: string): code is DashboardCode => (DASHBOARD_CODES as readonly string[]).includes(code);

/** Ordre du serveur : chemin puis règle, strictement, donc sans doublon. */
const before = (a: { path: string; rule: string }, b: { path: string; rule: string }): boolean => a.path < b.path || (a.path === b.path && a.rule < b.rule);

function details(code: DashboardCode, error: Readonly<Record<string, unknown>>): RefusalDetails {
  switch (code) {
    case "dashboard_not_found":
      // Aucune raison : un dashboard invisible ressemble octet pour octet à un dashboard inconnu.
      exact(error, ["code"], "refus");
      return {};
    case "invalid_dashboard": {
      exact(error, ["code", "reason", "violations"], "refus");
      const violations = decodeViolations(error.violations, DASHBOARD_RULES, "refus.violations", 1);
      const reason = pick(error.reason, DASHBOARD_RULES, "refus.reason");
      // Le serveur trie les violations et donne la règle de la première pour raison.
      if (violations[0]?.rule !== reason) throw new ContractError("refus.reason : règle de la première violation attendue");
      if (!violations.every((item, index) => index === 0 || before(violations[index - 1] as typeof item, item))) throw new ContractError("refus.violations : violations triées et distinctes attendues");
      return { reason, dashboardViolations: violations };
    }
    case "personal_reference": {
      exact(error, ["code", "components"], "refus");
      const components = items(error.components, "refus.components", MAX_COMPONENTS, 1).map((item, index) => uuid(item, `refus.components[${String(index)}]`));
      return { components: distinct(components, "refus.components") };
    }
  }
}

/** Détails fermés d'un refus de dashboard, ou `null` quand il n'a pas la forme exacte de son contrat. */
export function dashboardRefusalDetails(code: DashboardCode, error: Readonly<Record<string, unknown>>): RefusalDetails | null {
  try {
    return details(code, error);
  } catch {
    return null;
  }
}
