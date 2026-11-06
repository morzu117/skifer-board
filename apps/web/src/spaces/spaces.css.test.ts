import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Le chemin passe par une variable : Vite prendrait `new URL("littéral", import.meta.url)` pour une ressource à empaqueter.
const lire = (relatif: string): string => readFileSync(fileURLToPath(new URL(relatif, import.meta.url)), "utf8");
const css = lire("./spaces.css");

// La feuille de style n'est pas rendue par les tests unitaires : la règle est vérifiée sur son texte, les captures de « Paramètres » la confirment.
describe("case « Obligatoire » des paramètres", () => {
  it("tient sa mise en ligne par deux classes, que `.sb-field` du catalogue n'emporte pas selon l'ordre des feuilles", () => {
    expect(css).toMatch(/\.sb-field\.sb-params__check \{\n {2}flex-direction: row;\n {2}align-items: center;\n {2}gap: var\(--sb-space-3\);\n {2}color: var\(--sb-ink\);\n\}/);
    expect(css).toMatch(/\.sb-field\.sb-params__check input \{\n {2}min-height: auto;/);
    expect(css).not.toMatch(/^\.sb-params__check/m);
  });
});
