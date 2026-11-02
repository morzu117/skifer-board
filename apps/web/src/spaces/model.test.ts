import { describe, expect, it } from "vitest";

import espace from "../../../../contracts/espaces/espace.json";
import liste from "../../../../contracts/espaces/liste.json";
import administration from "../../../../contracts/espaces/liste-administration.json";
import locale from "../../../../contracts/espaces/liste-locale.json";
import creation from "../../../../contracts/espaces/creation.json";
import { ContractError } from "../catalogue/decode";
import journal from "../../../../contracts/espaces/journal.json";
import liaison from "../../../../contracts/espaces/liaison.json";
import membres from "../../../../contracts/espaces/membres.json";
import personnes from "../../../../contracts/espaces/personnes.json";
import {
  decodeBinding,
  decodeEvents,
  decodeMembers,
  decodePeople,
  decodeSpace,
  decodeSpaceList,
  deployCodes,
  manages,
  NO_ROLE_LABEL,
  personLabel,
  principalLabel,
  ROLE_LABELS,
  ROLES,
  roleLabel,
  type Space,
} from "./model";

const brut = () => structuredClone(espace.body) as Record<string, unknown>;

describe("Décodage d'un espace (plan 08, contrats d'espaces)", () => {
  it("décode l'exemple du serveur réel, dates comprises", () => {
    expect(decodeSpace(espace.body, "espace")).toEqual({
      id: "finance",
      name: "Finance",
      atlas: "skifer-atlas",
      createdAt: new Date("2026-11-02T09:00:00Z"),
      createdBy: { issuer: "https://id.example.invalid", subject: "00u1a2b3c4" },
      role: "admin",
      implicit: false,
      // L'exemple du serveur réel : administrateur sans aucun accord, donc sans droit de déployer (V4).
      environments: [
        { code: "DEV", deploy: false },
        { code: "TEST", deploy: false },
        { code: "PROD", deploy: false },
      ],
    });
  });
  it.each([...ROLES, null])("accepte le rôle %s", (role) => {
    expect(decodeSpace({ ...brut(), role }, "espace").role).toBe(role);
  });
  it("ignore un champ inconnu sans le recopier", () => {
    const decode = decodeSpace({ ...brut(), members: ["x"], platform_admin: true }, "espace");
    expect(Object.keys(decode).sort()).toEqual(["atlas", "createdAt", "createdBy", "environments", "id", "implicit", "name", "role"]);
  });
  it.each(["id", "name", "atlas", "created_at", "created_by", "role", "implicit", "environments"])("refuse l'absence du champ %s", (champ) => {
    // Un rôle absent n'est jamais lu comme « aucun rôle » : l'absence n'est pas `null`.
    const valeur = Object.fromEntries(Object.entries(brut()).filter(([cle]) => cle !== champ));
    expect(() => decodeSpace(valeur, "espace")).toThrow(new ContractError(`espace.${champ} : champ attendu`));
  });
  it.each([
    ["id", 1, "texte"],
    ["id", null, "texte"],
    ["name", ["Finance"], "texte"],
    ["atlas", null, "texte"],
    ["created_at", "2026-11-02T09:00:00", "horodatage avec fuseau"],
    ["created_at", "pas une date+00:00", "horodatage avec fuseau"],
    ["created_at", 1_700_000_000, "texte"],
    ["created_by", "00u1a2b3c4", "objet"],
    ["created_by", null, "objet"],
    ["implicit", "false", "booléen"],
    ["implicit", 0, "booléen"],
    ["implicit", null, "booléen"],
    ["role", "owner", "reader | creator | admin"],
    ["role", "Admin", "reader | creator | admin"],
    ["role", "platform_admin", "reader | creator | admin"],
    ["role", "", "reader | creator | admin"],
    ["role", 2, "reader | creator | admin"],
    ["role", ["admin"], "reader | creator | admin"],
  ])("refuse %s = %j", (champ, valeur, attendu) => {
    expect(() => decodeSpace({ ...brut(), [champ]: valeur }, "espace")).toThrow(new ContractError(`espace.${champ} : ${attendu} attendu`));
  });
  it.each([
    [{ subject: "x" }, "issuer", "champ"],
    [{ issuer: "x" }, "subject", "champ"],
    [{ issuer: 1, subject: "x" }, "issuer", "texte"],
    [{ issuer: "x", subject: null }, "subject", "texte"],
  ])("refuse un auteur incomplet %j", (auteur, champ, attendu) => {
    expect(() => decodeSpace({ ...brut(), created_by: auteur }, "espace")).toThrow(new ContractError(`espace.created_by.${champ} : ${attendu} attendu`));
  });
  it.each([null, "finance", [], 3])("refuse un corps qui n'est pas un objet : %j", (valeur) => {
    expect(() => decodeSpace(valeur, "espace")).toThrow(new ContractError("espace : objet attendu"));
  });
});

describe("Décodage de la liste des espaces", () => {
  it("décode la liste d'une personne, dans l'ordre du serveur, avec son rôle", () => {
    const decode = decodeSpaceList(liste.body);
    expect(decode.platformAdmin).toBe(false);
    expect(decode.spaces.map(({ id, role }) => [id, role])).toEqual([["finance", "creator"], ["rh", "reader"]]);
  });
  it("décode la liste de l'administration de la plateforme, rôle nul compris", () => {
    const decode = decodeSpaceList(administration.body);
    expect(decode.platformAdmin).toBe(true);
    expect(decode.spaces).toHaveLength(1);
    expect(decode.spaces[0]?.role).toBeNull();
  });
  it("décode l'espace implicite du mode local (E11)", () => {
    const decode = decodeSpaceList(locale.body);
    expect(decode.spaces[0]).toMatchObject({ id: "local", role: "admin", implicit: true });
  });
  it("accepte une liste vide", () => {
    expect(decodeSpaceList({ spaces: [], platform_admin: false })).toEqual({ spaces: [], platformAdmin: false });
  });
  it.each([
    [{ platform_admin: false }, "réponse.spaces : champ attendu"],
    [{ spaces: [] }, "réponse.platform_admin : champ attendu"],
    [{ spaces: {}, platform_admin: false }, "réponse.spaces : liste attendu"],
    [{ spaces: null, platform_admin: false }, "réponse.spaces : liste attendu"],
    [{ spaces: [], platform_admin: "true" }, "réponse.platform_admin : booléen attendu"],
    [{ spaces: [], platform_admin: null }, "réponse.platform_admin : booléen attendu"],
    [[], "réponse : objet attendu"],
  ])("refuse %j", (valeur, message) => {
    expect(() => decodeSpaceList(valeur)).toThrow(new ContractError(message));
  });
  it("refuse toute la liste si un seul espace est hors contrat, avec son rang", () => {
    const corps = structuredClone(liste.body) as { spaces: Record<string, unknown>[]; platform_admin: boolean };
    (corps.spaces[1] as Record<string, unknown>).role = "superuser";
    expect(() => decodeSpaceList(corps)).toThrow(new ContractError("réponse.spaces[1].role : reader | creator | admin attendu"));
  });
});

describe("Libellés des rôles (écrans §0.1)", () => {
  it("nomme les trois rôles ordonnés et l'administration de la plateforme sans rôle", () => {
    expect(ROLES).toEqual(["reader", "creator", "admin"]);
    expect(ROLES.map(roleLabel)).toEqual(["Lecteur", "Créateur", "Administrateur"]);
    expect(ROLE_LABELS).toEqual({ reader: "Lecteur", creator: "Créateur", admin: "Administrateur" });
    expect(roleLabel(null)).toBe(NO_ROLE_LABEL);
    expect(NO_ROLE_LABEL).toBe("Administration de la plateforme");
  });
});

describe("Liaisons, journal et personnes connues (plan 08, 8.4)", () => {
  const liaisonBrute = () => structuredClone(liaison.body) as Record<string, unknown>;
  const decoder = (value: unknown) => decodeBinding(value, "liaison");

  it("décode la liaison de l'exemple, auteur nommé compris", () => {
    expect(decoder(liaison.body)).toEqual({
      id: "9c3f2a7d-0b14-4e6a-8d52-6a7b8c9d0e1f",
      principal: { kind: "person", issuer: "https://id.example.invalid", subject: "00u5d6e7f8" },
      person: { name: "Dominique Leroy", email: "dominique.leroy@example.invalid" },
      role: "reader",
      createdAt: new Date("2026-11-02T09:15:00Z"),
      createdBy: { issuer: "https://id.example.invalid", subject: "00u1a2b3c4" },
      createdByPerson: { name: "Camille Martin", email: "camille.martin@example.invalid" },
    });
  });

  it("décode un principal groupe sans en garder d'autres champs, et une personne par émetteur et sujet", () => {
    const groupe = decoder({ ...liaisonBrute(), principal: { kind: "group", name: " Finance ", issuer: "x" }, person: null });
    expect(groupe.principal).toEqual({ kind: "group", name: " Finance " });
    const personne = decoder({ ...liaisonBrute(), principal: { kind: "person", issuer: "i", subject: "s", name: "intrus" } });
    expect(personne.principal).toEqual({ kind: "person", issuer: "i", subject: "s" });
  });

  it("accepte une personne et un auteur inconnus (null), ou connus sans nom ni adresse", () => {
    const inconnus = decoder({ ...liaisonBrute(), person: null, created_by_person: null });
    expect([inconnus.person, inconnus.createdByPerson]).toEqual([null, null]);
    const muets = decoder({ ...liaisonBrute(), person: { name: null, email: null }, created_by_person: { name: null, email: null } });
    expect([muets.person, muets.createdByPerson]).toEqual([{ name: null, email: null }, { name: null, email: null }]);
  });

  it.each([
    [{ principal: { kind: "robot" } }, "liaison.principal.kind"],
    [{ principal: { kind: "group" } }, "liaison.principal.name"],
    [{ principal: { kind: "person", issuer: "i" } }, "liaison.principal.subject"],
    [{ principal: null }, "liaison.principal"],
    [{ role: "owner" }, "liaison.role"],
    [{ role: null }, "liaison.role"],
    [{ created_at: "2026-11-02T09:15:00" }, "liaison.created_at"],
    [{ created_by: { issuer: "i" } }, "liaison.created_by.subject"],
    [{ person: { name: 1, email: null } }, "liaison.person.name"],
    [{ created_by_person: { name: "x" } }, "liaison.created_by_person.email"],
    [{ created_by_person: "Camille" }, "liaison.created_by_person"],
    [{ id: 7 }, "liaison.id"],
  ])("refuse une liaison hors contrat %j", (champ, chemin) => {
    expect(() => decoder({ ...liaisonBrute(), ...champ })).toThrow(ContractError);
    expect(() => decoder({ ...liaisonBrute(), ...champ })).toThrow(chemin);
  });

  it("refuse une liaison sans `created_by_person` : l'auteur nommé fait partie du contrat", () => {
    const sans = liaisonBrute();
    Reflect.deleteProperty(sans, "created_by_person");
    expect(() => decoder(sans)).toThrow("liaison.created_by_person : champ attendu");
  });

  it("décode la liste des membres et situe une erreur dans la liste", () => {
    expect(decodeMembers(membres.body).map((membre) => membre.principal.kind)).toEqual(["group", "person"]);
    expect(decodeMembers({ members: [] })).toEqual([]);
    const corps = structuredClone(membres.body) as { members: Record<string, unknown>[] };
    (corps.members[1] as Record<string, unknown>).role = "root";
    expect(() => decodeMembers(corps)).toThrow("réponse.members[1].role");
    expect(() => decodeMembers({})).toThrow("réponse.members : champ attendu");
  });

  it("décode le journal ; le détail est gardé tel quel, sans interprétation", () => {
    const evenements = decodeEvents(journal.body);
    expect(evenements).toHaveLength(3);
    expect(evenements[0]).toEqual({
      id: 3,
      at: new Date("2026-11-02T09:15:00Z"),
      actor: { issuer: "https://id.example.invalid", subject: "00u1a2b3c4" },
      actorPerson: { name: "Camille Martin", email: "camille.martin@example.invalid" },
      action: "binding_added",
      detail: { principal: { kind: "person", issuer: "https://id.example.invalid", subject: "00u5d6e7f8" }, after: "reader" },
      principalPerson: { name: "Dominique Leroy", email: "dominique.leroy@example.invalid" },
    });
    expect(evenements.map((evenement) => evenement.principalPerson)).toEqual([{ name: "Dominique Leroy", email: "dominique.leroy@example.invalid" }, null, null]);
    const etrange = {
      id: 9,
      at: "2026-11-02T10:00:00Z",
      actor: { issuer: "i", subject: "s" },
      actor_person: null,
      action: "quelque_chose",
      detail: [1, "deux"],
      principal_person: { name: null, email: null },
    };
    expect(decodeEvents({ events: [etrange] })[0]).toMatchObject({ action: "quelque_chose", detail: [1, "deux"], actorPerson: null, principalPerson: { name: null, email: null } });
  });

  it.each([
    [{ id: 1.5 }, "réponse.events[0].id"],
    [{ id: "3" }, "réponse.events[0].id"],
    [{ at: "hier" }, "réponse.events[0].at"],
    [{ action: null }, "réponse.events[0].action"],
    [{ actor_person: { name: "x" } }, "réponse.events[0].actor_person.email"],
    [{ principal_person: { name: "x" } }, "réponse.events[0].principal_person.email"],
    [{ principal_person: { name: 1, email: null } }, "réponse.events[0].principal_person.name"],
    [{ principal_person: "Dominique" }, "réponse.events[0].principal_person"],
  ])("refuse un événement hors contrat %j", (champ, chemin) => {
    const corps = structuredClone(journal.body) as { events: Record<string, unknown>[] };
    corps.events[0] = { ...corps.events[0], ...champ };
    expect(() => decodeEvents(corps)).toThrow(chemin);
  });

  it.each(["actor_person", "principal_person"])("refuse un événement sans `%s`", (champ) => {
    const corps = structuredClone(journal.body) as { events: Record<string, unknown>[] };
    const sans = { ...corps.events[0] };
    Reflect.deleteProperty(sans, champ);
    expect(() => decodeEvents({ events: [sans] })).toThrow(`réponse.events[0].${champ} : champ attendu`);
  });

  it("décode les personnes connues, et refuse une personne hors contrat", () => {
    expect(decodePeople(personnes.body)).toEqual([
      { issuer: "https://id.example.invalid", subject: "00u5d6e7f8", name: "Dominique Leroy", email: "dominique.leroy@example.invalid", lastLogin: new Date("2026-11-02T08:45:00Z") },
    ]);
    expect(decodePeople({ people: [] })).toEqual([]);
    expect(() => decodePeople({ people: [{ issuer: "i", subject: "s", name: null, email: null }] })).toThrow("réponse.people[0].last_login");
    expect(() => decodePeople({ people: [{ issuer: "i", subject: 2, name: null, email: null, last_login: "2026-11-02T08:45:00Z" }] })).toThrow("réponse.people[0].subject");
  });
});

describe("Libellés d'une personne et d'un principal", () => {
  const ref = { issuer: "https://id.example.invalid", subject: "00u5d6e7f8" };

  it.each([
    [{ name: "Dominique Leroy", email: "d@example.invalid" }, "Dominique Leroy"],
    [{ name: null, email: "d@example.invalid" }, "d@example.invalid"],
    [{ name: null, email: null }, "00u5d6e7f8"],
    [null, "00u5d6e7f8"],
  ])("nom, sinon adresse, sinon sujet : %j", (connue, attendu) => {
    expect(personLabel(ref, connue)).toBe(attendu);
  });

  // Un claim `name: ""` est accepté par la vérification du jeton et enregistré tel quel : un nom ou
  // une adresse vides, ou faits de blancs, ne comptent pas, et le libellé n'est jamais vide.
  it.each([
    [{ name: "", email: "d@example.invalid" }, "d@example.invalid"],
    [{ name: "   ", email: "d@example.invalid" }, "d@example.invalid"],
    [{ name: "\t\n", email: null }, "00u5d6e7f8"],
    [{ name: null, email: "" }, "00u5d6e7f8"],
    [{ name: "", email: " \u00a0 " }, "00u5d6e7f8"],
    [{ name: "  Dominique  ", email: null }, "  Dominique  "],
  ])("un nom ou une adresse vides ou blancs ne comptent pas : %j", (connue, attendu) => {
    expect(personLabel(ref, connue)).toBe(attendu);
  });

  it("un groupe se dit « Groupe <nom exact> », une personne par son libellé", () => {
    expect(principalLabel({ principal: { kind: "group", name: "finance-admins" }, person: null })).toBe("Groupe finance-admins");
    expect(principalLabel({ principal: { kind: "group", name: " Espaces " }, person: { name: "ignoré", email: null } })).toBe("Groupe  Espaces ");
    expect(principalLabel({ principal: { kind: "person", ...ref }, person: { name: "Dominique", email: null } })).toBe("Dominique");
    expect(principalLabel({ principal: { kind: "person", ...ref }, person: null })).toBe("00u5d6e7f8");
  });
});

describe("Qui gère les membres d'un espace (E6, E11)", () => {
  const espaceDe = (role: Space["role"], implicit = false): Space => ({ ...decodeSpace(espace.body, "espace"), role, implicit });

  it.each([
    ["admin", false, true],
    ["admin", true, true],
    ["creator", false, false],
    ["creator", true, true],
    ["reader", false, false],
    ["reader", true, true],
    [null, true, true],
    // Un espace lisible sans rôle ne l'est qu'à l'administration de la plateforme (E6) : il se gère
    // avant même que la liste ait confirmé ce droit.
    [null, false, true],
  ] as [Space["role"], boolean, boolean][])("rôle %s, administration de la plateforme %s : %s", (role, plateforme, attendu) => {
    expect(manages(espaceDe(role), plateforme)).toBe(attendu);
  });

  it("l'espace implicite du mode local ne se gère jamais, même administrateur", () => {
    for (const plateforme of [false, true]) {
      expect(manages(espaceDe("admin", true), plateforme)).toBe(false);
      expect(manages(espaceDe(null, true), plateforme)).toBe(false);
    }
  });
});

describe("Environnements d'un espace (plan 09, 9.3, V1 et V7)", () => {
  const env = (code: unknown, deploy: unknown = false) => ({ code, deploy });
  const TROIS = () => [env("DEV"), env("TEST"), env("PROD")];
  const avec = (environments: unknown) => ({ ...brut(), environments });
  const droits = (space: Space) => space.environments.map(({ code, deploy }) => `${code}:${String(deploy)}`);
  const ORDRE = "espace.environments : DEV | TEST | PROD attendus dans cet ordre";

  it("décode les exemples du serveur réel, droit de déployer compris", () => {
    // Créateur avec un accord en DEV ; lecteur sans accord (sans effet de toute façon, V3).
    const [finance, rh] = decodeSpaceList(liste.body).spaces as [Space, Space];
    expect(droits(finance)).toEqual(["DEV:true", "TEST:false", "PROD:false"]);
    expect(droits(rh)).toEqual(["DEV:false", "TEST:false", "PROD:false"]);
    // Mode local : la personne locale déploie dans les trois (V8).
    expect(droits(decodeSpaceList(locale.body).spaces[0] as Space)).toEqual(["DEV:true", "TEST:true", "PROD:true"]);
    // Administration de la plateforme seule, administrateur sans accord, espace créé : rien (V4).
    expect(droits(decodeSpaceList(administration.body).spaces[0] as Space)).toEqual(["DEV:false", "TEST:false", "PROD:false"]);
    expect(droits(decodeSpace(espace.body, "espace"))).toEqual(["DEV:false", "TEST:false", "PROD:false"]);
    expect(droits(decodeSpace(creation.body, "espace"))).toEqual(["DEV:false", "TEST:false", "PROD:false"]);
  });

  it.each([
    [[true, false, false]],
    [[false, true, false]],
    [[false, false, true]],
    [[true, false, true]],
    [[true, true, true]],
    [[false, false, false]],
  ])("garde chaque droit à sa place : %j", (attendus) => {
    const decode = decodeSpace(avec(["DEV", "TEST", "PROD"].map((code, rang) => env(code, attendus[rang]))), "espace");
    expect(decode.environments).toEqual([
      { code: "DEV", deploy: attendus[0] },
      { code: "TEST", deploy: attendus[1] },
      { code: "PROD", deploy: attendus[2] },
    ]);
  });

  it("refuse un espace sans environnements : l'absence n'est jamais lue comme « aucun droit »", () => {
    const sans = brut();
    Reflect.deleteProperty(sans, "environments");
    expect(() => decodeSpace(sans, "espace")).toThrow(new ContractError("espace.environments : champ attendu"));
  });

  it.each([null, {}, "DEV|TEST|PROD", 3, { 0: env("DEV"), 1: env("TEST"), 2: env("PROD"), length: 3 }])("refuse des environnements qui ne sont pas une liste : %j", (valeur) => {
    expect(() => decodeSpace(avec(valeur), "espace")).toThrow(new ContractError("espace.environments : liste attendu"));
  });

  it.each(["QA", "LOCAL", "dev", "Prod", " DEV", "", null, 1, ["DEV"]])("refuse un code d'environnement inconnu : %j", (code) => {
    const environnements = TROIS();
    environnements[1] = env(code);
    expect(() => decodeSpace(avec(environnements), "espace")).toThrow(new ContractError("espace.environments[1].code : DEV | TEST | PROD attendu"));
  });

  it.each(["true", 1, 0, null, "false", [], {}])("refuse un droit de déployer qui n'est pas un booléen : %j", (deploy) => {
    const environnements = TROIS();
    environnements[2] = env("PROD", deploy);
    expect(() => decodeSpace(avec(environnements), "espace")).toThrow(new ContractError("espace.environments[2].deploy : booléen attendu"));
  });

  it.each(["code", "deploy"])("refuse un environnement sans `%s`", (champ) => {
    const environnements: Record<string, unknown>[] = TROIS();
    Reflect.deleteProperty(environnements[0] as object, champ);
    expect(() => decodeSpace(avec(environnements), "espace")).toThrow(new ContractError(`espace.environments[0].${champ} : champ attendu`));
  });

  it.each([null, "DEV", ["DEV", true], 1])("refuse un environnement qui n'est pas un objet : %j", (valeur) => {
    expect(() => decodeSpace(avec([env("DEV"), valeur, env("PROD")]), "espace")).toThrow(new ContractError("espace.environments[1] : objet attendu"));
  });

  it.each([
    ["ordre inversé", ["PROD", "TEST", "DEV"]],
    ["TEST en tête", ["TEST", "DEV", "PROD"]],
    ["PROD avant TEST", ["DEV", "PROD", "TEST"]],
    ["doublon à la place de TEST", ["DEV", "DEV", "PROD"]],
    ["doublon à la place de PROD", ["DEV", "TEST", "TEST"]],
    ["deux environnements", ["DEV", "PROD"]],
    ["deux environnements, les premiers", ["DEV", "TEST"]],
    ["un seul", ["PROD"]],
    ["aucun", []],
    ["quatre, doublon final", ["DEV", "TEST", "PROD", "PROD"]],
    ["quatre, doublon en tête", ["DEV", "DEV", "TEST", "PROD"]],
  ])("refuse un autre ensemble ou un autre ordre (%s)", (_cas, codes) => {
    // Le droit déclaré ne change rien : l'ensemble entier est hors contrat (fail-closed).
    expect(() => decodeSpace(avec(codes.map((code) => env(code, true))), "espace")).toThrow(new ContractError(ORDRE));
    expect(() => decodeSpace(avec(codes.map((code) => env(code, false))), "espace")).toThrow(ContractError);
  });

  it("le message d'ordre situe l'espace fautif dans une liste, et refuse toute la liste", () => {
    const corps = structuredClone(liste.body) as { spaces: Record<string, unknown>[]; platform_admin: boolean };
    (corps.spaces[1] as Record<string, unknown>).environments = [env("DEV"), env("PROD"), env("TEST")];
    expect(() => decodeSpaceList(corps)).toThrow(new ContractError("réponse.spaces[1].environments : DEV | TEST | PROD attendus dans cet ordre"));
    (corps.spaces[1] as Record<string, unknown>).environments = [env("DEV"), env("TEST"), env("PROD", "oui")];
    expect(() => decodeSpaceList(corps)).toThrow(new ContractError("réponse.spaces[1].environments[2].deploy : booléen attendu"));
  });

  it("ignore un champ inconnu d'un environnement sans le recopier", () => {
    const decode = decodeSpace(
      avec([
        { code: "DEV", deploy: true, rank: 0, label: "Développement", grants: [{ principal: "x" }] },
        { code: "TEST", deploy: false, deploy_reason: "aucun accord" },
        { code: "PROD", deploy: false, required: "deploy" },
      ]),
      "espace",
    );
    for (const environnement of decode.environments) {
      expect(Object.keys(environnement).sort()).toEqual(["code", "deploy"]);
    }
    expect(decode.environments).toEqual([
      { code: "DEV", deploy: true },
      { code: "TEST", deploy: false },
      { code: "PROD", deploy: false },
    ]);
  });

  it("ne partage pas les objets reçus : modifier la réponse après coup ne change pas l'espace décodé", () => {
    const environnements = TROIS();
    const decode = decodeSpace(avec(environnements), "espace");
    (environnements[0] as { deploy: unknown }).deploy = true;
    expect(decode.environments[0]).toEqual({ code: "DEV", deploy: false });
  });
});

describe("Environnements où la personne peut déployer (plan 09, 9.3)", () => {
  const base = decodeSpace(espace.body, "espace");
  const avecDroits = (environments: Space["environments"]): Space => ({ ...base, environments });
  const de = (dev: boolean, test: boolean, prod: boolean): Space =>
    avecDroits([
      { code: "DEV", deploy: dev },
      { code: "TEST", deploy: test },
      { code: "PROD", deploy: prod },
    ]);

  it.each([
    [false, false, false, []],
    [true, false, false, ["DEV"]],
    [false, true, false, ["TEST"]],
    [false, false, true, ["PROD"]],
    [true, true, false, ["DEV", "TEST"]],
    [true, false, true, ["DEV", "PROD"]],
    [false, true, true, ["TEST", "PROD"]],
    [true, true, true, ["DEV", "TEST", "PROD"]],
  ])("DEV %s, TEST %s, PROD %s : %j", (dev, test, prod, attendu) => {
    expect(deployCodes(de(dev, test, prod))).toEqual(attendu);
  });

  it("dit les exemples du serveur réel", () => {
    const [finance, rh] = decodeSpaceList(liste.body).spaces as [Space, Space];
    expect(deployCodes(finance)).toEqual(["DEV"]);
    expect(deployCodes(rh)).toEqual([]);
    expect(deployCodes(decodeSpaceList(locale.body).spaces[0] as Space)).toEqual(["DEV", "TEST", "PROD"]);
    expect(deployCodes(decodeSpaceList(administration.body).spaces[0] as Space)).toEqual([]);
    expect(deployCodes(base)).toEqual([]);
  });

  it("suit toujours l'ordre DEV, TEST, PROD, même pour un espace construit dans le désordre", () => {
    const desordre = avecDroits([
      { code: "PROD", deploy: true },
      { code: "DEV", deploy: true },
      { code: "TEST", deploy: false },
    ]);
    expect(deployCodes(desordre)).toEqual(["DEV", "PROD"]);
    expect(deployCodes(avecDroits([{ code: "PROD", deploy: true }, { code: "TEST", deploy: true }, { code: "DEV", deploy: true }]))).toEqual(["DEV", "TEST", "PROD"]);
  });

  it("ne répète pas un code ni n'invente un droit : un doublon ne compte qu'une fois, un environnement absent pas du tout", () => {
    // Ces formes ne sortent jamais du décodeur ; la fonction reste sûre pour un espace construit à la main.
    expect(deployCodes(avecDroits([{ code: "DEV", deploy: true }, { code: "DEV", deploy: true }]))).toEqual(["DEV"]);
    expect(deployCodes(avecDroits([{ code: "TEST", deploy: false }, { code: "TEST", deploy: true }]))).toEqual(["TEST"]);
    expect(deployCodes(avecDroits([]))).toEqual([]);
  });

  it("ne dépend ni du rôle ni de l'espace implicite : le serveur reste seul juge (V3, V7)", () => {
    // Un lecteur avec un droit rendu par le serveur se voit dire ce droit tel quel : Board ne recalcule rien.
    expect(deployCodes({ ...de(false, false, true), role: "reader" })).toEqual(["PROD"]);
    expect(deployCodes({ ...de(false, false, false), role: "admin", implicit: true })).toEqual([]);
  });
});
