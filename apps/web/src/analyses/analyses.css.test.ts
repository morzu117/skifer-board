import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const lire = (relatif: string): string => readFileSync(fileURLToPath(new URL(relatif, import.meta.url)), "utf8");
const analysesCss = lire("./analyses.css");
const explorerCss = lire("../explorer/explorer.css");

// Garde-fous des défauts d'écran relevés par les captures 18.5c (Axe et lecture des images) : la feuille de style n'est pas
// rendue par les tests unitaires, la règle est donc vérifiée sur son texte, et les captures navigateur la confirment.
describe("styles des analyses", () => {
  it("laisse aux boutons-liens leur couleur de bouton", () => {
    expect(analysesCss).toContain(".sb-analyses a:not(.sb-button) { color: inherit; text-decoration: underline; }");
    expect(analysesCss).not.toMatch(/^\.sb-analyses a \{/m);
  });

  it("donne aux liens du panneau de l'Explorateur la couleur de la carte", () => {
    expect(analysesCss).toContain(".sb-analyses__panneau a:not(.sb-button) { color: inherit; text-decoration: underline; }");
  });

  it("écrit les règles du thème ardoise sur le même élément que .sb-analyses, limitées aux cartes et panneaux", () => {
    expect(analysesCss).toContain(".sb-analyses.sb-theme-skifer-ardoise .sb-card .sb-members__state");
    expect(analysesCss).toContain(".sb-analyses.sb-theme-skifer-ardoise .sb-analyses__panel .sb-members__state");
    expect(analysesCss).toContain(".sb-analyses.sb-theme-skifer-ardoise .sb-field { color: var(--sb-on-slate); }");
    expect(analysesCss).not.toContain(".sb-theme-skifer-ardoise .sb-analyses ");
    expect(analysesCss).not.toContain(".sb-page-head__lead");
  });

  it("fait défiler les sept onglets de la fiche au lieu de les comprimer", () => {
    expect(analysesCss).toMatch(/\.sb-tabs\.sb-analyses__tabs \{ display: flex; max-width: 100%; overflow-x: auto; \}/);
    expect(analysesCss).not.toMatch(/^\.sb-analyses__tabs \{/m);
    expect(analysesCss).toContain('.sb-analyses__tabs [role="tab"] { flex: none; white-space: nowrap; }');
  });

  it("ne laisse pas l'ordre des feuilles décider de la largeur du tableau ni de l'affichage des onglets", () => {
    expect(analysesCss).toContain(".sb-table.sb-analyses__table { min-width: 720px; }");
    expect(analysesCss).not.toMatch(/^\.sb-analyses__table \{/m);
  });

  it("ne coupe plus les mots des tableaux en pleine lettre, sauf les adresses d'émetteur", () => {
    expect(analysesCss).toContain(".sb-analyses__table th, .sb-analyses__table td { overflow-wrap: normal; }");
    expect(analysesCss).toContain(".sb-analyses__table .sb-analyses__sub.sb-mono { overflow-wrap: anywhere; }");
  });

  it("écrit la description du panneau dans la police de la page, comme le nom", () => {
    expect(analysesCss).toContain(".sb-analyses__panneau .sb-field textarea { font-family: inherit; font-size: var(--sb-text-table); line-height: inherit; }");
    expect(analysesCss).not.toContain("font: inherit");
  });

  it("éclaircit l'état des consommateurs sur les cartes ardoise de l'Explorateur", () => {
    expect(explorerCss).toContain(".sb-theme-skifer-ardoise.sb-explorer .sb-card .sb-members__state { color: var(--sb-on-slate-muted); }");
  });
});
