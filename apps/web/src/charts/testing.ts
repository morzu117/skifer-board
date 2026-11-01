/** Aides de test : accès à l'instance ECharts d'un conteneur et déclenchement d'événements. */
import { echarts, type EChartsType } from "./echarts";

export function chartOf(container: Element): EChartsType {
  const instance = echarts.getInstanceByDom(container as HTMLElement);
  if (instance === undefined) {
    throw new Error("Aucun graphique ECharts dans ce conteneur");
  }
  return instance;
}

/** Simule un clic ECharts sur un élément, comme le ferait zrender. */
export function clickItem(container: Element, params: { name: string; dataIndex: number; seriesIndex?: number }): void {
  (chartOf(container) as unknown as { trigger(event: string, payload: unknown): void }).trigger("click", params);
}
