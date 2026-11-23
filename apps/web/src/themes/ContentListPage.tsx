import { useState } from "react";
import { SKIFER_CLAIR, type ChartTheme } from "../charts/theme";
import { fetchComponents, fetchComponentConsumers } from "../components-lib/client";
import { fetchPageTemplates } from "../page-templates/client";
import { ThemeSwitch } from "../prototype/ThemeSwitch";
import { routeHash } from "../shell/route";
import { Reading } from "../spaces/AdminParts";
import type { Fetch } from "../spaces/api";
import type { Space } from "../spaces/model";
import { Badge } from "../ui/Badge";
import { Banner } from "../ui/Banner";
import { Card } from "../ui/Card";
import { useOutcome } from "../ui/useOutcome";
import { INDEX_LABELS, REFUSAL_LABELS } from "./labels";
import type { ThemeListItem } from "./model";

export function ThemeNavigation({ space, active }: { space: string; active: "themes" | "modeles" | "composants" }) {
  return <nav className="sb-themes__navigation" aria-label="Bibliothèque de thèmes"><p className="sb-dashboards__bar">{([ ["themes", "Thèmes"], ["modeles", "Modèles de page"], ["composants", "Composants"] ] as const).map(([page, label]) => <a key={page} className="sb-button" href={routeHash({ page, space })} aria-current={active === page ? "page" : undefined}>{label}</a>)}</p></nav>;
}

export function refusalText(value: { code: string; reason?: string; required?: string; field?: string; parameter?: string; detail?: string }): string {
  const labels: Record<string, string> = { ...REFUSAL_LABELS, page_template_not_found: "Modèle introuvable", invalid_page_template: "Modèle invalide", component_not_found: "Composant introuvable", invalid_component: "Composant invalide", analysis_not_found: "Analyse introuvable", personal_reference: "Référence personnelle" };
  return [labels[value.code], value.reason, value.required, value.field, value.parameter, value.detail].filter((part) => part !== undefined).join(" · ");
}

export function ContentListPage({ space, fetcher, kind }: { space: Space; fetcher: Fetch; kind: "modeles" | "composants" }) {
  const [theme, setTheme] = useState<ChartTheme>(SKIFER_CLAIR);
  const [reload, setReload] = useState(0);
  const models = kind === "modeles";
  const title = models ? "Modèles de page" : "Composants";
  const singular = models ? "modèle de page" : "composant";
  const list = useOutcome(`${space.id}:${kind}:${String(reload)}`, async (signal) => {
    if (models) {
      const result = await fetchPageTemplates(space.id, signal, fetcher);
      return result.status === "ok" ? { status: "ok" as const, value: { items: result.value.pageTemplates, unreadable: result.value.unreadable } } : result;
    }
    const result = await fetchComponents(space.id, signal, fetcher);
    return result.status === "ok" ? { status: "ok" as const, value: { items: result.value.components, unreadable: result.value.unreadable } } : result;
  });
  return <div className={`sb-dashboards sb-theme-${theme.id}`}>
    <ThemeNavigation space={space.id} active={kind} />
    <div className="sb-page-head"><div><h1 className="sb-page-head__title">{title}</h1><p className="sb-page-head__lead">{space.name} · {title.toLowerCase()} versionnés.</p></div><ThemeSwitch value={theme} onChange={setTheme} /></div>
    <p className="sb-dashboards__bar"><button type="button" className="sb-button" onClick={() => { setReload((value) => value + 1); }}>Actualiser</button></p>
    {models ? <p className="sb-themes__note">Un modèle est copié à la création d'un dashboard ; aucun dashboard n'en dépend.</p> : null}
    {list.status === "loading" ? <Reading>Lecture des {title.toLowerCase()}…</Reading> : list.status !== "ok" ? <Banner tone="danger">{title} indisponibles : {list.status === "error" ? list.message : refusalText(list)}. Rien n'est affiché à leur place.</Banner> : <>
      {list.value.unreadable > 0 ? <Banner tone="warning">{String(list.value.unreadable)} {singular}(s) illisible(s) ne sont pas listés. Rien n'est affiché à leur place.</Banner> : null}
      {list.value.items.length === 0 ? list.value.unreadable > 0 ? null : <Card title={`Aucun ${singular} à afficher`}><p>{space.role === "admin" ? `Aucun ${singular}, y compris les brouillons des autres créateurs, n'est visible dans cet espace.` : `Aucun ${singular} ne vous est visible dans cet espace.`}</p></Card> : <Card title={title}><div className="sb-table-wrap" role="group" aria-label={title} tabIndex={0}><table className="sb-table sb-dashboards__table"><caption className="sb-visually-hidden">{title}</caption><thead><tr><th scope="col">Nom</th><th scope="col">Propriétaire</th><th scope="col">Révision</th><th scope="col">État</th><th scope="col">Index</th>{models ? null : <th scope="col">Dashboards</th>}</tr></thead><tbody>{list.value.items.map((item) => <Row key={`${item.id}:${String(reload)}`} item={item} space={space.id} fetcher={fetcher} kind={kind} />)}</tbody></table></div></Card>}
    </>}
  </div>;
}
function Row({ item, space, fetcher, kind }: { item: ThemeListItem; space: string; fetcher: Fetch; kind: "modeles" | "composants" }) {
  return <tr><th scope="row"><a href={routeHash({ page: kind === "modeles" ? "modele" : "composant", space, id: item.id })}>{item.name}</a></th><td>{item.owner.subject}<small className="sb-dashboards__sub sb-mono">{item.owner.issuer}</small></td><td>r{item.revision}<small className="sb-dashboards__sub">commit {item.commit.slice(0, 8)}</small></td><td><Badge tone={item.state === "approved" ? "success" : "neutral"}>{item.state === "approved" ? `Approuvé · r${String(item.approvedRevision)}` : "Brouillon"}</Badge>{item.state === "draft" && item.approvedRevision !== null ? <small className="sb-dashboards__sub">révision r{item.approvedRevision} approuvée, r{item.revision} en brouillon</small> : null}</td><td>{INDEX_LABELS[item.indexState]}</td>{kind === "composants" ? <Consumers space={space} item={item} fetcher={fetcher} /> : null}</tr>;
}
function Consumers({ space, item, fetcher }: { space: string; item: ThemeListItem; fetcher: Fetch }) {
  const consumers = useOutcome(`${space}:${item.id}:${String(item.revision)}`, (signal) => fetchComponentConsumers(space, item.id, signal, fetcher));
  return <td>{consumers.status === "loading" ? "lecture…" : consumers.status === "ok" ? String(consumers.value.consumers.length + consumers.value.others) : `indisponible : ${consumers.status === "error" ? consumers.message : refusalText(consumers)}`}</td>;
}
