import { useRef, useState } from "react";
import { fetchDashboard, fetchDashboards, reviseDashboard } from "../dashboards/client";
import { applyCommand } from "../dashboards/edition/commands";
import { ConflitDashboard } from "../dashboards/edition/ConflitDashboard";
import { draftOf } from "../dashboards/edition/draft";
import { kpiCompatible } from "../dashboards/edition/problems";
import { dashboardRefusalText } from "../dashboards/Failure";
import type { DashboardDraft } from "../dashboards/document";
import type { DashboardRevision } from "../dashboards/model";
import { navigate, routeHash } from "../shell/route";
import { Reading } from "../spaces/AdminParts";
import type { Fetch } from "../spaces/api";
import { Banner } from "../ui/Banner";
import { Dialog } from "../ui/Dialog";
import { useOutcome } from "../ui/useOutcome";
import { fetchAnalysisRevision, fetchHistory } from "./client";
import { Unavailable } from "./Failure";
import type { AnalysisRevision } from "./model";

/** L'épinglage crée uniquement une référence ; la requête de l'analyse n'est jamais copiée. */
export function EpinglerDashboard({ space, found, fetcher, onClose }: { space: string; found: AnalysisRevision; fetcher: Fetch; onClose: () => void }) {
  const [selected, setSelected] = useState<DashboardRevision | null>(null);
  const list = useOutcome(`${space}:dashboards-modifiables`, async (signal) => {
    const result = await fetchDashboards(space, signal, fetcher);
    if (result.status !== "ok") return result;
    const details = await Promise.all(result.value.dashboards.map((one) => fetchDashboard(space, one.id, signal, fetcher)));
    return { status: "ok" as const, dashboards: details.flatMap((one) => one.status === "ok" && one.value.permissions.revise ? [one.value] : []), unreadable: result.value.unreadable + details.filter((one) => one.status !== "ok").length };
  });
  return <Dialog title="Épingler à un dashboard" onClose={onClose}>
    {list.status === "loading" ? <Reading>Lecture des dashboards…</Reading> : list.status !== "ok" ? <Unavailable outcome={list} title="Dashboards indisponibles" local="Les dashboards ne sont pas disponibles en mode local." /> : <>
      {list.unreadable > 0 ? <Banner tone="warning">Certains dashboards n'ont pas pu être lus.</Banner> : null}
      {list.dashboards.length === 0 ? <p>Aucun dashboard modifiable disponible.</p> : <label className="sb-field">Dashboard<select data-autofocus value={selected?.id ?? ""} onChange={(event) => { setSelected(list.dashboards.find((one) => one.id === event.target.value) ?? null); }}><option value="">Choisir un dashboard</option>{list.dashboards.map((one) => <option key={one.id} value={one.id}>{one.dashboard.name}</option>)}</select></label>}
      {selected === null ? null : <Choix key={selected.id} space={space} found={found} dashboard={selected} fetcher={fetcher} />}
    </>}
    <button type="button" className="sb-button" onClick={onClose}>Fermer</button>
  </Dialog>;
}

function Choix({ space, found, dashboard, fetcher }: { space: string; found: AnalysisRevision; dashboard: DashboardRevision; fetcher: Fetch }) {
  const [picked, setPicked] = useState<number | null>(null);
  const [section, setSection] = useState(dashboard.dashboard.layout.sections[0]?.id ?? "");
  const [kind, setKind] = useState<"analysis" | "kpi">("analysis");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<DashboardDraft | null>(null);
  const [saved, setSaved] = useState<DashboardRevision | null>(null);
  const history = useOutcome(`${space}:${found.id}:epingle-historique`, (signal) => fetchHistory(space, found.id, signal, fetcher));
  const revision = picked ?? (history.status === "ok" ? history.value.currentRevision : null) ?? found.currentRevision ?? found.revision;
  const analysis = useOutcome(`${space}:${found.id}:${String(revision)}:epingle`, (signal) => fetchAnalysisRevision(space, found.id, revision, signal, fetcher));
  const target = dashboard.dashboard.layout.sections.find((item) => item.id === section);
  const add = async (): Promise<void> => {
    if (lock.current || analysis.status !== "ok" || history.status !== "ok") return;
    const chosen = target as NonNullable<typeof target>;
    const row = crypto.randomUUID(); const column = crypto.randomUUID(); const tile = crypto.randomUUID();
    const ids = [row, column, tile]; let at = 0;
    const result = applyCommand(draftOf(dashboard.dashboard), { type: "batch", commands: [
      { type: "add", kind: "row", parent: chosen.id, index: chosen.rows.length },
      { type: "add", kind: "column", parent: row, index: 0, value: { span: 12 } },
      { type: "add", kind, parent: column, index: 0, value: { reference: { analysis_id: found.id, revision }, presentation: {} } },
    ] }, () => ids[at++] as string);
    if (!result.ok) { setError(`Impossible d'ajouter la tuile : ${result.detail ?? result.reason}.`); return; }
    lock.current = true; setBusy(true); setError(null);
    const outcome = await reviseDashboard(space, dashboard.id, result.document, dashboard.revision, fetcher);
    lock.current = false; setBusy(false);
    if (outcome.status === "refused" && outcome.code === "revision_conflict") { setConflict(result.document); return; }
    if (outcome.status !== "ok") { setError(outcome.status === "refused" ? dashboardRefusalText(outcome) : outcome.message); return; }
    setSaved(outcome.value.revision);
  };
  if (saved !== null) return <p>Analyse épinglée. <a href={routeHash({ page: "dashboard", space, id: saved.id })}>Ouvrir le dashboard</a></p>;
  if (conflict !== null) return <ConflitDashboard space={space} id={dashboard.id} opened={dashboard.revision} draft={conflict} fetcher={fetcher} onReopen={(current) => { navigate({ page: "dashboard", space, id: current.id }); }} />;
  return <>
    {dashboard.dashboard.layout.sections.length === 0 ? <Banner tone="warning">Ce dashboard ne contient aucune section : ajoutez-en une dans son éditeur.</Banner> : <label className="sb-field">Section<select value={section} onChange={(event) => { setSection(event.target.value); }}>{dashboard.dashboard.layout.sections.map((one, index) => <option key={one.id} value={one.id}>{one.title ?? `Section ${String(index + 1)}`}</option>)}</select></label>}
    <p>La tuile sera ajoutée en fin de section dans une nouvelle rangée et une nouvelle colonne.</p>
    {history.status === "loading" ? <Reading>Lecture des révisions…</Reading> : history.status !== "ok" ? <Unavailable outcome={history} title="Historique indisponible" local="Historique indisponible en mode local." /> : <label className="sb-field">Révision<select value={revision} onChange={(event) => { setPicked(Number(event.target.value)); setKind("analysis"); }}>{history.value.revisions.filter((one) => one.available && one.action === "save").map((one) => <option key={one.revision} value={one.revision}>Révision {one.revision}{one.revision === history.value.currentRevision ? " · courante" : ""}</option>)}</select></label>}
    {analysis.status === "loading" ? <Reading>Lecture de l'analyse…</Reading> : analysis.status !== "ok" ? <Unavailable outcome={analysis} title="Analyse indisponible" local="Analyse indisponible en mode local." /> : <>
      {dashboard.dashboard.visibility === "shared" && analysis.value.analysis.visibility === "personal" ? <Banner tone="warning">Une analyse personnelle ne peut pas être enregistrée dans un dashboard partagé.</Banner> : null}
      <fieldset><legend>Type de composant</legend><label><input type="radio" name="epingle-type" checked={kind === "analysis"} onChange={() => { setKind("analysis"); }} /> Visuel</label>{kpiCompatible(analysis.value) ? <label><input type="radio" name="epingle-type" checked={kind === "kpi"} onChange={() => { setKind("kpi"); }} /> KPI</label> : null}</fieldset>
      <button type="button" className="sb-button sb-button--primary" disabled={busy || target === undefined || history.status !== "ok" || history.value.currentRevision === null} onClick={() => { void add(); }}>{busy ? "Épinglage…" : "Épingler"}</button>
    </>}
    {error === null ? null : <Banner tone="danger">{error}</Banner>}
  </>;
}
