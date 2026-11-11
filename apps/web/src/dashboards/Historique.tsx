import { useState } from "react";
import { Unavailable } from "../analyses/Failure";
import { ACTION_LABELS } from "../analyses/labels";
import { SKIFER_CLAIR, type ChartTheme } from "../charts/theme";
import { formatInstant } from "../format/date";
import { ThemeSwitch } from "../prototype/ThemeSwitch";
import { routeHash } from "../shell/route";
import { Reading } from "../spaces/AdminParts";
import type { Fetch } from "../spaces/api";
import { useOutcome } from "../ui/useOutcome";
import { fetchDashboardDiff, fetchDashboardHistory } from "./client";
import type { DashboardChange } from "./model";
import "./dashboards.css";

const NATURE: Readonly<Record<DashboardChange["kind"], string>> = { added: "Ajouté", removed: "Retiré", modified: "Modifié", moved: "Déplacé" };
const coupures = (value: string) => value.split(/([/,:])/).map((part, index) => <span key={index}>{part}{/[/,:]/.test(part) ? <wbr /> : null}</span>);

/** L'écart vient de la route et du décodeur : aucun calcul de différence dans l'écran. */
export function DashboardDiffView({ space, id, base, other, fetcher }: { space: string; id: string; base: number; other: number; fetcher: Fetch }) {
  const diff = useOutcome(`${space}:${id}:${String(base)}:${String(other)}:diff`, (signal) => fetchDashboardDiff(space, id, base, other, signal, fetcher));
  if (diff.status === "loading") return <Reading>Lecture de l'écart…</Reading>;
  if (diff.status !== "ok") return <Unavailable outcome={diff} title="Écart indisponible" local="Écart indisponible en mode local." />;
  if (diff.value.changes.length === 0) return <p>Aucune différence structurelle.</p>;
  return <div className="sb-table-wrap sb-dashboard-diff" role="group" aria-label={`Écart entre r${String(base)} et r${String(other)}`} tabIndex={0}>
    <table className="sb-table"><caption>Écart entre r{base} et r{other}</caption>
      <thead><tr><th scope="col">Nature</th><th scope="col">Nœud</th><th scope="col">Chemin</th><th scope="col">Avant</th><th scope="col">Après</th></tr></thead>
      <tbody>{diff.value.changes.map((change, index) => <tr key={`${change.path}:${change.kind}:${String(index)}`}>
        <td>{NATURE[change.kind]}</td><td>{change.node}{change.id === null ? "" : ` · ${change.id}`}</td><th scope="row">{coupures(change.path)}</th>
        <td>{change.before === null ? "—" : coupures(JSON.stringify(change.before))}</td><td>{change.after === null ? "—" : coupures(JSON.stringify(change.after))}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function HistoriqueDashboard({ space, id, compare, fetcher }: { space: string; id: string; compare?: { base: number; other: number } | undefined; fetcher: Fetch }) {
  const [theme, setTheme] = useState<ChartTheme>(SKIFER_CLAIR);
  const history = useOutcome(`${space}:${id}:historique`, (signal) => fetchDashboardHistory(space, id, signal, fetcher));
  return <div className={`sb-dashboards sb-theme-${theme.id}`}>
    <div className="sb-page-head"><h1>Historique du dashboard</h1><ThemeSwitch value={theme} onChange={setTheme} /></div>
    <p><a href={routeHash({ page: "dashboard", space, id })}>Retour au dashboard</a></p>
    {history.status === "loading" ? <Reading>Lecture de l'historique…</Reading> : history.status !== "ok" ? <Unavailable outcome={history} title="Historique indisponible" local="Historique indisponible en mode local." /> : <>
      <ol aria-label="Historique des révisions">{history.value.revisions.map((entry, index) => <li key={`${String(entry.revision)}:${String(index)}`}>
        <strong>r{entry.revision}</strong>{entry.available ? <> · {ACTION_LABELS[entry.action]} · {entry.actor.subject} · {formatInstant(entry.committedAt)} · commit {entry.commit.slice(0, 12)}{entry.action === "save" ? <> · <a href={routeHash({ page: "dashboard", space, id, revision: entry.revision })}>Lire la révision {entry.revision}</a></> : null}</> : " · révision non disponible"}
      </li>)}</ol>
      <Comparaison space={space} id={id} readable={[...new Set(history.value.revisions.filter((entry) => entry.available && entry.action === "save").map((entry) => entry.revision))]} requested={compare} fetcher={fetcher} />
    </>}
  </div>;
}

function Comparaison({ space, id, readable, requested, fetcher }: { space: string; id: string; readable: readonly number[]; requested: { base: number; other: number } | undefined; fetcher: Fetch }) {
  const valid = requested !== undefined && readable.includes(requested.base) && readable.includes(requested.other);
  const [base, setBase] = useState(valid ? requested.base : readable[0]);
  const [other, setOther] = useState(valid ? requested.other : readable.at(-1));
  const [asked, setAsked] = useState<{ base: number; other: number } | null>(valid ? requested : null);
  if (base === undefined || other === undefined || (requested === undefined && readable.length < 2)) return <p>Il faut deux révisions disponibles pour en comparer.</p>;
  return <section aria-label="Comparer les révisions">
    {requested !== undefined && !valid ? <p role="status">La comparaison demandée n'est pas disponible pour votre session.</p> : null}
    <h2>Comparer les révisions</h2>
    <form onSubmit={(event) => { event.preventDefault(); setAsked({ base, other }); }}>
      <label className="sb-field">Révision de base<select value={base} onChange={(event) => { setBase(Number(event.target.value)); setAsked(null); }}>{readable.map((n) => <option key={n} value={n}>r{n}</option>)}</select></label>
      <label className="sb-field">Révision comparée<select value={other} onChange={(event) => { setOther(Number(event.target.value)); setAsked(null); }}>{readable.map((n) => <option key={n} value={n}>r{n}</option>)}</select></label>
      <button type="submit" className="sb-button">Comparer</button>
    </form>
    {asked === null ? null : <DashboardDiffView key={`${String(asked.base)}:${String(asked.other)}`} space={space} id={id} base={asked.base} other={asked.other} fetcher={fetcher} />}
  </section>;
}
