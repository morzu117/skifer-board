import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { LEGENDS, NUMBER_FORMATS, TOOLTIPS } from "../dashboards/document";
import { ThemeSwitch } from "../prototype/ThemeSwitch";
import { SKIFER_CLAIR, type ChartTheme } from "../charts/theme";
import { navigate, routeHash } from "../shell/route";
import { useExitGuard } from "../shell/useExitGuard";
import { Dialog } from "../ui/Dialog";
import { Reading } from "../spaces/AdminParts";
import type { Fetch } from "../spaces/api";
import type { Space } from "../spaces/model";
import { InfoIcon } from "../ui/icons";
import { Badge } from "../ui/Badge";
import { Banner } from "../ui/Banner";
import { useOutcome } from "../ui/useOutcome";
import { TOKEN_CATALOG, type Base } from "./catalog";
import { createTheme, deleteTheme, fetchTheme, fetchThemeRevision, reviseTheme, type ReadTheme, type ThemeDraft, type ThemeOutcome } from "./client";
import { defaultThemeDraft } from "./defaultDraft";
import { createHistory, dispatch, isDirty, markSaved, redo, themeProblems, undo, type Chart, type Command, type Document, type Mark, type Palette, type TextRole } from "./edition";
import { CHART_LABELS, EDITION_REFUSAL_LABELS, FIELD_LABELS, MARK_LABELS, OPTION_LABELS, PALETTE_LABELS, PROBLEM_LABELS, TEXT_LABELS, THEME_VIOLATION_LABELS, themeRefusalText } from "./labels";
import { ApprobationTheme } from "./ApprobationTheme";
import { ApercuTheme } from "./ApercuTheme";
import { TokenChoices } from "./TokenChoices";
import "../dashboards/dashboards.css";
import "./themes.css";

export function ThemeEditorPage({ space, id, identity, fetcher, historical }: { space: Space; id: string; identity: string; fetcher: Fetch; historical?: number | undefined }) {
  return id === "nouveau" ? <EditeurTheme key={`${space.id}:${identity}:nouveau`} space={space.id} initial={defaultThemeDraft()} fetcher={fetcher} /> : <ReadEditor space={space.id} id={id} identity={identity} fetcher={fetcher} historical={historical} admin={space.role === "admin"} />;
}
function ReadEditor({ space, id, identity, fetcher, historical, admin }: { space: string; id: string; identity: string; fetcher: Fetch; historical?: number | undefined; admin: boolean }) {
  const [reload, setReload] = useState(0);
  const read = useOutcome(`${space}:${id}:${identity}:lecture:${String(reload)}:${String(historical)}`, (signal) => historical === undefined ? fetchTheme(space, id, signal, fetcher) : fetchThemeRevision(space, id, historical, signal, fetcher));
  return <div className="sb-dashboards sb-theme-skifer-clair">{read.status === "loading" ? <Reading>Lecture du thème…</Reading> : read.status === "ok" ? <EditeurTheme key={reload} space={space} initial={read.value.theme} fetcher={fetcher} revision={read.value} historical={historical !== undefined} admin={admin} onReload={() => { setReload((value) => value + 1); }} /> : <><Banner tone="danger">Thème indisponible : {read.status === "error" ? read.message : themeRefusalText(read)}. Rien n'est affiché à sa place.</Banner><p><a href={routeHash({ page: "themes", space })}>Retour à la liste des thèmes</a></p></>}</div>;
}
const marks = MARK_LABELS;
const texts = TEXT_LABELS;
const palettes = PALETTE_LABELS;
const charts = CHART_LABELS;
const note = "enregistré, pas encore rendu par les graphiques de Board";
function Hint({ children }: { children: string }) { return <small className="sb-field__hint sb-themes__hint"><InfoIcon size={14} />{children}</small>; }
function Select({ label, value, options, change }: { label: string; value: string; options: readonly string[]; change: (value: string) => void }) {
  return <label className="sb-field">{label} <select value={value} onChange={(event) => { change(event.target.value); }}>{options.map((option) => <option key={option} value={option}>{OPTION_LABELS[option]}</option>)}</select></label>;
}
function draftOf(document: Document): ThemeDraft {
  const { name, description, base, roles, categorical, sequential, diverging, typography, density, formats, chart_defaults } = document;
  return { name, description, base, roles, categorical, sequential, diverging, typography, density, formats, chart_defaults };
}
export function EditeurTheme({ space, initial, fetcher = fetch, revision, onReload, historical = false, admin = false }: { space: string; initial: Document | ThemeDraft; fetcher?: Fetch; revision?: ReadTheme; onReload?: () => void; historical?: boolean; admin?: boolean }) {
  const [history, setHistory] = useState(() => createHistory(draftOf(initial)));
  const latest = useRef(history);
  const [server, setServer] = useState(revision);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const [failure, setFailure] = useState<Exclude<ThemeOutcome<ReadTheme>, { status: "ok" }> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [deleteFailure, setDeleteFailure] = useState<Exclude<ThemeOutcome<unknown>, { status: "ok" }> | null>(null);
  const deleteLock = useRef(false);
  const guard = useExitGuard(isDirty(history) && !deleted);
  useEffect(() => { if (deleted) navigate({ page: "themes", space }); }, [deleted, space]);
  useEffect(() => { if (created !== null) navigate({ page: "theme", space, id: created }); }, [created, space]);
  const commit = (next: typeof history) => { latest.current = next; setHistory(next); };
  const [theme, setTheme] = useState<ChartTheme>(SKIFER_CLAIR);
  const [add, setAdd] = useState<Record<Palette, string>>({ categorical: "", sequential: "", diverging: "" });
  const [refusal, setRefusal] = useState<string | null>(null);
  const doc = history.present;
  const send = (command: Command) => { const next = dispatch(latest.current, command, TOKEN_CATALOG); commit(next.history); setRefusal(next.result.ok ? null : EDITION_REFUSAL_LABELS[next.result.reason]); };
  const problems = themeProblems(doc, TOKEN_CATALOG);
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (historical || saving || approvalBusy || !(event.ctrlKey || event.metaKey) || target.tagName === "TEXTAREA" || (target instanceof HTMLInputElement && !["radio", "checkbox", "button", "submit"].includes(target.type)) || target.isContentEditable) return;
    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey) { event.preventDefault(); commit(undo(latest.current)); }
    else if ((key === "z" && event.shiftKey) || key === "y") { event.preventDefault(); commit(redo(latest.current)); }
  };
  const save = () => {
    if (saveLock.current || problems.length > 0) return;
    saveLock.current = true; setSaving(true); setFailure(null); setNotice(null);
    const draft = latest.current.present;
    const request = server === undefined ? createTheme(space, draft, fetcher) : reviseTheme(space, server.id, draft, server.revision, fetcher);
    void request.then((outcome) => {
      saveLock.current = false; setSaving(false);
      if (outcome.status !== "ok") { setFailure(outcome); return; }
      const found = outcome.value;
      const kept = draftOf(found.theme);
      const saved = markSaved({ ...latest.current, present: kept }, TOKEN_CATALOG);
      commit({ ...latest.current, saved: saved.saved });
      setServer(found);
      if (JSON.stringify(kept) !== JSON.stringify(draft)) { setNotice("Le contenu enregistré diffère du brouillon : vos modifications restent non enregistrées."); return; }
      if (server === undefined) { setCreated(found.id); return; }
      setNotice(`Révision r${String(found.revision)} enregistrée en brouillon.${found.approvedRevision === null ? "" : ` La révision approuvée r${String(found.approvedRevision)} reste celle des dashboards partagés.`}`);
    });
  };
  const remove = () => {
    if (server === undefined || deleteLock.current) return;
    deleteLock.current = true; setDeleting(true); setDeleteFailure(null);
    void deleteTheme(space, server.id, server.revision, fetcher).then((outcome) => {
      deleteLock.current = false; setDeleting(false); setConfirmDelete(false);
      if (outcome.status !== "ok") { setDeleteFailure(outcome); return; }
      setDeleted(true);
    });
  };
  return <><div className={`sb-dashboards sb-themes__editor sb-theme-${theme.id}`} onKeyDown={keys}>
    <div className="sb-page-head"><div><h1 className="sb-page-head__title">Éditeur de thème</h1><p><a href={routeHash({ page: "themes", space })}>Retour à la liste des thèmes</a></p></div><ThemeSwitch value={theme} onChange={setTheme} /></div>
    <div className="sb-themes__meta">{revision === undefined ? null : <p><a href={routeHash({ page: "theme", space, id: revision.id, view: "history" })}>Historique des révisions</a>{historical ? ` · Révision r${String(revision.revision)} en lecture seule` : ""}</p>}
    {server === undefined ? null : <p>Révision r{server.revision} · <Badge tone={server.state === "approved" ? "success" : "neutral"}>{server.state === "approved" ? `Approuvé r${String(server.approvedRevision)}` : "Brouillon"}</Badge></p>}
    {server !== undefined && !historical ? <p><button type="button" className="sb-button sb-themes__danger" disabled={approvalBusy || saving} onClick={() => { setConfirmDelete(true); }}>Supprimer le thème</button></p> : null}</div>
    {confirmDelete ? <Dialog title="Supprimer le thème ?" onClose={() => { setConfirmDelete(false); }}><p>Supprimer le thème « {doc.name} » ? Ses révisions restent dans l’historique du dépôt. Les modifications non enregistrées seront perdues.</p><button type="button" className="sb-button" data-autofocus disabled={deleting} onClick={() => { setConfirmDelete(false); }}>Annuler</button> <button type="button" className="sb-button sb-themes__danger" disabled={deleting} onClick={remove}>Confirmer la suppression</button></Dialog> : null}
    {deleteFailure === null ? null : <Banner tone="danger">{deleteFailure.status === "error" ? deleteFailure.message : themeRefusalText(deleteFailure)}{deleteFailure.status === "refused" && deleteFailure.code === "content_in_use" ? <><ul>{deleteFailure.consumers?.map((consumer) => <li key={consumer.id}><a href={routeHash({ page: "dashboard", space, id: consumer.id })}>Dashboard {consumer.id}</a></li>)}</ul>{(deleteFailure.others as number) > 0 ? <p>et {deleteFailure.others} autres dashboards que vous ne voyez pas</p> : null}</> : null}</Banner>}
    <div role="status">{refusal}</div>
    {historical ? null : <div className="sb-themes__actions"><button type="button" className="sb-button" disabled={saving || approvalBusy} onClick={() => { commit(undo(latest.current)); }}>Annuler</button> <button type="button" className="sb-button" disabled={saving || approvalBusy} onClick={() => { commit(redo(latest.current)); }}>Rétablir</button> <button type="button" className="sb-button sb-button--primary" disabled={saving || approvalBusy || problems.length > 0} title={problems.length > 0 ? "Corrigez les problèmes avant d’enregistrer." : undefined} onClick={save}>Enregistrer</button>{problems.length > 0 ? <span> Corrigez les problèmes avant d’enregistrer.</span> : null}<Badge tone={isDirty(history) ? "warning" : "neutral"}>{isDirty(history) ? "Modifié" : server === undefined ? "Non enregistré" : "Enregistré"}</Badge></div>}
    {admin && !historical && server !== undefined && server.state === "draft" && onReload !== undefined ? <ApprobationTheme key={`${server.id}:${String(server.revision)}:${String(server.approvedRevision)}`} space={space} revision={server} fetcher={fetcher} dirty={isDirty(history) || saving} onReload={onReload} onBusyChange={setApprovalBusy} /> : null}
    {notice === null ? null : <Banner tone="neutral">{notice}</Banner>}
    {failure === null ? null : <Banner tone="danger">{failure.status === "error" ? `Enregistrement non confirmé : ${failure.message}` : themeRefusalText(failure)}{failure.status === "refused" && failure.code === "revision_conflict" && onReload !== undefined ? <> Rien n'a été écrasé. <button type="button" className="sb-button" onClick={onReload}>Recharger</button></> : null}{failure.status === "refused" && failure.violations !== undefined ? <ul>{failure.violations.map((violation) => <li key={`${violation.path}:${violation.rule}`}><code>{violation.path}</code> : {THEME_VIOLATION_LABELS[violation.rule]}</li>)}</ul> : null}</Banner>}
    {guard.pending === null ? null : <Dialog title="Quitter sans enregistrer ?" onClose={guard.stay}><p>Les modifications non enregistrées seront perdues.</p><button type="button" className="sb-button" data-autofocus onClick={guard.stay}>Rester</button> <button type="button" className="sb-button" onClick={guard.leave}>Quitter sans enregistrer</button></Dialog>}
    <a className="sb-themes__preview-link sb-button" href="#theme-apercu" onClick={(event) => { event.preventDefault(); globalThis.document.getElementById("theme-apercu")?.focus(); }}>Voir l'aperçu</a>
    <div className="sb-themes__workspace"><fieldset className="sb-themes__fields" disabled={saving || historical || approvalBusy}><legend className="sb-visually-hidden">Champs du thème</legend>
    <details className="sb-props sb-themes__section" open><summary>Base et nom</summary><div className="sb-themes__grid"><label className="sb-field">Nom <input value={doc.name} onChange={(event) => { send({ type: "name", value: event.target.value }); }} /></label><Select label="Base" value={doc.base} options={["skifer-clair", "skifer-ardoise"]} change={(value) => { send({ type: "base", value: value as Base }); }} /></div></details>
    <details className="sb-props sb-themes__section" open><summary>Rôles des marques</summary><div className="sb-themes__grid">{(Object.entries(marks) as [Mark, string][]).map(([role, label]) => <TokenChoices key={role} catalog={TOKEN_CATALOG} base={doc.base} role="mark" label={label} value={doc.roles.marks[role] as string} onChange={(token) => { send({ type: "mark", role, token }); }} />)}</div></details>
    <details className="sb-props sb-themes__section" open><summary>Rôles de texte</summary><div className="sb-themes__grid">{(Object.entries(texts) as [TextRole, string][]).map(([role, label]) => <TokenChoices key={role} catalog={TOKEN_CATALOG} base={doc.base} role="text" label={label} value={doc.roles.text[role] as string} onChange={(token) => { send({ type: "text_role", role, token }); }} />)}</div></details>
    <details className="sb-props sb-themes__section"><summary>Palettes</summary><div className="sb-themes__stack">{(Object.entries(palettes) as [Palette, string][]).map(([palette, label]) => {
      const values = doc[palette]; const min = palette === "categorical" ? 2 : 3; const max = palette === "categorical" ? 8 : 7;
      const choices = Object.keys(TOKEN_CATALOG.bases[doc.base].mark); const selected = choices.includes(add[palette]) ? add[palette] : choices[0] as string;
      return <section key={palette} className="sb-themes__palette"><h3>{label}</h3>{palette !== "sequential" ? <Hint>{note}</Hint> : null}<ol>{values.map((token, index) => {
        const required = palette === "categorical" || (palette === "sequential" && index === values.length - 1) || (palette === "diverging" && (index === 0 || index === values.length - 1));
        const which = `palier ${String(index + 1)} de la palette ${label.toLowerCase()}`;
        return <li key={index}><div className="sb-themes__palier"><TokenChoices catalog={TOKEN_CATALOG} base={doc.base} role={required ? "mark" : "palette"} label={`${label} · palier ${String(index + 1)}`} value={token} onChange={(value) => { send({ type: "palette_set", palette, index, token: value }); }} /><div className="sb-themes__palier-actions">
          <button className="sb-button sb-themes__small" type="button" aria-label={`Monter le ${which}`} disabled={index === 0} title={index === 0 ? "Premier palier" : "Monter"} onClick={() => { send({ type: "palette_move", palette, from: index, to: index - 1 }); }}>↑</button>
          <button className="sb-button sb-themes__small" type="button" aria-label={`Descendre le ${which}`} disabled={index === values.length - 1} title={index === values.length - 1 ? "Dernier palier" : "Descendre"} onClick={() => { send({ type: "palette_move", palette, from: index, to: index + 1 }); }}>↓</button>
          <button className="sb-button sb-themes__small" type="button" aria-label={`Retirer le ${which}`} disabled={values.length <= min} title={values.length <= min ? "Minimum de paliers atteint" : "Retirer"} onClick={() => { send({ type: "palette_remove", palette, index }); }}>Retirer</button></div></div>{required ? <Hint>Ce palier doit atteindre un contraste de 3:1.</Hint> : null}</li>;
      })}</ol><div className="sb-themes__palier"><TokenChoices catalog={TOKEN_CATALOG} base={doc.base} role="mark" label={`Palier à ajouter ${label}`} value={selected} onChange={(value) => { setAdd((current) => ({ ...current, [palette]: value })); }} /> <button className="sb-button sb-themes__small" type="button" disabled={values.length >= max} title={values.length >= max ? "Maximum de paliers atteint" : "Ajouter"} onClick={() => { send({ type: "palette_add", palette, index: values.length, token: selected }); }}>Ajouter {label}</button></div><Hint>Le nouveau dernier palier doit atteindre un contraste de 3:1.</Hint></section>;
    })}</div></details>
    <details className="sb-props sb-themes__section"><summary>Typographie et densité</summary><div className="sb-themes__grid">{(["sans", "mono", "scale"] as const).map((field) => <div key={field}><Select label={field === "scale" ? "Échelle" : field === "sans" ? "Famille sans empattement" : "Famille à chasse fixe"} value={doc.typography[field]} options={field === "scale" ? ["compact", "normal", "large"] : [field]} change={(value) => { send({ type: "typography", field, value }); }} />{field === "scale" ? <Hint>{note}</Hint> : null}</div>)}<div><Select label="Densité" value={doc.density} options={["compact", "normal", "airy"]} change={(value) => { send({ type: "density", value }); }} /><Hint>{note}</Hint></div></div></details>
    <details className="sb-props sb-themes__section"><summary>Formats</summary><div className="sb-themes__grid">{(["number", "date"] as const).map((field) => <div key={field}><Select label={field === "number" ? "Nombres" : "Dates"} value={doc.formats[field]} options={field === "number" ? NUMBER_FORMATS : ["short", "medium", "long", "iso"]} change={(value) => { send({ type: "format", field, value }); }} />{field === "date" ? <Hint>Court : rendu actuel, AAAA-MM-JJ</Hint> : null}</div>)}</div></details>
    <details className="sb-props sb-themes__section"><summary>Défauts des graphiques</summary><div className="sb-themes__stack">{(Object.entries(charts) as [Chart, string][]).map(([chart, label]) => <fieldset className="sb-props__choice" key={chart}><legend>{label}</legend><div className="sb-themes__grid">{(["legend", "number_format", "tooltip"] as const).map((field) => <Select key={field} label={`${label} · ${FIELD_LABELS[field]}`} value={doc.chart_defaults[chart]?.[field] ?? ""} options={["", ...(field === "legend" ? LEGENDS : field === "number_format" ? NUMBER_FORMATS : TOOLTIPS)]} change={(value) => { send({ type: "chart_default", chart, field, value: value || null }); }} />)}</div></fieldset>)}</div></details>
    </fieldset><ApercuTheme document={doc} /></div>
    {problems.length > 0 ? <section id="theme-problemes" tabIndex={-1}><h2>Problèmes</h2><ul>{problems.map((problem, index) => <li key={`${problem.path}:${problem.rule}:${String(index)}`}><code>{problem.path}</code> : {PROBLEM_LABELS[problem.rule]}</li>)}</ul></section> : null}
  </div></>;
}
