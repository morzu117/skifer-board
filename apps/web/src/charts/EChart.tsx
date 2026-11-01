import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from "react";

import { echarts, type ChartOption, type EChartsType } from "./echarts";

/** Élément de graphique désigné par un clic. */
export interface ChartItem {
  seriesIndex: number;
  dataIndex: number;
  name: string;
}

/** Commandes exposées au composant parent : export et navigation clavier. */
export interface ChartHandle {
  /** Télécharge l'image vectorielle du graphique, sur le fond donné ; `false` si le graphique n'existe plus. */
  downloadImage(filename: string, background: string): boolean;
  /** Met un élément en avant et affiche son infobulle ; `null` retire la mise en avant. */
  focusItem(dataIndex: number | null): void;
}

interface EChartProps {
  option: ChartOption;
  /** Description accessible du graphique, rédigée depuis les données et la sélection. */
  label: string;
  height: number;
  onItemClick?: ((item: ChartItem) => void) | undefined;
  ref?: Ref<ChartHandle>;
}

/**
 * Enveloppe ECharts : initialise en SVG, applique l'option, suit la taille du conteneur,
 * relaie les clics et libère l'instance (plan 02, W7 et W10). Aucune logique de données ici.
 */
export function EChart({ option, label, height, onItemClick, ref }: EChartProps) {
  const chart = useRef<EChartsType | null>(null);
  const latestOption = useRef(option);
  const clickHandler = useRef(onItemClick);

  useEffect(() => {
    clickHandler.current = onItemClick;
  }, [onItemClick]);

  // Ref de rappel : l'instance vit exactement aussi longtemps que son conteneur.
  const attach = useCallback((element: HTMLDivElement) => {
    const instance = echarts.init(element, undefined, { renderer: "svg" });
    instance.setOption(latestOption.current, { notMerge: true });
    instance.on("click", (params) => {
      clickHandler.current?.({ seriesIndex: params.seriesIndex ?? 0, dataIndex: params.dataIndex, name: params.name });
    });
    const observer = new ResizeObserver(() => {
      instance.resize();
    });
    observer.observe(element);
    chart.current = instance;
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    if (latestOption.current !== option) {
      latestOption.current = option;
      chart.current?.setOption(option, { notMerge: true });
    }
  }, [option]);

  useEffect(() => {
    chart.current?.resize();
  }, [height]);

  useImperativeHandle(
    ref,
    () => ({
      downloadImage: (filename, background) => {
        const instance = chart.current;
        if (instance === null) {
          return false;
        }
        const link = document.createElement("a");
        link.href = instance.getDataURL({ type: "svg", backgroundColor: background });
        link.download = filename;
        link.click();
        return true;
      },
      focusItem: (dataIndex) => {
        const instance = chart.current;
        instance?.dispatchAction({ type: "downplay" });
        if (dataIndex === null) {
          instance?.dispatchAction({ type: "hideTip" });
          return;
        }
        instance?.dispatchAction({ type: "highlight", seriesIndex: 0, dataIndex });
        instance?.dispatchAction({ type: "showTip", seriesIndex: 0, dataIndex });
      },
    }),
    [],
  );

  return <div ref={attach} role="img" aria-label={label} style={{ width: "100%", height }} />;
}
