import { describe, expect, it } from "vitest";
import { refusalOf } from "../spaces/admin";
import { decodeConsumers } from "../analyses/model";
import { route as analysisRoute } from "../analyses/testing";
import { decodeDashboardDiff, decodeDashboardHistory, decodeDashboardList, decodeDashboardRevision } from "./model";
import { DASHBOARD_REFUSALS } from "./refusal";
import { ID, ROUTE_NAMES, route } from "./testing";

const revision = (name: string) => decodeDashboardRevision(route(name).body, "finance");
const history = (name: string) => decodeDashboardHistory(route(name).body, ID);
const refusal = (name: string) => {
  const found = refusalOf(route(name).body);
  expect(found, name).not.toBeNull();
  expect(DASHBOARD_REFUSALS).toContain(found?.code);
  expect([403, 404, 409, 422, 503]).toContain(route(name).status);
};

/** Chaque exemple du serveur réel a son décodeur : aucun fichier de `contracts/dashboards/routes/` n'est ignoré. */
const DECODERS: Readonly<Record<string, () => unknown>> = {
  creer: () => revision("creer"),
  dupliquer: () => revision("dupliquer"),
  "dupliquer-nomme": () => revision("dupliquer-nomme"),
  lire: () => revision("lire"),
  "lire-index-perime": () => revision("lire-index-perime"),
  "lire-non-verifie": () => revision("lire-non-verifie"),
  "lire-tuiles": () => revision("lire-tuiles"),
  reviser: () => revision("reviser"),
  "reviser-identique": () => revision("reviser-identique"),
  revision: () => revision("revision"),
  lister: () => decodeDashboardList(route("lister").body),
  "lister-index-perime": () => decodeDashboardList(route("lister-index-perime").body),
  historique: () => history("historique"),
  "historique-supprime": () => history("historique-supprime"),
  ecart: () => decodeDashboardDiff(route("ecart").body, ID, 1, 2),
  supprimer: () => route("supprimer"),
};

describe("exemples du serveur réel", () => {
  it("a un décodeur ou un refus fermé pour chacun des 27 exemples, sans en laisser un seul de côté", () => {
    const refusals = ROUTE_NAMES.filter((name) => name.startsWith("refus-"));
    expect(ROUTE_NAMES).toHaveLength(27);
    expect(refusals).toHaveLength(11);
    expect([...Object.keys(DECODERS), ...refusals].sort()).toEqual(ROUTE_NAMES);
    for (const name of Object.keys(DECODERS)) expect(DECODERS[name], name).not.toThrow();
    for (const name of refusals) refusal(name);
  });

  it("fait échouer un exemple que les tests n'utiliseraient pas", () => {
    const covered = (names: readonly string[]) => [...Object.keys(DECODERS), ...names].sort();
    const refusals = ROUTE_NAMES.filter((name) => name.startsWith("refus-"));
    expect(covered(refusals.slice(1))).not.toEqual(ROUTE_NAMES);
    expect(covered([...refusals, "refus-inventé"])).not.toEqual(ROUTE_NAMES);
    expect(() => route("inconnu")).toThrow("absent");
  });

  it("rend sans corps l'exemple de suppression, avec le statut 204", () => {
    expect(route("supprimer")).toEqual({ status: 204, body: null });
  });

  it("montre chaque état de lecture et chaque état de tuile sur un exemple du serveur", () => {
    expect(revision("lire").state).toBe("ready");
    expect(revision("lire-index-perime").state).toBe("index_stale");
    expect(revision("lire-non-verifie").state).toBe("unverified");
    expect(revision("lire-tuiles").state).toBe("unresolved_reference");
    expect(new Set(["lire", "lire-non-verifie", "lire-tuiles"].flatMap((name) => revision(name).tiles.map((tile) => tile.state)))).toEqual(new Set(["ready", "unverified", "unavailable"]));
    const reasons = revision("lire-tuiles").tiles.flatMap((tile) => (tile.state === "unavailable" ? [tile.reason] : []));
    expect(reasons).toEqual(["analysis_unavailable", "unresolved_reference", "filter_incompatible"]);
  });

  it("montre une suppression, une révision passée et un historique supprimé", () => {
    expect(revision("revision")).toMatchObject({ revision: 1, currentRevision: 2 });
    expect(history("historique-supprime")).toMatchObject({ deleted: true, currentRevision: null });
    expect(history("historique")).toMatchObject({ deleted: false, currentRevision: 2 });
  });

  it("lit les exemples de consommateurs d'une analyse que le serveur donne pour les dashboards", () => {
    // Les consommateurs d'une analyse sont des dashboards : leurs exemples sont ceux de `contracts/analyses/routes/`.
    expect(decodeConsumers(analysisRoute("consommateurs").body, ID)).toMatchObject({ consumers: [{ kind: "dashboard" }], others: 1 });
    expect(decodeConsumers(analysisRoute("consommateurs-aucun").body, ID)).toEqual({ id: ID, consumers: [], others: 0 });
  });
});
