import type { Block, Segment, TextComponent } from "../document";
import { CommitField } from "./Champs";
import { useEditor } from "./EditorContext";
import { findLayoutNode } from "./tree";

/** Un segment de texte d'auteur : texte brut, avec l'emphase ou la graisse qu'il porte, jamais de HTML. */
function Marked({ segment }: { segment: Segment }) {
  const text = segment.emphasis === true ? <em>{segment.text}</em> : segment.text;
  return segment.strong === true ? <strong>{text}</strong> : <>{text}</>;
}

const Segments = ({ list }: { list: readonly Segment[] }) => <>{list.map((segment, index) => <Marked key={index} segment={segment} />)}</>;

/** Lecture des blocs d'un texte : paragraphes, intertitres et listes, tels que le document les porte. */
export function BlocksView({ blocks }: { blocks: readonly Block[] }) {
  if (blocks.length === 0) return <p className="sb-text__empty">Texte vide : ajoutez des blocs dans les propriétés.</p>;
  return <div className="sb-text">{blocks.map((block, index) => {
    if (block.type === "paragraph") return <p key={index}><Segments list={block.content} /></p>;
    // Des paragraphes mis en forme, non des titres : ceux d'un texte d'auteur ne doivent pas bousculer le plan de la page de l'éditeur.
    if (block.type === "heading") return <p key={index} className={`sb-text__heading sb-text__heading--${String(block.level)}`}><span className="sb-visually-hidden">Intertitre de niveau {String(block.level)} : </span><Segments list={block.content} /></p>;
    const items = block.items.map((item, at) => <li key={at}><Segments list={item} /></li>);
    return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
  })}</div>;
}

// -- édition -----------------------------------------------------------------------------------

type Content = readonly Segment[];

/** Un contenu éditable ici est un seul segment : plusieurs segments ou des marques mêlées se modifient hors de l'éditeur, sans rien perdre. */
const single = (content: Content): Segment | null => (content.length === 1 ? (content[0] as Segment) : null);

const PLACEHOLDER = "Nouveau texte";
const NEW_BLOCKS: readonly { label: string; make: () => Block }[] = [
  { label: "Paragraphe", make: () => ({ type: "paragraph", content: [{ text: PLACEHOLDER }] }) },
  { label: "Intertitre 1", make: () => ({ type: "heading", level: 1, content: [{ text: PLACEHOLDER }] }) },
  { label: "Intertitre 2", make: () => ({ type: "heading", level: 2, content: [{ text: PLACEHOLDER }] }) },
  { label: "Liste à puces", make: () => ({ type: "list", ordered: false, items: [[{ text: PLACEHOLDER }]] }) },
  { label: "Liste numérotée", make: () => ({ type: "list", ordered: true, items: [[{ text: PLACEHOLDER }]] }) },
];

const BLOCK_NAMES = { paragraph: "Paragraphe", heading: "Intertitre", list: "Liste" } as const;

/** Un segment simple réécrit : son texte, et l'emphase ou la graisse seulement si elles sont posées. */
const segment = (text: string, marks: { emphasis: boolean; strong: boolean }): Segment => ({ text, ...(marks.emphasis ? { emphasis: true as const } : {}), ...(marks.strong ? { strong: true as const } : {}) });

function SegmentFields({ label, content, disabled, onChange }: { label: string; content: Content; disabled: boolean; onChange: (next: Content) => void }) {
  const found = single(content);
  if (found === null) return <p className="sb-field__hint">{label} : plusieurs segments, non modifiables ici. Le texte reste tel quel.</p>;
  const marks = { emphasis: found.emphasis === true, strong: found.strong === true };
  return <div className="sb-blocks__segment">
    <CommitField label={label} value={found.text} maxLength={1000} disabled={disabled} onCommit={(text) => { onChange([segment(text, marks)]); }} />
    <label className="sb-blocks__mark"><input type="checkbox" checked={marks.strong} disabled={disabled} onChange={(event) => { onChange([segment(found.text, { ...marks, strong: event.target.checked })]); }} /> Gras</label>
    <label className="sb-blocks__mark"><input type="checkbox" checked={marks.emphasis} disabled={disabled} onChange={(event) => { onChange([segment(found.text, { ...marks, emphasis: event.target.checked })]); }} /> Italique</label>
  </div>;
}

function BlockFields({ block, disabled, onChange }: { block: Block; disabled: boolean; onChange: (next: Block) => void }) {
  if (block.type === "paragraph" || block.type === "heading") return <SegmentFields label="Texte" content={block.content} disabled={disabled} onChange={(content) => { onChange({ ...block, content }); }} />;
  const items = block.items;
  const set = (next: readonly Content[]): void => { onChange({ ...block, items: next }); };
  return <>
    <label className="sb-blocks__mark"><input type="checkbox" checked={block.ordered} disabled={disabled} onChange={(event) => { onChange({ ...block, ordered: event.target.checked }); }} /> Liste numérotée</label>
    {items.map((item, index) => <div key={index} className="sb-blocks__item">
      <SegmentFields label={`Élément ${String(index + 1)}`} content={item} disabled={disabled} onChange={(content) => { set(items.map((one, at) => (at === index ? content : one))); }} />
      <button type="button" className="sb-button" disabled={disabled} onClick={() => { set(items.filter((_, at) => at !== index)); }}>Retirer l'élément {index + 1}</button>
    </div>)}
    <button type="button" className="sb-button" disabled={disabled} onClick={() => { set([...items, [{ text: PLACEHOLDER }]]); }}>Ajouter un élément</button>
  </>;
}

/** Édition des blocs d'un texte : chaque modification est une commande `update_blocks` que le modèle valide en entier. */
export function BlocksEditor({ id }: { id: string }) {
  const editor = useEditor();
  const blocks = (findLayoutNode(editor.document, id) as TextComponent).blocks;
  const write = (next: readonly Block[], done: string): void => { editor.run({ type: "update_blocks", id, blocks: next }, done); };
  const swap = (index: number, other: number): void => {
    const next = [...blocks];
    [next[index], next[other]] = [next[other] as Block, next[index] as Block];
    write(next, `Bloc ${String(index + 1)} déplacé en position ${String(other + 1)}.`);
  };
  return <div className="sb-blocks">
    {blocks.length === 0 ? <p className="sb-field__hint">Ce texte n'a aucun bloc.</p> : null}
    {blocks.map((block, index) => <fieldset key={index} className="sb-blocks__block" disabled={editor.readOnly}>
      <legend>Bloc {index + 1} · {BLOCK_NAMES[block.type]}{block.type === "heading" ? ` ${String(block.level)}` : ""}</legend>
      <BlockFields block={block} disabled={editor.readOnly} onChange={(next) => { write(blocks.map((one, at) => (at === index ? next : one)), `Bloc ${String(index + 1)} modifié.`); }} />
      <div className="sb-blocks__actions">
        <button type="button" className="sb-button" disabled={editor.readOnly || index === 0} onClick={() => { swap(index, index - 1); }}>Monter le bloc {index + 1}</button>
        <button type="button" className="sb-button" disabled={editor.readOnly || index === blocks.length - 1} onClick={() => { swap(index, index + 1); }}>Descendre le bloc {index + 1}</button>
        <button type="button" className="sb-button" disabled={editor.readOnly} onClick={() => { write(blocks.filter((_, at) => at !== index), `Bloc ${String(index + 1)} supprimé.`); }}>Supprimer le bloc {index + 1}</button>
      </div>
    </fieldset>)}
    <div className="sb-blocks__add" role="group" aria-label="Ajouter un bloc">
      {NEW_BLOCKS.map((entry) => <button key={entry.label} type="button" className="sb-button" disabled={editor.readOnly} onClick={() => { write([...blocks, entry.make()], `${entry.label} ajouté.`); }}>+ {entry.label}</button>)}
    </div>
  </div>;
}
