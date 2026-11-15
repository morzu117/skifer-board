import { decodePerson, type Person } from "../analyses/document";
import { commit, exact, fail, items, pick, revision, uuid } from "../analyses/shape";
import { instant } from "../catalogue/decode";

export type SharedState = "draft" | "approved";
export type SharedIndexState = "indexed" | "index_stale";
export interface SharedRevision<T> { id: string; space: string; revision: number; commit: string; committedAt: Date; revisedBy: Person; state: SharedState; approvedRevision: number | null; indexState: SharedIndexState; document: T }
export function decodeSharedRevision<T extends { id: string }>(value: unknown, space: string, key: string, decode: (value: unknown, path: string) => T): SharedRevision<T> {
  const p = "révision";
  const f = exact(value, ["id", "space_id", "revision", "commit", "committed_at", "revised_by", "state", "approved_revision", "index_state", key], p);
  const id = uuid(f.id, `${p}.id`);
  if (f.space_id !== space) return fail(`${p}.space_id`, "espace demandé");
  const document = decode(f[key], `${p}.${key}`);
  if (document.id !== id) return fail(`${p}.${key}.id`, "identifiant du document");
  const number = revision(f.revision, `${p}.revision`);
  const state = pick(f.state, ["draft", "approved"] as const, `${p}.state`);
  const approved = f.approved_revision === null ? null : revision(f.approved_revision, `${p}.approved_revision`);
  if (state === "approved" ? approved === null || approved < number : approved === number) return fail(p, "état d'approbation cohérent");
  return { id, space, revision: number, commit: commit(f.commit, `${p}.commit`), committedAt: instant(f.committed_at, `${p}.committed_at`), revisedBy: decodePerson(f.revised_by, `${p}.revised_by`), state, approvedRevision: approved, indexState: pick(f.index_state, ["indexed", "index_stale"] as const, `${p}.index_state`), document };
}
export interface SharedApproval<C> { id: string; state: "approved"; approvedRevision: number; indexState: SharedIndexState; diff: readonly C[] | null }
export function decodeSharedApproval<C>(value: unknown, id: string, change: (value: unknown, path: string) => C): SharedApproval<C> {
  const f = exact(value, ["id", "state", "approved_revision", "diff", "index_state"], "approbation");
  if (f.id !== id || f.state !== "approved") return fail("approbation", "document approuvé demandé");
  return { id, state: "approved", approvedRevision: revision(f.approved_revision, "approbation.approved_revision"), indexState: pick(f.index_state, ["indexed", "index_stale"] as const, "approbation.index_state"), diff: f.diff === null ? null : items(f.diff, "approbation.diff", Number.MAX_SAFE_INTEGER).map((entry, i) => change(entry, `approbation.diff[${String(i)}]`)) };
}

/** JSON ne distingue plus les nombres Python 1 et 1.0. */
export function unchanged(before: unknown, after: unknown): boolean {
  return typeof before !== "number" && JSON.stringify(before) === JSON.stringify(after);
}
