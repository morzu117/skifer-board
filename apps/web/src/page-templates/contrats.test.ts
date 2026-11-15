import { describe, expect, it } from "vitest";
import { decodePageTemplateApprovals, decodePageTemplateConsumers, decodePageTemplateHistory, decodePageTemplateList, decodePageTemplateRevision } from "./model";
import { decodePageTemplateApproval, decodePageTemplateDiff } from "./diff";
import { decodePageTemplateRefusal } from "./refusal";

const routes = import.meta.glob<{ status: number; body: unknown }>("../../../../contracts/page_templates/routes/*.json", { eager: true, import: "default" });
const ID = "00000000-0000-4000-8000-000000000001";
const COMMIT = "a".repeat(40);
const entries = Object.fromEntries(Object.entries(routes).map(([path, route]) => {
  const result = JSON.parse(JSON.stringify(route).replaceAll("<uuid>", ID).replaceAll("<commit>", COMMIT)) as { status: number; body: Record<string, unknown> | null };
  if (result.body !== null && "page_template" in result.body) {
    const document = result.body.page_template as { filters: unknown; layout: unknown };
    let counter = 2;
    const assign = (value: unknown): void => {
      if (Array.isArray(value)) { value.forEach(assign); return; }
      if (typeof value !== "object" || value === null) return;
      const object = value as Record<string, unknown>;
      if (object.id === ID) { object.id = `00000000-0000-4000-8000-${(counter++).toString(16).padStart(12, "0")}`; }
      Object.values(object).forEach(assign);
    };
    assign(document.filters); assign(document.layout);
  }
  return [path.split("/").at(-1)?.replace(/\.json$/, "") as string, result];
}));
const ok = (name: string) => entries[name]?.body;

describe("contrats des routes de modèles", () => {
  it("vérifie chacun des 18 contrats", () => {
    const decoders: Record<string, () => unknown> = {
      creer: () => decodePageTemplateRevision(ok("creer"), "finance"), lire: () => decodePageTemplateRevision(ok("lire"), "finance"), reviser: () => decodePageTemplateRevision(ok("reviser"), "finance"),
      diff: () => decodePageTemplateDiff(ok("diff"), ID, 1, 2), approver: () => decodePageTemplateApproval(ok("approver"), ID),
      lister: () => decodePageTemplateList(ok("lister")), historique: () => decodePageTemplateHistory(ok("historique"), ID),
      approbations: () => decodePageTemplateApprovals(ok("approbations"), ID), consommateurs: () => decodePageTemplateConsumers(ok("consommateurs"), ID),
      supprimer: () => { expect(entries.supprimer).toEqual({ status: 204, body: null }); },
    };
    const refusals = Object.keys(entries).filter((name) => name.startsWith("refus-"));
    expect(Object.keys(entries)).toHaveLength(18);
    expect(refusals).toHaveLength(8);
    expect([...Object.keys(decoders), ...refusals].sort()).toEqual(Object.keys(entries).sort());
    expect(decodePageTemplateDiff(ok("diff"), ID, 1, 2)).toEqual({ id: ID, base: 1, other: 2, changes: [{ path: "/name", kind: "modified", node: null, id: null, before: "Exemple", after: "Révisé" }] });
    expect(decodePageTemplateApproval(ok("approver"), ID)).toEqual({ id: ID, state: "approved", approvedRevision: 1, indexState: "indexed", diff: null });
    for (const [name, decode] of Object.entries(decoders)) expect(decode, name).not.toThrow();
    const statuses: Record<string, number> = { page_template_not_found: 404, invalid_page_template: 422, already_approved: 409, not_owner: 403, content_in_use: 409, content_unavailable: 503, revision_conflict: 409, forbidden: 403, local_mode: 409 };
    for (const name of refusals) {
      const refusal = decodePageTemplateRefusal(ok(name));
      expect(refusal, name).toEqual((ok(name) as { error: unknown }).error);
      expect(entries[name]?.status, name).toBe(statuses[refusal.code]);
    }
    for (const [name, status] of Object.entries({ creer: 201, lire: 200, reviser: 201, lister: 200, historique: 200, diff: 200, approver: 201, approbations: 200, consommateurs: 200 })) expect(entries[name]?.status, name).toBe(status);
  });
});
