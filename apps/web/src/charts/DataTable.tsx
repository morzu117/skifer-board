import { formatNumber, MISSING } from "../format/number";
import "./charts.css";

export type Cell = string | number | null;

export interface Column {
  key: string;
  label: string;
  /** Nombre : police mono, aligné à droite. */
  numeric?: boolean;
  format?: (value: Cell) => string;
}

export interface TableSpec {
  caption: string;
  columns: readonly Column[];
  rows: readonly Readonly<Record<string, Cell>>[];
  /** Colonne qui identifie une ligne, pour la sélection. */
  rowKey: string;
  selectedKeys?: readonly string[];
}

function defaultFormat(value: Cell): string {
  if (value === null) {
    return MISSING;
  }
  return typeof value === "number" ? formatNumber(value) : value;
}

/**
 * Tableau de données : alternative à un graphique ou vue de détail (DESIGN-SYSTEM §5).
 * Le conteneur défilant est un groupe nommé, focalisable au clavier, et non une région :
 * une région est un repère de page, qui entrerait en conflit avec la carte qui l'entoure
 * quand le titre de la carte et la légende du tableau coïncident.
 */
export function DataTable({ caption, columns, rows, rowKey, selectedKeys = [] }: TableSpec) {
  return (
    <div className="sb-table-wrap" role="group" aria-label={caption} tabIndex={0}>
      <table className="sb-table">
        <caption className="sb-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.numeric === true ? "sb-num" : undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = String(row[rowKey]);
            const selected = selectedKeys.includes(key);
            return (
              <tr key={key} className={selected ? "sb-row--selected" : undefined}>
                {columns.map((column, index) => (
                  <td key={column.key} className={column.numeric === true ? "sb-num" : undefined}>
                    {(column.format ?? defaultFormat)(row[column.key] ?? null)}
                    {selected && index === 0 ? <span className="sb-visually-hidden"> (sélectionnée)</span> : null}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
