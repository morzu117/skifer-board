import { describe, expect, it } from "vitest";
import { loadYaml } from "./yaml";

describe("lecteur YAML des fixtures", () => {
  it("lit blocs, listes, scalaires, guillemets, flux et blocs littéraux", () => {
    expect(loadYaml([
      "# commentaire",
      "a: 1",
      "b: -2.5",
      "c: true",
      "d: null",
      "e:",
      "f: ''",
      "g: \"x\\ty\\x01\\u00e9\\\\\\\"\\/\\n\\0\\a\"",
      "h: 'l''eau'",
      "i: https://example.test/x",
      "j: [a, 'b', \"c\", 1, [2], {k: v}]",
      "k: {x1: 1, y1: \"z\", w1: []}",
      "l:",
      "  - one",
      "  - key: v",
      "    other: [ ]",
      "  -",
      "    - nested",
      "  -",
      "m: {}",
      "n: []",
      "o: |-",
      "  line 1",
      "",
      "    line 2",
      "p: |",
      "  keep",
      "q:",
      "- same",
      "- indent",
      "r:",
      "  s: 2026-01-01",
    ].join("\n"))).toEqual({
      a: 1, b: -2.5, c: true, d: null, e: null, f: "", g: "x\ty\u0001é\\\"/\n\u0000\u0007", h: "l'eau", i: "https://example.test/x",
      j: ["a", "b", "c", 1, [2], { k: "v" }], k: { x1: 1, y1: "z", w1: [] },
      l: ["one", { key: "v", other: [] }, ["nested"], null], m: {}, n: [], o: "line 1\n\n  line 2", p: "keep\n", q: ["same", "indent"],
      r: { s: new Date("2026-01-01") },
    });
  });

  it("lit une liste de listes, dont les éléments sont des dictionnaires ou des scalaires", () => {
    expect(loadYaml("a:\n  - - text: Un\n    - - text: Deux\n        strong: true\n  - - 1\n    - 2\nb: 3")).toEqual({
      a: [[{ text: "Un" }, [{ text: "Deux", strong: true }]], [1, 2]], b: 3,
    });
  });

  it("lit un flottant à exposant signé, et refuse les autres exposants", () => {
    expect(loadYaml("a: 1.0e+16\nb: -2.5E-3")).toEqual({ a: 1e16, b: -0.0025 });
    expect(() => loadYaml("a: 1e16")).toThrow("nombre");
    expect(() => loadYaml("a: 1.0e16")).toThrow("nombre");
  });

  it("replie un texte entre guillemets sur plusieurs lignes comme YAML", () => {
    expect(loadYaml("a: 'un\n\n  deux\n  trois'\nb:\n  - \"x\n    y\"\n  - 'z'\nc: 1")).toEqual({ a: "un\ndeux trois", b: ["x y", "z"], c: 1 });
    expect(() => loadYaml("a: 'jamais fermé\n")).toThrow("guillemets");
  });

  it("lit un scalaire racine, un document vide et une liste racine", () => {
    expect(loadYaml("text")).toBe("text");
    expect(loadYaml("# rien\n\n")).toBeNull();
    expect(loadYaml("- a\n- b")).toEqual(["a", "b"]);
    expect(loadYaml("a: 1.5\nb: 0.5\nc: 12\nd: -3\ne: 5f1d7c52-3b0e-4d36-9a54-0c7a3e1b9d20\nf: 2e Avenue\ng: 0")).toEqual({ a: 1.5, b: 0.5, c: 12, d: -3, e: "5f1d7c52-3b0e-4d36-9a54-0c7a3e1b9d20", f: "2e Avenue", g: 0 });
  });

  it.each([
    "a: 1\na: 2",
    "a: {x: 1, x: 2}",
    "a: yes",
    "a: True",
    "a: FALSE",
    "a: Null",
    "a: ~",
    "a: No",
    "a: ON",
    "a: y",
    "a: 0x10",
    "a: 0o17",
    "a: 0b101",
    "a: 010",
    "a: 1_000",
    "a: 1.5e2",
    "a: 1e3",
    "a: 1:30",
    "a: .inf",
    "a: -.INF",
    "a: .NaN",
    "a: .5",
    "a: [0x10]",
    "a: >\n  folded",
    "a: &anchor 1",
    "a: *anchor",
    "a: x: y",
    "a: x #y",
    "a: 'open",
    "a: \"open",
    "a: \"\\q\"",
    "a: {x 1}",
    "a: {x: 1 y: 2}",
    "a: [1] extra",
    "a: [1,",
    "\ta: 1",
    "a: 1\n- b",
    "a b: 1",
    "a: 1\nb",
    "a: x:",
  ])("refuse ce qui sort du sous-ensemble : %j", (source) => {
    expect(() => loadYaml(source)).toThrow("YAML hors du sous-ensemble lu");
  });
});
