import { expect, it } from "vitest";
import { availabilityLabel, KIND_LABELS, MODE_LABELS, PROBLEM_LABELS, shortCommit, STATUS_LABELS, versionLabel } from "./labels";
it("traduit les types, statuts, modes et problèmes sans code technique seul", () => {
  expect(KIND_LABELS).toEqual({ concept: "Concept", kpi: "KPI" });
  expect(STATUS_LABELS).toEqual({ validated: { label: "Validé", tone: "success" }, draft: { label: "Brouillon", tone: "neutral" }, needs_curation: { label: "À curer", tone: "warning" }, invalid: { label: "Invalide", tone: "danger" } });
  expect(MODE_LABELS).toEqual({ override: "Surcharge", from_scratch: "Définition propre" });
  expect(PROBLEM_LABELS.repository_missing).toContain("introuvable");
  expect(PROBLEM_LABELS.repository_unreadable).toContain("illisible");
  expect(versionLabel(null)).toBe("—");
  expect(versionLabel(4)).toBe("v4");
  expect(shortCommit("d7eba96de96a")).toBe("d7eba96");
});
it.each(["mapping_absent", "not_validated", null] as const)("un KPI non résolu n'est jamais exécutable : %s", (reason) => {
  const label = availabilityLabel({ state: "unresolved", reason });
  expect(label.label).toBe("Non résolue");
  expect(label.tone).toBe("warning");
  expect(label.short).toBe(reason === "not_validated" ? "Non validée dans Atlas" : "Sans modèle sémantique (AT-02)");
  expect(label.cause).toBe(reason === "not_validated" ? "Référence non résolue : définition non validée dans Atlas." : "Référence non résolue : correspondance avec un modèle sémantique non définie (Atlas, AT-02).");
});
it("sait représenter une correspondance exécutable si le contrat en fournit une", () => {
  expect(availabilityLabel({ state: "executable", reason: null })).toEqual({ label: "Exécutable", tone: "success", short: null, cause: null });
});
