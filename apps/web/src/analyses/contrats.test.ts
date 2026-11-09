import { describe, expect, it } from "vitest";
import { refusalOf } from "../spaces/admin";
import { decodeExecution } from "../executions/model";
import { decodeAnalysisList, decodeConsumers, decodeDiff, decodeHistory, decodeLastExecution, decodeOpened, decodeRevision, decodeUsage } from "./model";
import { ANALYSIS_REFUSALS } from "./refusal";
import { ID, ROUTE_NAMES, route } from "./testing";

const revision = (name: string) => decodeRevision(route(name).body, "finance");
const history = (name: string) => decodeHistory(route(name).body, ID);
const refusal = (name: string) => {
  const found = refusalOf(route(name).body);
  expect(found, name).not.toBeNull();
  expect(ANALYSIS_REFUSALS).toContain(found?.code);
  expect([400, 403, 404, 409, 422, 503]).toContain(route(name).status);
};

/** Chaque exemple du serveur réel a son décodeur : aucun fichier de `contracts/analyses/routes/` n'est ignoré. */
const DECODERS: Readonly<Record<string, () => unknown>> = {
  consommateurs: () => decodeConsumers(route("consommateurs").body, ID),
  "consommateurs-aucun": () => decodeConsumers(route("consommateurs-aucun").body, ID),
  creer: () => revision("creer"),
  dupliquer: () => revision("dupliquer"),
  "dupliquer-nommee": () => revision("dupliquer-nommee"),
  lire: () => revision("lire"),
  "lire-index-perime": () => revision("lire-index-perime"),
  "lire-non-resolue": () => revision("lire-non-resolue"),
  "lire-non-verifiee": () => revision("lire-non-verifiee"),
  reviser: () => revision("reviser"),
  "reviser-identique": () => revision("reviser-identique"),
  revision: () => revision("revision"),
  "revision-supprimee": () => revision("revision-supprimee"),
  lister: () => decodeAnalysisList(route("lister").body),
  "lister-index-perime": () => decodeAnalysisList(route("lister-index-perime").body),
  historique: () => history("historique"),
  "historique-proprietaire": () => history("historique-proprietaire"),
  "historique-revision-masquee": () => history("historique-revision-masquee"),
  "historique-supprimee": () => history("historique-supprimee"),
  ecart: () => decodeDiff(route("ecart").body, ID, 1, 2),
  usage: () => decodeUsage(route("usage").body, ID),
  ouvrir: () => decodeOpened(route("ouvrir").body),
  "ouvrir-non-enregistree": () => decodeOpened(route("ouvrir-non-enregistree").body),
  supprimer: () => route("supprimer"),
  "derniere-execution": () => decodeLastExecution(route("derniere-execution").body, "finance", ID),
  "derniere-execution-aucune": () => decodeLastExecution(route("derniere-execution-aucune").body, "finance", ID),
  "derniere-execution-refusee": () => decodeLastExecution(route("derniere-execution-refusee").body, "finance", ID),
  "executer-avec-reference": () => decodeExecution(route("executer-avec-reference", [['"<state>"', '"queued"'], ['"<started_at>"', "null"]]).body, "finance"),
};

describe("exemples du serveur réel", () => {
  it("a un décodeur ou un refus fermé pour chacun des exemples", () => {
    const refusals = ROUTE_NAMES.filter((name) => name.startsWith("refus-"));
    expect(refusals).toHaveLength(24);
    expect([...Object.keys(DECODERS), ...refusals].sort()).toEqual(ROUTE_NAMES);
    for (const name of Object.keys(DECODERS)) expect(DECODERS[name], name).not.toThrow();
    for (const name of refusals) refusal(name);
  });

  it("lit les consommateurs d'une analyse : les dashboards visibles et le nombre des autres", () => {
    expect(decodeConsumers(route("consommateurs").body, ID)).toMatchObject({ consumers: [{ kind: "dashboard" }], others: 1 });
    expect(decodeConsumers(route("consommateurs-aucun").body, ID)).toEqual({ id: ID, consumers: [], others: 0 });
  });

  it("montre chaque état de lecture sur un exemple du serveur", () => {
    expect(revision("lire").state).toBe("ready");
    expect(revision("lire-index-perime").state).toBe("index_stale");
    expect(revision("lire-non-resolue").state).toBe("unresolved_reference");
    expect(revision("lire-non-verifiee").state).toBe("unverified");
  });
});
