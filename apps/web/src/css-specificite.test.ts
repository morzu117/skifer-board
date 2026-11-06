import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/*
 * Ce que ce détecteur garantit, et rien de plus : deux classes portées par un même élément (valeurs littérales de `className`), dont
 * chacune a une règle à une seule classe, éventuellement suivie d'un élément ou d'un attribut descendant simple (`.a`, `.a input`,
 * `.a [role="tab"]`), ne posent pas la même propriété depuis deux feuilles différentes. À spécificité égale, c'est la place des feuilles
 * dans le paquet qui décide, et le code ne la maîtrise pas. Une propriété est « la même » aussi quand l'une est le raccourci de
 * l'autre (`font` et `font-size`, `overflow` et `overflow-x`, …, voir FAMILLES). Dans une même feuille l'ordre est celui du fichier :
 * c'est le cas d'un modificateur (`--x`), permis.
 *
 * Il ne relie pas des classes portées par des éléments différents (un ancêtre et son descendant), sauf le cas ciblé de `.sb-field` et
 * d'un `textarea`, `input` ou `select` qu'un composant restyle (`collisionsSousChamp`) ; il ignore les sélecteurs composés
 * (`.a.b`, `.a:not(.b)`), les combinateurs autres que le descendant, les variables et les requêtes média. Ce n'est pas un analyseur de cascade.
 */

// Le chemin passe par une variable : Vite prendrait `new URL("littéral", import.meta.url)` pour une ressource à empaqueter.
const racine = ((relatif: string) => fileURLToPath(new URL(relatif, import.meta.url)))("./");

interface Source { nom: string; texte: string }
interface Regle { feuille: string; classe: string; suffixe: string; proprietes: string[] }

/** Raccourcis et leurs détails : poser l'un ou l'autre est poser la même propriété. */
const FAMILLES: { court: string; detail: RegExp }[] = [
  { court: "font", detail: /^font-/ },
  { court: "overflow", detail: /^overflow-[xy]$/ },
  { court: "margin", detail: /^margin-/ },
  { court: "padding", detail: /^padding-/ },
  { court: "gap", detail: /^(?:row|column)-gap$/ },
  { court: "flex", detail: /^flex-(?:grow|shrink|basis)$/ },
  { court: "grid-template", detail: /^grid-template-/ },
];
const couvre = (court: string, detail: string) => FAMILLES.some((famille) => famille.court === court && famille.detail.test(detail));

/** Les douze propriétés de bordure (côté et aspect) que pose chaque propriété `border…` ; `border-radius`, `border-collapse`… n'en posent aucune. */
const COTES = ["top", "right", "bottom", "left"];
const ASPECTS = ["width", "style", "color"];
function bordures(propriete: string): string[] {
  const croisement = (cotes: string[], aspects: string[]) => cotes.flatMap((cote) => aspects.map((aspect) => `${cote}-${aspect}`));
  if (propriete === "border") return croisement(COTES, ASPECTS);
  const [, cote] = /^border-(top|right|bottom|left)$/.exec(propriete) ?? [];
  if (cote !== undefined) return croisement([cote], ASPECTS);
  const [, aspect] = /^border-(width|style|color)$/.exec(propriete) ?? [];
  if (aspect !== undefined) return croisement(COTES, [aspect]);
  const [, unique] = /^border-((?:top|right|bottom|left)-(?:width|style|color))$/.exec(propriete) ?? [];
  return unique === undefined ? [] : [unique];
}
const lies = (a: string, b: string) => a === b || couvre(a, b) || couvre(b, a) || bordures(a).some((nom) => bordures(b).includes(nom));

const lister = (dossier: string, extension: string): Source[] => readdirSync(dossier, { withFileTypes: true }).flatMap((entree) => {
  const chemin = join(dossier, entree.name);
  if (entree.isDirectory()) return lister(chemin, extension);
  return chemin.endsWith(extension) && !chemin.includes(".test.") ? [{ nom: chemin, texte: readFileSync(chemin, "utf8") }] : [];
});

function regles(feuilles: Source[]): Regle[] {
  const trouvees: Regle[] = [];
  for (const feuille of feuilles) {
    const texte = feuille.texte.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [, selecteurs, corps] of texte.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const proprietes = (corps ?? "").split(";").map((declaration) => declaration.split(":")[0]?.trim() ?? "").filter((nom) => nom !== "");
      for (const selecteur of (selecteurs ?? "").split(",").map((item) => item.trim())) {
        const trouve = /^\.([A-Za-z0-9_-]+)(?:\s+([a-z][a-z0-9]*|\[[^\]]+\]))?$/.exec(selecteur);
        if (trouve?.[1] !== undefined) trouvees.push({ feuille: feuille.nom, classe: trouve[1], suffixe: trouve[2] ?? "", proprietes });
      }
    }
  }
  return trouvees;
}

/** Les classes portées par un même élément, à partir des `className` littéraux (les `${…}` d'un modèle sont ignorés). */
function groupes(composants: Source[]): Set<string>[] {
  const trouves: Set<string>[] = [];
  for (const composant of composants) {
    for (const [, guillemets, modele, accolades] of composant.texte.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g)) {
      const classes = (guillemets ?? modele ?? accolades ?? "").replace(/\$\{[^}]*\}/g, " ").split(/\s+/).filter((nom) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(nom));
      if (classes.length > 1) trouves.push(new Set(classes));
    }
  }
  return trouves;
}

const communes = (a: Regle, b: Regle) => a.proprietes.filter((nom) => b.proprietes.some((autre) => lies(nom, autre)));
const decrire = (a: Regle, b: Regle, proprietes: string[]) => `.${a.classe}${a.suffixe === "" ? "" : ` ${a.suffixe}`} (${a.feuille}) et .${b.classe}${b.suffixe === "" ? "" : ` ${b.suffixe}`} (${b.feuille}) : ${[...new Set(proprietes)].sort().join(", ")}`;

/** Deux classes d'un même élément, même suffixe, une propriété commune, deux feuilles différentes. */
export function collisions(feuilles: Source[], composants: Source[]): string[] {
  const toutes = regles(feuilles);
  const trouvees = new Set<string>();
  for (const groupe of groupes(composants)) {
    for (const a of toutes) {
      if (!groupe.has(a.classe)) continue;
      for (const b of toutes) {
        if (b.classe === a.classe || !groupe.has(b.classe) || a.suffixe !== b.suffixe || a.feuille === b.feuille || a.classe > b.classe) continue;
        const partagees = communes(a, b);
        if (partagees.length > 0) trouvees.add(decrire(a, b, partagees));
      }
    }
  }
  return [...trouvees].sort();
}

/**
 * Le cas d'un élément de champ qu'un composant restyle : `.sb-field <élément>` (catalogue) et `.<ancêtre> <élément>` (autre feuille) ont la
 * même spécificité et visent le même élément. Le composant l'écrit avec le champ, `.<ancêtre> .sb-field <élément>`, plus spécifique.
 */
export function collisionsSousChamp(feuilles: Source[], elements: string[]): string[] {
  const toutes = regles(feuilles);
  const trouvees = new Set<string>();
  for (const champ of toutes.filter((regle) => regle.classe === "sb-field" && elements.includes(regle.suffixe))) {
    for (const composant of toutes) {
      if (composant.classe === "sb-field" || composant.suffixe !== champ.suffixe || composant.feuille === champ.feuille) continue;
      const partagees = communes(champ, composant);
      if (partagees.length > 0) trouvees.add(decrire(composant, champ, partagees));
    }
  }
  return [...trouvees].sort();
}

const feuille = (nom: string, texte: string): Source => ({ nom, texte });
const composant = (classes: string): Source => ({ nom: "Composant.tsx", texte: `export const C = () => <p className="${classes}">x</p>;` });

describe("détecteur de collisions entre classes d'un même élément", () => {
  it("voit deux classes d'un même élément qui posent la même propriété dans deux feuilles", () => {
    const trouvees = collisions([feuille("a.css", ".a { color: red; gap: 1px; }"), feuille("b.css", ".b { color: blue; }")], [composant("a b")]);
    expect(trouvees).toEqual([".a (a.css) et .b (b.css) : color"]);
  });

  it.each([
    ["font", "font-size", "font: inherit", "font-size: 13px"],
    ["overflow", "overflow-x", "overflow: hidden", "overflow-x: auto"],
    ["margin", "margin-top", "margin: 0", "margin-top: 4px"],
    ["padding", "padding-left", "padding: 0", "padding-left: 4px"],
    ["border", "border-top-width", "border: 0", "border-top-width: 2px"],
    ["border", "border-color", "border: 0", "border-color: red"],
    ["border-top", "border-top-width", "border-top: 0", "border-top-width: 2px"],
    ["border-left", "border-left-color", "border-left: 0", "border-left-color: red"],
    ["border-width", "border-top-width", "border-width: 1px", "border-top-width: 2px"],
    ["border-style", "border-right-style", "border-style: solid", "border-right-style: none"],
    ["border-top", "border-width", "border-top: 0", "border-width: 2px"],
    ["gap", "row-gap", "gap: 4px", "row-gap: 8px"],
    ["flex", "flex-basis", "flex: none", "flex-basis: 10px"],
    ["grid-template", "grid-template-columns", "grid-template: none", "grid-template-columns: 1fr"],
  ])("voit un raccourci (%s) contre son détail (%s)", (_court, _detail, court, detail) => {
    for (const [premier, second] of [[court, detail], [detail, court]] as const) {
      expect(collisions([feuille("a.css", `.a { ${premier}; }`), feuille("b.css", `.b { ${second}; }`)], [composant("a b")])).toHaveLength(1);
    }
  });

  it("ne confond pas deux propriétés voisines mais distinctes", () => {
    for (const [a, b] of [["border: 0", "border-radius: 4px"], ["flex: none", "flex-direction: row"], ["font-size: 1px", "font-weight: 600"], ["overflow-x: auto", "overflow-y: hidden"], ["margin-top: 1px", "padding-top: 1px"], ["border-top: 0", "border-bottom-width: 1px"], ["border-color: red", "border-top-style: none"], ["border-width: 1px", "border-left-color: red"], ["border-top: 0", "border-radius: 4px"]]) {
      expect(collisions([feuille("a.css", `.a { ${a}; }`), feuille("b.css", `.b { ${b}; }`)], [composant("a b")]), `${a} / ${b}`).toEqual([]);
    }
  });

  it("voit la collision de deux règles qui visent le même élément descendant", () => {
    expect(collisions([feuille("a.css", ".a input { min-height: 1px; }"), feuille("b.css", ".b input { min-height: 2px; }")], [composant("a b")])).toHaveLength(1);
    expect(collisions([feuille("a.css", '.a [role="tab"] { color: red; }'), feuille("b.css", '.b [role="tab"] { color: blue; }')], [composant("a b")])).toHaveLength(1);
  });

  it("ne voit rien quand la spécificité diffère, quand les éléments visés diffèrent ou que la classe est seule", () => {
    // Sélecteur composé : plus spécifique, l'ordre ne décide plus.
    expect(collisions([feuille("a.css", ".a { color: red; }"), feuille("b.css", ".a.b { color: blue; }")], [composant("a b")])).toEqual([]);
    // Un élément descendant n'est pas l'élément lui-même.
    expect(collisions([feuille("a.css", ".a input { color: red; }"), feuille("b.css", ".b textarea { color: blue; }")], [composant("a b")])).toEqual([]);
    expect(collisions([feuille("a.css", ".a { color: red; }"), feuille("b.css", ".b input { color: blue; }")], [composant("a b")])).toEqual([]);
    // Classes qui ne sont pas sur un même élément.
    expect(collisions([feuille("a.css", ".a { color: red; }"), feuille("b.css", ".b { color: blue; }")], [composant("a"), composant("b")])).toEqual([]);
    // Propriétés différentes.
    expect(collisions([feuille("a.css", ".a { color: red; }"), feuille("b.css", ".b { background: blue; }")], [composant("a b")])).toEqual([]);
  });

  it("permet à un modificateur de redéfinir sa base dans la même feuille", () => {
    expect(collisions([feuille("a.css", ".kpi { background: white; }\n.kpi--denied { background: red; }")], [composant("kpi kpi--denied")])).toEqual([]);
  });

  it("lit les className en modèle ou entre accolades et ignore les parties dynamiques", () => {
    const feuilles = [feuille("a.css", ".a { color: red; }"), feuille("b.css", ".b { color: blue; }")];
    for (const texte of ['<p className={`a ${x} b`} />', '<p className={"a b"} />']) expect(collisions(feuilles, [{ nom: "C.tsx", texte }])).toHaveLength(1);
    expect(collisions(feuilles, [{ nom: "C.tsx", texte: "<p className={`a ${x}`} />" }])).toEqual([]);
  });
});

describe("détecteur du champ qu'un composant restyle", () => {
  const catalogue = feuille("catalogue.css", ".sb-field textarea { font-size: 13px; padding: 0; }\n.sb-field input { min-height: 44px; }\n.sb-field select { min-height: 44px; }");
  it("voit un `textarea`, un `input` ou un `select` restylé par un ancêtre sans plus de spécificité", () => {
    for (const [element, regle] of [["textarea", "font: inherit"], ["input", "min-height: auto"], ["select", "min-height: auto"]]) {
      const trouvees = collisionsSousChamp([catalogue, feuille("panneau.css", `.panneau ${element} { ${regle}; }`)], ["textarea", "input", "select"]);
      expect(trouvees, element).toHaveLength(1);
    }
  });
  it("ne voit rien quand le composant écrit le champ dans son sélecteur, ou reste dans la même feuille", () => {
    expect(collisionsSousChamp([catalogue, feuille("panneau.css", ".panneau .sb-field textarea { font-family: inherit; }")], ["textarea"])).toEqual([]);
    expect(collisionsSousChamp([feuille("catalogue.css", ".sb-field textarea { font-size: 13px; }\n.panneau textarea { font: inherit; }")], ["textarea"])).toEqual([]);
    expect(collisionsSousChamp([catalogue, feuille("panneau.css", ".panneau textarea { color: red; }")], ["textarea"])).toEqual([]);
  });
});

describe("feuilles et composants du dépôt", () => {
  const feuilles = lister(racine, ".css");
  it("laissent à l'ordre du paquet le choix d'aucune propriété entre deux classes d'un même élément", () => {
    expect(collisions(feuilles, lister(racine, ".tsx"))).toEqual([]);
  });
  it("ne restylent aucun textarea, input ou select de `.sb-field` sans plus de spécificité que lui", () => {
    expect(collisionsSousChamp(feuilles, ["textarea", "input", "select"])).toEqual([]);
  });
  it("écrit les cellules de la télémétrie avec `.sb-table`, dont `.sb-table th` et `.sb-table td` posent aussi `padding`", () => {
    const texte = feuilles.find((source) => source.nom.endsWith("telemetry.css"))?.texte ?? "";
    expect(texte).toContain(".sb-table.sb-telemetry th,\n.sb-table.sb-telemetry td {");
    expect(texte).not.toMatch(/^\.sb-telemetry t[hd],/m);
  });
  it("écrit la description du panneau d'analyse avec le champ, famille et taille alignées sur les autres champs", () => {
    const texte = feuilles.find((source) => source.nom.endsWith("analyses.css"))?.texte ?? "";
    expect(texte).toContain(".sb-analyses__panneau .sb-field textarea { font-family: inherit; font-size: var(--sb-text-table); line-height: inherit; }");
    expect(texte).not.toMatch(/^\.sb-analyses__panneau textarea/m);
    expect(texte).not.toMatch(/font: inherit/);
  });
});
