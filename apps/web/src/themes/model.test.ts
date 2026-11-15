import { describe, expect, it } from "vitest";
import { decodeThemeApproval, decodeThemeApprovals, decodeThemeConsumers, decodeThemeDiff, decodeThemeHistory, decodeThemeList, decodeThemeRevision } from "./model";

const routes = import.meta.glob<{ status: number; body: unknown }>("../../../../contracts/themes/routes/*.json", { eager: true, import: "default" });
const ID = "00000000-0000-4000-8000-000000000001";
const COMMIT = "a".repeat(40);
function body(name: string): Record<string, unknown> {
  const found = routes[`../../../../contracts/themes/routes/${name}.json`];
  return JSON.parse(JSON.stringify(found?.body).replaceAll("<uuid>", ID).replaceAll("<commit>", COMMIT)) as Record<string, unknown>;
}
describe("réponses de thèmes", () => {
  it("lit une révision avec son document et une liste", () => {
    expect(decodeThemeRevision(body("lire"), "finance")).toMatchObject({ id: ID, revision: 1, state: "draft", approvedRevision: null, indexState: "indexed", theme: { id: ID, name: "Clair" } });
    expect(decodeThemeRevision(body("reviser"), "finance")).toMatchObject({ revision: 2, approvedRevision: 1 });
    expect(decodeThemeList(body("lister"))).toMatchObject({ themes: [{ id: ID, revision: 1, state: "draft" }], unreadable: 0 });
  });
  it("refuse les révisions et listes incohérentes", () => {
    const read = body("lire");
    expect(() => decodeThemeRevision(read, "autre")).toThrow();
    expect(() => decodeThemeRevision({ ...read, theme: { ...(read.theme as object), id: "00000000-0000-4000-8000-000000000002" } }, "finance")).toThrow();
    expect(() => decodeThemeRevision({ ...read, unexpected: 1 }, "finance")).toThrow();
    expect(() => decodeThemeRevision({ ...read, state: "approved", approved_revision: null }, "finance")).toThrow();
    expect(() => decodeThemeRevision({ ...read, state: "draft", approved_revision: 1 }, "finance")).toThrow();
    expect(decodeThemeRevision({ ...read, state: "approved", approved_revision: 1 }, "finance").state).toBe("approved");
    const list = body("lister");
    const first = (list.themes as Record<string, unknown>[])[0] as Record<string, unknown>;
    for (const invalid of [{ ...first, state: "approved", approved_revision: null }, { ...first, state: "approved", revision: 2, approved_revision: 1 }, { ...first, state: "draft", approved_revision: first.revision }]) expect(() => decodeThemeList({ ...list, themes: [invalid] })).toThrow();
    expect(() => decodeThemeList({ ...list, themes: [...list.themes as unknown[], ...list.themes as unknown[]] })).toThrow();
  });
  it("lit les approbations et consommateurs", () => {
    expect(decodeThemeApprovals(body("approbations"), ID)).toMatchObject({ id: ID, approvals: [{ revision: 1, approver: { subject: "ada" } }] });
    expect(decodeThemeApprovals({ id: ID, approvals: [] }, ID).approvals).toEqual([]);
    expect(decodeThemeConsumers(body("consommateurs"), ID)).toEqual({ id: ID, consumers: [{ kind: "dashboard", id: ID }], others: 0 });
  });
  it("lit un historique filtré et une suppression", () => {
    const history = body("historique");
    expect(decodeThemeHistory(history, ID)).toMatchObject({ currentRevision: 2, deleted: false });
    const entries = history.revisions as Record<string, unknown>[];
    expect(decodeThemeHistory({ ...history, current_revision: 3, revisions: [entries[0], { ...entries[1], revision: 3 }] }, ID).revisions.map((entry) => entry.revision)).toEqual([1, 3]);
    expect(decodeThemeHistory({ ...history, deleted: true, current_revision: null, revisions: [...entries, { ...entries[1], action: "delete" }] }, ID).deleted).toBe(true);
    for (const invalid of [{ ...history, id: "x" }, { ...history, deleted: "x" }, { ...history, current_revision: 1 }, { ...history, revisions: [] }, { ...history, revisions: [{ ...entries[0], available: false }] }, { ...history, revisions: [entries[1], entries[0]] }, { ...history, revisions: [{ ...entries[0], action: "delete" }, entries[1]] }, { ...history, deleted: true, current_revision: null, revisions: entries }, { ...history, deleted: true, current_revision: null, revisions: [{ ...entries[1], action: "delete" }] }]) expect(() => decodeThemeHistory(invalid, ID)).toThrow();
  });
  it("refuse les approbations et consommateurs hors contrat", () => {
    const entry = (body("approbations").approvals as Record<string, unknown>[])[0] as Record<string, unknown>;
    for (const value of [{ id: ID, approvals: [{ ...entry, approved_at: "2026-01-15T12:00:00+00:00" }] }, { id: ID, approvals: [{ ...entry, approved_at: "2026-01-15T12:00Z" }, { ...entry, approved_at: null }] }, { id: ID, approvals: [entry, entry] }, { id: "x", approvals: [] }]) expect(() => decodeThemeApprovals(value, ID)).toThrow();
    expect(() => decodeThemeConsumers({ id: "x", consumers: [], others: 0 }, ID)).toThrow();
    expect(() => decodeThemeConsumers({ id: ID, consumers: [{ kind: "component", id: ID }], others: 0 }, ID)).toThrow();
  });
});


describe("écarts des thèmes", () => {
  const item = (path: string, before: unknown, after: unknown, kind = "modified") => ({ path, kind, node: null, id: null, before, after });
  const decode = (...changes: unknown[]) => decodeThemeDiff({ id: ID, base: 1, other: 2, changes }, ID, 1, 2);
  it("valide les feuilles et objets du schéma", () => {
    const samples: [string, unknown, unknown][] = [
      ["/name", "A", "B"], ["/description", "", "B"], ["/owner/issuer", "a", "b"], ["/owner/subject", "a", "b"], ["/base", "skifer-clair", "skifer-ardoise"], ["/density", "compact", "airy"],
      ["/roles/marks/series", "blue", "ink"], ["/roles/text/text", "ink", "muted"], ["/categorical/0", "blue", "ink"], ["/sequential/1", "ink", "blue"], ["/diverging/2", "ink", "blue"],
      ["/typography/sans", "sans", "sans"], ["/typography/mono", "mono", "mono"], ["/typography/scale", "compact", "normal"], ["/formats/number", "auto", "integer"], ["/formats/date", "short", "iso"],
      ["/chart_defaults/bars/legend", "auto", "hidden"], ["/chart_defaults/line/number_format", "auto", "integer"], ["/chart_defaults/value/tooltip", "value", "value_and_definition"],
    ];
    for (const [path, before, after] of samples) {
      if (before === after) { expect(() => decode(item(path, before, after))).toThrow(); continue; }
      expect(decode(item(path, before, after)).changes[0]).toMatchObject({ path, before, after });
    }
    expect(decode(item("/chart_defaults/bars", null, { legend: "auto", number_format: "integer", tooltip: "value" }, "added")).changes).toHaveLength(1);
    expect(decode(item("/chart_defaults/bars/legend", "auto", null, "removed")).changes).toHaveLength(1);
    expect(decode(item("/categorical/2", null, "blue", "added")).changes).toHaveLength(1);
    expect(decode(item("/categorical/2", "blue", null, "removed")).changes).toHaveLength(1);
  });
  it("refuse les chemins, valeurs et formes impossibles", () => {
    const invalid = [
      item("/sql", "a", "b"), item("/name", null, "B", "added"), item("/name", "A", "B", "moved"), item("/name", "A", "A"), item("/name", "A", "#123456"),
      item("/roles/marks/series", "blue", "#123456"), item("/roles/unknown/series", "blue", "ink"), item("/categorical/99", "blue", "ink"),
      item("/typography/sans", "sans", "autre"), item("/typography/mono", "mono", "autre"), item("/typography/inconnue", "a", "b"), item("/formats/inconnu", "a", "b"),
      item("/chart_defaults/bars", { legend: "auto" }, { legend: "hidden" }), item("/chart_defaults/pie/legend", "auto", "hidden"), item("/chart_defaults/bars/legend/x", "auto", "hidden"), item("/chart_defaults/bars/other", "a", "b"), item("/chart_defaults/bars", null, { extra: 1 }, "added"), item("/categorical/2", "blue", "ink", "added"), item("/categorical/2", "blue", "ink", "removed"),
      { ...item("/name", "A", "B"), node: "theme" }, { ...item("/name", "A", "B"), id: ID }, { ...item("/name", "A", "B"), extra: 1 },
    ];
    for (const value of invalid) expect(() => decode(value), JSON.stringify(value)).toThrow();
    expect(() => decodeThemeDiff({ id: "x", base: 1, other: 2, changes: [] }, ID, 1, 2)).toThrow();
  });
  it("lit un diff d'approbation optionnel", () => {
    const change = item("/name", "A", "B");
    expect(decodeThemeApproval({ id: ID, state: "approved", approved_revision: 2, index_state: "index_stale", diff: [change] }, ID)).toMatchObject({ approvedRevision: 2, diff: [{ path: "/name" }] });
    expect(() => decodeThemeApproval({ id: "x", state: "approved", approved_revision: 1, index_state: "indexed", diff: null }, ID)).toThrow();
    expect(() => decodeThemeApproval({ id: ID, state: "draft", approved_revision: 1, index_state: "indexed", diff: null }, ID)).toThrow();
  });
});
