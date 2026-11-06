import { useState } from "react";
import { formatInstant } from "../format/date";
import { routeHash } from "../shell/route";
import { Reading } from "../spaces/AdminParts";
import type { Fetch } from "../spaces/api";
import { useOutcome } from "../ui/useOutcome";
import { fetchDiff, fetchHistory } from "./client";
import { Unavailable } from "./Failure";
import { ACTION_LABELS, CHANGE_LABELS } from "./labels";
import type { Change, HistoryEntry } from "./model";

interface Props { space: string; id: string; /** Écart demandé par l'adresse : lancé tout seul si les deux révisions sont lisibles. */ compare?: { base: number; other: number } | undefined; fetcher: Fetch }

/** Historique immuable, puis écart structurel entre deux révisions lisibles. Une révision masquée n'a que son numéro. */
export function OngletRevisions({ space, id, compare, fetcher }: Props) {
  const history = useOutcome(`${space}:${id}:historique`, (signal) => fetchHistory(space, id, signal, fetcher));
  if (history.status === "loading") return <Reading>Lecture de l'historique…</Reading>;
  if (history.status !== "ok") return <Unavailable outcome={history} title="Historique indisponible" local="Les analyses ne sont pas disponibles en mode local." />;
  // Une suppression garde le numéro de la dernière sauvegarde : un numéro n'est proposé qu'une fois.
  const readable = [...new Set(history.value.revisions.filter((entry) => entry.available).map((entry) => entry.revision))];
  // Une comparaison demandée dont une révision n'existe pas ou n'est pas lisible pour la session n'est pas devinée : on le dit, on garde le comportement par défaut.
  const missing = compare === undefined ? [] : [compare.base, compare.other].filter((number) => !readable.includes(number));
  const requested = compare !== undefined && missing.length === 0 ? compare : undefined;
  return <>
    {compare === undefined || requested !== undefined ? null : <p className="sb-members__state" role="status">La comparaison demandée entre r{compare.base} et r{compare.other} n'est pas lancée : {[...new Set(missing)].map((number) => `r${String(number)}`).join(" et ")} {new Set(missing).size === 1 ? "n'existe pas ou n'est pas lisible" : "n'existent pas ou ne sont pas lisibles"} pour votre session.</p>}
    <ol className="sb-analyses__history" aria-label="Historique des révisions">
      {history.value.revisions.map((entry) => <li key={`${String(entry.revision)}:${entry.available ? entry.action : "masquee"}`}><Entry entry={entry} space={space} id={id} /></li>)}
    </ol>
    <Compare space={space} id={id} readable={readable} requested={requested} fetcher={fetcher} />
  </>;
}

function Entry({ entry, space, id }: { entry: HistoryEntry; space: string; id: string }) {
  if (!entry.available) return <span><strong className="sb-mono">r{entry.revision}</strong> · révision non disponible</span>;
  return <span>
    <strong className="sb-mono">r{entry.revision}</strong> · {ACTION_LABELS[entry.action]} · {entry.actor.subject} <span className="sb-mono">({entry.actor.issuer})</span> · {formatInstant(entry.committedAt)} · commit <span className="sb-mono">{entry.commit.slice(0, 12)}</span>
    {entry.action === "save" ? <> · <a href={routeHash({ page: "analysis", space, id, revision: entry.revision })}>Lire la révision {entry.revision}</a></> : null}
  </span>;
}

function Compare({ space, id, readable, requested, fetcher }: { space: string; id: string; readable: readonly number[]; requested: { base: number; other: number } | undefined; fetcher: Fetch }) {
  const [base, setBase] = useState(requested?.base ?? readable[0]);
  const [other, setOther] = useState(requested?.other ?? readable.at(-1));
  const [asked, setAsked] = useState<{ base: number; other: number } | null>(requested ?? null);
  // La garde ne vaut que sans comparaison demandée : une révision lisible se compare à elle-même, et le serveur sait le faire.
  if ((requested === undefined && readable.length < 2) || base === undefined || other === undefined) return <p className="sb-members__state">Il faut deux révisions disponibles pour en comparer.</p>;
  return <div className="sb-analyses__compare">
    <h3>Écart entre deux révisions</h3>
    <form className="sb-executions__form" onSubmit={(event) => { event.preventDefault(); setAsked({ base, other }); }}>
      <label className="sb-field">Révision de base<select className="sb-input" value={base} onChange={(event) => { setBase(Number(event.target.value)); setAsked(null); }}>{readable.map((number) => <option key={number} value={number}>r{number}</option>)}</select></label>
      <label className="sb-field">Révision comparée<select className="sb-input" value={other} onChange={(event) => { setOther(Number(event.target.value)); setAsked(null); }}>{readable.map((number) => <option key={number} value={number}>r{number}</option>)}</select></label>
      <button type="submit" className="sb-button">Comparer</button>
    </form>
    {asked === null ? null : <Diff key={`${String(asked.base)}:${String(asked.other)}`} space={space} id={id} base={asked.base} other={asked.other} fetcher={fetcher} />}
  </div>;
}

function Diff({ space, id, base, other, fetcher }: { space: string; id: string; base: number; other: number; fetcher: Fetch }) {
  const diff = useOutcome(`${space}:${id}:${String(base)}:${String(other)}`, (signal) => fetchDiff(space, id, base, other, signal, fetcher));
  if (diff.status === "loading") return <Reading>Lecture de l'écart…</Reading>;
  if (diff.status !== "ok") return <Unavailable outcome={diff} title="Écart indisponible" local="Les analyses ne sont pas disponibles en mode local." />;
  if (diff.value.changes.length === 0) return <p className="sb-members__state">Aucune différence structurelle entre r{base} et r{other}.</p>;
  return <div className="sb-table-wrap" role="group" aria-label={`Écart entre r${String(base)} et r${String(other)}`} tabIndex={0}>
    <table className="sb-table sb-analyses__table">
      <caption className="sb-visually-hidden">Écart entre r{base} et r{other}</caption>
      <thead><tr><th scope="col">Chemin</th><th scope="col">Nature</th><th scope="col">Avant (r{base})</th><th scope="col">Après (r{other})</th></tr></thead>
      <tbody>{diff.value.changes.map((change) => <tr key={change.path}>
        <th scope="row" className="sb-mono">{change.path}</th><td>{CHANGE_LABELS[change.kind]}</td>
        <td className="sb-mono">{side(change, "before")}</td><td className="sb-mono">{side(change, "after")}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

/** Valeur d'un côté de l'écart ; le côté sans champ (ajouté, retiré) n'a rien à montrer. */
function side(change: Change, which: "before" | "after"): string {
  if ((which === "before" && change.kind === "added") || (which === "after" && change.kind === "removed")) return "—";
  return JSON.stringify(change[which]);
}
