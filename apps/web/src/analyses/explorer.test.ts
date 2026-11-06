import { describe, expect, it } from "vitest";
import { loadYaml } from "../test/yaml";
import { decodeAnalysis, decodeAnalysisDraft, type AnalysisDocument } from "./document";
import { contextualBlockers, draftFromExplorer, explorerFromAnalysis, fingerprint, openability, openedFrom, saveRight, selectionCalculs, UNSAVED, type ExplorerState, type Meta } from "./explorer";
import type { AnalysisRevision } from "./model";
import { CATALOG, draftOf, fixtures, route, ID } from "./testing";

const document = (name: string) => decodeAnalysis(loadYaml(fixtures("valid").find((item) => item.name === name)?.text ?? ""));
const metaOf = (analysis: AnalysisDocument): Meta => ({ name: analysis.name, description: analysis.description, visibility: analysis.visibility });
const state = (over: Partial<ExplorerState> = {}): ExplorerState => ({ connection: "finance", model: "sales", metrics: ["revenue"], dimensions: [], filters: [], genre: "valeur", calculs: false, ...over });
const meta: Meta = { name: "Ventes", description: "", visibility: "personal" };
const reasonOf = (built: ReturnType<typeof draftFromExplorer>): string => (built.status === "invalid" ? built.reason : "");
const refusedBecause = (right: ReturnType<typeof saveRight>): string => (right.allowed ? "" : right.reason);
const reopened = (analysis: AnalysisDocument) => explorerFromAnalysis(analysis, CATALOG);

it("les calculs de sélection sont exactement le total puis la part du résultat chargé de chaque métrique", () => {
  expect(selectionCalculs(["revenue", "orders"])).toEqual([
    { operation: "aggregate", metric: "revenue", group_by: [], scope: null },
    { operation: "share", metric: "revenue", group_by: [], denominator: "loaded_result" },
    { operation: "aggregate", metric: "orders", group_by: [], scope: null },
    { operation: "share", metric: "orders", group_by: [], denominator: "loaded_result" },
  ]);
  expect(selectionCalculs([])).toEqual([]);
});

describe("aller-retour avec les exemples de contracts/analyses/", () => {
  it("rouvre chaque fixture représentable puis la resauvegarde à l'identique", () => {
    for (const name of ["minimal", "personal-line"]) {
      const analysis = document(name);
      const opened = reopened(analysis);
      if (opened.status !== "ok") throw new Error(`${name} devrait s'ouvrir : ${opened.reasons.join(" ; ")}`);
      const built = draftFromExplorer(opened.state, metaOf(analysis), CATALOG.models);
      if (built.status !== "ok") throw new Error(built.reason);
      expect(built.draft).toEqual(decodeAnalysisDraft(draftOf(analysis)));
    }
  });

  it("garde le type de graphique par la seule table de chart.ts, dans les deux sens", () => {
    const line = reopened(document("personal-line"));
    expect(line.status === "ok" && line.state.genre).toBe("ligne");
    const built = draftFromExplorer(state({ genre: "groupees", dimensions: ["order_month", "region"] }), meta, CATALOG.models);
    expect(built.status === "ok" && built.draft.presentation.chart).toBe("grouped_bars");
  });

  it("rend indisponible un document aux calculs que l'Explorateur ne porte pas, avec une raison par calcul", () => {
    const complete = document("complete-shared");
    const result = reopened(complete);
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.reasons).toHaveLength(4);
    expect(result.reasons[0]).toContain("Calcul contextuel 1 (Agrégat de revenue par region");
    expect(result.reasons.join(" ")).toContain("périmètre filtré");
    expect(contextualBlockers(complete)).toEqual(result.reasons);
  });

  it("rouvre des calculs contextuels qui sont exactement le total et la part de chaque métrique, et les resauvegarde", () => {
    const base = document("complete-shared");
    const analysis: AnalysisDocument = { ...base, contextual: selectionCalculs(base.query.metrics) };
    const result = reopened(analysis);
    if (result.status !== "ok") throw new Error(result.reasons.join(" ; "));
    expect(result.state.calculs).toBe(true);
    expect(result.state.filters).toEqual(base.query.filters);
    const built = draftFromExplorer(result.state, metaOf(analysis), CATALOG.models);
    expect(built.status === "ok" && built.draft.contextual).toEqual(analysis.contextual);
    expect(built.status === "ok" && built.draft.contextual.map((step) => step.operation)).toEqual(["aggregate", "share", "aggregate", "share"]);
    expect(contextualBlockers(analysis)).toEqual([]);
  });

  it("un calcul de plus ou de moins que les deux par métrique n'est pas représentable", () => {
    const base = document("minimal");
    expect(contextualBlockers({ ...base, contextual: selectionCalculs(base.query.metrics).slice(0, 1) })).toHaveLength(1);
    expect(contextualBlockers({ ...base, contextual: [] })).toEqual([]);
  });
});

describe("de l'Explorateur vers un brouillon", () => {
  it("passe par le décodeur strict : filtres normalisés comme à l'exécution, calculs de sélection, graphique", () => {
    const built = draftFromExplorer(state({ model: "sales_orders", metrics: ["revenue", "orders"], dimensions: ["region"], genre: "barres", calculs: true, filters: [{ column: "region", operator: "in", value: ["Sud", "Nord"] }] }), { name: "Ventes", description: "Texte", visibility: "shared" }, CATALOG.models);
    expect(built).toMatchObject({ status: "ok", draft: { visibility: "shared", query: { filters: [{ column: "region", operator: "in", value: ["Nord", "Sud"] }] }, presentation: { chart: "bars" } } });
    expect(built.status === "ok" && built.draft.contextual).toHaveLength(4);
    expect(built.status === "ok" && built.unsaved).toBe(UNSAVED);
  });

  it("liste ce que le format ne garde pas, chacun avec sa raison", () => {
    expect(UNSAVED.map((item) => item.what)).toEqual(["Sélection de lignes ou de barres", "Résultat et données", "Environnement choisi dans la coque", "Thème d'affichage"]);
    for (const item of UNSAVED) expect(item.why.length).toBeGreaterThan(20);
  });

  it("n'envoie rien de ce qui n'est pas valide, avec la raison", () => {
    expect(draftFromExplorer(state({ model: "absent" }), meta, CATALOG.models)).toEqual({ status: "invalid", reason: "Le modèle choisi n'est pas dans le catalogue de l'Explorateur." });
    expect(reasonOf(draftFromExplorer(state({ metrics: [] }), meta, CATALOG.models))).toContain("au moins une métrique");
    expect(draftFromExplorer(state({ filters: [{ column: "order_month", operator: "eq", value: "2026-01-01" }] }), meta, CATALOG.models).status).toBe("invalid");
    expect(reasonOf(draftFromExplorer(state(), { ...meta, name: "" }, CATALOG.models))).toContain("analyse.name");
    expect(draftFromExplorer(state(), { ...meta, name: "x".repeat(121) }, CATALOG.models).status).toBe("invalid");
    expect(draftFromExplorer(state(), { ...meta, description: "a\u0000b" }, CATALOG.models).status).toBe("invalid");
  });
});

describe("d'un document vers l'Explorateur", () => {
  const base = document("minimal");
  const withQuery = (query: Partial<AnalysisDocument["query"]>): AnalysisDocument => ({ ...base, query: { ...base.query, ...query } });

  it("dit chaque référence que l'Explorateur n'offre pas", () => {
    expect(reopened(withQuery({ connection: "autre" }))).toEqual({ status: "unavailable", reasons: ["La connexion « autre » n'est pas offerte par l'Explorateur."] });
    expect(reopened(withQuery({ model: "absent" }))).toEqual({ status: "unavailable", reasons: ["Le modèle « absent » n'est pas dans le catalogue de l'Explorateur."] });
    expect(reopened(withQuery({ metrics: ["revenue", "inconnue"] }))).toEqual({ status: "unavailable", reasons: ["La métrique « inconnue » n'est pas offerte par le modèle « sales »."] });
    expect(reopened(withQuery({ dimensions: ["inconnue"] }))).toEqual({ status: "unavailable", reasons: ["La dimension « inconnue » n'est pas offerte par le modèle « sales »."] });
  });

  it("dit le filtre que l'Explorateur ne sait pas représenter, par son rang", () => {
    const result = reopened(withQuery({ filters: [{ column: "region", operator: "eq", value: "Nord" }, { column: "order_month", operator: "eq", value: "2026-01-01" }, { column: "region", operator: "gt", value: "A" }] }));
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.reasons).toHaveLength(2);
    expect(result.reasons[0]).toContain("Le filtre 2 (order_month eq)");
    expect(result.reasons[1]).toContain("Le filtre 3 (region gt)");
    expect(result.reasons[0]).toContain("SK-12");
  });

  it("rend l'état de l'Explorateur avec les filtres sous leur forme exécutable", () => {
    const result = reopened(withQuery({ metrics: ["revenue"], filters: [{ column: "region", operator: "in", value: ["Sud", "Nord"] }] }));
    expect(result).toMatchObject({ status: "ok", state: { connection: "finance", model: "sales", calculs: false, genre: "valeur", filters: [{ column: "region", operator: "in", value: ["Nord", "Sud"] }] } });
  });

  it("fait l'aller-retour des valeurs de `in` hors du plan multilingue de base, dans l'ordre du serveur (points de code)", () => {
    // `Ａ` (U+FF21) précède `𐐀` (U+10400) pour Python ; en unités UTF-16 le web les aurait rangés dans l'ordre inverse.
    const built = draftFromExplorer(state({ metrics: ["revenue"], filters: [{ column: "region", operator: "in", value: ["𐐀", "Ａ"] }] }), meta, CATALOG.models);
    if (built.status !== "ok") throw new Error(built.reason);
    expect(built.draft.query.filters).toEqual([{ column: "region", operator: "in", value: ["Ａ", "𐐀"] }]);
    const back = reopened({ ...base, query: { ...built.draft.query } });
    expect(back).toMatchObject({ status: "ok", state: { filters: [{ column: "region", operator: "in", value: ["Ａ", "𐐀"] }] } });
    // Relu dans l'ordre du serveur, et même lu dans l'ordre inverse, l'état rendu et le brouillon qui en repart portent le même ordre.
    const reversed = reopened({ ...base, query: { ...built.draft.query, filters: [{ column: "region", operator: "in", value: ["𐐀", "Ａ"] }] } });
    expect(reversed).toMatchObject({ status: "ok", state: { filters: [{ column: "region", operator: "in", value: ["Ａ", "𐐀"] }] } });
    if (back.status !== "ok") return;
    const again = draftFromExplorer(back.state, meta, CATALOG.models);
    expect(again.status === "ok" && again.draft.query.filters).toEqual(built.draft.query.filters);
  });

  it("ne dit les raisons du catalogue qu'une fois les noms résolus, sans en inventer sur les filtres", () => {
    const result = reopened(withQuery({ model: "absent", filters: [{ column: "region", operator: "eq", value: "Nord" }] }));
    expect(result).toMatchObject({ status: "unavailable", reasons: [expect.stringContaining("absent")] });
  });
});

describe("ouverture d'une révision lue", () => {
  const revision = (name: string, state: AnalysisRevision["state"] = "ready", currentRevision: number | null = 1) => ({ state, currentRevision, analysis: document(name) });

  it("dit pourquoi une révision ne s'ouvre pas, sans catalogue", () => {
    expect(openability(revision("minimal"))).toEqual([]);
    expect(openability(revision("minimal", "index_stale"))).toEqual([]);
    expect(openability(revision("minimal", "unverified"))[0]).toContain("État « Non vérifiée »");
    expect(openability(revision("minimal", "unresolved_reference"))[0]).toContain("État « Référence non résolue »");
    expect(openability(revision("minimal", "ready", null))).toEqual(["L'analyse est supprimée : aucune action n'est possible."]);
    const rich = openability(revision("complete-shared", "unresolved_reference", null));
    expect(rich).toHaveLength(6);
  });

  it("tire la référence, les droits et l'empreinte de la révision ouverte", () => {
    const body = (route("lire").body as { permissions: AnalysisRevision["permissions"] });
    const analysis = document("personal-line");
    const found = { id: ID, space: "finance", revision: 3, currentRevision: 3, commit: "c", committedAt: new Date(0), revisedBy: analysis.owner, state: "ready", unresolved: [], permissions: body.permissions, analysis } satisfies AnalysisRevision;
    const result = reopened(analysis);
    if (result.status !== "ok") throw new Error("ouvrable");
    const opened = openedFrom(found, result.state, CATALOG.models);
    expect(opened).toMatchObject({ id: ID, name: analysis.name, revision: 3, currentRevision: 3, model: "sales", permissions: body.permissions });
    expect(opened.baseline).toBe(fingerprint(draftFromExplorer(result.state, metaOf(analysis), CATALOG.models)));
    expect(fingerprint(draftFromExplorer({ ...result.state, genre: "barres" }, metaOf(analysis), CATALOG.models))).not.toBe(opened.baseline);
    expect(fingerprint(draftFromExplorer(result.state, { ...metaOf(analysis), name: "Autre" }, CATALOG.models))).toBe(opened.baseline);
    expect(fingerprint({ status: "invalid", reason: "x" })).toBeNull();
  });
});

describe("droit de sauvegarder", () => {
  it("n'accorde qu'aux rôles creator et admin d'un espace réel, et dit pourquoi sinon", () => {
    expect(saveRight({ role: "creator", implicit: false })).toEqual({ allowed: true });
    expect(saveRight({ role: "admin", implicit: false })).toEqual({ allowed: true });
    expect(refusedBecause(saveRight({ role: "reader", implicit: false }))).toContain("reader");
    expect(refusedBecause(saveRight({ role: null, implicit: false }))).toContain("aucun rôle");
    expect(refusedBecause(saveRight({ role: "admin", implicit: true }))).toContain("mode local");
  });
});
