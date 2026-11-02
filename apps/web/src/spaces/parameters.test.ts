import { describe, expect, it } from "vitest";

import parametre from "../../../../contracts/espaces/parametre.json";
import parametreModifie from "../../../../contracts/espaces/parametre-modifie.json";
import parametres from "../../../../contracts/espaces/parametres.json";
import valeur from "../../../../contracts/espaces/valeur.json";
import { ContractError } from "../catalogue/decode";
import {
  constraintsLabel,
  decodeConfiguration,
  decodeDeclaration,
  decodeParameter,
  decodeStoredValue,
  integerOrText,
  missingLabel,
  PARAMETER_TYPES,
  STATE_LABELS,
  STATES,
  TYPE_LABELS,
  valueLabel,
  type Constraints,
} from "./parameters";

// Modèle et décodage strict des paramètres de déploiement (plan 10, 10.3). Les états et la
// complétude viennent du serveur (P4) : le navigateur ne les recalcule pas, il refuse une réponse
// incohérente plutôt que d'en afficher une partie.

type Brut = Record<string, unknown>;
const ALIX_REF = { issuer: "https://id.example.invalid", subject: "00u9admin" };
const ALIX = { name: "Alix", email: "alix@ex.invalid" };
/** Réponse réelle de `GET /parameters`, à modifier par cas. */
const reponse = () => structuredClone(parametres.body) as unknown as { parameters: Brut[]; environments: (Brut & { values: Brut[] })[] };
const env = (corps: ReturnType<typeof reponse>, rang: number) => corps.environments[rang] as Brut & { values: Brut[] };
const cellule = (corps: ReturnType<typeof reponse>, rang: number, position: number) => env(corps, rang).values[position] as Brut;
const decoder = (corps: unknown) => () => decodeConfiguration(corps);
const propre = (value: unknown) => ({ state: "value", value, set_at: "2026-11-02T10:40:00+00:00", set_by: ALIX_REF, set_by_person: ALIX });
const resolue = (name: string, extra: Brut) => ({ name, state: "missing", value: null, set_at: null, set_by: null, set_by_person: null, ...extra });
/** Configuration à un seul paramètre de ce type, avec ses contraintes, son défaut et ses trois valeurs. */
function unSeul(type: string, constraints: unknown, defaut: unknown, valeurs: readonly Brut[]) {
  const corps = reponse();
  corps.parameters = [{ ...corps.parameters[0], name: "p", type, constraints, default: defaut }];
  corps.environments = corps.environments.map((environment, rang) => {
    const values = [resolue("p", valeurs[rang] ?? {})];
    // Complétude cohérente avec les états : le décodage refuse tout écart.
    const missing = values.filter((value) => value.state === "missing").map((value) => value.name);
    return { ...environment, values, missing, complete: missing.length === 0 };
  });
  return corps;
}

describe("Décodage de la configuration : exemple réel du serveur", () => {
  it("décode `parametres` : déclarations, puis trois environnements dans l'ordre avec une valeur par paramètre", () => {
    const configuration = decodeConfiguration(parametres.body);
    expect(configuration.parameters.map((parameter) => [parameter.name, parameter.declaration])).toEqual([
      ["catalogue", { constraints: { type: "identifier" }, required: true, default: null, description: "Catalogue des tables publiées" }],
      ["lignes_max", { constraints: { type: "integer", minimum: 1, maximum: 100000 }, required: false, default: 5000, description: "" }],
      ["region", { constraints: { type: "choice", choices: ["eu-west", "eu-central"] }, required: true, default: null, description: "Région de calcul" }],
    ]);
    expect(configuration.parameters[0]).toMatchObject({
      createdAt: new Date("2026-11-02T10:35:00Z"),
      createdBy: ALIX_REF,
      createdByPerson: ALIX,
      updatedAt: new Date("2026-11-02T10:35:00Z"),
      updatedBy: ALIX_REF,
      updatedByPerson: ALIX,
    });
    expect(configuration.environments.map((environment) => [environment.code, environment.canSet, environment.complete, environment.missing])).toEqual([
      ["DEV", true, false, ["region"]],
      ["TEST", true, false, ["catalogue", "region"]],
      ["PROD", false, false, ["catalogue", "region"]],
    ]);
    expect(configuration.environments[0]?.values).toEqual([
      { name: "catalogue", state: "value", value: "finance_dev", setAt: new Date("2026-11-02T10:40:00Z"), setBy: ALIX_REF, setByPerson: ALIX },
      { name: "lignes_max", state: "default", value: 5000, setAt: null, setBy: null, setByPerson: null },
      { name: "region", state: "missing", value: null, setAt: null, setBy: null, setByPerson: null },
    ]);
    expect(configuration.environments[1]?.values.map((resolved) => [resolved.state, resolved.value])).toEqual([["missing", null], ["value", 20000], ["missing", null]]);
    expect(configuration.environments[2]?.values.map((resolved) => [resolved.state, resolved.value])).toEqual([["missing", null], ["default", 5000], ["missing", null]]);
  });

  it("décode les exemples d'une déclaration créée et modifiée", () => {
    expect(decodeParameter(parametre.body, "paramètre")).toMatchObject({ name: "catalogue", declaration: { constraints: { type: "identifier" }, default: null } });
    expect(decodeParameter(parametreModifie.body, "paramètre")).toMatchObject({
      name: "region",
      declaration: { constraints: { type: "choice", choices: ["eu-west", "eu-central"] }, required: true, default: "eu-west", description: "Région de calcul" },
      updatedAt: new Date("2026-11-02T10:50:00Z"),
    });
  });

  it("une personne inconnue de Board reste nulle, sans être inventée", () => {
    const corps = reponse();
    corps.parameters[0] = { ...corps.parameters[0], created_by_person: null, updated_by_person: null };
    cellule(corps, 0, 0).set_by_person = null;
    const configuration = decodeConfiguration(corps);
    expect(configuration.parameters[0]).toMatchObject({ createdByPerson: null, updatedByPerson: null });
    expect(configuration.environments[0]?.values[0]?.setByPerson).toBeNull();
  });

  it("aucun paramètre : trois environnements sans valeur", () => {
    const corps = reponse();
    corps.parameters = [];
    for (const environment of corps.environments) Object.assign(environment, { values: [], missing: [], complete: true });
    expect(decodeConfiguration(corps)).toEqual({
      parameters: [],
      environments: [
        { code: "DEV", canSet: true, complete: true, missing: [], values: [] },
        { code: "TEST", canSet: true, complete: true, missing: [], values: [] },
        { code: "PROD", canSet: false, complete: true, missing: [], values: [] },
      ],
    });
  });

  it("décode chacun des cinq types, défaut et valeurs du bon type", () => {
    const cas = [
      ["text", { max_length: 64 }, "défaut", "propre", { type: "text", maxLength: 64 }],
      ["integer", { minimum: null, maximum: null }, -3, 9007199254740991, { type: "integer", minimum: null, maximum: null }],
      ["boolean", {}, false, true, { type: "boolean" }],
      ["choice", { choices: ["a"] }, "a", "a", { type: "choice", choices: ["a"] }],
      ["identifier", {}, "_x", "y9", { type: "identifier" }],
    ] as const;
    for (const [type, constraints, defaut, propreValeur, attendu] of cas) {
      const configuration = decodeConfiguration(unSeul(type, constraints, defaut, [propre(propreValeur), { state: "default", value: defaut }, { state: "default", value: defaut }]));
      expect(configuration.parameters[0]?.declaration.constraints, type).toEqual(attendu);
      expect(configuration.parameters[0]?.declaration.default, type).toBe(defaut);
      expect(configuration.environments.map((environment) => environment.values[0]?.value), type).toEqual([propreValeur, defaut, defaut]);
    }
  });

  it("un état « absent » sans valeur ni auteur est accepté", () => {
    const configuration = decodeConfiguration(unSeul("text", { max_length: 8 }, null, [{ state: "absent" }, { state: "absent" }, { state: "absent" }]));
    expect(configuration.environments.map((environment) => environment.values[0]?.state)).toEqual(["absent", "absent", "absent"]);
  });

  it("les champs inconnus ne sont pas recopiés", () => {
    const corps = reponse();
    corps.parameters[0] = { ...corps.parameters[0], secret: "x" };
    Object.assign(cellule(corps, 0, 0), { extra: 1 });
    const configuration = decodeConfiguration(corps);
    expect(configuration.parameters[0]).not.toHaveProperty("secret");
    expect(configuration.environments[0]?.values[0]).not.toHaveProperty("extra");
  });
});

describe("Décodage de la configuration : tout écart au contrat lève ContractError", () => {
  const cas: [string, (corps: ReturnType<typeof reponse>) => unknown, RegExp][] = [
    ["corps nul", () => null, /réponse : objet attendu/],
    ["sans environnements", (corps) => ({ parameters: corps.parameters }), /réponse\.environments : champ attendu/],
    ["environnements non liste", (corps) => ({ ...corps, environments: {} }), /réponse\.environments : liste attendu/],
    ["sans paramètres", (corps) => ({ environments: corps.environments }), /réponse\.parameters : champ attendu/],
    ["environnement manquant (PROD)", (corps) => ({ ...corps, environments: corps.environments.slice(0, 2) }), /DEV \| TEST \| PROD attendus dans cet ordre/],
    ["aucun environnement", (corps) => ({ ...corps, environments: [] }), /DEV \| TEST \| PROD attendus dans cet ordre/],
    ["environnements désordonnés", (corps) => ({ ...corps, environments: [corps.environments[1], corps.environments[0], corps.environments[2]] }), /attendus dans cet ordre/],
    ["environnements inversés", (corps) => ({ ...corps, environments: [...corps.environments].reverse() }), /attendus dans cet ordre/],
    ["environnement en double", (corps) => ({ ...corps, environments: [...corps.environments, corps.environments[2]] }), /attendus dans cet ordre/],
    ["environnement hors des trois", (corps) => ({ ...corps, environments: [...corps.environments.slice(0, 2), { ...corps.environments[2], code: "QA" }] }), /environments\[2\]\.code : DEV \| TEST \| PROD attendu/],
    ["environnement en minuscules", (corps) => ({ ...corps, environments: [{ ...corps.environments[0], code: "dev" }, ...corps.environments.slice(1)] }), /environments\[0\]\.code/],
    ["can_set absent", (corps) => { delete env(corps, 2).can_set; return corps; }, /environments\[2\]\.can_set : champ attendu/],
    ["can_set textuel", (corps) => { env(corps, 2).can_set = "false"; return corps; }, /can_set : booléen attendu/],
    ["complete absent", (corps) => { delete env(corps, 0).complete; return corps; }, /complete : champ attendu/],
    ["missing absent", (corps) => { delete env(corps, 0).missing; return corps; }, /missing : champ attendu/],
    ["missing non textuel", (corps) => { env(corps, 0).missing = [3]; return corps; }, /missing\[0\] : texte attendu/],
    ["values absent", (corps) => { delete (env(corps, 1) as Brut).values; return corps; }, /environments\[1\]\.values : champ attendu/],
    ["valeur absente (une de moins)", (corps) => { env(corps, 1).values.pop(); return corps; }, /environments\[1\]\.values : une valeur par paramètre déclaré/],
    ["aucune valeur", (corps) => { env(corps, 2).values = []; return corps; }, /environments\[2\]\.values : une valeur par paramètre déclaré/],
    ["valeur en trop", (corps) => { env(corps, 0).values.push(resolue("autre", {})); return corps; }, /environments\[0\]\.values\[3\]\.name : paramètre déclaré à cette place attendu/],
    ["valeur répétée en trop", (corps) => { env(corps, 0).values.push(cellule(corps, 0, 2)); return corps; }, /values\[3\]\.name : paramètre déclaré/],
    ["valeurs déplacées", (corps) => { env(corps, 1).values.reverse(); return corps; }, /environments\[1\]\.values\[0\]\.name : paramètre déclaré à cette place attendu/],
    ["valeur d'un paramètre en double à la place d'un autre", (corps) => { env(corps, 2).values[2] = { ...cellule(corps, 2, 1) }; return corps; }, /environments\[2\]\.values\[2\]\.name/],
    ["nom de valeur différent", (corps) => { cellule(corps, 0, 1).name = "lignes_maxi"; return corps; }, /values\[1\]\.name : paramètre déclaré à cette place attendu/],
    ["nom de valeur en majuscules", (corps) => { cellule(corps, 2, 0).name = "CATALOGUE"; return corps; }, /environments\[2\]\.values\[0\]\.name/],
    ["nom de valeur absent", (corps) => { delete cellule(corps, 0, 0).name; return corps; }, /values\[0\]\.name : champ attendu/],
    ["état inconnu", (corps) => { cellule(corps, 0, 2).state = "invalid"; return corps; }, /values\[2\]\.state : value \| default \| missing \| absent attendu/],
    ["« manquant » avec une valeur", (corps) => { cellule(corps, 0, 2).value = "eu-west"; return corps; }, /values\[2\] : état missing incohérent avec sa valeur/],
    ["« absent » avec une valeur", (corps) => { Object.assign(cellule(corps, 0, 2), { state: "absent", value: "eu-west" }); return corps; }, /état absent incohérent/],
    ["« par défaut » sans valeur", (corps) => { cellule(corps, 0, 1).value = null; return corps; }, /values\[1\] : état default incohérent avec sa valeur/],
    ["« valeur propre » sans valeur", (corps) => { cellule(corps, 0, 0).value = null; return corps; }, /values\[0\] : état value incohérent/],
    ["« valeur propre » sans date", (corps) => { cellule(corps, 0, 0).set_at = null; return corps; }, /état value incohérent/],
    ["« valeur propre » sans auteur", (corps) => { cellule(corps, 0, 0).set_by = null; return corps; }, /état value incohérent/],
    ["« par défaut » avec un auteur", (corps) => { cellule(corps, 0, 1).set_by = ALIX_REF; return corps; }, /état default incohérent/],
    ["« par défaut » avec une date", (corps) => { cellule(corps, 0, 1).set_at = "2026-11-02T10:40:00+00:00"; return corps; }, /état default incohérent/],
    ["« manquant » avec une date et un auteur", (corps) => { Object.assign(cellule(corps, 1, 0), { set_at: "2026-11-02T10:40:00+00:00", set_by: ALIX_REF }); return corps; }, /état missing incohérent/],
    ["date sans fuseau", (corps) => { cellule(corps, 0, 0).set_at = "2026-11-02T10:40:00"; return corps; }, /values\[0\]\.set_at : horodatage avec fuseau attendu/],
    ["auteur mal formé", (corps) => { cellule(corps, 0, 0).set_by = { issuer: "i" }; return corps; }, /set_by\.subject : champ attendu/],
    ["set_by_person absent", (corps) => { delete cellule(corps, 0, 0).set_by_person; return corps; }, /set_by_person : champ attendu/],
    ["valeur sans champ value", (corps) => { delete cellule(corps, 0, 2).value; return corps; }, /values\[2\]\.value : champ attendu/],
    // Valeur d'un autre type que celui déclaré.
    ["entier rendu en texte", (corps) => { cellule(corps, 1, 1).value = "20000"; return corps; }, /environments\[1\]\.values\[1\]\.value : entier attendu/],
    ["entier rendu décimal", (corps) => { cellule(corps, 0, 1).value = 5000.5; return corps; }, /values\[1\]\.value : entier attendu/],
    ["entier rendu booléen", (corps) => { cellule(corps, 0, 1).value = true; return corps; }, /values\[1\]\.value : entier attendu/],
    ["identifiant rendu nombre", (corps) => { cellule(corps, 0, 0).value = 7; return corps; }, /values\[0\]\.value : texte attendu/],
    ["choix rendu liste", (corps) => { Object.assign(cellule(corps, 0, 2), propre(["eu-west"])); return corps; }, /values\[2\]\.value : texte attendu/],
    // Déclaration hors contrat.
    ["type inconnu", (corps) => { corps.parameters[0] = { ...corps.parameters[0], type: "secret" }; return corps; }, /parameters\[0\]\.type : text \| integer \| boolean \| choice \| identifier attendu/],
    ["défaut d'un autre type (texte pour un entier)", (corps) => { corps.parameters[1] = { ...corps.parameters[1], default: "5000" }; return corps; }, /parameters\[1\]\.default : entier attendu/],
    ["défaut d'un autre type (nombre pour un choix)", (corps) => { corps.parameters[2] = { ...corps.parameters[2], default: 1 }; return corps; }, /parameters\[2\]\.default : texte attendu/],
    ["défaut absent", (corps) => { delete corps.parameters[0]?.default; return corps; }, /parameters\[0\]\.default : champ attendu/],
    ["contraintes absentes", (corps) => { delete corps.parameters[0]?.constraints; return corps; }, /parameters\[0\]\.constraints : champ attendu/],
    ["contraintes nulles", (corps) => { corps.parameters[0] = { ...corps.parameters[0], constraints: null }; return corps; }, /parameters\[0\]\.constraints : objet attendu/],
    ["contraintes d'un entier sans minimum", (corps) => { corps.parameters[1] = { ...corps.parameters[1], constraints: { maximum: 100000 } }; return corps; }, /parameters\[1\]\.constraints\.minimum : champ attendu/],
    ["contraintes d'un entier sans maximum", (corps) => { corps.parameters[1] = { ...corps.parameters[1], constraints: { minimum: 1 } }; return corps; }, /constraints\.maximum : champ attendu/],
    ["minimum décimal", (corps) => { corps.parameters[1] = { ...corps.parameters[1], constraints: { minimum: 1.5, maximum: null } }; return corps; }, /constraints\.minimum : entier attendu/],
    ["contraintes d'un choix sans valeurs possibles", (corps) => { corps.parameters[2] = { ...corps.parameters[2], constraints: {} }; return corps; }, /parameters\[2\]\.constraints\.choices : champ attendu/],
    ["valeurs possibles non textuelles", (corps) => { corps.parameters[2] = { ...corps.parameters[2], constraints: { choices: ["eu-west", 2] } }; return corps; }, /constraints\.choices\[1\] : texte attendu/],
    ["contraintes d'un identifiant en liste", (corps) => { corps.parameters[0] = { ...corps.parameters[0], constraints: [] }; return corps; }, /parameters\[0\]\.constraints : objet attendu/],
    ["obligatoire textuel", (corps) => { corps.parameters[0] = { ...corps.parameters[0], required: "true" }; return corps; }, /parameters\[0\]\.required : booléen attendu/],
    ["description absente", (corps) => { delete corps.parameters[1]?.description; return corps; }, /parameters\[1\]\.description : champ attendu/],
    ["auteur de la déclaration absent", (corps) => { delete corps.parameters[1]?.updated_by; return corps; }, /parameters\[1\]\.updated_by : champ attendu/],
    ["date de déclaration illisible", (corps) => { corps.parameters[1] = { ...corps.parameters[1], created_at: "hier" }; return corps; }, /parameters\[1\]\.created_at : horodatage avec fuseau attendu/],
  ];

  it.each(cas)("%s", (_cas, modifier, message) => {
    const corps = modifier(reponse());
    expect(decoder(corps)).toThrow(ContractError);
    expect(decoder(corps)).toThrow(message);
  });

  it.each([
    ["text sans max_length", "text", {}, /constraints\.max_length : champ attendu/],
    ["text à max_length textuel", "text", { max_length: "64" }, /constraints\.max_length : entier attendu/],
    ["booléen à contraintes nulles", "boolean", null, /constraints : objet attendu/],
  ] as const)("contraintes hors contrat : %s", (_cas, type, constraints, message) => {
    const corps = unSeul(type, constraints, null, [{ state: "absent" }, { state: "absent" }, { state: "absent" }]);
    expect(decoder(corps)).toThrow(ContractError);
    expect(decoder(corps)).toThrow(message);
  });

  it.each([
    ["booléen rendu en texte", "boolean", {}, "true", /values\[0\]\.value : booléen attendu/],
    ["booléen rendu en nombre", "boolean", {}, 1, /booléen attendu/],
    ["texte rendu en nombre", "text", { max_length: 8 }, 3, /texte attendu/],
    ["identifiant rendu booléen", "identifier", {}, false, /texte attendu/],
    ["entier rendu en objet", "integer", { minimum: null, maximum: null }, { n: 1 }, /entier attendu/],
  ] as const)("valeur d'un autre type que celui déclaré : %s", (_cas, type, constraints, valeurBrute, message) => {
    const corps = unSeul(type, constraints, null, [propre(valeurBrute), { state: "absent" }, { state: "absent" }]);
    expect(decoder(corps)).toThrow(ContractError);
    expect(decoder(corps)).toThrow(message);
  });

  it.each([
    ["booléen", "boolean", {}, "false", /default : booléen attendu/],
    ["texte", "text", { max_length: 8 }, 0, /default : texte attendu/],
    ["identifiant", "identifier", {}, true, /default : texte attendu/],
    ["entier décimal", "integer", { minimum: null, maximum: null }, 2.5, /default : entier attendu/],
  ] as const)("défaut d'un autre type que celui déclaré : %s", (_cas, type, constraints, defaut, message) => {
    const corps = unSeul(type, constraints, defaut, [{ state: "absent" }, { state: "absent" }, { state: "absent" }]);
    expect(decoder(corps)).toThrow(ContractError);
    expect(decoder(corps)).toThrow(message);
  });

  it.each<[string, (corps: ReturnType<typeof reponse>) => void, number]>([
    ["incomplet sans aucun manquant", (corps) => { env(corps, 0).missing = []; }, 0],
    ["complet qui nomme des manquants", (corps) => { env(corps, 1).complete = true; }, 1],
    ["complet sans manquant alors qu'une valeur est « manquant »", (corps) => { Object.assign(env(corps, 0), { complete: true, missing: [] }); }, 0],
    ["manquants dans le désordre", (corps) => { env(corps, 1).missing = ["region", "catalogue"]; }, 1],
    ["un manquant de trop", (corps) => { env(corps, 0).missing = ["region", "catalogue"]; }, 0],
    ["un manquant oublié", (corps) => { env(corps, 2).missing = ["catalogue"]; }, 2],
    ["un manquant qui n'est pas à l'état « manquant »", (corps) => { env(corps, 0).missing = ["lignes_max"]; }, 0],
    ["un manquant inconnu", (corps) => { env(corps, 0).missing = ["inconnu"]; }, 0],
    ["incomplet alors que rien ne manque", (corps) => { Object.assign(cellule(corps, 0, 2), propre("eu-west")); env(corps, 0).missing = []; }, 0],
  ])("complétude incohérente avec les états « manquant » : %s", (_cas, abimer, rang) => {
    const corps = reponse();
    abimer(corps);
    expect(decoder(corps)).toThrow(ContractError);
    expect(decoder(corps)).toThrow(`réponse.environments[${String(rang)}] : complétude incohérente avec les états « manquant »`);
  });

  it("complétude cohérente : complet quand plus rien ne manque, manquants dans l'ordre des déclarations", () => {
    const corps = reponse();
    Object.assign(cellule(corps, 0, 2), propre("eu-west"));
    Object.assign(env(corps, 0), { complete: true, missing: [] });
    expect(decodeConfiguration(corps).environments.map((environment) => [environment.complete, environment.missing])).toEqual([
      [true, []],
      [false, ["catalogue", "region"]],
      [false, ["catalogue", "region"]],
    ]);
  });
});

describe("Valeur posée (`PUT …/values/<env>`)", () => {
  it("décode l'exemple réel", () => {
    expect(decodeStoredValue(valeur.body, "valeur")).toEqual({
      name: "catalogue",
      environment: "DEV",
      value: "finance_dev",
      setAt: new Date("2026-11-02T10:40:00Z"),
      setBy: ALIX_REF,
      setByPerson: ALIX,
    });
  });

  it.each([["texte", "x"], ["entier", -12], ["zéro", 0], ["booléen", false], ["entier maximal", 9007199254740991]] as const)("accepte un %s", (_cas, valeurPosee) => {
    expect(decodeStoredValue({ ...valeur.body, value: valeurPosee, set_by_person: null }, "valeur")).toMatchObject({ value: valeurPosee, setByPerson: null });
  });

  it.each([
    ["valeur nulle", { value: null }, /valeur\.value : texte, entier ou booléen attendu/],
    ["valeur décimale", { value: 1.5 }, /valeur\.value : texte, entier ou booléen attendu/],
    ["valeur liste", { value: ["a"] }, /valeur\.value : texte, entier ou booléen attendu/],
    ["valeur objet", { value: {} }, /valeur\.value : texte, entier ou booléen attendu/],
    ["environnement hors des trois", { environment: "QA" }, /valeur\.environment : DEV \| TEST \| PROD attendu/],
    ["date absente", { set_at: undefined }, /valeur\.set_at : texte attendu/],
    ["auteur nul", { set_by: null }, /valeur\.set_by : objet attendu/],
  ] as const)("refuse %s", (_cas, ecart, message) => {
    const corps = { ...valeur.body, ...ecart };
    expect(() => decodeStoredValue(corps, "valeur")).toThrow(ContractError);
    expect(() => decodeStoredValue(corps, "valeur")).toThrow(message);
  });

  it("refuse une valeur sans champ value", () => {
    const corps: Record<string, unknown> = { ...valeur.body };
    delete corps.value;
    expect(() => decodeStoredValue(corps, "valeur")).toThrow("valeur.value : champ attendu");
  });
});

describe("Entier saisi : un nombre exact, sinon le texte tel quel (rien n'est arrondi)", () => {
  it.each([
    ["42", 42],
    ["-7", -7],
    ["0", 0],
    ["9007199254740991", 9007199254740991],
    ["-9007199254740991", -9007199254740991],
  ] as const)("« %s » devient le nombre %d", (saisie, attendu) => {
    expect(integerOrText(saisie)).toBe(attendu);
  });

  it.each([
    "",
    "1.5",
    "1,5",
    "1e3",
    " 5",
    "5 ",
    "+5",
    "--5",
    "5-",
    "0x10",
    "abc",
    "１２",
    "1 000",
    // Au-delà de ±(2⁵³ − 1), le navigateur arrondirait : le texte part tel quel, le serveur refuse.
    "9007199254740992",
    "9007199254740993",
    "-9007199254740992",
    "99999999999999999999",
  ])("« %s » reste du texte, inchangé", (saisie) => {
    expect(integerOrText(saisie)).toBe(saisie);
  });
});

describe("Libellés", () => {
  it("valeur : vrai et faux en mots, le reste tel quel, ni arrondi ni mis en forme", () => {
    expect(valueLabel(true)).toBe("vrai");
    expect(valueLabel(false)).toBe("faux");
    expect(valueLabel(0)).toBe("0");
    expect(valueLabel(-5)).toBe("-5");
    expect(valueLabel(9007199254740991)).toBe("9007199254740991");
    expect(valueLabel(100000)).toBe("100000");
    expect(valueLabel("finance_dev")).toBe("finance_dev");
    expect(valueLabel("true")).toBe("true");
    expect(valueLabel("")).toBe("");
  });

  it.each([
    [{ type: "text", maxLength: 64 }, "Texte · 64 caractères au plus"],
    [{ type: "integer", minimum: 1, maximum: 100000 }, "Entier · de 1 à 100000"],
    [{ type: "integer", minimum: -5, maximum: null }, "Entier · -5 au moins"],
    [{ type: "integer", minimum: 0, maximum: null }, "Entier · 0 au moins"],
    [{ type: "integer", minimum: null, maximum: 0 }, "Entier · 0 au plus"],
    [{ type: "integer", minimum: null, maximum: null }, "Entier"],
    [{ type: "boolean" }, "Booléen"],
    [{ type: "choice", choices: ["eu-west", "eu-central"] }, "Choix · eu-west, eu-central"],
    [{ type: "choice", choices: ["seul"] }, "Choix · seul"],
    [{ type: "identifier" }, "Identifiant"],
  ] as [Constraints, string][])("contraintes %j : « %s »", (constraints, attendu) => {
    expect(constraintsLabel(constraints)).toBe(attendu);
  });

  it("une longueur maximale de 1 s'écrit au singulier, 2 au pluriel", () => {
    expect(constraintsLabel({ type: "text", maxLength: 1 })).toBe("Texte · 1 caractère au plus");
    expect(constraintsLabel({ type: "text", maxLength: 2 })).toBe("Texte · 2 caractères au plus");
  });

  it("cinq types fermés et quatre états, chacun avec son libellé", () => {
    expect(PARAMETER_TYPES).toEqual(["text", "integer", "boolean", "choice", "identifier"]);
    expect(Object.keys(TYPE_LABELS)).toEqual([...PARAMETER_TYPES]);
    expect(STATES).toEqual(["value", "default", "missing", "absent"]);
    expect(STATE_LABELS).toEqual({ value: "valeur propre", default: "par défaut", missing: "manquant", absent: "absent" });
  });
});

describe("Déclaration seule (`decodeDeclaration`, plan 10, 10.4) : à plat ou dans le journal", () => {
  const brute = (extra: Brut = {}): Brut => ({ type: "integer", constraints: { minimum: 1, maximum: 100000 }, required: false, default: 5000, description: "", ...extra });

  it("décode les cinq champs d'une déclaration du journal réel, et rien d'autre", () => {
    expect(decodeDeclaration({ type: "integer", default: 5000, required: false, constraints: { maximum: 100000, minimum: 1 }, description: "" }, "détail")).toEqual({
      constraints: { type: "integer", minimum: 1, maximum: 100000 },
      required: false,
      default: 5000,
      description: "",
    });
  });

  it.each([
    [{ type: "text", constraints: { max_length: 8 }, required: true, default: "abc", description: "d" }, { constraints: { type: "text", maxLength: 8 }, required: true, default: "abc", description: "d" }],
    [{ type: "boolean", constraints: {}, required: false, default: false, description: "" }, { constraints: { type: "boolean" }, required: false, default: false, description: "" }],
    [{ type: "choice", constraints: { choices: ["a", "b"] }, required: true, default: null, description: "" }, { constraints: { type: "choice", choices: ["a", "b"] }, required: true, default: null, description: "" }],
    [{ type: "identifier", constraints: {}, required: true, default: "finance", description: "" }, { constraints: { type: "identifier" }, required: true, default: "finance", description: "" }],
    [{ type: "integer", constraints: { minimum: null, maximum: null }, required: true, default: null, description: "" }, { constraints: { type: "integer", minimum: null, maximum: null }, required: true, default: null, description: "" }],
  ])("type %#", (entree, attendu) => {
    expect(decodeDeclaration(entree, "d")).toEqual(attendu);
  });

  it("donne la même déclaration que `decodeParameter` sur l'exemple réel", () => {
    for (const [rang, brut] of parametres.body.parameters.entries()) {
      expect(decodeDeclaration(brut, "d"), String(rang)).toEqual(decodeParameter(brut, "p").declaration);
    }
  });

  it.each([
    ["pas un objet", null, "d : objet attendu"],
    ["liste", [], "d : objet attendu"],
    ["type absent", (() => { const b = brute(); delete b.type; return b; })(), "d.type : champ attendu"],
    ["type inconnu", brute({ type: "regex" }), "d.type : text | integer | boolean | choice | identifier attendu"],
    ["contraintes absentes", (() => { const b = brute(); delete b.constraints; return b; })(), "d.constraints : champ attendu"],
    ["contraintes d'un autre type", brute({ constraints: { max_length: 8 } }), "d.constraints.minimum : champ attendu"],
    ["obligatoire non booléen", brute({ required: 1 }), "d.required : booléen attendu"],
    ["défaut absent", (() => { const b = brute(); delete b.default; return b; })(), "d.default : champ attendu"],
    ["défaut d'un autre type", brute({ default: "5000" }), "d.default : entier attendu"],
    ["défaut décimal", brute({ default: 1.5 }), "d.default : entier attendu"],
    ["description absente", (() => { const b = brute(); delete b.description; return b; })(), "d.description : champ attendu"],
    ["description non textuelle", brute({ description: null }), "d.description : texte attendu"],
  ])("refuse %s, en nommant le champ sous le chemin donné", (_cas, entree, message) => {
    expect(() => decodeDeclaration(entree, "d")).toThrow(ContractError);
    expect(() => decodeDeclaration(entree, "d")).toThrow(message);
  });

  it("le nom ne fait pas partie de la déclaration : il est ignoré s'il est là, et n'est pas exigé", () => {
    expect(decodeDeclaration(brute({ name: 5 }), "d")).toEqual(decodeDeclaration(brute(), "d"));
  });
});

describe("Manquants (`missingLabel`)", () => {
  it.each([
    [1, "1 manquant"],
    [2, "2 manquants"],
    [3, "3 manquants"],
    [100, "100 manquants"],
  ])("%i : « %s »", (nombre, attendu) => {
    expect(missingLabel(nombre)).toBe(attendu);
  });
});
