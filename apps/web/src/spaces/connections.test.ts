import { describe, expect, it, vi, type Mock } from "vitest";

import type { Fetch } from "./api";
import {
  CONNECTION_NAME, ENDPOINT_KEY, createConnection, decodeConnection,
  decodeConnections, decodeProbe, fetchConnections, removeConnection, removeConnectionBinding,
  removeConnectionCredential, setConnectionBinding, setConnectionCredential, testConnection,
  createEndpoint, decodeEndpoint, decodeEndpoints, fetchEndpoints, removeEndpoint,
} from "./connections";

const ENDPOINT = { key: "azure-test", host: "https://adb-123.2.azuredatabricks.net", warehouse_id: "abc123" };

const REF = { issuer: "https://id.example.invalid", subject: "admin" };
const AT = "2026-11-03T10:00:00+00:00";
const EMPTY = (environment: string) => ({ environment, state: "unconfigured" });
const BOUND = (environment: string, extra: Record<string, unknown> = {}) => ({
  environment, connector: "databricks", endpoint_key: "warehouse-prod", identity_mode: "service",
  set_at: AT, set_by: REF, credential_state: "configured", ...extra,
});
const CONNECTION = (name = "finance", bindings: unknown[] = [BOUND("DEV"), EMPTY("TEST"), EMPTY("PROD")]) => ({
  name, created_at: AT, created_by: REF, bindings,
});
const response = (body: unknown, status = 200) => status === 204 ? new Response(null, { status }) : Response.json(body, { status });
const fetcher = (body: unknown, status = 200): Mock<Fetch> => vi.fn<Fetch>().mockImplementation(() => Promise.resolve(response(body, status)));

describe("points d'accès Databricks saisis dans Board", () => {
  it("décode la liste triée et refuse les valeurs hors contrat", () => {
    expect(decodeEndpoint(ENDPOINT, "point")).toEqual({ key: "azure-test", host: ENDPOINT.host, warehouseId: "abc123" });
    expect(decodeEndpoints({ endpoints: [ENDPOINT] })).toHaveLength(1);
    for (const bad of [
      { ...ENDPOINT, key: "Bad" }, { ...ENDPOINT, host: "https://evil.invalid" },
      { ...ENDPOINT, warehouse_id: "a/b" },
    ]) expect(() => decodeEndpoint(bad, "point")).toThrow();
    expect(() => decodeEndpoints({ endpoints: [ENDPOINT, ENDPOINT] })).toThrow();
    expect(() => decodeEndpoints({ endpoints: [{ ...ENDPOINT, key: "z" }, ENDPOINT] })).toThrow();
  });

  it("lit, crée et retire un point d'accès, avec décodage de la réponse", async () => {
    const signal = new AbortController().signal;
    const listSource = fetcher({ endpoints: [ENDPOINT] });
    expect((await fetchEndpoints("finance", signal, listSource)).status).toBe("ok");
    expect(listSource).toHaveBeenCalledWith("/api/spaces/finance/connection-endpoints", expect.objectContaining({ method: "GET", signal }));
    const source = fetcher(ENDPOINT);
    const item = { key: ENDPOINT.key, host: ENDPOINT.host, warehouseId: ENDPOINT.warehouse_id };
    expect((await createEndpoint("finance", item, source)).status).toBe("ok");
    expect(JSON.parse(source.mock.calls[0]?.[1]?.body as string)).toEqual(ENDPOINT);
    for (const wrong of [
      { ...item, key: "other" }, { ...item, host: "https://adb-999.2.azuredatabricks.net" },
      { ...item, warehouseId: "other" },
    ]) expect((await createEndpoint("finance", wrong, source)).status).toBe("error");
    const deleted = fetcher(null, 204);
    expect((await removeEndpoint("finance", "azure-test", deleted)).status).toBe("ok");
    expect(deleted).toHaveBeenCalledWith("/api/spaces/finance/connection-endpoints/azure-test", expect.objectContaining({ method: "DELETE" }));
  });
});

describe("contrat des connexions du serveur", () => {
  it("lit les trois environnements ordonnés et ne conserve aucun champ secret inattendu", () => {
    const raw = CONNECTION();
    const found = decodeConnections({ connections: [raw] });
    expect(found).toHaveLength(1);
    expect(found[0]?.bindings.map((binding) => binding.environment)).toEqual(["DEV", "TEST", "PROD"]);
    expect(found[0]?.bindings[0]).toMatchObject({ state: "configured", endpointKey: "warehouse-prod", credentialState: "configured" });
    expect(JSON.stringify(found)).not.toContain("secret");
    expect(CONNECTION_NAME.test("finance_1")).toBe(true);
    expect(ENDPOINT_KEY.test("warehouse-prod")).toBe(true);
  });

  it.each([
    [CONNECTION("Bad"), "name"],
    [CONNECTION("finance", [EMPTY("TEST"), EMPTY("DEV"), EMPTY("PROD")]), "bindings"],
    [CONNECTION("finance", [EMPTY("DEV"), EMPTY("DEV"), EMPTY("PROD")]), "bindings"],
    [CONNECTION("finance", [BOUND("DEV", { endpoint_key: "https://evil" }), EMPTY("TEST"), EMPTY("PROD")]), "endpoint_key"],
    [CONNECTION("finance", [BOUND("DEV", { identity_mode: "person" }), EMPTY("TEST"), EMPTY("PROD")]), "credential_state"],
    [CONNECTION("finance", [EMPTY("DEV"), { environment: "TEST", state: "unknown" }, EMPTY("PROD")]), "state"],
  ])("refuse une connexion incohérente (%s)", (raw, detail) => {
    expect(() => decodeConnection(raw, "connexion")).toThrow(detail);
  });

  it("refuse deux connexions de même nom", () => {
    expect(() => decodeConnections({ connections: [CONNECTION(), CONNECTION()] })).toThrow("noms distincts");
  });

  it("lit un essai cohérent, avec expiration inconnue ou datée", () => {
    expect(decodeProbe({ identity: "service", credential_expires_at: null, can_cancel: true, state: "RUNNING" })).toMatchObject({ identity: "service", credentialExpiresAt: null });
    expect(decodeProbe({ identity: "local", credential_expires_at: AT, can_cancel: false, state: "available" }).credentialExpiresAt).toBeInstanceOf(Date);
  });

  it.each([
    { identity: "local", credential_expires_at: null, can_cancel: true, state: "available" },
    { identity: "service", credential_expires_at: null, can_cancel: true, state: "available" },
    { identity: "service", credential_expires_at: null, can_cancel: true, state: "UNKNOWN" },
  ])("refuse un essai hors contrat", (raw) => { expect(() => decodeProbe(raw)).toThrow(); });
});

describe("appels du registre", () => {
  it("lit les connexions avec signal et décode la réponse", async () => {
    const source = fetcher({ connections: [CONNECTION()] });
    const signal = new AbortController().signal;
    expect((await fetchConnections("finance", signal, source)).status).toBe("ok");
    expect(source).toHaveBeenCalledWith("/api/spaces/finance/connections", expect.objectContaining({ method: "GET", signal }));
  });

  it("crée une connexion nommée et refuse la réponse d'un autre nom", async () => {
    const source = fetcher(CONNECTION());
    expect((await createConnection("finance", "finance", source)).status).toBe("ok");
    expect(JSON.parse(source.mock.calls[0]?.[1]?.body as string)).toEqual({ name: "finance" });
    expect((await createConnection("finance", "other", source)).status).toBe("error");
  });

  it("enregistre une liaison sur le bon environnement et refuse une réponse déplacée", async () => {
    const source = fetcher(BOUND("DEV"));
    expect((await setConnectionBinding("finance", "source", "DEV", "databricks", "warehouse-prod", "service", source)).status).toBe("ok");
    expect(source).toHaveBeenCalledWith("/api/spaces/finance/connections/source/bindings/DEV", expect.objectContaining({ method: "PUT" }));
    expect(JSON.parse(source.mock.calls[0]?.[1]?.body as string)).toEqual({ connector: "databricks", endpoint_key: "warehouse-prod", identity_mode: "service" });
    expect((await setConnectionBinding("finance", "source", "TEST", "databricks", "warehouse-prod", "service", source)).status).toBe("error");
    const empty = fetcher(EMPTY("DEV"));
    expect((await setConnectionBinding("finance", "source", "DEV", "duckdb", "local", "service", empty)).status).toBe("error");
  });

  it("supprime connexion, liaison et identifiant, sans corps", async () => {
    const source = fetcher(null, 204);
    expect((await removeConnection("finance", "source", source)).status).toBe("ok");
    expect((await removeConnectionBinding("finance", "source", "DEV", source)).status).toBe("ok");
    expect((await removeConnectionCredential("finance", "source", "DEV", source)).status).toBe("ok");
    expect(source.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`)).toEqual([
      "DELETE /api/spaces/finance/connections/source",
      "DELETE /api/spaces/finance/connections/source/bindings/DEV",
      "DELETE /api/spaces/finance/connections/source/bindings/DEV/credential",
    ]);
  });

  it("écrit un secret sans le relire", async () => {
    const source = fetcher(null, 204);
    expect((await setConnectionCredential("finance", "source", "DEV", "secret-sentinelle", source)).status).toBe("ok");
    expect(JSON.parse(source.mock.calls[0]?.[1]?.body as string)).toEqual({ secret: "secret-sentinelle" });
    expect(source.mock.results[0]?.value).not.toContain("secret-sentinelle");
  });

  it("essaie une liaison sans corps de requête", async () => {
    const source = fetcher({ identity: "service", credential_expires_at: null, can_cancel: true, state: "RUNNING" });
    expect((await testConnection("finance", "source", "DEV", source)).status).toBe("ok");
    expect(source).toHaveBeenCalledWith("/api/spaces/finance/connections/source/bindings/DEV/test", expect.objectContaining({ method: "POST" }));
    expect(source.mock.calls[0]?.[1]?.body).toBeUndefined();
  });
});
