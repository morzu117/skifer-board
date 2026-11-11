import { expect, it } from "vitest";
import { ADDABLE, additionPlace, placed } from "./placement";
import { N, sampleDraft } from "./testing";
import { buildTree } from "./tree";

const tree = buildTree(sampleDraft());
const empty = buildTree({ ...sampleDraft(), layout: { sections: [] } });

it("pose une section après la section de la sélection, ou en queue", () => {
  expect(additionPlace(tree, "section", N.text)).toEqual({ parent: null, index: 1 });
  expect(additionPlace(tree, "section", N.s1)).toEqual({ parent: null, index: 1 });
  expect(additionPlace(tree, "section", N.s2)).toEqual({ parent: null, index: 2 });
  expect(additionPlace(tree, "section", null)).toEqual({ parent: null, index: 2 });
  expect(additionPlace(tree, "section", "absent")).toEqual({ parent: null, index: 2 });
  expect(additionPlace(empty, "section", null)).toEqual({ parent: null, index: 0 });
});

it("pose chaque genre sous le plus proche parent qui l'accueille, après la branche sélectionnée", () => {
  expect(additionPlace(tree, "row", N.s1)).toEqual({ parent: N.s1, index: 1 });
  expect(additionPlace(tree, "row", N.text)).toEqual({ parent: N.s1, index: 1 });
  expect(additionPlace(tree, "row", N.c4)).toEqual({ parent: N.box, index: 1 });
  expect(additionPlace(tree, "text", N.visual)).toEqual({ parent: N.c1, index: 1 });
  expect(additionPlace(tree, "separator", N.c1)).toEqual({ parent: N.c1, index: 2 });
  expect(additionPlace(tree, "container", N.c4)).toEqual({ parent: N.c4, index: 0 });
});

it("une colonne prend les douzièmes libres, au moins un", () => {
  expect(additionPlace(tree, "column", N.r1)).toEqual({ parent: N.r1, index: 3, span: 1 });
  expect(additionPlace(tree, "column", N.visual)).toEqual({ parent: N.r1, index: 1, span: 1 });
  const half = buildTree({ ...sampleDraft(), layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 5, children: [] }, { id: N.c2, span: 3, children: [] }] }] }] } });
  expect(additionPlace(half, "column", N.r1)).toEqual({ parent: N.r1, index: 2, span: 4 });
  const nothing = buildTree({ ...sampleDraft(), layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [] }] }] } });
  expect(additionPlace(nothing, "column", N.r1)).toEqual({ parent: N.r1, index: 0, span: 12 });
});

it("refuse en disant quoi sélectionner d'abord, sans deviner de parent", () => {
  for (const [kind, parent] of [["row", "une section ou un conteneur"], ["column", "une rangée"], ["container", "une colonne"], ["text", "une colonne"], ["separator", "une colonne"]] as const) {
    const refused = additionPlace(tree, kind, null);
    expect((refused as { refused: string }).refused).toContain(`Sélectionnez d'abord ${parent}`);
  }
  expect(additionPlace(tree, "column", N.s1)).toHaveProperty("refused");
  expect(ADDABLE).toEqual(["section", "row", "column", "container", "text", "separator"]);
});

it("annonce un nœud posé avec sa place et son parent", () => {
  expect(placed(tree, N.text)).toBe("Texte, position 2 sur 2, dans Colonne 1 · 4/12");
  expect(placed(tree, N.s2)).toBe("Section 2, position 2 sur 2");
});
