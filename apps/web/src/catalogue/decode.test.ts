import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { boolean, ContractError, instant, integer, list, object, oneOf, text } from "./decode";
import { decodeCatalogPage, decodeDiffPage, decodeDocumentPage, decodeVersionsPage } from "./model";

// Vitest tourne depuis apps/web ; les exemples sont à la racine du dépôt (plan 04, C10).
const CONTRATS = resolve(process.cwd(), "../../contracts/catalogue");

/** Corps attendu après décodage : chaque horodatage avec fuseau relu en UTC, comme `Date` le sérialise. */
function asUtc(value: unknown): unknown {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(value)) return new Date(value).toISOString();
  if (Array.isArray(value)) return value.map(asUtc);
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, asUtc(item)]));
  return value;
}

/** Décodeur d'un exemple, d'après le préfixe de son nom de fichier. */
function decoderOf(name: string): (value: unknown) => { provenance: { read_at: Date } } {
  if (name.startsWith("fiche-")) return decodeDocumentPage;
  if (name.startsWith("versions-")) return decodeVersionsPage;
  if (name.startsWith("ecart-")) return decodeDiffPage;
  return decodeCatalogPage;
}

describe("Contrat versionné du vrai serveur", () => {
  for (const name of readdirSync(CONTRATS).filter((name) => name.endsWith(".json"))) {
    const example = JSON.parse(readFileSync(resolve(CONTRATS, name), "utf8")) as { status: number; body: unknown };
    if (example.status === 200) {
      it(`décode intégralement ${name} et relit sa date avec fuseau`, () => {
        const decoded = decoderOf(name)(example.body);
        expect(decoded.provenance.read_at).toEqual(new Date("2026-11-01T10:30:00Z"));
        expect(JSON.parse(JSON.stringify(decoded))).toEqual(asUtc(example.body));
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
