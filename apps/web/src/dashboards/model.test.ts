import { describe, expect, it } from "vitest";
import { ContractError } from "../catalogue/decode";
import { executables } from "./document";
import {
  DIFF_KINDS, DIFF_NODES, TILE_REASONS, TOP_PARENTS, decodeDashboardDiff, decodeDashboardHistory, decodeDashboardList, decodeDashboardRevision,
} from "./model";
import REAL from "./ecart-reel.json";
import { changed, ID, OTHER_ID, route } from "./testing";

const body = (name: string) => route(name).body as Record<string, unknown>;
const decoded = (name: string) => decodeDashboardRevision(body(name), "finance");
const refused = (value: unknown, label = ""): void => {
  expect(() => decodeDashboardRevision(value, "finance"), label).toThrow(ContractError);
};

/** Une révision dont les tuiles et l'état global sont ceux donnés : les tuiles gardent l'identifiant des composants. */
function withTiles(name: string, state: string, tiles: readonly Record<string, unknown>[]): unknown {
  const found = body(name);
  const ids = (found.components as { id: string }[]).map((tile) => tile.id);
  return { ...found, state, components: tiles.map((tile, index) => ({ id: ids[index], ...tile })) };
}
const READY = { state: "ready" };
const UNVERIFIED = { state: "unverified" };
const gone = (reason: string) => ({ state: "unavailable", reason });

describe("révision d'un dashboard", () => {
  it("lit les exemples du serveur : document, tuiles, état global et droits", () => {
    const read = decoded("lire");
    expect(read).toMatchObject({
      id: ID, space: "finance", revision: 1, currentRevision: 1, state: "ready", permissions: { owner: false, revise: false, delete: false, duplicate: false },
      revisedBy: { subject: "cora" }, dashboard: { id: ID, name: "Pilotage", visibility: "shared", owner: { subject: "cora" } },
    });
    expect(read.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(read.committedAt).toEqual(new Date("2026-01-15T12:00:00+00:00"));
    expect(read.tiles).toEqual([{ id: executables(read.dashboard)[0]?.id, state: "ready" }]);
    expect(decoded("lire-index-perime")).toMatchObject({ revision: 2, currentRevision: 2, state: "index_stale" });
    expect(decoded("lire-non-verifie")).toMatchObject({ state: "unverified" });
    expect(decoded("lire-tuiles")).toMatchObject({ state: "unresolved_reference" });
    expect(decoded("revision")).toMatchObject({ revision: 1, currentRevision: 2, state: "ready" });
    expect(decoded("creer")).toMatchObject({ revision: 1, currentRevision: 1, permissions: { owner: true, revise: true, delete: true, duplicate: true } });
    expect(decoded("reviser")).toMatchObject({ revision: 2, revisedBy: { subject: "ada" }, permissions: { owner: false, revise: true } });
    expect(decoded("reviser-identique")).toMatchObject({ revision: 2, dashboard: { name: "Révisé" } });
    expect(decoded("dupliquer")).toMatchObject({ revision: 1, dashboard: { visibility: "personal", name: "Copie de Révisé" }, permissions: { owner: true } });
    expect(decoded("dupliquer-nomme")).toMatchObject({ dashboard: { name: "Copie" } });
  });

  it("garde une tuile par composant exécutable, avec sa raison fermée quand elle est indisponible", () => {
    const tiles = decoded("lire-tuiles").tiles;
    expect(tiles.map((tile) => tile.state)).toEqual(["ready", "unavailable", "unavailable", "unavailable"]);
    expect(tiles.flatMap((tile) => (tile.state === "unavailable" ? [tile.reason] : []))).toEqual(["analysis_unavailable", "unresolved_reference", "filter_incompatible"]);
    expect([...TILE_REASONS]).toEqual(["analysis_unavailable", "unresolved_reference", "filter_incompatible"]);
    expect(tiles.map((tile) => tile.id)).toEqual(executables(decoded("lire-tuiles").dashboard).map((one) => one.id));
    expect(decoded("lire-non-verifie").tiles.map((tile) => tile.state)).toEqual(["unverified", "unavailable", "unverified", "unverified"]);
    // Aucune tuile n'est inventée, perdue, déplacée ni dupliquée.
    const found = body("lire-tuiles");
    const components = found.components as Record<string, unknown>[];
    refused({ ...found, components: components.slice(1) }, "tuile perdue");
    refused({ ...found, components: [...components, components[0]] }, "tuile en trop");
    refused({ ...found, components: [components[1], components[0], ...components.slice(2)] }, "tuiles dans le désordre");
    refused({ ...found, components: components.map((tile, index) => (index === 0 ? { ...tile, id: OTHER_ID } : tile)) }, "tuile d'un autre composant");
    refused({ ...found, components: [] }, "aucune tuile");
    refused(changed(found, "components.0.id", "x"), "identifiant de tuile");
    refused({ ...found, components: Array.from({ length: 41 }, () => components[0]) }, "41 tuiles");
  });

  it("refuse une tuile à la forme forgée : raison hors domaine, raison en trop, raison manquante, champ en trop", () => {
    const found = body("lire-tuiles");
    for (const [path, value] of [
      ["components.1.reason", "other"], ["components.1.reason", undefined], ["components.1.reason", null], ["components.1.reason", 3], ["components.0.reason", "analysis_unavailable"], ["components.0.state", "failed"],
      ["components.0.state", undefined], ["components.0.extra", 1], ["components.0.name", "Ventes"], ["components.0.sql_hash", "x"], ["components.1.extra", 1], ["components.0", "ready"], ["components", {}], ["components.0.state", 3],
    ] as const) {
      refused(changed(found, path, value), path);
    }
    // Une tuile prête ou invérifiable ne porte aucune raison.
    refused(changed(body("lire-non-verifie"), "components.0.reason", "analysis_unavailable"));
    refused(changed(body("lire"), "components.0.reason", "filter_incompatible"));
  });

  it("garde l'état global cohérent avec les tuiles : invérifiable, non résolu, prêt, écart d'index", () => {
    // Prêt : toutes les tuiles le sont.
    expect(decodeDashboardRevision(withTiles("lire", "ready", [READY]), "finance").state).toBe("ready");
    for (const tile of [UNVERIFIED, gone("analysis_unavailable"), gone("unresolved_reference"), gone("filter_incompatible")]) refused(withTiles("lire", "ready", [tile]), JSON.stringify(tile));
    // Invérifiable : le catalogue n'a rien affirmé, donc aucune tuile prête ni indisponible pour une raison du catalogue.
    expect(decodeDashboardRevision(withTiles("lire", "unverified", [UNVERIFIED]), "finance").state).toBe("unverified");
    expect(decodeDashboardRevision(withTiles("lire", "unverified", [gone("analysis_unavailable")]), "finance").state).toBe("unverified");
    for (const tile of [READY, gone("unresolved_reference"), gone("filter_incompatible")]) refused(withTiles("lire", "unverified", [tile]), JSON.stringify(tile));
    // Non résolu : au moins une tuile indisponible, aucune invérifiable.
    for (const tile of [gone("analysis_unavailable"), gone("unresolved_reference"), gone("filter_incompatible")]) {
      expect(decodeDashboardRevision(withTiles("lire", "unresolved_reference", [tile]), "finance").state).toBe("unresolved_reference");
    }
    for (const tile of [READY, UNVERIFIED]) refused(withTiles("lire", "unresolved_reference", [tile]), JSON.stringify(tile));
    // Un mélange d'invérifiable et de connu ne peut venir d'aucune lecture.
    const four = (...tiles: Record<string, unknown>[]) => tiles;
    for (const state of ["ready", "unverified", "unresolved_reference", "index_stale"]) {
      refused(withTiles("lire-tuiles", state, four(UNVERIFIED, READY, gone("filter_incompatible"), UNVERIFIED)), state);
      refused(withTiles("lire-tuiles", state, four(UNVERIFIED, gone("unresolved_reference"), UNVERIFIED, UNVERIFIED)), state);
    }
    // L'écart d'index l'emporte et ne dit rien des tuiles, mais seulement sur la révision courante.
    for (const tile of [READY, UNVERIFIED, gone("analysis_unavailable"), gone("filter_incompatible")]) expect(decodeDashboardRevision(withTiles("lire-index-perime", "index_stale", [tile]), "finance").state).toBe("index_stale");
    refused({ ...body("revision"), state: "index_stale" }, "écart d'index sur une révision passée");
    refused(changed(body("lire-index-perime"), "current_revision", 3), "écart d'index sur une révision passée");
    // Un dashboard sans tuile est prêt, invérifiable ou périmé, jamais non résolu.
    const empty = (state: string) => ({ ...body("lire"), state, components: [], dashboard: { ...(body("lire").dashboard as object), layout: { sections: [] } } });
    for (const state of ["ready", "unverified", "index_stale"]) expect(decodeDashboardRevision(empty(state), "finance").tiles).toEqual([]);
    refused(empty("unresolved_reference"));
    refused({ ...body("lire"), state: "stale" });
    refused({ ...body("lire"), state: null });
  });

  it("refuse une révision qui n'est pas celle d'un dashboard de l'espace demandé", () => {
    const found = body("lire");
    expect(() => decodeDashboardRevision(found, "autre")).toThrow("space_id");
    refused(changed(found, "space_id", "autre"));
    refused(changed(found, "id", OTHER_ID), "identifiant de la révision différent de celui du document");
    refused(changed(found, "dashboard.id", OTHER_ID));
    refused(changed(found, "revision", 2), "révision au-delà de la courante");
    for (const [path, value] of [
      ["revision", 0], ["revision", 1.5], ["revision", "1"], ["revision", 1_000_000_000], ["current_revision", 0], ["current_revision", undefined], ["current_revision", "1"], ["commit", "abc"], ["commit", undefined], ["committed_at", "hier"],
      ["committed_at", 12], ["revised_by", "cora"], ["revised_by.email", "x"], ["permissions", undefined], ["permissions.owner", "oui"], ["extra", 1], ["dashboard", undefined], ["dashboard.sql", "SELECT 1"],
      ["dashboard.layout.sections.0.rows.0.columns.0.children.0.query", {}], ["id", "x"], ["id", undefined], ["state", undefined], ["components", undefined],
    ] as const) {
      refused(changed(found, path, value), path);
    }
    refused(null);
    refused([]);
    refused("x");
  });

  it("garde des droits cohérents avec le dashboard : réviser et supprimer vont ensemble, rien sur un dashboard supprimé", () => {
    const rights = (owner: boolean, revise: boolean, remove: boolean, duplicate: boolean) => ({ owner, revise, delete: remove, duplicate });
    const shared = body("revision");
    const accepted = (permissions: unknown, base: Record<string, unknown> = shared): void => { expect(() => decodeDashboardRevision({ ...base, permissions }, "finance")).not.toThrow(); };
    const rejected = (permissions: unknown, base: Record<string, unknown> = shared): void => { expect(() => decodeDashboardRevision({ ...base, permissions }, "finance")).toThrow(ContractError); };
    accepted(rights(false, false, false, false));
    accepted(rights(true, true, true, true));
    accepted(rights(false, true, true, true));
    rejected(rights(false, true, false, true));
    rejected(rights(false, false, true, true));
    for (const flag of [1, "true", null, undefined]) rejected({ ...rights(false, false, false, false), owner: flag });
    rejected({ ...rights(false, false, false, false), extra: true });
    rejected({ owner: false, revise: false, delete: false });
    // Un dashboard supprimé (révision courante `null`) ne se révise, ne se supprime ni ne se duplique plus.
    const removed = { ...shared, current_revision: null };
    accepted(rights(false, false, false, false), removed);
    accepted(rights(true, false, false, false), removed);
    rejected(rights(true, true, true, false), removed);
    rejected(rights(false, false, false, true), removed);
    expect(decodeDashboardRevision(removed, "finance").currentRevision).toBeNull();
    // Un dashboard personnel n'est rendu qu'à son propriétaire, et seul un dashboard partagé se révise sans l'être.
    const own = body("dupliquer");
    accepted(rights(true, true, true, true), own);
    rejected(rights(false, false, false, false), own);
    rejected(rights(false, true, true, true), own);
    rejected(rights(false, true, true, true), { ...own, dashboard: { ...(own.dashboard as object), visibility: "personal" } });
  });

  it("n'élargit rien : une révision supprimée n'a plus de courante, une passée garde la sienne", () => {
    expect(decodeDashboardRevision({ ...body("revision"), current_revision: null }, "finance")).toMatchObject({ revision: 1, currentRevision: null });
    expect(decodeDashboardRevision(body("revision"), "finance")).toMatchObject({ revision: 1, currentRevision: 2 });
  });
});

describe("liste des dashboards", () => {
  it("lit les exemples du serveur, sans nom d'analyse ni droit calculé", () => {
    const list = decodeDashboardList(body("lister"));
    expect(list).toMatchObject({ unreadable: 0, dashboards: [{ name: "Pilotage", visibility: "shared", owner: { subject: "cora" }, isOwner: false, revision: 1, state: "indexed" }] });
    expect(list.dashboards).toHaveLength(1);
    const stale = decodeDashboardList(body("lister-index-perime"));
    expect(stale.dashboards.map((item) => [item.name, item.state, item.revision])).toEqual([["A tuiles", "indexed", 1], ["B écrit hors index", "index_stale", 2]]);
    expect(new Set(stale.dashboards.map((item) => item.id)).size).toBe(2);
    expect(decodeDashboardList({ dashboards: [], unreadable: 3 })).toEqual({ dashboards: [], unreadable: 3 });
  });

  it("refuse une liste à la forme forgée", () => {
    const found = body("lister");
    const item = (found.dashboards as Record<string, unknown>[])[0] as Record<string, unknown>;
    const list = (...items: unknown[]) => ({ dashboards: items, unreadable: 0 });
    for (const [path, value] of [
      ["unreadable", -1], ["unreadable", 1.5], ["unreadable", "0"], ["unreadable", undefined], ["extra", 1], ["dashboards", undefined], ["dashboards", {}], ["dashboards.0.state", "stale"], ["dashboards.0.state", undefined],
      ["dashboards.0.visibility", "public"], ["dashboards.0.is_owner", "oui"], ["dashboards.0.is_owner", undefined], ["dashboards.0.revision", 0], ["dashboards.0.commit", "x"], ["dashboards.0.committed_at", "hier"],
      ["dashboards.0.name", ""], ["dashboards.0.name", 3], ["dashboards.0.owner", "cora"], ["dashboards.0.id", "x"], ["dashboards.0.extra", 1], ["dashboards.0.components", []], ["dashboards.0", null],
    ] as const) {
      expect(() => decodeDashboardList(changed(found, path, value)), path).toThrow(ContractError);
    }
    // Un dashboard n'est listé qu'une fois, et un dashboard personnel que pour son propriétaire.
    expect(() => decodeDashboardList(list(item, item))).toThrow(ContractError);
    expect(() => decodeDashboardList(list({ ...item, visibility: "personal", is_owner: false }))).toThrow("propriétaire");
    expect(decodeDashboardList(list({ ...item, visibility: "personal", is_owner: true })).dashboards[0]).toMatchObject({ visibility: "personal", isOwner: true });
    expect(decodeDashboardList(list({ ...item, is_owner: true })).dashboards[0]).toMatchObject({ visibility: "shared", isOwner: true });
    for (const value of [null, [], "x", { dashboards: [] }]) expect(() => decodeDashboardList(value)).toThrow(ContractError);
  });
});

describe("historique d'un dashboard", () => {
  it("lit les exemples du serveur, suppression comprise", () => {
    const history = decodeDashboardHistory(body("historique"), ID);
    expect(history).toMatchObject({ id: ID, currentRevision: 2, deleted: false });
    expect(history.revisions.map((one) => [one.revision, one.available && one.action])).toEqual([[1, "save"], [2, "save"]]);
    const removed = decodeDashboardHistory(body("historique-supprime"), ID);
    expect(removed).toMatchObject({ currentRevision: null, deleted: true });
    expect(removed.revisions.map((one) => [one.revision, one.available && one.action])).toEqual([[1, "save"], [2, "save"], [2, "delete"]]);
  });

  it("garde une révision masquée réduite à son numéro, sans commit, date ni auteur", () => {
    const hidden = changed(body("historique"), "revisions.0", { revision: 1, available: false });
    const history = decodeDashboardHistory(hidden, ID);
    expect(history.revisions[0]).toEqual({ revision: 1, available: false });
    expect(history.revisions[1]).toMatchObject({ revision: 2, available: true, action: "save" });
    for (const extra of ["commit", "committed_at", "actor", "action"]) {
      const leaky = changed(hidden, `revisions.0.${extra}`, extra === "actor" ? { issuer: "a", subject: "b" } : "x");
      expect(() => decodeDashboardHistory(leaky, ID), extra).toThrow(ContractError);
    }
  });

  it("refuse un historique d'un autre dashboard, aux numéros discontinus ou sans suppression en dernier", () => {
    const found = body("historique");
    expect(() => decodeDashboardHistory(found, OTHER_ID)).toThrow("identifiant demandé");
    for (const [path, value] of [["revisions.1.revision", 3], ["revisions.0.revision", 2], ["current_revision", 1], ["current_revision", null], ["deleted", true], ["revisions", []], ["revisions.1.action", "delete"], ["extra", 1], ["revisions.1.action", "rename"]] as const) {
      expect(() => decodeDashboardHistory(changed(found, path, value), ID), path).toThrow(ContractError);
    }
    const removed = body("historique-supprime");
    for (const [path, value] of [["revisions.2.action", "save"], ["revisions.2.revision", 3], ["current_revision", 2], ["deleted", false], ["revisions.2.available", false]] as const) {
      expect(() => decodeDashboardHistory(changed(removed, path, value), ID), path).toThrow(ContractError);
    }
  });
});

describe("écart entre deux révisions", () => {
  const diff = (...changes: unknown[]) => ({ id: ID, base: 1, other: 2, changes });
  const decode = (...changes: unknown[]) => decodeDashboardDiff(diff(...changes), ID, 1, 2);
  const refusedDiff = (change: unknown, label = ""): void => { expect(() => decode(change), label).toThrow(ContractError); };
  const CHILD = "/layout/sections/0/rows/0/columns/0/children/0";
  const node = (extra: Record<string, unknown>) => ({ path: CHILD, kind: "modified", node: "analysis", id: OTHER_ID, before: { presentation: {} }, after: { presentation: { chart: "line" } }, ...extra });
  const header = (extra: Record<string, unknown>) => ({ path: "/name", kind: "modified", node: "dashboard", id: null, before: "A", after: "B", ...extra });
  const moved = (extra: Record<string, unknown>) => ({
    path: CHILD, kind: "moved", node: "analysis", id: OTHER_ID, before: { parent: ID, index: 0 }, after: { parent: OTHER_ID, index: 1 }, ...extra,
  });

  it("lit l'exemple du serveur : en-tête modifié, composant modifié", () => {
    const found = decodeDashboardDiff(body("ecart"), ID, 1, 2);
    expect(found).toMatchObject({ id: ID, base: 1, other: 2 });
    expect(found.changes).toHaveLength(2);
    expect(found.changes[0]).toEqual({ path: "/name", kind: "modified", node: "dashboard", id: null, before: "Pilotage", after: "Révisé" });
    expect(found.changes[1]).toMatchObject({ path: CHILD, kind: "modified", node: "analysis", before: { presentation: {} }, after: { presentation: { chart: "line" } } });
    expect(found.changes[1]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect([...DIFF_KINDS]).toEqual(["added", "removed", "modified", "moved"]);
    expect([...TOP_PARENTS]).toEqual(["layout", "filters"]);
    expect(DIFF_NODES).toEqual(["dashboard", "defaults", "section", "row", "column", "filter", "container", "analysis", "kpi", "text", "separator"]);
    expect(decode()).toEqual({ id: ID, base: 1, other: 2, changes: [] });
  });

  it("refuse un écart qui n'est pas celui demandé", () => {
    const found = body("ecart");
    expect(() => decodeDashboardDiff(found, OTHER_ID, 1, 2)).toThrow("dashboard et révisions demandés");
    expect(() => decodeDashboardDiff(found, ID, 2, 1)).toThrow(ContractError);
    expect(() => decodeDashboardDiff(found, ID, 1, 3)).toThrow(ContractError);
    for (const [path, value] of [["extra", 1], ["changes", undefined], ["changes", {}], ["changes.0", null], ["changes.0.extra", 1], ["changes.0.before", undefined], ["changes.0.path", "name"], ["changes.0.path", "/a b"], ["changes.0.path", ""], ["changes.0.path", 3], ["changes.0.kind", "renamed"], ["changes.0.node", "page"]] as const) {
      expect(() => decodeDashboardDiff(changed(found, path, value), ID, 1, 2), path).toThrow(ContractError);
    }
    for (const value of [null, [], "x"]) expect(() => decodeDashboardDiff(value, ID, 1, 2)).toThrow(ContractError);
  });

  it("lit un écart réel du serveur, tous genres de nœuds et de changements confondus, sans rien y changer", () => {
    // Sortie de `dashboard.diff` sur deux documents valides (en-tête, défauts, sections, filtres, composants de chaque genre).
    const real = REAL as unknown as Record<string, unknown>[];
    const found = decode(...real);
    expect(found.changes).toEqual(real);
    const kinds = Object.fromEntries(DIFF_KINDS.map((kind) => [kind, real.filter((one) => one.kind === kind).length]));
    expect(kinds).toEqual({ added: 13, removed: 6, modified: 13, moved: 2 });
    expect(new Set(real.map((one) => one.node))).toEqual(new Set(DIFF_NODES));
  });

  it("refuse tout champ en plus ou hors domaine dans le before ou l'after d'un écart réel", () => {
    const real = REAL as unknown as Record<string, unknown>[];
    for (const [index, one] of real.entries()) {
      for (const side of ["before", "after"] as const) {
        const value = one[side];
        if (value === null) continue;
        const extra = typeof value === "object" ? { ...value, sql: "SELECT 1" } : { sql: "SELECT 1" };
        refusedDiff({ ...one, [side]: extra }, `${String(index)} ${side} champ en plus`);
        refusedDiff({ ...one, [side]: [] }, `${String(index)} ${side} tableau`);
        refusedDiff({ ...one, [side]: 3 }, `${String(index)} ${side} nombre`);
      }
    }
  });

  it("juge l'en-tête : jamais d'identifiant, de déplacement, d'ajout ni de retrait, une valeur du schéma qui change", () => {
    const leaves: [string, unknown, unknown][] = [
      ["/name", "A", "B"], ["/description", "", "Suivi"], ["/description", "a\nb", "c"], ["/visibility", "personal", "shared"], ["/owner/issuer", "https://a", "https://b"], ["/owner/subject", "x", "y"],
    ];
    for (const [path, before, after] of leaves) expect(decode(header({ path, before, after })).changes, path).toEqual([header({ path, before, after })]);
    for (const bad of [
      header({ id: OTHER_ID }), header({ id: "x" }), header({ id: undefined }), header({ kind: "moved" }), header({ kind: "added", before: null, after: "B" }), header({ kind: "removed", before: "A", after: null }),
      header({ path: "/owner" }), header({ path: "/id" }), header({ path: "/layout" }), header({ path: "/filters" }), header({ path: "/defaults/legend" }), header({ path: "/name/x" }), header({ path: "/constructor" }), header({ path: "/__proto__" }),
      header({ node: "defaults" }), header({ before: null }), header({ after: null }), header({ before: undefined }), header({ before: "A", after: "A" }),
      header({ before: { a: 1 } }), header({ after: ["B"] }), header({ before: 3 }), header({ before: "" }), header({ after: "a".repeat(121) }), header({ after: "a\u0000b" }),
      header({ path: "/description", before: "a", after: "a".repeat(2001) }), header({ path: "/description", before: "a", after: "a\u0007" }),
      header({ path: "/visibility", before: "personal", after: "public" }), header({ path: "/visibility", before: "personal", after: "Shared" }),
      header({ path: "/owner/issuer", before: "a", after: "" }), header({ path: "/owner/subject", before: "a", after: "b".repeat(513) }), header({ path: "/owner/subject", before: "a", after: { sql: "secret" } }),
    ]) {
      refusedDiff(bad, JSON.stringify(bad));
    }
    refusedDiff(header({ after: { sql: "secret" } }), "sql");
  });

  it("juge les défauts : trois champs facultatifs, ajoutés, retirés ou modifiés, chacun à ses valeurs", () => {
    const defaults = (extra: Record<string, unknown>) => ({ path: "/defaults/legend", kind: "modified", node: "defaults", id: null, before: "auto", after: "shown", ...extra });
    for (const [path, before, after] of [["/defaults/legend", "auto", "hidden"], ["/defaults/number_format", "integer", "decimal_2"], ["/defaults/tooltip", "value", "value_and_definition"]] as const) {
      expect(decode(defaults({ path, before, after })).changes).toHaveLength(1);
      expect(decode(defaults({ path, kind: "added", before: null, after })).changes[0]).toMatchObject({ kind: "added", before: null, after });
      expect(decode(defaults({ path, kind: "removed", before, after: null })).changes[0]).toMatchObject({ kind: "removed", after: null, before });
    }
    for (const bad of [
      defaults({ id: OTHER_ID }), defaults({ kind: "moved" }), defaults({ path: "/defaults" }), defaults({ path: "/defaults/chart" }), defaults({ path: "/defaults/legend/x" }), defaults({ path: "/name" }), defaults({ path: "/defaults/number_format" }),
      defaults({ after: "auto" }), defaults({ after: "left" }), defaults({ before: "LEFT" }), defaults({ after: { sql: "x" } }), defaults({ after: null }), defaults({ before: null }),
      defaults({ kind: "added", before: "auto" }), defaults({ kind: "added", before: null, after: "left" }), defaults({ kind: "added", before: null, after: null }),
      defaults({ kind: "removed", after: "auto", before: "auto" }), defaults({ kind: "removed", before: "left", after: null }), defaults({ kind: "removed", before: null, after: null }),
    ]) {
      refusedDiff(bad, JSON.stringify(bad));
    }
  });

  /** Champs propres d'un nœud entier, tels que le serveur les rend pour un ajout ou un retrait : valides, puis hors schéma. */
  const REF = { analysis_id: OTHER_ID, revision: 2 };
  const PARAGRAPH = { type: "paragraph", content: [{ text: "x" }] };
  const FILTER = { label: "Région", dimension: "region", operator: "eq", targets: [ID] };
  const OWNS: Record<string, { ok: Record<string, unknown>[]; bad: Record<string, unknown>[] }> = {
    section: { ok: [{}, { title: "Ventes" }], bad: [{ title: "" }, { title: "a".repeat(121) }, { title: 3 }, { title: "Ventes", sql: "x" }, { rows: [] }, { id: ID }, { sql: "SELECT 1" }] },
    row: { ok: [{}], bad: [{ columns: [] }, { id: ID }, { sql: "SELECT 1" }, { span: 4 }] },
    column: { ok: [{ span: 1 }, { span: 12 }], bad: [{}, { span: 0 }, { span: 13 }, { span: 1.5 }, { span: "4" }, { span: 4, children: [] }, { span: 4, sql: "x" }] },
    filter: {
      ok: [
        FILTER, { ...FILTER, default: "a" }, { ...FILTER, default: 3, allowed: [3, 4] }, { ...FILTER, operator: "in", default: ["a", "b"], allowed: ["a", "b", "c"] },
        { ...FILTER, operator: "between", default: [1, 10], allowed: [1, 5, 10] },
      ],
      bad: [
        {}, { ...FILTER, id: ID }, { ...FILTER, sql: "x" }, { ...FILTER, label: undefined }, { ...FILTER, label: "" }, { ...FILTER, label: "a".repeat(81) }, { ...FILTER, dimension: "x y" }, { ...FILTER, dimension: "x;drop" },
        { ...FILTER, operator: "like" }, { ...FILTER, targets: [] }, { ...FILTER, targets: [ID, ID] }, { ...FILTER, targets: ["x"] }, { ...FILTER, targets: undefined }, { ...FILTER, default: ["a"] }, { ...FILTER, default: { sql: "x" } },
        { ...FILTER, operator: "in", default: "a" }, { ...FILTER, operator: "between", default: [1, 2, 3] }, { ...FILTER, operator: "between", default: [2, 1] }, { ...FILTER, operator: "between", default: [1, "a"] },
        { ...FILTER, default: "c", allowed: ["a", "b"] }, { ...FILTER, allowed: [] }, { ...FILTER, allowed: ["a", "a"] }, { ...FILTER, allowed: "a" }, { ...FILTER, allowed: [1, "a"] }, { ...FILTER, default: "SELECT 1; --" },
      ],
    },
    container: { ok: [{ type: "container" }], bad: [{}, { type: "analysis" }, { type: "container", rows: [] }, { type: "container", sql: "x" }] },
    analysis: {
      ok: [
        { type: "analysis", reference: REF, presentation: {} }, { type: "analysis", reference: REF, presentation: { chart: "line", legend: "hidden", number_format: "percent", tooltip: "value", title: "T", threshold: { value: 1.5, label: "Cible" } } },
      ],
      bad: [
        {}, { type: "analysis", reference: REF }, { type: "analysis", presentation: {} }, { type: "kpi", reference: REF, presentation: {} }, { type: "analysis", reference: REF, presentation: {}, query: "SELECT 1" },
        { type: "analysis", reference: { ...REF, sql: "x" }, presentation: {} }, { type: "analysis", reference: { analysis_id: "x", revision: 1 }, presentation: {} }, { type: "analysis", reference: { ...REF, revision: 0 }, presentation: {} },
        { type: "analysis", reference: { analysis_id: OTHER_ID }, presentation: {} }, { type: "analysis", reference: REF, presentation: { sql: "SELECT 1" } }, { type: "analysis", reference: REF, presentation: { chart: "pie3d" } },
        { type: "analysis", reference: REF, presentation: { threshold: { value: 1 } } }, { type: "analysis", reference: REF, presentation: { color: "#fff" } }, { type: "analysis", reference: REF, presentation: [] },
      ],
    },
    kpi: {
      ok: [{ type: "kpi", reference: REF, presentation: {} }, { type: "kpi", reference: REF, presentation: { title: "T", number_format: "compact", tooltip: "value_and_definition", threshold: { value: -2, label: "x" } } }],
      bad: [{ type: "kpi", reference: REF, presentation: { chart: "line" } }, { type: "kpi", reference: REF, presentation: { legend: "hidden" } }, { type: "analysis", reference: REF, presentation: {} }, { type: "kpi", reference: REF }],
    },
    text: {
      ok: [
        { type: "text", blocks: [PARAGRAPH] },
        { type: "text", blocks: [{ type: "heading", level: 2, content: [{ text: "T", strong: true }] }, { type: "list", ordered: false, items: [[{ text: "a", emphasis: true }], [{ text: "b" }]] }] },
      ],
      bad: [
        {}, { type: "text" }, { blocks: [PARAGRAPH] }, { type: "text", blocks: [PARAGRAPH], sql: "x" }, { type: "text", blocks: [{ type: "html", content: "<b>" }] }, { type: "text", blocks: [{ type: "paragraph", content: [{ text: "x", href: "u" }] }] },
        { type: "text", blocks: [{ type: "paragraph", content: [] }] }, { type: "text", blocks: [{ type: "heading", level: 3, content: [{ text: "x" }] }] }, { type: "text", blocks: [{ ...PARAGRAPH, extra: 1 }] },
        { type: "text", blocks: [{ type: "paragraph", content: [{ text: "a".repeat(1000) }, { text: "b".repeat(1000) }, { text: "c".repeat(1000) }, { text: "d".repeat(1000) }, { text: "e".repeat(1000) }, { text: "f" }] }] },
        { type: "text", blocks: "x" },
      ],
    },
    separator: { ok: [{ type: "separator" }], bad: [{}, { type: "separator", x: 1 }, { type: "text" }, { type: "separator", sql: "x" }] },
  };
  const PATHS: Record<string, string> = {
    section: "/layout/sections/0", filter: "/filters/0", row: "/layout/sections/0/rows/0", column: "/layout/sections/0/rows/0/columns/0", container: CHILD, analysis: CHILD, kpi: CHILD, text: CHILD, separator: CHILD,
  };
  const entire = (type: string, kind: "added" | "removed", own: unknown) => ({ path: PATHS[type] as string, kind, node: type, id: OTHER_ID, before: kind === "added" ? null : own, after: kind === "added" ? own : null });

  it("juge les champs propres d'un nœud ajouté ou retiré, genre par genre : un nœud entier du schéma, rien de plus", () => {
    expect(Object.keys(OWNS)).toEqual(DIFF_NODES.filter((type) => type !== "dashboard" && type !== "defaults"));
    for (const [type, { ok, bad }] of Object.entries(OWNS)) {
      for (const own of ok) {
        for (const kind of ["added", "removed"] as const) expect(decode(entire(type, kind, own)).changes, `${type} ${kind} ${JSON.stringify(own)}`).toEqual([entire(type, kind, own)]);
      }
      for (const own of bad) {
        for (const kind of ["added", "removed"] as const) refusedDiff(entire(type, kind, own), `${type} ${kind} ${JSON.stringify(own)}`);
      }
    }
  });

  it("garde le côté absent d'un ajout ou d'un retrait", () => {
    const own = { type: "analysis", reference: REF, presentation: {} };
    refusedDiff({ ...entire("analysis", "added", own), before: {} });
    refusedDiff({ ...entire("analysis", "added", own), before: own });
    refusedDiff({ ...entire("analysis", "added", own), after: null });
    refusedDiff({ ...entire("analysis", "removed", own), after: {} });
    refusedDiff({ ...entire("analysis", "removed", own), before: null });
    refusedDiff({ ...entire("analysis", "removed", own), after: own });
    refusedDiff({ ...entire("analysis", "added", own), before: undefined });
  });

  it("juge une modification : seuls les champs propres qui diffèrent, chacun à sa valeur, jamais `type`", () => {
    const modify = (type: string, before: unknown, after: unknown) => ({ path: PATHS[type] as string, kind: "modified", node: type, id: OTHER_ID, before, after });
    for (const good of [
      modify("section", { title: "A" }, { title: "B" }), modify("section", { title: "A" }, {}), modify("section", {}, { title: "B" }),
      modify("column", { span: 4 }, { span: 5 }),
      modify("analysis", { presentation: {} }, { presentation: { chart: "line" } }), modify("analysis", { reference: REF, presentation: {} }, { reference: { ...REF, revision: 3 }, presentation: { legend: "hidden" } }),
      modify("kpi", { presentation: { title: "A" } }, { presentation: {} }),
      modify("text", { blocks: [PARAGRAPH] }, { blocks: [] }),
      modify("filter", { label: "A" }, { label: "B" }), modify("filter", { operator: "eq", default: "a" }, { operator: "in", default: ["a", "b"] }), modify("filter", {}, { default: "a" }), modify("filter", { default: ["a", "b"] }, {}),
      modify("filter", { allowed: ["a", "b"] }, { allowed: ["a", "c"] }), modify("filter", { allowed: ["a"] }, {}), modify("filter", { targets: [ID] }, { targets: [ID, OTHER_ID] }), modify("filter", { dimension: "a" }, { dimension: "b" }),
    ]) {
      expect(decode(good).changes, JSON.stringify(good)).toEqual([good]);
    }
    for (const bad of [
      modify("section", {}, {}), modify("section", { title: "A" }, { title: "A" }), modify("section", { title: "A" }, { title: "" }), modify("section", { sql: "secret" }, { sql: "other" }), modify("section", { title: "A" }, { title: "B", sql: "secret" }),
      modify("section", { title: "A", sql: "x" }, { title: "B" }), modify("section", { rows: [] }, { rows: [{}] }), modify("section", { id: ID }, { id: OTHER_ID }),
      modify("row", {}, {}), modify("row", { columns: [] }, { columns: [] }), modify("container", { type: "container" }, { type: "container" }), modify("container", { rows: [] }, { rows: [{}] }),
      modify("separator", {}, {}), modify("separator", { type: "separator" }, { type: "separator" }),
      modify("column", { span: 4 }, {}), modify("column", {}, { span: 4 }), modify("column", { span: 4 }, { span: 13 }), modify("column", { span: 4 }, { span: "5" }),
      modify("analysis", { presentation: {} }, { presentation: {} }), modify("analysis", { type: "analysis" }, { type: "analysis" }), modify("analysis", { presentation: {} }, {}), modify("analysis", {}, { presentation: {} }),
      modify("analysis", { presentation: {} }, { presentation: { sql: "x" } }), modify("analysis", { presentation: { chart: "line" } }, { presentation: { chart: "line" } }), modify("analysis", { reference: REF }, { reference: { ...REF, sql: "x" } }),
      modify("kpi", { presentation: {} }, { presentation: { chart: "line" } }), modify("text", { blocks: [PARAGRAPH] }, { blocks: [PARAGRAPH] }), modify("text", { blocks: [PARAGRAPH] }, { blocks: [{ type: "html" }] }),
      modify("filter", { label: "A" }, { label: "" }), modify("filter", { label: "A" }, { label: "A" }), modify("filter", { default: "a" }, { default: { sql: "x" } }), modify("filter", {}, { default: [] }), modify("filter", {}, { default: [["a"]] }),
      modify("filter", { label: "A" }, {}), modify("filter", {}, { operator: "in" }), modify("filter", {}, { targets: [] }), modify("filter", {}, { targets: [ID, ID] }), modify("filter", {}, { allowed: [] }), modify("filter", {}, { allowed: "a" }),
      modify("filter", {}, { operator: "like" }), modify("filter", {}, { sql: "x" }), modify("filter", { targets: [ID] }, { targets: [ID] }), modify("filter", {}, { id: OTHER_ID }),
      modify("section", null, { title: "A" }), modify("section", { title: "A" }, null), modify("section", [], {}), modify("section", { title: "A" }, "x"),
    ]) {
      refusedDiff(bad, JSON.stringify(bad));
    }
    // Un nombre égal des deux côtés reste lu : le serveur y voit un écart quand `1` est devenu `1.0`, ce que JSON.parse ne montre pas.
    expect(decode(modify("column", { span: 4 }, { span: 4 })).changes).toHaveLength(1);
    expect(decode(modify("filter", { default: 1 }, { default: 1 })).changes).toHaveLength(1);
  });

  it("lit un déplacement {parent, index} : un parent connu et un rang, le même parent et le même rang compris", () => {
    // Sortie de `dashboard.diff` : trois colonnes [A, B, C] retournées en [C, B, A] ; la plus longue suite croissante ne garde
    // que C, donc B est dit déplacé alors qu'il reste au rang 1.
    const row = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const reversed = [
      { path: "/layout/sections/0/rows/0/columns/1", kind: "moved", node: "column", id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", before: { parent: row, index: 1 }, after: { parent: row, index: 1 } },
      { path: "/layout/sections/0/rows/0/columns/2", kind: "moved", node: "column", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", before: { parent: row, index: 0 }, after: { parent: row, index: 2 } },
    ];
    expect(decode(...reversed).changes).toEqual(reversed);
    const found = decode(moved({})).changes[0];
    expect(found).toEqual({ path: CHILD, kind: "moved", node: "analysis", id: OTHER_ID, before: { parent: ID, index: 0 }, after: { parent: OTHER_ID, index: 1 } });
    expect(decode(moved({ after: { parent: ID, index: 3 } })).changes).toHaveLength(1);
    // Une section vit sous la mise en page, un filtre sous la liste des filtres : ni l'un ni l'autre sous un nœud.
    const sectionPath = "/layout/sections/1";
    expect(decode(moved({ node: "section", path: sectionPath, before: { parent: "layout", index: 0 }, after: { parent: "layout", index: 1 } })).changes[0]).toMatchObject({ kind: "moved", node: "section" });
    expect(decode(moved({ node: "section", path: sectionPath, before: { parent: "layout", index: 1 }, after: { parent: "layout", index: 1 } })).changes).toHaveLength(1);
    expect(decode(moved({ node: "filter", path: "/filters/1", before: { parent: "filters", index: 0 }, after: { parent: "filters", index: 1 } })).changes[0]).toMatchObject({ node: "filter" });
    for (const parent of [ID, "filters"]) refusedDiff(moved({ node: "section", path: sectionPath, before: { parent: "layout", index: 0 }, after: { parent, index: 1 } }), `section ${parent}`);
    for (const parent of [ID, "layout"]) refusedDiff(moved({ node: "filter", path: "/filters/1", before: { parent: "filters", index: 0 }, after: { parent, index: 1 } }), `filter ${parent}`);
    for (const parent of ["layout", "filters"]) {
      refusedDiff(moved({ after: { parent, index: 1 } }), `analysis ${parent}`);
      refusedDiff(moved({ before: { parent, index: 1 } }), `analysis ${parent}`);
      refusedDiff(moved({ node: "row", path: "/layout/sections/0/rows/1", after: { parent, index: 1 } }), `row ${parent}`);
    }
    for (const place of [
      { parent: ID }, { index: 0 }, { parent: ID, index: -1 }, { parent: ID, index: 1.5 }, { parent: ID, index: "1" }, { parent: ID, index: 2 ** 53 }, { parent: "x", index: 0 }, { parent: ID.toUpperCase(), index: 0 },
      { parent: 3, index: 0 }, { parent: ID, index: 0, path: "/x" }, { parent: null, index: 0 }, "layout", null, [], 3,
    ]) {
      refusedDiff(moved({ before: place }), JSON.stringify(place));
      refusedDiff(moved({ after: place }), JSON.stringify(place));
    }
    // Un déplacement garde un identifiant et le chemin de son nœud.
    refusedDiff(moved({ id: null }));
    refusedDiff(moved({ path: "/layout/sections/0" }));
  });

  it("juge chaque nœud à son chemin : section, filtre, rangée, colonne, conteneur et feuilles, rangées imbriquées comprises", () => {
    const inside = "/layout/sections/1/rows/2/columns/0/children/3";
    const nested = `${inside}/rows/1`;
    const paths: Record<string, readonly [string, readonly string[]]> = {
      section: ["/layout/sections/0", ["/layout/sections", "/layout/sections/0/rows/0", "/filters/0", "/layout/sections/x"]],
      filter: ["/filters/4", ["/filters", "/layout/sections/0", "/filters/0/targets/0", "/filters/x"]],
      row: ["/layout/sections/0/rows/1", [CHILD, "/layout/sections/0/rows", "/layout/sections/0/rows/1/columns/0", "/layout/sections/0/rows/x"]],
      column: ["/layout/sections/0/rows/0/columns/1", ["/layout/sections/0/rows/0", CHILD, "/layout/sections/0/columns/1"]],
      container: [CHILD, ["/layout/sections/0/rows/0/columns/0", `${CHILD}/rows/0`, "/layout/sections/0/rows/0/children/0"]],
      analysis: [CHILD, ["/layout/sections/0/rows/0/columns/0", `${CHILD}/rows/0`, "/layout/sections/0"]],
      kpi: [CHILD, ["/layout/sections/0/rows/0/columns/0/children", "/filters/0"]],
      text: [CHILD, ["/layout/sections/0/rows/0/columns/0/children/0/blocks/0"]],
      separator: [CHILD, ["/name"]],
    };
    const at = (type: string, path: string) => ({ ...entire(type, "added", (OWNS[type] as { ok: Record<string, unknown>[] }).ok[0]), path });
    for (const [type, [good, bad]] of Object.entries(paths)) {
      expect(decode(at(type, good)).changes, type).toHaveLength(1);
      for (const path of bad) refusedDiff(at(type, path), `${type} ${path}`);
    }
    // Sous un conteneur : la rangée, la colonne et la feuille gardent leur place dans le document.
    expect(decode(at("row", nested)).changes).toHaveLength(1);
    expect(decode(at("column", `${nested}/columns/2`)).changes).toHaveLength(1);
    expect(decode(at("analysis", `${nested}/columns/2/children/0`)).changes).toHaveLength(1);
    expect(decode(at("container", `${nested}/columns/2/children/0/rows/0/columns/1/children/1`)).changes).toHaveLength(1);
    refusedDiff(at("analysis", `${nested}/columns/2`));
    refusedDiff(at("row", `${nested}/columns/2`));
    refusedDiff(node({ id: null }));
    refusedDiff(node({ id: "x" }));
    refusedDiff(node({ id: undefined }));
  });
});
