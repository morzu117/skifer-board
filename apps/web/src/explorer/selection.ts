import type { Selection } from "./model";

type Valeur = string | number | boolean;
export type SelectionChargee =
  | { status: "ok"; selection: Selection }
  | { status: "indisponible"; raison: string };

/** Vérifie que le produit envoyé au serveur désigne exactement les lignes choisies. */
export function selectionChargee(
  lignes: readonly Readonly<Record<string, unknown>>[],
  dimensions: readonly string[],
  indices: ReadonlySet<number>,
): SelectionChargee {
  const indisponible = (raison: string): SelectionChargee => ({ status: "indisponible", raison });
  if (dimensions.length === 0 || indices.size === 0) return indisponible("Choisissez des lignes avec au moins une dimension.");
  const selection: Record<string, Valeur[]> = {};
  for (const dimension of dimensions) {
    const valeurs: Valeur[] = [];
    for (const index of indices) {
      const valeur = lignes[index]?.[dimension];
      if (typeof valeur === "object" && valeur !== null && "type" in valeur && valeur.type === "decimal") {
        return indisponible("Une dimension décimale ne peut pas être transmise exactement au calcul.");
      }
      if (typeof valeur === "bigint" || (typeof valeur === "object" && valeur !== null && "type" in valeur && valeur.type === "integer") || (typeof valeur === "number" && Number.isInteger(valeur) && Math.abs(valeur) > 2 ** 53)) {
        return indisponible("Cet entier dépasse la précision exacte disponible pour une sélection.");
      }
      if (typeof valeur !== "string" && typeof valeur !== "boolean" && (typeof valeur !== "number" || !Number.isFinite(valeur))) {
        return indisponible("Cette valeur de dimension ne peut pas être sélectionnée exactement.");
      }
      if (!valeurs.includes(valeur)) valeurs.push(valeur);
    }
    selection[dimension] = valeurs;
  }
  const couvertes = lignes.map((ligne, index) => dimensions.every((dimension) => selection[dimension]?.includes(ligne[dimension] as Valeur)) ? index : -1).filter((index) => index !== -1);
  if (couvertes.length !== indices.size || couvertes.some((index) => !indices.has(index))) {
    return indisponible("La sélection en escalier ne correspond pas au produit des valeurs par dimension.");
  }
  return { status: "ok", selection };
}
