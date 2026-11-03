import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ContractError } from "./decode";
import { decodeDiffPage, decodeRefusal, decodeUnavailable, decodeVersionsPage } from "./model";

// Vitest tourne depuis apps/web ; les exemples sont à la racine du dépôt (plan 05, V7).
const CONTRATS = resolve(process.cwd(), "../../contracts/catalogue");

interface Exemple {
  status: number;
  body: Record<string, unknown>;
}
function exemple(name: string): Exemple {
  return JSON.parse(readFileSync(resolve(CONTRATS, `${name}.json`), "utf8")) as Exemple;
}
/** Copie profonde modifiable d'un corps d'exemple. */
function corps(name: string): Record<string, unknown> {
  return structuredClone(exemple(name).body);
}
type Objet = Record<string, unknown>;
const premier = (valeur: unknown): Objet => (valeur as Objet[])[0] as Objet;

describe("Versions d'une définition (plan 05, V1)", () => {
  it("décode les versions dans l'ordre d'Atlas, dates relues avec leur fuseau", () => {
    const page = decodeVersionsPage(exemple("versions-revenu-net").body);
    expect(page.id).toBe("revenu-net");
    expect(page.current_version).toBe(5);
    expect(page.versions.map((version) => version.version)).toEqual([3, 4, 5]);
    expect(page.versions[0]?.date).toEqual(new Date("2026-11-01T21:38:29Z"));
    expect(page.versions[2]).toMatchObject({ commit: "e4f30c9448195045b2e9454d6751283bbe78ee08", author: "Tests catalogue", message: "Revenu net v5" });
    expect(page.provenance).toMatchObject({ commit: "e4f30c9448195045b2e9454d6751283bbe78ee08", freshness: "fresh", problem: null, detail: null });
  });
  it("accepte une liste vide et une version courante absente", () => {
    expect(decodeVersionsPage(exemple("versions-concept").body).versions).toEqual([]);
    expect(decodeVersionsPage({ ...corps("versions-concept"), current_version: null }).current_version).toBeNull();
  });
  it.each<[string, (body: Objet) => void, string]>([
    ["date de version sans fuseau", (body) => { premier(body.versions).date = "2026-11-01T22:38:29"; }, "versions.versions[0].date"],
    ["date de version illisible", (body) => { premier(body.versions).date = "hierZ"; }, "versions.versions[0].date"],
    ["numéro de version non entier", (body) => { premier(body.versions).version = 3.5; }, "versions.versions[0].version"],
    ["numéro de version en texte", (body) => { premier(body.versions).version = "3"; }, "versions.versions[0].version"],
    ["auteur absent", (body) => { delete premier(body.versions).author; }, "versions.versions[0].author"],
    ["message null", (body) => { premier(body.versions).message = null; }, "versions.versions[0].message"],
    ["commit absent", (body) => { delete premier(body.versions).commit; }, "versions.versions[0].commit"],
    ["version courante en texte", (body) => { body.current_version = "5"; }, "versions.current_version"],
    ["version courante absente", (body) => { delete body.current_version; }, "versions.current_version"],
    ["identifiant absent", (body) => { delete body.id; }, "versions.id"],
    ["liste remplacée par un objet", (body) => { body.versions = {}; }, "versions.versions"],
    ["provenance absente", (body) => { delete body.provenance; }, "versions.provenance"],
    ["fraîcheur inconnue", (body) => { (body.provenance as Objet).freshness = "tiede"; }, "versions.provenance.freshness"],
  ])("refuse %s", (_label, change, path) => {
    const body = corps("versions-revenu-net");
    change(body);
    expect(() => decodeVersionsPage(body)).toThrow(ContractError);
    expect(() => decodeVersionsPage(body)).toThrow(path);
  });
});

describe("Écart entre deux versions (plan 05, V4)", () => {
  const difference = (body: Objet): Objet => premier((body.diff as Objet).differences);
  const changement = (body: Objet): Objet => premier(difference(body).changes);

  it("relaie le rapport d'Atlas sans réinterprétation", () => {
    const { diff, id } = decodeDiffPage(exemple("ecart-revenu-net").body);
    expect(id).toBe("revenu-net");
    expect(diff.identical).toBe(false);
    expect(diff.base).toEqual({ version: 4, fingerprint: "sha256:atlas1:a248faeaf50b9381ef5d81e931d9e31ab40ba46d0156769b591350d2a7f2fb58" });
    expect(diff.other.version).toBe(5);
    expect(diff.by_severity).toEqual({ info: 1, warn: 1, critical: 0 });
    expect(diff.differences.map((item) => [item.classification, item.severity])).toEqual([["cosmetic", "info"], ["to_verify", "warn"]]);
    expect(diff.differences[1]?.changes).toEqual([{ field: "expr", before: "montant_ttc - montant_taxes - avoirs", after: "montant_ttc - montant_taxes" }]);
  });
  it("décode deux versions identiques sans écart", () => {
    const { diff } = decodeDiffPage(exemple("ecart-identique").body);
    expect(diff).toMatchObject({ identical: true, differences: [], by_severity: { info: 0, warn: 0, critical: 0 } });
    expect(diff.base).toEqual(diff.other);
  });
  it("ne relaie pas les alignements de nœuds ni un champ inconnu", () => {
    const body = corps("ecart-revenu-net");
    Object.assign(body.diff as Objet, { pairs: [["n02", "n02"]], futur: true });
    const { diff } = decodeDiffPage(body);
    expect(diff).not.toHaveProperty("pairs");
    expect(diff).not.toHaveProperty("futur");
  });
  it.each<[string, unknown]>([
    ["texte", "montant_ttc - montant_taxes"], ["nombre", 12.5], ["objet", { op: "sum", of: ["a"] }], ["liste", ["a", 1, null]], ["null", null], ["booléen", false],
  ])("recopie telle quelle une valeur de définition : %s", (_label, value) => {
    const body = corps("ecart-revenu-net");
    Object.assign(changement(body), { before: value, after: value });
    const change = decodeDiffPage(body).diff.differences[0]?.changes[0];
    expect(change?.before).toEqual(value);
    expect(change?.after).toEqual(value);
  });
  it.each(["before", "after"])("refuse un champ %s absent, même si la valeur peut être null", (field) => {
    const body = corps("ecart-revenu-net");
    const change = changement(body);
    if (field === "before") delete change.before;
    else delete change.after;
    expect(() => decodeDiffPage(body)).toThrow(ContractError);
    expect(() => decodeDiffPage(body)).toThrow(`écart.diff.differences[0].changes[0].${field}`);
  });
  it.each<[string, (body: Objet) => void, string]>([
    ["type d'écart inconnu", (body) => { difference(body).kind = "renamed"; }, "écart.diff.differences[0].kind"],
    ["classification inconnue", (body) => { difference(body).classification = "harmless"; }, "écart.diff.differences[0].classification"],
    ["sévérité inconnue", (body) => { difference(body).severity = "error"; }, "écart.diff.differences[0].severity"],
    ["sévérité en majuscules", (body) => { difference(body).severity = "WARN"; }, "écart.diff.differences[0].severity"],
    ["sévérité absente", (body) => { delete difference(body).severity; }, "écart.diff.differences[0].severity"],
    ["message absent", (body) => { delete difference(body).message; }, "écart.diff.differences[0].message"],
    ["nœud en nombre", (body) => { difference(body).base_node = 2; }, "écart.diff.differences[0].base_node"],
    ["champ modifié sans nom", (body) => { changement(body).field = null; }, "écart.diff.differences[0].changes[0].field"],
    ["changements absents", (body) => { delete difference(body).changes; }, "écart.diff.differences[0].changes"],
    ["identique en texte", (body) => { (body.diff as Objet).identical = "false"; }, "écart.diff.identical"],
    ["empreinte absente", (body) => { delete ((body.diff as Objet).base as Objet).fingerprint; }, "écart.diff.base.fingerprint"],
    ["version de base non entière", (body) => { ((body.diff as Objet).other as Objet).version = 5.1; }, "écart.diff.other.version"],
    ["résumé sans sévérité critique", (body) => { delete ((body.diff as Objet).by_severity as Objet).critical; }, "écart.diff.by_severity.critical"],
    ["résumé non entier", (body) => { ((body.diff as Objet).by_severity as Objet).warn = "1"; }, "écart.diff.by_severity.warn"],
    ["rapport absent", (body) => { delete body.diff; }, "écart.diff"],
  ])("refuse %s", (_label, change, path) => {
    const body = corps("ecart-revenu-net");
    change(body);
    expect(() => decodeDiffPage(body)).toThrow(ContractError);
    expect(() => decodeDiffPage(body)).toThrow(path);
  });
  it.each(["modified", "added", "removed", "reordered"])("accepte chaque type d'écart fermé : %s", (kind) => {
    const body = corps("ecart-revenu-net");
    Object.assign(difference(body), { kind, base_node: kind === "added" ? null : "n02", other_node: kind === "removed" ? null : "n02" });
    expect(decodeDiffPage(body).diff.differences[0]?.kind).toBe(kind);
  });
  it.each(["override_declared", "override_undeclared", "from_scratch", "critical", "cosmetic", "to_verify"])("accepte chaque classification fermée : %s", (classification) => {
    const body = corps("ecart-revenu-net");
    difference(body).classification = classification;
    expect(decodeDiffPage(body).diff.differences[0]?.classification).toBe(classification);
  });
  it.each(["info", "warn", "critical"])("accepte chaque sévérité fermée : %s", (severity) => {
    const body = corps("ecart-revenu-net");
    difference(body).severity = severity;
    expect(decodeDiffPage(body).diff.differences[0]?.severity).toBe(severity);
  });
});

describe("Refus d'un écart (plan 05, V6)", () => {
  it.each([
    ["ecart-version-inconnue", "version_not_found", "Version 9 de « revenu-net » introuvable."],
    ["ecart-concept", "diff_not_supported", "Un concept n'a pas de graphe : ses versions ne se comparent pas."],
    ["ecart-irresoluble", "diff_unavailable", "La version 3 de « revenu-net » n'est pas un document valide."],
  ])("décode %s en refus avec le détail d'Atlas", (name, code, detail) => {
    expect(decodeRefusal(exemple(name).body)).toEqual({ code, detail });
  });
  it.each([
    ["fiche-inconnue", exemple("fiche-inconnue").body],
    ["ecart-parametre-invalide", exemple("ecart-parametre-invalide").body],
    ["code futur", { error: { code: "rate_limited", detail: "Plus tard." } }],
    ["indisponibilité", exemple("versions-indisponible").body],
  ])("rend null pour un autre code d'erreur : %s", (_label, body) => {
    expect(decodeRefusal(body)).toBeNull();
  });
  it.each<[string, unknown, string]>([
    ["corps vide", {}, "réponse.error"],
    ["corps null", null, "réponse"],
    ["corps liste", [], "réponse"],
    ["erreur sans code", { error: { detail: "x" } }, "réponse.error.code"],
    ["code non textuel", { error: { code: 404 } }, "réponse.error.code"],
    ["refus sans détail", { error: { code: "version_not_found", id: "revenu-net" } }, "réponse.error.detail"],
    ["refus au détail non textuel", { error: { code: "diff_unavailable", detail: null } }, "réponse.error.detail"],
  ])("refuse un corps hors contrat : %s", (_label, body, path) => {
    expect(() => decodeRefusal(body)).toThrow(ContractError);
    expect(() => decodeRefusal(body)).toThrow(path);
  });
});

describe("Indisponibilité par route (plan 05, V2)", () => {
  it("décode l'historique indisponible avec sa raison et son détail", () => {
    expect(decodeUnavailable(exemple("versions-indisponible").body, "history_unavailable")).toEqual({
      code: "history_unavailable",
      problem: "repository_missing",
      detail: "Le clone de l'espace Atlas est introuvable à l'emplacement configuré.",
    });
  });
  it("garde catalog_unavailable comme code par défaut", () => {
    expect(decodeUnavailable(exemple("indisponible").body)).toMatchObject({ problem: "repository_missing" });
  });
  it("accepte index_busy comme indisponibilité fermée", () => {
    expect(decodeUnavailable(exemple("versions-index-occupe").body, "history_unavailable")).toEqual({
      code: "history_unavailable", problem: "index_busy", detail: "L'index de l'espace est occupé.",
    });
  });
  it.each<[string, "catalog_unavailable" | "history_unavailable" | undefined]>([
    ["versions-indisponible", "catalog_unavailable"],
    ["versions-indisponible", undefined],
    ["indisponible", "history_unavailable"],
  ])("refuse %s lu avec le code %s", (name, code) => {
    expect(() => decodeUnavailable(exemple(name).body, code)).toThrow(ContractError);
    expect(() => decodeUnavailable(exemple(name).body, code)).toThrow("réponse.error.code");
  });
  it("refuse un problème hors des valeurs fermées", () => {
    const body = corps("versions-indisponible");
    (body.error as Objet).problem = "disk_full";
    expect(() => decodeUnavailable(body, "history_unavailable")).toThrow("réponse.error.problem");
  });
});
