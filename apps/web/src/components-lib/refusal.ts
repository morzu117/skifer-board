import { VIOLATION_RULES, type Violation } from "../analyses/refusal";
import { distinct, exact, fail, items, pick, uuid } from "../analyses/shape";
import { decodeThemeRefusal, type ThemeRefusal } from "../themes/refusal";

export type ComponentRefusal = Omit<ThemeRefusal, "code"> & { code: Exclude<ThemeRefusal["code"], "theme_not_found" | "invalid_theme"> | "component_not_found" | "invalid_component" | "analysis_not_found" | "personal_reference"; components?: readonly string[]; violations?: readonly Violation<string>[] };
export const COMPONENT_REFUSALS = ["component_not_found", "invalid_component", "analysis_not_found", "personal_reference", "already_approved", "not_owner", "content_in_use", "content_unavailable", "revision_conflict", "forbidden", "local_mode", "space_not_found", "invalid_request", "invalid_parameter"] as const;
export const COMPONENT_RULES = VIOLATION_RULES.slice(0, 20);

/** Refus fermés des routes de composants : la validation de l'analyse ajoute deux codes. */
export function decodeComponentRefusal(value: unknown): ComponentRefusal {
  const envelope = exact(value, ["error"], "refus");
  const f = envelope.error;
  if (typeof f !== "object" || f === null || Array.isArray(f) || !("code" in f)) return fail("refus.error", "objet");
  const error = f as Record<string, unknown>;
  pick(error.code, COMPONENT_REFUSALS, "refus.error.code");
  if (error.code === "component_not_found" || error.code === "analysis_not_found") {
    exact(error, ["code"], "refus.error");
    return { code: error.code };
  }
  if (error.code === "personal_reference") {
    exact(error, ["code", "components"], "refus.error");
    return { code: "personal_reference", components: distinct(items(error.components, "refus.error.components", 40, 1).map((one, i) => uuid(one, `refus.error.components[${String(i)}]`)), "refus.error.components") };
  }
  if (error.code === "invalid_component") {
    const decoded = decodeThemeRefusal({ error: { ...error, code: "invalid_theme" } });
    if (decoded.violations?.some((one) => !COMPONENT_RULES.includes(one.rule as (typeof VIOLATION_RULES)[number]))) return fail("refus.error.violations", "règles du composant");
    return { ...decoded, code: "invalid_component" };
  }
  const other = decodeThemeRefusal(value);
  return { ...other, code: pick(other.code, COMPONENT_REFUSALS, "refus.error.code") };
}
