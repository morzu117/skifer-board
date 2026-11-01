import type { BadgeTone } from "../ui/Badge";
import type { AtlasStatus, Availability, DocumentKind, SourceProblem } from "./model";

export const KIND_LABELS: Record<DocumentKind, string> = { concept: "Concept", kpi: "KPI" };

export const STATUS_LABELS: Record<AtlasStatus, { label: string; tone: BadgeTone }> = {
  validated: { label: "Validé", tone: "success" },
  draft: { label: "Brouillon", tone: "neutral" },
  needs_curation: { label: "À curer", tone: "warning" },
  invalid: { label: "Invalide", tone: "danger" },
};

export const PROBLEM_LABELS: Record<SourceProblem, string> = {
  repository_missing: "le clone de l'espace est introuvable",
  repository_unreadable: "le clone de l'espace est illisible",
};

/**
 * Libellé, ton et cause d'une disponibilité ; un concept n'en a pas (plan 04, C4).
 * `short` est la cause dans le tableau, `cause` la phrase complète de la fiche.
 */
export function availabilityLabel(availability: Availability): { label: string; tone: BadgeTone; short: string | null; cause: string | null } {
  if (availability.state === "executable") {
    return { label: "Exécutable", tone: "success", short: null, cause: null };
  }
  return availability.reason === "not_validated"
    ? { label: "Non résolue", tone: "warning", short: "Non validée dans Atlas", cause: "Référence non résolue : définition non validée dans Atlas." }
    : {
        label: "Non résolue",
        tone: "warning",
        short: "Sans modèle sémantique (AT-02)",
        cause: "Référence non résolue : correspondance avec un modèle sémantique non définie (Atlas, AT-02).",
      };
}

export const MODE_LABELS: Record<string, string> = { override: "Surcharge", from_scratch: "Définition propre" };

export function versionLabel(version: number | null): string {
  return version === null ? "—" : `v${String(version)}`;
}

export function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}
