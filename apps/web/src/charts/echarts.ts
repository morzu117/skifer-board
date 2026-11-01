/** Import modulaire d'ECharts : seuls les graphiques et composants éprouvés au lot 01 entrent dans le build. */
import { BarChart, HeatmapChart, LineChart } from "echarts/charts";
import { GridComponent, MarkLineComponent, TooltipComponent, VisualMapPiecewiseComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";

echarts.use([BarChart, LineChart, HeatmapChart, GridComponent, TooltipComponent, MarkLineComponent, VisualMapPiecewiseComponent, SVGRenderer]);

export { echarts };
export type { EChartsCoreOption as ChartOption, EChartsType } from "echarts/core";
