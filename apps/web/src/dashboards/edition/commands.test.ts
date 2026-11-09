import { describe, expect, it, vi } from "vitest";
import { applyCommand, createHistory, dispatch, undo, redo, markSaved, isDirty, resolveVisual, resolveKpi, type Command } from "./commands";
import * as documentModule from "../document";
import type { DashboardDraft } from "../document";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const base: DashboardDraft = { name: "Tableau", description: "", visibility: "personal", defaults: {}, filters: [], layout: { sections: [] } };
const add = (kind: Extract<Command, { type: "add" }>["kind"], parent: string | null, n: number, value?: object) => ({ type: "add" as const, kind, parent, index: 0, ...(value ? { value } : {}) });
const build = () => {
  let d = base;
  for (const [kind, parent, n, value] of [["section", null, 1, {}], ["row", id(1), 2, {}], ["column", id(2), 3, { span: 6 }], ["analysis", id(3), 4, { reference: { analysis_id: id(9), revision: 1 }, presentation: {} }]] as const) {
    const r = applyCommand(d, add(kind, parent, n, value), () => id(n));
    if (!r.ok) throw Error(r.detail);
    d = r.document;
  }
  return d;
};

describe("commandes et historique", () => {
  it("ajoute chaque genre, déplace, modifie et supprime avec annulation et rétablissement", () => {
    let h = createHistory(build());
    const commands: [Command, number][] = [
      [add("kpi", id(3), 5, { reference: { analysis_id: id(9), revision: 1 }, presentation: {} }), 5],
      [add("text", id(3), 6), 6], [add("separator", id(3), 7), 7],
      [{ type: "move", id: id(7), parent: id(3), index: 2 }, 0],
      [{ type: "resize", id: id(3), span: 5 }, 0],
      [{ type: "update", id: id(1), property: "title", value: "Section" }, 0],
      [{ type: "update", id: id(1), property: "title", value: undefined }, 0],
      [{ type: "update", id: id(4), property: "presentation", value: { legend: "hidden" } }, 0],
      [{ type: "update", id: null, property: "name", value: "Autre" }, 0],
      [{ type: "delete", id: id(6) }, 0],
      [add("column", id(2), 8, { span: 2 }), 8], [add("container", id(8), 10), 10],
      [add("row", id(10), 11), 11], [add("column", id(11), 12), 12],
      [{ type: "move", id: id(7), parent: id(12), index: 0 }, 0],
    ];
    for (const [command, n] of commands) {
      const before = h;
      const outcome = dispatch(h, command, () => id(n));
      expect(outcome.result.ok).toBe(true);
      h = outcome.history;
      expect(undo(h).present).toEqual(before.present);
      expect(redo(undo(h)).present).toEqual(h.present);
    }
    expect(isDirty(h)).toBe(true);
    h = markSaved(h); expect(isDirty(h)).toBe(false);
    h = undo(h); expect(isDirty(h)).toBe(true);
    h = dispatch(h, { type: "update", id: null, property: "description", value: "suite" }).history;
    expect(h.future).toEqual([]);
  });
  it("refuse les opérations impossibles et conserve le document", () => {
    const d = build();
    const cases: [Command, string][] = [
      [add("row", null, 0), "incompatible_parent"], [add("row", id(99), 0), "not_found"],
      [add("column", id(1), 0), "incompatible_parent"], [{ ...add("row", id(1), 0), index: -1 }, "invalid_index"],
      [{ type: "delete", id: id(99) }, "not_found"], [{ type: "resize", id: id(1), span: 1 }, "invalid_property"],
      [{ type: "update", id: null, property: "title", value: "x" }, "invalid_property"],
      [{ type: "update", id: id(1), property: "name", value: "x" }, "invalid_property"],
      [{ type: "resize", id: id(3), span: 13 }, "invalid_document"],
      [add("container", id(3), 0), "invalid_document"],
      [{ type: "move", id: id(2), parent: id(3), index: 0 }, "incompatible_parent"],
      [{ type: "move", id: id(4), parent: id(3), index: 9 }, "invalid_index"],
    ];
    for (const [command, reason] of cases) {
      const h = createHistory(d); const result = dispatch(h, command, () => id(20));
      expect(result.result).toMatchObject({ ok: false, reason, document: d }); expect(result.history).toBe(h);
    }
    const same = dispatch(createHistory(d), { type: "update", id: null, property: "name", value: d.name });
    expect(same.history.past).toHaveLength(0);
    expect(undo(same.history)).toBe(same.history); expect(redo(same.history)).toBe(same.history);
  });
  it("valide aussi le document complet et propage les erreurs inattendues", () => {
    const full = { ...base, api_version: "board.dashboard/v1" as const, id: id(30), owner: { issuer: "issuer", subject: "subject" } };
    expect(applyCommand(full, { type: "update", id: null, property: "name", value: "Complet" }).ok).toBe(true);
    const spy = vi.spyOn(documentModule, "decodeDashboardDraft").mockImplementation(() => { throw new Error("panne"); });
    expect(() => applyCommand(base, { type: "update", id: null, property: "name", value: "Autre" })).toThrow("panne");
    spy.mockRestore();
    expect(applyCommand(build(), { type: "update", id: id(4), property: "presentation", value: undefined }).ok).toBe(false);
    expect(applyCommand(build(), { type: "update", id: id(3), property: "presentation", value: {} }).ok).toBe(false);
  });
  it("retire les cibles et les filtres devenus vides", () => {
    const d = build();
    const withFilter = { ...d, filters: [{ id: id(20), label: "Filtre", dimension: "pays", operator: "eq" as const, targets: [id(4)] }] };
    const r = applyCommand(withFilter, { type: "delete", id: id(1) });
    expect(r.ok && r.document.filters).toEqual([]);
  });
  it("borne les états et utilise crypto par défaut", () => {
    let h = createHistory(base);
    for (let i = 0; i < 110; i++) h = dispatch(h, { type: "update", id: null, property: "description", value: String(i) }).history;
    expect(h.past).toHaveLength(99);
    const random = vi.spyOn(crypto, "randomUUID").mockReturnValue(id(1) as `${string}-${string}-${string}-${string}-${string}`);
    expect(applyCommand(base, add("section", null, 1)).ok).toBe(true); random.mockRestore();
  });
});

describe("présentation", () => {
  it("résout chaque champ par priorité et limite les champs du KPI", () => {
    const theme = { chart: "bars" as const, title: "Titre", legend: "auto" as const, number_format: "auto" as const, threshold: { value: 1, label: "Seuil" }, tooltip: "value" as const };
    expect(resolveKpi({ title: theme.title, number_format: theme.number_format, threshold: theme.threshold, tooltip: theme.tooltip }, { title: "Analyse" }, {}, {}).tooltip.origin).toBe("theme");
    const result = resolveVisual(theme, { chart: "bars", title: "Analyse" }, { legend: "shown", number_format: "integer" }, { legend: "hidden", title: "Autre" });
    expect(result.legend).toEqual({ value: "hidden", origin: "component" });
    expect(result.number_format.origin).toBe("dashboard"); expect(result.chart.origin).toBe("analysis");
    expect(resolveVisual(theme, { chart: "bars", title: "Analyse" }, { legend: "shown" }, {}).legend.origin).toBe("dashboard");
    expect(resolveKpi({ title: theme.title, number_format: theme.number_format, threshold: theme.threshold, tooltip: theme.tooltip }, { title: "Analyse" }, { legend: "shown", number_format: "integer", tooltip: "value_and_definition" }, {}).tooltip.origin).toBe("dashboard");
  });
});

describe("commandes détaillées", () => {
  const doAdd = (h: ReturnType<typeof createHistory<DashboardDraft>>, command: Command, n: number) => {
    const result = dispatch(h, command, () => id(n));
    expect(result.result.ok).toBe(true);
    expect(undo(result.history).present).toEqual(h.present);
    expect(redo(undo(result.history)).present).toEqual(result.history.present);
    return result.history;
  };
  it.each([
    ["section", null, 31, {}], ["row", id(1), 32, {}], ["column", id(2), 33, { span: 1 }],
    ["analysis", id(3), 34, { reference: { analysis_id: id(9), revision: 1 }, presentation: {} }],
    ["kpi", id(3), 35, { reference: { analysis_id: id(9), revision: 1 }, presentation: {} }],
    ["text", id(3), 36, {}], ["separator", id(3), 37, {}],
  ] as const)("ajoute %s au parent compatible", (kind, parent, n, value) => {
    doAdd(createHistory(build()), add(kind, parent, n, value), n);
  });
  it("ajoute un conteneur dans une colonne vide et une rangée dans ce conteneur", () => {
    let h = createHistory(build());
    h = doAdd(h, add("column", id(2), 40, { span: 2 }), 40);
    h = doAdd(h, add("container", id(40), 41), 41);
    doAdd(h, add("row", id(41), 42), 42);
  });
  it.each(["section", "row", "column", "container", "analysis", "kpi", "text", "separator"] as const)("refuse %s sous un parent incompatible", (kind) => {
    const result = applyCommand(build(), add(kind, id(4), 42), () => id(42));
    expect(result).toMatchObject({ ok: false, reason: "incompatible_parent" });
  });
  it("déplace dans la même liste puis vers une autre colonne", () => {
    let h = createHistory(build());
    h = doAdd(h, add("separator", id(3), 44), 44);
    h = doAdd(h, { type: "move", id: id(44), parent: id(3), index: 1 }, 0);
    h = doAdd(h, add("column", id(2), 45, { span: 1 }), 45);
    doAdd(h, { type: "move", id: id(44), parent: id(45), index: 0 }, 0);
  });
  it("refuse un déplacement dans son descendant et un rang hors limites", () => {
    const d = build();
    expect(applyCommand(d, { type: "move", id: id(1), parent: id(3), index: 0 })).toMatchObject({ reason: "incompatible_parent", document: d });
    expect(applyCommand(d, { type: "move", id: id(4), parent: id(1), index: 0 })).toMatchObject({ reason: "incompatible_parent" });
    expect(applyCommand(d, { type: "move", id: id(4), parent: id(3), index: 3 })).toMatchObject({ reason: "invalid_index", document: d });
  });
  it("redimensionne et refuse une largeur excessive ou un autre genre", () => {
    const h = createHistory(build());
    doAdd(h, { type: "resize", id: id(3), span: 7 }, 0);
    expect(applyCommand(h.present, { type: "resize", id: id(3), span: 13 })).toMatchObject({ reason: "invalid_document" });
    expect(applyCommand(h.present, { type: "resize", id: id(1), span: 2 })).toMatchObject({ reason: "invalid_property" });
  });
  it("retire uniquement les cibles orphelines et les filtres vidés", () => {
    let h = createHistory(build());
    h = doAdd(h, add("kpi", id(3), 50, { reference: { analysis_id: id(9), revision: 1 }, presentation: {} }), 50);
    const f = { id: id(60), label: "Pays", dimension: "country", operator: "eq" as const, targets: [id(4), id(50)] };
    const d = { ...h.present, filters: [f, { ...f, id: id(61), targets: [id(4)] }] };
    const result = dispatch(createHistory(d), { type: "delete", id: id(4) });
    expect(result.result.ok).toBe(true);
    expect(result.history.present.filters).toEqual([{ ...f, targets: [id(50)] }]);
    expect(undo(result.history).present).toEqual(d);
    expect(redo(undo(result.history)).present).toEqual(result.history.present);
  });
  it.each([
    [null, "name", "Nouveau"], [null, "description", "Description"], [null, "visibility", "shared"],
    [null, "defaults", { legend: "shown" }], [id(1), "title", "Titre"], [id(4), "presentation", { tooltip: "value" }],
  ] as const)("modifie %s / %s", (target, property, value) => {
    doAdd(createHistory(build()), { type: "update", id: target, property, value }, 0);
  });
  it.each(["title", "presentation", "name", "description", "visibility", "defaults"] as const)("refuse la propriété %s sur une rangée", (property) => {
    expect(applyCommand(build(), { type: "update", id: id(2), property, value: "x" })).toMatchObject({ reason: "invalid_property" });
  });
  it.each(["title", "presentation"] as const)("refuse %s sur le dashboard", (property) => {
    expect(applyCommand(build(), { type: "update", id: null, property, value: "x" })).toMatchObject({ reason: "invalid_property" });
  });
  it("garde exactement cent états et compare à l'état enregistré après annulation", () => {
    let h = createHistory(base);
    for (let i = 1; i <= 99; i++) h = dispatch(h, { type: "update", id: null, property: "description", value: String(i) }).history;
    expect(h.past).toHaveLength(99);
    expect(h.past[0]).toEqual(base);
    h = dispatch(h, { type: "update", id: null, property: "description", value: "100" }).history;
    expect(h.past).toHaveLength(99);
    expect(h.past[0]?.description).toBe("1");
    const before = h;
    expect(dispatch(h, { type: "update", id: null, property: "name", value: "" }).history).toBe(before);
    expect(dispatch(h, { type: "update", id: null, property: "description", value: "100" }).history).toBe(before);
    h = markSaved(h);
    h = undo(h);
    expect(isDirty(h)).toBe(true);
    h = markSaved(h);
    expect(isDirty(h)).toBe(false);
    h = redo(h);
    expect(isDirty(h)).toBe(true);
    h = undo(h);
    expect(isDirty(h)).toBe(false);
  });
});

describe("commandes de filtres, contenu et lots", () => {
  const filter = { label: "Pays", dimension: "country", operator: "eq" as const, targets: [id(4)], default: "FR", allowed: ["FR", "BE"] };
  it("ajoute, modifie, retire les surcharges et supprime un filtre avec historique", () => {
    let h = createHistory(build());
    const added = dispatch(h, { type: "add_filter", value: filter }, () => id(20));
    expect(added.result.ok).toBe(true);
    expect(undo(added.history).present).toEqual(h.present);
    expect(redo(undo(added.history)).present).toEqual(added.history.present);
    h = added.history;
    const changed = dispatch(h, { type: "update_filter", id: id(20), value: { label: "Région", dimension: "region", operator: "in", default: ["FR"], allowed: ["FR"], targets: [id(4)] } });
    expect(changed.result.ok).toBe(true);
    expect(undo(changed.history).present).toEqual(h.present);
    h = changed.history;
    const cleared = dispatch(h, { type: "update_filter", id: id(20), value: {}, remove: ["default", "allowed"] });
    expect(cleared.history.present.filters[0]).not.toHaveProperty("default");
    expect(cleared.history.present.filters[0]).not.toHaveProperty("allowed");
    const deleted = dispatch(cleared.history, { type: "delete_filter", id: id(20) });
    expect(deleted.history.present.filters).toEqual([]);
    expect(redo(undo(deleted.history)).present).toEqual(deleted.history.present);
    expect(applyCommand(h.present, { type: "delete_filter", id: id(99) })).toMatchObject({ reason: "not_found" });
    expect(applyCommand(h.present, { type: "update_filter", id: id(99), value: {} })).toMatchObject({ reason: "not_found" });
    expect(applyCommand(h.present, { type: "update_filter", id: id(20), value: { targets: [] } })).toMatchObject({ reason: "invalid_document" });
  });
  it("ne permet pas de renommer un filtre via update_filter", () => {
    const original = { ...build(), filters: [{ id: id(20), ...filter }] };
    const result = applyCommand(original, { type: "update_filter", id: id(20), value: { id: id(21), label: "Modifié" } as unknown as Partial<Omit<import("../document").CommonFilter, "id">> });
    expect(result.ok && result.document.filters[0]?.id).toBe(id(20));
  });
  it("valide aussi un document complet et propage une panne du décodeur dans un lot", () => {
    const full = { ...base, api_version: "board.dashboard/v1" as const, id: id(30), owner: { issuer: "issuer", subject: "subject" } };
    expect(applyCommand(full, { type: "batch", commands: [{ type: "update", id: null, property: "name", value: "Autre" }] }).ok).toBe(true);
    const spy = vi.spyOn(documentModule, "decodeDashboardDraft").mockImplementation(() => { throw new Error("panne"); });
    expect(() => applyCommand(base, { type: "batch", commands: [{ type: "update", id: null, property: "name", value: "Autre" }] })).toThrow("panne");
    spy.mockRestore();
    expect(applyCommand({ ...base, name: "" }, { type: "batch", commands: [] })).toMatchObject({ reason: "invalid_document", index: 0 });
  });
  it("conserve les autres filtres et permet d'adopter une révision de KPI", () => {
    let d = build();
    const added = applyCommand(d, add("kpi", id(3), 5, { reference: { analysis_id: id(9), revision: 1 }, presentation: {} }), () => id(5));
    if (!added.ok) throw Error("KPI");
    d = { ...added.document, filters: [{ id: id(20), ...filter }, { id: id(21), ...filter, targets: [id(5)] }] };
    const changed = applyCommand(d, { type: "update_filter", id: id(20), value: { label: "Autre" } });
    expect(changed.ok && changed.document.filters[1]).toEqual(d.filters[1]);
    const removed = applyCommand(d, { type: "delete", id: id(4) });
    expect(removed.ok && removed.removed).toMatchObject({ filters: [d.filters[0]], targets: [] });
    const revision = applyCommand(d, { type: "adopt_revision", id: id(5), revision: 2 });
    expect(revision.ok).toBe(true);
  });
  it("adopte une révision, modifie un texte et refuse les genres ou valeurs invalides", () => {
    let h = createHistory(build());
    let next = dispatch(h, { type: "adopt_revision", id: id(4), revision: 2 });
    expect(next.result.ok).toBe(true);
    expect(undo(next.history).present).toEqual(h.present);
    expect(redo(undo(next.history)).present).toEqual(next.history.present);
    h = dispatch(next.history, add("text", id(3), 50), () => id(50)).history;
    next = dispatch(h, { type: "update_blocks", id: id(50), blocks: [{ type: "paragraph", content: [{ text: "Bonjour" }] }] });
    expect(next.result.ok).toBe(true);
    expect(undo(next.history).present).toEqual(h.present);
    expect(redo(undo(next.history)).present).toEqual(next.history.present);
    expect(applyCommand(h.present, { type: "adopt_revision", id: id(50), revision: 2 })).toMatchObject({ reason: "invalid_property" });
    expect(applyCommand(h.present, { type: "update_blocks", id: id(4), blocks: [] })).toMatchObject({ reason: "invalid_property" });
    expect(applyCommand(h.present, { type: "adopt_revision", id: id(4), revision: 0 })).toMatchObject({ reason: "invalid_document" });
    expect(applyCommand(h.present, { type: "update_blocks", id: id(50), blocks: [null] })).toMatchObject({ reason: "invalid_document" });
  });
  it("enveloppe une tuile en un batch atomique, annulable d'un coup", () => {
    const h = createHistory(build());
    const ids = [id(20), id(21), id(22)];
    const batch: Command = { type: "batch", commands: [add("container", id(3), 20), add("row", id(20), 21), add("column", id(21), 22), { type: "move", id: id(4), parent: id(22), index: 0 }] };
    const result = dispatch(h, batch, () => ids.shift() as string);
    expect(result.result.ok).toBe(true);
    expect(result.history.past).toHaveLength(1);
    expect(undo(result.history).present).toEqual(h.present);
    expect(redo(undo(result.history)).present).toEqual(result.history.present);
    const failed = dispatch(h, { type: "batch", commands: [add("section", null, 10), { type: "delete", id: id(99) }] }, () => id(10));
    expect(failed.result).toMatchObject({ ok: false, index: 1, reason: "not_found", document: h.present });
    expect(failed.history).toBe(h);
    expect(applyCommand(h.present, { type: "batch", commands: [{ type: "resize", id: id(3), span: 13 }, { type: "update", id: null, property: "description", value: "x" }] })).toMatchObject({ reason: "invalid_document", index: 0 });
    expect(applyCommand(h.present, { type: "batch", commands: [{ type: "resize", id: id(3), span: 13 }, { type: "resize", id: id(3), span: 6 }] }).ok).toBe(true);
    expect(applyCommand(h.present, { type: "batch", commands: [{ type: "batch", commands: [] }] } as unknown as Command)).toMatchObject({ reason: "invalid_property", index: 0 });
  });
  it("rend les filtres supprimés et les cibles retirées des filtres conservés", () => {
    let d = build();
    const kpi = applyCommand(d, add("kpi", id(3), 5, { reference: { analysis_id: id(9), revision: 1 }, presentation: {} }), () => id(5));
    if (!kpi.ok) throw Error("KPI");
    d = { ...kpi.document, filters: [{ id: id(20), ...filter, targets: [id(4), id(5)] }, { id: id(21), ...filter }] };
    const result = applyCommand(d, { type: "delete", id: id(4) });
    expect(result).toMatchObject({ ok: true, removed: { filters: [d.filters[1]], targets: [{ filterId: id(20), targets: [id(4)] }] } });
  });
  it("impose le genre et l'identifiant généré lors d'un ajout", () => {
    const result = applyCommand(build(), add("separator", id(3), 30, { type: "text", id: id(99) }), () => id(30));
    expect(result.ok && result.document.layout.sections[0]?.rows[0]?.columns[0]?.children[0]).toEqual({ id: id(30), type: "separator" });
  });
});

describe("héritage explicite", () => {
  it("résout le seuil facultatif et revient à l'analyse après retrait", () => {
    const source = { chart: "bars" as const, title: "Analyse" };
    const threshold = { value: 2, label: "Seuil" };
    const theme = { legend: "auto" as const };
    expect(resolveVisual(theme, source, {}, { threshold }).threshold).toEqual({ value: threshold, origin: "component" });
    expect(resolveVisual({ ...theme, threshold }, source, {}, {}).threshold).toEqual({ value: threshold, origin: "theme" });
    expect(resolveVisual(theme, source, { threshold } as unknown as import("../document").Defaults, {}).threshold).toEqual({ value: undefined, origin: "theme" });
    expect(resolveVisual(theme, source, {}, {}).threshold).toEqual({ value: undefined, origin: "theme" });
    const overridden = resolveVisual(theme, source, {}, { title: "Autre", chart: "line" });
    expect(overridden.title.origin).toBe("component");
    expect(resolveVisual(theme, source, { tooltip: "value" }, {}).tooltip.origin).toBe("dashboard");
    const restored = resolveVisual(theme, source, {}, {});
    expect(restored.title).toEqual({ value: "Analyse", origin: "analysis" });
    expect(restored.chart).toEqual({ value: "bars", origin: "analysis" });
    expect(resolveKpi({ threshold }, { title: "Analyse" }, {}, {}).threshold.origin).toBe("theme");
    expect(resolveKpi({}, { title: "Analyse" }, { threshold } as unknown as import("../document").Defaults, {}).threshold.value).toBeUndefined();
  });
});
