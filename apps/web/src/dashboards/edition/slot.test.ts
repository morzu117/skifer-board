import { describe, expect, it, vi } from "vitest";
import { createDashboard, EMPTY_SLOT, reviseDashboard } from "../client";
import { decodeDashboard, decodeDashboardDraft, hasSlots } from "../document";
import { dashboardProblems } from "./problems";
import { buildTree, findNode, reparentPlace } from "./tree";
import { N, sampleDraft, uuid } from "./testing";

const slot = { id: N.visual, type: "slot", slot: { expected: "visual", label: "Ventes" } };
const draft = (child = slot) => ({ ...sampleDraft(), filters: [], layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: [child] }] }] }] } });

describe("emplacements du brouillon", () => {
  it("décode strictement le brouillon et refuse le document serveur", () => {
    expect(decodeDashboardDraft(draft())).toEqual(draft());
    expect(() => decodeDashboard({ ...draft(), api_version: "board.dashboard/v1", id: N.s2, owner: { issuer: "issuer", subject: "subject" } })).toThrow();
    for (const bad of [{ ...slot, slot: { ...slot.slot, expected: "text" } }, { ...slot, slot: { ...slot.slot, label: "" } }, { ...slot, extra: true }]) {
      expect(() => decodeDashboardDraft(draft(bad))).toThrow();
    }
  });
  it("signale les emplacements et les place dans l'arbre", () => {
    const value = decodeDashboardDraft(draft());
    expect(hasSlots(value)).toBe(true);
    expect(hasSlots(sampleDraft())).toBe(false);
    expect(dashboardProblems(value, [], {}, null)).toContainEqual({ code: "empty_slot", severity: "blocking", nodeId: N.visual, path: "/layout/sections/0/rows/0/columns/0/children/0" });
    const tree = buildTree(value);
    expect(findNode(tree, N.visual)).toMatchObject({ kind: "slot", label: "Emplacement : Ventes" });
    expect(reparentPlace(tree, N.visual, "next")).toBeNull();
  });
  it("borne le nombre total d'emplacements", () => {
    const value = { ...sampleDraft(), filters: [], layout: { sections: [{ id: uuid(300), rows: Array.from({ length: 5 }, (_, row) => ({ id: uuid(301 + row), columns: [{ id: uuid(310 + row), span: 12, children: Array.from({ length: 13 }, (_, index) => ({ ...slot, id: uuid(400 + row * 13 + index) })) }] })) }] } };
    expect(() => decodeDashboardDraft(value)).toThrow("64 composants");
  });
  it("refuse création et révision sans requête", async () => {
    const fetcher = vi.fn();
    expect(await createDashboard("finance", decodeDashboardDraft(draft()), fetcher)).toEqual({ status: "error", message: EMPTY_SLOT });
    expect(await reviseDashboard("finance", N.s2, decodeDashboardDraft(draft()), 1, fetcher)).toEqual({ status: "error", message: EMPTY_SLOT });
    const nested = { ...draft(), layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: [{ id: N.box, type: "container", rows: [{ id: N.r2, columns: [{ id: N.c3, span: 12, children: [slot] }] }] }] }] }] }] } };
    expect(await createDashboard("finance", decodeDashboardDraft(nested), fetcher)).toEqual({ status: "error", message: EMPTY_SLOT });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
