/**
 * Les cinq cas du §6.3, chacun dans une tuile. Chaque cas reçoit le thème et n'en tire que
 * l'apparence : les valeurs viennent des résultats Arrow, jamais du thème (plan 02, W8).
 */
import { useMemo, useReducer } from "react";

import { ChartCard } from "../charts/ChartCard";
import { DataTable } from "../charts/DataTable";
import { reduceSelection, selectionTotalRequest } from "../charts/selection";
import { barsDescription, barsOption, categoryItems, categoryValues } from "../charts/specs/bars";
import { actualVsReference, combinedDescription, combinedOption, periodItems, type CombinedInput } from "../charts/specs/combined";
import { binsOf, cellItems, gridOf, heatmapDescription, heatmapOption } from "../charts/specs/heatmap";
import { sparklinePath } from "../charts/specs/sparkline";
import { bridgeSteps, stepItems, stepText, waterfallDescription, waterfallOption } from "../charts/specs/waterfall";
import type { ChartTheme } from "../charts/theme";
import { numberColumn, rowsOf } from "../data/arrow";
import { amountCell as money, monthCell as month } from "../format/cells";
import { deltaTone, formatAmount, formatDelta, formatNumber } from "../format/number";
import { Card } from "../ui/Card";
import { KpiTile } from "../ui/KpiTile";
import { actualVsBudget, kpiSnapshots, regionMonthRevenue, revenueBridge, revenueByRegion } from "./fixtures";
import { SelectionBar } from "./SelectionBar";
import "./prototype.css";

const amount = (value: number): string => formatAmount(value);

/** Pied de tuile : la provenance est dite, même pour des données de démonstration (RULES §1). */
function DemoProvenance() {
  return <span>Provenance : données de démonstration générées dans le navigateur, sans moteur</span>;
}

interface CaseProps {
  theme: ChartTheme;
}

/** Cas 1 — graphique combiné : réalisé en barres, budget en ligne, objectif en pointillé. */
export function CombinedCase({ theme }: CaseProps) {
  const table = useMemo(() => actualVsBudget(), []);
  const input: CombinedInput = useMemo(
    () => ({ data: actualVsReference(table, "mois", "realise", "budget"), actualLabel: "Réalisé", referenceLabel: "Budget", format: amount, threshold: { value: 3_500_000, label: `objectif ${amount(3_500_000)}` } }),
    [table],
  );
  const option = useMemo(() => combinedOption(input, theme), [input, theme]);
  return (
    <ChartCard
      title="Réalisé contre budget · CA net"
      description={combinedDescription(input)}
      option={option}
      items={periodItems(input)}
      source="realise-budget"
      exportBackground={theme.surface}
      table={{
        caption: "Réalisé et budget par mois",
        rowKey: "mois",
        columns: [
          { key: "mois", label: "Mois", format: month },
          { key: "realise", label: "Réalisé", numeric: true, format: money },
          { key: "budget", label: "Budget", numeric: true, format: money },
        ],
        rows: rowsOf(table, ["mois", "realise", "budget"]),
      }}
      footer={
        <>
          <span>Barres : réalisé · ligne : budget · pointillé : objectif</span>
          <DemoProvenance />
        </>
      }
    />
  );
}

/** Cas 2 — waterfall : du CA d'un trimestre au suivant par contributions signées. */
export function WaterfallCase({ theme }: CaseProps) {
  const steps = useMemo(() => bridgeSteps(revenueBridge(), "etape", "montant", "nature"), []);
  const option = useMemo(() => waterfallOption(steps, theme), [steps, theme]);
  return (
    <ChartCard
      title="Du CA T2 au CA T3"
      description={waterfallDescription("CA net", steps)}
      option={option}
      items={stepItems(steps)}
      source="pont-ca"
      exportBackground={theme.surface}
      table={{
        caption: "Étapes du passage du CA T2 au CA T3",
        rowKey: "etape",
        columns: [
          { key: "etape", label: "Étape" },
          { key: "valeur", label: "Montant", numeric: true },
        ],
        rows: steps.map((step) => ({ etape: step.label, valeur: stepText(step) })),
      }}
      footer={
        <>
          <span>Totaux en ardoise · hausses et baisses signées</span>
          <DemoProvenance />
        </>
      }
    />
  );
}

/** Cas 3 — heatmap région × mois, échelle quantifiée sur les paliers du thème. */
export function HeatmapCase({ theme }: CaseProps) {
  const table = useMemo(() => regionMonthRevenue(), []);
  const grid = useMemo(() => gridOf(table, "region", "mois", "ca_net"), [table]);
  const option = useMemo(() => heatmapOption(grid, theme, amount), [grid, theme]);
  const bins = binsOf(grid, theme);
  return (
    <ChartCard
      title="CA net par région et par mois"
      description={heatmapDescription("CA net", grid, amount)}
      option={option}
      items={cellItems(grid, amount)}
      source="ca-region-mois"
      exportBackground={theme.surface}
      height={340}
      table={{
        caption: "Valeurs de la carte de chaleur",
        rowKey: "cle",
        columns: [
          { key: "region", label: "Région" },
          { key: "mois", label: "Mois", format: month },
          { key: "ca_net", label: "CA net", numeric: true, format: money },
        ],
        rows: rowsOf(table, ["region", "mois", "ca_net"]).map((row) => ({ ...row, cle: `${String(row.region)}|${String(row.mois)}` })),
      }}
      footer={
        <>
          <ul className="sb-legend" aria-label="Légende de l'échelle">
            {bins.map((bin) => (
              <li key={bin.color}>
                <span className="sb-legend__swatch" style={{ background: bin.color }} aria-hidden="true" />
                <span className="sb-mono">
                  {amount(bin.from)} à {amount(bin.to)}
                </span>
              </li>
            ))}
          </ul>
          <DemoProvenance />
        </>
      }
    />
  );
}

/** Cas 4 — KPI enrichis : valeur, écart signé, tendance ; et une tuile refusée. */
export function KpiCase() {
  const snapshots = useMemo(() => kpiSnapshots(), []);
  return (
    <section className="sb-row-group" aria-label="Indicateurs">
      {snapshots.map((snapshot) => {
        const values = numberColumn(snapshot.trend, "valeur");
        const value = snapshot.unit === "amount" ? formatAmount(snapshot.value) : formatNumber(snapshot.value);
        return (
          <KpiTile
            key={snapshot.label}
            state="value"
            label={snapshot.label}
            value={value}
            delta={{ text: formatDelta(snapshot.delta, "percent"), tone: deltaTone(snapshot.delta), comparison: "contre août" }}
            trend={sparklinePath(values, 120, 32)}
          />
        );
      })}
      <KpiTile state="denied" label="Marge brute" guidance="Cette métrique n'est pas ouverte à votre profil. Demandez l'accès à l'administrateur de l'espace." />
    </section>
  );
}

/** Cas 5 — une sélection dans l'histogramme filtre le tableau voisin. */
export function SelectionCase({ theme }: CaseProps) {
  const table = useMemo(() => revenueByRegion(), []);
  const data = useMemo(() => categoryValues(table, "region", "ca_net"), [table]);
  const [selection, dispatch] = useReducer(reduceSelection, null);
  const selected = useMemo(() => selection?.keys ?? [], [selection]);
  const option = useMemo(() => barsOption({ data, selected, format: amount, horizontal: true }, theme), [data, selected, theme]);
  const rows = rowsOf(table, ["region", "ca_net", "commandes"]);
  const visible = selected.length === 0 ? rows : rows.filter((row) => selected.includes(String(row.region)));
  return (
    <>
      <div className="sb-row-group">
        <ChartCard
          title="CA net par région"
          description={barsDescription("CA net par région", data, selected, amount)}
          option={option}
          items={categoryItems(data, amount)}
          source="ca-region"
          dimension="region"
          onSelect={dispatch}
          exportBackground={theme.surface}
          height={380}
          table={{
            caption: "Valeurs de l'histogramme",
            rowKey: "region",
            selectedKeys: selected,
            columns: [
              { key: "region", label: "Région" },
              { key: "ca_net", label: "CA net", numeric: true, format: money },
            ],
            rows,
          }}
          footer={<DemoProvenance />}
        />
        <Card title="Détail des régions" className="sb-side-card">
          <p className="sb-kpi__guidance">{selected.length === 0 ? "Toutes les régions · sélectionnez des barres pour filtrer." : "Filtré par la sélection du graphique."}</p>
          <DataTable
            caption="Régions, CA net et commandes"
            rowKey="region"
            columns={[
              { key: "region", label: "Région" },
              { key: "ca_net", label: "CA net", numeric: true, format: money },
              { key: "commandes", label: "Commandes", numeric: true },
            ]}
            rows={visible}
          />
        </Card>
      </div>
      {selection === null ? null : (
        <SelectionBar
          selection={selection}
          noun={selection.keys.length > 1 ? "régions" : "région"}
          request={selectionTotalRequest(selection, "ca_net")}
          onClear={() => {
            dispatch({ type: "clear", source: "ca-region" });
          }}
        />
      )}
    </>
  );
}
