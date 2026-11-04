import { DataTable } from "../charts/DataTable";
import { formatNumber } from "../format/number";
import { Card } from "../ui/Card";
import type { BenchResult } from "./bench";

interface BenchReportProps {
  results: readonly BenchResult[];
  /** Navigateur et machine, pour situer les chiffres. */
  environment: string;
}

const decimal = (value: string | number | null): string => (typeof value === "number" ? formatNumber(value, 1) : "non mesurée");

/** Rapport de mesure : tableau lisible et JSON brut, que la décision 0001 reprend. */
export function BenchReport({ results, environment }: BenchReportProps) {
  return (
    <main className="sb-shell__content">
      <h1 className="sb-page-head__title">Mesure du rendu graphique</h1>
      <p>{environment}</p>
      <Card title="Résultats">
        <DataTable
          caption="Temps de rendu et mémoire par configuration"
          rowKey="cle"
          columns={[
            { key: "chart", label: "Graphique" },
            { key: "points", label: "Points", numeric: true },
            { key: "tiles", label: "Tuiles", numeric: true },
            { key: "renderer", label: "Rendu" },
            { key: "totalMs", label: "Total (ms)", numeric: true, format: decimal },
            { key: "perTileMs", label: "Par tuile (ms)", numeric: true, format: decimal },
            { key: "heapMb", label: "Mémoire (Mo)", numeric: true, format: decimal },
          ]}
          rows={results.map((result) => ({ ...result, cle: `${result.chart}-${result.points}-${result.tiles}-${result.renderer}` }))}
        />
      </Card>
      <pre id="bench-results" className="sb-mono">
        {JSON.stringify({ environment, results })}
      </pre>
    </main>
  );
}
