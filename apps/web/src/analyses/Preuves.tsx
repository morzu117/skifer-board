import { ERROR_LABELS, STATE_LABELS, STATE_TONES } from "../executions/labels";
import type { Execution } from "../executions/model";
import { ProvenanceResultat } from "../explorer/ProvenanceResultat";
import { formatInstant } from "../format/date";
import { routeHash } from "../shell/route";
import { Reading } from "../spaces/AdminParts";
import type { Fetch } from "../spaces/api";
import { Badge } from "../ui/Badge";
import { Banner } from "../ui/Banner";
import { useOutcome } from "../ui/useOutcome";
import { fetchLastExecution } from "./client";
import { Unavailable } from "./Failure";

/** Décisions de politique que le serveur refuse de laisser passer : elles se disent telles quelles, jamais comme un échec ordinaire. */
const DECISIONS = { deny: "DENY", require_human: "REQUIRE_HUMAN" } as const;

/**
 * Preuves de votre dernière exécution depuis l'analyse, toutes révisions confondues (plan 18, A8 et 18.3b) : celle de la
 * session seulement, jamais celle d'une autre personne. `shown` est la révision que la fiche affiche, pour dire quand
 * l'exécution vient d'une autre.
 */
export function OngletPreuves({ space, id, shown, fetcher }: { space: string; id: string; shown: number; fetcher: Fetch }) {
  const last = useOutcome(`${space}:${id}:derniere-execution`, (signal) => fetchLastExecution(space, id, signal, fetcher));
  if (last.status === "loading") return <Reading>Lecture de la dernière exécution…</Reading>;
  if (last.status !== "ok") return <Unavailable outcome={last} title="Dernière exécution indisponible" local="Les analyses ne sont pas disponibles en mode local." />;
  if (last.value.last === null) return <p className="sb-members__state">Aucune exécution de votre part depuis cette analyse.</p>;
  const { revision, execution } = last.value.last;
  return <>
    <p className="sb-members__state">Votre dernière exécution depuis cette analyse, toutes révisions confondues. Celle d'une autre personne ne se lit jamais ici.</p>
    {revision === shown ? null : <Banner tone="neutral">Cette exécution vient de la révision {revision} ; vous lisez la révision {shown}.</Banner>}
    <LastRun execution={execution} revision={revision} space={space} />
    {execution.proof === null ? null : <ProvenanceResultat run={{ ...execution, proof: execution.proof }} />}
  </>;
}

function LastRun({ execution, revision, space }: { execution: Execution; revision: number; space: string }) {
  const code = execution.errorCode;
  const decision = execution.state === "denied" && (code === "deny" || code === "require_human") ? code : null;
  return <>
    {decision === null ? null : <Banner tone="danger">Décision : {DECISIONS[decision]} · {ERROR_LABELS[decision]}. Aucun résultat n'a été produit.</Banner>}
    <dl className="sb-analyses__facts">
      <dt>Révision exécutée</dt><dd className="sb-mono">r{revision}</dd>
      <dt>État</dt><dd><Badge tone={STATE_TONES[execution.state]}>{STATE_LABELS[execution.state]}</Badge></dd>
      <dt>Instant</dt><dd>{formatInstant(execution.createdAt)}</dd>
      <dt>Identifiant d'exécution</dt><dd className="sb-mono">{execution.id} · {execution.connection} · {execution.environment}</dd>
      {code === null || decision !== null ? null : <><dt>Raison</dt><dd>{ERROR_LABELS[code]}</dd></>}
      {execution.truncated === true ? <><dt>Résultat</dt><dd>Partiel : limite de la source ou de l'aperçu atteinte.</dd></> : null}
    </dl>
    <p><a href={routeHash({ page: "executions", space })}>Retrouver l'exécution dans le centre d'exécutions</a></p>
  </>;
}
