import { DataType, type Table } from "apache-arrow";
import { useEffect, useId, useMemo, useState } from "react";
import { ChartCard } from "../charts/ChartCard";
import { barsOption } from "../charts/specs/bars";
import { baseOption, categoryAxis, narrowMedia, valueAxis, type ChartTheme } from "../charts/theme";
import type { ChartOption } from "../charts/echarts";
import type { Execution } from "../executions/model";
import type { Fetch } from "../spaces/api";
import { texteTemporel } from "./temps";
import { selectionChargee } from "./selection";
import { CalculSelection } from "./CalculSelection";
import type { ExecutionInput } from "../executions/client";
import type { ExplorerModel } from "./model";

type Genre = "valeur" | "barres" | "ligne" | "groupees";
const LIBELLES: Record<Genre, string> = { valeur: "Valeur", barres: "Barres", ligne: "Ligne", groupees: "Barres groupées" };

/** Décimal Arrow : l'entier signé est mis à l'échelle sans conversion flottante. */
export function texteDecimal(entier: string, scale: number): string {
  const negatif = entier.startsWith("-");
  const chiffres = negatif ? entier.slice(1) : entier;
  if (scale <= 0) return `${entier}${"0".repeat(-scale)}`;
  const complet = chiffres.padStart(scale + 1, "0");
  return `${negatif ? "-" : ""}${complet.slice(0, -scale)}.${complet.slice(-scale)}`;
}

export function genreInitial(input: ExecutionInput, model: ExplorerModel): Genre {
  if (input.dimensions.length === 0) return "valeur";
  if (input.dimensions.length > 1) return "groupees";
  return model.dimensions.find((item) => item.name === input.dimensions[0])?.is_time === true ? "ligne" : "barres";
}

function cellules(table: Table): Record<string, string>[] {
  const columns = table.schema.fields.map((field) => ({ field, vector: table.getChild(field.name) }));
  return Array.from({ length: table.numRows }, (_, index) => Object.fromEntries([
    ["__ligne", String(index)],
    ...columns.map(({ field, vector }): [string, string] => {
      if (vector === null || !vector.isValid(index)) return [field.name, "—"];
      if (DataType.isDate(field.type) || DataType.isTimestamp(field.type)) {
        const donnees = vector.slice(index, index + 1).data[0]?.values as Int32Array | BigInt64Array;
        return [field.name, texteTemporel(BigInt(donnees[0] as number | bigint), field.type)];
      }
      const value: unknown = vector.get(index);
      if (DataType.isDecimal(field.type)) return [field.name, texteDecimal((value as Uint32Array).toString(), field.type.scale)];
      return [field.name, typeof value === "string" || typeof value === "number" || typeof value === "bigint" || typeof value === "boolean" ? String(value) : "Valeur complexe"];
    }),
  ]));
}

/** `depart` : genre à montrer d'abord (celui d'une analyse ouverte) ; `onGenre` rend le genre montré, pour le sauvegarder (plan 18, 18.5b). */
export function Resultat({ table, input, model, theme, context, depart, onGenre }: { table: Table; input: ExecutionInput; model: ExplorerModel; theme: ChartTheme; context?: { run: Execution; fetcher: Fetch } | undefined; depart?: Genre | undefined; onGenre?: ((genre: Genre) => void) | undefined }) {
  const [selection, setSelection] = useState<ReadonlySet<number>>(() => new Set());
  const toggle = (key: string) => { const index = Number(key); setSelection((previous) => { const suivant = new Set(previous); if (suivant.has(index)) suivant.delete(index); else suivant.add(index); return suivant; }); };
  const lignes = useMemo(() => Array.from({ length: table.numRows }, (_, index) => Object.fromEntries(input.dimensions.map((dimension) => {
    const vector = table.getChild(dimension);
    // Ne pas appeler l'accesseur temporel Arrow : il convertit en flottant et peut
    // rejeter une époque hors de la plage des entiers JavaScript sûrs.
    let valeur: unknown;
    if (vector !== null && vector.isValid(index) && (DataType.isDate(vector.type) || DataType.isTimestamp(vector.type))) {
      const donnees = vector.slice(index, index + 1).data[0]?.values as Int32Array | BigInt64Array | undefined;
      valeur = donnees?.[0];
    } else {
      valeur = vector?.get(index);
    }
    if (valeur !== null && valeur !== undefined && vector !== null && DataType.isDecimal(vector.type)) return [dimension, { type: "decimal" }];
    if (typeof valeur === "bigint") return [dimension, valeur >= -(2n ** 53n) && valeur <= 2n ** 53n ? Number(valeur) : valeur];
    return [dimension, valeur];
  }))), [table, input.dimensions]);
  const couverte = selection.size === 0 ? null : selectionChargee(lignes, input.dimensions, selection);
  const initial = genreInitial(input, model);
  const repli = initial === "valeur" && table.numRows > 1 ? "barres" : initial;
  const [choix, setGenre] = useState<Genre>(() => depart ?? repli);
  const raisonValeur = useId();
  const genre = choix === "valeur" && table.numRows > 1 ? repli : choix;
  if (genre !== choix) setGenre(genre);
  useEffect(() => { onGenre?.(genre); }, [genre, onGenre]);
  const rows = cellules(table);
  const metric = input.metrics[0] as string;
  const categories = rows.map((row, index) => input.dimensions.map((name) => row[name]).join(" · ") || `Ligne ${String(index + 1)}`);
  // Les chaînes exactes sont transmises à ECharts ; aucune conversion Number n'est faite ici.
  const values = rows.map((row) => row[metric] === "—" ? null : row[metric]);
  const format = (value: number) => String(value);
  const groupes = input.dimensions.length > 1 ? input.dimensions.slice(0, -1) : input.dimensions;
  const dernier = input.dimensions.at(-1);
  const etiquettes = [...new Set(rows.map((row, index) => groupes.map((name) => row[name]).join(" · ") || `Ligne ${String(index + 1)}`))];
  const groupesValeurs = dernier === undefined ? [] : [...new Set(rows.map((row) => row[dernier]))];
  const indexBarre = (dataIndex: number, seriesIndex: number): string | null => {
    if (genre !== "groupees" || input.dimensions.length < 2) return rows[dataIndex] === undefined ? null : String(dataIndex);
    const groupe = groupesValeurs[Math.floor(seriesIndex / input.metrics.length)];
    const label = etiquettes[dataIndex];
    const index = rows.findIndex((row) => groupes.map((dim) => row[dim]).join(" · ") === label && dernier !== undefined && row[dernier] === groupe);
    return index < 0 ? null : String(index);
  };
  const styleBarre = (index: number | null, couleurNormale: string | undefined) => selection.size === 0 ? { color: couleurNormale } : index !== null && selection.has(index) ? { color: theme.selected } : { color: theme.unselectedFill, borderColor: theme.unselectedEdge, borderWidth: 1 };
  const series = genre === "groupees" && dernier !== undefined && input.dimensions.length > 1
    ? [...new Set(rows.map((row) => row[dernier]))].flatMap((groupe, index) => input.metrics.map((name) => ({
      name: `${groupe ?? "—"} · ${name}`, type: "bar" as const, itemStyle: { color: [theme.series, theme.secondary][index % 2] },
      data: etiquettes.map((label) => {
        const indexLigne = rows.findIndex((row) => groupes.map((dim) => row[dim]).join(" · ") === label && row[dernier] === groupe);
        return { value: rows[indexLigne]?.[name] ?? null, itemStyle: styleBarre(indexLigne < 0 ? null : indexLigne, [theme.series, theme.secondary][index % 2]) };
      }),
    })))
    : input.metrics.map((name) => ({ name, type: genre === "ligne" ? "line" as const : "bar" as const, data: rows.map((row) => row[name] === "—" ? null : row[name]), itemStyle: { color: theme.series } }));
  const axes = { ...baseOption(theme), xAxis: categoryAxis(theme, genre === "groupees" ? etiquettes : categories), yAxis: valueAxis(theme, format), grid: { left: 56, right: 16, top: 28, bottom: 28 } };
  const bars = {
    ...barsOption({ data: { categories, values: values.map(() => null) }, selected: [], format }, theme),
    tooltip: { show: false },
    series: input.metrics.map((name, index) => {
      const chiffres = rows.map((row) => row[name] === "—" ? null : row[name]);
      return { name, type: "bar" as const, data: chiffres.map((value, ligne) => ({ value, itemStyle: styleBarre(ligne, [theme.series, theme.secondary][index % 2]) })), label: { show: chiffres.length <= 40, position: "top" as const, formatter: ({ dataIndex }: { dataIndex: number }) => chiffres[dataIndex] as string } };
    }),
  };
  const optionLarge: ChartOption = genre === "valeur" ? { ...baseOption(theme), graphic: input.metrics.map((name, index) => ({ type: "text", left: "center", top: 20 + index * 40, style: { text: `${name} : ${rows[0]?.[name] ?? "—"}`, fill: theme.textStrong, font: `18px ${theme.fontMono}` } })) } : genre === "barres" ? bars : {
    ...axes,
    tooltip: { show: false },
    series,
  };
  // La largeur est celle de la tuile : sous 480 px, l'axe s'incline et les
  // étiquettes de barres sont retirées ; les valeurs exactes restent dans le tableau.
  const option: ChartOption = genre === "valeur" ? optionLarge : { ...optionLarge, media: narrowMedia(
    { grid: { bottom: 28 }, xAxis: { axisLabel: { rotate: 0 } }, series: (genre === "barres" ? bars.series : series).map(() => ({ label: { show: genre === "barres" && values.length <= 40 } })) },
    { grid: { bottom: 72 }, xAxis: { axisLabel: { rotate: 45 } }, series: (genre === "barres" ? bars.series : series).map(() => ({ label: { show: false } })) },
  ) };
  const items = genre === "groupees" && input.dimensions.length > 1
    ? groupesValeurs.flatMap((groupe, groupeIndex) => input.metrics.flatMap((nom, metricIndex) => etiquettes.flatMap((etiquette, dataIndex) => {
      const seriesIndex = groupeIndex * input.metrics.length + metricIndex;
      const key = indexBarre(dataIndex, seriesIndex);
      return key === null ? [] : [{ key, dataIndex, seriesIndex, announcement: `${etiquette} · ${groupe ?? "—"} · ${nom} : ${rows[Number(key)]?.[nom] ?? "—"}` }];
    })))
    : categories.map((category, index) => ({ key: String(index), announcement: `${category} : ${values[index] ?? "—"}` }));
  return <><ChartCard title="Résultat" description={`Résultat de l'exécution : ${LIBELLES[genre]}. Les valeurs exactes figurent dans le tableau.`} option={option}
    table={{ caption: "Valeurs du résultat", columns: table.schema.fields.map((field) => ({ key: field.name, label: field.name })), rows, rowKey: "__ligne", selectionDimensions: input.dimensions, selectedKeys: [...selection].map(String), onToggleRow: context === undefined ? undefined : toggle }}
    items={items} source="resultat" exportBackground={theme.surface}
    dimension={context !== undefined && (genre === "barres" || genre === "groupees") ? "ligne" : undefined}
    itemKey={(item) => indexBarre(item.dataIndex, item.seriesIndex)}
    onSelect={(event) => { if (event.type === "clear") setSelection(new Set()); else toggle(event.key); }}
    actions={<div className="sb-explorer__genre"><label className="sb-field">Type de graphique <select className="sb-input" value={genre} aria-describedby={table.numRows > 1 ? raisonValeur : undefined} onChange={(event) => { setGenre(event.target.value as Genre); }}>{(Object.keys(LIBELLES) as Genre[]).map((item) => <option key={item} value={item} disabled={item === "valeur" && table.numRows > 1}>{LIBELLES[item]}</option>)}</select></label>{table.numRows > 1 ? <small id={raisonValeur}>Valeur indisponible : le résultat contient plusieurs lignes.</small> : null}</div>}
    footer={couverte === null ? undefined : <section aria-label="Sélection personnelle" className="sb-explorer__selection"><h3>Sélection personnelle{context?.run.truncated ? " · sur le résultat chargé" : ""}</h3><button type="button" className="sb-button" onClick={() => { setSelection(new Set()); }}>Effacer la sélection</button>
      {couverte.status === "indisponible" ? <div className="sb-banner sb-banner--warning" role="status"><div>Total indisponible pour cette sélection : {couverte.raison} Le chiffre doit être demandé au moteur.</div></div> : context === undefined ? null : <CalculSelection key={`${context.run.id}:${JSON.stringify(couverte.selection)}`} run={context.run} selection={couverte.selection} fetcher={context.fetcher} />}</section>} />
  </>;
}
