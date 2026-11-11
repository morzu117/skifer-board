import { useState } from "react";
import { routeHash } from "../../shell/route";
import { useEditor } from "./EditorContext";

/** Une révision plus récente n'est jamais adoptée sans commande explicite. */
export function RevisionAnalyse({ id }: { id: string }) {
  const editor = useEditor();
  const known = editor.analyses[id];
  const [kept, setKept] = useState<number | null>(null);
  if (known === undefined || known.current === null || known.current <= known.pinned.revision || kept === known.current) return null;
  const current = known.current;
  const base = known.pinned.revision;
  const link = routeHash({ page: "analysis", space: editor.space, id: known.pinned.id, view: "history", compare: { base, other: current } });
  return <div className="sb-tile__state" aria-label="Révision d'analyse plus récente">
    <p>Analyse épinglée r{base} ; révision courante r{current}.</p>
    <a href={link} target="_blank" rel="noopener noreferrer">Comparer les révisions</a>{" "}
    <button type="button" className="sb-button" disabled={editor.readOnly} onClick={() => { editor.run({ type: "adopt_revision", id, revision: current }, `Révision r${String(current)} adoptée.`); }}>Adopter r{current}</button>{" "}
    <button type="button" className="sb-button" onClick={() => { setKept(current); }}>Garder l'épingle</button>
  </div>;
}
