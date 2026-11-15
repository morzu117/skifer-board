import { describe, expect, it, vi } from "vitest";
import * as analysis from "../analyses/document";
import parity from "../../../../contracts/themes/fixtures/palette-parity.json";
import { decodeTheme, type ThemeDocument } from "./document";
import { TOKEN_CATALOG, contrastOf } from "./catalog";
import { applyCommand, canSave, choicesFor, createHistory, dispatch, isDirty, markSaved, redo, themeProblems, undo, type Command, type Document } from "./edition";

const valid = import.meta.glob<unknown>("../../../../contracts/themes/fixtures/valid/*.json", { eager: true, import: "default" });
const invalid = import.meta.glob<ThemeDocument>("../../../../contracts/themes/fixtures/invalid/*.json", { eager: true, import: "default" });
const source = () => decodeTheme(valid["../../../../contracts/themes/fixtures/valid/clair.json"]);
const apply = (command: Command, document: Document = source()) => applyCommand(document, command, TOKEN_CATALOG);
const accept = (command: Command, document: Document = source()): Document => { const result = apply(command, document); expect(result.ok).toBe(true); return result.document; };
const refuse = (command: Command, reason: string, document: Document = source()) => { const result = apply(command, document); expect(result).toEqual({ ok: false, reason, document }); expect(result.document).toBe(document); };

describe("éditeur de thème", () => {
  it("propose les choix du catalogue et aucune marque sous le seuil", () => {
    for (const base of ["skifer-clair", "skifer-ardoise"] as const) {
      expect(choicesFor(TOKEN_CATALOG, base, "palette")).toEqual(Object.keys(TOKEN_CATALOG.luminance));
      for (const [role, min] of [["mark", 3], ["text", 4.5]] as const) {
        expect(choicesFor(TOKEN_CATALOG, base, role)).toEqual(Object.keys(TOKEN_CATALOG.bases[base][role]));
        for (const name of choicesFor(TOKEN_CATALOG, base, role)) expect(contrastOf(TOKEN_CATALOG, base, name)).toBeGreaterThanOrEqual(min);
      }
    }
  });
  it("change la base sans remplacer les tokens devenus invalides", () => {
    const before = source(); const after = accept({ type: "base", value: "skifer-ardoise" }, before);
    expect(after.base).toBe("skifer-ardoise"); expect(after.roles).toEqual(before.roles);
    expect(themeProblems(after, TOKEN_CATALOG).some((problem) => problem.rule === "token_not_admissible")).toBe(true);
    expect(canSave(after, TOKEN_CATALOG)).toBe(false); expect(before.base).toBe("skifer-clair");
    refuse({ type: "base", value: "invalid" } as unknown as Command, "invalid_command");
    expect(accept({ type: "mark", role: "series", token: "ink" }).roles.marks.series).toBe("ink");
    refuse({ type: "mark", role: "series", token: "surface" }, "token_not_admissible");
    refuse({ type: "mark", role: "bad", token: "ink" } as unknown as Command, "invalid_command");
  });
  it("ajoute, retire et déplace les paliers sans muter l'entrée", () => {
    for (const palette of ["categorical", "sequential", "diverging"] as const) {
      const before = source(); const added = accept({ type: "palette_add", palette, index: 1, token: "ink" }, before);
      expect(added[palette][1]).toBe("ink"); expect(before[palette]).toHaveLength(3 - Number(palette === "categorical"));
      const moved = accept({ type: "palette_move", palette, from: 1, to: 0 }, added);
      expect(moved[palette][0]).toBe("ink");
      const removed = accept({ type: "palette_remove", palette, index: 0 }, moved);
      expect(removed[palette]).toEqual(before[palette]);
      for (const command of [{ type: "palette_add", palette, index: -1, token: "ink" }, { type: "palette_remove", palette, index: 999 }, { type: "palette_move", palette, from: 99, to: 0 }, { type: "palette_move", palette, from: 0, to: 99 }] as Command[]) refuse(command, "invalid_index");
      refuse({ type: "palette_add", palette, index: 1, token: "unknown" }, "token_not_admissible");
      refuse({ type: "palette_add", palette, index: 0, token: "surface" }, "token_not_admissible", palette === "sequential" ? { ...before, sequential: [] } : before);
    }
    expect(accept({ type: "palette_add", palette: "sequential", index: 0, token: "surface" }).sequential[0]).toBe("surface");
    expect(accept({ type: "palette_add", palette: "diverging", index: 1, token: "surface" }).diverging[1]).toBe("surface");
    const withLow = accept({ type: "palette_add", palette: "sequential", index: 0, token: "surface" });
    refuse({ type: "palette_move", palette: "sequential", from: 0, to: withLow.sequential.length - 1 }, "token_not_admissible", withLow);
    refuse({ type: "palette_move", palette: "diverging", from: 1, to: 2 }, "token_not_admissible");
    const unknown = { ...source(), sequential: ["unknown", "blue", "ink"] };
    refuse({ type: "palette_move", palette: "sequential", from: 0, to: 1 }, "token_not_admissible", unknown);
    for (const type of ["palette_add", "palette_remove", "palette_move"] as const) refuse({ type, palette: "bad", index: 0, token: "ink", from: 0, to: 0 } as unknown as Command, "invalid_command");
  });
  it("modifie les champs fermés, et refuse les valeurs hors domaine", () => {
    expect(accept({ type: "typography", field: "scale", value: "large" }).typography.scale).toBe("large");
    expect(accept({ type: "typography", field: "sans", value: "sans" }).typography.sans).toBe("sans");
    refuse({ type: "typography", field: "scale", value: "bad" }, "invalid_command");
    refuse({ type: "typography", field: "bad", value: "bad" } as unknown as Command, "invalid_command");
    refuse({ type: "typography", field: "density", value: "airy" } as unknown as Command, "invalid_command");
    expect(accept({ type: "density", value: "airy" }).density).toBe("airy"); refuse({ type: "density", value: "bad" }, "invalid_command");
    expect(accept({ type: "format", field: "number", value: "percent" }).formats.number).toBe("percent");
    expect(accept({ type: "format", field: "date", value: "iso" }).formats.date).toBe("iso");
    refuse({ type: "format", field: "date", value: "bad" }, "invalid_command");
    refuse({ type: "format", field: "bad", value: "bad" } as unknown as Command, "invalid_command");
    refuse({ type: "format", field: "density", value: "airy" } as unknown as Command, "invalid_command");
    const changed = accept({ type: "chart_default", chart: "bars", field: "legend", value: "hidden" });
    expect(changed.chart_defaults.bars?.legend).toBe("hidden");
    expect(accept({ type: "chart_default", chart: "bars", field: "legend", value: null }, changed).chart_defaults.bars?.legend).toBeUndefined();
    expect(accept({ type: "chart_default", chart: "line", field: "tooltip", value: null }).chart_defaults.line).toBeUndefined();
    const both = accept({ type: "chart_default", chart: "line", field: "tooltip", value: "value" });
    const unchanged = dispatch(createHistory(both), { type: "chart_default", chart: "bars", field: "tooltip", value: "value" }, TOKEN_CATALOG);
    expect(unchanged.history.past).toEqual([]);
    const single = both;
    expect(accept({ type: "chart_default", chart: "line", field: "tooltip", value: null }, single).chart_defaults.line).toBeUndefined();
    for (const command of [{ type: "chart_default", chart: "unknown", field: "legend", value: "auto" }, { type: "chart_default", chart: "bars", field: "bad", value: "auto" }, { type: "chart_default", chart: "bars", field: "legend", value: "bad" }] as unknown as Command[]) refuse(command, "invalid_command");
    expect(accept({ type: "name", value: "Autre" }).name).toBe("Autre");
    expect(accept({ type: "description", value: "Texte" }).description).toBe("Texte");
    refuse({ type: "name", value: "" }, "invalid_command");
    refuse({ type: "description", value: "x".repeat(2001) }, "invalid_command");
    refuse({ type: "unknown" } as unknown as Command, "invalid_command");
    const document = source();
    const spy = vi.spyOn(analysis, "decodeName").mockImplementation(() => { throw new Error("panne"); });
    try { expect(() => apply({ type: "name", value: "Nom" }, document)).toThrow("panne"); } finally { spy.mockRestore(); }
  });
  it("borne l'historique, annule et rétablit sans marquer un document invalide comme enregistré", () => {
    let history = createHistory(source()); expect(isDirty(history)).toBe(false);
    expect(undo(history)).toBe(history); expect(redo(history)).toBe(history);
    expect(dispatch(history, { type: "name", value: history.present.name }, TOKEN_CATALOG).history).toBe(history);
    expect(dispatch(history, { type: "mark", role: "series", token: "surface" }, TOKEN_CATALOG).history).toBe(history);
    for (let i = 0; i < 110; i += 1) history = dispatch(history, { type: "name", value: `Thème ${String(i)}` }, TOKEN_CATALOG).history;
    expect(history.past).toHaveLength(99); expect(isDirty(history)).toBe(true);
    const previous = undo(history); expect(previous.present.name).toBe("Thème 108");
    expect(redo(previous).present.name).toBe("Thème 109");
    expect(dispatch(previous, { type: "name", value: "Nouvelle branche" }, TOKEN_CATALOG).history.future).toEqual([]);
    history = markSaved(history, TOKEN_CATALOG); expect(isDirty(history)).toBe(false);
    const invalidHistory = dispatch(history, { type: "base", value: "skifer-ardoise" }, TOKEN_CATALOG).history;
    expect(markSaved(invalidHistory, TOKEN_CATALOG)).toBe(invalidHistory); expect(isDirty(invalidHistory)).toBe(true);
  });
  it("respecte les fixtures et leurs codes et pointeurs publiés par le serveur", () => {
    for (const [path, value] of Object.entries(valid)) expect(themeProblems(decodeTheme(value), TOKEN_CATALOG), path).toEqual([]);
    expect(Object.keys(parity).sort()).toEqual(Object.keys(invalid).map((path) => path.split("/").at(-1)?.replace(/\.json$/, "")).sort());
    for (const name of ["categorical_duplicate", "categorical_short", "categorical_long", "sequential_short", "sequential_long", "diverging_short", "diverging_long", "palette_unknown", "diverging_unknown", "hex"]) {
      expect(() => decodeTheme(invalid[`../../../../contracts/themes/fixtures/invalid/${name}.json`]), name).toThrow();
    }
    for (const [name, expected] of Object.entries(parity)) {
      const value = invalid[`../../../../contracts/themes/fixtures/invalid/${name}.json`] as ThemeDocument;
      expect(themeProblems(value, TOKEN_CATALOG), name).toEqual(expected);
    }
  });
});
