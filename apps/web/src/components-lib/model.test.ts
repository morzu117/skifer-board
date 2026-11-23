import { describe, expect, it } from "vitest";
import { decodeComponentApproval, decodeComponentDiff, decodeComponentList, decodeComponentRevision } from "./model";

const routes = import.meta.glob<{ body: unknown }>("../../../../contracts/components/routes/*.json", { eager: true, import: "default" });
const ID = "00000000-0000-4000-8000-000000000001";
const COMMIT = "a".repeat(40);
function body(name: string): Record<string, unknown> {
  return JSON.parse(JSON.stringify(routes[`../../../../contracts/components/routes/${name}.json`]?.body).replaceAll("<uuid>", ID).replaceAll("<commit>", COMMIT)) as Record<string, unknown>;
}
describe("réponses de composants", () => {
  it("juge les révisions et listes", () => {
    const read = body("lire");
    expect(decodeComponentRevision(read, "finance")).toMatchObject({ id: ID, revision: 1, state: "draft", approvedRevision: null });
    expect(decodeComponentRevision(body("reviser"), "finance")).toMatchObject({ revision: 2, approvedRevision: 1 });
    expect(decodeComponentList(body("lister")).components).toHaveLength(1);
    for (const invalid of [{ ...read, space_id: "autre" }, { ...read, component: { ...(read.component as object), id: "00000000-0000-4000-8000-000000000002" } }, { ...read, state: "approved", approved_revision: null }, { ...read, state: "draft", approved_revision: 1 }, { ...read, extra: 1 }]) expect(() => decodeComponentRevision(invalid, "finance")).toThrow();
    expect(decodeComponentRevision({ ...read, state: "approved", approved_revision: 1 }, "finance").state).toBe("approved");
  });
  it("juge tous les chemins de l'écart", () => {
    const item = (path: string, before: unknown, after: unknown, kind = "modified") => ({ path, kind, node: null, id: null, before, after });
    const decode = (...changes: unknown[]) => decodeComponentDiff({ id: ID, base: 1, other: 2, changes }, ID, 1, 2);
    const values: [string, unknown, unknown][] = [
      ["/name", "A", "B"], ["/description", "", "B"], ["/owner/issuer", "a", "b"], ["/owner/subject", "a", "b"], ["/kind", "visual", "kpi"], ["/analysis/analysis_id", ID, "00000000-0000-4000-8000-000000000002"], ["/analysis/revision", 1, 2],
      ["/presentation/title", "A", "B"], ["/presentation/chart", "bars", "line"], ["/presentation/legend", "auto", "hidden"], ["/presentation/number_format", "auto", "integer"], ["/presentation/tooltip", "value", "value_and_definition"], ["/presentation/threshold/label", "A", "B"], ["/presentation/threshold/value", 1, 2],
    ];
    for (const [path, before, after] of values) expect(decode(item(path, before, after)).changes[0]).toMatchObject({ path, before, after });
    expect(decode(item("/presentation/threshold", null, { value: 3, label: "Cible" }, "added")).changes).toHaveLength(1);
    expect(decode(item("/presentation/legend", "auto", null, "removed")).changes).toHaveLength(1);
    for (const bad of [item("/sql", "a", "b"), item("/name", null, "A", "added"), item("/name", "A", "A"), item("/presentation/threshold", { value: 1, label: "a" }, { value: 2, label: "b" }), item("/presentation/threshold", null, { value: Infinity, label: "x" }, "added"), item("/presentation/title", "A", "B", "added"), item("/presentation/title", "A", "B", "removed"), { ...item("/name", "A", "B"), node: "component" }, { ...item("/name", "A", "B"), id: ID }, item("/presentation/color", "a", "b")]) expect(() => decode(bad), JSON.stringify(bad)).toThrow();
    expect(() => decodeComponentDiff({ id: "x", base: 1, other: 2, changes: [] }, ID, 1, 2)).toThrow();
  });
  it("juge l'approbation et son diff", () => {
    expect(decodeComponentApproval(body("approver"), ID)).toMatchObject({ state: "approved", diff: null });
    const change = { path: "/name", kind: "modified", node: null, id: null, before: "A", after: "B" };
    expect(decodeComponentApproval({ id: ID, state: "approved", approved_revision: 2, index_state: "indexed", diff: [change] }, ID).diff).toHaveLength(1);
    expect(() => decodeComponentApproval({ id: "x", state: "approved", approved_revision: 1, index_state: "indexed", diff: null }, ID)).toThrow();
    expect(() => decodeComponentApproval({ id: ID, state: "draft", approved_revision: 1, index_state: "indexed", diff: null }, ID)).toThrow();
  });
});

it("accepte l’écart numérique réel de 1 à 1.0", () => {
  const payload: unknown = JSON.parse(`{"id":"${ID}","base":1,"other":2,"changes":[{"path":"/presentation/threshold/value","kind":"modified","node":null,"id":null,"before":1,"after":1.0}]}`);
  expect(decodeComponentDiff(payload, ID, 1, 2).changes).toHaveLength(1);
});
