import { useState } from "react";
import { fetchComponentDiff } from "../../components-lib/client";
import { display, pathLabel } from "../../shared-content/ContentPage";
import { refusalText } from "../../themes/labels";
import { Banner } from "../../ui/Banner";
import { useOutcome } from "../../ui/useOutcome";
import { useEditor } from "./EditorContext";
import { findLayoutNode } from "./tree";
import { referenceKey } from "./useReferenceStates";

export function ComponentFields({ id }: { id: string }) {
  const editor = useEditor();
  const resolved = editor.resolvedComponents[id];
  if (!resolved) return <Banner tone="warning">Composant indisponible : il ne peut pas être détaché.</Banner>;
  return <><p>Composant : {resolved.document.name} · r{resolved.revision}. Sa présentation est définie par le composant.</p><button type="button" className="sb-button" disabled={editor.readOnly} onClick={() => { editor.run({ type: "detach_component", id, resolved }, "Composant détaché."); }}>Détacher</button></>;
}

export function RevisionComposant({ id }: { id: string }) {
  const editor = useEditor();
  const node = findLayoutNode(editor.document, id);
  const [kept, setKept] = useState<number | null>(null);
  const [compare, setCompare] = useState(false);
  if (!node || node.type !== "component") return null;
  const { component_id, revision } = node.component;
  const state = editor.referenceStates[referenceKey({ kind: "component", id: component_id, revision })];
  if (!state || state.state === "unresolved" || state.current_revision <= revision || kept === state.current_revision) return null;
  const current = state.current_revision;
  const approved = state.approved_revision;
  const candidate = editor.document.visibility === "shared" ? approved !== null && approved > revision ? approved : null : current;
  const compareTo = candidate ?? current;
  return <div className="sb-tile__state" aria-label="Révision de composant plus récente"><p>Composant épinglé r{revision} ; révision courante r{current}.</p>
    <button type="button" className="sb-button" onClick={() => { setCompare(!compare); }}>{compare ? "Masquer la comparaison" : "Comparer les révisions"}</button>{" "}
    <button type="button" className="sb-button" disabled={editor.readOnly || candidate === null} onClick={() => { editor.run({ type: "adopt_component_revision", id, revision: candidate as number }, `Révision r${String(candidate)} adoptée.`); }}>Adopter r{candidate ?? current}</button>{" "}
    <button type="button" className="sb-button" onClick={() => { setKept(current); }}>Garder l'épingle</button>
    {candidate === null ? <p>r{current} est un brouillon : un dashboard partagé n’épingle que des révisions approuvées.</p> : null}
    {compare ? <Diff id={component_id} base={revision} other={compareTo} /> : null}
  </div>;
}
function Diff({ id, base, other }: { id: string; base: number; other: number }) {
  const editor = useEditor();
  const diff = useOutcome(`${editor.space}:${editor.identity}:${id}:${String(base)}:${String(other)}`, (signal) => fetchComponentDiff(editor.space, id, base, other, signal, editor.contentSave.fetcher));
  if (diff.status === "loading") return <p>Lecture du diff…</p>;
  if (diff.status !== "ok") return <Banner tone="danger">Diff indisponible : {diff.status === "error" ? diff.message : refusalText(diff)}</Banner>;
  if (!diff.value.changes.length) return <p>Aucune différence structurelle.</p>;
  return <div className="sb-table-wrap" role="group" aria-label="Diff du composant" tabIndex={0}><table className="sb-table"><caption>Diff entre r{base} et r{other}</caption><thead><tr><th>Chemin</th><th>Genre</th><th>Avant</th><th>Après</th></tr></thead><tbody>{diff.value.changes.map((change) => <tr key={change.path}><th scope="row">{pathLabel(change.path)}</th><td>{{ added: "Ajouté", removed: "Retiré", modified: "Modifié" }[change.kind]}</td><td>{display(change.before)}</td><td>{display(change.after)}</td></tr>)}</tbody></table></div>;
}
