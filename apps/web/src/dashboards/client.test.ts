import { afterEach, describe, expect, it, vi } from "vitest";
import nonMembre from "../../../../contracts/executions/champs-non-membre.json";
import { onSessionLost } from "../identity/session";
import type { AdminOutcome } from "../spaces/admin";
import type { Fetch } from "../spaces/api";
import { onSpaceLost } from "../spaces/lost";
import {
  createDashboard, deleteDashboard, duplicateDashboard, fetchDashboard, fetchDashboardDiff, fetchDashboardHistory, fetchDashboardRevision, fetchDashboards, reviseDashboard,
} from "./client";
import { decodeDashboardDraft, type DashboardDraft } from "./document";
import { DASHBOARD_REFUSALS } from "./refusal";
import { bodyOf, changed, draftOf, ID, OTHER_ID, ROUTE_NAMES, ROOT, reply, route, type Exemple } from "./testing";

const signal = () => new AbortController().signal;
const serving = (example: Exemple) => vi.fn<Fetch>().mockImplementation(() => Promise.resolve(reply(example)));
const lire = route("lire").body as { dashboard: Record<string, unknown> };
const draft = draftOf(lire.dashboard) as unknown as DashboardDraft;
const GET = { method: "GET", headers: { Accept: "application/json" } };
const POST = { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" } };
const URL = `${ROOT}/${ID}`;

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function errorIncludes(outcome: AdminOutcome<unknown>, fragment: string): void {
  expect(outcome.status).toBe("error");
  if (outcome.status === "error") expect(outcome.message).toContain(fragment);
}

describe("routes de lecture", () => {
  it("liste les dashboards", async () => {
    const fetcher = serving(route("lister"));
    const abort = signal();
    expect(await fetchDashboards("finance", abort, fetcher)).toMatchObject({ status: "ok", value: { unreadable: 0, dashboards: [{ name: "Pilotage", state: "indexed", visibility: "shared" }] } });
    expect(fetcher).toHaveBeenCalledWith(ROOT, { ...GET, signal: abort });
    expect(await fetchDashboards("finance", abort, serving(route("lister-index-perime")))).toMatchObject({ status: "ok", value: { dashboards: [{ state: "indexed" }, { state: "index_stale" }] } });
    errorIncludes(await fetchDashboards("finance", abort, serving({ status: 200, body: { dashboards: [], unreadable: 0, extra: 1 } })), "hors contrat");
    errorIncludes(await fetchDashboards("finance", abort, serving({ status: 201, body: route("lister").body })), "HTTP 200");
    errorIncludes(await fetchDashboards("finance", abort, serving({ status: 204, body: null })), "HTTP 200");
  });

  it("lit la révision courante, une révision numérotée, l'historique et l'écart", async () => {
    const abort = signal();
    const current = serving(route("lire"));
    expect(await fetchDashboard("finance", ID, abort, current)).toMatchObject({ status: "ok", value: { id: ID, revision: 1, currentRevision: 1, state: "ready" } });
    expect(current).toHaveBeenCalledWith(URL, { ...GET, signal: abort });
    const numbered = serving(route("revision"));
    expect(await fetchDashboardRevision("finance", ID, 1, abort, numbered)).toMatchObject({ status: "ok", value: { revision: 1, currentRevision: 2 } });
    expect(numbered).toHaveBeenCalledWith(`${URL}/revisions/1`, { ...GET, signal: abort });
    // Un dashboard supprimé garde ses révisions lisibles : sa révision courante est `null`.
    const removed = { ...route("revision"), body: { ...(route("revision").body as object), current_revision: null } };
    expect(await fetchDashboardRevision("finance", ID, 1, abort, serving(removed))).toMatchObject({ status: "ok", value: { currentRevision: null } });
    const history = serving(route("historique-supprime"));
    expect(await fetchDashboardHistory("finance", ID, abort, history)).toMatchObject({ status: "ok", value: { deleted: true, currentRevision: null, revisions: [{ action: "save" }, { action: "save" }, { action: "delete" }] } });
    expect(history).toHaveBeenCalledWith(`${URL}/revisions`, { ...GET, signal: abort });
    expect(await fetchDashboardHistory("finance", ID, abort, serving({ status: 200, body: changed(route("historique").body, "revisions.0", { revision: 1, available: false }) }))).toMatchObject({ status: "ok", value: { revisions: [{ available: false }, { available: true }] } });
    const diff = serving(route("ecart"));
    expect(await fetchDashboardDiff("finance", ID, 1, 2, abort, diff)).toMatchObject({ status: "ok", value: { changes: [{ path: "/name", kind: "modified", node: "dashboard" }, { node: "analysis", kind: "modified" }] } });
    expect(diff).toHaveBeenCalledWith(`${URL}/diff?base=1&other=2`, { ...GET, signal: abort });
  });

  it("lit l'état de chaque tuile et l'état global tels que le serveur les rend", async () => {
    const abort = signal();
    const tiles = await fetchDashboard("finance", ID, abort, serving(route("lire-tuiles")));
    expect(tiles).toMatchObject({ status: "ok", value: { state: "unresolved_reference" } });
    expect(tiles.status === "ok" ? tiles.value.tiles.map((tile) => tile.state) : null).toEqual(["ready", "unavailable", "unavailable", "unavailable"]);
    expect(await fetchDashboard("finance", ID, abort, serving(route("lire-non-verifie")))).toMatchObject({ status: "ok", value: { state: "unverified" } });
    expect(await fetchDashboard("finance", ID, abort, serving(route("lire-index-perime")))).toMatchObject({ status: "ok", value: { state: "index_stale", revision: 2, currentRevision: 2 } });
  });

  it("refuse une réponse dont un entier serait arrondi par JSON.parse, sans l'afficher", async () => {
    const abort = signal();
    const text = (replace: (source: string) => string, example = route("lire")) => vi.fn<Fetch>().mockImplementation(() => Promise.resolve(new Response(replace(JSON.stringify(example.body)), { status: example.status })));
    errorIncludes(await fetchDashboard("finance", ID, abort, text((source) => source.replace('"revision":1,', '"revision":9007199254740993,'))), "unsafe_integer");
    errorIncludes(await fetchDashboard("finance", ID, abort, text((source) => source.replace('"presentation":{}', '"presentation":{"threshold":{"value":10000000000000000000,"label":"x"}}'))), "unsafe_integer");
    errorIncludes(await fetchDashboard("finance", ID, abort, text((source) => source.replace('"presentation":{}', '"presentation":{"threshold":{"value":1e19,"label":"x"}}'))), "hors contrat");
    errorIncludes(await fetchDashboards("finance", abort, text((source) => source.replace('"unreadable":0', '"unreadable":9007199254740993'), route("lister"))), "unsafe_integer");
    errorIncludes(await fetchDashboardDiff("finance", ID, 1, 2, abort, text((source) => source.replace('"after":"Révisé"', '"after":9007199254740993'), route("ecart"))), "unsafe_integer");
    errorIncludes(await fetchDashboardHistory("finance", ID, abort, text((source) => source.replace('"current_revision":2', '"current_revision":9007199254740993'), route("historique"))), "unsafe_integer");
    // Un entier sûr mais hors de l'intervalle du seuil est refusé comme tel, non comme un entier arrondi ; un décimal est lu.
    for (const literal of ["9007199254740991", "-9007199254740991"]) {
      errorIncludes(await fetchDashboard("finance", ID, abort, text((source) => source.replace('"presentation":{}', `"presentation":{"threshold":{"value":${literal},"label":"x"}}`))), "hors contrat");
    }
    const small = await fetchDashboard("finance", ID, abort, text((source) => source.replace('"presentation":{}', '"presentation":{"threshold":{"value":1.5,"label":"x"}}')));
    expect(small).toMatchObject({ status: "ok" });
    const kept = small.status === "ok" ? small.value.dashboard.layout.sections[0]?.rows[0]?.columns[0]?.children[0] : null;
    expect(kept).toMatchObject({ presentation: { threshold: { value: 1.5, label: "x" } } });
  });

  it("refuse une réponse qui n'est pas celle qu'on a demandée", async () => {
    const abort = signal();
    errorIncludes(await fetchDashboard("finance", OTHER_ID, abort, serving(route("lire"))), "révision courante");
    errorIncludes(await fetchDashboard("finance", ID, abort, serving(route("revision"))), "révision courante");
    errorIncludes(await fetchDashboard("autre", ID, abort, serving(route("lire"))), "hors contrat");
    errorIncludes(await fetchDashboardRevision("finance", ID, 2, abort, serving(route("revision"))), "révision demandée");
    errorIncludes(await fetchDashboardRevision("finance", OTHER_ID, 1, abort, serving(route("revision"))), "révision demandée");
    errorIncludes(await fetchDashboardHistory("finance", OTHER_ID, abort, serving(route("historique"))), "hors contrat");
    errorIncludes(await fetchDashboardDiff("finance", ID, 1, 3, abort, serving(route("ecart"))), "hors contrat");
    errorIncludes(await fetchDashboardDiff("finance", OTHER_ID, 1, 2, abort, serving(route("ecart"))), "hors contrat");
    for (const call of [
      (fetcher: Fetch) => fetchDashboard("finance", ID, abort, fetcher), (fetcher: Fetch) => fetchDashboardRevision("finance", ID, 1, abort, fetcher),
      (fetcher: Fetch) => fetchDashboardHistory("finance", ID, abort, fetcher), (fetcher: Fetch) => fetchDashboardDiff("finance", ID, 1, 2, abort, fetcher),
    ]) {
      errorIncludes(await call(serving({ status: 201, body: route("lire").body })), "HTTP 200");
    }
  });

  it("n'appelle pas le serveur avec un identifiant ou un numéro invalide", async () => {
    const fetcher = serving(route("lire"));
    const abort = signal();
    errorIncludes(await fetchDashboard("finance", "pas-un-uuid", abort, fetcher), "identifiant de dashboard");
    errorIncludes(await fetchDashboard("finance", ID.toUpperCase(), abort, fetcher), "identifiant de dashboard");
    errorIncludes(await fetchDashboardRevision("finance", "../x", 1, abort, fetcher), "identifiant de dashboard");
    for (const number of [0, -1, 1.5, Number.NaN, 1_000_000_000]) {
      errorIncludes(await fetchDashboardRevision("finance", ID, number, abort, fetcher), "numéro de révision");
      errorIncludes(await fetchDashboardDiff("finance", ID, number, 1, abort, fetcher), "numéro de révision");
      errorIncludes(await fetchDashboardDiff("finance", ID, 1, number, abort, fetcher), "numéro de révision");
    }
    errorIncludes(await fetchDashboardHistory("finance", "x", abort, fetcher), "identifiant de dashboard");
    errorIncludes(await fetchDashboardDiff("finance", "x", 1, 2, abort, fetcher), "identifiant de dashboard");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("routes d'écriture", () => {
  it("crée un dashboard : seuls les champs du document partent, rien d'autre", async () => {
    const fetcher = serving(route("creer"));
    const outcome = await createDashboard("finance", draft, fetcher);
    expect(outcome).toMatchObject({ status: "ok", value: { revision: 1, currentRevision: 1, permissions: { owner: true }, state: "ready" } });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(ROOT);
    expect(init).toEqual({ ...POST, body: JSON.stringify(draft) });
    expect(Object.keys(JSON.parse(bodyOf(fetcher)) as object)).toEqual(["name", "description", "visibility", "defaults", "filters", "layout"]);
    errorIncludes(await createDashboard("finance", draft, serving({ ...route("creer"), status: 200 })), "HTTP 201");
    errorIncludes(await createDashboard("finance", draft, serving(route("reviser"))), "première révision");
    errorIncludes(await createDashboard("finance", draft, serving({ ...route("creer"), body: { ...(route("creer").body as object), current_revision: 2 } })), "première révision");
    // La première révision est celle de son auteur : un dashboard dont il n'est pas le propriétaire n'est pas la sienne.
    errorIncludes(await createDashboard("finance", draft, serving(changed(route("creer"), "body.dashboard.owner.subject", "ada"))), "première révision");
    errorIncludes(await createDashboard("finance", draft, serving(changed(route("creer"), "body.permissions.owner", false))), "hors contrat");
    errorIncludes(await createDashboard("finance", draft, serving(changed(route("creer"), "body.dashboard.owner.issuer", "https://autre.example.invalid"))), "première révision");
  });

  it("refuse localement un dashboard invalide, sans appeler le serveur", async () => {
    const fetcher = serving(route("creer"));
    for (const bad of [
      { ...draft, sql: "SELECT 1" } as unknown as DashboardDraft, { ...draft, query: {} } as unknown as DashboardDraft, { ...draft, owner: { issuer: "a", subject: "b" } } as unknown as DashboardDraft,
      { ...draft, id: ID } as unknown as DashboardDraft, { ...draft, api_version: "board.dashboard/v1" } as unknown as DashboardDraft, { ...draft, name: "" }, changed(draft, "layout.sections.0.rows.0.columns.0.span", 13),
      changed(draft, "layout.sections.0.rows.0.columns.0.children.0.sql", "SELECT 1"), changed(draft, "layout.sections.0.rows.0.columns.0.children.1.id", draft.layout.sections[0]?.rows[0]?.columns[0]?.children[0]?.id),
    ]) {
      errorIncludes(await createDashboard("finance", bad, fetcher), "invalide");
      errorIncludes(await reviseDashboard("finance", ID, bad, 1, fetcher), "invalide");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("révise avec la révision attendue : 201 pour une nouvelle révision, 200 pour un contenu identique", async () => {
    const created = serving(route("reviser"));
    const outcome = await reviseDashboard("finance", ID, { ...draft, name: "Révisé" }, 1, created);
    expect(outcome).toMatchObject({ status: "ok", value: { unchanged: false, revision: { revision: 2, currentRevision: 2, permissions: { revise: true } } } });
    const [url, init] = created.mock.calls[0] ?? [];
    expect(url).toBe(`${URL}/revisions`);
    expect(init).toEqual({ ...POST, body: JSON.stringify({ ...decodeDashboardDraft({ ...draft, name: "Révisé" }), expected_revision: 1 }) });
    expect(Object.keys(JSON.parse(bodyOf(created)) as object).at(-1)).toBe("expected_revision");
    expect(await reviseDashboard("finance", ID, draft, 2, serving(route("reviser-identique")))).toMatchObject({ status: "ok", value: { unchanged: true, revision: { revision: 2 } } });
    // Le statut et le numéro doivent s'accorder : 201 sans nouveau numéro, 200 avec un nouveau numéro sont hors contrat.
    errorIncludes(await reviseDashboard("finance", ID, draft, 2, serving(route("reviser"))), "révision attendue");
    errorIncludes(await reviseDashboard("finance", ID, draft, 1, serving(route("reviser-identique"))), "révision attendue");
    errorIncludes(await reviseDashboard("finance", OTHER_ID, draft, 1, serving(route("reviser"))), "révision attendue");
    errorIncludes(await reviseDashboard("finance", ID, draft, 1, serving({ status: 202, body: route("reviser").body })), "HTTP 200 ou 201");
    errorIncludes(await reviseDashboard("finance", ID, draft, 1, serving({ status: 201, body: changed(route("reviser").body, "current_revision", 3) })), "révision attendue");
    errorIncludes(await reviseDashboard("finance", "x", draft, 1, serving(route("reviser"))), "identifiant de dashboard");
    errorIncludes(await reviseDashboard("finance", ID, draft, 0, serving(route("reviser"))), "numéro de révision");
    errorIncludes(await reviseDashboard("finance", ID, draft, 1.5, serving(route("reviser"))), "numéro de révision");
  });

  it("duplique en copie personnelle de l'appelant, avec ou sans nom", async () => {
    const plain = serving(route("dupliquer"));
    const copy = await duplicateDashboard("finance", OTHER_ID, undefined, plain);
    expect(copy).toMatchObject({ status: "ok", value: { id: ID, revision: 1, dashboard: { visibility: "personal", name: "Copie de Révisé" }, permissions: { owner: true } } });
    expect(plain).toHaveBeenCalledWith(`${ROOT}/${OTHER_ID}/duplicate`, { method: "POST", headers: { Accept: "application/json" } });
    const named = serving(route("dupliquer-nomme"));
    expect(await duplicateDashboard("finance", OTHER_ID, "Copie", named)).toMatchObject({ status: "ok", value: { dashboard: { name: "Copie" } } });
    expect(named).toHaveBeenCalledWith(`${ROOT}/${OTHER_ID}/duplicate`, { ...POST, body: JSON.stringify({ name: "Copie" }) });
    // La copie a une autre identité, une première révision, et reste personnelle.
    errorIncludes(await duplicateDashboard("finance", ID, undefined, serving(route("dupliquer"))), "copie personnelle");
    errorIncludes(await duplicateDashboard("finance", OTHER_ID, undefined, serving(route("reviser"))), "première révision");
    errorIncludes(await duplicateDashboard("finance", OTHER_ID, undefined, serving({ ...route("lire"), status: 201 })), "première révision");
    errorIncludes(await duplicateDashboard("finance", OTHER_ID, undefined, serving(changed(route("dupliquer"), "body.dashboard.visibility", "shared"))), "hors contrat");
    errorIncludes(await duplicateDashboard("finance", OTHER_ID, undefined, serving({ ...route("dupliquer"), status: 200 })), "HTTP 201");
    const none = serving(route("dupliquer"));
    errorIncludes(await duplicateDashboard("finance", OTHER_ID, "", none), "nom de la copie");
    errorIncludes(await duplicateDashboard("finance", OTHER_ID, "a\nb", none), "nom de la copie");
    errorIncludes(await duplicateDashboard("finance", OTHER_ID, "a".repeat(121), none), "nom de la copie");
    errorIncludes(await duplicateDashboard("finance", "x", undefined, none), "identifiant de dashboard");
    expect(none).not.toHaveBeenCalled();
  });

  it("supprime avec la révision attendue dans l'adresse", async () => {
    const fetcher = serving(route("supprimer"));
    expect(await deleteDashboard("finance", ID, 2, fetcher)).toEqual({ status: "ok", value: null });
    expect(fetcher).toHaveBeenCalledWith(`${URL}?expected_revision=2`, { method: "DELETE", headers: { Accept: "application/json" } });
    errorIncludes(await deleteDashboard("finance", ID, 2, serving({ status: 200, body: {} })), "HTTP 204");
    errorIncludes(await deleteDashboard("finance", ID, 2, serving({ status: 202, body: {} })), "HTTP 204");
    errorIncludes(await deleteDashboard("finance", "x", 2, fetcher), "identifiant de dashboard");
    errorIncludes(await deleteDashboard("finance", ID, 0, fetcher), "numéro de révision");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe("refus", () => {
  const noExtra = { field: null };
  const stale = { field: null, reason: "stale" };
  const personal = { field: null, components: ["00000000-0000-4000-8000-000000000001"] };
  // Chaque refus des contrats d'exemple, avec ce que le client en rend.
  const REFUSALS: readonly (readonly [string, number, string, Record<string, unknown>])[] = [
    ["refus-champ-reserve", 422, "invalid_dashboard", { field: null, reason: "field_not_allowed", dashboardViolations: [{ path: "/owner", rule: "field_not_allowed" }] }],
    ["refus-dashboard-inconnu", 404, "dashboard_not_found", noExtra],
    ["refus-dashboard-invalide-analyse", 422, "invalid_dashboard", { field: null, reason: "analysis_unavailable", dashboardViolations: [{ path: "/layout/sections/0/rows/0/columns/0/children/0/reference", rule: "analysis_unavailable" }] }],
    ["refus-dashboard-invalide-filtre", 422, "invalid_dashboard", { field: null, reason: "dimension_not_exposed", dashboardViolations: [{ path: "/filters/0/targets/0", rule: "dimension_not_exposed" }] }],
    ["refus-depot-indisponible", 503, "content_unavailable", noExtra],
    ["refus-interdit", 403, "forbidden", { field: null, required: "creator" }],
    ["refus-mode-local", 409, "local_mode", noExtra],
    ["refus-moteur-indisponible", 503, "engine_unavailable", noExtra],
    ["refus-pas-proprietaire", 403, "forbidden", { field: null, required: "owner" }],
    ["refus-reference-personnelle", 422, "personal_reference", personal],
    ["refus-revision-conflit", 409, "revision_conflict", stale],
  ];

  it("couvre chaque exemple de refus du serveur", () => {
    expect(REFUSALS.map(([name]) => name).sort()).toEqual(ROUTE_NAMES.filter((name) => name.startsWith("refus-")));
  });

  it.each(REFUSALS)("rend le refus %s comme un refus typé, jamais comme un succès", async (name, status, code, rest) => {
    const example = route(name);
    expect(example.status).toBe(status);
    const abort = signal();
    expect(await fetchDashboard("finance", ID, abort, serving(example))).toEqual({ status: "refused", code, ...rest });
    expect(await fetchDashboards("finance", abort, serving(example))).toMatchObject({ status: "refused", code });
    expect(await fetchDashboardRevision("finance", ID, 1, abort, serving(example))).toMatchObject({ status: "refused", code });
    expect(await fetchDashboardHistory("finance", ID, abort, serving(example))).toMatchObject({ status: "refused", code });
    expect(await fetchDashboardDiff("finance", ID, 1, 2, abort, serving(example))).toMatchObject({ status: "refused", code });
    expect(await createDashboard("finance", draft, serving(example))).toMatchObject({ status: "refused", code });
    expect(await reviseDashboard("finance", ID, draft, 1, serving(example))).toMatchObject({ status: "refused", code });
    expect(await duplicateDashboard("finance", ID, undefined, serving(example))).toMatchObject({ status: "refused", code });
    expect(await deleteDashboard("finance", ID, 1, serving(example))).toMatchObject({ status: "refused", code });
  });

  it("n'emploie que des codes de l'union fermée, et tous ceux que les contrats emploient", () => {
    const used = new Set(REFUSALS.map(([, , code]) => code));
    // `invalid_parameter`, `invalid_request` et `space_not_found` sont ceux de la garde de lecture et des paramètres, sans exemple propre.
    expect([...used].sort()).toEqual(DASHBOARD_REFUSALS.filter((code) => !["space_not_found", "invalid_parameter", "invalid_request"].includes(code)).sort());
    expect(nonMembre.body.error.code).toBe("space_not_found");
  });

  it("signale la perte d'accès à l'espace et la perte de session", async () => {
    const space = vi.fn();
    const session = vi.fn();
    const stopSpace = onSpaceLost(space);
    const stopSession = onSessionLost(session);
    try {
      expect(await fetchDashboard("finance", ID, signal(), serving(nonMembre))).toMatchObject({ status: "refused", code: "space_not_found" });
      expect(space).toHaveBeenCalledOnce();
      errorIncludes(await fetchDashboards("finance", signal(), serving({ status: 401, body: { error: { code: "unauthenticated" } } })), "Session expirée");
      expect(session).toHaveBeenCalledOnce();
    } finally {
      stopSpace();
      stopSession();
    }
  });

  it("ne lit pas comme un refus un corps à la forme inattendue : une erreur, jamais un refus partiel", async () => {
    const abort = signal();
    const bad: [number, unknown][] = [
      [404, { error: { code: "dashboard_not_found", reason: "personal" } }], [404, { error: { code: "dashboard_not_found", field: "id" } }], [404, { error: { code: "dashboard_not_found", detail: "x" } }],
      [503, { error: { code: "content_unavailable", detail: "git: fatal" } }],
      [409, { error: { code: "revision_conflict" } }], [409, { error: { code: "revision_conflict", reason: "head_changed" } }], [409, { error: { code: "revision_conflict", reason: "stale", current: 3 } }],
      [422, { error: { code: "invalid_dashboard" } }], [422, { error: { code: "invalid_dashboard", reason: "unknown_field" } }], [422, { error: { code: "invalid_dashboard", reason: "unknown_field", violations: [] } }],
      [422, { error: { code: "invalid_dashboard", reason: "bad_format", violations: [{ path: "/owner", rule: "unknown_field" }] } }],
      [422, { error: { code: "invalid_dashboard", reason: "unknown_field", violations: [{ path: "/owner", rule: "unknown_field", value: "x" }] } }],
      [422, { error: { code: "invalid_dashboard", reason: "unknown_field", violations: [{ path: "/owner", rule: "unknown_field" }], extra: 1 } }],
      [422, { error: { code: "invalid_dashboard", reason: "unknown_model", violations: [{ path: "/x", rule: "unknown_model" }] } }],
      [422, { error: { code: "invalid_dashboard", reason: "unknown_field", violations: [{ path: "/z", rule: "unknown_field" }, { path: "/a", rule: "unknown_field" }] } }],
      [422, { error: { code: "personal_reference" } }], [422, { error: { code: "personal_reference", components: [] } }], [422, { error: { code: "personal_reference", components: ["x"] } }],
      [422, { error: { code: "personal_reference", components: [ID, ID] } }], [422, { error: { code: "personal_reference", components: [ID], extra: 1 } }], [422, { error: { code: "personal_reference", components: ID } }],
    ];
    for (const [status, body] of bad) {
      errorIncludes(await fetchDashboard("finance", ID, abort, serving({ status, body })), `HTTP ${String(status)}`);
      errorIncludes(await reviseDashboard("finance", ID, draft, 1, serving({ status, body })), `HTTP ${String(status)}`);
    }
    errorIncludes(await fetchDashboard("finance", ID, abort, serving({ status: 500, body: { error: { code: "internal_error" } } })), "HTTP 500");
    errorIncludes(await fetchDashboard("finance", ID, abort, serving({ status: 502, body: null })), "HTTP 502");
  });

  it("refuse comme hors contrat un code que les routes de dashboards ne rendent jamais", async () => {
    const abort = signal();
    // Codes d'analyses ou d'exécutions, même à leur forme exacte : une route de dashboard ne les rend pas.
    const foreign: [number, Record<string, unknown>][] = [
      [404, { code: "analysis_not_found" }], [409, { code: "analysis_in_use", consumers: [{ kind: "dashboard", id: ID }], others: 0 }], [422, { code: "analysis_model_mismatch" }],
      [422, { code: "invalid_analysis", reason: "unknown_field", violations: [{ path: "/owner", rule: "unknown_field" }] }], [404, { code: "execution_not_found" }], [409, { code: "result_unavailable" }],
      [503, { code: "worker_unavailable" }], [409, { code: "binding_changed" }], [409, { code: "values_incompatible" }],
    ];
    for (const [status, error] of foreign) {
      errorIncludes(await fetchDashboard("finance", ID, abort, serving({ status, body: { error } })), "refus inattendu");
      errorIncludes(await deleteDashboard("finance", ID, 1, serving({ status, body: { error } })), "refus inattendu");
    }
    errorIncludes(await fetchDashboard("finance", ID, abort, serving({ status: 404, body: { error: { code: "dashboard_unknown" } } })), "HTTP 404");
  });

  // Forme exacte de chaque refus commun, telle que le serveur la rend (garde de lecture, rôle, paramètres, moteur).
  const EXACT: [number, Record<string, unknown>][] = [
    [403, { code: "forbidden", required: "creator" }], [403, { code: "forbidden", required: "owner" }], [409, { code: "local_mode" }], [404, { code: "space_not_found" }],
    [503, { code: "engine_unavailable" }], [400, { code: "invalid_request", field: "analysis.revision" }],
    [400, { code: "invalid_parameter", parameter: "revision", detail: "Numéro de révision : entier strictement positif." }],
  ];

  it("lit les refus communs à leur forme exacte et refuse tout champ en plus, en moins ou hors domaine", async () => {
    const abort = signal();
    for (const [status, error] of EXACT) {
      expect(await fetchDashboard("finance", ID, abort, serving({ status, body: { error } })), String(error.code)).toMatchObject({ status: "refused", code: error.code });
      const worse: Record<string, unknown>[] = [
        { ...error, unexpected: "secret" },
        ...Object.keys(error).filter((key) => key !== "code").map((key) => Object.fromEntries(Object.entries(error).filter(([name]) => name !== key))),
        ...Object.keys(error).filter((key) => key !== "code").map((key) => ({ ...error, [key]: 3 })),
      ];
      for (const bad of worse) {
        errorIncludes(await fetchDashboard("finance", ID, abort, serving({ status, body: { error: bad } })), "HTTP");
      }
    }
    // Un rôle ou un paramètre hors domaine n'est pas ignoré : c'est une réponse hors contrat.
    errorIncludes(await fetchDashboard("finance", ID, abort, serving({ status: 403, body: { error: { code: "forbidden", required: "admin" } } })), "HTTP 403");
    errorIncludes(await fetchDashboard("finance", ID, abort, serving({ status: 400, body: { error: { code: "invalid_parameter", parameter: "q", detail: "x" } } })), "HTTP 400");
    errorIncludes(await fetchDashboard("finance", ID, abort, serving({ status: 400, body: { error: { code: "invalid_request", field: "" } } })), "HTTP 400");
  });

  it("propage une erreur réseau comme une erreur du serveur et laisse passer l'annulation", async () => {
    const failing = vi.fn<Fetch>().mockRejectedValue(new TypeError("réseau"));
    errorIncludes(await fetchDashboards("finance", signal(), failing), "ne répond pas");
    const controller = new AbortController();
    controller.abort();
    await expect(fetchDashboards("finance", controller.signal, vi.fn<Fetch>().mockRejectedValue(new DOMException("annulé", "AbortError")))).rejects.toThrow("annulé");
  });
});

describe("fetch global", () => {
  it("utilise fetch quand aucun fetcher n'est passé", async () => {
    const spy = vi.fn<Fetch>().mockImplementation(() => Promise.resolve(reply(route("lister"))));
    vi.stubGlobal("fetch", spy);
    const abort = signal();
    expect(await fetchDashboards("finance", abort)).toMatchObject({ status: "ok" });
    const others = [
      fetchDashboard("finance", ID, abort), fetchDashboardRevision("finance", ID, 1, abort), fetchDashboardHistory("finance", ID, abort), fetchDashboardDiff("finance", ID, 1, 2, abort),
      createDashboard("finance", draft), reviseDashboard("finance", ID, draft, 1), duplicateDashboard("finance", ID), deleteDashboard("finance", ID, 1),
    ];
    for (const outcome of await Promise.all(others)) expect(outcome.status).toBe("error");
    expect(spy).toHaveBeenCalledTimes(9);
  });
});

describe("espace hors format", () => {
  it("refuse tout espace hors du format des identifiants avant le moindre appel, sur chaque route", async () => {
    const none = serving(route("lire"));
    const abort = signal();
    for (const space of ["..", ".", "", "Finance", "a/b", "a b", "-a", "a-", "a", "x".repeat(41), "fin..ance", "%2e%2e", "finance?x=1"]) {
      const outcomes = await Promise.all([
        createDashboard(space, draft, none), fetchDashboards(space, abort, none), fetchDashboard(space, ID, abort, none), fetchDashboardRevision(space, ID, 1, abort, none),
        fetchDashboardHistory(space, ID, abort, none), fetchDashboardDiff(space, ID, 1, 2, abort, none), reviseDashboard(space, ID, draft, 1, none),
        duplicateDashboard(space, ID, undefined, none), deleteDashboard(space, ID, 1, none),
      ]);
      for (const outcome of outcomes) errorIncludes(outcome, "identifiant d'espace");
    }
    expect(none).not.toHaveBeenCalled();
    await fetchDashboards("ab", abort, none);
    await fetchDashboards("a".repeat(39) + "b", abort, none);
    expect(none).toHaveBeenCalledTimes(2);
  });
});
