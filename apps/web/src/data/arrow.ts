/**
 * Lecture de résultats Arrow pour l'affichage (plan 02, W6). Les constructeurs d'options lisent
 * des colonnes, jamais des lignes ; la conversion en lignes n'existe que pour le tableau.
 */
import type { Table } from "apache-arrow";

export class ColumnError extends Error {}

function column(table: Table, name: string) {
  const vector = table.getChild(name);
  if (vector === null) {
    throw new ColumnError(`Colonne absente du résultat : ${name}`);
  }
  return vector;
}

/** Valeurs d'une colonne texte ; une valeur nulle est refusée, c'est une clé d'affichage. */
export function stringColumn(table: Table, name: string): string[] {
  return Array.from(column(table, name), (value: unknown, index) => {
    if (typeof value !== "string") {
      throw new ColumnError(`Valeur non textuelle en ligne ${index} de ${name}`);
    }
    return value;
  });
}

/** Valeurs d'une colonne numérique ; une valeur nulle reste nulle, jamais zéro. */
export function numberColumn(table: Table, name: string): (number | null)[] {
  return Array.from(column(table, name), (value: unknown, index) => {
    if (value === null || typeof value === "number") {
      return value;
    }
    throw new ColumnError(`Valeur non numérique en ligne ${index} de ${name}`);
  });
}

/** Lignes du résultat, pour le tableau d'alternative uniquement. */
export function rowsOf(table: Table, names: readonly string[]): Record<string, string | number | null>[] {
  const columns = names.map((name) => [name, Array.from(column(table, name), (value: unknown) => (typeof value === "string" || typeof value === "number" ? value : null))] as const);
  return Array.from({ length: table.numRows }, (_, row) => Object.fromEntries(columns.map(([name, values]) => [name, values[row] ?? null])));
}
