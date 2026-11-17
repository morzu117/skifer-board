import { useEffect, useRef, useState } from "react";
import { cssVariableName } from "../design/tokens";
import { Reading } from "../spaces/AdminParts";
import type { Fetch } from "../spaces/api";
import { Card } from "../ui/Card";
import { Banner } from "../ui/Banner";
import { useOutcome } from "../ui/useOutcome";
import { TOKEN_CATALOG } from "./catalog";
import { approveTheme, fetchThemeDiff, type ReadTheme, type ThemeOutcome } from "./client";
import { FIELD_LABELS, MARK_LABELS, OPTION_LABELS, themePathLabel, themeRefusalText } from "./labels";
import type { ThemeChange } from "./model";

const KIND = { added: "Ajouté", removed: "Retiré", modified: "Modifié" } as const;
function DiffValue({ path, value }: { path: string; value: unknown }) {
  if (value === null) return <>—</>;
  const token = typeof value === "string" && /^\/(roles\/(marks|text)\/|categorical\/|sequential\/|diverging\/)/.test(path) && Object.hasOwn(TOKEN_CATALOG.luminance, value);
  if (token) return <><span aria-hidden="true" className="sb-themes__swatch" style={{ backgroundColor: `var(${cssVariableName(value.split("."))})` }} />{value}</>;
  if (typeof value === "object") return <>{Object.entries(value).map(([key, item]) => <span key={key}>{FIELD_LABELS[key as keyof typeof FIELD_LABELS]} : {OPTION_LABELS[String(item)]} </span>)}</>;
  if (typeof value === "string" && /^\/(base|typography|density|formats|chart_defaults)(\/|$)/.test(path)) return <>{OPTION_LABELS[value]}</>;
  return <>{JSON.stringify(value)}</>;
}
function Diff({ space, revision, fetcher, onReady }: { space: string; revision: ReadTheme; fetcher: Fetch; onReady: (ready: boolean) => void }) {
  const base = revision.approvedRevision as number;
  const diff = useOutcome(`${space}:${revision.id}:${String(base)}:${String(revision.revision)}:diff`, (signal) => fetchThemeDiff(space, revision.id, base, revision.revision, signal, fetcher));
  useEffect(() => { onReady(diff.status === "ok"); }, [diff.status, onReady]);
  if (diff.status === "loading") return <Reading>Lecture du diff…</Reading>;
  if (diff.status !== "ok") return <Banner tone="danger">Diff indisponible : {diff.status === "error" ? diff.message : themeRefusalText(diff)}. Rien n'est affiché à sa place.</Banner>;
  if (diff.value.changes.length === 0) return <p>Aucune différence structurelle.</p>;
  return <div className="sb-table-wrap sb-themes__diff" role="group" aria-label="Diff du thème" tabIndex={0}><table className="sb-table"><caption>Diff entre r{base} et r{revision.revision}</caption><thead><tr><th scope="col">Chemin</th><th scope="col">Genre</th><th scope="col">Avant</th><th scope="col">Après</th></tr></thead><tbody>{diff.value.changes.map((change: ThemeChange, index) => <tr key={`${change.path}:${String(index)}`}><th scope="row">{themePathLabel(change.path)}<small className="sb-themes__diff-path sb-mono">{change.path.split(/(?<=\/)/).map((part, index) => <span key={index}>{part}<wbr /></span>)}</small></th><td>{KIND[change.kind]}</td><td><DiffValue path={change.path} value={change.before} /></td><td><DiffValue path={change.path} value={change.after} /></td></tr>)}</tbody></table></div>;
}
export function ApprobationTheme({ space, revision, fetcher, dirty, onReload, onBusyChange }: { space: string; revision: ReadTheme; fetcher: Fetch; dirty: boolean; onReload: () => void; onBusyChange?: (busy: boolean) => void }) {
  const [failure, setFailure] = useState<Exclude<ThemeOutcome<unknown>, { status: "ok" }> | null>(null);
  const [stale, setStale] = useState(false);
  const [ready, setReady] = useState(revision.approvedRevision === null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const approve = () => {
    if (lock.current || dirty || stale || !ready) return;
    lock.current = true; setBusy(true); onBusyChange?.(true); setFailure(null);
    void approveTheme(space, revision.id, revision.revision, revision.revision, fetcher).then((outcome) => {
      lock.current = false; setBusy(false); onBusyChange?.(false);
      if (outcome.status !== "ok") { setFailure(outcome); if (outcome.status === "refused" && outcome.code === "revision_conflict") setStale(true); return; }
      if (outcome.value.approvedRevision !== revision.revision) { setFailure({ status: "error", message: "Réponse d'approbation incohérente : révision différente." }); setStale(true); return; }
      onReload();
    });
  };
  return <section aria-label="Approbation du thème"><Card title="Approbation">
    {stale ? <p>Le diff n'est plus valable. <button type="button" className="sb-button" onClick={onReload}>Recharger le thème</button></p> : revision.approvedRevision === null ? <><h3>Première approbation</h3><p>{revision.theme.name} · base {OPTION_LABELS[revision.theme.base]} · révision r{revision.revision}</p><p>{revision.theme.description}</p><p>Marques : {Object.entries(revision.theme.roles.marks).map(([role, token]) => `${MARK_LABELS[role as keyof typeof MARK_LABELS]} : ${token}`).join(" · ")}</p><p>Palettes : {revision.theme.categorical.join(", ")} ; {revision.theme.sequential.join(", ")} ; {revision.theme.diverging.join(", ")}.</p><p>Typographie {OPTION_LABELS[revision.theme.typography.sans]}, échelle {OPTION_LABELS[revision.theme.typography.scale]} · densité {OPTION_LABELS[revision.theme.density]} · formats {OPTION_LABELS[revision.theme.formats.number]}, {OPTION_LABELS[revision.theme.formats.date]}.</p></> : <Diff space={space} revision={revision} fetcher={fetcher} onReady={setReady} />}
    {failure === null ? null : <Banner tone="danger">{failure.status === "error" ? failure.message : themeRefusalText(failure)}</Banner>}
    <div className="sb-themes__approval-actions"><button type="button" className="sb-button sb-button--primary" onClick={approve} disabled={busy || dirty || stale || !ready} title={dirty ? "Enregistrez les modifications avant l'approbation." : stale ? "Rechargez le thème avant l'approbation." : undefined}>Approuver</button>{dirty ? <p>Enregistrez les modifications avant l'approbation.</p> : null}</div>
  </Card></section>;
}
