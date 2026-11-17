import { ACTION_LABELS } from "../analyses/labels";
import { formatInstant } from "../format/date";
import { routeHash } from "../shell/route";
import { Reading } from "../spaces/AdminParts";
import type { Fetch } from "../spaces/api";
import { Banner } from "../ui/Banner";
import { useOutcome } from "../ui/useOutcome";
import { fetchThemeHistory } from "./client";
import { themeRefusalText } from "./labels";

export function HistoriqueTheme({ space, id, fetcher }: { space: string; id: string; fetcher: Fetch }) {
  const history = useOutcome(`${space}:${id}:historique`, (signal) => fetchThemeHistory(space, id, signal, fetcher));
  return <div className="sb-dashboards sb-theme-skifer-clair"><h1>Historique du thème</h1>
    <p><a href={routeHash({ page: "theme", space, id })}>Retour au thème</a></p>
    {history.status === "loading" ? <Reading>Lecture de l'historique…</Reading> : history.status !== "ok" ? <Banner tone="danger">Historique indisponible : {history.status === "error" ? history.message : themeRefusalText(history)}. Rien n'est affiché à sa place.</Banner> : <ol aria-label="Historique des révisions">{history.value.revisions.map((entry, index) => <li key={`${String(entry.revision)}:${String(index)}`}><strong>r{entry.revision}</strong> · {ACTION_LABELS[entry.action]} · {entry.actor.subject} · {formatInstant(entry.committedAt)} · commit {entry.commit.slice(0, 12)}{entry.action === "save" ? <> · <a href={routeHash({ page: "theme", space, id, revision: entry.revision })}>Lire la révision {entry.revision}</a></> : null}</li>)}</ol>}
  </div>;
}
