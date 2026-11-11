import { ContractError } from "../catalogue/decode";
import type { DashboardRule } from "../dashboards/refusal";
import { count, distinct, exact, items, pick, uuid, word } from "./shape";

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
  reason?: "stale" | ViolationRule | DashboardRule | undefined;
  violations?: readonly Violation[] | undefined;
  /** Violations d'un `invalid_dashboard` : leurs règles sont celles des dashboards, pas celles des analyses. */
  dashboardViolations?: readonly Violation<DashboardRule>[] | undefined;
  /** Composants d'un dashboard partagé dont l'analyse épinglée ne l'est pas (`personal_reference`). */
  components?: readonly string[] | undefined;
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

/**
 * `consumers` et `others` d'un objet déjà vérifié (celui d'un refus `analysis_in_use` ou de la route des consommateurs) :
 * genre et identifiant des dépendants que le demandeur voit, jamais deux fois le même, et le nombre des autres.
 */
export function decodeConsumerList(found: Readonly<Record<string, unknown>>, path: string): { consumers: readonly Consumer[]; others: number } {
  const consumers = items(found.consumers, `${path}.consumers`, Number.MAX_SAFE_INTEGER).map((item, index): Consumer => {
    const entry = exact(item, ["kind", "id"], `${path}.consumers[${String(index)}]`);
    return { kind: pick(entry.kind, CONSUMER_KINDS, `${path}.consumers.kind`), id: uuid(entry.id, `${path}.consumers.id`) };
  });
  distinct(consumers.map((consumer) => consumer.id), `${path}.consumers`);
  return { consumers, others: count(found.others, `${path}.others`) };
}

function details(code: string, error: Readonly<Record<string, unknown>>, closed: boolean): RefusalDetails {
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
      const listed = decodeConsumerList(error, "refus");
      // Au moins un dépendant, visible ou non : un refus sans aucun dépendant n'a pas de raison d'être.
      if (listed.consumers.length + listed.others === 0) throw new ContractError("refus : au moins un dépendant attendu");
      return listed;
    }
    case "forbidden":
      if (closed) {
        // Garde de rôle des routes de contenu : `required` seul, parmi les trois rôles.
        exact(error, ["code", "required"], "refus");
        return { required: pick(error.required, REQUIRED, "refus.required") };
      }
      return REQUIRED.some((known) => known === error.required) ? { required: error.required as (typeof REQUIRED)[number] } : {};
    case "invalid_parameter":
      if (closed) {
        // Le serveur nomme le paramètre et dit la règle en clair : rien d'autre.
        exact(error, ["code", "parameter", "detail"], "refus");
        word(error.detail, "refus.detail");
        return { parameter: pick(error.parameter, PARAMETERS, "refus.parameter") };
      }
      return PARAMETERS.some((known) => known === error.parameter) ? { parameter: error.parameter as (typeof PARAMETERS)[number] } : {};
    case "local_mode":
    case "space_not_found":
    case "engine_unavailable":
      // Aucun champ : `{code}`, comme la garde de lecture et le moteur le rendent.
      if (closed) exact(error, ["code"], "refus");
      return {};
    case "invalid_request":
      // Le corps rendu par la garde nomme toujours le champ en cause, jamais sa valeur.
      if (closed) {
        exact(error, ["code", "field"], "refus");
        if (word(error.field, "refus.field") === "") throw new ContractError("refus.field : nom de champ attendu");
      }
      return {};
    default:
      return {};
  }
}

/**
 * Détails d'un refus, ou `null` quand il n'a pas la forme exacte de son contrat. Les codes d'analyses ont toujours leur
 * forme exacte. Les codes communs (`forbidden`, `invalid_parameter`, `local_mode`, `space_not_found`, `engine_unavailable`,
 * `invalid_request`) ne l'ont que si `closed` : les routes d'analyses et de dashboards le demandent, celles des espaces,
 * des exécutions et de l'explorateur gardent leur lecture tolérante (champ en trop ignoré, champ illisible rendu `null`).
 */
export function refusalDetails(code: string, error: Readonly<Record<string, unknown>>, closed = false): RefusalDetails | null {
  try {
    return details(code, error, closed);
  } catch {
    return null;
  }
}
