import { NARROW_CHART_WIDTH } from "../../charts/theme";
import { LIMITS, type DashboardDraft, type Row } from "../document";

/** Largeurs proposées pour l'aperçu. */
export const PREVIEW_WIDTHS = { desktop: 1280, tablet: 768, phone: 390 } as const;
/** D-5 : seuil sans token, partagé par convention avec les media queries de shell.css. */
export const SHELL_WIDTH = 760;
/** Colonne effective, avec ses éventuelles rangées imbriquées. */
export interface EffectiveColumn { id: string; fraction: number; children: readonly ({ id: string; type: string; rows?: readonly EffectiveRow[]; narrow?: boolean })[] }
/** Rangée effective : colonnes empilées ou réparties sur la grille. */
export interface EffectiveRow { id: string; stacked: boolean; columns: readonly EffectiveColumn[] }
/** Résout la disposition dans l'ordre du document, y compris les conteneurs imbriqués. */
export function responsiveLayout(document: DashboardDraft, width: number): readonly { id: string; rows: readonly EffectiveRow[] }[] {
  const stacked = width <= SHELL_WIDTH;
  // ECharts applique max-width inclusivement à la largeur du conteneur graphique.
  function row(item: Row, parentWidth: number): EffectiveRow {
    return { id: item.id, stacked, columns: item.columns.map((column) => ({
      id: column.id,
      fraction: stacked ? 1 : column.span / LIMITS.grid,
      children: column.children.map((child) => child.type === "container"
        ? { id: child.id, type: child.type, rows: child.rows.map((nested) => row(nested, parentWidth * (stacked ? 1 : column.span / LIMITS.grid))) }
        : { id: child.id, type: child.type, ...(child.type === "analysis" ? { narrow: parentWidth * (stacked ? 1 : column.span / LIMITS.grid) <= NARROW_CHART_WIDTH } : {}) }),
    })) };
  }
  return document.layout.sections.map((section) => ({ id: section.id, rows: section.rows.map((item) => row(item, width)) }));
}
