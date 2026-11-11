import { refusalText } from "../spaces/AdminParts";
import type { Refusal } from "../spaces/admin";
import { DASHBOARD_RULE_LABELS } from "./labels";

/**
 * Refus d'une route de dashboard, tel que le serveur le dit, avec ce que son code porte : la règle et le chemin de chaque
 * violation, les composants qui épinglent une analyse personnelle. Le conflit de révision se dit pour un dashboard : rien n'est
 * écrasé, la version de la personne reste ouverte.
 */
export function dashboardRefusalText(refusal: Refusal): string {
  if (refusal.code === "revision_conflict") return "Une autre révision a été enregistrée entre-temps : rien n'a été écrasé. Votre version reste ouverte et non enregistrée ; rouvrez le dashboard pour lire la dernière révision.";
  const base = refusalText(refusal);
  if (refusal.code === "invalid_dashboard" && refusal.dashboardViolations !== undefined) {
    return `${base} ${refusal.dashboardViolations.map((violation) => `${violation.path === "" ? "/" : violation.path} : ${DASHBOARD_RULE_LABELS[violation.rule]}`).join(" ; ")}.`;
  }
  if (refusal.code === "personal_reference" && refusal.components !== undefined) return `${base} Composants : ${refusal.components.join(", ")}.`;
  return base;
}
