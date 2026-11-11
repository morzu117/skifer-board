import { expect, it } from "vitest";
import { SKIFER_CLAIR } from "../../charts/theme";
import { chartProblem, drawChart, formatValue, type Style } from "./tileChart";

const style = (extra: Partial<Style> = {}): Style => ({ chart: "bars", legend: "auto", numberFormat: "auto", threshold: undefined, tooltip: "value", ...extra });
const rows = [{ region: "Nord", channel: "Web", revenue: "12.5", orders: "3" }, { region: "Nord", channel: "Magasin", revenue: "2", orders: "1" }, { region: "Sud", channel: "Web", revenue: "—", orders: "4" }];
const shape = { metrics: ["revenue"], dimensions: ["region"] };
type Series = { name: string; type: string; data: (string | null)[]; markLine?: unknown; lineStyle?: unknown }[];
const series = (option: object) => (option as { series: Series }).series;

it("ne formate que sur demande, et laisse intact ce qui n'est pas un nombre", () => {
  expect(formatValue("1234.567", "auto")).toBe("1234.567");
  expect(formatValue("abc", "integer")).toBe("abc");
  expect(formatValue("1234.567", "integer")).toBe("1\u202f235");
  expect(formatValue("1.25", "decimal_1")).toMatch(/^1,[23]$/);
  expect(formatValue("1.256", "decimal_2")).toBe("1,26");
  expect(formatValue("0.256", "percent")).toMatch(/25,6\s?%/);
  expect(formatValue("1500", "compact")).toMatch(/1,5\s?k/);
});

it("dit pourquoi le type Valeur ne montre pas un résultat", () => {
  expect(chartProblem("value", 1, { metrics: ["a"], dimensions: [] })).toBeNull();
  expect(chartProblem("value", 2, { metrics: ["a"], dimensions: [] })).toMatch(/ne montre qu'un résultat/);
  expect(chartProblem("value", 1, shape)).toMatch(/ne montre qu'un résultat/);
  expect(chartProblem("bars", 9, shape)).toBeNull();
});

it("dessine des barres : catégories, séries, valeur absente jamais zéro, annonces", () => {
  const drawn = drawChart(rows.slice(1, 3), shape, style(), SKIFER_CLAIR, {});
  expect(series(drawn.option)[0]).toMatchObject({ name: "revenue", type: "bar", data: ["2", null] });
  expect(drawn.items.map((item) => item.announcement)).toEqual(["Nord : 2", "Sud : —"]);
  expect(drawn.description).toBe("Barres de revenue : 2 lignes. Les valeurs exactes figurent dans le tableau.");
  expect(drawChart(rows.slice(0, 1), shape, style(), SKIFER_CLAIR, {}).description).toContain("1 ligne.");
  expect(drawn.option).toHaveProperty("legend.show", false);
});

it("une ligne, plusieurs métriques et une légende demandée ou automatique", () => {
  const two = { metrics: ["revenue", "orders"], dimensions: ["region"] };
  const line = drawChart(rows, two, style({ chart: "line", numberFormat: "integer" }), SKIFER_CLAIR, {});
  expect(series(line.option).map((one) => one.type)).toEqual(["line", "line"]);
  expect(series(line.option)[0]).toHaveProperty("lineStyle");
  expect(line.option).toHaveProperty("legend.show", true);
  expect(line.items[0]?.announcement).toBe("Nord · revenue : 13");
  expect(line.description).toMatch(/^Ligne de revenue, orders/);
  const hidden = drawChart(rows, two, style({ legend: "hidden" }), SKIFER_CLAIR, {});
  expect(hidden.option).toHaveProperty("legend.show", false);
  expect(drawChart(rows, shape, style({ legend: "shown" }), SKIFER_CLAIR, {}).option).toHaveProperty("legend.show", true);
  const yAxis = (drawChart(rows, shape, style({ numberFormat: "decimal_1" }), SKIFER_CLAIR, {}).option as { yAxis: { axisLabel: { formatter: (value: number) => string } } }).yAxis;
  expect(yAxis.axisLabel.formatter(5)).toMatch(/5,0/);
  const plain = (drawChart(rows, shape, style(), SKIFER_CLAIR, {}).option as { yAxis: { axisLabel: { formatter: (value: number) => string } } }).yAxis;
  expect(plain.axisLabel.formatter(5)).toBe("5");
});

it("regroupe les barres sur la dernière dimension, et retombe sur des barres simples avec une seule", () => {
  const two = { metrics: ["revenue"], dimensions: ["region", "channel"] };
  const grouped = drawChart(rows, two, style({ chart: "grouped_bars" }), SKIFER_CLAIR, {});
  expect(series(grouped.option).map((one) => one.name)).toEqual(["Web · revenue", "Magasin · revenue"]);
  expect(series(grouped.option)[0]?.data).toEqual(["12.5", null]);
  expect(series(grouped.option)[1]?.data).toEqual(["2", null]);
  expect(grouped.items).toHaveLength(4);
  expect(grouped.description).toMatch(/^Barres groupées/);
  const single = drawChart(rows, shape, style({ chart: "grouped_bars" }), SKIFER_CLAIR, {});
  expect(series(single.option)).toHaveLength(1);
  expect(single.description).toMatch(/^Barres de/);
  const none = drawChart([{ revenue: "1" }], { metrics: ["revenue"], dimensions: [] }, style(), SKIFER_CLAIR, {});
  expect(none.items[0]?.announcement).toBe("Ligne 1 : 1");
});

it("pose un seuil sur la première série, et le type Valeur le dit en texte", () => {
  const threshold = { value: 5, label: "Cible" };
  const bars = drawChart(rows, shape, style({ threshold }), SKIFER_CLAIR, {});
  expect(series(bars.option)[0]).toHaveProperty("markLine");
  const two = drawChart(rows, { metrics: ["revenue", "orders"], dimensions: ["region"] }, style({ threshold }), SKIFER_CLAIR, {});
  expect(series(two.option)[1]).not.toHaveProperty("markLine");
  const value = drawChart([rows[0] as (typeof rows)[number]], { metrics: ["revenue", "orders"], dimensions: [] }, style({ chart: "value", numberFormat: "integer", threshold }), SKIFER_CLAIR, {});
  const texts = (value.option as { graphic: { style: { text: string } }[] }).graphic.map((one) => one.style.text);
  expect(texts).toEqual(["revenue : 13", "orders : 3", "Seuil Cible : 5"]);
  expect(value.items.map((item) => item.announcement)).toEqual(["revenue : 13", "orders : 3"]);
  const absent = drawChart([{ revenue: "—" }], { metrics: ["revenue"], dimensions: [] }, style({ chart: "value" }), SKIFER_CLAIR, {});
  expect(absent.items[0]?.announcement).toBe("revenue : —");
  const empty = drawChart([], { metrics: ["revenue"], dimensions: [] }, style({ chart: "value" }), SKIFER_CLAIR, {});
  expect(empty.items[0]?.announcement).toBe("revenue : —");
  expect((empty.option as { graphic: unknown[] }).graphic).toHaveLength(1);
});

it("l'infobulle Valeur et définition dit la définition, ou son absence, et échappe le texte", () => {
  const drawn = drawChart(rows, shape, style({ tooltip: "value_and_definition" }), SKIFER_CLAIR, { revenue: "Montant <b>" });
  const formatter = (drawn.option as { tooltip: { formatter: (params: object) => string } }).tooltip.formatter;
  expect(formatter({ seriesName: "revenue", name: "Nord", value: "12.5" })).toBe("Nord · revenue : 12.5<br/>Montant &lt;b&gt;");
  expect(formatter({ seriesName: "inconnue", name: "A&B", value: 3 })).toBe("A&amp;B · inconnue : —<br/>Définition indisponible");
  expect(formatter({})).toBe(" ·  : —<br/>Définition indisponible");
  expect((drawChart(rows, shape, style(), SKIFER_CLAIR, {}).option as { tooltip: object }).tooltip).not.toHaveProperty("formatter");
});

it("une catégorie sans dimension se numérote, et une valeur de regroupement absente se dit absente", () => {
  const plain = drawChart([{ revenue: "1" }, { revenue: "2" }], { metrics: ["revenue"], dimensions: [] }, style(), SKIFER_CLAIR, {});
  expect((plain.option as { xAxis: { data: string[] } }).xAxis.data).toEqual(["Ligne 1", "Ligne 2"]);
  const grouped = drawChart([{ region: "Nord", revenue: "1" }], { metrics: ["revenue"], dimensions: ["region", "channel"] }, style({ chart: "grouped_bars" }), SKIFER_CLAIR, {});
  expect(series(grouped.option).map((one) => one.name)).toEqual(["— · revenue"]);
});

it("une valeur de dimension absente du résultat se dit absente", () => {
  const drawn = drawChart([{ revenue: "1" }], { metrics: ["revenue"], dimensions: ["region"] }, style(), SKIFER_CLAIR, {});
  expect((drawn.option as { xAxis: { data: string[] } }).xAxis.data).toEqual(["—"]);
});
