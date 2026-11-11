import { useState, type KeyboardEvent } from "react";

import { Badge } from "../../ui/Badge";
import type { CommonFilter } from "../document";
import { LIMIT_LABELS, PROBLEM_LABELS } from "../labels";
import { FiltreForm, ValeurFiltre } from "./Filtres";
import { filterDomId, treeDomId, useEditor } from "./EditorContext";
import { RevisionAnalyse } from "./RevisionAnalyse";
import type { Problem } from "./problems";
import { findNode, type TreeNode } from "./tree";

export type BottomTab = "problems" | "structure" | "filters";

const TABS: readonly { id: BottomTab; label: string }[] = [
  { id: "problems", label: "Problèmes" },
  { id: "structure", label: "Structure" },
  { id: "filters", label: "Filtres" },
];

const OPERATOR_LABELS: Readonly<Record<CommonFilter["operator"], string>> = { eq: "égal à", in: "parmi", between: "entre" };

/**
 * Le panneau du bas de l'éditeur (plan 19, 19.5a) : les problèmes du dashboard (chacun mène à son nœud), la structure en arbre
 * accessible, et la liste, en lecture seule, des filtres communs et de leurs cibles. L'édition des filtres est l'objet de 19.5b.
 */
export function PanneauBas({ tab, onTab }: { tab: BottomTab; onTab: (tab: BottomTab) => void }) {
  const editor = useEditor();
  const blocking = editor.problems.filter((problem) => problem.severity === "blocking").length;
  const keys = (event: KeyboardEvent<HTMLDivElement>): void => {
    const at = TABS.findIndex((one) => one.id === tab);
    const next = event.key === "ArrowRight" ? at + 1 : event.key === "ArrowLeft" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const found = TABS[(next + TABS.length) % TABS.length] as (typeof TABS)[number];
    onTab(found.id);
    document.getElementById(`sb-bottom-tab-${found.id}`)?.focus();
  };
  return <section className="sb-bottom" aria-label="Panneau du bas">
    <div role="tablist" aria-label="Panneau du bas" className="sb-tabs sb-bottom__tabs" onKeyDown={keys}>
      {TABS.map((one) => <button key={one.id} id={`sb-bottom-tab-${one.id}`} type="button" role="tab" aria-selected={tab === one.id} aria-controls={`sb-bottom-panel-${one.id}`} tabIndex={tab === one.id ? 0 : -1} onClick={() => { onTab(one.id); }}>
        {one.label}{one.id === "problems" ? ` (${String(editor.problems.length)}${blocking > 0 ? `, dont ${String(blocking)} bloquant${blocking > 1 ? "s" : ""}` : ""})` : one.id === "filters" ? ` (${String(editor.document.filters.length)})` : ""}
      </button>)}
    </div>
    {TABS.map((one) => <div key={one.id} id={`sb-bottom-panel-${one.id}`} role="tabpanel" aria-labelledby={`sb-bottom-tab-${one.id}`} hidden={tab !== one.id} className="sb-bottom__panel">
      {tab !== one.id ? null : one.id === "problems" ? <Problems /> : one.id === "structure" ? <Structure /> : <Filters />}
    </div>)}
  </section>;
}

function where(editorNodes: readonly TreeNode[], filters: readonly CommonFilter[], nodeId: string): string {
  if (nodeId === "dashboard") return "Dashboard";
  const filter = filters.find((item) => item.id === nodeId);
  if (filter !== undefined) return `Filtre « ${filter.label} »`;
  return (findNode(editorNodes, nodeId) as TreeNode).label;
}

function detail(problem: Problem): string {
  const parts: string[] = [];
  if (problem.limit !== undefined) parts.push(`limite : ${LIMIT_LABELS[problem.limit] ?? problem.limit}`);
  if (problem.pinned !== undefined && problem.current !== undefined) parts.push(`épinglée r${String(problem.pinned)}, courante r${String(problem.current)}`);
  return parts.join(" · ");
}

function Problems() {
  const editor = useEditor();
  return <>
    {editor.settled ? null : <p role="status" className="sb-bottom__note">Lecture des analyses épinglées en cours : les problèmes de chaque tuile ne sont pas encore tous connus.</p>}
    {editor.catalog === null ? <p className="sb-bottom__note">Catalogue non lu : la compatibilité des filtres avec les dimensions n'est pas vérifiée.</p> : null}
    {editor.problems.length === 0 ? <p className="sb-bottom__note">Aucun problème détecté.</p> : <ul className="sb-problems">
      {editor.problems.map((problem, index) => <li key={`${problem.code}:${problem.nodeId}:${problem.path}:${String(index)}`}>
        <button type="button" className="sb-problems__link" onClick={() => { editor.reveal(problem.nodeId); }}>
          <Badge tone={problem.severity === "blocking" ? "danger" : "warning"}>{problem.severity === "blocking" ? "Bloquant" : "Avertissement"}</Badge>
          {" "}<span>{PROBLEM_LABELS[problem.code]}</span>
          {" "}<span className="sb-problems__where">{where(editor.tree, editor.document.filters, problem.nodeId)}</span>
          {detail(problem) === "" ? null : <span className="sb-problems__detail"> · {detail(problem)}</span>}
          {" "}<span className="sb-mono sb-problems__path">{problem.path}</span>
        </button>
        {problem.code === "revision_behind" ? <RevisionAnalyse id={problem.nodeId} /> : null}
      </li>)}
    </ul>}
    <p className="sb-bottom__note">{editor.problems.some((problem) => problem.severity === "blocking") ? "Un problème bloquant empêche l'enregistrement : corrigez-le d'abord." : "Aucun problème ne bloque l'enregistrement."}</p>
  </>;
}

function Structure() {
  const editor = useEditor();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [current, setCurrent] = useState<string | null>(null);
  const visible: TreeNode[] = [];
  const walk = (nodes: readonly TreeNode[]): void => {
    for (const node of nodes) {
      visible.push(node);
      if (!collapsed.has(node.id)) walk(node.children);
    }
  };
  walk(editor.tree);
  // Un seul élément est dans l'ordre de tabulation : le dernier visité, sinon la sélection, sinon le premier.
  const roving = visible.find((node) => node.id === (current ?? editor.selected))?.id ?? visible[0]?.id;
  const focusOn = (id: string): void => { setCurrent(id); document.getElementById(treeDomId(id))?.focus(); };
  const toggle = (id: string, open: boolean): void => {
    setCollapsed((previous) => { const next = new Set(previous); if (open) next.delete(id); else next.add(id); return next; });
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>, node: TreeNode): void => {
    event.stopPropagation();
    const at = visible.findIndex((one) => one.id === node.id);
    const open = node.children.length > 0 && !collapsed.has(node.id);
    if (event.key === "ArrowDown") focusOn((visible[Math.min(at + 1, visible.length - 1)] as TreeNode).id);
    else if (event.key === "ArrowUp") focusOn((visible[Math.max(at - 1, 0)] as TreeNode).id);
    else if (event.key === "Home") focusOn((visible[0] as TreeNode).id);
    else if (event.key === "End") focusOn((visible.at(-1) as TreeNode).id);
    else if (event.key === "ArrowRight") { if (open) focusOn((node.children[0] as TreeNode).id); else if (node.children.length > 0) toggle(node.id, true); }
    else if (event.key === "ArrowLeft") { if (open) toggle(node.id, false); else if (node.parent !== null) focusOn(node.parent); }
    else if (event.key === "Enter" || event.key === " ") editor.select(node.id);
    else return;
    event.preventDefault();
  };
  // Motif « arbre de navigation » : le nœud est un `treeitem` qui ne contient que son libellé, son groupe d'enfants est son voisin.
  // Ainsi le nom accessible est exactement le texte visible, sans y mêler celui des descendants.
  const render = (nodes: readonly TreeNode[]) => nodes.map((node) => {
    const open = !collapsed.has(node.id);
    return <li key={node.id} role="none" className="sb-structure__item">
      <div
        id={treeDomId(node.id)}
        role="treeitem"
        aria-level={node.level}
        aria-setsize={node.siblings}
        aria-posinset={node.index + 1}
        aria-selected={editor.selected === node.id}
        aria-expanded={node.children.length === 0 ? undefined : open}
        tabIndex={roving === node.id ? 0 : -1}
        className="sb-structure__label"
        onKeyDown={(event) => { keys(event, node); }}
        onClick={() => { setCurrent(node.id); editor.select(node.id); }}
      >{node.label}</div>
      {node.children.length === 0 || !open ? null : <ul role="group">{render(node.children)}</ul>}
    </li>;
  });
  return editor.tree.length === 0 ? <p className="sb-bottom__note">Aucune section : la structure est vide.</p> : <>
    <p className="sb-bottom__note" id="sb-structure-help">Flèches pour parcourir, droite et gauche pour déplier et replier, Entrée pour sélectionner.</p>
    <ul role="tree" aria-label="Structure du dashboard" aria-describedby="sb-structure-help" className="sb-structure">{render(editor.tree)}</ul>
  </>;
}

const text = (values: readonly (string | number | boolean)[]): string => values.map(String).join(", ");

function Filters() {
  const editor = useEditor();
  const { filters } = editor.document;
  const [creating, setCreating] = useState(false);
  return <>
    <button type="button" className="sb-button" disabled={editor.readOnly} onClick={() => { setCreating(!creating); }}>Nouveau filtre</button>
    {creating ? <FiltreForm onDone={() => { setCreating(false); }} /> : null}
    {filters.length === 0 ? <p className="sb-bottom__note">Aucun filtre commun.</p> : null}
    <ul className="sb-filters">
      {filters.map((filter) => <li key={filter.id} id={filterDomId(filter.id)} tabIndex={-1} className="sb-filters__item">
        <button type="button" className="sb-problems__link" onClick={() => { editor.select(filter.id); }}>Propriétés · {filter.label}</button>
        <strong>{filter.label}</strong>
        <dl className="sb-filters__summary">
          <dt>Dimension</dt><dd className="sb-mono">{filter.dimension}</dd>
          <dt>Opérateur</dt><dd>{OPERATOR_LABELS[filter.operator]}</dd>
          <dt>Valeur par défaut</dt><dd>{filter.default === undefined ? "Aucune" : text(Array.isArray(filter.default) ? filter.default : [filter.default as string | number | boolean])}</dd>
          {filter.allowed === undefined ? null : <><dt>Valeurs permises</dt><dd>{text(filter.allowed)}</dd></>}
          <dt>Cibles</dt><dd><Cibles targets={filter.targets} tree={editor.tree} reveal={editor.reveal} /></dd>
        </dl>
        <ValeurFiltre filter={filter} />
      </li>)}
    </ul>
  </>;
}

export function Cibles({ targets, tree, reveal }: { targets: readonly string[]; tree: readonly TreeNode[]; reveal: (id: string) => void }) {
  return targets.length === 0 ? <>Aucune</> : <ul className="sb-filters__targets">{targets.map((target) => <li key={target}>
    <button type="button" className="sb-problems__link" onClick={() => { reveal(target); }}>{(findNode(tree, target) as TreeNode).label}</button>
  </li>)}</ul>;
}

