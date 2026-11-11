import type { Column, DashboardDraft, LayoutNode, Row, Section } from "../document";
import type { Kind } from "./commands";

/**
 * Arbre de la mise en page, calculé du document (plan 19, 19.5a) : l'écran le lit pour dessiner la structure, nommer un nœud
 * dans une annonce et calculer l'endroit où une commande de déplacement le pose. Rien ici n'écrit : toute modification du
 * document passe par les commandes du modèle d'édition (`commands.ts`), qui seules jugent si elle est permise.
 */
export interface TreeNode {
  id: string;
  kind: Kind;
  /** `null` pour une section, dont le parent est la mise en page. */
  parent: string | null;
  /** Rang parmi les frères. */
  index: number;
  /** Nombre de frères, lui compris. */
  siblings: number;
  /** Niveau dans l'arbre, 1 pour une section (valeur de `aria-level`). */
  level: number;
  label: string;
  /** Le genre et le rang, sans le détail du libellé : « Section 2 », « Colonne 1 », « Visuel ». */
  name: string;
  /** Largeur en douzièmes, pour une colonne. */
  span?: number;
  children: readonly TreeNode[];
}

/** Titre des tuiles par identifiant de composant : le nom de l'analyse épinglée ou la surcharge de titre. */
export type Titles = Readonly<Record<string, string | undefined>>;

const NODE_LABELS: Readonly<Record<Exclude<Kind, "section" | "row" | "column" | "analysis" | "kpi">, string>> = {
  container: "Conteneur",
  text: "Texte",
  separator: "Séparateur",
};

function layoutNode(node: LayoutNode, parent: string, index: number, siblings: number, level: number, titles: Titles): TreeNode {
  if (node.type === "container") {
    return { id: node.id, kind: "container", parent, index, siblings, level, label: NODE_LABELS.container, name: NODE_LABELS.container, children: rows(node.rows, node.id, level + 1, titles) };
  }
  if (node.type === "analysis" || node.type === "kpi") {
    const name = titles[node.id];
    const kind = node.type === "kpi" ? "KPI" : "Visuel";
    return { id: node.id, kind: node.type, parent, index, siblings, level, label: name === undefined ? kind : `${kind} · ${name}`, name: kind, children: [] };
  }
  return { id: node.id, kind: node.type, parent, index, siblings, level, label: NODE_LABELS[node.type], name: NODE_LABELS[node.type], children: [] };
}

function column(item: Column, parent: string, index: number, siblings: number, level: number, titles: Titles): TreeNode {
  const children = item.children.map((child, at) => layoutNode(child, item.id, at, item.children.length, level + 1, titles));
  return { id: item.id, kind: "column", parent, index, siblings, level, label: `Colonne ${String(index + 1)} · ${String(item.span)}/12`, name: `Colonne ${String(index + 1)}`, span: item.span, children };
}

function rows(list: readonly Row[], parent: string, level: number, titles: Titles): TreeNode[] {
  return list.map((item, index) => ({
    id: item.id,
    kind: "row" as const,
    parent,
    index,
    siblings: list.length,
    level,
    label: `Rangée ${String(index + 1)}`,
    name: `Rangée ${String(index + 1)}`,
    children: item.columns.map((one, at) => column(one, item.id, at, item.columns.length, level + 1, titles)),
  }));
}

function section(item: Section, index: number, siblings: number, titles: Titles): TreeNode {
  const title = item.title === undefined ? "" : ` · ${item.title}`;
  return { id: item.id, kind: "section", parent: null, index, siblings, level: 1, label: `Section ${String(index + 1)}${title}`, name: `Section ${String(index + 1)}`, children: rows(item.rows, item.id, 2, titles) };
}

/** Les sections du document avec tout ce qu'elles contiennent. */
export function buildTree(document: DashboardDraft, titles: Titles = {}): readonly TreeNode[] {
  const sections = document.layout.sections;
  return sections.map((item, index) => section(item, index, sections.length, titles));
}

/** Tous les nœuds, dans l'ordre du document (parent avant ses enfants). */
export function flatten(nodes: readonly TreeNode[]): readonly TreeNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

/** Le nœud d'un identifiant. */
export function findNode(nodes: readonly TreeNode[], id: string): TreeNode | undefined {
  return flatten(nodes).find((node) => node.id === id);
}

/** Les ancêtres d'un nœud, du plus lointain au plus proche, lui exclu. */
export function ancestors(nodes: readonly TreeNode[], id: string): readonly TreeNode[] {
  const found: TreeNode[] = [];
  let parent = findNode(nodes, id)?.parent ?? null;
  while (parent !== null) {
    const node = findNode(nodes, parent) as TreeNode;
    found.unshift(node);
    parent = node.parent;
  }
  return found;
}

/** Où une commande `move` pose un nœud : `index` est le rang final, une fois le nœud retiré de sa place. */
export interface Place {
  parent: string | null;
  index: number;
}

/** Un cran vers le début (`earlier`) ou vers la fin (`later`) parmi les frères, ou `null` au bord. */
export function stepPlace(nodes: readonly TreeNode[], id: string, direction: "earlier" | "later"): Place | null {
  const node = findNode(nodes, id);
  if (node === undefined) return null;
  const index = node.index + (direction === "earlier" ? -1 : 1);
  return index < 0 || index >= node.siblings ? null : { parent: node.parent, index };
}

/** Genres de parents qui accueillent un genre de nœud ; `null` pour une section, qui n'a que la mise en page. */
const IN_COLUMN: readonly Kind[] = ["column"];
const PARENT_KINDS: Readonly<Record<Kind, readonly Kind[] | null>> = {
  section: null,
  row: ["section", "container"],
  column: ["row"],
  container: IN_COLUMN,
  analysis: IN_COLUMN,
  kpi: IN_COLUMN,
  text: IN_COLUMN,
  separator: IN_COLUMN,
};

/**
 * Le parent suivant (`next`, le nœud passe en tête) ou précédent (`previous`, il passe en queue) qui accueille son genre, dans
 * l'ordre du document, hors du nœud lui-même et de ce qu'il contient : un nœud ne se déplace jamais dans son propre arbre.
 */
export function reparentPlace(nodes: readonly TreeNode[], id: string, direction: "previous" | "next"): Place | null {
  const node = findNode(nodes, id);
  const accepted = PARENT_KINDS[node?.kind ?? "section"];
  if (node === undefined || accepted === null) return null;
  const inside = new Set(flatten([node]).map((one) => one.id));
  const parents = flatten(nodes).filter((one) => accepted.includes(one.kind) && !inside.has(one.id));
  const here = parents.findIndex((one) => one.id === node.parent);
  const target = parents[here + (direction === "next" ? 1 : -1)];
  if (target === undefined) return null;
  return { parent: target.id, index: direction === "next" ? 0 : target.children.length };
}

/**
 * Lâcher `dragged` sur `over`. Sur un nœud de la même famille (section, rangée, colonne, ou contenu d'une colonne), avant lui ou
 * après lui selon `after` ; sur le parent qui accueille son genre, en queue. Tout autre lâcher est refusé (`null`) : le pointeur ne propose que ce que le modèle accepterait.
 */
export function dropPlace(nodes: readonly TreeNode[], dragged: string, over: string, after: boolean): Place | null {
  const node = findNode(nodes, dragged);
  const target = findNode(nodes, over);
  if (node === undefined || target === undefined || node.id === target.id) return null;
  if (flatten([node]).some((one) => one.id === target.id)) return null;
  if (PARENT_KINDS[target.kind] === PARENT_KINDS[node.kind]) {
    const rest = (target.parent === null ? nodes : (findNode(nodes, target.parent) as TreeNode).children).filter((one) => one.id !== node.id);
    return { parent: target.parent, index: rest.findIndex((one) => one.id === target.id) + (after ? 1 : 0) };
  }
  const accepted = PARENT_KINDS[node.kind];
  if (accepted?.includes(target.kind) !== true) return null;
  return { parent: target.id, index: target.children.filter((one) => one.id !== node.id).length };
}

/** Le contenu (conteneur, visuel, KPI, texte, séparateur) d'un identifiant, tel que le document le porte. */
export function findLayoutNode(document: DashboardDraft, id: string): LayoutNode | undefined {
  const inRows = (list: readonly Row[]): LayoutNode | undefined => {
    for (const row of list) {
      for (const column of row.columns) {
        for (const child of column.children) {
          if (child.id === id) return child;
          const inner = child.type === "container" ? inRows(child.rows) : undefined;
          if (inner !== undefined) return inner;
        }
      }
    }
    return undefined;
  };
  for (const section of document.layout.sections) {
    const found = inRows(section.rows);
    if (found !== undefined) return found;
  }
  return undefined;
}
