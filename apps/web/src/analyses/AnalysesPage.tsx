import { useState } from "react";
import { SKIFER_CLAIR, type ChartTheme } from "../charts/theme";
import { formatInstant } from "../format/date";
import { ThemeSwitch } from "../prototype/ThemeSwitch";
import { routeHash } from "../shell/route";
import { Reading } from "../spaces/AdminParts";
import type { Fetch } from "../spaces/api";
import type { Space } from "../spaces/model";
import { Badge } from "../ui/Badge";
import { Banner } from "../ui/Banner";
import { Card } from "../ui/Card";
import { useOutcome } from "../ui/useOutcome";
import { fetchAnalyses } from "./client";
import { Unavailable } from "./Failure";
import { LIST_STATE_LABELS, VISIBILITY_LABELS } from "./labels";
import type { AnalysisListItem } from "./model";
import "./analyses.css";

interface Props { space: Space; fetcher: Fetch }

/** Liste des analyses de l'espace, en deux sections qui ne se recouvrent pas (plan 18, A9). */
export function AnalysesPage({ space, fetcher }: Props) {
  const [theme, setTheme] = useState<ChartTheme>(SKIFER_CLAIR);
  const [reload, setReload] = useState(0);
  const list = useOutcome(`${space.id}:analyses:${String(reload)}`, (signal) => fetchAnalyses(space.id, signal, fetcher));
  const explorer = routeHash({ page: "explorer", space: space.id });
  return <div className={`sb-analyses sb-theme-${theme.id}`}>
    <div className="sb-page-head">
      <div><h1 className="sb-page-head__title">Analyses</h1><p className="sb-page-head__lead">{space.name} · explorations sauvegardées et versionnées dans le dépôt de contenus.</p></div>
      <ThemeSwitch value={theme} onChange={setTheme} />
    </div>
    <p className="sb-analyses__bar">
      <a className="sb-button sb-button--primary" href={explorer}>Nouvelle exploration</a>
      <button type="button" className="sb-button" onClick={() => { setReload((value) => value + 1); }}>Actualiser</button>
    </p>
    {list.status === "loading" ? <Reading>Lecture des analyses…</Reading>
      : list.status !== "ok" ? <Unavailable outcome={list} title="Analyses indisponibles" local="Les analyses ne sont pas disponibles en mode local." />
      : <>
        {list.value.unreadable === 0 ? null : <Banner tone="warning">{list.value.unreadable === 1 ? "Une de vos analyses n'a pas pu être relue et n'est pas listée." : `${String(list.value.unreadable)} de vos analyses n'ont pas pu être relues et ne sont pas listées.`} Rien n'est affiché à sa place.</Banner>}
        {list.value.analyses.length === 0
          // Vide avec des analyses illisibles : l'avertissement dit déjà ce qui manque, « aucune analyse » serait faux.
          ? list.value.unreadable > 0 ? null : <Card title="Aucune analyse à afficher pour vous dans cet espace"><p>Aucune analyse de cet espace ne vous est visible : il n'y en a pas encore, ou aucune ne vous est ouverte. Composez une requête dans l'Explorateur, puis sauvegardez-la comme analyse.</p><p><a href={explorer}>Ouvrir l'Explorateur</a></p></Card>
          : <>
            <p className="sb-analyses__note">L'état de résolution des références (« non vérifiée », « référence non résolue ») ne se lit que sur la fiche : la liste ne dit que l'état de l'index.</p>
            <Section title="Mes analyses" empty={list.value.unreadable > 0 ? "Aucune de vos analyses ne peut être affichée : voir l'avertissement ci-dessus." : "Vous n'avez enregistré aucune analyse."} rows={list.value.analyses.filter((item) => item.isOwner)} space={space.id} />
            <Section title="Partagées" empty="Personne d'autre n'a partagé d'analyse." rows={list.value.analyses.filter((item) => !item.isOwner)} space={space.id} />
          </>}
      </>}
  </div>;
}

function Section({ title, empty, rows, space }: { title: string; empty: string; rows: readonly AnalysisListItem[]; space: string }) {
  return <Card title={`${title} · ${String(rows.length)}`}>
    {rows.length === 0 ? <p className="sb-members__state">{empty}</p> : <div className="sb-table-wrap" role="group" aria-label={title} tabIndex={0}>
      <table className="sb-table sb-analyses__table">
        <caption className="sb-visually-hidden">{title}</caption>
        <thead><tr>
          <th scope="col">Nom</th><th scope="col">Propriétaire</th><th scope="col">Visibilité</th><th scope="col">Révision</th>
          <th scope="col">Dernière modification</th><th scope="col">Modèle</th><th scope="col">État</th>
        </tr></thead>
        <tbody>{rows.map((item) => <Row key={item.id} item={item} space={space} />)}</tbody>
      </table>
    </div>}
  </Card>;
}

function Row({ item, space }: { item: AnalysisListItem; space: string }) {
  const state = LIST_STATE_LABELS[item.state];
  return <tr>
    <th scope="row"><a href={routeHash({ page: "analysis", space, id: item.id })}>{item.name}</a><small className="sb-analyses__sub">{item.metrics.join(", ")}</small></th>
    <td>{item.isOwner ? "Vous" : item.owner.subject}<small className="sb-analyses__sub sb-mono">{item.owner.issuer}</small></td>
    <td>{VISIBILITY_LABELS[item.visibility]}</td>
    <td className="sb-mono">r{item.revision}<small className="sb-analyses__sub">commit {item.commit.slice(0, 8)}</small></td>
    <td>{formatInstant(item.committedAt)}</td>
    <td className="sb-mono">{item.model}</td>
    <td><Badge tone={state.tone}>{state.label}</Badge><small className="sb-analyses__sub">{state.reason}</small></td>
  </tr>;
}
