import { describe, expect, it, vi } from "vitest";

import interdit from "../../../../contracts/espaces/interdit.json";
import introuvable from "../../../../contracts/espaces/introuvable.json";
import modeLocal from "../../../../contracts/espaces/mode-local.json";
import parametre from "../../../../contracts/espaces/parametre.json";
import parametreExistant from "../../../../contracts/espaces/parametre-existant.json";
import parametreInconnu from "../../../../contracts/espaces/parametre-inconnu.json";
import parametreModifie from "../../../../contracts/espaces/parametre-modifie.json";
import parametres from "../../../../contracts/espaces/parametres.json";
import retraitParametre from "../../../../contracts/espaces/retrait-parametre.json";
import valeur from "../../../../contracts/espaces/valeur.json";
import valeurInterdite from "../../../../contracts/espaces/valeur-interdite.json";
import valeurInvalide from "../../../../contracts/espaces/valeur-invalide.json";
import valeurSansRole from "../../../../contracts/espaces/valeur-sans-role.json";
import valeursIncompatibles from "../../../../contracts/espaces/valeurs-incompatibles.json";
import anonyme from "../../../../contracts/identite/non-authentifie.json";
import { onSessionLost } from "../identity/session";
import { refusalText } from "./AdminParts";
import {
  clearParameterValue,
  declareParameter,
  fetchParameters,
  redeclareParameter,
  REFUSAL_LABELS,
  REFUSALS,
  removeParameter,
  setParameterValue,
  type AdminOutcome,
} from "./admin";
import type { Fetch } from "./api";
import { onSpaceLost } from "./lost";
import type { DeclarationInput } from "./parameters";

// Requêtes des paramètres de déploiement (plan 10, 10.2 et 10.3) : adresses, méthodes, corps exacts,
// refus à codes fermés (P8) rendus tels quels, réponses hors contrat jamais prises pour un succès.

type Exemple = { status: number; body: unknown };
const reponse = (exemple: Exemple) => (exemple.body === null ? new Response(null, { status: exemple.status }) : Response.json(exemple.body, { status: exemple.status }));
const servir = (exemple: Exemple) => vi.fn<Fetch>().mockResolvedValue(reponse(exemple));
const signal = () => new AbortController().signal;
const JSON_ACCEPTE = { Accept: "application/json" };
const JSON_ENVOYE = { Accept: "application/json", "Content-Type": "application/json" };
const DECLARATION: DeclarationInput = { type: "integer", constraints: { minimum: 1, maximum: null }, required: false, default: 5000, description: "Plafond" };

type Nom = "lecture" | "declaration" | "modification" | "retrait" | "pose" | "vidage";
const APPELS: Readonly<Record<Nom, (fetcher: Fetch) => Promise<AdminOutcome<unknown>>>> = {
  lecture: (fetcher) => fetchParameters("finance", signal(), fetcher),
  declaration: (fetcher) => declareParameter("finance", "lignes_max", DECLARATION, fetcher),
  modification: (fetcher) => redeclareParameter("finance", "lignes_max", DECLARATION, fetcher),
  retrait: (fetcher) => removeParameter("finance", "lignes_max", fetcher),
  pose: (fetcher) => setParameterValue("finance", "lignes_max", "PROD", 12, fetcher),
  vidage: (fetcher) => clearParameterValue("finance", "lignes_max", "PROD", fetcher),
};
const NOMS = Object.keys(APPELS) as Nom[];

async function signalements<T>(appel: () => Promise<T>) {
  const session = vi.fn();
  const espace = vi.fn();
  const quitterSession = onSessionLost(session);
  const quitterEspace = onSpaceLost(espace);
  try {
    return { issue: await appel(), session: session.mock.calls.length, espace: espace.mock.calls.length };
  } finally {
    quitterSession();
    quitterEspace();
  }
}

describe("Requêtes des paramètres (plan 10, 10.3)", () => {
  it("lit la configuration : GET à l'adresse encodée, Accept JSON, signal transmis, sans corps ; exemple réel décodé", async () => {
    const fetcher = servir(parametres);
    const abandon = signal();
    const issue = await fetchParameters("a/b c", abandon, fetcher);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/spaces/a%2Fb%20c/parameters", { method: "GET", headers: JSON_ACCEPTE, signal: abandon });
    expect(issue.status).toBe("ok");
    if (issue.status !== "ok") return;
    expect(issue.value.parameters.map((parameter) => parameter.name)).toEqual(["catalogue", "lignes_max", "region"]);
    expect(issue.value.environments.map((environment) => [environment.code, environment.canSet])).toEqual([["DEV", true], ["TEST", true], ["PROD", false]]);
  });

  it("déclare : POST à la collection, corps exact avec le nom et les cinq champs, sans signal ; 201 décodé", async () => {
    const fetcher = servir(parametre);
    const declaration: DeclarationInput = { type: "identifier", constraints: {}, required: true, default: null, description: "Catalogue des tables publiées" };
    const issue = await declareParameter("a/b", "catalogue", declaration, fetcher);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/spaces/a%2Fb/parameters", {
      method: "POST",
      headers: JSON_ENVOYE,
      body: JSON.stringify({ name: "catalogue", type: "identifier", constraints: {}, required: true, default: null, description: "Catalogue des tables publiées" }),
    });
    expect(issue).toMatchObject({ status: "ok", value: { name: "catalogue", declaration: { constraints: { type: "identifier" }, required: true } } });
  });

  it("déclare : le nom et les valeurs saisies partent tels quels, même mal formés (le serveur juge)", async () => {
    const fetcher = servir(parametre);
    await declareParameter("finance", " Nom-Invalide ", { type: "integer", constraints: { minimum: "1.5", maximum: "99999999999999999999" }, required: false, default: "abc", description: "  " }, fetcher);
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toEqual({
      name: " Nom-Invalide ",
      type: "integer",
      constraints: { minimum: "1.5", maximum: "99999999999999999999" },
      required: false,
      default: "abc",
      description: "  ",
    });
  });

  it("modifie : PUT au nom encodé ; le corps n'envoie pas le nom, immuable (P3)", async () => {
    const fetcher = servir(parametreModifie);
    const declaration: DeclarationInput = { type: "choice", constraints: { choices: ["eu-west", "eu-central"] }, required: true, default: "eu-west", description: "Région de calcul" };
    const issue = await redeclareParameter("a/b", "x/y?z#w", declaration, fetcher);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/spaces/a%2Fb/parameters/x%2Fy%3Fz%23w", {
      method: "PUT",
      headers: JSON_ENVOYE,
      body: JSON.stringify({ type: "choice", constraints: { choices: ["eu-west", "eu-central"] }, required: true, default: "eu-west", description: "Région de calcul" }),
    });
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).not.toHaveProperty("name");
    expect(issue).toMatchObject({ status: "ok", value: { name: "region", declaration: { default: "eu-west" } } });
  });

  it("retire : DELETE au nom encodé, 204 sans corps", async () => {
    const fetcher = servir(retraitParametre);
    expect(await removeParameter("a/b", "x/y?z#w", fetcher)).toEqual({ status: "ok", value: null });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/spaces/a%2Fb/parameters/x%2Fy%3Fz%23w", { method: "DELETE", headers: JSON_ACCEPTE });
  });

  it.each([
    ["texte", "finance_dev"],
    ["entier", 20000],
    ["zéro", 0],
    ["booléen faux", false],
    ["texte numérique non converti", "1.5"],
  ] as const)("pose une valeur (%s) : PUT `{value}` exact à l'environnement, sans signal", async (_cas, valeurPosee) => {
    const fetcher = servir({ status: 200, body: { ...valeur.body, value: valeurPosee } });
    const issue = await setParameterValue("a/b", "x/y", "TEST", valeurPosee, fetcher);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/spaces/a%2Fb/parameters/x%2Fy/values/TEST", { method: "PUT", headers: JSON_ENVOYE, body: JSON.stringify({ value: valeurPosee }) });
    expect(issue).toMatchObject({ status: "ok", value: { value: valeurPosee } });
  });

  it("pose : l'exemple réel est décodé entièrement", async () => {
    expect(await setParameterValue("finance", "catalogue", "DEV", "finance_dev", servir(valeur))).toEqual({
      status: "ok",
      value: {
        name: "catalogue",
        environment: "DEV",
        value: "finance_dev",
        setAt: new Date("2026-11-02T10:40:00Z"),
        setBy: { issuer: "https://id.example.invalid", subject: "00u9admin" },
        setByPerson: { name: "Alix", email: "alix@ex.invalid" },
      },
    });
  });

  it.each(["DEV", "TEST", "PROD"] as const)("vide la valeur en %s : DELETE, 204 sans corps", async (code) => {
    const fetcher = servir(retraitParametre);
    expect(await clearParameterValue("finance", "catalogue", code, fetcher)).toEqual({ status: "ok", value: null });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(`/api/spaces/finance/parameters/catalogue/values/${code}`, { method: "DELETE", headers: JSON_ACCEPTE });
  });

  it("utilise `fetch` par défaut", async () => {
    const global = vi.fn<Fetch>().mockResolvedValue(reponse(retraitParametre));
    vi.stubGlobal("fetch", global);
    try {
      await removeParameter("finance", "p");
      await clearParameterValue("finance", "p", "DEV");
      global.mockResolvedValue(reponse(parametres));
      await fetchParameters("finance", signal());
      global.mockResolvedValue(reponse(parametre));
      await declareParameter("finance", "p", DECLARATION);
      await redeclareParameter("finance", "p", DECLARATION);
      global.mockResolvedValue(reponse(valeur));
      await setParameterValue("finance", "p", "DEV", 1);
      expect(global).toHaveBeenCalledTimes(6);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Refus des paramètres rendus tels quels (P8)", () => {
  it("les quatre codes des paramètres sont fermés et ont leur libellé", () => {
    for (const code of ["parameter_not_found", "parameter_exists", "parameter_limit", "values_incompatible"] as const) {
      expect(REFUSALS).toContain(code);
      expect(REFUSAL_LABELS[code]).toMatch(/\.$/);
    }
    expect(REFUSAL_LABELS.parameter_not_found).toBe("Ce paramètre n'existe plus : la liste a été relue.");
    expect(REFUSAL_LABELS.parameter_exists).toBe("Un paramètre porte déjà ce nom dans l'espace.");
    expect(REFUSAL_LABELS.parameter_limit).toBe("L'espace a déjà 100 paramètres, le maximum.");
    expect(REFUSAL_LABELS.values_incompatible).toBe("Des valeurs déjà posées ne respecteraient plus cette déclaration : videz-les d'abord.");
  });

  it.each([
    ["paramètre inconnu", parametreInconnu, { code: "parameter_not_found", field: null }],
    ["paramètre existant", parametreExistant, { code: "parameter_exists", field: null }],
    ["limite de paramètres", { status: 409, body: { error: { code: "parameter_limit" } } }, { code: "parameter_limit", field: null }],
    ["valeur invalide", valeurInvalide, { code: "invalid_request", field: "value" }],
    ["champ d'une contrainte", { status: 400, body: { error: { code: "invalid_request", field: "constraints.max_length" } } }, { code: "invalid_request", field: "constraints.max_length" }],
    // Le droit de déployer manquant est un `forbidden` : ni `required` ni `environment` ne sont recopiés.
    ["sans droit de déployer en PROD", valeurInterdite, { code: "forbidden", field: null, environment: "PROD" }],
    ["administration de la plateforme sans rôle", valeurSansRole, { code: "forbidden", field: null }],
    ["accès refusé", interdit, { code: "forbidden", field: null }],
    ["mode local", modeLocal, { code: "local_mode", field: null }],
  ] as [string, Exemple, object][])("%s", async (_cas, exemple, refus) => {
    for (const nom of NOMS) {
      const { issue, session, espace } = await signalements(() => APPELS[nom](servir(exemple)));
      expect(issue, nom).toStrictEqual({ status: "refused", ...refus });
      expect(session + espace, nom).toBe(0);
    }
  });

  it("valeurs incompatibles : les environnements en cause sont repris (exemple réel)", async () => {
    for (const nom of NOMS) {
      expect(await APPELS[nom](servir(valeursIncompatibles)), nom).toStrictEqual({ status: "refused", code: "values_incompatible", field: null, environments: ["TEST"] });
    }
  });

  it.each([
    ["dans l'ordre de promotion", ["PROD", "DEV"], ["DEV", "PROD"]],
    ["les trois, à l'envers", ["PROD", "TEST", "DEV"], ["DEV", "TEST", "PROD"]],
    ["environnements inconnus ignorés", ["QA", "TEST", "prod", 3, null, { code: "DEV" }], ["TEST"]],
    ["sans doublon", ["TEST", "TEST"], ["TEST"]],
    ["liste vide", [], []],
    ["aucun connu", ["QA"], []],
  ] as [string, unknown[], string[]][])("valeurs incompatibles : %s", async (_cas, environnements, attendus) => {
    const issue = await APPELS.modification(servir({ status: 409, body: { error: { code: "values_incompatible", environments: environnements } } }));
    expect(issue).toStrictEqual({ status: "refused", code: "values_incompatible", field: null, environments: attendus });
  });

  it.each([
    ["absents", {}],
    ["textuels", { environments: "TEST" }],
    ["objet", { environments: { TEST: true } }],
    ["nuls", { environments: null }],
  ])("valeurs incompatibles aux environnements %s : refus sans environnements, jamais inventés", async (_cas, extra) => {
    const issue = await APPELS.modification(servir({ status: 409, body: { error: { code: "values_incompatible", ...extra } } }));
    expect(issue).toStrictEqual({ status: "refused", code: "values_incompatible", field: null });
  });

  it("les environnements d'un autre refus ne sont pas recopiés", async () => {
    const issue = await APPELS.pose(servir({ status: 403, body: { error: { code: "forbidden", environments: ["PROD"] } } }));
    expect(issue).toStrictEqual({ status: "refused", code: "forbidden", field: null });
  });

  it.each(["DEV", "TEST", "PROD"])("sans droit de déployer en %s : l'environnement est gardé", async (code) => {
    const issue = await APPELS.vidage(servir({ status: 403, body: { error: { code: "forbidden", required: "deploy", environment: code } } }));
    expect(issue).toStrictEqual({ status: "refused", code: "forbidden", field: null, environment: code });
  });

  it.each([
    ["un environnement inconnu", { required: "deploy", environment: "QA" }],
    ["un environnement en minuscules", { required: "deploy", environment: "prod" }],
    ["un environnement non textuel", { required: "deploy", environment: ["PROD"] }],
    ["un environnement nul", { required: "deploy", environment: null }],
    ["sans environnement", { required: "deploy" }],
    ["un autre droit exigé", { required: "admin", environment: "PROD" }],
    ["sans droit exigé", { environment: "PROD" }],
  ])("refus « interdit » avec %s : aucun environnement n'est inventé", async (_cas, extra) => {
    const issue = await APPELS.pose(servir({ status: 403, body: { error: { code: "forbidden", ...extra } } }));
    expect(issue).toStrictEqual({ status: "refused", code: "forbidden", field: null });
  });

  it("l'environnement d'un autre refus que « interdit » n'est pas recopié", async () => {
    const issue = await APPELS.pose(servir({ status: 400, body: { error: { code: "invalid_request", field: "value", required: "deploy", environment: "PROD" } } }));
    expect(issue).toStrictEqual({ status: "refused", code: "invalid_request", field: "value" });
  });

  it("valeurs incompatibles avec un champ : le champ est gardé aussi", async () => {
    const issue = await APPELS.modification(servir({ status: 409, body: { error: { code: "values_incompatible", field: "default", environments: ["DEV"] } } }));
    expect(issue).toStrictEqual({ status: "refused", code: "values_incompatible", field: "default", environments: ["DEV"] });
  });

  it("un espace introuvable pendant l'usage est signalé à la coque (E4)", async () => {
    for (const nom of NOMS) {
      const { issue, session, espace } = await signalements(() => APPELS[nom](servir(introuvable)));
      expect(issue, nom).toEqual({ status: "refused", code: "space_not_found", field: null });
      expect([session, espace], nom).toEqual([0, 1]);
    }
  });
});

describe("Pannes et réponses hors contrat des paramètres", () => {
  it("401 : la session perdue est signalée", async () => {
    for (const nom of NOMS) {
      const { issue, session, espace } = await signalements(() => APPELS[nom](servir(anonyme)));
      expect(issue, nom).toEqual({ status: "error", message: "Session expirée : reconnectez-vous." });
      expect([session, espace], nom).toEqual([1, 0]);
    }
  });

  it("serveur muet : une erreur ; une écriture sans signal n'est jamais traitée comme abandonnée", async () => {
    for (const nom of NOMS) {
      expect(await APPELS[nom](vi.fn<Fetch>().mockRejectedValue(new TypeError("réseau"))), nom).toEqual({ status: "error", message: "Le serveur Board ne répond pas." });
      if (nom !== "lecture") {
        expect(await APPELS[nom](vi.fn<Fetch>().mockRejectedValue(new DOMException("abandon", "AbortError"))), nom).toEqual({ status: "error", message: "Le serveur Board ne répond pas." });
      }
    }
  });

  it("une lecture abandonnée rejette au lieu de rendre une erreur", async () => {
    const avant = new AbortController();
    avant.abort();
    const refus = new DOMException("abandon", "AbortError");
    await expect(fetchParameters("finance", avant.signal, vi.fn<Fetch>().mockRejectedValue(refus))).rejects.toBe(refus);
  });

  it.each([
    ["lecture", APPELS.lecture, "réponse.parameters : champ attendu"],
    ["declaration", APPELS.declaration, "paramètre.name : champ attendu"],
    ["modification", APPELS.modification, "paramètre.name : champ attendu"],
    ["pose", APPELS.pose, "valeur.name : champ attendu"],
  ])("un succès hors contrat (%s) n'est pas un succès", async (_nom, appel, raison) => {
    expect(await appel(servir({ status: 200, body: {} }))).toEqual({ status: "error", message: `Réponse du serveur hors contrat : ${raison}.` });
  });

  it("une configuration aux environnements désordonnés n'est pas un succès", async () => {
    const corps = structuredClone(parametres.body);
    corps.environments.reverse();
    expect(await APPELS.lecture(servir({ status: 200, body: corps }))).toEqual({
      status: "error",
      message: "Réponse du serveur hors contrat : réponse.environments : DEV | TEST | PROD attendus dans cet ordre.",
    });
  });

  it("une valeur posée décimale n'est pas un succès : rien n'est arrondi", async () => {
    expect(await APPELS.pose(servir({ status: 200, body: { ...valeur.body, value: 12.5 } }))).toEqual({
      status: "error",
      message: "Réponse du serveur hors contrat : valeur.value : texte, entier ou booléen attendu.",
    });
  });

  it("une déclaration rendue d'un type inconnu n'est pas un succès", async () => {
    expect(await APPELS.declaration(servir({ status: 201, body: { ...parametre.body, type: "secret" } }))).toEqual({
      status: "error",
      message: "Réponse du serveur hors contrat : paramètre.type : text | integer | boolean | choice | identifier attendu.",
    });
  });

  it("un refus hors contrat est une erreur, jamais un refus inventé", async () => {
    for (const nom of NOMS) {
      expect(await APPELS[nom](servir({ status: 409, body: { error: { code: "parameter_locked" } } })), nom).toEqual({ status: "error", message: "Réponse inattendue du serveur (HTTP 409)." });
    }
  });
});

describe("Libellé d'un refus des paramètres", () => {
  it("valeurs incompatibles : nomme les environnements en cause, dans l'ordre reçu", () => {
    expect(refusalText({ code: "values_incompatible", field: null, environments: ["TEST"] })).toBe(
      "Des valeurs déjà posées ne respecteraient plus cette déclaration : videz-les d'abord. Environnements en cause : TEST.",
    );
    expect(refusalText({ code: "values_incompatible", field: null, environments: ["DEV", "PROD"] })).toBe(
      "Des valeurs déjà posées ne respecteraient plus cette déclaration : videz-les d'abord. Environnements en cause : DEV, PROD.",
    );
  });

  it("sans environnement nommé, le libellé seul", () => {
    expect(refusalText({ code: "values_incompatible", field: null, environments: [] })).toBe(REFUSAL_LABELS.values_incompatible);
    expect(refusalText({ code: "values_incompatible", field: null })).toBe(REFUSAL_LABELS.values_incompatible);
  });

  it.each([
    ["type", "type"],
    ["constraints", "contraintes"],
    ["constraints.max_length", "longueur maximale"],
    ["constraints.minimum", "minimum"],
    ["constraints.maximum", "maximum"],
    ["constraints.choices", "valeurs possibles"],
    ["required", "obligatoire"],
    ["default", "valeur par défaut"],
    ["description", "description"],
    ["value", "valeur"],
    ["name", "nom"],
    ["body", "corps de la demande"],
    // Un champ inconnu est nommé tel que le serveur le dit, sans être traduit au hasard.
    ["constraints.pattern", "constraints.pattern"],
  ])("champ « %s » : « %s »", (champ, libelle) => {
    expect(refusalText({ code: "invalid_request", field: champ })).toBe(`La demande est incomplète ou mal formée. Champ en cause : ${libelle}.`);
  });

  it("les autres refus des paramètres : leur libellé seul", () => {
    expect(refusalText({ code: "parameter_exists", field: null })).toBe("Un paramètre porte déjà ce nom dans l'espace.");
    expect(refusalText({ code: "parameter_limit", field: null })).toBe("L'espace a déjà 100 paramètres, le maximum.");
    expect(refusalText({ code: "parameter_not_found", field: null })).toBe("Ce paramètre n'existe plus : la liste a été relue.");
  });

  it("le refus d'une valeur faute de droit de déployer nomme ce droit et l'environnement (exemple réel)", async () => {
    const issue = await APPELS.pose(servir(valeurInterdite));
    expect(issue.status).toBe("refused");
    if (issue.status !== "refused") return;
    expect(refusalText(issue)).toBe("Cette action demande le droit de déployer en PROD.");
  });

  it.each(["DEV", "TEST", "PROD"] as const)("droit de déployer manquant en %s : l'environnement est nommé, le champ n'y change rien", (code) => {
    expect(refusalText({ code: "forbidden", field: null, environment: code })).toBe(`Cette action demande le droit de déployer en ${code}.`);
    expect(refusalText({ code: "forbidden", field: "value", environment: code, environments: undefined })).toBe(`Cette action demande le droit de déployer en ${code}.`);
  });

  it("un refus « interdit » sans environnement garde le libellé du rôle", () => {
    expect(refusalText({ code: "forbidden", field: null, environment: undefined, environments: undefined })).toBe("Votre rôle ne permet pas cette action.");
  });
});
