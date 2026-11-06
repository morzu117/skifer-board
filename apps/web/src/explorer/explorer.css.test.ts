import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Le chemin passe par une variable : Vite prendrait `new URL("littéral", import.meta.url)` pour une ressource à empaqueter.
const lire = (relatif: string): string => readFileSync(fileURLToPath(new URL(relatif, import.meta.url)), "utf8");
const css = lire("./explorer.css");

// La feuille de style n'est pas rendue par les tests unitaires : la grille est vérifiée sur son texte, et les captures navigateur la confirment.
describe("grille de l'Explorateur", () => {
  it("fait couvrir à Champs les trois lignes de droite, Requête, Analyse et Résultat", () => {
    expect(css).toContain(".sb-explorer form > section:first-child { grid-column: 1; grid-row: 1 / span 3; }");
    expect(css).not.toContain("grid-row: 1 / span 2");
  });

  it("donne la hauteur en trop à la dernière ligne, jamais à l'écart entre les cartes", () => {
    expect(css).toContain("grid-template-rows: auto auto minmax(0, 1fr);");
    expect(css).toContain("gap: var(--sb-space-6);");
  });

  it("place Requête, Analyse et Résultat dans la colonne de droite", () => {
    expect(css).toContain(".sb-explorer form > section:nth-child(2),");
    expect(css).toContain(".sb-explorer form > [aria-live] { grid-column: 2; }");
    expect(css).toContain(".sb-explorer form > section.sb-explorer__analyse { grid-column: 2; }");
  });
});
