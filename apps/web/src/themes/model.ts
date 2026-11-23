import { decodeSharedApproval, unchanged } from "../shared-content/model";
import { decodeSharedRevision } from "../shared-content/model";
import schema from "../../../../contracts/themes/theme.v1.json";
import { bounded, decodeName, decodePerson, type Person } from "../analyses/document";
import { decodeConsumerList, type Consumer } from "../analyses/refusal";
import { commit, count, distinct, exact, fail, items, pick, record, revision, uuid, word } from "../analyses/shape";
import { instant } from "../catalogue/decode";
import { LEGENDS, NUMBER_FORMATS, TOOLTIPS } from "../dashboards/document";
import { decodeTheme, type ThemeDocument } from "./document";

export type ThemeState = "draft" | "approved";
export type IndexState = "indexed" | "index_stale";
export interface ThemeRevision { id: string; space: string; revision: number; commit: string; committedAt: Date; revisedBy: Person; state: ThemeState; approvedRevision: number | null; indexState: IndexState; theme: ThemeDocument }
const state = (value: unknown, path: string): ThemeState => pick(value, ["draft", "approved"] as const, path);
const indexState = (value: unknown, path: string): IndexState => pick(value, ["indexed", "index_stale"] as const, path);
const approved = (value: unknown, path: string): number | null => value === null ? null : revision(value, path);
function coherent(number: number, current: ThemeState, last: number | null, path: string): void {
  if (current === "approved" ? last === null || last < number : last === number) fail(path, "état d'approbation cohérent");
}

export function decodeThemeRevision(value: unknown, space: string): ThemeRevision {
  const { document, ...metadata } = decodeSharedRevision(value, space, "theme", decodeTheme);
  return { ...metadata, theme: document };
}
export interface ThemeListItem { id: string; name: string; owner: Person; revision: number; commit: string; committedAt: Date; state: ThemeState; approvedRevision: number | null; indexState: IndexState }
export interface ThemeList { themes: readonly ThemeListItem[]; unreadable: number }
export function decodeThemeList(value: unknown): ThemeList {
  const f = exact(value, ["themes", "unreadable"], "liste");
  const themes = items(f.themes, "liste.themes", Number.MAX_SAFE_INTEGER).map((value, i): ThemeListItem => {
    const p = `liste.themes[${String(i)}]`;
    const item = exact(value, ["id", "name", "owner", "revision", "commit", "committed_at", "state", "approved_revision", "index_state"], p);
    const number = revision(item.revision, `${p}.revision`);
    const current = state(item.state, `${p}.state`);
    const last = approved(item.approved_revision, `${p}.approved_revision`);
    coherent(number, current, last, p);
    return { id: uuid(item.id, `${p}.id`), name: decodeName(item.name, `${p}.name`), owner: decodePerson(item.owner, `${p}.owner`), revision: number, commit: commit(item.commit, `${p}.commit`), committedAt: instant(item.committed_at, `${p}.committed_at`), state: current, approvedRevision: last, indexState: indexState(item.index_state, `${p}.index_state`) };
  });
  distinct(themes.map((item) => item.id), "liste.themes");
  return { themes, unreadable: count(f.unreadable, "liste.unreadable") };
}
export interface ThemeApprovals { id: string; approvals: readonly { revision: number; approver: Person; approvedAt: Date }[] }
export function decodeThemeApprovals(value: unknown, id: string): ThemeApprovals {
  const f = exact(value, ["id", "approvals"], "approbations");
  if (f.id !== id) return fail("approbations.id", "identifiant demandé");
  const entries = items(f.approvals, "approbations.approvals", Number.MAX_SAFE_INTEGER).map((value, i) => {
    const p = `approbations.approvals[${String(i)}]`;
    const a = exact(value, ["revision", "approver", "approved_at"], p);
    if (typeof a.approved_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(a.approved_at)) return fail(`${p}.approved_at`, "instant UTC");
    return { revision: revision(a.revision, `${p}.revision`), approver: decodePerson(a.approver, `${p}.approver`), approvedAt: instant(a.approved_at, `${p}.approved_at`) };
  });
  if (entries.some((entry, i) => i > 0 && entry.revision <= (entries[i - 1] as typeof entry).revision)) return fail("approbations.approvals", "révisions strictement croissantes");
  return { id, approvals: entries };
}
export function decodeThemeConsumers(value: unknown, id: string): { id: string; consumers: readonly Consumer[]; others: number } {
  const f = exact(value, ["id", "consumers", "others"], "consommateurs");
  if (f.id !== id) return fail("consommateurs.id", "identifiant demandé");
  const list = decodeConsumerList(f, "consommateurs");
  if (list.consumers.some((one) => one.kind !== "dashboard")) return fail("consommateurs", "dashboards");
  return { id, ...list };
}

export interface ThemeHistoryEntry { revision: number; commit: string; committedAt: Date; actor: Person; action: "save" | "delete" }
export interface ThemeHistory { id: string; currentRevision: number | null; deleted: boolean; revisions: readonly ThemeHistoryEntry[] }
export function decodeThemeHistory(value: unknown, id: string): ThemeHistory {
  const f = exact(value, ["id", "current_revision", "deleted", "revisions"], "historique");
  if (f.id !== id) return fail("historique.id", "identifiant demandé");
  if (typeof f.deleted !== "boolean") return fail("historique.deleted", "booléen");
  const deleted = f.deleted;
  const currentRevision = approved(f.current_revision, "historique.current_revision");
  const revisions = items(f.revisions, "historique.revisions", Number.MAX_SAFE_INTEGER, 1).map((value, i): ThemeHistoryEntry => {
    const p = `historique.revisions[${String(i)}]`;
    const entry = exact(value, ["revision", "available", "commit", "committed_at", "actor", "action"], p);
    if (entry.available !== true) return fail(`${p}.available`, "true");
    return { revision: revision(entry.revision, `${p}.revision`), commit: commit(entry.commit, `${p}.commit`), committedAt: instant(entry.committed_at, `${p}.committed_at`), actor: decodePerson(entry.actor, `${p}.actor`), action: pick(entry.action, ["save", "delete"] as const, `${p}.action`) };
  });
  const last = revisions.at(-1) as ThemeHistoryEntry;
  if (deleted ? currentRevision !== null || last.action !== "delete" || revisions.length < 2 : currentRevision !== last.revision || last.action !== "save") return fail("historique", "état cohérent");
  if (revisions.slice(0, -1).some((entry, i) => entry.action !== "save" || (deleted && i === revisions.length - 2 ? entry.revision !== last.revision : entry.revision >= (revisions[i + 1] as ThemeHistoryEntry).revision))) return fail("historique.revisions", "révisions ordonnées");
  return { id, deleted, currentRevision, revisions };
}

export interface ThemeChange { path: string; kind: "added" | "removed" | "modified"; node: null; id: null; before: unknown; after: unknown }
export interface ThemeDiff { id: string; base: number; other: number; changes: readonly ThemeChange[] }

/** Type d'une feuille du schéma ; les valeurs de diff ne reçoivent jamais de couleur brute. */
function diffValue(path: string, value: unknown): unknown {
  const parts = path.split("/").slice(1);
  const [first, second, third] = parts;
  if (parts.length === 1 && first === "name") return decodeName(value, path);
  if (parts.length === 1 && first === "description") return bounded(value, path, 0, 2000, true);
  if (parts.length === 1 && first === "base") return pick(value, ["skifer-clair", "skifer-ardoise"] as const, path);
  if (parts.length === 1 && first === "density") return pick(value, ["compact", "normal", "airy"] as const, path);
  if (parts.length === 2 && first === "owner" && ["issuer", "subject"].includes(second as string)) return bounded(value, path, 1, 512, false);
  if (parts.length === 3 && first === "roles" && ((second === "marks" && ["series", "secondary", "selected", "threshold", "positive", "negative", "total"].includes(third as string)) || (second === "text" && ["text", "textStrong", "textMuted", "thresholdLabel"].includes(third as string)))) return pick(value, schema.$defs.token.enum, path);
  if (parts.length === 2 && ((first === "categorical" && /^(0|[1-7])$/.test(second as string)) || (["sequential", "diverging"].includes(first as string) && /^(0|[1-6])$/.test(second as string)))) return pick(value, schema.$defs.token.enum, path);
  if (parts.length === 2 && first === "typography") {
    if (second === "sans") return pick(value, ["sans"] as const, path);
    if (second === "mono") return pick(value, ["mono"] as const, path);
    if (second === "scale") return pick(value, ["compact", "normal", "large"] as const, path);
  }
  if (parts.length === 2 && first === "formats") {
    if (second === "number") return pick(value, NUMBER_FORMATS, path);
    if (second === "date") return pick(value, ["short", "medium", "long", "iso"] as const, path);
  }
  if (first === "chart_defaults" && ["value", "bars", "line", "grouped_bars"].includes(second as string)) {
    if (parts.length === 2) {
      const found = record(value, path);
      if (!Object.keys(found).every((key) => ["legend", "number_format", "tooltip"].includes(key))) return fail(path, "défauts de graphique");
      return Object.fromEntries(Object.entries(found).map(([key, entry]) => [key, diffValue(`${path}/${key}`, entry)]));
    }
    if (parts.length === 3) {
      if (third === "legend") return pick(value, LEGENDS, path);
      if (third === "number_format") return pick(value, NUMBER_FORMATS, path);
      if (third === "tooltip") return pick(value, TOOLTIPS, path);
    }
  }
  return fail(path, "chemin du thème");
}
function change(value: unknown, p: string): ThemeChange {
  const f = exact(value, ["path", "kind", "node", "id", "before", "after"], p);
  const path = word(f.path, `${p}.path`);
  const kind = pick(f.kind, ["added", "removed", "modified"] as const, `${p}.kind`);
  if (f.node !== null || f.id !== null) return fail(p, "écart sans nœud");
  const optional = /^\/(?:categorical\/(?:0|[1-7])|(?:sequential|diverging)\/(?:0|[1-6]))$/.test(path) || /^\/chart_defaults\/(?:value|bars|line|grouped_bars)(?:\/(?:legend|number_format|tooltip))?$/.test(path);
  if (kind !== "modified" && !optional) return fail(p, "modification de champ obligatoire");
  if (kind === "modified" && /^\/chart_defaults\/(?:value|bars|line|grouped_bars)$/.test(path)) return fail(p, "différence d’une feuille");
  const before = kind === "added" ? (f.before === null ? null : fail(p, "valeur absente")) : diffValue(path, f.before);
  const after = kind === "removed" ? (f.after === null ? null : fail(p, "valeur absente")) : diffValue(path, f.after);
  if (kind === "modified" && unchanged(before, after)) return fail(p, "valeurs différentes");
  if ([before, after].some((entry) => typeof entry === "string" && /#[0-9a-fA-F]{6}/.test(entry))) return fail(p, "aucune couleur hexadécimale");
  return { path, kind, node: null, id: null, before, after };
}
export function decodeThemeDiff(value: unknown, id: string, base: number, other: number): ThemeDiff {
  const f = exact(value, ["id", "base", "other", "changes"], "écart");
  if (f.id !== id || f.base !== base || f.other !== other) return fail("écart", "thème et révisions demandés");
  return { id, base, other, changes: items(f.changes, "écart.changes", Number.MAX_SAFE_INTEGER).map((entry, i) => change(entry, `écart.changes[${String(i)}]`)) };
}
export interface ApprovalResult { id: string; state: "approved"; approvedRevision: number; indexState: IndexState; diff: readonly ThemeChange[] | null }
export function decodeThemeApproval(value: unknown, id: string): ApprovalResult {
  return decodeSharedApproval(value, id, change);
}
