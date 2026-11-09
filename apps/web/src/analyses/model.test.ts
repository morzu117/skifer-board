import { describe, expect, it } from "vitest";
import { ContractError } from "../catalogue/decode";
import { READ_STATES, decodeAnalysisList, decodeConsumers, decodeDiff, decodeHistory, decodeLastExecution, decodeOpened, decodeRevision, decodeUsage } from "./model";
import { changed, COMMIT, ID, OTHER_ID, route } from "./testing";

const revisionOf = (name: string) => route(name).body;
const read = revisionOf("lire");
const violation = { path: "/query/model", rule: "unknown_model" };
const refused = (decode: () => unknown): void => {
  expect(decode).toThrow(ContractError);
};

describe("révisions lues, créées ou revues", () => {
  it.each([
    ["creer", 1, 1, "ready", true], ["dupliquer", 1, 1, "ready", true], ["dupliquer-nommee", 1, 1, "ready", true], ["lire", 1, 1, "ready", false],
    ["lire-index-perime", 2, 2, "index_stale", false], ["lire-non-verifiee", 1, 1, "unverified", false],
    ["reviser", 2, 2, "ready", false], ["reviser-identique", 2, 2, "ready", false], ["revision", 1, 2, "ready", false], ["revision-supprimee", 1, null, "ready", true],
  ] as const)("décode l'exemple du serveur %s", (name, revision, current, state, owner) => {
    const found = decodeRevision(revisionOf(name), "finance");
    expect(found).toMatchObject({ id: ID, space: "finance", revision, currentRevision: current, state, unresolved: [], commit: COMMIT, permissions: { owner }, analysis: { api_version: "board.analysis/v1", id: ID } });
    expect(found.committedAt).toEqual(new Date("2026-01-15T12:00:00+00:00"));
    expect(found.revisedBy.issuer).toBe("https://id.example.invalid");
  });

  it("décode l'exemple du serveur dont une référence a disparu, avec sa violation", () => {
    const found = decodeRevision(revisionOf("lire-non-resolue"), "finance");
    expect(found).toMatchObject({ state: "unresolved_reference", revision: 1, currentRevision: 1, unresolved: [{ path: "/query/metrics/0", rule: "unknown_metric" }] });
    // Le contenu est servi tel qu'enregistré : la métrique disparue du catalogue n'est ni remplacée ni retirée.
    expect(found.analysis.query.metrics).toEqual(["revenue"]);
  });

  it("garde les valeurs exactes du document lu", () => {
    const found = decodeRevision(read, "finance");
    expect(found.analysis).toEqual((read as { analysis: unknown }).analysis);
    expect(found.permissions).toEqual({ owner: false, revise: false, delete: false, duplicate: false });
  });

  it("décode les droits d'un administrateur qui révise une analyse partagée sans la posséder", () => {
    expect(decodeRevision(revisionOf("reviser"), "finance").permissions).toEqual({ owner: false, revise: true, delete: true, duplicate: true });
  });

  it("décode les états dans leur priorité fixe, sans raccourci", () => {
    expect(READ_STATES).toEqual(["index_stale", "unverified", "unresolved_reference", "ready"]);
    // Les états `unverified` et `unresolved_reference` sont lus sur les exemples du serveur ; les corps construits
    // ci-dessous ne couvrent que les règles et les incohérences que ces exemples ne montrent pas.
    const unresolved = changed(changed(read, "state", "unresolved_reference"), "unresolved", [violation]);
    expect(decodeRevision(unresolved, "finance")).toMatchObject({ state: "unresolved_reference", unresolved: [violation] });
    const rules = ["unknown_connection", "unknown_model", "unknown_metric", "unknown_dimension", "filter_not_allowed"].map((rule) => ({ path: "/query/model", rule }));
    expect(decodeRevision(changed(unresolved, "unresolved", rules), "finance").unresolved).toEqual(rules);
    // Un écart d'index l'emporte et ne se lit que sur la révision courante : le serveur ne le rend pas avec des références.
    refused(() => decodeRevision(changed(unresolved, "state", "index_stale"), "finance"));
    refused(() => decodeRevision(changed(changed(read, "state", "index_stale"), "current_revision", 2), "finance"));
    refused(() => decodeRevision(changed(read, "state", "unresolved_reference"), "finance"));
    refused(() => decodeRevision(changed(read, "unresolved", [violation]), "finance"));
    refused(() => decodeRevision(changed(read, "state", "stale"), "finance"));
    refused(() => decodeRevision(changed(read, "state", "indexed"), "finance"));
  });

  it("refuse tout ce qui sort du contrat", () => {
    const cases: [string, unknown][] = [
      ["", null], ["", []], ["extra", 1], ["id", "x"], ["id", OTHER_ID], ["space_id", "autre"], ["space_id", undefined], ["revision", 0], ["revision", 1.5], ["revision", 1_000_000_000], ["revision", "1"],
      ["current_revision", 0], ["current_revision", undefined], ["commit", "<commit>"], ["commit", "ABC"], ["commit", COMMIT.slice(1)], ["committed_at", "2026-01-15T12:00:00"], ["committed_at", 12],
      ["revised_by", null], ["revised_by.email", "a@b"], ["unresolved", {}], ["unresolved", [{ path: "/query/model" }]], ["unresolved", [{ path: "/query/model", rule: "unknown_model", value: "x" }]],
      ["permissions", null], ["permissions.admin", true], ["permissions.owner", undefined], ["permissions.revise", 1], ["analysis", null], ["analysis.sql", "SELECT 1"],
      ["analysis.id", OTHER_ID], ["analysis.api_version", "board.analysis/v2"],
    ];
    for (const [path, value] of cases) refused(() => decodeRevision(path === "" ? value : changed(read, path, value), "finance"));
    // La révision lue ne dépasse pas la courante.
    refused(() => decodeRevision(changed(read, "current_revision", 0), "finance"));
    refused(() => decodeRevision(changed(revisionOf("reviser"), "current_revision", 1), "finance"));
  });

  it("refuse des droits qui n'ont pas la forme que le serveur calcule", () => {
    const rights = (patch: Record<string, boolean>) => changed(read, "permissions", { owner: false, revise: false, delete: false, duplicate: false, ...patch });
    refused(() => decodeRevision(rights({ revise: true }), "finance"));
    refused(() => decodeRevision(rights({ delete: true }), "finance"));
    // Réviser sans posséder n'est possible que sur une analyse partagée.
    const personal = changed(read, "analysis.visibility", "personal");
    refused(() => decodeRevision(personal, "finance"));
    refused(() => decodeRevision(changed(personal, "permissions", { owner: false, revise: true, delete: true, duplicate: true }), "finance"));
    // Une analyse supprimée ne se révise, ni ne se copie.
    const removed = revisionOf("revision-supprimee");
    refused(() => decodeRevision(changed(removed, "permissions", { owner: true, revise: true, delete: true, duplicate: false }), "finance"));
    refused(() => decodeRevision(changed(removed, "permissions", { owner: true, revise: false, delete: false, duplicate: true }), "finance"));
    expect(decodeRevision(changed(personal, "permissions.owner", true), "finance").permissions.owner).toBe(true);
  });
});

describe("liste des analyses", () => {
  it.each([["lister", "indexed"], ["lister-index-perime", "index_stale"]] as const)("décode l'exemple %s", (name, state) => {
    const found = decodeAnalysisList(route(name).body);
    expect(found.unreadable).toBe(0);
    expect(found.analyses).toHaveLength(1);
    expect(found.analyses[0]).toMatchObject({ id: ID, visibility: "shared", isOwner: false, revision: name === "lister" ? 1 : 2, model: "sales", metrics: ["revenue"], state });
  });

  it("garde l'ordre du serveur et le compteur des analyses illisibles de la personne", () => {
    const body = route("lister").body as { analyses: Record<string, unknown>[] };
    const second = { ...body.analyses[0], id: OTHER_ID, name: "Autre" };
    const list = { analyses: [second, body.analyses[0]], unreadable: 3 };
    expect(decodeAnalysisList(list)).toMatchObject({ analyses: [{ id: OTHER_ID }, { id: ID }], unreadable: 3 });
    expect(decodeAnalysisList({ analyses: [], unreadable: 0 }).analyses).toEqual([]);
  });

  it("refuse la liste hors contrat", () => {
    const body = route("lister").body;
    const cases: [string, unknown][] = [
      ["", []], ["extra", 1], ["analyses", {}], ["unreadable", -1], ["unreadable", 1.5], ["unreadable", undefined], ["analyses.0.extra", 1], ["analyses.0.state", "ready"], ["analyses.0.state", "stale"],
      ["analyses.0.is_owner", "yes"], ["analyses.0.id", "x"], ["analyses.0.name", ""], ["analyses.0.model", "1x"], ["analyses.0.metrics", []], ["analyses.0.revision", 0], ["analyses.0.commit", "x"],
      ["analyses.0.visibility", "public"], ["analyses.0.owner", { issuer: "x" }], ["analyses.0.committed_at", "hier"], ["analyses.0.sql", "SELECT 1"],
      // Une analyse personnelle n'est listée que pour son propriétaire.
      ["analyses.0.visibility", "personal"],
    ];
    for (const [path, value] of cases) refused(() => decodeAnalysisList(path === "" ? value : changed(body, path, value)));
    const row = (body as { analyses: unknown[] }).analyses[0];
    refused(() => decodeAnalysisList({ analyses: [row, row], unreadable: 0 }));
    expect(decodeAnalysisList(changed(changed(body, "analyses.0.visibility", "personal"), "analyses.0.is_owner", true)).analyses[0]?.visibility).toBe("personal");
  });
});

describe("historique", () => {
  it.each([
    ["historique", 2, false, 2], ["historique-proprietaire", 2, false, 2], ["historique-revision-masquee", 2, false, 2], ["historique-supprimee", null, true, 3],
  ] as const)("décode l'exemple %s", (name, current, deleted, size) => {
    expect(decodeHistory(route(name).body, ID)).toMatchObject({ id: ID, currentRevision: current, deleted });
    expect(decodeHistory(route(name).body, ID).revisions).toHaveLength(size);
  });

  it("rend une révision masquée réduite à son numéro, et une suppression qui garde le numéro de la dernière sauvegarde", () => {
    const masked = decodeHistory(route("historique-revision-masquee").body, ID);
    expect(masked.revisions[0]).toEqual({ revision: 1, available: false });
    expect(masked.revisions[1]).toMatchObject({ revision: 2, available: true, commit: COMMIT, action: "save", actor: { subject: "cora" } });
    const removed = decodeHistory(route("historique-supprimee").body, ID);
    expect(removed.revisions.map((item) => item.revision)).toEqual([1, 2, 2]);
    expect(removed.revisions[2]).toMatchObject({ available: true, action: "delete" });
  });

  it("refuse une entrée masquée enrichie : ni empreinte, ni date, ni auteur, ni action", () => {
    const hidden = route("historique-revision-masquee").body;
    for (const [key, value] of [["commit", COMMIT], ["committed_at", "2026-01-15T12:00:00+00:00"], ["actor", { issuer: "a", subject: "b" }], ["action", "save"], ["name", "Secrète"], ["available", true]] as const) {
      refused(() => decodeHistory(changed(hidden, `revisions.0.${key}`, value), ID));
    }
    refused(() => decodeHistory(changed(hidden, "revisions.0.revision", undefined), ID));
    refused(() => decodeHistory(changed(hidden, "revisions.0", { revision: 1, available: false, extra: null }), ID));
  });

  it("refuse l'historique hors contrat", () => {
    const body = route("historique").body;
    const deleted = route("historique-supprimee").body;
    const cases: [unknown, string, unknown][] = [
      [body, "", []], [body, "extra", 1], [body, "id", OTHER_ID], [body, "deleted", "no"], [body, "deleted", true], [body, "current_revision", 1], [body, "current_revision", null], [body, "current_revision", 3],
      [body, "revisions", []], [body, "revisions", {}], [body, "revisions.0", 1], [body, "revisions.0.available", "yes"], [body, "revisions.0.available", undefined], [body, "revisions.0.revision", 2],
      [body, "revisions.1.revision", 3], [body, "revisions.0.action", "delete"], [body, "revisions.1.action", "rename"], [body, "revisions.0.commit", "x"], [body, "revisions.0.actor", null],
      [body, "revisions.0.committed_at", "x"], [body, "revisions.0.sql", "x"],
      [deleted, "current_revision", 2], [deleted, "deleted", false], [deleted, "revisions.2.action", "save"], [deleted, "revisions.2.revision", 3], [deleted, "revisions.1.action", "delete"],
      [deleted, "revisions.2", { revision: 2, available: false }], [deleted, "revisions", [{ revision: 1, available: true, commit: COMMIT, committed_at: "2026-01-15T12:00:00+00:00", actor: { issuer: "i", subject: "s" }, action: "delete" }]],
    ];
    for (const [source, path, value] of cases) refused(() => decodeHistory(path === "" ? value : changed(source, path, value), ID));
    refused(() => decodeHistory(body, OTHER_ID));
  });
});

describe("écart entre deux révisions", () => {
  it("décode l'exemple du serveur", () => {
    expect(decodeDiff(route("ecart").body, ID, 1, 2)).toEqual({ id: ID, base: 1, other: 2, changes: [{ path: "/name", kind: "modified", before: "Chiffre d'affaires", after: "Révisée" }] });
  });

  it("décode champ ajouté, retiré et valeurs structurées, sans les modifier", () => {
    const changes = [
      { path: "/query/filters/1", kind: "added", before: null, after: { column: "region", operator: "in", value: ["Nord", 1, true, null, 2.5] } },
      { path: "/contextual/0/scope", kind: "removed", before: "filtered_perimeter", after: null },
      { path: "/contextual/0/scope", kind: "modified", before: null, after: "filtered_perimeter" },
      { path: "/query/filters/0/value", kind: "modified", before: [1, 2], after: [[[[[[[1]]]]]]] },
    ];
    expect(decodeDiff({ id: ID, base: 1, other: 3, changes }, ID, 1, 3).changes).toEqual(changes);
    expect(decodeDiff({ id: ID, base: 1, other: 1, changes: [] }, ID, 1, 1).changes).toEqual([]);
  });

  it("refuse l'écart hors contrat", () => {
    const body = route("ecart").body;
    const cases: [string, unknown][] = [
      ["", null], ["extra", 1], ["id", OTHER_ID], ["base", 2], ["other", 1], ["changes", {}], ["changes.0", 1], ["changes.0.extra", 1], ["changes.0.path", "name"], ["changes.0.path", ""], ["changes.0.path", "/a b"],
      ["changes.0.path", `/${"a".repeat(65)}`], ["changes.0.path", undefined], ["changes.0.kind", "renamed"], ["changes.0.before", undefined], ["changes.0.after", Number.NaN],
      ["changes.0.after", { a: { b: [Infinity] } }], ["changes.0.after", [[[[[[[[[1]]]]]]]]]], ["changes.0.after", { a: [{ b: undefined }] }],
      // Un champ ajouté n'avait rien avant, un champ retiré n'a plus rien après.
      ["changes.0", { path: "/name", kind: "added", before: "x", after: "y" }], ["changes.0", { path: "/name", kind: "removed", before: "x", after: "y" }],
    ];
    for (const [path, value] of cases) refused(() => decodeDiff(path === "" ? value : changed(body, path, value), ID, 1, 2));
  });
});

describe("usage, ouverture", () => {
  it("décode l'usage du serveur", () => {
    const found = decodeUsage(route("usage").body, ID);
    expect(found).toMatchObject({ id: ID, saved: { total: 1, last30Days: 1 }, opened: { total: 1 }, executed: { total: 1 } });
    expect(found.executed.lastAt).toEqual(new Date("2026-01-15T12:00:00+00:00"));
  });

  it("décode un usage sans événement : aucune date", () => {
    const none = { total: 0, last_30_days: 0, last_at: null };
    const older = { total: 4, last_30_days: 0, last_at: "2025-01-01T00:00:00Z" };
    expect(decodeUsage({ id: ID, usage: { saved: none, opened: older, executed: none } }, ID)).toMatchObject({ saved: { total: 0, lastAt: null }, opened: { total: 4, last30Days: 0 } });
  });

  it("refuse l'usage hors contrat", () => {
    const body = route("usage").body;
    const cases: [string, unknown][] = [
      ["", null], ["extra", 1], ["id", OTHER_ID], ["usage", null], ["usage.extra", {}], ["usage.saved", undefined], ["usage.saved.extra", 1], ["usage.saved.total", -1], ["usage.saved.total", 1.5], ["usage.saved.total", "1"],
      ["usage.opened.last_30_days", 2], ["usage.opened.last_30_days", undefined], ["usage.opened.last_at", "hier"], ["usage.opened.last_at", null], ["usage.opened.person", "x"],
      ["usage.executed", { total: 0, last_30_days: 0, last_at: "2026-01-15T12:00:00+00:00" }],
    ];
    for (const [path, value] of cases) refused(() => decodeUsage(path === "" ? value : changed(body, path, value), ID));
  });

  it("décode les deux réponses d'une ouverture et refuse le reste", () => {
    expect(decodeOpened(route("ouvrir").body)).toEqual({ recorded: true });
    expect(decodeOpened(route("ouvrir-non-enregistree").body)).toEqual({ recorded: false });
    for (const value of [null, {}, { recorded: 1 }, { recorded: true, extra: 1 }, [], "true"]) refused(() => decodeOpened(value));
  });
});

describe("dernière exécution de la session", () => {
  const found = route("derniere-execution").body;
  const denied = route("derniere-execution-refusee").body;
  const none = route("derniere-execution-aucune").body;
  const last = (body: unknown, id = ID) => decodeLastExecution(body, "finance", id);

  it("décode l'exemple du serveur : révision, état, preuve et trace", () => {
    const decoded = last(found);
    expect(decoded.last?.revision).toBe(1);
    expect(decoded.last?.execution).toMatchObject({ id: ID, space: "finance", state: "succeeded", errorCode: null, rows: 1, connectorRunId: ID });
    expect(decoded.last?.execution.proof).toMatchObject({ evidenceId: ID, modelKeys: ["sales"], policy: { decision: "ALLOW" } });
    expect(decoded.last?.execution.proof?.sqlHash).toMatch(/^sha256:v1:[0-9a-f]{64}$/);
  });

  it("décode un refus du moteur comme un refus : ni résultat ni preuve", () => {
    const decoded = last(denied);
    expect(decoded).toMatchObject({ id: ID, last: { revision: 1, execution: { state: "denied", errorCode: "deny", rows: null, size: null, truncated: null, proof: null, resultContract: null } } });
    const human = changed(denied, "execution.error_code", "require_human");
    expect(last(human).last?.execution).toMatchObject({ state: "denied", errorCode: "require_human" });
  });

  it("décode l'absence d'exécution : ni révision ni exécution", () => {
    expect(last(none)).toEqual({ id: ID, last: null });
  });

  it("décode une exécution encore en cours", () => {
    const running = changed(changed(changed(changed(changed(changed(found, "execution.state", "running"), "execution.finished_at", null), "execution.rows", null), "execution.size", null), "execution.truncated", null), "execution.evidence", null);
    const decoded = last(changed(changed(running, "execution.result_contract", undefined), "execution.connector_run_id", null));
    expect(decoded.last?.execution).toMatchObject({ state: "running", proof: null });
  });

  it("refuse un refus qui se déguise en succès, ou un succès qui se déguise en refus", () => {
    refused(() => last(changed(denied, "execution.state", "succeeded")));
    refused(() => last(changed(denied, "execution.error_code", null)));
    refused(() => last(changed(denied, "execution.rows", 1)));
    refused(() => last(changed(denied, "execution.evidence", (found as { execution: { evidence: unknown } }).execution.evidence)));
    refused(() => last(changed(denied, "execution.error_code", "execution_failed")));
    // Un refus ne se présente pas sous un autre état.
    refused(() => last(changed(denied, "execution.state", "failed")));
    refused(() => last(changed(changed(denied, "execution.state", "failed"), "execution.error_code", "require_human")));
    refused(() => last(changed(found, "execution.state", "denied")));
    refused(() => last(changed(found, "execution.error_code", "deny")));
    refused(() => last(changed(found, "execution.evidence", null)));
  });

  it("refuse une réponse hors contrat", () => {
    const cases: [string, unknown][] = [
      ["", null], ["", []], ["extra", 1], ["id", OTHER_ID], ["id", undefined], ["revision", undefined], ["execution", undefined], ["revision", 0], ["revision", 1.5], ["revision", "1"], ["revision", 1_000_000_000],
      ["revision", null], ["execution", null], ["execution", []], ["execution", "x"], ["execution.extra", 1], ["execution.space_id", "autre"], ["execution.id", "pas-un-uuid"],
      ["execution.evidence.sql_hash", "invalide"], ["execution.evidence.execution_error_type", "DENY"], ["execution.evidence.executed_at", null],
      ["execution.evidence.metrics.0.certification", "CANDIDATE"], ["execution.evidence.metrics.0.definition_hash", "empreinte"], ["execution.evidence.normalized_filters.0.definition_hash", "empreinte"], ["execution.evidence.normalized_filters.0.definition_hash", null],
      ["execution.analysis", { id: ID, revision: 1 }], ["execution.created_at", "hier"], ["execution.evidence.sql_hash", undefined], ["execution.evidence", undefined],
    ];
    for (const [path, value] of cases) refused(() => last(path === "" ? value : changed(found, path, value)));
    // La preuve fait partie de la réponse : le résumé de la liste des exécutions n'est pas celui-ci.
    const summary = Object.fromEntries(Object.entries((found as { execution: object }).execution).filter(([key]) => !["evidence", "connector_run_id", "result_contract"].includes(key)));
    refused(() => last({ id: ID, revision: 1, execution: summary }));
    refused(() => last(none, OTHER_ID));
    refused(() => last(changed(none, "revision", 1)));
    refused(() => last(changed(none, "execution", (found as { execution: unknown }).execution)));
  });
});

describe("consommateurs d'une analyse", () => {
  it("décode les exemples du serveur : dashboards visibles et nombre des autres, jamais leur nom", () => {
    expect(decodeConsumers(route("consommateurs").body, ID)).toEqual({ id: ID, consumers: [{ kind: "dashboard", id: ID }], others: 1 });
    expect(decodeConsumers(route("consommateurs-aucun").body, ID)).toEqual({ id: ID, consumers: [], others: 0 });
    expect(decodeConsumers({ id: ID, consumers: [{ kind: "dashboard", id: ID }, { kind: "dashboard", id: OTHER_ID }], others: 3 }, ID)).toMatchObject({ others: 3, consumers: [{ id: ID }, { id: OTHER_ID }] });
  });

  it("refuse une réponse hors contrat : autre analyse, champ en trop, genre inconnu, doublon, nombre invalide", () => {
    const found = route("consommateurs").body;
    expect(() => decodeConsumers(found, OTHER_ID)).toThrow("identifiant demandé");
    for (const [path, value] of [
      ["extra", 1], ["id", undefined], ["id", "x"], ["consumers", undefined], ["consumers", {}], ["consumers", "x"], ["others", undefined], ["others", -1], ["others", 1.5], ["others", "1"], ["others", null],
      ["others", Number.MAX_SAFE_INTEGER + 1], ["consumers.0", null], ["consumers.0", "dashboard"], ["consumers.0.kind", "report"], ["consumers.0.kind", undefined], ["consumers.0.id", "x"], ["consumers.0.id", undefined],
      ["consumers.0.name", "Tableau"], ["consumers.0.owner", "cora"],
    ] as const) {
      refused(() => decodeConsumers(changed(found, path, value), ID));
    }
    for (const value of [null, [], "x", 1]) refused(() => decodeConsumers(value, ID));
    // Un dashboard n'est listé qu'une fois : deux entrées au même identifiant seraient un décompte faux.
    refused(() => decodeConsumers({ id: ID, consumers: [{ kind: "dashboard", id: ID }, { kind: "dashboard", id: ID }], others: 0 }, ID));
  });
});
