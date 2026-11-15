import { expect, it } from "vitest";
import sample from "../../../../contracts/page_templates/fixtures/valid/base.json";
import { decodePageTemplateConsumers, decodePageTemplateList, decodePageTemplateRevision } from "./model";
const id = sample.id;
const item = { id, name: "Test", owner: sample.owner, revision: 1, commit: "a".repeat(40), committed_at: "2026-01-15T12:00:00Z", state: "draft", approved_revision: null, index_state: "indexed" };
const body = { id, revision: 1, commit: item.commit, committed_at: item.committed_at, state: item.state, approved_revision: null, index_state: item.index_state, space_id: "finance", revised_by: sample.owner, page_template: sample };
it("décode la révision et la liste des modèles avec leurs états", () => {
  expect(decodePageTemplateRevision(body, "finance")).toMatchObject({ id, revision: 1, state: "draft", approvedRevision: null, pageTemplate: sample });
  expect(decodePageTemplateList({ page_templates: [item], unreadable: 0 })).toMatchObject({ pageTemplates: [{ id }], unreadable: 0 });
  expect(decodePageTemplateRevision({ ...body, state: "approved", approved_revision: 1 }, "finance").state).toBe("approved");
  for (const found of [{ ...body, extra: true }, { ...body, space_id: "other" }, { ...body, id: "00000000-0000-4000-8000-000000000005" }, { ...body, state: "approved" }, { ...body, state: "draft", approved_revision: 1 }, { ...body, state: "approved", revision: 2, approved_revision: 1 }]) expect(() => decodePageTemplateRevision(found, "finance")).toThrow();
  expect(() => decodePageTemplateList({ page_templates: [], unreadable: 0, extra: true })).toThrow();
});

it("les modèles ne sont jamais des consommateurs", () => {
  expect(decodePageTemplateConsumers({ id, consumers: [], others: 0 }, id)).toEqual({ id, consumers: [], others: 0 });
  for (const value of [{ id, consumers: [{ id, kind: "dashboard" }], others: 0 }, { id, consumers: [], others: 1 }, { id, consumers: null, others: 0 }, { id: "other", consumers: [], others: 0 }]) expect(() => decodePageTemplateConsumers(value, id)).toThrow();
});
