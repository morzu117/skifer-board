import { ThemeNavigation } from "./ContentListPage";
import { useState } from "react";
import { SKIFER_CLAIR, type ChartTheme } from "../charts/theme";
import { ThemeSwitch } from "../prototype/ThemeSwitch";
import { navigate, routeHash } from "../shell/route";
import { Reading } from "../spaces/AdminParts";
import type { Fetch } from "../spaces/api";
import type { Space } from "../spaces/model";
import { Badge } from "../ui/Badge";
import { Banner } from "../ui/Banner";
import { Card } from "../ui/Card";
import { useOutcome } from "../ui/useOutcome";
import { fetchThemeConsumers, fetchThemes } from "./client";
import type { ThemeListItem } from "./model";
import { INDEX_LABELS, refusalText } from "./labels";
import "../dashboards/dashboards.css";
import "./themes.css";

interface Props { space: Space; fetcher: Fetch }

/** Liste des révisions visibles ; les consommateurs sont lus indépendamment pour chaque ligne. */
export function ThemesPage({ space, fetcher }: Props) {
  const [theme, setTheme] = useState<ChartTheme>(SKIFER_CLAIR);
  const [reload, setReload] = useState(0);
  const list = useOutcome(`${space.id}:themes:${String(reload)}`, (signal) => fetchThemes(space.id, signal, fetcher));
  return <div className={`sb-dashboards sb-theme-${theme.id}`}>
    <ThemeNavigation space={space.id} active="themes" />
    <div className="sb-page-head"><div><h1 className="sb-page-head__title">Thèmes</h1><p className="sb-page-head__lead">{space.name} · thèmes de graphiques versionnés.</p></div><ThemeSwitch value={theme} onChange={setTheme} /></div>
    <p className="sb-dashboards__bar"><button type="button" className="sb-button sb-button--primary" onClick={() => { navigate({ page: "theme", space: space.id, id: "nouveau" }); }}>Nouveau thème</button><button type="button" className="sb-button" onClick={() => { setReload((value) => value + 1); }}>Actualiser</button></p>
    {list.status === "loading" ? <Reading>Lecture des thèmes…</Reading> : list.status !== "ok" ? <Banner tone="danger">Thèmes indisponibles : {list.status === "error" ? list.message : refusalText(list)}. Rien n'est affiché à leur place.</Banner> : <>
      {list.value.unreadable > 0 ? <Banner tone="warning">{String(list.value.unreadable)} thème(s) illisible(s) ne sont pas listés. Rien n'est affiché à leur place.</Banner> : null}
      {list.value.themes.length === 0 ? list.value.unreadable > 0 ? null : <Card title="Aucun thème à afficher"><p>{space.role === "admin" ? "Aucun thème, y compris les brouillons des autres créateurs, n'est visible dans cet espace." : "Aucun thème ne vous est visible dans cet espace."}</p></Card> : <Card title="Thèmes"><div className="sb-table-wrap" role="group" aria-label="Thèmes" tabIndex={0}><table className="sb-table sb-dashboards__table"><caption className="sb-visually-hidden">Thèmes</caption><thead><tr><th scope="col">Nom</th><th scope="col">Propriétaire</th><th scope="col">Révision</th><th scope="col">État</th><th scope="col">Index</th><th scope="col">Dashboards</th></tr></thead><tbody>{list.value.themes.map((item) => <Row key={`${item.id}:${String(reload)}`} item={item} space={space.id} fetcher={fetcher} />)}</tbody></table></div></Card>}
      <p className="sb-themes__note">La colonne par environnement viendra avec les releases (lot 09).</p>
    </>}
  </div>;
}

function Row({ item, space, fetcher }: { item: ThemeListItem; space: string; fetcher: Fetch }) {
  const consumers = useOutcome(`${space}:${item.id}:${String(item.revision)}`, (signal) => fetchThemeConsumers(space, item.id, signal, fetcher));
  return <tr><th scope="row"><a href={routeHash({ page: "theme", space, id: item.id })}>{item.name}</a></th><td>{item.owner.subject}<small className="sb-dashboards__sub sb-mono">{item.owner.issuer}</small></td><td>r{item.revision}<small className="sb-dashboards__sub">commit {item.commit.slice(0, 8)}</small></td><td><Badge tone={item.state === "approved" ? "success" : "neutral"}>{item.state === "approved" ? `Approuvé · r${String(item.approvedRevision)}` : "Brouillon"}</Badge>{item.state === "draft" && item.approvedRevision !== null ? <small className="sb-dashboards__sub">révision r{item.approvedRevision} approuvée, r{item.revision} en brouillon</small> : null}</td><td>{INDEX_LABELS[item.indexState]}</td><td>{consumers.status === "loading" ? "lecture…" : consumers.status === "ok" ? String(consumers.value.consumers.length + consumers.value.others) : `indisponible : ${consumers.status === "error" ? consumers.message : refusalText(consumers)}`}</td></tr>;
}
