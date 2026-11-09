import { instant } from "../catalogue/decode";
import { decodeExecution, type Execution } from "../executions/model";
import { decodeAnalysis, decodeName, decodeNames, decodePerson, type AnalysisDocument, type Person, type Visibility } from "./document";
import { decodeConsumerList, decodeViolations, REFERENCE_RULES, type Consumer, type Violation } from "./refusal";
import { commit, count, distinct, exact, fail, flag, identifier, items, MAX_REVISION, pick, record, revision, uuid, word } from "./shape";

/** Réponses des routes `/api/spaces/{space_id}/analyses…` (plan 18, 18.2 et 18.3), décodées sans rien compléter. */

/** États d'une analyse relue, du plus fort au plus faible (plan 18, A6) : le premier qui s'applique l'emporte. */
export const READ_STATES = ["index_stale", "unverified", "unresolved_reference", "ready"] as const;
export type ReadState = (typeof READ_STATES)[number];
/** États d'une ligne de liste : l'index dit ce que git dit, ou ne le dit plus. */
export const LIST_STATES = ["indexed", "index_stale"] as const;
export type ListState = (typeof LIST_STATES)[number];
export const ACTIONS = ["save", "delete"] as const;
export const USAGE_KINDS = ["saved", "opened", "executed"] as const;
export const CHANGE_KINDS = ["added", "removed", "modified"] as const;

export interface Permissions {
  owner: boolean;
  revise: boolean;
  delete: boolean;
  duplicate: boolean;
}

/** Une révision lue, créée ou revue : le document et ce que le serveur en dit. */
export interface AnalysisRevision {
  id: string;
  space: string;
  revision: number;
  /** `null` : l'analyse est supprimée, son historique reste lisible de son propriétaire. */
  currentRevision: number | null;
  commit: string;
  committedAt: Date;
  revisedBy: Person;
  state: ReadState;
  unresolved: readonly Violation<(typeof REFERENCE_RULES)[number]>[];
  permissions: Permissions;
  analysis: AnalysisDocument;
}

export function decodePermissions(value: unknown, path: string): Permissions {
  const found = exact(value, ["owner", "revise", "delete", "duplicate"], path);
  return { owner: flag(found.owner, `${path}.owner`), revise: flag(found.revise, `${path}.revise`), delete: flag(found.delete, `${path}.delete`), duplicate: flag(found.duplicate, `${path}.duplicate`) };
}

/**
 * Les droits que le serveur calcule ont une forme (plan 18, A5 ; plan 19, B6) : réviser et supprimer vont ensemble, rien
 * sur un contenu supprimé, et un contenu personnel n'est jamais rendu à qui n'en est pas le propriétaire.
 */
export function coherentRights(rights: Permissions, visibility: Visibility, current: number | null): boolean {
  return rights.revise === rights.delete && !(current === null && (rights.revise || rights.duplicate)) && !(rights.revise && !rights.owner && visibility !== "shared") && !(visibility === "personal" && !rights.owner);
}

export function decodeRevision(value: unknown, space: string, path = "révision"): AnalysisRevision {
  const found = exact(value, ["id", "space_id", "revision", "current_revision", "commit", "committed_at", "revised_by", "state", "unresolved", "permissions", "analysis"], path);
  const id = uuid(found.id, `${path}.id`);
  if (found.space_id !== space) return fail(`${path}.space_id`, "espace demandé");
  const number = revision(found.revision, `${path}.revision`);
  const current = found.current_revision === null ? null : revision(found.current_revision, `${path}.current_revision`);
  const state = pick(found.state, READ_STATES, `${path}.state`);
  const unresolved = decodeViolations(found.unresolved, REFERENCE_RULES, `${path}.unresolved`, 0);
  const rights = decodePermissions(found.permissions, `${path}.permissions`);
  const analysis = decodeAnalysis(found.analysis, `${path}.analysis`);
  if (analysis.id !== id) return fail(`${path}.analysis.id`, "identifiant de la révision");
  if (current !== null && number > current) return fail(`${path}.revision`, "révision au plus égale à la courante");
  // L'état dit tout ou rien de la liste : des références disparues ne se lisent qu'avec `unresolved_reference`.
  if ((unresolved.length > 0) !== (state === "unresolved_reference")) return fail(`${path}.unresolved`, "références cohérentes avec l'état");
  // Un écart d'index ne se juge que sur la révision courante.
  if (state === "index_stale" && current !== number) return fail(`${path}.state`, "écart d'index sur la révision courante");
  if (!coherentRights(rights, analysis.visibility, current)) return fail(`${path}.permissions`, "droits cohérents avec l'analyse");
  return {
    id,
    space,
    revision: number,
    currentRevision: current,
    commit: commit(found.commit, `${path}.commit`),
    committedAt: instant(found.committed_at, `${path}.committed_at`),
    revisedBy: decodePerson(found.revised_by, `${path}.revised_by`),
    state,
    unresolved,
    permissions: rights,
    analysis,
  };
}

export interface AnalysisListItem {
  id: string;
  name: string;
  visibility: AnalysisDocument["visibility"];
  owner: Person;
  isOwner: boolean;
  revision: number;
  commit: string;
  committedAt: Date;
  model: string;
  metrics: readonly string[];
  state: ListState;
}
export interface AnalysisList {
  analyses: readonly AnalysisListItem[];
  /** Analyses de la personne que le serveur n'a pas pu relire ; jamais celles des autres. */
  unreadable: number;
}

function listItem(value: unknown, path: string): AnalysisListItem {
  const found = exact(value, ["id", "name", "visibility", "owner", "is_owner", "revision", "commit", "committed_at", "model", "metrics", "state"], path);
  const visibility = pick(found.visibility, ["personal", "shared"] as const, `${path}.visibility`);
  const isOwner = flag(found.is_owner, `${path}.is_owner`);
  // Une analyse personnelle n'est listée que pour son propriétaire.
  if (visibility === "personal" && !isOwner) return fail(`${path}.is_owner`, "propriétaire d'une analyse personnelle");
  return {
    id: uuid(found.id, `${path}.id`),
    name: decodeName(found.name, `${path}.name`),
    visibility,
    owner: decodePerson(found.owner, `${path}.owner`),
    isOwner,
    revision: revision(found.revision, `${path}.revision`),
    commit: commit(found.commit, `${path}.commit`),
    committedAt: instant(found.committed_at, `${path}.committed_at`),
    model: identifier(found.model, `${path}.model`),
    metrics: decodeNames(found.metrics, `${path}.metrics`, 1),
    state: pick(found.state, LIST_STATES, `${path}.state`),
  };
}

export function decodeAnalysisList(value: unknown): AnalysisList {
  const found = exact(value, ["analyses", "unreadable"], "liste");
  const analyses = items(found.analyses, "liste.analyses", Number.MAX_SAFE_INTEGER).map((item, index) => listItem(item, `liste.analyses[${String(index)}]`));
  distinct(analyses.map((item) => item.id), "liste.analyses");
  return { analyses, unreadable: count(found.unreadable, "liste.unreadable") };
}

/** Une entrée visible de l'historique, ou une révision masquée réduite à son numéro. */
export type HistoryEntry =
  | { revision: number; available: true; commit: string; committedAt: Date; actor: Person; action: (typeof ACTIONS)[number] }
  | { revision: number; available: false };
export interface History {
  id: string;
  currentRevision: number | null;
  deleted: boolean;
  revisions: readonly HistoryEntry[];
}

function entry(value: unknown, path: string): HistoryEntry {
  if (typeof value === "object" && value !== null && "available" in value && value.available === false) {
    const hidden = exact(value, ["revision", "available"], path);
    return { revision: revision(hidden.revision, `${path}.revision`), available: false };
  }
  const found = exact(value, ["revision", "available", "commit", "committed_at", "actor", "action"], path);
  if (found.available !== true) return fail(`${path}.available`, "booléen");
  return {
    revision: revision(found.revision, `${path}.revision`),
    available: true,
    commit: commit(found.commit, `${path}.commit`),
    committedAt: instant(found.committed_at, `${path}.committed_at`),
    actor: decodePerson(found.actor, `${path}.actor`),
    action: pick(found.action, ACTIONS, `${path}.action`),
  };
}

export function decodeHistory(value: unknown, id: string): History {
  const found = exact(value, ["id", "current_revision", "deleted", "revisions"], "historique");
  if (found.id !== id) return fail("historique.id", "identifiant demandé");
  const deleted = flag(found.deleted, "historique.deleted");
  const current = found.current_revision === null ? null : revision(found.current_revision, "historique.current_revision");
  const revisions = items(found.revisions, "historique.revisions", MAX_REVISION + 1, 1).map((item, index) => entry(item, `historique.revisions[${String(index)}]`));
  const saves = deleted ? revisions.slice(0, -1) : revisions;
  const last = revisions.at(-1) as HistoryEntry;
  // Une suppression est la dernière entrée, lisible, et garde le numéro de la dernière sauvegarde ; le reste compte 1, 2, 3…
  const coherent = (current === null) === deleted
    && saves.every((item, index) => item.revision === index + 1 && (!item.available || item.action === "save"))
    && (deleted ? last.available && last.action === "delete" && last.revision === saves.length : current === saves.length);
  if (!coherent) return fail("historique", "numéros continus et suppression en dernier");
  return { id, currentRevision: current, deleted, revisions };
}

export interface Change {
  path: string;
  kind: (typeof CHANGE_KINDS)[number];
  before: unknown;
  after: unknown;
}
export interface Diff {
  id: string;
  base: number;
  other: number;
  changes: readonly Change[];
}

const CHANGE_PATH = /^(?:\/[A-Za-z0-9_]{1,64})+$/;

/** Valeur d'un document : JSON ordinaire et borné, jamais un objet à prototype ni un nombre infini. */
function plain(value: unknown, path: string, depth = 0): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : fail(path, "nombre fini");
  if (depth >= 8) return fail(path, "valeur peu imbriquée");
  if (Array.isArray(value)) return (value as unknown[]).map((item, index) => plain(item, `${path}[${String(index)}]`, depth + 1));
  return Object.fromEntries(Object.entries(record(value, path)).map(([key, item]) => [key, plain(item, `${path}.${key}`, depth + 1)]));
}

function change(value: unknown, path: string): Change {
  const found = exact(value, ["path", "kind", "before", "after"], path);
  const where = word(found.path, `${path}.path`);
  if (!CHANGE_PATH.test(where)) return fail(`${path}.path`, "chemin JSON");
  const kind = pick(found.kind, CHANGE_KINDS, `${path}.kind`);
  const before = plain(found.before, `${path}.before`);
  const after = plain(found.after, `${path}.after`);
  // Un champ ajouté n'avait rien avant, un champ retiré n'a plus rien après.
  if ((kind === "added" && before !== null) || (kind === "removed" && after !== null)) return fail(path, "valeur absente du côté sans champ");
  return { path: where, kind, before, after };
}

export function decodeDiff(value: unknown, id: string, base: number, other: number): Diff {
  const found = exact(value, ["id", "base", "other", "changes"], "écart");
  if (found.id !== id || found.base !== base || found.other !== other) return fail("écart", "analyse et révisions demandées");
  return { id, base, other, changes: items(found.changes, "écart.changes", Number.MAX_SAFE_INTEGER).map((item, index) => change(item, `écart.changes[${String(index)}]`)) };
}

export interface UsageCount {
  total: number;
  last30Days: number;
  lastAt: Date | null;
}
export interface Usage {
  id: string;
  saved: UsageCount;
  opened: UsageCount;
  executed: UsageCount;
}

function usageCount(value: unknown, path: string): UsageCount {
  const found = exact(value, ["total", "last_30_days", "last_at"], path);
  const total = count(found.total, `${path}.total`);
  const recent = count(found.last_30_days, `${path}.last_30_days`);
  const last = found.last_at === null ? null : instant(found.last_at, `${path}.last_at`);
  // Sans événement, pas de date ; avec un événement, la date du dernier.
  if (recent > total || (total === 0) !== (last === null)) return fail(path, "compteurs cohérents");
  return { total, last30Days: recent, lastAt: last };
}

export function decodeUsage(value: unknown, id: string): Usage {
  const found = exact(value, ["id", "usage"], "usage");
  if (found.id !== id) return fail("usage.id", "identifiant demandé");
  const usage = exact(found.usage, USAGE_KINDS, "usage.usage");
  return { id, saved: usageCount(usage.saved, "usage.saved"), opened: usageCount(usage.opened, "usage.opened"), executed: usageCount(usage.executed, "usage.executed") };
}

/** Réponse d'une ouverture : `recorded: false` dit que la base n'a pas pu consigner, le client peut rejouer. */
export function decodeOpened(value: unknown): { recorded: boolean } {
  return { recorded: flag(exact(value, ["recorded"], "ouverture").recorded, "ouverture.recorded") };
}

/**
 * Dernière exécution de la session qui référençait l'analyse (plan 18, 18.3b) : la révision référencée et
 * l'exécution, avec la preuve et le décodage de la route d'une exécution. `last: null` dit qu'il n'y en a
 * pas, ce qui n'est ni une erreur ni une exécution réussie. Un refus ou un échec reste ce qu'il est.
 */
export interface LastExecution {
  id: string;
  last: { revision: number; execution: Execution } | null;
}

export function decodeLastExecution(value: unknown, space: string, id: string): LastExecution {
  const found = exact(value, ["id", "revision", "execution"], "dernière exécution");
  if (found.id !== id) return fail("dernière exécution.id", "identifiant demandé");
  if (found.revision === null || found.execution === null) {
    // Les deux ou aucun : une révision sans exécution, ou l'inverse, n'est pas une réponse du serveur.
    return found.revision === null && found.execution === null ? { id, last: null } : fail("dernière exécution", "révision et exécution ensemble ou ni l'une ni l'autre");
  }
  const run = record(found.execution, "dernière exécution.execution");
  // La preuve fait partie de la réponse : un résumé sans elle n'est pas celui de cette route.
  if (!Object.hasOwn(run, "evidence")) return fail("dernière exécution.execution", "résumé avec preuve");
  return { id, last: { revision: revision(found.revision, "dernière exécution.revision"), execution: decodeExecution(run, space) } };
}

/** Consommateurs d'une analyse (plan 19, B5) : dashboards visibles du demandeur, et nombre des autres, jamais nommés. */
export interface Consumers {
  id: string;
  consumers: readonly Consumer[];
  others: number;
}

export function decodeConsumers(value: unknown, id: string): Consumers {
  const found = exact(value, ["id", "consumers", "others"], "consommateurs");
  if (found.id !== id) return fail("consommateurs.id", "identifiant demandé");
  return { id, ...decodeConsumerList(found, "consommateurs") };
}
