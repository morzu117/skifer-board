import { accord, GENDERS, KIND_LABELS } from "../labels";
import { useEditor } from "./EditorContext";
import { ADDABLE, additionPlace, placed, type Addable } from "./placement";

const ARTICLES: Readonly<Record<Addable, string>> = {
  section: "une section", row: "une rangée", column: "une colonne", container: "un conteneur", text: "un texte", separator: "un séparateur",
};

/**
 * La palette (plan 19, 19.5a) : section, rangée, colonne, conteneur, texte, séparateur. Un nœud est posé après la sélection, dans le
 * plus proche parent qui accueille son genre ; sans parent qui convienne, la palette le dit au lieu d'en deviner un. Ajouter une
 * analyse ou un KPI est l'objet de 19.5b : rien ici n'épingle ni n'exécute.
 */
export function Palette({ onAddAnalysis }: { onAddAnalysis: () => void }) {
  const editor = useEditor();
  const add = (kind: Addable): void => {
    const where = additionPlace(editor.tree, kind, editor.selected);
    if ("refused" in where) {
      editor.say(where.refused, true);
      return;
    }
    const id = crypto.randomUUID();
    editor.run(
      { type: "add", kind, parent: where.parent, index: where.index, ...(where.span === undefined ? {} : { value: { span: where.span } }) },
      (tree) => `${KIND_LABELS[kind]} ${accord("ajouté", GENDERS.kind[kind])} : ${placed(tree, id)}.`,
      { select: id, id },
    );
  };
  return <section className="sb-palette" aria-labelledby="sb-palette-title">
    <h2 id="sb-palette-title" className="sb-palette__title">Palette</h2>
    <p className="sb-palette__note">Le nœud est posé après la sélection, dans le plus proche parent qui l'accueille. Ajouter une analyse : Ctrl ou Cmd + Maj + A.</p>
    <div className="sb-palette__buttons" role="group" aria-label="Ajouter un nœud">
      {ADDABLE.map((kind) => <button key={kind} type="button" className="sb-button" disabled={editor.readOnly} aria-label={`Ajouter ${ARTICLES[kind]}`} onClick={() => { add(kind); }}>+ {KIND_LABELS[kind]}</button>)}
      <button type="button" className="sb-button" disabled={editor.readOnly} onClick={onAddAnalysis}>Ajouter une analyse</button>
    </div>
  </section>;
}
