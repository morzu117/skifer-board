import { useState } from "react";

import { fetchAnalyses, fetchAnalysisRevision, fetchHistory } from "../../analyses/client";
import { Unavailable } from "../../analyses/Failure";
import { READ_STATE_LABELS } from "../../analyses/labels";
import type { AnalysisListItem } from "../../analyses/model";
import type { Fetch } from "../../spaces/api";
import { Reading } from "../../spaces/AdminParts";
import { Banner } from "../../ui/Banner";
import { Dialog } from "../../ui/Dialog";
import { useOutcome } from "../../ui/useOutcome";
import { useEditor } from "./EditorContext";
import { kpiCompatible } from "./problems";
import { ancestors, findNode } from "./tree";

/** Sélecteur d'analyse et de révision : aucune requête ni donnée ne sont recopiées dans le dashboard. */
export function AjouterAnalyse({ space, fetcher, onClose }: { space: string; fetcher: Fetch; onClose: () => void }) {
  const list = useOutcome(`${space}:selection-analyses`, (signal) => fetchAnalyses(space, signal, fetcher));
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AnalysisListItem | null>(null);
  const matches = list.status === "ok" ? list.value.analyses.filter((one) => one.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())) : [];
  return <Dialog title="Ajouter une analyse" onClose={onClose}>
    <label className="sb-field">Rechercher une analyse<input data-autofocus value={search} onChange={(event) => { setSearch(event.target.value); }} /></label>
    {list.status === "loading" ? <Reading>Lecture des analyses…</Reading>
      : list.status !== "ok" ? <Unavailable outcome={list} title="Analyses indisponibles" local="Les analyses ne sont pas disponibles en mode local." />
      : <>
        {list.value.unreadable > 0 ? <Banner tone="warning">Certaines analyses n'ont pas pu être lues.</Banner> : null}
        {matches.length === 0 ? <p>Aucune analyse ne correspond à la recherche.</p> : null}
        <ul>{matches.map((one) => <li key={one.id}>
          <button type="button" className="sb-button" aria-pressed={selected?.id === one.id} onClick={() => { setSelected(one); }}>{one.name} · {one.visibility === "shared" ? "Partagée" : "Personnelle"}</button>
        </li>)}</ul>
      </>}
    {selected === null ? null : <Choix key={selected.id} space={space} fetcher={fetcher} analysis={selected} onClose={onClose} />}
    <button type="button" className="sb-button" onClick={onClose}>Fermer</button>
  </Dialog>;
}

function Choix({ space, fetcher, analysis, onClose }: { space: string; fetcher: Fetch; analysis: AnalysisListItem; onClose: () => void }) {
  const editor = useEditor();
  const [picked, setPicked] = useState<number | null>(null);
  const [kind, setKind] = useState<"analysis" | "kpi">("analysis");
  const history = useOutcome(`${space}:${analysis.id}:historique`, (signal) => fetchHistory(space, analysis.id, signal, fetcher));
  // L'historique fait autorité si la ligne de liste est périmée ; le choix explicite reste épinglé.
  const revision = picked ?? (history.status === "ok" ? history.value.currentRevision : null) ?? analysis.revision;
  const read = useOutcome(`${space}:${analysis.id}:${String(revision)}:revision`, (signal) => fetchAnalysisRevision(space, analysis.id, revision, signal, fetcher));
  const add = (): void => {
    const selection = editor.selected === null ? undefined : findNode(editor.tree, editor.selected);
    const column = selection?.kind === "column" ? selection : undefined;
    const section = selection === undefined ? editor.tree.at(-1) : [...ancestors(editor.tree, selection.id), selection].find((one) => one.kind === "section");
    if (column === undefined && section === undefined) { editor.say("Ajoutez ou sélectionnez d'abord une section.", true); return; }
    const id = crypto.randomUUID();
    const value = { reference: { analysis_id: analysis.id, revision }, presentation: {} };
    if (column !== undefined) {
      if (editor.run({ type: "add", kind, parent: column.id, index: column.children.length, value }, "Analyse ajoutée.", { id, select: id })) onClose();
      return;
    }
    const row = crypto.randomUUID();
    const newColumn = crypto.randomUUID();
    if (editor.run({ type: "batch", commands: [
      { type: "add", kind: "row", parent: section?.id as string, index: section?.children.length as number },
      { type: "add", kind: "column", parent: row, index: 0, value: { span: 12 } },
      { type: "add", kind, parent: newColumn, index: 0, value },
    ] }, "Analyse ajoutée.", { ids: [row, newColumn, id], select: id })) onClose();
  };
  return <section aria-label="Aperçu de l'analyse">
    {history.status === "loading" ? <Reading>Lecture des révisions…</Reading> : history.status !== "ok" ? <Unavailable outcome={history} title="Historique indisponible" local="Historique indisponible en mode local." /> : <label className="sb-field">Révision<select value={revision} onChange={(event) => { setPicked(Number(event.target.value)); setKind("analysis"); }}>{history.value.revisions.filter((one) => one.available && one.action === "save").map((one) => <option key={one.revision} value={one.revision}>Révision {String(one.revision)}{one.revision === history.value.currentRevision ? " · courante" : ""}</option>)}</select></label>}
    {read.status === "loading" ? <Reading>Lecture de l'analyse…</Reading> : read.status !== "ok" ? <Unavailable outcome={read} title="Analyse indisponible" local="Analyse indisponible en mode local." /> : <>
      <h3>{read.value.analysis.name}</h3><p>{read.value.analysis.description}</p>
      <p>{READ_STATE_LABELS[read.value.state].label} : {READ_STATE_LABELS[read.value.state].reason}</p>
      <p>Visibilité : {read.value.analysis.visibility === "shared" ? "partagée" : "personnelle"} · révision courante : {String(read.value.currentRevision ?? "supprimée")}</p>
      <p>Modèle : {read.value.analysis.query.model} · métriques : {read.value.analysis.query.metrics.join(", ")} · dimensions : {read.value.analysis.query.dimensions.join(", ") || "aucune"}</p>
      {editor.document.visibility === "shared" && read.value.analysis.visibility === "personal" ? <Banner tone="warning">Une analyse personnelle ne peut pas être enregistrée dans un dashboard partagé.</Banner> : null}
      <fieldset><legend>Type de composant</legend><label><input type="radio" name="type-ajout-analyse" checked={kind === "analysis"} onChange={() => { setKind("analysis"); }} /> Visuel</label>{kpiCompatible(read.value) ? <label><input type="radio" name="type-ajout-analyse" checked={kind === "kpi"} onChange={() => { setKind("kpi"); }} /> KPI</label> : null}</fieldset>
      <button type="button" className="sb-button sb-button--primary" disabled={history.status !== "ok" || history.value.currentRevision === null} onClick={add}>Ajouter</button>
    </>}
  </section>;
}
