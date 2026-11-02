import { describe, expect, it } from "vitest";

import espace from "../../../../contracts/espaces/espace.json";
import liste from "../../../../contracts/espaces/liste.json";
import administration from "../../../../contracts/espaces/liste-administration.json";
import locale from "../../../../contracts/espaces/liste-locale.json";
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
    });
  });
  it.each([...ROLES, null])("accepte le rôle %s", (role) => {
    expect(decodeSpace({ ...brut(), role }, "espace").role).toBe(role);
  });
  it("ignore un champ inconnu sans le recopier", () => {
    const decode = decodeSpace({ ...brut(), members: ["x"], platform_admin: true }, "espace");
    expect(Object.keys(decode).sort()).toEqual(["atlas", "createdAt", "createdBy", "id", "implicit", "name", "role"]);
  });
  it.each(["id", "name", "atlas", "created_at", "created_by", "role", "implicit"])("refuse l'absence du champ %s", (champ) => {
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
