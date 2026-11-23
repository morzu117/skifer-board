import { fetchComponents } from "../../components-lib/client";
import { fetchThemes } from "../../themes/client";
import { refusalText } from "../../themes/ContentListPage";
import type { ThemeListItem } from "../../themes/model";
import { Banner } from "../../ui/Banner";
import { useOutcome } from "../../ui/useOutcome";
import { useEditor } from "./EditorContext";
import { referenceKey } from "./useReferenceStates";
import { additionPlace } from "./placement";

/** Les deux révisions peuvent coexister : une approbation antérieure et le brouillon de son auteur. */
export function choices(items: readonly ThemeListItem[], personal: boolean, identity: string) {
  return items.flatMap((item) => [
    ...(item.approvedRevision === null ? [] : [{ id: item.id, name: item.name, revision: item.approvedRevision, draft: false }]),
    ...(personal && item.state === "draft" && JSON.stringify([item.owner.issuer, item.owner.subject]) === identity ? [{ id: item.id, name: item.name, revision: item.revision, draft: true }] : []),
  ]);
}
const key = (id: string, revision: number) => `${id}:${String(revision)}`;

export function ChoixTheme() {
  const editor = useEditor();
  const result = useOutcome(`${editor.space}:${editor.identity}:themes`, (signal) => fetchThemes(editor.space, signal, editor.contentSave.fetcher));
  const options = result.status === "ok" ? choices(result.value.themes, editor.document.visibility === "personal", editor.identity) : [];
  const current = editor.document.theme;
  const value = current ? key(current.theme_id, current.revision) : "";
  const state = current ? editor.referenceStates[referenceKey({ kind: "theme", id: current.theme_id, revision: current.revision })] : undefined;
  const label = state === undefined ? `Thème actuel en cours de lecture · r${String(current?.revision)}` : state.state !== "unresolved" && state.theme ? `${state.theme.name} · r${String(current?.revision)}${state.state === "approved" ? current && state.approved_revision !== null && current.revision < state.approved_revision ? " (ancienne révision approuvée)" : " (approuvée)" : editor.document.visibility === "shared" ? " (brouillon : interdit pour un dashboard partagé)" : " (brouillon)"}` : `Thème actuel indisponible · r${String(current?.revision)}`;
  return <div><label className="sb-field">Thème<select value={value} disabled={editor.readOnly || result.status !== "ok"} onChange={(event) => {
    const choice = options.find((item) => key(item.id, item.revision) === event.target.value);
    if (event.target.value !== "" && !choice) return;
    editor.run({ type: "set_theme", theme: choice ? { theme_id: choice.id, revision: choice.revision } : null }, "Thème modifié.");
  }}><option value="">Skifer clair (par défaut, sans thème)</option>{value && !options.some((item) => key(item.id, item.revision) === value) ? <option value={value}>{label}</option> : null}{options.map((item) => <option key={key(item.id, item.revision)} value={key(item.id, item.revision)}>{item.name} · r{item.revision}{item.draft ? " · brouillon" : ""}</option>)}</select></label>
    {result.status === "loading" ? <p>Lecture des thèmes…</p> : result.status !== "ok" ? <Banner tone="danger">Thèmes indisponibles : {result.status === "error" ? result.message : refusalText(result)}</Banner> : result.value.unreadable > 0 ? <Banner tone="warning">Certains thèmes sont illisibles.</Banner> : null}
  </div>;
}

export function ChoixComposants() {
  const editor = useEditor();
  const result = useOutcome(`${editor.space}:${editor.identity}:components`, (signal) => fetchComponents(editor.space, signal, editor.contentSave.fetcher));
  const options = result.status === "ok" ? choices(result.value.components, editor.document.visibility === "personal", editor.identity) : [];
  return <section aria-label="Composants approuvés"><h3>Composants approuvés</h3>
    {result.status === "loading" ? <p>Lecture des composants…</p> : result.status !== "ok" ? <Banner tone="danger">Composants indisponibles : {result.status === "error" ? result.message : refusalText(result)}</Banner> : <>{result.value.unreadable > 0 ? <Banner tone="warning">Certains composants sont illisibles.</Banner> : null}{options.length === 0 ? <p>Aucun composant approuvé dans cet espace.</p> : <div className="sb-palette__buttons">{options.map((item) => <button key={key(item.id, item.revision)} type="button" className="sb-button" disabled={editor.readOnly} onClick={() => {
      const place = additionPlace(editor.tree, "text", editor.selected);
      if ("refused" in place || place.parent === null) { editor.say("Sélectionnez d'abord une colonne pour y ajouter un composant.", true); return; }
      const id = crypto.randomUUID();
      editor.run({ type: "insert_component", parent: place.parent, index: place.index, component: { component_id: item.id, revision: item.revision } }, "Composant ajouté.", { id, select: id });
    }}>+ {item.name} · r{item.revision}{item.draft ? " · brouillon" : ""}</button>)}</div>}</>}
  </section>;
}
