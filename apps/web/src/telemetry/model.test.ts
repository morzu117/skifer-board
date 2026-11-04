import { describe, expect, it } from "vitest";

import fenetreInvalide from "../../../../contracts/telemetrie/fenetre-invalide.json";
import interdit from "../../../../contracts/telemetrie/interdit.json";
import lecture7j from "../../../../contracts/telemetrie/lecture-7j.json";
import lecture from "../../../../contracts/telemetrie/lecture.json";
import modeLocal from "../../../../contracts/telemetrie/mode-local.json";
import vide from "../../../../contracts/telemetrie/vide.json";
import { ContractError } from "../catalogue/decode";
import { MISSING } from "../format/number";
import { byP95, decodeSummary, formatCount, formatDuration, formatSize, KIND_LABELS, WINDOW_LABELS, WINDOW_SPANS, WINDOWS, type OperationSummary, type Window } from "./model";

// Modèle de la télémétrie (plan 11, T7 et T8 ; 11.4). Les réponses sont les exemples du serveur
// réel (contracts/telemetrie) ; chaque écart au contrat est refusé, jamais affiché à moitié.

type Brut = Record<string, unknown>;
type Corps = Brut & { operations: (Brut & { duration_ms: Brut; size: Brut; rows: Brut })[] };
const copie = (): Corps => structuredClone(lecture.body);
const premiere = (corps: Corps) => corps.operations[0] as Corps["operations"][number];
/** Remplace les espaces insécables pour lire les attentes. */
const plain = (text: string): string => text.replace(/[\u00a0\u202f]/g, " ");
const refuse = (corps: unknown, fenetre: Window = "24h", message?: RegExp) => {
  expect(() => decodeSummary(corps, fenetre)).toThrow(ContractError);
  if (message !== undefined) expect(() => decodeSummary(corps, fenetre)).toThrow(message);
};
const operation = (operation: string, p95: number, extra: Partial<OperationSummary> = {}): OperationSummary => ({
  kind: "http", operation, method: "GET", count: 1, errors: 0, refusals: 0,
  duration: { p50: p95, p95, max: p95 }, size: { p50: null, max: null }, rows: { p50: null, max: null }, ...extra,
});

describe("decodeSummary : exemples du serveur réel", () => {
  it("lit la fenêtre de 24 h, ses bornes, sa période et ses opérations, durées renommées", () => {
    const resume = decodeSummary(lecture.body, "24h");
    expect(resume.window).toBe("24h");
    expect(resume.start).toEqual(new Date("2026-11-02T12:00:00Z"));
    expect(resume.end).toEqual(new Date("2026-11-03T12:00:00Z"));
    expect(resume.period).toEqual({ oldest: new Date("2026-11-03T06:56:00Z"), newest: new Date("2026-11-03T11:56:00Z") });
    expect(resume.operations).toHaveLength(4);
    expect(resume.operations[0]).toEqual({
      kind: "http",
      operation: "/api/spaces/{space_id}/members",
      method: "GET",
      count: 5,
      errors: 1,
      refusals: 1,
      duration: { p50: 14, p95: 80.19999999999999, max: 95 },
      size: { p50: 412, max: 430 },
      rows: { p50: null, max: null },
    });
    expect(resume.operations[1]).toMatchObject({ kind: "atlas", operation: "atlas.list", method: null, size: { p50: 1572864, max: 1572864 }, rows: { p50: 48, max: 48 } });
    expect(resume.operations[3]).toMatchObject({ operation: "atlas.document", size: { p50: null, max: null } });
    for (const found of resume.operations) expect(found).not.toHaveProperty("duration_ms");
    // L'ordre du serveur est gardé par le décodage : le tri est l'affaire de l'écran.
    expect(resume.operations.map((found) => found.operation)).toEqual(lecture.body.operations.map((found) => found.operation));
  });

  it("lit la fenêtre de 7 jours", () => {
    const resume = decodeSummary(lecture7j.body, "7d");
    expect(resume.window).toBe("7d");
    expect(resume.operations.map((found) => `${found.method ?? "-"} ${found.operation}`)).toEqual([
      "GET /api/spaces/{space_id}/members",
      "- atlas.list",
      "POST /api/spaces",
      "GET /api/me",
      "- atlas.document",
    ]);
    expect(resume.period?.oldest).toEqual(new Date("2026-10-31T12:00:00Z"));
  });

  it("lit une fenêtre vide : aucune période, aucune opération", () => {
    expect(decodeSummary(vide.body, "24h")).toEqual({
      window: "24h",
      start: new Date("2026-11-02T12:00:00Z"),
      end: new Date("2026-11-03T12:00:00Z"),
      period: null,
      operations: [],
    });
  });

  it("lit une fenêtre de 30 jours", () => {
    expect(decodeSummary({ ...copie(), window: "30d" }, "30d").window).toBe("30d");
  });

  it.each([["interdit", interdit.body], ["mode local", modeLocal.body], ["fenêtre invalide", fenetreInvalide.body]])("refuse un corps de refus (%s) comme résumé", (_, corps) => {
    refuse(corps);
  });
});

describe("decodeSummary : fenêtre", () => {
  it.each([
    ["24h", "7d"],
    ["24h", "30d"],
    ["7d", "24h"],
    ["30d", "7d"],
  ] as [Window, Window][])("refuse un résumé de %s quand %s est demandée", (rendue, demandee) => {
    refuse({ ...copie(), window: rendue }, demandee, /fenêtre demandée attendue/);
  });

  it.each(["1h", "24H", "", null, 24, "all"])("refuse une fenêtre inconnue : %j", (fenetre) => {
    refuse({ ...copie(), window: fenetre }, "24h", /télémétrie\.window/);
  });
});

describe("decodeSummary : champs hors contrat", () => {
  it("n'accepte pas autre chose qu'un objet", () => {
    for (const corps of [null, [], "x", 3, undefined]) refuse(corps);
  });

  it.each(["window", "start", "end", "oldest", "newest", "operations"])("refuse un résumé sans « %s »", (champ) => {
    const corps = copie();
    Reflect.deleteProperty(corps, champ);
    refuse(corps, "24h", new RegExp(`télémétrie\\.${champ} : champ attendu`));
  });

  it.each(["kind", "operation", "method", "count", "errors", "refusals", "duration_ms", "size", "rows"])("refuse une opération sans « %s »", (champ) => {
    const corps = copie();
    Reflect.deleteProperty(premiere(corps), champ);
    refuse(corps, "24h", new RegExp(`operations\\[0\\]\\.${champ} : champ attendu`));
  });

  it.each([
    ["duration_ms", "p50"], ["duration_ms", "p95"], ["duration_ms", "max"],
    ["size", "p50"], ["size", "max"], ["rows", "p50"], ["rows", "max"],
  ])("refuse une opération sans %s.%s", (bloc, champ) => {
    const corps = copie();
    Reflect.deleteProperty(premiere(corps)[bloc] as Brut, champ);
    refuse(corps, "24h", new RegExp(`${bloc}\\.${champ} : champ attendu`));
  });

  it.each(["2026-11-02T12:00:00", "2026-11-02", "hier", "", 1730000000, null])("refuse un début sans fuseau ou illisible : %j", (valeur) => {
    refuse({ ...copie(), start: valeur });
    refuse({ ...copie(), end: valeur });
  });

  it("refuse une plus ancienne ou plus récente mesure sans fuseau", () => {
    refuse({ ...copie(), oldest: "2026-11-03T06:56:00" });
    refuse({ ...copie(), newest: "2026-11-03T11:56:00" });
  });

  it.each(["db", "HTTP", "sql", "", null, 1])("refuse un genre inconnu : %j", (genre) => {
    const corps = copie();
    premiere(corps).kind = genre;
    refuse(corps, "24h", /kind : http \| atlas \| execution attendu/);
  });

  it.each([null, 3, {}, []])("refuse une opération qui n'est pas un texte : %j", (valeur) => {
    const corps = copie();
    premiere(corps).operation = valeur;
    refuse(corps);
  });

  it.each([3, {}, true])("refuse une méthode qui n'est ni un texte ni nulle : %j", (valeur) => {
    const corps = copie();
    premiere(corps).method = valeur;
    refuse(corps);
  });

  it("refuse des opérations qui ne sont pas une liste", () => {
    refuse({ ...copie(), operations: {} });
    refuse({ ...copie(), operations: null });
    refuse({ ...copie(), operations: [null] });
  });

  it.each(["count", "errors", "refusals"])("« %s » : entier positif ou nul, rien d'autre", (champ) => {
    for (const valeur of [-1, 1.5, "1", null, true, Number.NaN, Number.POSITIVE_INFINITY]) {
      const corps = copie();
      premiere(corps)[champ] = valeur;
      refuse(corps, "24h", new RegExp(`operations\\[0\\]\\.${champ} : entier`));
    }
  });

  it.each(["p50", "p95", "max"])("duration_ms.%s : nombre fini et positif", (champ) => {
    for (const valeur of [-0.1, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "12", null, true]) {
      const corps = copie();
      premiere(corps).duration_ms[champ] = valeur;
      refuse(corps, "24h", new RegExp(`duration_ms\\.${champ} : nombre positif attendu`));
    }
  });

  it("une durée nulle ou à virgule est acceptée", () => {
    const corps = copie();
    Object.assign(premiere(corps).duration_ms, { p50: 0, p95: 0.05, max: 1e6 });
    expect(decodeSummary(corps, "24h").operations[0]?.duration).toEqual({ p50: 0, p95: 0.05, max: 1e6 });
  });

  it.each(["size", "rows"])("%s.p50 : nombre positif ou nul (une médiane peut tomber entre deux)", (bloc) => {
    const corps = copie();
    premiere(corps)[bloc] = { p50: 412.5, max: 413 };
    expect(decodeSummary(corps, "24h").operations[0]?.[bloc as "size" | "rows"]).toEqual({ p50: 412.5, max: 413 });
    for (const valeur of [-1, Number.NaN, Number.POSITIVE_INFINITY, "412"]) {
      const autre = copie();
      premiere(autre)[bloc] = { p50: valeur, max: 413 };
      refuse(autre, "24h", new RegExp(`${bloc}\\.p50 : nombre positif attendu`));
    }
  });

  it.each(["size", "rows"])("%s.max : entier positif ou nul, ou nul", (bloc) => {
    const corps = copie();
    premiere(corps)[bloc] = { p50: 0, max: 0 };
    expect(decodeSummary(corps, "24h").operations[0]?.[bloc as "size" | "rows"]).toEqual({ p50: 0, max: 0 });
    for (const valeur of [-1, 430.5, "430", Number.NaN, true]) {
      const autre = copie();
      premiere(autre)[bloc] = { p50: 1, max: valeur };
      refuse(autre, "24h", new RegExp(`${bloc}\\.max : entier`));
    }
  });

  it.each(["size", "rows"])("%s : objet attendu", (bloc) => {
    const corps = copie();
    premiere(corps)[bloc] = null;
    refuse(corps, "24h", new RegExp(`${bloc} : objet attendu`));
  });

  it("refuse des erreurs ou des refus plus nombreux que les mesures, accepte l'égalité", () => {
    for (const champ of ["errors", "refusals"]) {
      const corps = copie();
      premiere(corps)[champ] = 6;
      refuse(corps, "24h", /operations\[0\] : erreurs et refus au plus égaux aux mesures/);
    }
    const plein = copie();
    Object.assign(premiere(plein), { errors: 5, refusals: 5 });
    expect(decodeSummary(plein, "24h").operations[0]).toMatchObject({ count: 5, errors: 5, refusals: 5 });
    // L'opération en cause est nommée par son rang.
    const troisieme = copie();
    Object.assign(troisieme.operations[2] as Brut, { refusals: 3 });
    refuse(troisieme, "24h", /operations\[2\]/);
  });

  it("ne garde aucun champ hors contrat : ni sujet, ni courriel, ni chemin", () => {
    const corps = copie();
    Object.assign(corps, { subject: "00u9admin", email: "alix@ex.invalid" });
    Object.assign(premiere(corps), { path: "/api/spaces/finance/members", subject: "00u9admin", space: "finance" });
    const resume = decodeSummary(corps, "24h");
    expect(Object.keys(resume).sort()).toEqual(["end", "operations", "period", "start", "window"]);
    expect(Object.keys(resume.operations[0] ?? {}).sort()).toEqual(["count", "duration", "errors", "kind", "method", "operation", "refusals", "rows", "size"]);
    expect(JSON.stringify(resume)).not.toMatch(/00u9admin|alix|finance/);
  });
});

describe("decodeSummary : période et opérations vont ensemble", () => {
  it("refuse une période sans opérations", () => {
    refuse({ ...vide.body, oldest: "2026-11-03T06:56:00+00:00", newest: "2026-11-03T11:56:00+00:00" }, "24h", /période et opérations attendues ensemble/);
  });

  it("refuse des opérations sans période, ou avec une période à moitié", () => {
    refuse({ ...copie(), oldest: null, newest: null }, "24h", /période et opérations attendues ensemble/);
    refuse({ ...copie(), oldest: null }, "24h", /période et opérations attendues ensemble/);
    refuse({ ...copie(), newest: null }, "24h", /période et opérations attendues ensemble/);
  });

  // Les deux bornes de la période vont ensemble, même sans opération.
  it("refuse une période à moitié sans opération", () => {
    refuse({ ...vide.body, oldest: "2026-11-03T06:56:00+00:00" }, "24h");
  });

  it("refuse une période à moitié sans opération (plus récente seule)", () => {
    refuse({ ...vide.body, newest: "2026-11-03T11:56:00+00:00" }, "24h");
  });
});

describe("decodeSummary : bornes dans l'ordre", () => {
  const avecDurees = (p50: number, p95: number, max: number) => {
    const corps = copie();
    premiere(corps).duration_ms = { p50, p95, max };
    return corps;
  };

  it("refuse une fenêtre dont le début suit la fin ; l'égalité est acceptée", () => {
    refuse({ ...copie(), start: "2026-11-03T12:00:00.001+00:00" }, "24h", /début de fenêtre avant sa fin attendu/);
    refuse({ ...vide.body, start: "2026-11-04T12:00:00+00:00" }, "24h", /début de fenêtre avant sa fin attendu/);
    // Même instant écrit dans deux fuseaux : égal, donc accepté.
    const egal = decodeSummary({ ...copie(), start: "2026-11-03T13:00:00+01:00" }, "24h");
    expect(egal.start).toEqual(egal.end);
  });

  it("refuse une plus ancienne mesure postérieure à la plus récente ; l'égalité est acceptée", () => {
    refuse({ ...copie(), oldest: "2026-11-03T11:56:00.001+00:00" }, "24h", /plus ancienne mesure avant la plus récente attendue/);
    const egal = decodeSummary({ ...copie(), oldest: "2026-11-03T11:56:00+00:00" }, "24h");
    expect(egal.period).toEqual({ oldest: new Date("2026-11-03T11:56:00Z"), newest: new Date("2026-11-03T11:56:00Z") });
  });

  it("refuse une médiane au-dessus du p95 ; l'égalité est acceptée", () => {
    refuse(avecDurees(80.3, 80.2, 95), "24h", /operations\[0\]\.duration_ms : médiane, p95 et maximum dans cet ordre attendus/);
    expect(decodeSummary(avecDurees(80.2, 80.2, 95), "24h").operations[0]?.duration).toEqual({ p50: 80.2, p95: 80.2, max: 95 });
  });

  it("refuse un p95 au-dessus du maximum ; l'égalité est acceptée", () => {
    refuse(avecDurees(14, 95.0001, 95), "24h", /duration_ms : médiane, p95 et maximum dans cet ordre attendus/);
    refuse(avecDurees(96, 96, 95), "24h", /dans cet ordre attendus/);
    expect(decodeSummary(avecDurees(14, 95, 95), "24h").operations[0]?.duration).toEqual({ p50: 14, p95: 95, max: 95 });
    expect(decodeSummary(avecDurees(0, 0, 0), "24h").operations[0]?.duration).toEqual({ p50: 0, p95: 0, max: 0 });
  });

  it("nomme l'opération en cause par son rang", () => {
    const corps = copie();
    (corps.operations[3] as Corps["operations"][number]).duration_ms = { p50: 3, p95: 2, max: 2 };
    refuse(corps, "24h", /operations\[3\]\.duration_ms/);
  });

  it("les exemples du serveur respectent tous ces ordres", () => {
    for (const [exemple, fenetre] of [[lecture, "24h"], [lecture7j, "7d"], [vide, "24h"]] as const) {
      expect(() => decodeSummary(exemple.body, fenetre)).not.toThrow();
    }
  });
});

describe("byP95", () => {
  it("range les plus lentes d'abord", () => {
    const rangees = byP95([operation("a", 2), operation("b", 80.2), operation("c", 0), operation("d", 50.3)]);
    expect(rangees.map((found) => found.operation)).toEqual(["b", "d", "a", "c"]);
  });

  it("garde l'ordre du serveur à p95 égal, même au milieu d'un désordre", () => {
    const rangees = byP95([operation("z", 2), operation("a", 2), operation("m", 9), operation("b", 2), operation("y", 9)]);
    expect(rangees.map((found) => found.operation)).toEqual(["m", "y", "z", "a", "b"]);
  });

  it("ne trie pas sur la médiane ni sur le maximum", () => {
    const lente = operation("lente", 10, { duration: { p50: 1, p95: 10, max: 11 } });
    const pointue = operation("pointue", 5, { duration: { p50: 4, p95: 5, max: 900 } });
    expect(byP95([pointue, lente]).map((found) => found.operation)).toEqual(["lente", "pointue"]);
  });

  it("rend une nouvelle liste sans toucher à celle reçue", () => {
    const recue = [operation("a", 1), operation("b", 2)];
    const rangees = byP95(recue);
    expect(rangees).not.toBe(recue);
    expect(recue.map((found) => found.operation)).toEqual(["a", "b"]);
    expect(byP95([])).toEqual([]);
  });

  it("range les exemples du serveur comme le serveur", () => {
    const resume = decodeSummary(lecture7j.body, "7d");
    expect(byP95(resume.operations).map((found) => found.operation)).toEqual(resume.operations.map((found) => found.operation));
  });
});

describe("formatDuration", () => {
  it.each([
    [80.19999999999999, "80,2"],
    [14, "14,0"],
    [0, "0,0"],
    [0.04, "0,0"],
    [2.5, "2,5"],
    [1234.56, "1 234,6"],
    [95, "95,0"],
  ])("%s ms → « %s »", (valeur, attendu) => {
    expect(plain(formatDuration(valeur))).toBe(attendu);
  });
});

describe("formatSize", () => {
  it.each([
    [null, MISSING],
    [0, "0 o"],
    [412, "412 o"],
    [1023, "1 023 o"],
    [1024, "1,0 kio"],
    [1536, "1,5 kio"],
    [3584, "3,5 kio"],
    [1024 * 1024, "1,0 Mio"],
    [1572864, "1,5 Mio"],
    [5 * 1024 * 1024 * 1024, "5 120,0 Mio"],
  ] as [number | null, string][])("%s o → « %s »", (valeur, attendu) => {
    expect(plain(formatSize(valeur))).toBe(attendu);
  });

  it("une médiane à virgule sous 1 kio s'arrondit à l'octet", () => {
    expect(plain(formatSize(412.4))).toBe("412 o");
    expect(plain(formatSize(412.5))).toBe("413 o");
  });

  it("l'unité est séparée par une espace insécable", () => {
    expect(formatSize(412)).toBe("412\u00a0o");
    expect(formatSize(1536)).toBe("1,5\u00a0kio");
    expect(formatSize(1572864)).toBe("1,5\u00a0Mio");
  });

  // Comme pour `formatAmount`, un arrondi qui atteint l'unité supérieure y passe.
  it("un arrondi qui atteint l'unité supérieure y passe (kio → Mio)", () => {
    expect(plain(formatSize(1024 * 1024 - 1))).toBe("1,0 Mio");
  });

  it("un arrondi qui atteint l'unité supérieure y passe (o → kio)", () => {
    expect(plain(formatSize(1023.6))).toBe("1,0 kio");
  });
});

describe("formatSize : passage d'unité au voisinage des bornes", () => {
  it.each([
    [1023.4, "1 023 o"],
    [1023.5, "1,0 kio"],
    [1024 * 1024 - 52, "1 023,9 kio"],
    [1024 * 1024 - 51, "1,0 Mio"],
    [1024 * 1024 - 0.5, "1,0 Mio"],
  ] as [number, string][])("%s o → « %s »", (valeur, attendu) => {
    expect(plain(formatSize(valeur))).toBe(attendu);
  });

  it("jamais « 1 024 o » ni « 1 024,0 kio », quelle que soit la valeur près des bornes", () => {
    const vues: string[] = [];
    for (let valeur = 1000; valeur <= 1100; valeur += 0.05) vues.push(plain(formatSize(valeur)));
    for (let valeur = 1024 * 1024 - 200; valeur <= 1024 * 1024 + 200; valeur += 0.37) vues.push(plain(formatSize(valeur)));
    expect(vues.filter((vue) => vue.startsWith("1 024"))).toEqual([]);
  });
});

describe("formatCount", () => {
  it.each([
    [null, MISSING],
    [0, "0"],
    [48, "48"],
    [1234, "1 234"],
    [2.5, "2,5"],
    [47.5, "47,5"],
    [0.25, "0,3"],
  ] as [number | null, string][])("%s → « %s »", (valeur, attendu) => {
    expect(plain(formatCount(valeur))).toBe(attendu);
  });
});

describe("libellés", () => {
  it("trois fenêtres, dans l'ordre, chacune dite en abrégé et en toutes lettres", () => {
    expect(WINDOWS).toEqual(["24h", "7d", "30d"]);
    expect(WINDOWS.map((fenetre) => WINDOW_LABELS[fenetre])).toEqual(["24 h", "7 j", "30 j"]);
    expect(WINDOWS.map((fenetre) => WINDOW_SPANS[fenetre])).toEqual(["les dernières 24 heures", "les 7 derniers jours", "les 30 derniers jours"]);
    expect(KIND_LABELS).toEqual({ http: "Requête de l'API", atlas: "Lecture d'Atlas", execution: "Exécution sémantique" });
  });
});
