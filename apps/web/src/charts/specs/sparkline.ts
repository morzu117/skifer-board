/**
 * Tracé d'une sparkline en SVG pur. Une instance ECharts par tuile KPI serait disproportionnée
 * pour un tracé décoratif : la valeur et l'écart portent l'information (décision 0001).
 */
export function sparklinePath(values: readonly (number | null)[], width: number, height: number, padding = 2): string {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) {
    return "";
  }
  const min = Math.min(...present);
  const span = Math.max(...present) - min;
  const step = values.length > 1 ? (width - 2 * padding) / (values.length - 1) : 0;
  const y = (value: number): number => (span === 0 ? height / 2 : height - padding - ((value - min) / span) * (height - 2 * padding));
  let path = "";
  let pen = false;
  values.forEach((value, index) => {
    if (value === null) {
      pen = false;
      return;
    }
    path += `${pen ? "L" : "M"}${(padding + index * step).toFixed(1)} ${y(value).toFixed(1)}`;
    pen = true;
  });
  return path;
}
