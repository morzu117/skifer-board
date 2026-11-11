import { createContext, useContext } from "react";

import type { ChartTheme } from "../../charts/theme";
import type { Command } from "./commands";
import type { Problem, KnownAnalyses } from "./problems";
import type { TreeNode } from "./tree";
import type { TileState } from "./useTiles";
import type { DashboardDraft } from "../document";
import type { ExplorerModel } from "../../explorer/model";

/** Ce que les panneaux de l'éditeur partagent : le document, la sélection et le seul chemin d'écriture, `run`. */
export interface Editor {
  document: DashboardDraft;
  tree: readonly TreeNode[];
  /** Identifiant du nœud sélectionné, ou `null` : les propriétés du dashboard. */
  selected: string | null;
  select: (id: string | null) => void;
  /**
   * Applique une commande par le modèle d'édition et annonce son résultat (`after.id` est l'identifiant que prendra le nœud ajouté). Rend `true` si elle a été appliquée ; un refus se lit,
   * avec sa raison fermée, dans la zone d'annonces, et le document reste tel quel.
   */
  run: (command: Command, done: string | ((tree: readonly TreeNode[]) => string), after?: { select?: string | null; focus?: string; id?: string }) => boolean;
  /** Dit quelque chose aux lecteurs d'écran, sans toucher au document ; `refused` en fait un refus, affiché en alerte. */
  say: (text: string, refused?: boolean) => void;
  readOnly: boolean;
  states: ReadonlyMap<string, TileState>;
  cancelTile: (id: string) => void;
  retryTile: (id: string) => void;
  restartTile: (id: string) => void;
  analyses: KnownAnalyses;
  catalog: readonly ExplorerModel[] | null;
  problems: readonly Problem[];
  /** Les analyses épinglées sont-elles toutes lues ? Tant que non, des problèmes de tuile peuvent manquer. */
  settled: boolean;
  theme: ChartTheme;
  /** Mène à un nœud (de la mise en page, un filtre ou le dashboard) : sélection, onglet et focus. */
  reveal: (id: string) => void;
}

export const EditorContext = createContext<Editor | null>(null);

export function useEditor(): Editor {
  const editor = useContext(EditorContext);
  if (editor === null) throw new Error("useEditor : hors d'un éditeur");
  return editor;
}

/** Identifiant du bouton qui sélectionne un nœud : le focus y revient après une commande. */
export const nodeDomId = (id: string): string => `sb-node-${id}`;
/** Identifiant de la poignée de largeur d'une colonne. */
export const handleDomId = (id: string): string => `sb-handle-${id}`;

/** Identifiant de la ligne d'un filtre dans l'onglet Filtres, et d'un élément de l'arbre de structure. */
export const filterDomId = (id: string): string => `sb-filter-${id}`;
export const treeDomId = (id: string): string => `sb-tree-${id}`;
