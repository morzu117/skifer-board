import { ContractError } from "../catalogue/decode";
import { count, exact, items, pick, uuid, word } from "./shape";

/**
 * Refus des routes d'analyses (plan 18, 18.2 et 18.3) : une union fermée, celle que les contrats
 * d'exemple emploient. Chaque code nouveau a une forme exacte ; un champ en plus, un champ en
 * moins ou une valeur hors domaine rend le refus illisible, donc une erreur, jamais un refus partiel.
 */
export const ANALYSIS_CODES = ["analysis_not_found", "invalid_analysis", "analysis_in_use", "revision_conflict", "content_unavailable", "analysis_model_mismatch"] as const;
export type AnalysisCode = (typeof ANALYSIS_CODES)[number];

/** Codes déjà connus de Board que ces routes rendent aussi (garde de lecture, paramètres, moteur). */
export const SHARED_CODES = ["forbidden", "local_mode", "space_not_found", "invalid_request", "invalid_parameter", "engine_unavailable"] as const;

/** Union fermée des refus d'une route d'analyse ou d'une soumission avec référence. */
export const ANALYSIS_REFUSALS = [...ANALYSIS_CODES, ...SHARED_CODES] as const;

/** Règles du format (18.1), des références au catalogue et des calculs contextuels (18.2). */
export const VIOLATION_RULES = [
  "wrong_type", "value_not_allowed", "bad_format", "out_of_bounds", "duplicate_item", "unknown_field", "missing_field",
  "field_not_allowed", "schema_violation", "invalid_filter", "metric_not_in_query", "group_by_not_in_query", "reserved_name",
  "unsupported_value", "unreadable_document", "not_representable", "id_mismatch", "bad_identifier", "bad_revision", "bad_actor",
  "unknown_model", "unknown_metric", "unknown_dimension", "unknown_connection", "filter_not_allowed",
  "unknown_aggregation", "share_undefined", "count_distinct_not_summable", "non_additive", "components_missing",
] as const;
export type ViolationRule = (typeof VIOLATION_RULES)[number];
/** Règles qu'une relecture d'analyse peut rendre dans `unresolved` : les références au catalogue seulement. */
export const REFERENCE_RULES = ["unknown_connection", "unknown_model", "unknown_metric", "unknown_dimension", "filter_not_allowed"] as const;

/** Chemin JSON et règle fermée, jamais une valeur. */
export interface Violation<R extends string = ViolationRule> {
  path: string;
  rule: R;
}
export const CONSUMER_KINDS = ["dashboard"] as const;
export interface Consumer {
  kind: (typeof CONSUMER_KINDS)[number];
  id: string;
}
export const REQUIRED = ["reader", "creator", "owner"] as const;
export const PARAMETERS = ["revision", "base", "other"] as const;

export interface RefusalDetails {
  required?: (typeof REQUIRED)[number] | undefined;
  parameter?: (typeof PARAMETERS)[number] | undefined;
  reason?: "stale" | ViolationRule | undefined;
  violations?: readonly Violation[] | undefined;
  consumers?: readonly Consumer[] | undefined;
  /** Dépendants que le demandeur ne voit pas : un décompte, jamais leur identité. */
  others?: number | undefined;
}

const PATH = /^(?:\/(?:[A-Za-z0-9_]{1,64}|\*))*$/;

export function decodeViolations<R extends string>(value: unknown, rules: readonly R[], path: string, min: number): readonly Violation<R>[] {
  return items(value, path, Number.MAX_SAFE_INTEGER, min).map((item, index) => {
    const here = `${path}[${String(index)}]`;
    const found = exact(item, ["path", "rule"], here);
    const where = word(found.path, `${here}.path`);
    if (!PATH.test(where)) throw new ContractError(`${here}.path : chemin JSON attendu`);
    return { path: where, rule: pick(found.rule, rules, `${here}.rule`) };
  });
}

function details(code: string, error: Readonly<Record<string, unknown>>): RefusalDetails {
  switch (code) {
    case "analysis_not_found":
    case "content_unavailable":
    case "analysis_model_mismatch":
      // Aucune raison : un refus d'analyse invisible ressemble octet pour octet à celui d'une analyse inconnue.
      exact(error, ["code"], "refus");
      return {};
    case "revision_conflict":
      exact(error, ["code", "reason"], "refus");
      return { reason: pick(error.reason, ["stale"] as const, "refus.reason") };
    case "invalid_analysis": {
      exact(error, ["code", "reason", "violations"], "refus");
      const violations = decodeViolations(error.violations, VIOLATION_RULES, "refus.violations", 1);
      const reason = pick(error.reason, VIOLATION_RULES, "refus.reason");
      if (!violations.some((item) => item.rule === reason)) throw new ContractError("refus.reason : règle d'une violation attendue");
      return { reason, violations };
    }
    case "analysis_in_use": {
      exact(error, ["code", "consumers", "others"], "refus");
      const consumers = items(error.consumers, "refus.consumers", Number.MAX_SAFE_INTEGER).map((item, index): Consumer => {
        const found = exact(item, ["kind", "id"], `refus.consumers[${String(index)}]`);
        return { kind: pick(found.kind, CONSUMER_KINDS, "refus.consumers.kind"), id: uuid(found.id, "refus.consumers.id") };
      });
      const others = count(error.others, "refus.others");
      // Au moins un dépendant, visible ou non : un refus sans aucun dépendant n'a pas de raison d'être.
      if (consumers.length + others === 0) throw new ContractError("refus : au moins un dépendant attendu");
      return { consumers, others };
    }
    case "forbidden":
      return REQUIRED.some((known) => known === error.required) ? { required: error.required as (typeof REQUIRED)[number] } : {};
    case "invalid_parameter":
      return PARAMETERS.some((known) => known === error.parameter) ? { parameter: error.parameter as (typeof PARAMETERS)[number] } : {};
    default:
      return {};
  }
}

/** Détails fermés d'un refus, ou `null` quand un code d'analyse n'a pas la forme exacte de son contrat. */
export function refusalDetails(code: string, error: Readonly<Record<string, unknown>>): RefusalDetails | null {
  try {
    return details(code, error);
  } catch {
    return null;
  }
}
