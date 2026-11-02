import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import accords from "../../../../contracts/espaces/accords.json";
import espace from "../../../../contracts/espaces/espace.json";
import journalParametres from "../../../../contracts/espaces/journal-parametres.json";
import membres from "../../../../contracts/espaces/membres.json";
import parametres from "../../../../contracts/espaces/parametres.json";
import { Journal } from "./AdminParts";
import type { Fetch } from "./api";
import { EnvironmentsPage } from "./EnvironmentsPage";
import { MembersPage } from "./MembersPage";
import { decodeEvents, decodeSpace } from "./model";
import { ParametersPage } from "./ParametersPage";

// Journal de l'espace : phrases des déclarations et des valeurs de paramètres (plan 10, 10.4, P7).
// L'exemple réel est produit par le serveur (contracts/espaces/journal-parametres.json) ; les cas
// construits gardent sa forme. Tout détail hors contrat reste brut : « action non reconnue : … ».

const FINANCE = decodeSpace(espace.body, "espace");
const AUTEUR = { issuer: "https://id.example.invalid", subject: "sujet-auteur" };
const evenement = (action: string, detail: unknown, id = 1) => ({ id, at: "2026-11-02T10:00:00+00:00", actor: AUTEUR, actor_person: null, action, detail, principal_person: null });

/** Phrases du journal, sans l'horodatage. */
const phrases = () => within(screen.getByRole("list", { name: "Journal de l'espace" })).getAllByRole("listitem").map((item) => item.textContent.replace(/^.*UTC/, ""));
/** Phrase d'un seul événement construit, sans l'auteur. */
function phrase(action: string, detail: unknown): string {
  const { unmount } = render(<Journal events={{ status: "ok", value: decodeEvents({ events: [evenement(action, detail)] }) }} />);
  const [texte] = phrases();
  unmount();
  return (texte ?? "").replace(/^sujet-auteur /, "");
}
const brut = (action: string, detail: unknown) => `action non reconnue : ${action} ${JSON.stringify(detail)}`;

const ATTENDU_REEL = [
  "Alix a retiré le paramètre lignes_max et ses valeurs (TEST : 20000).",
  "Alix a vidé la valeur de catalogue en DEV (était finance_dev).",
  "Alix a modifié la déclaration de region : défaut aucun → eu-west.",
  "Alix a posé la valeur de lignes_max en TEST : 20000.",
  "Alix a posé la valeur de catalogue en DEV : finance_dev.",
  "Alix a déclaré le paramètre region : Choix · eu-west, eu-central, obligatoire, sans défaut.",
  "Alix a déclaré le paramètre lignes_max : Entier · de 1 à 100000, facultatif, défaut 5000.",
  "Alix a déclaré le paramètre catalogue : Identifiant, obligatoire, sans défaut.",
  "Camille Martin a accordé le droit de déployer en TEST au groupe finance-admins.",
  "Camille Martin a accordé le droit de déployer en DEV au groupe finance-admins.",
  "Alix a retiré Dominique Leroy (Lecteur).",
  "Camille Martin a ajouté le groupe finance-createurs : Créateur.",
  "Alix a retiré le droit de déployer en PROD au groupe finance-admins.",
  "Alix a accordé le droit de déployer en PROD au groupe finance-admins.",
  "Camille Martin a accordé le droit de déployer en DEV au groupe finance-createurs.",
  "Camille Martin a accordé le droit de déployer en TEST à Dominique Leroy.",
  "Camille Martin a ajouté Dominique Leroy : Lecteur.",
  "Camille Martin a ajouté le groupe finance-admins : Administrateur.",
  "Camille Martin a créé l'espace « Finance ».",
];

const declaration = (extra: object = {}) => ({ type: "integer", constraints: { minimum: 1, maximum: 100 }, required: true, default: null, description: "", ...extra });

describe("Journal : l'exemple réel du serveur, phrase par phrase", () => {
  it("raconte chaque événement de paramètre, et les autres comme avant ; aucune ligne brute", () => {
    render(<Journal events={{ status: "ok", value: decodeEvents(journalParametres.body) }} />);
    expect(phrases()).toEqual(ATTENDU_REEL);
    for (const texte of phrases()) expect(texte).not.toContain("action non reconnue");
  });
});

describe("Journal : déclaration d'un paramètre (`parameter_declared`)", () => {
  it.each([
    ["texte d'un caractère", { type: "text", constraints: { max_length: 1 }, required: false, default: "x", description: "" }, "Texte · 1 caractère au plus, facultatif, défaut x"],
    ["texte", { type: "text", constraints: { max_length: 64 }, required: true, default: null, description: "d" }, "Texte · 64 caractères au plus, obligatoire, sans défaut"],
    ["entier borné", declaration({ default: 5 }), "Entier · de 1 à 100, obligatoire, défaut 5"],
    ["entier minimum seul", declaration({ constraints: { minimum: -3, maximum: null } }), "Entier · -3 au moins, obligatoire, sans défaut"],
    ["entier maximum seul", declaration({ constraints: { minimum: null, maximum: 9 } }), "Entier · 9 au plus, obligatoire, sans défaut"],
    ["entier sans borne, défaut 0", declaration({ constraints: { minimum: null, maximum: null }, default: 0, required: false }), "Entier, facultatif, défaut 0"],
    ["booléen défaut vrai", { type: "boolean", constraints: {}, required: false, default: true, description: "" }, "Booléen, facultatif, défaut vrai"],
    ["booléen défaut faux", { type: "boolean", constraints: {}, required: true, default: false, description: "" }, "Booléen, obligatoire, défaut faux"],
    ["choix", { type: "choice", constraints: { choices: ["a"] }, required: true, default: "a", description: "" }, "Choix · a, obligatoire, défaut a"],
    ["identifiant", { type: "identifier", constraints: {}, required: false, default: null, description: "" }, "Identifiant, facultatif, sans défaut"],
  ])("%s", (_cas, decl, attendu) => {
    expect(phrase("parameter_declared", { name: "p", declaration: decl })).toBe(`a déclaré le paramètre p : ${attendu}.`);
  });

  it("l'ordre des clés du JSONB ne change rien", () => {
    expect(phrase("parameter_declared", { declaration: { description: "", default: 5, required: true, constraints: { maximum: 9, minimum: 1 }, type: "integer" }, name: "p" })).toBe("a déclaré le paramètre p : Entier · de 1 à 9, obligatoire, défaut 5.");
  });

  it("un champ en plus dans le détail ne change pas le sens", () => {
    expect(phrase("parameter_declared", { name: "p", declaration: declaration(), values: {} })).toBe("a déclaré le paramètre p : Entier · de 1 à 100, obligatoire, sans défaut.");
  });
});

describe("Journal : modification d'une déclaration (`parameter_changed`)", () => {
  const changement = (avant: object, apres: object) => phrase("parameter_changed", { name: "p", before: declaration(avant), after: declaration(apres) });

  it.each([
    ["défaut posé", {}, { default: 5 }, "défaut aucun → 5"],
    ["défaut retiré", { default: 5 }, {}, "défaut 5 → aucun"],
    ["défaut changé", { default: 5 }, { default: 6 }, "défaut 5 → 6"],
    ["obligatoire → facultatif", {}, { required: false }, "obligatoire → facultatif"],
    ["facultatif → obligatoire", { required: false }, {}, "facultatif → obligatoire"],
    ["contraintes", {}, { constraints: { minimum: 1, maximum: 1000 } }, "Entier · de 1 à 100 → Entier · de 1 à 1000"],
    ["borne retirée", {}, { constraints: { minimum: null, maximum: 100 } }, "Entier · de 1 à 100 → Entier · 100 au plus"],
    ["description", {}, { description: "nouvelle" }, "description modifiée"],
    ["rien", {}, {}, "sans changement"],
  ])("%s", (_cas, avant, apres, attendu) => {
    expect(changement(avant, apres)).toBe(`a modifié la déclaration de p : ${attendu}.`);
  });

  it("tous les changements, joints par « ; », dans l'ordre contraintes, obligatoire, défaut, description", () => {
    expect(changement({ default: 5, description: "a" }, { constraints: { minimum: 0, maximum: 10 }, required: false, default: null, description: "b" })).toBe(
      "a modifié la déclaration de p : Entier · de 1 à 100 → Entier · de 0 à 10 ; obligatoire → facultatif ; défaut 5 → aucun ; description modifiée.",
    );
  });

  it("un changement de type se dit par les contraintes, avant et après", () => {
    const avant = { type: "text", constraints: { max_length: 8 }, required: true, default: "abc", description: "" };
    const apres = { type: "identifier", constraints: {}, required: true, default: "abc", description: "" };
    expect(phrase("parameter_changed", { name: "p", before: avant, after: apres })).toBe("a modifié la déclaration de p : Texte · 8 caractères au plus → Identifiant.");
    const booleen = { type: "boolean", constraints: {}, required: true, default: null, description: "" };
    expect(phrase("parameter_changed", { name: "p", before: { ...apres, default: null }, after: booleen })).toBe("a modifié la déclaration de p : Identifiant → Booléen.");
  });

  it("un défaut booléen s'écrit vrai ou faux", () => {
    const booleen = (valeur: boolean | null) => ({ type: "boolean", constraints: {}, required: false, default: valeur, description: "" });
    expect(phrase("parameter_changed", { name: "p", before: booleen(false), after: booleen(true) })).toBe("a modifié la déclaration de p : défaut faux → vrai.");
    expect(phrase("parameter_changed", { name: "p", before: booleen(null), after: booleen(false) })).toBe("a modifié la déclaration de p : défaut aucun → faux.");
  });

  it("des choix réordonnés sont un changement ; des clés du JSONB réordonnées n'en sont pas un", () => {
    const choix = (valeurs: string[]) => ({ type: "choice", constraints: { choices: valeurs }, required: true, default: null, description: "" });
    expect(phrase("parameter_changed", { name: "p", before: choix(["a", "b"]), after: choix(["b", "a"]) })).toBe("a modifié la déclaration de p : Choix · a, b → Choix · b, a.");
    expect(phrase("parameter_changed", { name: "p", before: declaration({ constraints: { maximum: 100, minimum: 1 } }), after: declaration({ constraints: { minimum: 1, maximum: 100 } }) })).toBe(
      "a modifié la déclaration de p : sans changement.",
    );
  });
});

describe("Journal : retrait d'un paramètre (`parameter_removed`)", () => {
  it("remet les valeurs dans l'ordre DEV, TEST, PROD, quel que soit l'ordre du JSONB", () => {
    expect(phrase("parameter_removed", { name: "p", values: { PROD: 3, DEV: 1, TEST: 2 } })).toBe("a retiré le paramètre p et ses valeurs (DEV : 1, TEST : 2, PROD : 3).");
    expect(phrase("parameter_removed", { name: "p", values: { PROD: "z", DEV: "a" } })).toBe("a retiré le paramètre p et ses valeurs (DEV : a, PROD : z).");
  });

  it("les booléens s'écrivent vrai ou faux", () => {
    expect(phrase("parameter_removed", { name: "p", values: { TEST: true, DEV: false } })).toBe("a retiré le paramètre p et ses valeurs (DEV : faux, TEST : vrai).");
  });

  it("sans valeur posée, la phrase le dit", () => {
    expect(phrase("parameter_removed", { name: "x", values: {}, declaration: declaration() })).toBe("a retiré le paramètre x, sans valeur posée.");
  });
});

describe("Journal : valeurs (`value_set`, `value_cleared`)", () => {
  it.each([
    [{ name: "n", environment: "TEST", before: null, after: 20000 }, "a posé la valeur de n en TEST : 20000."],
    [{ name: "n", environment: "PROD", before: 1, after: 2 }, "a posé la valeur de n en PROD : 1 → 2."],
    [{ name: "n", environment: "DEV", before: "a", after: "b" }, "a posé la valeur de n en DEV : a → b."],
    [{ name: "n", environment: "DEV", before: false, after: true }, "a posé la valeur de n en DEV : faux → vrai."],
    [{ name: "n", environment: "DEV", before: null, after: false }, "a posé la valeur de n en DEV : faux."],
    [{ name: "n", environment: "DEV", before: 0, after: -5 }, "a posé la valeur de n en DEV : 0 → -5."],
  ])("value_set %j", (detail, attendu) => {
    expect(phrase("value_set", detail)).toBe(attendu);
  });

  it.each([
    [{ name: "catalogue", environment: "DEV", before: "finance_dev" }, "a vidé la valeur de catalogue en DEV (était finance_dev)."],
    [{ name: "b", environment: "PROD", before: true }, "a vidé la valeur de b en PROD (était vrai)."],
    [{ name: "b", environment: "TEST", before: false }, "a vidé la valeur de b en TEST (était faux)."],
    [{ name: "e", environment: "TEST", before: 0 }, "a vidé la valeur de e en TEST (était 0)."],
  ])("value_cleared %j", (detail, attendu) => {
    expect(phrase("value_cleared", detail)).toBe(attendu);
  });
});

describe("Journal : un détail hors contrat reste brut, sans être interprété", () => {
  const valide = { type: "integer", constraints: { minimum: null, maximum: null }, required: true, default: null, description: "" };
  it.each([
    // Nom non textuel ou absent.
    ["parameter_declared", { name: 5, declaration: valide }],
    ["parameter_declared", { declaration: valide }],
    ["parameter_changed", { name: null, before: valide, after: valide }],
    ["parameter_removed", { name: ["p"], values: {} }],
    ["value_set", { name: 1, environment: "DEV", before: null, after: 1 }],
    ["value_cleared", { environment: "DEV", before: 1 }],
    // Déclaration indécodable.
    ["parameter_declared", { name: "p" }],
    ["parameter_declared", { name: "p", declaration: null }],
    ["parameter_declared", { name: "p", declaration: "integer" }],
    ["parameter_declared", { name: "p", declaration: { ...valide, type: "regex" } }],
    ["parameter_declared", { name: "p", declaration: { ...valide, required: "oui" } }],
    ["parameter_declared", { name: "p", declaration: { ...valide, description: null } }],
    ["parameter_declared", { name: "p", declaration: { type: "integer", constraints: {}, required: true, default: null } }],
    ["parameter_declared", { name: "p", declaration: { ...valide, constraints: { minimum: 1 } } }],
    ["parameter_declared", { name: "p", declaration: { ...valide, constraints: { minimum: 1.5, maximum: null } } }],
    ["parameter_declared", { name: "p", declaration: { ...valide, default: "5" } }],
    ["parameter_declared", { name: "p", declaration: { ...valide, default: 1.5 } }],
    ["parameter_declared", { name: "p", declaration: { type: "text", constraints: {}, required: true, default: null, description: "" } }],
    ["parameter_declared", { name: "p", declaration: { type: "boolean", constraints: {}, required: true, default: "vrai", description: "" } }],
    ["parameter_declared", { name: "p", declaration: { type: "choice", constraints: { choices: "a" }, required: true, default: null, description: "" } }],
    ["parameter_declared", { name: "p", declaration: { type: "choice", constraints: { choices: [1] }, required: true, default: null, description: "" } }],
    ["parameter_declared", { name: "p", declaration: { type: "identifier", constraints: null, required: true, default: null, description: "" } }],
    ["parameter_changed", { name: "p", before: valide }],
    ["parameter_changed", { name: "p", after: valide }],
    ["parameter_changed", { name: "p", before: { ...valide, type: "x" }, after: valide }],
    ["parameter_changed", { name: "p", before: valide, after: { ...valide, default: true } }],
    // Valeurs retirées hors contrat.
    ["parameter_removed", { name: "p" }],
    ["parameter_removed", { name: "p", values: null }],
    ["parameter_removed", { name: "p", values: "DEV" }],
    ["parameter_removed", { name: "p", values: [1, 2] }],
    ["parameter_removed", { name: "p", values: [] }],
    ["parameter_removed", { name: "p", values: { QA: 1 } }],
    ["parameter_removed", { name: "p", values: { dev: 1 } }],
    ["parameter_removed", { name: "p", values: { DEV: 1, QA: 2 } }],
    ["parameter_removed", { name: "p", values: { DEV: null } }],
    ["parameter_removed", { name: "p", values: { DEV: { v: 1 } } }],
    ["parameter_removed", { name: "p", values: { DEV: [1] } }],
    ["parameter_removed", { name: "p", values: { DEV: 1.5 } }],
    ["parameter_removed", { name: "p", values: { DEV: 9007199254740992 } }],
    // Environnement inconnu ou absent.
    ["value_set", { name: "n", environment: "QA", before: null, after: 1 }],
    ["value_set", { name: "n", environment: "dev", before: null, after: 1 }],
    ["value_set", { name: "n", before: null, after: 1 }],
    ["value_cleared", { name: "n", environment: ["DEV"], before: 1 }],
    // `after` invalide.
    ["value_set", { name: "n", environment: "DEV", before: null }],
    ["value_set", { name: "n", environment: "DEV", before: null, after: null }],
    ["value_set", { name: "n", environment: "DEV", before: null, after: 1.5 }],
    ["value_set", { name: "n", environment: "DEV", before: null, after: { v: 1 } }],
    ["value_set", { name: "n", environment: "DEV", before: null, after: [1] }],
    // `before` invalide.
    ["value_set", { name: "n", environment: "DEV", after: 1 }],
    ["value_set", { name: "n", environment: "DEV", before: 0.5, after: 1 }],
    ["value_set", { name: "n", environment: "DEV", before: [], after: 1 }],
    ["value_cleared", { name: "n", environment: "DEV" }],
    ["value_cleared", { name: "n", environment: "DEV", before: null }],
    ["value_cleared", { name: "n", environment: "DEV", before: {} }],
    // Action inconnue à la forme d'un paramètre.
    ["parameter_renamed", { name: "p", environment: "DEV", before: 1, after: 2 }],
    ["value_reset", { name: "n", environment: "DEV", before: 1, after: 2 }],
  ])("%s %j", (action, detail) => {
    expect(phrase(action, detail)).toBe(brut(action, detail));
  });

  it.each([
    ["value_set", null],
    ["parameter_declared", "region"],
    ["value_cleared", [1]],
  ])("un détail qui n'est pas un objet : %s %j", (action, detail) => {
    expect(phrase(action, detail)).toBe(brut(action, detail));
  });

  it("un événement de paramètre hors contrat qui porte un principal reste brut : il n'est pas lu comme un accord", () => {
    const detail = { name: "n", environment: "DEV", after: 1.5, before: null, principal: { kind: "group", name: "g" } };
    expect(phrase("value_set", detail)).toBe(brut("value_set", detail));
  });

  it("un accord qui porte un nom et un environnement reste raconté comme un accord", () => {
    expect(phrase("deploy_granted", { name: "n", environment: "DEV", principal: { kind: "group", name: "g" } })).toBe("a accordé le droit de déployer en DEV au groupe g.");
  });
});

describe("Journal des paramètres sur les trois écrans d'administration", () => {
  const fetcher = () =>
    vi.fn<Fetch>().mockImplementation((url) => {
      const corps: Record<string, unknown> = {
        "/api/spaces/finance/events": journalParametres.body,
        "/api/spaces/finance/members": membres.body,
        "/api/spaces/finance/deploy-grants": accords.body,
        "/api/spaces/finance/parameters": parametres.body,
      };
      const trouve = corps[url];
      return trouve === undefined ? Promise.reject(new Error(`appel inattendu : ${url}`)) : Promise.resolve(Response.json(trouve));
    });

  it.each([
    ["Membres et rôles", () => <MembersPage space={FINANCE} fetcher={fetcher()} />],
    ["Environnements", () => <EnvironmentsPage space={FINANCE} fetcher={fetcher()} target="DEV" />],
    ["Paramètres", () => <ParametersPage space={FINANCE} fetcher={fetcher()} target="DEV" />],
  ])("« %s » raconte déclarations et valeurs avec les mêmes phrases", async (_ecran, page) => {
    render(page());
    await screen.findByRole("list", { name: "Journal de l'espace" });
    expect(phrases()).toEqual(ATTENDU_REEL);
  });
});
