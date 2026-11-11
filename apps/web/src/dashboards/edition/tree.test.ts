import { expect, it } from "vitest";
import { ancestors, buildTree, dropPlace, findLayoutNode, findNode, flatten, reparentPlace, stepPlace } from "./tree";
import { N, sampleDraft } from "./testing";

const tree = buildTree(sampleDraft(), { [N.visual]: "Chiffre d'affaires", [N.kpi]: undefined });

it("construit l'arbre avec libellés, rangs, niveaux et largeurs", () => {
  expect(tree.map((node) => node.label)).toEqual(["Section 1 · Ventes", "Section 2"]);
  const labels = flatten(tree).map((node) => `${String(node.level)}:${node.name}:${node.label}`);
  expect(labels).toEqual([
    "1:Section 1:Section 1 · Ventes", "2:Rangée 1:Rangée 1", "3:Colonne 1:Colonne 1 · 4/12", "4:Visuel:Visuel · Chiffre d'affaires", "4:Texte:Texte",
    "3:Colonne 2:Colonne 2 · 4/12", "4:KPI:KPI", "4:Séparateur:Séparateur", "3:Colonne 3:Colonne 3 · 4/12", "4:Conteneur:Conteneur", "5:Rangée 1:Rangée 1", "6:Colonne 1:Colonne 1 · 12/12", "1:Section 2:Section 2",
  ]);
  expect(findNode(tree, N.c1)).toMatchObject({ span: 4, index: 0, siblings: 3, parent: N.r1, kind: "column" });
  expect(findNode(tree, N.s2)).toMatchObject({ parent: null, index: 1, siblings: 2 });
  expect(findNode(tree, "absent")).toBeUndefined();
  expect(buildTree(sampleDraft()).length).toBe(2);
});

it("liste les ancêtres du plus lointain au plus proche, lui exclu", () => {
  expect(ancestors(tree, N.c4).map((node) => node.id)).toEqual([N.s1, N.r1, N.c3, N.box, N.r2]);
  expect(ancestors(tree, N.s1)).toEqual([]);
  expect(ancestors(tree, "absent")).toEqual([]);
});

it("calcule un cran parmi les frères, ou rien au bord", () => {
  expect(stepPlace(tree, N.text, "earlier")).toEqual({ parent: N.c1, index: 0 });
  expect(stepPlace(tree, N.visual, "later")).toEqual({ parent: N.c1, index: 1 });
  expect(stepPlace(tree, N.visual, "earlier")).toBeNull();
  expect(stepPlace(tree, N.text, "later")).toBeNull();
  expect(stepPlace(tree, "absent", "later")).toBeNull();
  expect(stepPlace(tree, N.s2, "earlier")).toEqual({ parent: null, index: 0 });
});

it("change de parent suivant ou précédent qui accueille le genre, hors de lui-même", () => {
  expect(reparentPlace(tree, N.text, "next")).toEqual({ parent: N.c2, index: 0 });
  expect(reparentPlace(tree, N.kpi, "previous")).toEqual({ parent: N.c1, index: 2 });
  expect(reparentPlace(tree, N.text, "previous")).toBeNull();
  expect(reparentPlace(tree, N.kpi, "next")).toEqual({ parent: N.c3, index: 0 });
  expect(reparentPlace(tree, N.box, "next")).toBeNull();
  expect(reparentPlace(tree, N.s1, "next")).toBeNull();
  expect(reparentPlace(tree, "absent", "next")).toBeNull();
  expect(reparentPlace(tree, N.r1, "next")).toEqual({ parent: N.s2, index: 0 });
  expect(reparentPlace(tree, N.r2, "previous")).toEqual({ parent: N.s1, index: 1 });
  expect(reparentPlace(tree, N.r2, "next")).toEqual({ parent: N.s2, index: 0 });
});

it("juge un lâcher : famille, parent, soi-même, descendants", () => {
  expect(dropPlace(tree, N.text, N.visual, false)).toEqual({ parent: N.c1, index: 0 });
  expect(dropPlace(tree, N.visual, N.text, true)).toEqual({ parent: N.c1, index: 1 });
  expect(dropPlace(tree, N.s1, N.s2, true)).toEqual({ parent: null, index: 1 });
  expect(dropPlace(tree, N.s2, N.s1, false)).toEqual({ parent: null, index: 0 });
  expect(dropPlace(tree, N.text, N.c2, false)).toEqual({ parent: N.c2, index: 2 });
  expect(dropPlace(tree, N.visual, N.visual, false)).toBeNull();
  expect(dropPlace(tree, N.box, N.r2, false)).toBeNull();
  expect(dropPlace(tree, N.text, N.s2, false)).toBeNull();
  expect(dropPlace(tree, "absent", N.s2, false)).toBeNull();
  expect(dropPlace(tree, N.text, "absent", false)).toBeNull();
  expect(dropPlace(tree, N.s1, N.c4, false)).toBeNull();
  expect(dropPlace(tree, N.r2, N.s1, false)).toEqual({ parent: N.s1, index: 1 });
});

it("retrouve le contenu d'un identifiant, y compris dans un conteneur", () => {
  const draft = sampleDraft();
  expect(findLayoutNode(draft, N.text)).toMatchObject({ type: "text" });
  expect(findLayoutNode(draft, N.box)).toMatchObject({ type: "container" });
  expect(findLayoutNode(draft, "absent")).toBeUndefined();
  const inner = { ...draft, layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: [{ id: N.box, type: "container" as const, rows: [{ id: N.r2, columns: [{ id: N.c4, span: 12, children: [{ id: N.rule, type: "separator" as const }] }] }] }] }] }] }] } };
  expect(findLayoutNode(inner, N.rule)).toMatchObject({ type: "separator" });
});
