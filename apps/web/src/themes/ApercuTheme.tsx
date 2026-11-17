import { ChartCard } from "../charts/ChartCard";
import { themePresentation } from "../dashboards/edition/presentation";
import { drawChart, formatValue, type Style } from "../dashboards/edition/tileChart";
import { InfoIcon } from "../ui/icons";
import { KpiTile } from "../ui/KpiTile";
import { TOKEN_CATALOG } from "./catalog";
import { chartThemeOf } from "./chartTheme";
import type { ThemeDocument } from "./document";
import { themeProblems, type Document } from "./edition";
import exemple from "./apercu-exemple.json";

/** Données fictives locales ; aucune exécution ou lecture de l'espace. */
export function ApercuTheme({ document }: { document: Document }) {
  const problems = themeProblems(document, TOKEN_CATALOG);
  return <section id="theme-apercu" tabIndex={0} className={`sb-themes__preview sb-theme-${document.base}`} aria-label="Aperçu du thème">
    <h2>Aperçu</h2>
    <small className="sb-field__hint sb-themes__scroll-hint">Défilez dans l’aperçu pour voir tous les graphiques.</small>
    <p>Aperçu sur des données d'exemple embarquées : aucune exécution, aucune donnée de l'espace.</p>
    <p className="sb-field__hint sb-themes__hint"><InfoIcon size={14} />Les palettes catégorielle et divergente, l'échelle typographique et la densité ne sont pas encore rendues dans cet aperçu.</p>
    {problems.length > 0 ? <p role="status">Aperçu indisponible : le thème comporte des problèmes. <button type="button" className="sb-button" onClick={() => { globalThis.document.getElementById("theme-problemes")?.focus(); }}>Voir la liste des problèmes</button>.</p> : <PreviewContent document={document} />}
  </section>;
}
function PreviewContent({ document }: { document: Document }) {
  const theme = chartThemeOf(document as ThemeDocument, TOKEN_CATALOG);
  const presentation = (chart: Style["chart"]): Style => {
    const values = themePresentation(document as ThemeDocument, chart);
    return { chart, legend: values.legend as Style["legend"], numberFormat: values.number_format as Style["numberFormat"], tooltip: values.tooltip as Style["tooltip"], threshold: values.threshold, dateFormat: document.formats.date };
  };
  const valueStyle = presentation("value");
  return <div className="sb-themes__preview-grid" data-series-token={document.roles.marks.series}>
    <KpiTile state="value" label={exemple.kpi.title} value={formatValue(exemple.kpi.value, valueStyle.numberFormat)} />
    {exemple.charts.map((chart) => {
      const shape = { dimensions: chart.dimensions, metrics: chart.metrics, temporalDimensions: chart.type === "line" ? ["date fictive"] : [] };
      const rows = chart.rows as readonly Record<string, string>[];
      const drawn = drawChart(rows, shape, presentation(chart.type as Style["chart"]), theme, {});
      const table = { caption: `Valeurs de ${chart.title}`, columns: [...shape.dimensions, ...shape.metrics].map((key) => ({ key, label: key })), rows: rows.map((row, index) => ({ ...row, __ligne: String(index) })), rowKey: "__ligne" };
      return <ChartCard key={chart.type} title={chart.title} description={drawn.description} option={drawn.option} table={table} items={drawn.items} source={`apercu-${chart.type}`} exportBackground={theme.surface} allowExport={false} height={220} />;
    })}
  </div>;
}
