import { useEffect, useRef, useState } from "react";
import { ACTION_LABELS } from "../analyses/labels";
import { SKIFER_CLAIR, type ChartTheme } from "../charts/theme";
import * as componentClient from "../components-lib/client";
import type { ComponentDocument } from "../components-lib/document";
import { formatInstant } from "../format/date";
import * as templateClient from "../page-templates/client";
import type { PageTemplate, TemplateNode, TemplateRow } from "../page-templates/document";
import { ThemeSwitch } from "../prototype/ThemeSwitch";
import { navigate, routeHash } from "../shell/route";
import { useExitGuard } from "../shell/useExitGuard";
import { Reading } from "../spaces/AdminParts";
import type { Fetch } from "../spaces/api";
import type { Space } from "../spaces/model";
import { refusalText, ThemeNavigation } from "../themes/ContentListPage";
import { CHART_LABELS, OPTION_LABELS } from "../themes/labels";
import type { ThemeChange, ThemeHistory } from "../themes/model";
import { Badge } from "../ui/Badge";
import { Banner } from "../ui/Banner";
import { Card } from "../ui/Card";
import { Dialog } from "../ui/Dialog";
import { useOutcome } from "../ui/useOutcome";
import "../themes/themes.css";
import "./content.css";

type Kind = "modele" | "composant";
type Doc = PageTemplate | ComponentDocument;
type Refusal = { status: "refused"; code: string; reason?: string; required?: string; field?: string; parameter?: string; detail?: string; consumers?: readonly { id: string }[]; others?: number };
type Failure = Refusal | { status: "error"; message: string };
type Result<T> = { status: "ok"; value: T } | Failure;
type Revision = { id: string; revision: number; state: "draft" | "approved"; approvedRevision: number | null; document: Doc };
const plural = (kind: Kind) => kind === "modele" ? "modeles" : "composants";
const noun = (kind: Kind) => kind === "modele" ? "modèle de page" : "composant";
const failureText = (failure: Failure) => failure.status === "error" ? failure.message : refusalText(failure);
function normalize(result: templateClient.PageTemplateOutcome<templateClient.ReadPageTemplate> | componentClient.ComponentOutcome<componentClient.ReadComponent>): Result<Revision> {
  if (result.status !== "ok") return result;
  const value = result.value;
  return { status: "ok", value: { ...value, document: "pageTemplate" in value ? value.pageTemplate : value.component } };
}
async function read(kind: Kind, space: string, id: string, revision: number | undefined, signal: AbortSignal, fetcher: Fetch): Promise<Result<Revision>> {
  return normalize(kind === "modele" ? revision === undefined ? await templateClient.fetchPageTemplate(space, id, signal, fetcher) : await templateClient.fetchPageTemplateRevision(space, id, revision, signal, fetcher) : revision === undefined ? await componentClient.fetchComponent(space, id, signal, fetcher) : await componentClient.fetchComponentRevision(space, id, revision, signal, fetcher));
}
export function ContentPage({ space, id, kind, fetcher, historical, view }: { space: Space; id: string; kind: Kind; fetcher: Fetch; historical?: number | undefined; view?: "history" | undefined }) {
  if (view === "history") return <History space={space.id} id={id} kind={kind} fetcher={fetcher} />;
  return <ReadContent space={space} id={id} kind={kind} fetcher={fetcher} historical={historical} />;
}
function ReadContent({ space, id, kind, fetcher, historical }: { space: Space; id: string; kind: Kind; fetcher: Fetch; historical?: number | undefined }) {
  const [reload, setReload] = useState(0);
  const loaded = useOutcome(`${space.id}:${kind}:${id}:${String(historical)}:${String(reload)}`, (signal) => read(kind, space.id, id, historical, signal, fetcher));
  return <div className="sb-dashboards sb-theme-skifer-clair">{loaded.status === "loading" ? <Reading>Lecture du {noun(kind)}…</Reading> : loaded.status !== "ok" ? <><Banner tone="danger">{noun(kind)} indisponible : {failureText(loaded)}. Rien n'est affiché à sa place.</Banner><a href={routeHash({ page: plural(kind), space: space.id })}>Retour à la liste</a></> : <Editor key={reload} space={space} kind={kind} value={loaded.value} historical={historical !== undefined} fetcher={fetcher} reload={() => { setReload((n) => n + 1); }} />}</div>;
}
function Editor({ space, kind, value, historical, fetcher, reload }: { space: Space; kind: Kind; value: Revision; historical: boolean; fetcher: Fetch; reload: () => void }) {
  const [server, setServer] = useState(value);
  const [name, setName] = useState(value.document.name);
  const [description, setDescription] = useState(value.document.description);
  const [theme, setTheme] = useState<ChartTheme>(SKIFER_CLAIR);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const dirty = name !== server.document.name || description !== server.document.description;
  const guard = useExitGuard(dirty && !historical && !deleted);
  useEffect(() => { if (deleted) navigate({ page: plural(kind), space: space.id }); }, [deleted, kind, space.id]);
  const save = () => {
    if (lock.current || !name.trim()) return;
    lock.current = true; setBusy(true); setFailure(null); setNotice(null);
    const draft = Object.fromEntries(Object.entries(server.document).filter(([key]) => !["api_version", "id", "owner"].includes(key)));
    const request = kind === "modele" ? templateClient.revisePageTemplate(space.id, server.id, { ...draft, name, description } as templateClient.PageTemplateDraft, server.revision, fetcher) : componentClient.reviseComponent(space.id, server.id, { ...draft, name, description } as componentClient.ComponentDraft, server.revision, fetcher);
    void request.then((result) => { lock.current = false; setBusy(false); const saved = normalize(result); if (saved.status !== "ok") { setFailure(saved); return; } setServer(saved.value); setName(saved.value.document.name); setDescription(saved.value.document.description); setNotice(`Révision r${String(saved.value.revision)} enregistrée en brouillon.`); });
  };
  const remove = () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setFailure(null);
    const request = kind === "modele" ? templateClient.deletePageTemplate(space.id, server.id, server.revision, fetcher) : componentClient.deleteComponent(space.id, server.id, server.revision, fetcher);
    void request.then((result) => { lock.current = false; setBusy(false); setConfirm(false); if (result.status !== "ok") { setFailure(result); return; } setDeleted(true); });
  };
  return <div className={`sb-dashboards sb-themes__editor sb-theme-${theme.id}`}>
    <ThemeNavigation space={space.id} active={plural(kind)} />
    <div className="sb-page-head"><div><h1 className="sb-page-head__title">Fiche du {noun(kind)}</h1><p><a href={routeHash({ page: plural(kind), space: space.id })}>Retour à la liste</a></p></div><ThemeSwitch value={theme} onChange={setTheme} /></div>
    <div className="sb-themes__meta"><p>Révision r{server.revision}{historical ? " en lecture seule" : ""}</p><Badge tone={server.state === "approved" ? "success" : "neutral"}>{server.state === "approved" ? `Approuvé r${String(server.approvedRevision)}` : "Brouillon"}</Badge><a href={routeHash({ page: kind, space: space.id, id: server.id, view: "history" })}>Historique des révisions</a></div>
    {confirm ? <Dialog title={`Supprimer le ${noun(kind)} ?`} onClose={() => { setConfirm(false); }}><p>Supprimer « {name} » ? Les modifications non enregistrées seront perdues.</p><button type="button" className="sb-button" data-autofocus onClick={() => { setConfirm(false); }}>Annuler</button> <button type="button" className="sb-button sb-themes__danger" disabled={busy} onClick={remove}>Confirmer la suppression</button></Dialog> : null}
    {guard.pending === null ? null : <Dialog title="Quitter sans enregistrer ?" onClose={guard.stay}><p>Les modifications non enregistrées seront perdues.</p><button type="button" className="sb-button" data-autofocus onClick={guard.stay}>Rester</button> <button type="button" className="sb-button" onClick={guard.leave}>Quitter sans enregistrer</button></Dialog>}
    {failure === null ? null : <Banner tone="danger">{failureText(failure)}{failure.status === "refused" && failure.code === "revision_conflict" ? <> Rien n'a été écrasé. <button className="sb-button" type="button" onClick={reload}>Recharger</button></> : null}{kind === "composant" && failure.status === "refused" && failure.code === "content_in_use" ? <><ul>{failure.consumers?.map((consumer) => <li key={consumer.id}><a href={routeHash({ page: "dashboard", space: space.id, id: consumer.id })}>Dashboard {consumer.id}</a></li>)}</ul>{Number(failure.others) > 0 ? <p>et {failure.others} autres dashboards que vous ne voyez pas</p> : null}</> : null}</Banner>}
    {notice === null ? null : <Banner tone="neutral">{notice}</Banner>}
    {historical ? null : <div className="sb-themes__actions"><button type="button" className="sb-button sb-button--primary" disabled={busy || !dirty || !name.trim()} onClick={save}>Enregistrer</button><Badge tone={dirty ? "warning" : "neutral"}>{dirty ? "Modifié" : "Enregistré"}</Badge><button type="button" className="sb-button sb-themes__danger" disabled={busy} onClick={() => { setConfirm(true); }}>Supprimer le {noun(kind)}</button></div>}
    {space.role === "admin" && !historical && server.state === "draft" ? <Approval key={`${server.id}:${String(server.revision)}:${String(server.approvedRevision)}`} space={space.id} kind={kind} value={server} dirty={dirty || busy} fetcher={fetcher} reload={reload} onBusy={setBusy} /> : null}
    <details className="sb-props sb-themes__section" open><summary><h2>Nom et description</h2></summary><div className="sb-themes__grid"><label className="sb-field">Nom <input value={name} disabled={historical || busy} onChange={(event) => { setName(event.target.value); }} /></label><label className="sb-field">Description <textarea value={description} disabled={historical || busy} onChange={(event) => { setDescription(event.target.value); }} /></label></div></details>
    {kind === "modele" ? <TemplateContent document={server.document as PageTemplate} /> : <ComponentContent space={space.id} document={server.document as ComponentDocument} />}
  </div>;
}
function History({ space, id, kind, fetcher }: { space: string; id: string; kind: Kind; fetcher: Fetch }) {
  const history = useOutcome(`${space}:${kind}:${id}:historique`, async (signal): Promise<Result<ThemeHistory>> => kind === "modele" ? await templateClient.fetchPageTemplateHistory(space, id, signal, fetcher) : await componentClient.fetchComponentHistory(space, id, signal, fetcher));
  return <div className="sb-dashboards sb-theme-skifer-clair"><h1>Historique du {noun(kind)}</h1><p><a href={routeHash({ page: kind, space, id })}>Retour à la fiche</a></p>{history.status === "loading" ? <Reading>Lecture de l'historique…</Reading> : history.status !== "ok" ? <Banner tone="danger">Historique indisponible : {failureText(history)}. Rien n'est affiché à sa place.</Banner> : <HistoryEntries history={history.value} link={(revision) => routeHash({ page: kind, space, id, revision })} />}</div>;
}
export function HistoryEntries({ history, link }: { history: ThemeHistory; link: (revision: number) => string }) {
  return <ol aria-label="Historique des révisions">{history.revisions.map((entry, index) => <li key={`${String(entry.revision)}:${String(index)}`}><strong>r{entry.revision}</strong> · {ACTION_LABELS[entry.action]} · {entry.actor.subject} · {formatInstant(entry.committedAt)} · commit {entry.commit.slice(0, 12)}{entry.action === "save" ? <> · <a href={link(entry.revision)}>Lire la révision {entry.revision}</a></> : null}</li>)}</ol>;
}
const PATHS: Record<string, string> = { name: "Nom", description: "Description", owner: "Propriétaire", issuer: "Émetteur", subject: "Sujet", defaults: "Défauts", filters: "Filtres", label: "Libellé", dimension: "Dimension", operator: "Opérateur", default: "Valeur par défaut", allowed: "Valeurs autorisées", layout: "Structure", sections: "Sections", title: "Titre", rows: "Rangées", columns: "Colonnes", span: "Largeur", children: "Contenu", type: "Genre", expected: "Genre attendu", blocks: "Blocs", content: "Contenu", items: "Éléments", text: "Texte", id: "Identifiant", kind: "Genre", analysis: "Analyse", analysis_id: "Identifiant de l'analyse", revision: "Révision", presentation: "Présentation", chart: "Graphique", legend: "Légende", number_format: "Format des nombres", threshold: "Seuil", value: "Valeur", tooltip: "Infobulle", level: "Niveau", ordered: "Ordonnée", emphasis: "Italique", strong: "Gras" };
export function pathLabel(path: string): string { return path.split("/").slice(1).map((part) => /^\d+$/.test(part) ? String(Number(part) + 1) : PATHS[part]).join(" · "); }
export function display(value: unknown): string {
  if (value === null) return "—";
  if (Array.isArray(value)) return value.map(display).join(", ");
  if (typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${PATHS[key]} : ${display(item)}`).join(" · ");
  if (typeof value === "string") return ({ ...OPTION_LABELS, ...CHART_LABELS, visual: "Visuel", kpi: "KPI", slot: "Emplacement", container: "Conteneur", text: "Texte", separator: "Séparateur", eq: "égal à", in: "parmi", between: "entre" } as Record<string, string>)[value] ?? value;
  return JSON.stringify(value);
}
function Approval({ space, kind, value, dirty, fetcher, reload, onBusy }: { space: string; kind: Kind; value: Revision; dirty: boolean; fetcher: Fetch; reload: () => void; onBusy: (busy: boolean) => void }) {
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const lock = useRef(false);
  const diff = useOutcome(`${space}:${kind}:${value.id}:${String(value.approvedRevision)}:${String(value.revision)}`, async (signal): Promise<Result<{ changes: readonly ThemeChange[] }>> => value.approvedRevision === null ? { status: "ok", value: { changes: [] } } : kind === "modele" ? await templateClient.fetchPageTemplateDiff(space, value.id, value.approvedRevision, value.revision, signal, fetcher) : await componentClient.fetchComponentDiff(space, value.id, value.approvedRevision, value.revision, signal, fetcher));
  const approve = () => {
    if (lock.current || dirty || stale || diff.status !== "ok") return;
    lock.current = true; setBusy(true); onBusy(true); setFailure(null);
    const request = kind === "modele" ? templateClient.approvePageTemplate(space, value.id, value.revision, value.revision, fetcher) : componentClient.approveComponent(space, value.id, value.revision, value.revision, fetcher);
    void request.then((result) => { lock.current = false; setBusy(false); onBusy(false); if (result.status !== "ok") { setFailure(result); if (result.status === "refused" && result.code === "revision_conflict") setStale(true); return; } if (result.value.approvedRevision !== value.revision) { setFailure({ status: "error", message: "Réponse d'approbation incohérente." }); setStale(true); return; } reload(); });
  };
  return <section aria-label={`Approbation du ${noun(kind)}`}><Card title="Approbation">{stale ? <p>Le diff n'est plus valable. <button className="sb-button" type="button" onClick={reload}>Recharger</button></p> : value.approvedRevision === null ? <><div className="sb-content__approval-summary"><h3>Première approbation</h3><p>{value.document.name} · révision r{value.revision}</p>{value.document.description === "" ? null : <p>{value.document.description}</p>}<p>{kind === "modele" ? `${String((value.document as PageTemplate).layout.sections.length)} section${(value.document as PageTemplate).layout.sections.length === 1 ? "" : "s"}` : (value.document as ComponentDocument).kind === "visual" ? "Visuel" : "KPI"}</p></div></> : diff.status === "loading" ? <Reading>Lecture du diff…</Reading> : diff.status !== "ok" ? <Banner tone="danger">Diff indisponible : {failureText(diff)}. Rien n'est affiché à sa place.</Banner> : diff.value.changes.length === 0 ? <p>Aucune différence structurelle.</p> : <div className="sb-table-wrap sb-themes__diff" role="group" aria-label="Diff" tabIndex={0}><table className="sb-table"><caption>Diff entre r{value.approvedRevision} et r{value.revision}</caption><thead><tr><th scope="col">Chemin</th><th scope="col">Genre</th><th scope="col">Avant</th><th scope="col">Après</th></tr></thead><tbody>{diff.value.changes.map((change, index) => <tr key={`${change.path}:${String(index)}`}><th scope="row">{pathLabel(change.path)}</th><td>{{ added: "Ajouté", removed: "Retiré", modified: "Modifié" }[change.kind]}</td><td>{display(change.before)}</td><td>{display(change.after)}</td></tr>)}</tbody></table></div>}{failure === null ? null : <Banner tone="danger">{failureText(failure)}</Banner>}<div className="sb-themes__approval-actions"><button className="sb-button sb-button--primary" type="button" onClick={approve} disabled={busy || dirty || stale || diff.status !== "ok"}>Approuver</button>{dirty ? <p>Enregistrez les modifications avant l'approbation.</p> : null}</div></Card></section>;
}
function TemplateContent({ document }: { document: PageTemplate }) {
  return <><details className="sb-props sb-themes__section" open><summary><h2>Structure du modèle</h2></summary><p>La structure se refait depuis un dashboard (Enregistrer comme modèle).</p>{document.layout.sections.map((section, index) => <section key={section.id}><h3>{section.title ?? `Section ${String(index + 1)}`}</h3><Rows rows={section.rows} /></section>)}</details><details className="sb-props sb-themes__section" open><summary><h2>Filtres communs</h2></summary><p>Sans cibles : elles se choisissent dans le dashboard.</p>{document.filters.length === 0 ? <p>Aucun filtre commun.</p> : <ul>{document.filters.map((filter) => <li key={filter.id}><strong>{filter.label}</strong> · Dimension : {filter.dimension} · Opérateur : {display(filter.operator)}{filter.default === undefined ? null : <> · Valeur par défaut : {display(filter.default)}</>}{filter.allowed === undefined ? null : <> · Valeurs autorisées : {display(filter.allowed)}</>}</li>)}</ul>}</details></>;
}
function Rows({ rows }: { rows: readonly TemplateRow[] }) { return <div className="sb-content__rows">{rows.map((row) => <div className="sb-content__row" key={row.id}>{row.columns.map((column) => <div className="sb-content__column" key={column.id} style={{ flex: `${String(column.span)} 1 0` }}>{column.children.map((node) => <Node key={node.id} node={node} />)}</div>)}</div>)}</div>; }
function Node({ node }: { node: TemplateNode }) {
  if (node.type === "slot") return <div className="sb-content__slot"><strong>{node.label}</strong><p>{node.expected === "visual" ? "Visuel" : "KPI"}</p></div>;
  if (node.type === "separator") return <div className="sb-content__separator" role="separator" aria-label="Séparateur"><span>Séparateur</span></div>;
  if (node.type === "container") return <section className="sb-content__container"><h4>Conteneur</h4><Rows rows={node.rows} /></section>;
  return <div>{node.blocks.map((block, index) => block.type === "list" ? <ul key={index}>{block.items.map((item, i) => <li key={i}>{item.map((segment) => segment.text).join("")}</li>)}</ul> : <p key={index}>{block.content.map((segment) => segment.text).join("")}</p>)}</div>;
}
function ComponentContent({ space, document }: { space: string; document: ComponentDocument }) {
  const p = document.presentation;
  return <details className="sb-props sb-themes__section" open><summary><h2>Contenu du composant</h2></summary><p>Le composant s'exécute dans un dashboard, avec les droits de la personne qui l'ouvre.</p><p>Genre : {document.kind === "visual" ? "Visuel" : "KPI"}</p><p>Analyse épinglée : <a href={routeHash({ page: "analysis", space, id: document.analysis.analysis_id, revision: document.analysis.revision })}>Lire l’analyse · révision r{document.analysis.revision}</a> <small className="sb-content__analysis-id sb-mono">{document.analysis.analysis_id}</small></p><h3>Présentation sémantique</h3><dl className="sb-content__presentation">{p.title === undefined ? null : <><dt>Titre</dt><dd>{p.title}</dd></>}{"chart" in p ? <><dt>Type de graphique</dt><dd>{CHART_LABELS[p.chart]}</dd></> : null}{"legend" in p ? <><dt>Légende</dt><dd>{OPTION_LABELS[p.legend]}</dd></> : null}{p.number_format === undefined ? null : <><dt>Format des nombres</dt><dd>{OPTION_LABELS[p.number_format]}</dd></>}{p.tooltip === undefined ? null : <><dt>Infobulle</dt><dd>{OPTION_LABELS[p.tooltip]}</dd></>}{p.threshold === undefined ? null : <><dt>Seuil</dt><dd>{p.threshold.label} : {p.threshold.value}</dd></>}</dl></details>;
}
