import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Card } from "../ui/Card";
import { DataTable, type TableSpec } from "./DataTable";
import { EChart, type ChartHandle, type ChartItem } from "./EChart";
import type { ChartOption } from "./echarts";
import type { SelectionEvent } from "./selection";
import "./charts.css";

/** Élément parcouru au clavier, dans l'ordre de l'axe. */
export interface NavigableItem {
  key: string;
  /** Phrase annoncée quand l'élément reçoit le focus : « Île-de-France : 7,2 M€ ». */
  announcement: string;
  /** Indices de la marque lorsque plusieurs séries sont parcourues. */
  dataIndex?: number;
  seriesIndex?: number;
}

interface ChartCardProps {
  title: string;
  /** Description accessible : contenu et sélection, rédigée depuis les données. */
  description: string;
  option: ChartOption;
  table: TableSpec;
  items: readonly NavigableItem[];
  /** Identifiant de la vue, porté par les événements de sélection. */
  source: string;
  /** Dimension sélectionnable ; sans elle, le graphique se parcourt sans se sélectionner. */
  dimension?: string | undefined;
  onSelect?: ((event: SelectionEvent) => void) | undefined;
  itemKey?: ((item: ChartItem) => string | null) | undefined;
  /** Fond de l'image exportée : celui du thème. */
  exportBackground: string;
  height?: number;
  actions?: ReactNode;
  /** Pied de tuile : périmètre, fraîcheur, définition. */
  footer?: ReactNode;
}

type View = "chart" | "table";

const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown"]);
const PREVIOUS_KEYS = new Set(["ArrowLeft", "ArrowUp"]);

/**
 * Tuile de graphique : titre, onglets Graphique / Tableau, navigation clavier, export
 * (RULES §3 : chaque graphique a un `aria-label`, une alternative tableau et le clavier).
 */
export function ChartCard({ title, description, option, table, items, source, dimension, onSelect, itemKey, exportBackground, height = 260, actions, footer }: ChartCardProps) {
  const [view, setView] = useState<View>("chart");
  const [cursor, setCursor] = useState<number | null>(null);
  const chart = useRef<ChartHandle>(null);
  const chartTab = useRef<HTMLButtonElement>(null);
  const tableTab = useRef<HTMLButtonElement>(null);
  const id = useId();
  const help = `${id}-help`;

  const select = (key: string): void => {
    if (dimension !== undefined) {
      onSelect?.({ type: "toggle", source, dimension, key });
    }
  };

  const moveTo = (index: number): void => {
    setCursor(index);
    const cible = items[index];
    chart.current?.focusItem(cible?.dataIndex ?? index, cible?.seriesIndex ?? 0);
  };

  const item = cursor === null ? undefined : items[cursor];

  const onChartKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const last = Math.max(items.length - 1, 0);
    const current = cursor ?? -1;
    if (NEXT_KEYS.has(event.key)) {
      moveTo(Math.min(current + 1, last));
    } else if (PREVIOUS_KEYS.has(event.key)) {
      moveTo(Math.max(current - 1, 0));
    } else if (event.key === "Home") {
      moveTo(0);
    } else if (event.key === "End") {
      moveTo(last);
    } else if ((event.key === "Enter" || event.key === " ") && item !== undefined) {
      select(item.key);
    } else if (event.key === "Escape") {
      setCursor(null);
      chart.current?.focusItem(null);
      onSelect?.({ type: "clear", source });
    } else {
      return;
    }
    event.preventDefault();
  };

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const next = view === "chart" ? "table" : "chart";
      setView(next);
      (next === "chart" ? chartTab : tableTab).current?.focus();
      event.preventDefault();
    }
  };

  const exportImage = (): void => {
    chart.current?.downloadImage(`${title}.svg`, exportBackground);
  };

  return (
    <Card
      title={title}
      className="sb-chart-card"
      actions={
        <>
          <div role="tablist" aria-label={`Affichage de ${title}`} className="sb-tabs" onKeyDown={onTabKey}>
            <button ref={chartTab} type="button" role="tab" id={`${id}-tab-chart`} aria-controls={`${id}-chart`} aria-selected={view === "chart"} tabIndex={view === "chart" ? 0 : -1} onClick={() => { setView("chart"); }}>
              Graphique
            </button>
            <button ref={tableTab} type="button" role="tab" id={`${id}-tab-table`} aria-controls={`${id}-table`} aria-selected={view === "table"} tabIndex={view === "table" ? 0 : -1} onClick={() => { setView("table"); }}>
              Tableau
            </button>
          </div>
          <button type="button" className="sb-button" onClick={exportImage} disabled={view !== "chart"}>
            Exporter l'image
          </button>
          {actions}
        </>
      }
    >
      <div id={`${id}-chart`} role="tabpanel" aria-labelledby={`${id}-tab-chart`} hidden={view !== "chart"}>
        <div className="sb-chart-focus" role="group" aria-label={title} aria-describedby={help} tabIndex={0} onKeyDown={onChartKey}>
          <EChart ref={chart} option={option} label={description} height={height} onItemClick={(item) => { const key = itemKey === undefined ? item.name : itemKey(item); if (key !== null) select(key); }} />
        </div>
        <p id={help} className="sb-visually-hidden">
          {dimension === undefined ? "Flèches pour parcourir les valeurs." : "Flèches pour parcourir, Entrée ou Espace pour sélectionner, Échap pour tout désélectionner."}
        </p>
        <p className="sb-visually-hidden" aria-live="polite">
          {item?.announcement}
        </p>
      </div>
      <div id={`${id}-table`} role="tabpanel" aria-labelledby={`${id}-tab-table`} hidden={view !== "table"}>
        <DataTable {...table} />
      </div>
      {footer === undefined ? null : <div className="sb-chart-card__foot">{footer}</div>}
    </Card>
  );
}
