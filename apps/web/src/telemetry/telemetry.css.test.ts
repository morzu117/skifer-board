import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Le chemin passe par une variable : Vite prendrait `new URL("littéral", import.meta.url)` pour une ressource à empaqueter.
const css = readFileSync(fileURLToPath(((relatif: string) => new URL(relatif, import.meta.url))("./telemetry.css")), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Spécificité (classes, attributs et pseudo-classes ; éléments) d'un sélecteur sans identifiant ni `:not`. */
const specificite = (selecteur: string): [number, number] => [
  (selecteur.match(/\.[\w-]+|\[[^\]]+\]|(?<!:):[\w-]+/g) ?? []).length,
  selecteur.replace(/\.[\w-]+|\[[^\]]+\]|:{1,2}[\w-]+/g, " ").split(/[\s>+~]+/).filter((nom) => /^[a-z][a-z0-9]*$/.test(nom)).length,
];
const plus = (a: [number, number], b: [number, number]) => (a[0] === b[0] ? a[1] > b[1] : a[0] > b[0]);
/** Les déclarations d'une propriété : (sélecteur, valeur) dans l'ordre du fichier. */
function declarations(propriete: string): { selecteur: string; valeur: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selecteurs, corps]) => {
    const valeur = new RegExp(`(?:^|;)\\s*${propriete}\\s*:\\s*([^;]+)`).exec(corps ?? "")?.[1]?.trim();
    return valeur === undefined ? [] : (selecteurs ?? "").split(",").map((selecteur) => ({ selecteur: selecteur.trim(), valeur }));
  });
}

// La feuille n'est pas rendue par les tests unitaires : les priorités sont lues sur les sélecteurs, la capture de la télémétrie les confirme.
describe("priorités des cellules de la télémétrie", () => {
  it("laisse l'en-tête alignée en bas : sa règle l'emporte sur celle des cellules, qui s'écrit avec `.sb-table`", () => {
    const [cellules, entete] = [declarations("vertical-align").find((regle) => regle.valeur === "top"), declarations("vertical-align").find((regle) => regle.valeur === "bottom")];
    expect(cellules?.selecteur).toBe(".sb-table.sb-telemetry th");
    expect(entete?.selecteur).toBe(".sb-table.sb-telemetry thead th");
    expect(specificite(".sb-table.sb-telemetry th")).toEqual([2, 1]);
    expect(specificite(".sb-table.sb-telemetry thead th")).toEqual([2, 2]);
    expect(plus(specificite(entete?.selecteur ?? ""), specificite(cellules?.selecteur ?? ""))).toBe(true);
    // Et la règle des cellules reste plus spécifique que `.sb-table th` (charts.css), dont elle reprend le `padding` horizontal.
    expect(plus(specificite(cellules?.selecteur ?? ""), specificite(".sb-table th"))).toBe(true);
  });

  it("ne laisse plus aucune règle d'en-tête sans `.sb-table`, que la règle des cellules emporterait", () => {
    expect(css).not.toMatch(/^\.sb-telemetry thead th \{/m);
    for (const { selecteur } of declarations("vertical-align")) expect(selecteur.startsWith(".sb-table.sb-telemetry ")).toBe(true);
  });
});
