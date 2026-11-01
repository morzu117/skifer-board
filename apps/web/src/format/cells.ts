/** Formateurs de cellule de tableau : une valeur d'un autre type que prévu s'affiche absente. */
import { formatMonthLong } from "./date";
import { formatAmount, MISSING } from "./number";

type Cell = string | number | null;

export function amountCell(value: Cell): string {
  return typeof value === "number" ? formatAmount(value) : MISSING;
}

export function monthCell(value: Cell): string {
  return typeof value === "string" ? formatMonthLong(value) : MISSING;
}
