import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { boolean, ContractError, instant, integer, list, object, oneOf, text } from "./decode";
import { decodeCatalogPage, decodeDocumentPage } from "./model";

// Vitest tourne depuis apps/web ; les exemples sont à la racine du dépôt (plan 04, C10).
const CONTRATS = resolve(process.cwd(), "../../contracts/catalogue");

describe("Contrat versionné du vrai serveur", () => {
  for (const name of readdirSync(CONTRATS).filter((name) => name.endsWith(".json"))) {
    const example = JSON.parse(readFileSync(resolve(CONTRATS, name), "utf8")) as { status: number; body: unknown };
    if (example.status === 200) {
      it(`décode intégralement ${name} et relit sa date avec fuseau`, () => {
        const decoded = name.startsWith("fiche-") ? decodeDocumentPage(example.body) : decodeCatalogPage(example.body);
        expect(decoded.provenance.read_at).toEqual(new Date("2026-11-01T10:30:00Z"));
        expect(JSON.parse(JSON.stringify(decoded))).toEqual({
          ...(example.body as object),
          provenance: { ...decoded.provenance, read_at: "2026-11-01T10:30:00.000Z" },
        });
      });
    }
  }
  it.each<[string, () => unknown, string]>([
    ["champ manquant", () => object({ titre: text })({}, "fiche"), "fiche.titre"],
    ["texte", () => text(3, "fiche.titre"), "fiche.titre"],
    ["booléen", () => boolean("true", "fiche.reference.found"), "fiche.reference.found"],
    ["entier non entier", () => integer(1.5, "fiche.version"), "fiche.version"],
    ["entier de type faux", () => integer("1", "fiche.version"), "fiche.version"],
    ["énumération inconnue", () => oneOf(["validated"])("inconnu", "fiche.status"), "fiche.status"],
    ["date sans fuseau", () => instant("2026-11-01T10:30:00", "fiche.read_at"), "fiche.read_at"],
    ["date invalide", () => instant("impossibleZ", "fiche.read_at"), "fiche.read_at"],
    ["liste attendue", () => list(text)({}, "fiche.synonyms"), "fiche.synonyms"],
    ["élément de liste", () => list(text)([null], "fiche.synonyms"), "fiche.synonyms[0]"],
    ["objet null", () => object({})(null, "fiche"), "fiche"],
    ["objet tableau", () => object({})([], "fiche"), "fiche"],
    ["objet primitif", () => object({})(42, "fiche"), "fiche"],
  ])("refuse %s avec ContractError et son chemin", (_label, decode, path) => {
    expect(decode).toThrow(ContractError);
    expect(decode).toThrow(path);
  });
  it("ignore les champs inconnus et respecte un décalage de fuseau", () => {
    expect(object({ titre: text })({ titre: "Commande", futur: true }, "fiche")).toEqual({ titre: "Commande" });
    expect(instant("2026-11-01T12:30:00+02:00", "date")).toEqual(new Date("2026-11-01T10:30:00Z"));
  });
});
