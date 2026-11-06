import type { Table } from "apache-arrow";
import type { ChartTheme } from "../charts/theme";
import type { ExecutionInput } from "../executions/client";
import { ERROR_LABELS } from "../executions/labels";
import type { Execution } from "../executions/model";
import { REFUSAL_LABELS, type AdminOutcome } from "../spaces/admin";
import type { Fetch } from "../spaces/api";
import { Card } from "../ui/Card";
import { ProvenanceResultat } from "./ProvenanceResultat";
import { Resultat } from "./Resultat";
import type { ExplorerGenre as Genre } from "../analyses/chart";
import type { ExplorerModel } from "./model";
import "./etat-resultat.css";

interface Props {
  run: Execution | null;
  result: Table | null;
  submitted: { input: ExecutionInput; model: ExplorerModel } | null;
  busy: boolean;
  failure: Exclude<AdminOutcome<unknown>, { status: "ok" }> | null;
  theme: ChartTheme;
  fetcher?: Fetch | undefined;
  /** Genre à montrer d'abord et rappel du genre montré : l'analyse ouverte, puis la sauvegarde (plan 18, 18.5b). */
  depart?: Genre | undefined;
  onGenre?: ((genre: Genre) => void) | undefined;
}
export function EtatResultat({ run, result, submitted, busy, failure, theme, fetcher, depart, onGenre }: Props) {
  const attente = failure === null && submitted !== null && (run === null ? busy : run.state === "queued" || run.state === "running" || (run.state === "succeeded" && result === null));
  return <div aria-live="polite">
    {failure === null ? null : <div className="sb-banner sb-banner--danger"><div>Exécution indisponible : {failure.status === "refused" ? REFUSAL_LABELS[failure.code] : failure.message}{run === null ? null : ` · Exécution : ${run.id}`}</div></div>}
    {attente ? <Card title="Résultat"><div className="sb-resultat-chargement" aria-busy="true"><p>Chargement du résultat… {run?.canCancel ? "L'exécution peut être annulée." : null}{run?.cancelRequested ? " Annulation demandée, en attente de confirmation." : null}</p><div aria-hidden="true"><span /><span /><span /></div></div></Card> : null}
    {run?.state === "denied" ? <div className="sb-banner sb-banner--danger"><div>Décision : {run.errorCode === "deny" ? "DENY · accès refusé" : "REQUIRE_HUMAN · validation humaine requise"}. Raisons détaillées non fournies par le serveur. Exécution : {run.id}.</div></div> : null}
    {run !== null && ["failed", "timed_out", "cancelled"].includes(run.state) && run.errorCode !== null ? <div className="sb-banner sb-banner--danger"><div>{ERROR_LABELS[run.errorCode]} · Exécution : {run.id}.</div></div> : null}
    {run?.state === "succeeded" && result !== null && submitted !== null ? <>
      {run.truncated ? <div className="sb-banner sb-banner--warning"><div>Résultat partiel : limite de la source ou de l'aperçu atteinte. Limites de l'aperçu : 1 000 lignes et 1 048 576 octets ; le serveur ne précise pas laquelle a été atteinte.</div></div> : null}
      {result.numRows === 0 ? <Card title="Résultat"><p>Aucune ligne pour ce contexte.</p><p>Filtres actifs :</p>{submitted.input.filters.length === 0 ? <p>Aucun filtre d'exploration.</p> : <ul>{submitted.input.filters.map((filter, index) => <li key={index}>{filter.column} · {filter.operator} · {Array.isArray(filter.value) ? filter.value.join(", ") : String(filter.value)}</li>)}</ul>}</Card> : <Resultat key={run.id} table={result} input={submitted.input} model={submitted.model} theme={theme} context={{ run, fetcher: fetcher ?? fetch }} depart={depart} onGenre={onGenre} />}
      {run.proof === null ? null : <ProvenanceResultat run={{ ...run, proof: run.proof }} />}
    </> : null}
  </div>;
}
