import type { Table } from "apache-arrow";
import { useMemo, type ReactNode } from "react";

import type { AnalysisRevision } from "../../analyses/model";
import { ChartCard } from "../../charts/ChartCard";
import { DataTable } from "../../charts/DataTable";
import type { ChartTheme } from "../../charts/theme";
import { ERROR_LABELS } from "../../executions/labels";
import type { Execution } from "../../executions/model";
import { ProvenanceResultat } from "../../explorer/ProvenanceResultat";
import { RefusExecution } from "../../explorer/EtatResultat";
import { cellules } from "../../explorer/Resultat";
import { ResultatPartiel } from "../../explorer/ResultatPartiel";
import type { ExplorerModel } from "../../explorer/model";
import { MISSING } from "../../format/number";
import { refusalText } from "../../spaces/AdminParts";
import { Badge } from "../../ui/Badge";
import { Banner } from "../../ui/Banner";
import { KpiTile } from "../../ui/KpiTile";
import type { Defaults, ExecutableComponent } from "../document";
import { TILE_REASON_LABELS } from "../labels";
import { effective, styleOf, titleOf } from "./presentation";
import { chartProblem, drawChart, formatValue, type Cells, type Shape } from "./tileChart";
import { OutcomeError, type TileState } from "./useTiles";

interface Props {
  component: ExecutableComponent;
  state: TileState | undefined;
  /** L'analyse épinglée, quand elle a pu être lue. */
  pinned: AnalysisRevision | undefined;
  defaults: Defaults;
  catalog: readonly ExplorerModel[] | null;
  theme: ChartTheme;
  onCancel?: () => void;
  onRetry?: () => void;
  onRestart?: () => void;
}

/** Pourquoi une exécution a échoué : le refus du serveur ou le message réseau, ou le code que l'exécution porte. */
function failureText(error: unknown, execution: Execution | undefined): string {
  if (error instanceof OutcomeError) return error.outcome.status === "refused" ? refusalText(error.outcome) : error.outcome.message;
  if (execution?.errorCode != null) return ERROR_LABELS[execution.errorCode];
  return "Échec de l'exécution.";
}

/**
 * Une tuile exécutée de l'éditeur (plan 19, 19.5a) : visuel ou KPI d'une analyse épinglée. Chaque état du planificateur a son
 * texte (§0.2) : rien n'est caché ni remplacé, un refus du moteur (DENY, REQUIRE_HUMAN) s'affiche tel quel sans nouvel essai, une
 * tuile indisponible dit sa raison sans qu'aucune exécution soit lancée, et tout résultat affiché porte sa provenance (§0.3).
 * La présentation (type, légende, format, seuil, infobulle) n'agit que sur l'affichage : la requête soumise est celle de l'analyse.
 */
export function Tuile({ component, state, pinned, defaults, catalog, theme, onCancel, onRetry, onRestart }: Props) {
  const found = useMemo(() => (pinned === undefined ? undefined : effective(component, pinned, defaults)), [component, pinned, defaults]);
  const title = found === undefined ? (component.presentation.title ?? (component.type === "kpi" ? "KPI épinglé" : "Visuel épinglé")) : titleOf(found);
  const head = <h3 className="sb-tile__title">{title}</h3>;
  const status = state?.status ?? "reading";
  if (status === "reading") return <div className="sb-tile" role="group" aria-label={title}>{head}<p role="status" aria-busy="true" className="sb-tile__state">{state?.status === "reading" && state.source === "catalog" ? "Lecture du catalogue…" : "Lecture de l'analyse épinglée…"}</p></div>;
  if (state?.status === "unreadable") {
    const { outcome } = state;
    return <div className="sb-tile" role="group" aria-label={title}>{head}<Banner tone="danger">{state.source === "catalog" ? "Catalogue illisible" : "Analyse épinglée illisible"} : {outcome.status === "refused" ? refusalText(outcome) : outcome.message} Aucune exécution n'est lancée.</Banner>{state.source === "catalog" ? null : <button type="button" className="sb-button" onClick={onRetry}>Réessayer</button>}</div>;
  }
  if (state?.status === "waiting") return <div className="sb-tile" role="group" aria-label={title}>{head}<p role="status" className="sb-tile__state">En attente d'une place : quatre exécutions au plus tournent en même temps.</p></div>;
  if (state?.status === "running") return <div className="sb-tile" role="group" aria-label={title}>{head}<p role="status" aria-busy="true" className="sb-tile__state">Exécution en cours…</p><button type="button" className="sb-button" onClick={onCancel}>Annuler l’exécution</button></div>;
  if (state?.status === "cancelled") return <div className="sb-tile" role="group" aria-label={title}>{head}<p role="status" className="sb-tile__state">Exécution annulée : aucun résultat.</p><button type="button" className="sb-button" onClick={onRestart}>Relancer</button></div>;
  if (state?.status === "unavailable") {
    return <div className="sb-tile" role="group" aria-label={title}>{head}
      <p className="sb-tile__state"><Badge tone="warning">Indisponible</Badge></p>
      <p className="sb-tile__state">{TILE_REASON_LABELS[state.reason]}</p>
      <p className="sb-tile__state">Aucune exécution n'a été lancée pour cette tuile.</p>
    </div>;
  }
  if (state?.status === "denied") {
    return <div className="sb-tile" role="group" aria-label={title}>{head}
      <RefusExecution run={state.execution} decision={state.decision} />
    </div>;
  }
  if (state?.status === "error") {
    return <div className="sb-tile" role="group" aria-label={title}>{head}
      <Banner tone="danger">Échec de la tuile : {failureText(state.error, state.execution)}{state.execution === undefined ? "" : ` Exécution ${state.execution.id}.`} Rien n'est affiché à la place.</Banner>
    </div>;
  }
  const { execution, result } = state as Extract<TileState, { status: "success" | "empty" }>;
  const proof = execution.proof;
  if (proof === null) {
    return <div className="sb-tile" role="group" aria-label={title}>{head}<Banner tone="danger">Le résultat n'est pas affiché : la provenance (preuve, empreinte SQL) est absente de la réponse.</Banner></div>;
  }
  const proven = execution as Execution & { proof: NonNullable<Execution["proof"]> };
  // Un résultat tronqué ne se donne jamais pour complet (§0.2) : le bandeau accompagne le visuel, le KPI et l'état vide.
  const partial = execution.truncated === true ? <ResultatPartiel dashboard /> : null;
  const style = styleOf(found as NonNullable<typeof found>);
  const query = (pinned as AnalysisRevision).analysis.query;
  const shape: Shape = { metrics: query.metrics, dimensions: query.dimensions };
  if (state?.status === "empty") {
    return <div className="sb-tile" role="group" aria-label={title}>{head}
      {partial}
      <p role="status" className="sb-tile__state">Aucune ligne pour ce contexte.{proof.filters.length === 0 ? "" : ` Filtres appliqués : ${proof.filters.map((filter) => `${filter.column} ${filter.operator} ${filter.value ?? "sans valeur"}`).join(" ; ")}.`}</p>
      <ProvenanceResultat run={proven} label={`Provenance · ${title}`} />
    </div>;
  }
  return <Result title={title} result={result} shape={shape} style={style} component={component} model={catalog?.find((model) => model.name === query.model)} theme={theme} execution={proven} partial={partial} />;
}

function tableOf(result: Table, rows: readonly Cells[], caption: string) {
  return { caption, columns: result.schema.fields.map((field) => ({ key: field.name, label: field.name })), rows, rowKey: "__ligne" };
}

interface ResultProps {
  title: string;
  result: Table;
  shape: Shape;
  style: ReturnType<typeof styleOf>;
  component: ExecutableComponent;
  model: ExplorerModel | undefined;
  theme: ChartTheme;
  execution: Execution & { proof: NonNullable<Execution["proof"]> };
  /** Bandeau du résultat partiel, ou `null`. */
  partial: ReactNode;
}

/** Résultat d'une exécution réussie : valeur d'un KPI, ou graphique et tableau d'un visuel, avec sa provenance. */
function Result({ title, result, shape, style, component, model, theme, execution, partial }: ResultProps) {
  const rows = useMemo(() => cellules(result), [result]);
  const table = tableOf(result, rows, `Valeurs de ${title}`);
  const footer = <ProvenanceResultat run={execution} label={`Provenance · ${title}`} />;
  const problem = component.type === "kpi" ? (rows.length === 1 ? null : `Un KPI montre une seule valeur : le résultat compte ${String(rows.length)} lignes.`) : chartProblem(style.chart, rows.length, shape);
  const limit = style.threshold === undefined ? null : <p className="sb-tile__state">Seuil {style.threshold.label} : {style.threshold.value}</p>;
  if (problem !== null) {
    return <div className="sb-tile" role="group" aria-label={title}><h3 className="sb-tile__title">{title}</h3>
      {partial}
      <Banner tone="warning">Affichage impossible : {problem} Le tableau des valeurs exactes reste affiché.</Banner>
      <DataTable {...table} />{footer}
    </div>;
  }
  if (component.type === "kpi") {
    const metric = shape.metrics[0] as string;
    const first = rows[0] as Cells;
    const text = first[metric] ?? MISSING;
    return <div className="sb-tile" role="group" aria-label={title}>
      {partial}
      <KpiTile state="value" label={title} value={text === MISSING ? MISSING : formatValue(text, style.numberFormat)} />
      {shape.metrics.length > 1 ? <><p className="sb-tile__state">La requête rend {String(shape.metrics.length)} métriques : seule la première, {metric}, est mise en valeur ; toutes figurent dans le tableau.</p><DataTable {...table} /></> : null}
      {limit}{footer}
    </div>;
  }
  const definitions = Object.fromEntries((model?.metrics ?? []).map((metric) => [metric.name, metric.description]));
  const drawn = drawChart(rows, shape, style, theme, definitions);
  return <ChartCard title={title} description={drawn.description} option={drawn.option} table={table} items={drawn.items} source={`tuile-${component.id}`} exportBackground={theme.surface} height={220} footer={<>{partial}{footer}</>} />;
}
