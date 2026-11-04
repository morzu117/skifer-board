/** Import modulaire d'ECharts : seuls les graphiques et composants éprouvés au lot 01 entrent dans le build. */
import { BarChart, HeatmapChart, LineChart } from "echarts/charts";
import { GraphicComponent, GridComponent, MarkLineComponent, TooltipComponent, VisualMapPiecewiseComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { AxisBreak } from "echarts/features";
import { SVGRenderer } from "echarts/renderers";

echarts.use([GraphicComponent, BarChart, LineChart, HeatmapChart, GridComponent, TooltipComponent, MarkLineComponent, VisualMapPiecewiseComponent, AxisBreak, SVGRenderer]);

export { echarts };
export type { EChartsCoreOption as ChartOption, EChartsType } from "echarts/core";
