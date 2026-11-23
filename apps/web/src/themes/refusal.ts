import { decodeConsumerList, decodeViolations, VIOLATION_RULES, type Consumer, type Violation } from "../analyses/refusal";
import { exact, fail, pick, word } from "../analyses/shape";

/** Codes que les routes de thèmes et leurs gardes peuvent rendre. */
export const THEME_REFUSALS = ["theme_not_found", "invalid_theme", "already_approved", "not_owner", "content_in_use", "content_unavailable", "revision_conflict", "forbidden", "local_mode", "space_not_found", "invalid_request", "invalid_parameter"] as const;
export const THEME_RULES = [...VIOLATION_RULES.slice(0, 20), "token_not_admissible", "not_monotone", "even_diverging", "non_neutral", "hex_color", "diverging_sides", "duplicate_color"] as const;
export type ThemeRefusal = { code: (typeof THEME_REFUSALS)[number]; reason?: string; violations?: readonly Violation<string>[]; required?: string; field?: string; parameter?: string; detail?: string; consumers?: readonly Consumer[]; others?: number };

/** Un refus connu, de forme exacte, ou une exception si le contrat est rompu. */
export function decodeThemeRefusal(value: unknown): ThemeRefusal {
  const envelope = exact(value, ["error"], "refus");
  const error = envelope.error;
  const object = typeof error === "object" && error !== null && !Array.isArray(error) ? error as Record<string, unknown> : fail("refus.error", "objet");
  const code = pick(object.code, THEME_REFUSALS, "refus.error.code");
  switch (code) {
    case "theme_not_found": case "already_approved": case "not_owner": case "content_unavailable": case "local_mode": case "space_not_found":
      exact(error, ["code"], "refus.error"); return { code };
    case "revision_conflict":
      exact(error, ["code", "reason"], "refus.error"); return { code, reason: pick(object.reason, ["stale"] as const, "refus.error.reason") };
    case "forbidden":
      exact(error, ["code", "required"], "refus.error"); return { code, required: pick(object.required, ["creator", "admin"] as const, "refus.error.required") };
    case "invalid_request": {
      exact(error, ["code", "field"], "refus.error");
      const field = word(object.field, "refus.error.field");
      if (field === "") return fail("refus.error.field", "nom de champ");
      return { code, field };
    }
    case "invalid_parameter":
      exact(error, ["code", "parameter", "detail"], "refus.error"); return { code, parameter: pick(object.parameter, ["revision", "from", "to"] as const, "refus.error.parameter"), detail: word(object.detail, "refus.error.detail") };
    case "invalid_theme": {
      exact(error, ["code", "reason", "violations"], "refus.error");
      const reason = pick(object.reason, THEME_RULES, "refus.error.reason");
      const violations = decodeViolations(object.violations, THEME_RULES, "refus.error.violations", 1);
      if (violations[0]?.rule !== reason || violations.some((item, i) => i > 0 && !((violations[i - 1]?.path as string) < item.path || (violations[i - 1]?.path === item.path && (violations[i - 1]?.rule as string) < item.rule)))) return fail("refus.error.violations", "violations ordonnées");
      return { code, reason, violations };
    }
    case "content_in_use": {
      exact(error, ["code", "consumers", "others"], "refus.error");
      const result = decodeConsumerList(object, "refus.error");
      if (result.consumers.some((item) => item.kind !== "dashboard") || result.consumers.length + result.others === 0) return fail("refus.error", "au moins un consommateur");
      return { code, ...result };
    }
  }
}
