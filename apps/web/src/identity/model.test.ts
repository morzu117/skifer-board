import { describe, expect, it } from "vitest";
import local from "../../../../contracts/identite/me-local.json";
import etabli from "../../../../contracts/identite/me-etabli.json";
import anonyme from "../../../../contracts/identite/non-authentifie.json";
import refus from "../../../../contracts/identite/refus-connexion.json";
import { ContractError } from "../catalogue/decode";
import { decodeMe, decodeUnauthenticated, displayName, LOGIN_ERRORS, LOGIN_REASON_LABELS, loginReasonFrom } from "./model";

describe("Contrat de l'identité", () => {
  it("décode le mode local du serveur", () => {
    expect(decodeMe(local.body)).toEqual({ established: false });
  });
  it("décode l'identité complète et relit l'échéance en Date", () => {
    expect(decodeMe(etabli.body)).toEqual({ established: true, identity: etabli.body.identity, expiresAt: new Date(etabli.body.expires_at) });
  });
  it.each([
    ["established absent", {}],
    ["identité incomplète", { ...etabli.body, identity: { subject: "sujet" } }],
    ["groupes non liste", { ...etabli.body, identity: { ...etabli.body.identity, groups: "finance" } }],
    ["date sans fuseau", { ...etabli.body, expires_at: "2026-11-02T17:30:00" }],
  ])("refuse %s", (_nom, corps) => {
    expect(() => decodeMe(corps)).toThrow(ContractError);
  });
  it("décode le chemin de connexion du vrai serveur", () => {
    expect(decodeUnauthenticated(anonyme.body)).toBe(anonyme.body.error.login_url);
  });
  it("refuse un code autre que unauthenticated", () => {
    expect(() => decodeUnauthenticated({ error: { ...anonyme.body.error, code: "origin_refused" } })).toThrow(ContractError);
  });
  it.each(["https://ailleurs.invalid/auth", "//ailleurs.invalid/auth", "auth/login"])("refuse le chemin externe ou relatif %s", (login_url) => {
    expect(() => decodeUnauthenticated({ error: { code: "unauthenticated", login_url } })).toThrow(ContractError);
  });
  it.each([
    [etabli.body.identity, "Camille Martin"],
    [{ ...etabli.body.identity, name: null }, "camille.martin@example.invalid"],
    [{ ...etabli.body.identity, name: null, email: null }, "00u1a2b3c4"],
  ])("affiche le nom, sinon le courriel, sinon le sujet : %j", (personne, attendu) => {
    expect(displayName(personne)).toBe(attendu);
  });
  it("garde exactement les refus du serveur, dans le même ordre", () => {
    expect(LOGIN_ERRORS).toEqual(refus.login_error);
  });
  it.each([...LOGIN_ERRORS, "session_expired", "unknown"] as const)("donne un libellé non vide à %s", (raison) => {
    expect(LOGIN_REASON_LABELS[raison].trim().length).toBeGreaterThan(0);
  });
  it("ne déduit aucune raison en l'absence du paramètre", () => {
    expect(loginReasonFrom("")).toBeNull();
    expect(loginReasonFrom("?autre=token_refused")).toBeNull();
  });
  it.each(LOGIN_ERRORS)("reconnaît le code fermé %s", (raison) => {
    expect(loginReasonFrom(`?login_error=${raison}`)).toBe(raison);
  });
  it.each(["inconnu", ""])("conserve l'échec pour le code inconnu ou vide : %s", (raison) => {
    expect(loginReasonFrom(`?login_error=${raison}`)).toBe("unknown");
  });
});
