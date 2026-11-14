import { describe, expect, it } from "vitest";
import { decodeDashboardDiff } from "./model";
import { ID } from "./testing";
import changes from "./ecart-references-reel.json";

const decode = (one: unknown[]) => decodeDashboardDiff({ id: ID, base: 1, other: 2, changes: one }, ID, 1, 2);

describe("écarts de références produits par dashboard.diff", () => {
  it.each(Object.entries(changes))("relit sans les modifier les changements %s du serveur", (_name, entries) => {
    expect(decode(entries).changes).toEqual(entries);
  });
  it("accepte un déplacement de composant et conserve les emplacements", () => {
    const node = changes.added[2];
    const moved = { ...node, kind: "moved", before: { parent: ID, index: 0 }, after: { parent: ID, index: 1 } };
    expect(decode([moved]).changes).toEqual([moved]);
  });
  it("rejette les valeurs ou formes qui ne peuvent être produites par les références valides", () => {
    const added = changes.added[0];
    const modified = changes.modified[0];
    const node = changes.added[2];
    for (const bad of [
      { ...added, kind: "modified" }, { ...added, after: { theme_id: ID, revision: 0 } },
      { ...added, after: { theme_id: ID, revision: 1, extra: 1 } },
      { ...modified, kind: "added", before: null }, { ...modified, after: "x" },
      { ...node, after: { type: "component", component: { component_id: ID, revision: 0 } } },
      { ...node, after: { type: "component", component: { component_id: ID, revision: 1 }, presentation: {} } },
      { ...node, path: "/filters/0" },
    ]) expect(() => decode([bad])).toThrow();
  });
});
