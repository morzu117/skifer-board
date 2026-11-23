import { HistoryEntries } from "../shared-content/ContentPage";
import { routeHash } from "../shell/route";
import { Reading } from "../spaces/AdminParts";
import type { Fetch } from "../spaces/api";
import { Banner } from "../ui/Banner";
import { useOutcome } from "../ui/useOutcome";
import { fetchThemeHistory } from "./client";
import { refusalText } from "./labels";

export function HistoriqueTheme({ space, id, fetcher }: { space: string; id: string; fetcher: Fetch }) {
  const history = useOutcome(`${space}:${id}:historique`, (signal) => fetchThemeHistory(space, id, signal, fetcher));
  return <div className="sb-dashboards sb-theme-skifer-clair"><h1>Historique du thème</h1>
    <p><a href={routeHash({ page: "theme", space, id })}>Retour au thème</a></p>
    {history.status === "loading" ? <Reading>Lecture de l'historique…</Reading> : history.status !== "ok" ? <Banner tone="danger">Historique indisponible : {history.status === "error" ? history.message : refusalText(history)}. Rien n'est affiché à sa place.</Banner> : <HistoryEntries history={history.value} link={(revision) => routeHash({ page: "theme", space, id, revision })} />}
  </div>;
}
