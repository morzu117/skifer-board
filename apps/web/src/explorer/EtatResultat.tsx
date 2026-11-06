import type { Table } from "apache-arrow";
import type { ChartTheme } from "../charts/theme";
import type { ExecutionInput } from "../executions/client";
import type { Execution, ExecutionError } from "../executions/model";
import { REFUSAL_LABELS, type AdminOutcome } from "../spaces/admin";
import type { Fetch } from "../spaces/api";
import { Card } from "../ui/Card";
import { ProvenanceResultat } from "./ProvenanceResultat";
import { Resultat } from "./Resultat";
import type { ExplorerModel } from "./model";
import "./etat-resultat.css";

const ERREURS: Record<ExecutionError, string> = {
  deny: "Accès refusé", require_human: "Validation humaine requise", cancelled: "Exécution annulée",
  execution_timed_out: "Délai d'exécution dépassé", execution_failed: "Échec de l'exécution",
  execution_lost: "Suivi de l'exécution perdu", invalid_upstream: "Réponse de la source invalide",
  connector_unavailable: "Connecteur ou source indisponible", engine_unavailable: "Moteur sémantique indisponible",
  evidence_invalid: "Preuve invalide", worker_unavailable: "Service d'exécution indisponible",
  server_restarted: "Serveur redémarré", credential_rejected: "Identifiant de connexion refusé ou expiré",
  redirect_refused: "Redirection de la source refusée", endpoint_not_configured: "Point d'accès non configuré",
  identity_unavailable: "Identité de connexion indisponible", vault_unavailable: "Coffre indisponible",
  credential_not_found: "Identifiant de connexion introuvable",
};
interface Props {
  run: Execution | null;
  result: Table | null;
  submitted: { input: ExecutionInput; model: ExplorerModel } | null;
  busy: boolean;
  failure: Exclude<AdminOutcome<unknown>, { status: "ok" }> | null;
  theme: ChartTheme;
  fetcher?: Fetch | undefined;
}
export function EtatResultat({ run, result, submitted, busy, failure, theme, fetcher }: Props) {
  const attente = failure === null && submitted !== null && (run === null ? busy : run.state === "queued" || run.state === "running" || (run.state === "succeeded" && result === null));
  return <div aria-live="polite">
    {failure === null ? null : <div className="sb-banner sb-banner--danger"><div>Exécution indisponible : {failure.status === "refused" ? REFUSAL_LABELS[failure.code] : failure.message}{run === null ? null : ` · Exécution : ${run.id}`}</div></div>}
    {attente ? <Card title="Résultat"><div className="sb-resultat-chargement" aria-busy="true"><p>Chargement du résultat… {run?.canCancel ? "L'exécution peut être annulée." : null}{run?.cancelRequested ? " Annulation demandée, en attente de confirmation." : null}</p><div aria-hidden="true"><span /><span /><span /></div></div></Card> : null}
    {run?.state === "denied" ? <div className="sb-banner sb-banner--danger"><div>Décision : {run.errorCode === "deny" ? "DENY · accès refusé" : "REQUIRE_HUMAN · validation humaine requise"}. Raisons détaillées non fournies par le serveur. Exécution : {run.id}.</div></div> : null}
    {run !== null && ["failed", "timed_out", "cancelled"].includes(run.state) && run.errorCode !== null ? <div className="sb-banner sb-banner--danger"><div>{ERREURS[run.errorCode]} · Exécution : {run.id}.</div></div> : null}
    {run?.state === "succeeded" && result !== null && submitted !== null ? <>
      {run.truncated ? <div className="sb-banner sb-banner--warning"><div>Résultat partiel : limite de la source ou de l'aperçu atteinte. Limites de l'aperçu : 1 000 lignes et 1 048 576 octets ; le serveur ne précise pas laquelle a été atteinte.</div></div> : null}
      {result.numRows === 0 ? <Card title="Résultat"><p>Aucune ligne pour ce contexte.</p><p>Filtres actifs :</p>{submitted.input.filters.length === 0 ? <p>Aucun filtre d'exploration.</p> : <ul>{submitted.input.filters.map((filter, index) => <li key={index}>{filter.column} · {filter.operator} · {Array.isArray(filter.value) ? filter.value.join(", ") : String(filter.value)}</li>)}</ul>}</Card> : <Resultat key={run.id} table={result} input={submitted.input} model={submitted.model} theme={theme} context={{ run, fetcher: fetcher ?? fetch }} />}
      {run.proof === null ? null : <ProvenanceResultat run={{ ...run, proof: run.proof }} />}
    </> : null}
  </div>;
}
