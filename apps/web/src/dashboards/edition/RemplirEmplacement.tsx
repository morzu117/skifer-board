import { useState } from "react";
import { fetchComponents, fetchComponentRevision } from "../../components-lib/client";
import { refusalText } from "../../themes/ContentListPage";
import { Banner } from "../../ui/Banner";
import { Dialog } from "../../ui/Dialog";
import { useOutcome } from "../../ui/useOutcome";
import { AjouterAnalyse } from "./AjouterAnalyse";
import { choices } from "./ChoixContenus";
import { useEditor } from "./EditorContext";

export function RemplirEmplacement({ id, expected, label }: { id: string; label: string; expected: "visual" | "kpi" }) {
  const editor = useEditor();
  const [mode, setMode] = useState<"closed" | "choose" | "analysis">("closed");
  return <><button type="button" className="sb-button" aria-label={`Remplir l'emplacement ${label}`} disabled={editor.readOnly} onClick={() => { setMode("choose"); }}>Remplir</button>
    {mode === "choose" ? <Dialog title={`Remplir l'emplacement ${label}`} onClose={() => { setMode("closed"); }}><p>Genre attendu : {expected === "visual" ? "Visuel" : "KPI"}.</p><button type="button" data-autofocus className="sb-button" onClick={() => { setMode("analysis"); }}>Choisir une analyse</button><ChoixComposant id={id} expected={expected} close={() => { setMode("closed"); }} /><button type="button" className="sb-button" onClick={() => { setMode("closed"); }}>Fermer</button></Dialog> : null}
    {mode === "analysis" ? <AjouterAnalyse space={editor.space} fetcher={editor.contentSave.fetcher} slot={{ id, expected, label }} onClose={() => { setMode("closed"); }} /> : null}
  </>;
}
function ChoixComposant({ id, expected, close }: { id: string; expected: "visual" | "kpi"; close: () => void }) {
  const editor = useEditor();
  const list = useOutcome(`${editor.space}:${editor.identity}:slot:${editor.document.visibility}`, async (signal) => {
    const found = await fetchComponents(editor.space, signal, editor.contentSave.fetcher);
    if (found.status !== "ok") return found;
    const options = choices(found.value.components, editor.document.visibility === "personal", editor.identity);
    const reads = await Promise.all(options.map(async (option) => ({ option, result: await fetchComponentRevision(editor.space, option.id, option.revision, signal, editor.contentSave.fetcher) })));
    return { status: "ok" as const, value: { reads, unreadable: found.value.unreadable } };
  });
  if (list.status === "loading") return <p>Lecture des composants…</p>;
  if (list.status !== "ok") return <Banner tone="danger">Composants indisponibles : {list.status === "error" ? list.message : refusalText(list)}</Banner>;
  const matching = list.value.reads.flatMap(({ option, result }) => result.status === "ok" && result.value.component.kind === expected ? [{ option, document: result.value.component }] : []);
  return <section aria-label="Choisir un composant"><h3>Choisir un composant</h3>{list.value.unreadable > 0 ? <Banner tone="warning">Certains composants sont illisibles.</Banner> : null}{list.value.reads.map(({ option, result }) => result.status === "ok" ? null : <Banner key={`${option.id}:${String(option.revision)}`} tone="danger">{option.name} · r{option.revision} : {result.status === "error" ? result.message : refusalText(result)}</Banner>)}{matching.length === 0 ? <p>Aucun composant compatible disponible.</p> : <div className="sb-palette__buttons">{matching.map(({ option, document }) => {
    const resolved = { document, revision: option.revision };
    return <button type="button" className="sb-button" key={`${option.id}:${String(option.revision)}`} onClick={() => {
      if (editor.run({ type: "fill_slot", id, value: { source: "component", kind: expected, component: { component_id: option.id, revision: option.revision }, resolved } }, "Emplacement rempli.", { select: id })) close();
    }}>{option.name} · r{option.revision}{option.draft ? " · brouillon" : ""}</button>;
  })}</div>}</section>;
}
