import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { executables, type Column, type ExecutableComponent, type LayoutNode, type Row, type Section } from "../document";
import { BlocksView } from "./Blocs";
import { handleDomId, nodeDomId, useEditor } from "./EditorContext";
import { RevisionAnalyse } from "./RevisionAnalyse";
import { placed } from "./placement";
import { dropPlace, flatten, reparentPlace, stepPlace, type TreeNode } from "./tree";
import { Tuile } from "./Tuile";

export const HELP_ID = "sb-canvas-help";

/** Les raccourcis du nœud sélectionné : affichés, et lus par chaque bouton de sélection (`aria-describedby`). */
export const SHORTCUTS: readonly { keys: string; effect: string }[] = [
  { keys: "Entrée ou Espace", effect: "sélectionne le nœud, dont les propriétés s'ouvrent à droite" },
  { keys: "Alt + flèches", effect: "déplace le nœud d'un cran parmi ses frères (haut ou gauche : avant ; bas ou droite : après)" },
  { keys: "Alt + Maj + flèches", effect: "passe le nœud dans le parent précédent (haut ou gauche) ou suivant (bas ou droite)" },
  { keys: "Maj + gauche ou droite, sur une colonne", effect: "réduit ou élargit la colonne d'un douzième" },
  { keys: "Poignée de largeur : flèches, Début, Fin", effect: "règle la largeur d'une colonne de 1 à 12 douzièmes" },
  { keys: "Suppr", effect: "supprime le nœud sélectionné et ce qu'il contient" },
];

interface Hint { id: string; after: boolean }

/** Taille d'une colonne en douzièmes, pendant et après son redimensionnement à la souris. */
interface Preview { id: string; span: number }

const EARLIER = new Set(["ArrowUp", "ArrowLeft"]);
const LATER = new Set(["ArrowDown", "ArrowRight"]);

function index(tree: readonly TreeNode[]): ReadonlyMap<string, TreeNode> {
  return new Map(flatten(tree).map((node) => [node.id, node]));
}

/**
 * La mise en page, dessinée dans l'éditeur (plan 19, 19.5a) : chaque nœud est un cadre dont le bouton le sélectionne, le déplace
 * (glisser-déposer ou clavier) et, pour une colonne, le redimensionne (poignée à la souris, flèches au clavier). Tout passe par
 * les commandes du modèle d'édition : un refus se lit avec sa raison fermée et le document reste tel quel.
 */
export function Canevas() {
  const editor = useEditor();
  const nodes = useMemo(() => index(editor.tree), [editor.tree]);
  const components = useMemo(() => new Map<string, ExecutableComponent>(executables(editor.document).map((component) => [component.id, component])), [editor.document]);
  const dragged = useRef<string | null>(null);
  const [hint, setHint] = useState<Hint | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const sections = editor.document.layout.sections;

  const place = (id: string, next: { parent: string | null; index: number } | null, refused: string, verb: string): void => {
    if (next === null) {
      editor.say(refused, true);
      return;
    }
    editor.run({ type: "move", id, parent: next.parent, index: next.index }, (tree) => `${verb} : ${placed(tree, id)}.`, { focus: nodeDomId(id) });
  };

  // En lecture seule, un raccourci n'est pas ignoré en silence : `run` refuse et dit pourquoi.
  const keys = (event: KeyboardEvent<HTMLButtonElement>, node: TreeNode): void => {
    const direction = EARLIER.has(event.key) ? "earlier" : LATER.has(event.key) ? "later" : null;
    if (event.altKey && direction !== null) {
      event.preventDefault();
      if (event.shiftKey) {
        const next = reparentPlace(editor.tree, node.id, direction === "earlier" ? "previous" : "next");
        place(node.id, next, `${node.label} : aucun parent ${direction === "earlier" ? "précédent" : "suivant"} ne l'accueille.`, "Déplacé dans un autre parent");
      } else {
        place(node.id, stepPlace(editor.tree, node.id, direction), `${node.label} : déjà ${direction === "earlier" ? "en première" : "en dernière"} position.`, "Déplacé");
      }
    } else if (event.shiftKey && !event.altKey && node.kind === "column" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      resize(node, (node.span as number) + (event.key === "ArrowLeft" ? -1 : 1), nodeDomId(node.id));
    } else if (event.key === "Delete" && !event.altKey) {
      event.preventDefault();
      editor.run({ type: "delete", id: node.id }, `${node.label} supprimé, avec ce qu'il contenait.`, { select: node.parent, ...(node.parent === null ? {} : { focus: nodeDomId(node.parent) }) });
    }
  };

  const resize = (node: TreeNode, span: number, focus: string): void => {
    if (span < 1 || span > 12) {
      editor.say(`${node.name} : la largeur reste entre 1 et 12 douzièmes.`, true);
      return;
    }
    editor.run({ type: "resize", id: node.id, span }, () => `${node.name} : largeur ${String(span)} douzièmes sur 12.`, { focus });
  };

  const over = (event: DragEvent<HTMLElement>, node: TreeNode): void => {
    if (dragged.current === null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const after = node.kind === "column" ? event.clientX > rect.left + rect.width / 2 : event.clientY > rect.top + rect.height / 2;
    if (dropPlace(editor.tree, dragged.current, node.id, after) === null) return;
    event.preventDefault();
    event.stopPropagation();
    setHint((previous) => (previous?.id === node.id && previous.after === after ? previous : { id: node.id, after }));
  };

  const drop = (event: DragEvent<HTMLElement>, node: TreeNode): void => {
    const id = dragged.current;
    if (id === null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const after = node.kind === "column" ? event.clientX > rect.left + rect.width / 2 : event.clientY > rect.top + rect.height / 2;
    const next = dropPlace(editor.tree, id, node.id, after);
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    dragged.current = null;
    setHint(null);
    place(id, next, "", "Déplacé");
  };

  const startResize = (event: ReactPointerEvent<HTMLElement>, node: TreeNode): void => {
    const unit = (event.currentTarget.closest("[data-row]") as HTMLElement).getBoundingClientRect().width / 12;
    if (editor.readOnly || unit <= 0) return;
    event.preventDefault();
    const origin = event.clientX;
    const start = node.span as number;
    let span = start;
    const move = (found: PointerEvent): void => {
      span = Math.min(12, Math.max(1, start + Math.round((found.clientX - origin) / unit)));
      setPreview({ id: node.id, span });
    };
    const end = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      setPreview(null);
      if (span !== start) resize(node, span, handleDomId(node.id));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const handleKeys = (event: KeyboardEvent<HTMLElement>, node: TreeNode): void => {
    const span = node.span as number;
    const next = event.key === "ArrowLeft" || event.key === "ArrowDown" ? span - 1 : event.key === "ArrowRight" || event.key === "ArrowUp" ? span + 1 : event.key === "Home" ? 1 : event.key === "End" ? 12 : null;
    if (next === null) return;
    event.preventDefault();
    resize(node, next, handleDomId(node.id));
  };

  // Une fonction, non un composant défini à chaque rendu : un composant neuf démonterait tout le canevas (focus, graphiques) à chaque commande.
  const frame = (id: string, children: ReactNode): ReactNode => {
    const node = nodes.get(id) as TreeNode;
    const selected = editor.selected === id;
    const span = preview?.id === id ? preview.span : node.span;
    return <div
      key={id}
      className={`sb-node sb-node--${node.kind}${selected ? " sb-node--selected" : ""}`}
      data-node={id}
      data-drop={hint?.id === id ? (hint.after ? "after" : "before") : undefined}
      style={span === undefined ? undefined : ({ "--span": span } as React.CSSProperties)}
      onDragOver={(event) => { over(event, node); }}
      onDrop={(event) => { drop(event, node); }}
    >
      <div className="sb-node__bar">
        <button
          type="button"
          id={nodeDomId(id)}
          className="sb-node__select"
          aria-pressed={selected}
          aria-describedby={HELP_ID}
          draggable={!editor.readOnly}
          onClick={() => { editor.select(id); }}
          onKeyDown={(event) => { keys(event, node); }}
          onDragStart={(event) => { event.stopPropagation(); dragged.current = id; event.dataTransfer.setData("text/plain", id); event.dataTransfer.effectAllowed = "move"; }}
          onDragEnd={() => { dragged.current = null; setHint(null); }}
        >{node.label}</button>
        {node.kind === "column" ? <span
          id={handleDomId(id)}
          className="sb-node__handle"
          role="slider"
          tabIndex={editor.readOnly ? -1 : 0}
          aria-label={`Largeur de ${node.name}`}
          aria-orientation="horizontal"
          aria-valuemin={1}
          aria-valuemax={12}
          aria-valuenow={span}
          aria-valuetext={`${String(span)} douzièmes sur 12`}
          aria-readonly={editor.readOnly}
          onKeyDown={(event) => { handleKeys(event, node); }}
          onPointerDown={(event) => { startResize(event, node); }}
        /> : null}
      </div>
      <div className="sb-node__body">{children}</div>
    </div>;
  };

  const leaf = (child: LayoutNode): ReactNode => {
    if (child.type === "container") return frame(child.id, rows(child.rows, "Conteneur vide : ajoutez-y une rangée."));
    if (child.type === "text") return frame(child.id, <BlocksView blocks={child.blocks} />);
    if (child.type === "separator") return frame(child.id, <hr className="sb-node__rule" />);
    const component = components.get(child.id) as ExecutableComponent;
    return frame(child.id, <><Tuile onRestart={() => { editor.restartTile(child.id); }} onCancel={() => { editor.cancelTile(child.id); }} onRetry={() => { editor.retryTile(child.id); }} component={component} state={editor.states.get(child.id)} pinned={editor.analyses[child.id]?.pinned} defaults={editor.document.defaults} catalog={editor.catalog} theme={editor.theme} /><RevisionAnalyse id={child.id} />{(editor.overlaps.get(child.id) ?? []).length === 0 ? null : <p className="sb-tile__state">Filtres de l’analyse et du dashboard appliqués ensemble : {editor.overlaps.get(child.id)?.join(", ")}.</p>}</>);
  };

  const column = (item: Column): ReactNode => frame(item.id, item.children.length === 0 ? <p className="sb-node__empty">Colonne vide : ajoutez-y un texte, un séparateur ou un conteneur.</p> : item.children.map(leaf));

  const rows = (list: readonly Row[], empty: string): ReactNode => (list.length === 0 ? <p className="sb-node__empty">{empty}</p> : list.map((item) => frame(item.id,
    item.columns.length === 0 ? <p className="sb-node__empty">Rangée vide : ajoutez-y une colonne.</p> : <div className="sb-node__columns" data-row>{item.columns.map(column)}</div>)));

  const section = (item: Section): ReactNode => frame(item.id, rows(item.rows, "Section vide : ajoutez-y une rangée."));

  return <section className="sb-canvas" aria-labelledby="sb-canvas-title">
    <h2 id="sb-canvas-title" className="sb-canvas__title">Mise en page</h2>
    <div id={HELP_ID} className="sb-canvas__help">
      <p>Un nœud se sélectionne, se déplace et se redimensionne à la souris comme au clavier. Raccourcis, nœud sélectionné :</p>
      <ul>{SHORTCUTS.map((shortcut) => <li key={shortcut.keys}><kbd>{shortcut.keys}</kbd> : {shortcut.effect}</li>)}</ul>
    </div>
    {sections.length === 0 ? <p className="sb-node__empty">Aucune section : ajoutez-en une avec la palette.</p> : sections.map(section)}
  </section>;
}

