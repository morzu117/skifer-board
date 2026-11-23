import { describe, expect, it } from "vitest";
import { decodeThemeApproval, decodeThemeApprovals, decodeThemeConsumers, decodeThemeDiff, decodeThemeHistory, decodeThemeList, decodeThemeRevision } from "./model";
import { decodeThemeRefusal } from "./refusal";

const routes = import.meta.glob<{ status: number; body: unknown }>("../../../../contracts/themes/routes/*.json", { eager: true, import: "default" });
const ID = "00000000-0000-4000-8000-000000000001";
const COMMIT = "a".repeat(40);
const entries = Object.fromEntries(Object.entries(routes).map(([path, route]) => [path.split("/").at(-1)?.replace(/\.json$/, "") as string, JSON.parse(JSON.stringify(route).replaceAll("<uuid>", ID).replaceAll("<commit>", COMMIT)) as { status: number; body: unknown }]));
const ok = (name: string) => entries[name]?.body;

describe("contrats des routes de thèmes", () => {
  it("dispose d'un décodeur pour chacun des 20 exemples", () => {
    const decoders: Record<string, () => unknown> = {
      creer: () => decodeThemeRevision(ok("creer"), "finance"), lire: () => decodeThemeRevision(ok("lire"), "finance"), reviser: () => decodeThemeRevision(ok("reviser"), "finance"),
      lister: () => decodeThemeList(ok("lister")), historique: () => decodeThemeHistory(ok("historique"), ID), diff: () => decodeThemeDiff(ok("diff"), ID, 1, 2),
      approver: () => decodeThemeApproval(ok("approver"), ID), approbations: () => decodeThemeApprovals(ok("approbations"), ID), consommateurs: () => decodeThemeConsumers(ok("consommateurs"), ID),
      supprimer: () => { expect(entries.supprimer).toEqual({ status: 204, body: null }); },
    };
    const refusals = Object.keys(entries).filter((name) => name.startsWith("refus-"));
    expect(Object.keys(entries)).toHaveLength(20);
    expect(refusals).toHaveLength(10);
    expect([...Object.keys(decoders), ...refusals].sort()).toEqual(Object.keys(entries).sort());
    for (const [name, decode] of Object.entries(decoders)) expect(decode, name).not.toThrow();
    const statuses: Record<string, number> = { theme_not_found: 404, invalid_theme: 422, already_approved: 409, not_owner: 403, content_in_use: 409, content_unavailable: 503, revision_conflict: 409, forbidden: 403, local_mode: 409 };
    for (const name of refusals) {
      const refusal = decodeThemeRefusal(ok(name));
      expect(refusal, name).toEqual((ok(name) as { error: unknown }).error);
      expect(entries[name]?.status, name).toBe(statuses[refusal.code]);
    }
    for (const [name, status] of Object.entries({ creer: 201, lire: 200, reviser: 201, lister: 200, historique: 200, diff: 200, approver: 201, approbations: 200, consommateurs: 200 })) expect(entries[name]?.status, name).toBe(status);
  });
  it("vérifie les contenus des exemples de révision, diff, approbation et liste", () => {
    const read = decodeThemeRevision(ok("lire"), "finance");
    expect(read).toEqual({ id: ID, space: "finance", revision: 1, commit: COMMIT, committedAt: new Date("2026-01-15T12:00:00Z"), revisedBy: { issuer: "https://id.example.invalid", subject: "cora" }, state: "draft", approvedRevision: null, indexState: "indexed", theme: (ok("lire") as { theme: unknown }).theme });
    for (const name of ["creer", "reviser"]) {
      const source = ok(name) as { revision: number; theme: unknown; approved_revision: number | null };
      expect(decodeThemeRevision(ok(name), "finance")).toEqual({ ...read, revision: source.revision, approvedRevision: source.approved_revision, theme: source.theme });
    }
    expect(decodeThemeHistory(ok("historique"), ID)).toEqual({ id: ID, currentRevision: 2, deleted: false, revisions: [1, 2].map((revision) => ({ revision, commit: COMMIT, committedAt: new Date("2026-01-15T12:00:00Z"), actor: { issuer: "https://id.example.invalid", subject: "cora" }, action: "save" })) });
    expect(decodeThemeDiff(ok("diff"), ID, 1, 2)).toEqual({ id: ID, base: 1, other: 2, changes: [{ path: "/name", kind: "modified", node: null, id: null, before: "Clair", after: "Révisé" }] });
    expect(decodeThemeApproval(ok("approver"), ID)).toEqual({ id: ID, state: "approved", approvedRevision: 1, indexState: "indexed", diff: null });
    expect(decodeThemeList(ok("lister"))).toEqual({ themes: [{ id: ID, name: "Clair", owner: { issuer: "https://id.example.invalid", subject: "cora" }, revision: 1, commit: COMMIT, committedAt: new Date("2026-01-15T12:00:00Z"), state: "draft", approvedRevision: null, indexState: "indexed" }], unreadable: 0 });
    expect(decodeThemeApprovals(ok("approbations"), ID)).toEqual({ id: ID, approvals: [{ revision: 1, approver: { issuer: "https://id.example.invalid", subject: "ada" }, approvedAt: new Date("2026-01-15T12:00:00Z") }] });
    expect(decodeThemeConsumers(ok("consommateurs"), ID)).toEqual({ id: ID, consumers: [{ kind: "dashboard", id: ID }], others: 0 });
  });
});
