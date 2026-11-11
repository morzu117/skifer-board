import type { Kind } from "./commands";
import { ancestors, findNode, type TreeNode } from "./tree";

/**
 * Où la palette pose un nouveau nœud (plan 19, 19.5a) : sous le plus proche ancêtre de la sélection (elle comprise) qui accueille son
 * genre, juste après la branche où se trouve la sélection, ou en queue si c'est cet ancêtre qui est sélectionné. Sans ancêtre qui
 * convienne, rien n'est posé et la raison se dit : la palette ne devine pas un parent. Le modèle d'édition reste seul juge de la
 * validité du résultat.
 */
export const ADDABLE = ["section", "row", "column", "container", "text", "separator"] as const satisfies readonly Kind[];
export type Addable = (typeof ADDABLE)[number];

const PARENT_KINDS: Readonly<Record<Exclude<Addable, "section">, readonly Kind[]>> = {
  row: ["section", "container"],
  column: ["row"],
  container: ["column"],
  text: ["column"],
  separator: ["column"],
};
/** Ce qu'on ajoute et ce qu'il faut sélectionner d'abord, pour le message d'un ajout sans parent. */
const NEEDED: Readonly<Record<Exclude<Addable, "section">, { added: string; parent: string }>> = {
  row: { added: "une rangée", parent: "une section ou un conteneur" },
  column: { added: "une colonne", parent: "une rangée" },
  container: { added: "un conteneur", parent: "une colonne" },
  text: { added: "un texte", parent: "une colonne" },
  separator: { added: "un séparateur", parent: "une colonne" },
};

export type Addition = { parent: string | null; index: number; span?: number } | { refused: string };

/** Douzièmes encore libres dans une rangée : une colonne ajoutée les prend (au moins un, que le modèle refusera si la rangée est pleine). */
const free = (row: TreeNode): number => Math.max(1, 12 - row.children.reduce((sum, column) => sum + (column.span as number), 0));

export function additionPlace(nodes: readonly TreeNode[], kind: Addable, selected: string | null): Addition {
  const node = selected === null ? undefined : findNode(nodes, selected);
  if (kind === "section") {
    const top = node === undefined ? undefined : (ancestors(nodes, node.id)[0] ?? node);
    return { parent: null, index: top === undefined ? nodes.length : top.index + 1 };
  }
  const chain = node === undefined ? [] : [...ancestors(nodes, node.id), node];
  const at = chain.findLastIndex((one) => PARENT_KINDS[kind].includes(one.kind));
  const parent = chain[at];
  if (parent === undefined) return { refused: `Sélectionnez d'abord ${NEEDED[kind].parent} pour y ajouter ${NEEDED[kind].added}.` };
  const branch = chain[at + 1];
  return { parent: parent.id, index: branch === undefined ? parent.children.length : branch.index + 1, ...(kind === "column" ? { span: free(parent) } : {}) };
}

/** Ce qu'on annonce d'un nœud posé : sa nature, sa place parmi ses frères, et son parent. */
export function placed(nodes: readonly TreeNode[], id: string): string {
  const node = findNode(nodes, id) as TreeNode;
  const parent = node.parent === null ? undefined : findNode(nodes, node.parent);
  return `${node.label}, position ${String(node.index + 1)} sur ${String(node.siblings)}${parent === undefined ? "" : `, dans ${parent.label}`}`;
}
