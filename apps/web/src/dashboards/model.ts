import { instant } from "../catalogue/decode";
import { decodeName, decodePerson, type Person, type Visibility } from "../analyses/document";
import { coherentRights, decodePermissions, READ_STATES, LIST_STATES, type ListState, type Permissions, type ReadState } from "../analyses/model";
import { commit, count, distinct, exact, fail, flag, items, pick, record, revision, uuid, word } from "../analyses/shape";
import { decodeDashboard, decodeOwn, DEFAULT_VALUES, executables, HEADER_VALUES, NODE_TYPES, optionalOwn, type DashboardDocument, type OwnNode } from "./document";

/** Réponses des routes `/api/spaces/{space_id}/dashboards…` (plan 19, 19.2), décodées sans rien compléter. */

/** Raisons fermées pour lesquelles une tuile est indisponible. */
export const TILE_REASONS = ["analysis_unavailable", "unresolved_reference", "filter_incompatible"] as const;
export type TileReason = (typeof TILE_REASONS)[number];

/**
 * État d'un composant exécutable pour la personne qui lit : prêt, indisponible avec sa raison, ou invérifiable quand le
 * catalogue ou la base ne permettent rien d'affirmer. Ni nom, ni modèle, ni requête d'analyse : rien de son contenu.
 */
export type Tile = { id: string; state: "ready" | "unverified" } | { id: string; state: "unavailable"; reason: TileReason };

/** Une révision lue, créée ou revue : le document, l'état de ses tuiles et ce que le serveur en dit. */
export interface DashboardRevision {
  id: string;
  space: string;
  revision: number;
  /** `null` : le dashboard est supprimé, son historique reste lisible de son propriétaire. */
  currentRevision: number | null;
  commit: string;
  committedAt: Date;
  revisedBy: Person;
  /** Priorité `index_stale`, `unverified`, `unresolved_reference`, `ready` (`READ_STATES`). */
  state: ReadState;
  tiles: readonly Tile[];
  permissions: Permissions;
  dashboard: DashboardDocument;
}

function tile(value: unknown, path: string): Tile {
  const state = pick(record(value, path).state, ["ready", "unavailable", "unverified"] as const, `${path}.state`);
  // `reason` accompagne `unavailable` et lui seul : une tuile prête ou invérifiable ne dit rien de plus.
  if (state !== "unavailable") {
    const found = exact(value, ["id", "state"], path);
    return { id: uuid(found.id, `${path}.id`), state };
  }
  const found = exact(value, ["id", "state", "reason"], path);
  return { id: uuid(found.id, `${path}.id`), state, reason: pick(found.reason, TILE_REASONS, `${path}.reason`) };
}

/**
 * États des tuiles et état global se tiennent (`dashboard_web.py`, `state_of` et `_tile`) : sans catalogue lisible, une
 * analyse lisible reste `unverified` et rien n'est ni prêt ni non résolu ; avec catalogue, plus rien n'est invérifiable.
 * Puis `unverified` est l'état d'un catalogue illisible, `unresolved_reference` celui d'une tuile indisponible sans tuile
 * invérifiable, `ready` celui où toutes les tuiles le sont. `index_stale` l'emporte sur tout et n'ajoute aucune contrainte.
 */
function coherentState(state: ReadState, tiles: readonly Tile[]): boolean {
  const unverified = tiles.some((one) => one.state === "unverified");
  const known = tiles.some((one) => one.state === "ready" || (one.state === "unavailable" && one.reason !== "analysis_unavailable"));
  if (unverified && known) return false;
  switch (state) {
    case "index_stale":
      return true;
    case "unverified":
      return !known;
    case "unresolved_reference":
      return !unverified && tiles.some((one) => one.state === "unavailable");
    case "ready":
      return tiles.every((one) => one.state === "ready");
  }
}

export function decodeDashboardRevision(value: unknown, space: string, path = "révision"): DashboardRevision {
  const found = exact(value, ["id", "space_id", "revision", "current_revision", "commit", "committed_at", "revised_by", "state", "components", "permissions", "dashboard"], path);
  const id = uuid(found.id, `${path}.id`);
  if (found.space_id !== space) return fail(`${path}.space_id`, "espace demandé");
  const number = revision(found.revision, `${path}.revision`);
  const current = found.current_revision === null ? null : revision(found.current_revision, `${path}.current_revision`);
  const state = pick(found.state, READ_STATES, `${path}.state`);
  const tiles = items(found.components, `${path}.components`, 40).map((item, index) => tile(item, `${path}.components[${String(index)}]`));
  const rights = decodePermissions(found.permissions, `${path}.permissions`);
  const dashboard = decodeDashboard(found.dashboard, `${path}.dashboard`);
  if (dashboard.id !== id) return fail(`${path}.dashboard.id`, "identifiant de la révision");
  if (current !== null && number > current) return fail(`${path}.revision`, "révision au plus égale à la courante");
  // Une tuile par composant exécutable, dans l'ordre du document : ni plus, ni moins, ni autre.
  const pinned = executables(dashboard);
  if (tiles.length !== pinned.length || tiles.some((one, index) => one.id !== pinned[index]?.id)) return fail(`${path}.components`, "une tuile par composant exécutable, dans l'ordre du document");
  if (!coherentState(state, tiles)) return fail(`${path}.state`, "état cohérent avec les tuiles");
  // Un écart d'index ne se juge que sur la révision courante.
  if (state === "index_stale" && current !== number) return fail(`${path}.state`, "écart d'index sur la révision courante");
  if (!coherentRights(rights, dashboard.visibility, current)) return fail(`${path}.permissions`, "droits cohérents avec le dashboard");
  return {
    id,
    space,
    revision: number,
    currentRevision: current,
    commit: commit(found.commit, `${path}.commit`),
    committedAt: instant(found.committed_at, `${path}.committed_at`),
    revisedBy: decodePerson(found.revised_by, `${path}.revised_by`),
    state,
    tiles,
    permissions: rights,
    dashboard,
  };
}

export interface DashboardListItem {
  id: string;
  name: string;
  visibility: Visibility;
  owner: Person;
  isOwner: boolean;
  revision: number;
  commit: string;
  committedAt: Date;
  state: ListState;
}
export interface DashboardList {
  dashboards: readonly DashboardListItem[];
  /** Dashboards de la personne que le serveur n'a pas pu relire ; jamais ceux des autres. */
  unreadable: number;
}

function listItem(value: unknown, path: string): DashboardListItem {
  const found = exact(value, ["id", "name", "visibility", "owner", "is_owner", "revision", "commit", "committed_at", "state"], path);
  const visibility = pick(found.visibility, ["personal", "shared"] as const, `${path}.visibility`);
  const isOwner = flag(found.is_owner, `${path}.is_owner`);
  // Un dashboard personnel n'est listé que pour son propriétaire.
  if (visibility === "personal" && !isOwner) return fail(`${path}.is_owner`, "propriétaire d'un dashboard personnel");
  return {
    id: uuid(found.id, `${path}.id`),
    name: decodeName(found.name, `${path}.name`),
    visibility,
    owner: decodePerson(found.owner, `${path}.owner`),
    isOwner,
    revision: revision(found.revision, `${path}.revision`),
    commit: commit(found.commit, `${path}.commit`),
    committedAt: instant(found.committed_at, `${path}.committed_at`),
    state: pick(found.state, LIST_STATES, `${path}.state`),
  };
}

export function decodeDashboardList(value: unknown): DashboardList {
  const found = exact(value, ["dashboards", "unreadable"], "liste");
  const dashboards = items(found.dashboards, "liste.dashboards", Number.MAX_SAFE_INTEGER).map((item, index) => listItem(item, `liste.dashboards[${String(index)}]`));
  distinct(dashboards.map((item) => item.id), "liste.dashboards");
  return { dashboards, unreadable: count(found.unreadable, "liste.unreadable") };
}

// -- écart --------------------------------------------------------------------------------------

export const DIFF_KINDS = ["added", "removed", "modified", "moved"] as const;
/** Parents de premier niveau : sections sous la mise en page, filtres sous leur liste. */
export const TOP_PARENTS = ["layout", "filters"] as const;
/** Nœuds d'un écart : l'en-tête et les défauts, puis chaque genre de nœud à identifiant. */
export const DIFF_NODES = ["dashboard", "defaults", "section", "row", "column", "filter", ...NODE_TYPES] as const;
export type DiffNode = (typeof DIFF_NODES)[number];

/** Où un nœud déplacé se trouve : son parent (identifiant, `layout` ou `filters`) et son rang parmi les frères. */
export interface Place {
  parent: string;
  index: number;
}

export interface DashboardChange {
  /** Chemin dans le second document (dans le premier pour un retrait). */
  path: string;
  kind: (typeof DIFF_KINDS)[number];
  node: DiffNode;
  /** `null` pour l'en-tête et les défauts, l'identifiant du nœud sinon. */
  id: string | null;
  before: unknown;
  after: unknown;
}
export interface DashboardDiff {
  id: string;
  base: number;
  other: number;
  changes: readonly DashboardChange[];
}

const CHANGE_PATH = /^(?:\/[A-Za-z0-9_]{1,64})+$/;
const ROW = String.raw`\/layout\/sections\/\d+\/rows\/\d+(?:\/columns\/\d+\/children\/\d+\/rows\/\d+)*`;
const COLUMN = `${ROW}${String.raw`\/columns\/\d+`}`;
const CHILD = `${COLUMN}${String.raw`\/children\/\d+`}`;
/** Chemin attendu de chaque genre de nœud : où il se trouve dans le document. */
const NODE_PATH: Readonly<Record<Exclude<DiffNode, "dashboard" | "defaults">, RegExp>> = {
  section: /^\/layout\/sections\/\d+$/,
  filter: /^\/filters\/\d+$/,
  row: new RegExp(`^${ROW}$`),
  column: new RegExp(`^${COLUMN}$`),
  container: new RegExp(`^${CHILD}$`),
  analysis: new RegExp(`^${CHILD}$`),
  kpi: new RegExp(`^${CHILD}$`),
  text: new RegExp(`^${CHILD}$`),
  separator: new RegExp(`^${CHILD}$`),
};

/** Le côté d'un ajout ou d'un retrait où le nœud n'existe pas : `null`. */
const absent = (value: unknown, path: string): null => (value === null ? null : fail(path, "valeur absente du côté sans nœud"));

/** Une valeur contient-elle un nombre ? Le serveur distingue `1` de `1.0`, que JSON.parse confond : l'égalité n'y prouve rien. */
function numeric(value: unknown): boolean {
  if (typeof value === "number") return true;
  if (Array.isArray(value)) return value.some(numeric);
  return typeof value === "object" && value !== null && Object.values(value).some(numeric);
}

/** Forme canonique d'une valeur JSON décodée : clés triées, pour comparer deux valeurs sans tenir compte de leur ordre. */
const canonical = (value: unknown): unknown => (Array.isArray(value)
  ? value.map(canonical)
  : typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => (left < right ? -1 : 1)).map(([name, item]) => [name, canonical(item)]))
    : value);

/** Deux valeurs JSON décodées sont-elles les mêmes ? */
const same = (left: unknown, right: unknown): boolean => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

/**
 * Une modification ne porte que les champs propres qui diffèrent : un champ absent d'un côté est absent du dictionnaire,
 * ce que seul un champ facultatif permet ; un champ des deux côtés a deux valeurs différentes, sauf si un nombre peut
 * cacher un `1` devenu `1.0`.
 */
function modification(node: OwnNode, before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>, path: string): void {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  if (names.size === 0) fail(path, "un champ qui diffère");
  for (const name of names) {
    if (Object.hasOwn(before, name) && Object.hasOwn(after, name)) {
      if (same(before[name], after[name]) && !numeric(before[name])) fail(`${path}.${name}`, "valeurs différentes");
    } else if (!optionalOwn(node).includes(name)) {
      fail(`${path}.${name}`, "champ présent des deux côtés");
    }
  }
}

/** `{parent, index}` : un parent connu (identifiant ou parent de premier niveau) et un rang. */
function place(value: unknown, path: string): Place {
  const found = exact(value, ["parent", "index"], path);
  const parent = word(found.parent, `${path}.parent`);
  if (!(TOP_PARENTS as readonly string[]).includes(parent)) uuid(parent, `${path}.parent`);
  return { parent, index: count(found.index, `${path}.index`) };
}

function change(value: unknown, path: string): DashboardChange {
  const found = exact(value, ["path", "kind", "node", "id", "before", "after"], path);
  const where = word(found.path, `${path}.path`);
  if (!CHANGE_PATH.test(where)) return fail(`${path}.path`, "chemin JSON");
  const kind = pick(found.kind, DIFF_KINDS, `${path}.kind`);
  const node = pick(found.node, DIFF_NODES, `${path}.node`);
  if (node === "dashboard" || node === "defaults") {
    // L'en-tête et les défauts se comparent feuille par feuille : pas d'identifiant, jamais de déplacement.
    if (found.id !== null) return fail(`${path}.id`, "aucun identifiant pour l'en-tête et les défauts");
    if (kind === "moved") return fail(`${path}.kind`, "écart sans déplacement");
    const values = node === "dashboard" ? HEADER_VALUES : DEFAULT_VALUES;
    const decoder = Object.hasOwn(values, where) ? values[where] : undefined;
    if (decoder === undefined) return fail(`${path}.path`, `chemin d'un champ ${node === "dashboard" ? "de l'en-tête" : "des défauts"}`);
    // L'en-tête a toujours tous ses champs : il ne s'y ajoute ni ne s'y retire rien. Les défauts sont facultatifs un à un.
    if (node === "dashboard" && kind !== "modified") return fail(`${path}.kind`, "champ de l'en-tête modifié");
    const before = kind === "added" ? absent(found.before, `${path}.before`) : decoder(found.before, `${path}.before`);
    const after = kind === "removed" ? absent(found.after, `${path}.after`) : decoder(found.after, `${path}.after`);
    if (kind === "modified" && same(before, after)) return fail(path, "valeurs différentes");
    return { path: where, kind, node, id: null, before, after };
  }
  const id = uuid(found.id, `${path}.id`);
  if (!NODE_PATH[node].test(where)) return fail(`${path}.path`, `chemin d'un nœud ${node}`);
  if (kind === "moved") {
    const from = place(found.before, `${path}.before`);
    const to = place(found.after, `${path}.after`);
    // Les sections et les filtres sont déplacés sous leur liste, tous les autres sous un nœud du document.
    // Un nœud peut garder son parent et son rang : le serveur marque déplacé tout frère hors de la plus longue suite
    // restée dans l'ordre, et un frère retourné au milieu y échappe sans que son rang change.
    const top = node === "section" ? "layout" : node === "filter" ? "filters" : null;
    if ([from.parent, to.parent].some((parent) => (top === null ? (TOP_PARENTS as readonly string[]).includes(parent) : parent !== top))) return fail(path, "parent cohérent avec le nœud");
    return { path: where, kind, node, id, before: from, after: to };
  }
  const complete = kind !== "modified";
  const before = kind === "added" ? absent(found.before, `${path}.before`) : decodeOwn(node, found.before, `${path}.before`, complete);
  const after = kind === "removed" ? absent(found.after, `${path}.after`) : decodeOwn(node, found.after, `${path}.after`, complete);
  if (kind === "modified") modification(node, before as Readonly<Record<string, unknown>>, after as Readonly<Record<string, unknown>>, path);
  return { path: where, kind, node, id, before, after };
}

export function decodeDashboardDiff(value: unknown, id: string, base: number, other: number): DashboardDiff {
  const found = exact(value, ["id", "base", "other", "changes"], "écart");
  if (found.id !== id || found.base !== base || found.other !== other) return fail("écart", "dashboard et révisions demandés");
  return { id, base, other, changes: items(found.changes, "écart.changes", Number.MAX_SAFE_INTEGER).map((item, index) => change(item, `écart.changes[${String(index)}]`)) };
}

export { decodeHistory as decodeDashboardHistory, type History as DashboardHistory } from "../analyses/model";
