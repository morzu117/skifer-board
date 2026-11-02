import { describe, expect, it } from "vitest";

import espace from "../../../../contracts/espaces/espace.json";
import liste from "../../../../contracts/espaces/liste.json";
import administration from "../../../../contracts/espaces/liste-administration.json";
import locale from "../../../../contracts/espaces/liste-locale.json";
import { ContractError } from "../catalogue/decode";
import { decodeSpace, decodeSpaceList, NO_ROLE_LABEL, ROLE_LABELS, ROLES, roleLabel } from "./model";

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
