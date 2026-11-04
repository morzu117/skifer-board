import { expect, it } from "vitest";
import { availabilityLabel, changeValue, KIND_LABELS, MODE_LABELS, PROBLEM_LABELS, SEVERITY_LABELS, shortCommit, STATUS_LABELS, versionLabel } from "./labels";
import { DIFF_SEVERITIES } from "./model";
it("traduit les types, statuts, modes et problèmes sans code technique seul", () => {
  expect(KIND_LABELS).toEqual({ concept: "Concept", kpi: "KPI" });
  expect(STATUS_LABELS).toEqual({ validated: { label: "Validé", tone: "success" }, draft: { label: "Brouillon", tone: "neutral" }, needs_curation: { label: "À curer", tone: "warning" }, invalid: { label: "Invalide", tone: "danger" } });
  expect(MODE_LABELS).toEqual({ override: "Surcharge", from_scratch: "Définition propre" });
  expect(PROBLEM_LABELS.repository_missing).toContain("introuvable");
  expect(PROBLEM_LABELS.repository_unreadable).toContain("illisible");
  expect(PROBLEM_LABELS.index_busy).toContain("occupé");
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
it("nomme chaque sévérité d'Atlas par un mot, la couleur ne faisant que le doubler", () => {
  expect(SEVERITY_LABELS).toEqual({
    critical: { label: "Critique", tone: "danger" },
    warn: { label: "Attention", tone: "warning" },
    info: { label: "Information", tone: "neutral" },
  });
  expect(Object.keys(SEVERITY_LABELS).sort()).toEqual([...DIFF_SEVERITIES].sort());
  expect(new Set(DIFF_SEVERITIES.map((severity) => SEVERITY_LABELS[severity].label)).size).toBe(DIFF_SEVERITIES.length);
});
it.each<[string, unknown, string]>([
  ["texte tel quel, expression comprise", "montant_ttc - montant_taxes", "montant_ttc - montant_taxes"],
  ["texte vide", "", ""],
  ["texte qui ressemble à du JSON", "null", "null"],
  ["null", null, "absent"],
  ["undefined", undefined, "absent"],
  ["objet en JSON", { op: "sum", of: ["a", 1] }, '{"op":"sum","of":["a",1]}'],
  ["liste en JSON", ["a", null, 2], '["a",null,2]'],
  ["liste vide", [], "[]"],
  ["nombre", 12.5, "12.5"],
  ["zéro", 0, "0"],
  ["booléen vrai", true, "true"],
  ["booléen faux", false, "false"],
])("écrit une valeur de champ : %s", (_label, value, expected) => {
  expect(changeValue(value)).toBe(expected);
});
