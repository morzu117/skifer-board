import { expect, it } from "vitest";
import { selectionChargee } from "./selection";

const lignes = [
  { pays: "France", annee: 2025 }, { pays: "France", annee: 2026 },
  { pays: "Belgique", annee: 2025 }, { pays: "Belgique", annee: 2026 },
];
it("accepte exactement les lignes couvertes par le produit", () => {
  expect(selectionChargee(lignes, ["pays", "annee"], new Set([0, 1]))).toEqual({ status: "ok", selection: { pays: ["France"], annee: [2025, 2026] } });
});
it("refuse une sélection en escalier", () => {
  const resultat = selectionChargee(lignes, ["pays", "annee"], new Set([0, 1, 2]));
  expect(resultat.status).toBe("indisponible");
  if (resultat.status === "indisponible") expect(resultat.raison).toContain("escalier");
});
it("refuse les valeurs non représentables et les sélections vides", () => {
  expect(selectionChargee([{ n: { type: "integer", value: "9007199254740993" } }], ["n"], new Set([0])).status).toBe("indisponible");
  expect(selectionChargee(lignes, [], new Set([0])).status).toBe("indisponible");
  expect(selectionChargee(lignes, ["pays"], new Set()).status).toBe("indisponible");
  expect(selectionChargee(lignes, ["pays"], new Set([100])).status).toBe("indisponible");
  expect(selectionChargee([{ n: 2 ** 53 + 2 }], ["n"], new Set([0])).status).toBe("indisponible");
});
