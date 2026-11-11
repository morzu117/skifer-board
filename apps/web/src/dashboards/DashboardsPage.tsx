import { useState } from "react";

import { Unavailable } from "../analyses/Failure";
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
import { fetchDashboards } from "./client";
import { LIST_STATE_LABELS, VISIBILITY_LABELS } from "./labels";
import type { DashboardListItem } from "./model";
import { NouveauDashboard } from "./NouveauDashboard";
import "./dashboards.css";

interface Props { space: Space; fetcher: Fetch }

/** Liste des dashboards de l'espace, en deux sections qui ne se recouvrent pas : les vôtres et ceux que d'autres partagent (plan 19, 19.5a). */
export function DashboardsPage({ space, fetcher }: Props) {
  const [theme, setTheme] = useState<ChartTheme>(SKIFER_CLAIR);
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);
  const list = useOutcome(`${space.id}:dashboards:${String(reload)}`, (signal) => fetchDashboards(space.id, signal, fetcher));
  return <div className={`sb-dashboards sb-theme-${theme.id}`}>
    <div className="sb-page-head">
      <div><h1 className="sb-page-head__title">Dashboards</h1><p className="sb-page-head__lead">{space.name} · compositions d'analyses épinglées, versionnées dans le dépôt de contenus.</p></div>
      <ThemeSwitch value={theme} onChange={setTheme} />
    </div>
    <p className="sb-dashboards__bar">
      <button type="button" className="sb-button sb-button--primary" onClick={() => { setCreating(true); }}>Nouveau dashboard</button>
      <button type="button" className="sb-button" onClick={() => { setReload((value) => value + 1); }}>Actualiser</button>
    </p>
    {list.status === "loading" ? <Reading>Lecture des dashboards…</Reading>
      : list.status !== "ok" ? <Unavailable outcome={list} title="Dashboards indisponibles" local="Les dashboards ne sont pas disponibles en mode local." />
      : <>
        {list.value.unreadable === 0 ? null : <Banner tone="warning">{list.value.unreadable === 1 ? "Un de vos dashboards n'a pas pu être relu et n'est pas listé." : `${String(list.value.unreadable)} de vos dashboards n'ont pas pu être relus et ne sont pas listés.`} Rien n'est affiché à sa place.</Banner>}
        {list.value.dashboards.length === 0
          // Vide avec des dashboards illisibles : l'avertissement dit déjà ce qui manque, « aucun dashboard » serait faux.
          ? list.value.unreadable > 0 ? null : <Card title="Aucun dashboard à afficher pour vous dans cet espace"><p>Aucun dashboard de cet espace ne vous est visible : il n'y en a pas encore, ou aucun ne vous est ouvert. Créez-en un, puis épinglez-y des analyses sauvegardées.</p></Card>
          : <>
            <p className="sb-dashboards__note">L'état de résolution des tuiles (« non vérifiée », « référence non résolue ») ne se lit qu'à l'ouverture : la liste ne dit que l'état de l'index.</p>
            <Section title="Mes dashboards" empty={list.value.unreadable > 0 ? "Aucun de vos dashboards ne peut être affiché : voir l'avertissement ci-dessus." : "Vous n'avez créé aucun dashboard."} rows={list.value.dashboards.filter((item) => item.isOwner)} space={space.id} />
            <Section title="Partagés" empty="Personne d'autre n'a partagé de dashboard." rows={list.value.dashboards.filter((item) => !item.isOwner)} space={space.id} />
          </>}
      </>}
    {creating ? <NouveauDashboard space={space.id} fetcher={fetcher} onClose={() => { setCreating(false); }} /> : null}
  </div>;
}

function Section({ title, empty, rows, space }: { title: string; empty: string; rows: readonly DashboardListItem[]; space: string }) {
  return <Card title={`${title} · ${String(rows.length)}`}>
    {rows.length === 0 ? <p className="sb-members__state">{empty}</p> : <div className="sb-table-wrap" role="group" aria-label={title} tabIndex={0}>
      <table className="sb-table sb-dashboards__table">
        <caption className="sb-visually-hidden">{title}</caption>
        <thead><tr>
          <th scope="col">Nom</th><th scope="col">Propriétaire</th><th scope="col">Visibilité</th><th scope="col">Révision</th>
          <th scope="col">Dernière modification</th><th scope="col">État</th>
        </tr></thead>
        <tbody>{rows.map((item) => <Row key={item.id} item={item} space={space} />)}</tbody>
      </table>
    </div>}
  </Card>;
}

function Row({ item, space }: { item: DashboardListItem; space: string }) {
  const state = LIST_STATE_LABELS[item.state];
  return <tr>
    <th scope="row"><a href={routeHash({ page: "dashboard", space, id: item.id })}>{item.name}</a></th>
    <td>{item.isOwner ? "Vous" : item.owner.subject}<small className="sb-dashboards__sub sb-mono">{item.owner.issuer}</small></td>
    <td>{VISIBILITY_LABELS[item.visibility]}</td>
    <td className="sb-mono">r{item.revision}<small className="sb-dashboards__sub">commit {item.commit.slice(0, 8)}</small></td>
    <td>{formatInstant(item.committedAt)}</td>
    <td><Badge tone={state.tone}>{state.label}</Badge><small className="sb-dashboards__sub">{state.reason}</small></td>
  </tr>;
}
