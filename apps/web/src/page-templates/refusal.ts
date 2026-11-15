import { decodeViolations, VIOLATION_RULES } from "../analyses/refusal";
import { exact, fail, pick } from "../analyses/shape";
import { decodeThemeRefusal, type ThemeRefusal } from "../themes/refusal";

/** Codes et règles émis par les routes et le format des modèles (content/errors.py et dashboard.py). */
export const PAGE_TEMPLATE_REFUSALS = ["page_template_not_found", "invalid_page_template", "already_approved", "not_owner", "content_unavailable", "revision_conflict", "forbidden", "local_mode", "space_not_found", "invalid_request", "invalid_parameter"] as const;
export const PAGE_TEMPLATE_RULES = [...VIOLATION_RULES.slice(0, 20), "duplicate_id", "row_overflow", "too_deep", "container_not_alone", "filter_without_target", "unknown_target", "target_not_executable", "default_not_allowed"] as const;
export type PageTemplateRefusal = Omit<ThemeRefusal, "code"> & { code: (typeof PAGE_TEMPLATE_REFUSALS)[number] };
export function decodePageTemplateRefusal(value: unknown): PageTemplateRefusal {
  const envelope = exact(value, ["error"], "refus");
  const f = envelope.error;
  if (typeof f !== "object" || f === null || Array.isArray(f) || !("code" in f)) return fail("refus.error", "objet");
  const error = f as Record<string, unknown>;
  pick(error.code, PAGE_TEMPLATE_REFUSALS, "refus.error.code");
  if (error.code === "page_template_not_found") {
    exact(error, ["code"], "refus.error");
    return { code: "page_template_not_found" };
  }
  if (error.code === "invalid_page_template") {
    exact(error, ["code", "reason", "violations"], "refus.error");
    const reason = pick(error.reason, PAGE_TEMPLATE_RULES, "refus.error.reason");
    const violations = decodeViolations(error.violations, PAGE_TEMPLATE_RULES, "refus.error.violations", 1);
    if (violations[0]?.rule !== reason || violations.some((item, i) => i > 0 && !((violations[i - 1]?.path as string) < item.path || (violations[i - 1]?.path === item.path && (violations[i - 1]?.rule as string) < item.rule)))) return fail("refus.error.violations", "violations ordonnées");
    return { code: "invalid_page_template", reason, violations };
  }
  const other = decodeThemeRefusal(value);
  return { ...other, code: pick(other.code, PAGE_TEMPLATE_REFUSALS, "refus.error.code") };
}
