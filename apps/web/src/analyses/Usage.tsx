import { formatInstant } from "../format/date";
import { Reading } from "../spaces/AdminParts";
import type { Fetch } from "../spaces/api";
import { useOutcome } from "../ui/useOutcome";
import { fetchUsage } from "./client";
import { Unavailable } from "./Failure";
import { USAGE_LABELS } from "./labels";
import { USAGE_KINDS } from "./model";

/** Comptes d'événements durables par sorte : ni personne, ni valeur de filtre (plan 18, A8). */
export function OngletUsage({ space, id, fetcher }: { space: string; id: string; fetcher: Fetch }) {
  const usage = useOutcome(`${space}:${id}:usage`, (signal) => fetchUsage(space, id, signal, fetcher));
  if (usage.status === "loading") return <Reading>Lecture de l'usage…</Reading>;
  if (usage.status !== "ok") return <Unavailable outcome={usage} title="Usage indisponible" local="Les analyses ne sont pas disponibles en mode local." />;
  return <>
    <p className="sb-members__state">Événements durables, tous lecteurs confondus : le serveur ne dit ni qui, ni avec quelles valeurs.</p>
    <div className="sb-table-wrap" role="group" aria-label="Usage de l'analyse" tabIndex={0}>
      <table className="sb-table sb-analyses__table">
        <caption className="sb-visually-hidden">Usage de l'analyse</caption>
        <thead><tr><th scope="col">Sorte</th><th scope="col">Total</th><th scope="col">30 derniers jours</th><th scope="col">Dernier événement</th></tr></thead>
        <tbody>{USAGE_KINDS.map((kind) => {
          const count = usage.value[kind];
          return <tr key={kind}><th scope="row">{USAGE_LABELS[kind]}</th><td className="sb-num">{count.total}</td><td className="sb-num">{count.last30Days}</td><td>{count.lastAt === null ? "Aucun" : formatInstant(count.lastAt)}</td></tr>;
        })}</tbody>
      </table>
    </div>
  </>;
}
