import { afterEach, describe, expect, it, vi } from "vitest";
import nonMembre from "../../../../contracts/executions/champs-non-membre.json";
import { onSessionLost } from "../identity/session";
import type { AdminOutcome } from "../spaces/admin";
import type { Fetch } from "../spaces/api";
import { onSpaceLost } from "../spaces/lost";
import { createAnalysis, deleteAnalysis, duplicateAnalysis, fetchAnalyses, fetchAnalysis, fetchAnalysisRevision, fetchDiff, fetchHistory, fetchLastExecution, fetchUsage, openAnalysis, reviseAnalysis } from "./client";
import { decodeAnalysisDraft, type AnalysisDraft } from "./document";
import { newEventId } from "./reference";
import { ANALYSIS_CODES, ANALYSIS_REFUSALS, SHARED_CODES } from "./refusal";
import { bodyOf, changed, draftOf, ID, OTHER_ID, ROUTE_NAMES, reply, route, type Exemple } from "./testing";

const EVENT = "1a2b3c4d-1111-4111-8111-5e6f7a8b9c0d";
const signal = () => new AbortController().signal;
const serving = (example: Exemple) => vi.fn<Fetch>().mockImplementation(() => Promise.resolve(reply(example)));
const lire = route("lire").body as { analysis: Record<string, unknown> };
const draft = draftOf(lire.analysis) as unknown as AnalysisDraft;
const GET = { method: "GET", headers: { Accept: "application/json" } };
const POST = { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" } };
const URL = `/api/spaces/finance/analyses/${ID}`;

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function errorIncludes(outcome: AdminOutcome<unknown>, fragment: string): void {
  expect(outcome.status).toBe("error");
  if (outcome.status === "error") expect(outcome.message).toContain(fragment);
}

describe("routes de lecture", () => {
  it("liste les analyses", async () => {
    const fetcher = serving(route("lister"));
    const abort = signal();
    expect(await fetchAnalyses("finance", abort, fetcher)).toMatchObject({ status: "ok", value: { unreadable: 0, analyses: [{ id: ID, state: "indexed" }] } });
    expect(fetcher).toHaveBeenCalledWith("/api/spaces/finance/analyses", { ...GET, signal: abort });
    await fetchAnalyses("a/b", abort, serving(route("lister")));
    errorIncludes(await fetchAnalyses("finance", abort, serving({ status: 200, body: { analyses: [], unreadable: 0, extra: 1 } })), "hors contrat");
    errorIncludes(await fetchAnalyses("finance", abort, serving({ status: 201, body: route("lister").body })), "HTTP 200");
  });

  it("refuse une réponse dont un entier serait arrondi par JSON.parse, sans l'afficher", async () => {
    const abort = signal();
    const withValue = (literal: string) => {
      const text = JSON.stringify({ ...lire, analysis: { ...lire.analysis, query: { ...(lire.analysis.query as object), filters: [{ column: "region", operator: "eq", value: 1 }] } } }, null, 1).replace(/"value": 1\b/, `"value": ${literal}`);
      return vi.fn<Fetch>().mockImplementation(() => Promise.resolve(new Response(text, { status: 200 })));
    };
    // Le littéral est repris du texte source : `9007199254740993` serait déjà `9007199254740992` après JSON.parse.
    errorIncludes(await fetchAnalysis("finance", ID, abort, withValue("9007199254740993")), "unsafe_integer");
    errorIncludes(await fetchAnalysis("finance", ID, abort, withValue("1e19")), "hors contrat");
    errorIncludes(await fetchAnalysis("finance", ID, abort, withValue("10000000000000000000")), "unsafe_integer");
    for (const literal of ["9007199254740991", "-9007199254740991", "1.5", "0.1"]) {
      const found = await fetchAnalysis("finance", ID, abort, withValue(literal));
      expect(found, literal).toMatchObject({ status: "ok", value: { analysis: { query: { filters: [{ value: Number(literal) }] } } } });
    }
  });

  it("lit la révision courante, numérotée, l'historique, l'écart et l'usage", async () => {
    const abort = signal();
    const current = serving(route("lire"));
    expect(await fetchAnalysis("finance", ID, abort, current)).toMatchObject({ status: "ok", value: { id: ID, revision: 1, currentRevision: 1, state: "ready" } });
    expect(current).toHaveBeenCalledWith(URL, { ...GET, signal: abort });
    const numbered = serving(route("revision"));
    expect(await fetchAnalysisRevision("finance", ID, 1, abort, numbered)).toMatchObject({ status: "ok", value: { revision: 1, currentRevision: 2 } });
    expect(numbered).toHaveBeenCalledWith(`${URL}/revisions/1`, { ...GET, signal: abort });
    expect(await fetchAnalysisRevision("finance", ID, 1, abort, serving(route("revision-supprimee")))).toMatchObject({ status: "ok", value: { currentRevision: null } });
    const history = serving(route("historique-revision-masquee"));
    expect(await fetchHistory("finance", ID, abort, history)).toMatchObject({ status: "ok", value: { revisions: [{ available: false }, { available: true }] } });
    expect(history).toHaveBeenCalledWith(`${URL}/revisions`, { ...GET, signal: abort });
    const diff = serving(route("ecart"));
    expect(await fetchDiff("finance", ID, 1, 2, abort, diff)).toMatchObject({ status: "ok", value: { changes: [{ path: "/name", kind: "modified" }] } });
    expect(diff).toHaveBeenCalledWith(`${URL}/diff?base=1&other=2`, { ...GET, signal: abort });
    const usage = serving(route("usage"));
    expect(await fetchUsage("finance", ID, abort, usage)).toMatchObject({ status: "ok", value: { saved: { total: 1 } } });
    expect(usage).toHaveBeenCalledWith(`${URL}/usage`, { ...GET, signal: abort });
  });

  it("lit la dernière exécution de la session : trouvée, refusée par le moteur, ou aucune", async () => {
    const abort = signal();
    const found = serving(route("derniere-execution"));
    const outcome = await fetchLastExecution("finance", ID, abort, found);
    expect(outcome).toMatchObject({ status: "ok", value: { id: ID, last: { revision: 1, execution: { state: "succeeded", errorCode: null, rows: 1 } } } });
    expect(outcome.status === "ok" ? outcome.value.last?.execution.proof?.sqlHash : null).toMatch(/^sha256:v1:/);
    expect(found).toHaveBeenCalledWith(`${URL}/last-execution`, { ...GET, signal: abort });
    // Un refus du moteur reste un refus : jamais une exécution réussie, ni une preuve inventée.
    const denied = await fetchLastExecution("finance", ID, abort, serving(route("derniere-execution-refusee")));
    expect(denied).toMatchObject({ status: "ok", value: { last: { revision: 1, execution: { state: "denied", errorCode: "deny", rows: null, proof: null } } } });
    expect(await fetchLastExecution("finance", ID, abort, serving(route("derniere-execution-aucune")))).toEqual({ status: "ok", value: { id: ID, last: null } });
  });

  it("refuse une dernière exécution hors contrat ou qui n'est pas celle qu'on a demandée", async () => {
    const abort = signal();
    errorIncludes(await fetchLastExecution("finance", OTHER_ID, abort, serving(route("derniere-execution"))), "hors contrat");
    errorIncludes(await fetchLastExecution("autre", ID, abort, serving(route("derniere-execution"))), "hors contrat");
    errorIncludes(await fetchLastExecution("finance", ID, abort, serving({ status: 201, body: route("derniere-execution").body })), "HTTP 200");
    errorIncludes(await fetchLastExecution("finance", ID, abort, serving({ status: 202, body: route("derniere-execution").body })), "HTTP 200");
    errorIncludes(await fetchLastExecution("finance", "x", abort, serving(route("derniere-execution"))), "identifiant d'analyse");
    errorIncludes(await fetchLastExecution("finance", ID, abort, serving({ status: 200, body: changed(route("derniere-execution").body, "execution.state", "denied") })), "hors contrat");
    // Un entier arrondi par JSON.parse n'est pas lu : la réponse est refusée sans être affichée.
    const text = JSON.stringify(route("derniere-execution").body).replace('"rows":1', '"rows":9007199254740993');
    const lossy = vi.fn<Fetch>().mockImplementation(() => Promise.resolve(new Response(text, { status: 200 })));
    errorIncludes(await fetchLastExecution("finance", ID, abort, lossy), "unsafe_integer");
  });

  it("refuse une réponse qui n'est pas celle qu'on a demandée", async () => {
    const abort = signal();
    errorIncludes(await fetchAnalysis("finance", OTHER_ID, abort, serving(route("lire"))), "révision courante");
    errorIncludes(await fetchAnalysis("finance", ID, abort, serving(route("revision"))), "révision courante");
    errorIncludes(await fetchAnalysis("autre", ID, abort, serving(route("lire"))), "hors contrat");
    errorIncludes(await fetchAnalysisRevision("finance", ID, 2, abort, serving(route("revision"))), "révision demandée");
    errorIncludes(await fetchAnalysisRevision("finance", OTHER_ID, 1, abort, serving(route("revision"))), "révision demandée");
    errorIncludes(await fetchHistory("finance", OTHER_ID, abort, serving(route("historique"))), "hors contrat");
    errorIncludes(await fetchDiff("finance", ID, 1, 3, abort, serving(route("ecart"))), "hors contrat");
    errorIncludes(await fetchUsage("finance", OTHER_ID, abort, serving(route("usage"))), "hors contrat");
    for (const call of [
      (fetcher: Fetch) => fetchAnalysis("finance", ID, abort, fetcher), (fetcher: Fetch) => fetchAnalysisRevision("finance", ID, 1, abort, fetcher),
      (fetcher: Fetch) => fetchHistory("finance", ID, abort, fetcher), (fetcher: Fetch) => fetchDiff("finance", ID, 1, 2, abort, fetcher), (fetcher: Fetch) => fetchUsage("finance", ID, abort, fetcher),
    ]) {
      errorIncludes(await call(serving({ status: 201, body: route("lire").body })), "HTTP 200");
    }
  });

  it("n'appelle pas le serveur avec un identifiant ou un numéro invalide", async () => {
    const fetcher = serving(route("lire"));
    const abort = signal();
    errorIncludes(await fetchAnalysis("finance", "pas-un-uuid", abort, fetcher), "identifiant d'analyse");
    errorIncludes(await fetchAnalysis("finance", ID.toUpperCase(), abort, fetcher), "identifiant d'analyse");
    errorIncludes(await fetchAnalysisRevision("finance", "../x", 1, abort, fetcher), "identifiant d'analyse");
    for (const number of [0, -1, 1.5, Number.NaN, 1_000_000_000]) {
      errorIncludes(await fetchAnalysisRevision("finance", ID, number, abort, fetcher), "numéro de révision");
      errorIncludes(await fetchDiff("finance", ID, number, 1, abort, fetcher), "numéro de révision");
      errorIncludes(await fetchDiff("finance", ID, 1, number, abort, fetcher), "numéro de révision");
    }
    errorIncludes(await fetchHistory("finance", "x", abort, fetcher), "identifiant d'analyse");
    errorIncludes(await fetchUsage("finance", "x", abort, fetcher), "identifiant d'analyse");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("routes d'écriture", () => {
  it("crée une analyse : seuls les champs du document partent, rien d'autre", async () => {
    const fetcher = serving(route("creer"));
    const outcome = await createAnalysis("finance", draft, fetcher);
    expect(outcome).toMatchObject({ status: "ok", value: { revision: 1, currentRevision: 1, permissions: { owner: true } } });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("/api/spaces/finance/analyses");
    expect(init).toEqual({ ...POST, body: JSON.stringify(draft) });
    expect(Object.keys(JSON.parse(bodyOf(fetcher)) as object)).toEqual(["name", "description", "visibility", "query", "contextual", "presentation"]);
    errorIncludes(await createAnalysis("finance", draft, serving({ ...route("creer"), status: 200 })), "HTTP 201");
    errorIncludes(await createAnalysis("finance", draft, serving(route("reviser"))), "première révision");
  });

  it("refuse localement une analyse invalide, sans appeler le serveur", async () => {
    const fetcher = serving(route("creer"));
    for (const bad of [{ ...draft, sql: "SELECT 1" } as unknown as AnalysisDraft, { ...draft, owner: { issuer: "a", subject: "b" } }, { ...draft, id: ID }, { ...draft, name: "" }, changed(draft, "query.environment", "prod")]) {
      errorIncludes(await createAnalysis("finance", bad, fetcher), "invalide");
      errorIncludes(await reviseAnalysis("finance", ID, bad, 1, fetcher), "invalide");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("révise avec la révision attendue : 201 pour une nouvelle révision, 200 pour un contenu identique", async () => {
    const created = serving(route("reviser"));
    const outcome = await reviseAnalysis("finance", ID, { ...draft, name: "Révisée" }, 1, created);
    expect(outcome).toMatchObject({ status: "ok", value: { unchanged: false, revision: { revision: 2, currentRevision: 2, permissions: { revise: true } } } });
    const [url, init] = created.mock.calls[0] ?? [];
    expect(url).toBe(`${URL}/revisions`);
    expect(init).toEqual({ ...POST, body: JSON.stringify({ ...decodeAnalysisDraft({ ...draft, name: "Révisée" }), expected_revision: 1 }) });
    expect(Object.keys(JSON.parse(bodyOf(created)) as object).at(-1)).toBe("expected_revision");
    expect(await reviseAnalysis("finance", ID, draft, 2, serving(route("reviser-identique")))).toMatchObject({ status: "ok", value: { unchanged: true, revision: { revision: 2 } } });
    // Le statut et le numéro doivent s'accorder : 201 sans nouveau numéro, 200 avec un nouveau numéro sont hors contrat.
    errorIncludes(await reviseAnalysis("finance", ID, draft, 2, serving(route("reviser"))), "révision attendue");
    errorIncludes(await reviseAnalysis("finance", ID, draft, 1, serving(route("reviser-identique"))), "révision attendue");
    errorIncludes(await reviseAnalysis("finance", OTHER_ID, draft, 1, serving(route("reviser"))), "révision attendue");
    errorIncludes(await reviseAnalysis("finance", ID, draft, 1, serving({ status: 202, body: route("reviser").body })), "HTTP 200 ou 201");
    errorIncludes(await reviseAnalysis("finance", ID, draft, 1, serving({ status: 201, body: changed(route("reviser").body, "current_revision", 3) })), "révision attendue");
    errorIncludes(await reviseAnalysis("finance", "x", draft, 1, serving(route("reviser"))), "identifiant d'analyse");
    errorIncludes(await reviseAnalysis("finance", ID, draft, 0, serving(route("reviser"))), "numéro de révision");
  });

  it("duplique en copie personnelle de l'appelant, avec ou sans nom", async () => {
    const plain = serving(route("dupliquer"));
    const copy = await duplicateAnalysis("finance", OTHER_ID, undefined, plain);
    expect(copy).toMatchObject({ status: "ok", value: { id: ID, revision: 1, analysis: { visibility: "personal" }, permissions: { owner: true } } });
    expect(plain).toHaveBeenCalledWith(`/api/spaces/finance/analyses/${OTHER_ID}/duplicate`, { method: "POST", headers: { Accept: "application/json" } });
    const named = serving(route("dupliquer-nommee"));
    expect(await duplicateAnalysis("finance", OTHER_ID, "Copie nommée", named)).toMatchObject({ status: "ok", value: { analysis: { name: "Copie nommée" } } });
    expect(named).toHaveBeenCalledWith(`/api/spaces/finance/analyses/${OTHER_ID}/duplicate`, { ...POST, body: JSON.stringify({ name: "Copie nommée" }) });
    // La copie a une autre identité, une première révision, et reste personnelle.
    errorIncludes(await duplicateAnalysis("finance", ID, undefined, serving(route("dupliquer"))), "copie personnelle");
    errorIncludes(await duplicateAnalysis("finance", OTHER_ID, undefined, serving(route("reviser"))), "copie personnelle");
    errorIncludes(await duplicateAnalysis("finance", OTHER_ID, undefined, serving({ ...route("lire"), status: 201 })), "copie personnelle");
    errorIncludes(await duplicateAnalysis("finance", OTHER_ID, undefined, serving(changed(route("dupliquer"), "body.analysis.visibility", "shared"))), "copie personnelle");
    errorIncludes(await duplicateAnalysis("finance", OTHER_ID, undefined, serving({ ...route("dupliquer"), status: 200 })), "HTTP 201");
    const none = serving(route("dupliquer"));
    errorIncludes(await duplicateAnalysis("finance", OTHER_ID, "", none), "nom de la copie");
    errorIncludes(await duplicateAnalysis("finance", OTHER_ID, "a\nb", none), "nom de la copie");
    errorIncludes(await duplicateAnalysis("finance", "x", undefined, none), "identifiant d'analyse");
    expect(none).not.toHaveBeenCalled();
  });

  it("supprime avec la révision attendue dans l'adresse", async () => {
    const fetcher = serving(route("supprimer"));
    expect(await deleteAnalysis("finance", ID, 2, fetcher)).toEqual({ status: "ok", value: null });
    expect(fetcher).toHaveBeenCalledWith(`${URL}?expected_revision=2`, { method: "DELETE", headers: { Accept: "application/json" } });
    errorIncludes(await deleteAnalysis("finance", ID, 2, serving({ status: 200, body: {} })), "HTTP 204");
    errorIncludes(await deleteAnalysis("finance", "x", 2, fetcher), "identifiant d'analyse");
    errorIncludes(await deleteAnalysis("finance", ID, 0, fetcher), "numéro de révision");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("consigne une ouverture avec un identifiant d'événement UUID tiré côté client", async () => {
    const fetcher = serving(route("ouvrir"));
    expect(await openAnalysis("finance", ID, 3, EVENT, fetcher)).toEqual({ status: "ok", value: { recorded: true } });
    expect(fetcher).toHaveBeenCalledWith(`${URL}/opened`, { ...POST, body: JSON.stringify({ event_id: EVENT, revision: 3 }) });
    expect(await openAnalysis("finance", ID, 3, EVENT, serving(route("ouvrir-non-enregistree")))).toEqual({ status: "ok", value: { recorded: false } });
    const generated = serving(route("ouvrir"));
    await openAnalysis("finance", ID, 1, undefined, generated);
    const sent = JSON.parse(bodyOf(generated)) as { event_id: string };
    expect(sent.event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newEventId()).not.toBe(newEventId());
    errorIncludes(await openAnalysis("finance", ID, 3, EVENT, serving({ status: 200, body: route("ouvrir").body })), "HTTP 202");
    errorIncludes(await openAnalysis("finance", ID, 3, EVENT, serving({ status: 202, body: { recorded: "oui" } })), "hors contrat");
    const none = serving(route("ouvrir"));
    for (const bad of ["", "x", EVENT.toUpperCase(), `${EVENT}\n`]) errorIncludes(await openAnalysis("finance", ID, 3, bad, none), "identifiant d'événement");
    errorIncludes(await openAnalysis("finance", "x", 3, EVENT, none), "identifiant d'analyse");
    errorIncludes(await openAnalysis("finance", ID, 0, EVENT, none), "numéro de révision");
    expect(none).not.toHaveBeenCalled();
  });
});

describe("refus", () => {
  const noExtra = { field: null };
  // Chaque refus des contrats d'exemple, avec ce que le client en rend.
  const REFUSALS: readonly (readonly [string, number, string, Record<string, unknown>])[] = [
    ["refus-analyse-inconnue", 404, "analysis_not_found", noExtra],
    ["refus-analyse-invalide", 422, "invalid_analysis", { field: null, reason: "unknown_model", violations: [{ path: "/query/model", rule: "unknown_model" }] }],
    ["refus-analyse-utilisee", 409, "analysis_in_use", { field: null, consumers: [{ kind: "dashboard", id: ID }] }],
    ["refus-champ-reserve", 422, "invalid_analysis", { field: null, reason: "field_not_allowed", violations: [{ path: "/owner", rule: "field_not_allowed" }] }],
    ["refus-depot-indisponible", 503, "content_unavailable", noExtra],
    ["refus-derniere-execution-introuvable", 404, "analysis_not_found", noExtra],
    ["refus-ecart-invalide", 400, "invalid_parameter", { field: null, parameter: "other" }],
    ["refus-ecart-revision-masquee", 404, "analysis_not_found", noExtra],
    ["refus-interdit", 403, "forbidden", { field: null, required: "creator" }],
    ["refus-mode-local", 409, "local_mode", noExtra],
    ["refus-moteur-indisponible", 503, "engine_unavailable", noExtra],
    ["refus-numero-invalide", 400, "invalid_parameter", { field: null, parameter: "revision" }],
    ["refus-ouverture-introuvable", 404, "analysis_not_found", noExtra],
    ["refus-ouverture-invalide", 400, "invalid_request", { field: "event_id" }],
    ["refus-pas-proprietaire", 403, "forbidden", { field: null, required: "owner" }],
    ["refus-reference-depot-indisponible", 503, "content_unavailable", noExtra],
    ["refus-reference-introuvable", 404, "analysis_not_found", noExtra],
    ["refus-reference-invalide", 400, "invalid_request", { field: "analysis.revision" }],
    ["refus-reference-modele", 422, "analysis_model_mismatch", noExtra],
    ["refus-revision-attendue", 400, "invalid_request", { field: "expected_revision" }],
    ["refus-revision-conflit", 409, "revision_conflict", { field: null, reason: "stale" }],
    ["refus-revision-masquee", 404, "analysis_not_found", noExtra],
    ["refus-sans-role", 403, "forbidden", { field: null, required: "reader" }],
    ["refus-usage-introuvable", 404, "analysis_not_found", noExtra],
  ];

  it("couvre chaque exemple de refus du serveur", () => {
    expect(REFUSALS.map(([name]) => name).sort()).toEqual(ROUTE_NAMES.filter((name) => name.startsWith("refus-")));
  });

  it.each(REFUSALS)("rend le refus %s comme un refus typé, jamais comme un succès", async (name, status, code, rest) => {
    const example = route(name);
    expect(example.status).toBe(status);
    const abort = signal();
    const found = await fetchAnalysis("finance", ID, abort, serving(example));
    expect(found).toEqual({ status: "refused", code, ...rest });
    expect(await fetchHistory("finance", ID, abort, serving(example))).toMatchObject({ status: "refused", code });
    expect(await createAnalysis("finance", draft, serving(example))).toMatchObject({ status: "refused", code });
    expect(await reviseAnalysis("finance", ID, draft, 1, serving(example))).toMatchObject({ status: "refused", code });
    expect(await deleteAnalysis("finance", ID, 1, serving(example))).toMatchObject({ status: "refused", code });
    expect(await openAnalysis("finance", ID, 1, EVENT, serving(example))).toMatchObject({ status: "refused", code });
    expect(await duplicateAnalysis("finance", ID, undefined, serving(example))).toMatchObject({ status: "refused", code });
    expect(await fetchUsage("finance", ID, abort, serving(example))).toMatchObject({ status: "refused", code });
    expect(await fetchLastExecution("finance", ID, abort, serving(example))).toMatchObject({ status: "refused", code });
    expect(await fetchDiff("finance", ID, 1, 2, abort, serving(example))).toMatchObject({ status: "refused", code });
    expect(await fetchAnalyses("finance", abort, serving(example))).toMatchObject({ status: "refused", code });
    expect(await fetchAnalysisRevision("finance", ID, 1, abort, serving(example))).toMatchObject({ status: "refused", code });
  });

  it("n'emploie que des codes de l'union fermée, et tous ceux que les contrats emploient", () => {
    const used = new Set(REFUSALS.map(([, , code]) => code));
    expect([...used].sort()).toEqual(ANALYSIS_REFUSALS.filter((code) => code !== "space_not_found").sort());
    // La garde de lecture rend aussi `space_not_found` (espace inconnu ou non-membre) : exemple des exécutions.
    expect(nonMembre.body.error.code).toBe("space_not_found");
    expect(new Set(ANALYSIS_REFUSALS).size).toBe(ANALYSIS_REFUSALS.length);
    expect([...ANALYSIS_CODES, ...SHARED_CODES]).toEqual([...ANALYSIS_REFUSALS]);
  });

  it("signale la perte d'accès à l'espace et la perte de session", async () => {
    const space = vi.fn();
    const session = vi.fn();
    const stopSpace = onSpaceLost(space);
    const stopSession = onSessionLost(session);
    try {
      expect(await fetchAnalysis("finance", ID, signal(), serving(nonMembre))).toMatchObject({ status: "refused", code: "space_not_found" });
      expect(space).toHaveBeenCalledOnce();
      errorIncludes(await fetchAnalyses("finance", signal(), serving({ status: 401, body: { error: { code: "unauthenticated" } } })), "Session expirée");
      expect(session).toHaveBeenCalledOnce();
    } finally {
      stopSpace();
      stopSession();
    }
  });

  it("ne lit pas comme un refus un corps à la forme inattendue ou un code hors de l'union", async () => {
    const abort = signal();
    const hidden = { status: 404, body: { error: { code: "analysis_not_found", reason: "personal" } } };
    errorIncludes(await fetchAnalysis("finance", ID, abort, serving(hidden)), "HTTP 404");
    const bad: [number, unknown][] = [
      [404, { error: { code: "analysis_not_found", field: "x" } }], [503, { error: { code: "content_unavailable", detail: "git: fatal" } }], [422, { error: { code: "analysis_model_mismatch", model: "x" } }],
      [409, { error: { code: "revision_conflict" } }], [409, { error: { code: "revision_conflict", reason: "fresh" } }], [409, { error: { code: "revision_conflict", reason: "stale", current: 3 } }],
      [422, { error: { code: "invalid_analysis" } }], [422, { error: { code: "invalid_analysis", reason: "unknown_model" } }], [422, { error: { code: "invalid_analysis", reason: "unknown_model", violations: [] } }],
      [422, { error: { code: "invalid_analysis", reason: "wrong_type", violations: [{ path: "/query/model", rule: "unknown_model" }] } }],
      [422, { error: { code: "invalid_analysis", reason: "unknown_model", violations: [{ path: "/query/model", rule: "unknown_model", value: "x" }] } }],
      [422, { error: { code: "invalid_analysis", reason: "unknown_model", violations: [{ path: "query model", rule: "unknown_model" }] } }],
      [422, { error: { code: "invalid_analysis", reason: "sql", violations: [{ path: "/query/model", rule: "sql" }] } }],
      [422, { error: { code: "invalid_analysis", reason: "unknown_model", violations: [{ path: 1, rule: "unknown_model" }] } }],
      [422, { error: { code: "invalid_analysis", reason: "unknown_model", violations: {} } }],
      [409, { error: { code: "analysis_in_use" } }], [409, { error: { code: "analysis_in_use", consumers: [] } }], [409, { error: { code: "analysis_in_use", consumers: [{ kind: "report", id: ID }] } }],
      [409, { error: { code: "analysis_in_use", consumers: [{ kind: "dashboard", id: "x" }] } }], [409, { error: { code: "analysis_in_use", consumers: [{ kind: "dashboard", id: ID, name: "Tableau" }] } }],
      [409, { error: { code: "analysis_in_use", consumers: [{ kind: "dashboard", id: ID }], extra: 1 } }],
    ];
    for (const [status, body] of bad) errorIncludes(await fetchAnalysis("finance", ID, abort, serving({ status, body })), `HTTP ${String(status)}`);
    // Un code connu de Board mais étranger aux analyses n'est pas un refus de ces routes.
    for (const code of ["execution_not_found", "result_unavailable", "worker_unavailable", "binding_changed", "values_incompatible"]) {
      errorIncludes(await fetchAnalysis("finance", ID, abort, serving({ status: 409, body: { error: { code } } })), "refus inattendu");
    }
    errorIncludes(await fetchAnalysis("finance", ID, abort, serving({ status: 500, body: { error: { code: "internal_error" } } })), "HTTP 500");
    errorIncludes(await fetchAnalysis("finance", ID, abort, serving({ status: 502, body: null })), "HTTP 502");
  });

  it("ignore un paramètre ou un rôle requis hors domaine sans en faire un refus fermé", async () => {
    const abort = signal();
    expect(await fetchAnalysis("finance", ID, abort, serving({ status: 400, body: { error: { code: "invalid_parameter", parameter: "q" } } }))).toEqual({ status: "refused", code: "invalid_parameter", field: null });
    expect(await fetchAnalysis("finance", ID, abort, serving({ status: 403, body: { error: { code: "forbidden", required: "admin" } } }))).toEqual({ status: "refused", code: "forbidden", field: null });
  });

  it("propage une erreur réseau comme une erreur du serveur et laisse passer l'annulation", async () => {
    const failing = vi.fn<Fetch>().mockRejectedValue(new TypeError("réseau"));
    errorIncludes(await fetchAnalyses("finance", signal(), failing), "ne répond pas");
    const controller = new AbortController();
    controller.abort();
    await expect(fetchAnalyses("finance", controller.signal, vi.fn<Fetch>().mockRejectedValue(new DOMException("annulé", "AbortError")))).rejects.toThrow("annulé");
  });
});
