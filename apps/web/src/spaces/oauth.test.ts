import { describe, expect, it, vi, type Mock } from "vitest";

import type { Fetch } from "./api";
import { decodeDiscovery, decodeOAuthStatus, discoverWarehouses, disconnectOAuth, fetchOAuthStatus, selectWarehouse, startOAuth, testOAuthConnection } from "./oauth";

const HOST = "https://adb-123.2.azuredatabricks.net";
const EXPIRES = "2026-11-04T12:00:00+00:00";
const ROOT = "/api/spaces/finance/databricks-oauth";
const WAREHOUSE = { id: "wh1", name: "Warehouse", state: "RUNNING" };
const STATUS = { configured: true, redirect_uri: "http://localhost:5174/auth/databricks/callback", connections: [{ host: HOST, expires_at: EXPIRES }] };
const DISCOVERY = { host: HOST, expires_at: EXPIRES, warehouses: [WAREHOUSE] };
const source = (body: unknown, status = 200): Mock<Fetch> => vi.fn<Fetch>().mockResolvedValue(status === 204 ? new Response(null, { status }) : Response.json(body, { status }));

describe("OAuth Databricks : contrats et appels", () => {
  it("lit la configuration et les connexions personnelles", async () => {
    const signal = new AbortController().signal;
    const fetcher = source(STATUS);
    expect((await fetchOAuthStatus("finance", signal, fetcher)).status).toBe("ok");
    expect(fetcher).toHaveBeenCalledWith(ROOT, expect.objectContaining({ method: "GET", signal }));
    expect(decodeOAuthStatus(STATUS).connections[0]?.expiresAt).toEqual(new Date(EXPIRES));
    expect(decodeOAuthStatus({ configured: false, redirect_uri: null, connections: [] }).configured).toBe(false);
    for (const wrong of [
      { ...STATUS, connections: [{ host: "https://evil.invalid", expires_at: EXPIRES }] },
      { ...STATUS, connections: [...STATUS.connections, ...STATUS.connections] },
      { ...STATUS, redirect_uri: null },
    ]) expect(() => decodeOAuthStatus(wrong)).toThrow();
  });

  it("vérifie les warehouses et le workspace de la réponse", async () => {
    expect(decodeDiscovery(DISCOVERY).warehouses).toEqual([WAREHOUSE]);
    for (const wrong of [
      { ...DISCOVERY, host: "https://evil.invalid" },
      { ...DISCOVERY, warehouses: [WAREHOUSE, WAREHOUSE] },
      { ...DISCOVERY, warehouses: [{ ...WAREHOUSE, id: "bad/id" }] },
      { ...DISCOVERY, warehouses: [{ ...WAREHOUSE, name: " " }] },
    ]) expect(() => decodeDiscovery(wrong)).toThrow();
    expect((await discoverWarehouses("finance", HOST, source(DISCOVERY))).status).toBe("ok");
    expect((await discoverWarehouses("finance", HOST, source({ ...DISCOVERY, host: "https://adb-999.2.azuredatabricks.net" }))).status).toBe("error");
  });

  it("ouvre seulement l'autorisation du workspace demandé", async () => {
    const url = `${HOST}/oidc/v1/authorize?state=state&code_challenge=challenge`;
    const fetcher = source({ authorization_url: url });
    expect(await startOAuth("finance", HOST, fetcher)).toEqual({ status: "ok", value: url });
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toEqual({ host: HOST });
    for (const invalid of ["broken", "https://evil.invalid/oidc/v1/authorize", `${HOST}/other`, `${HOST}/oidc/v1/authorize#fragment`, HOST.replace("https://", "https://user@") + "/oidc/v1/authorize", HOST.replace("https://", "https://:pass@") + "/oidc/v1/authorize"]) {
      expect((await startOAuth("finance", HOST, source({ authorization_url: invalid }))).status).toBe("error");
    }
  });

  it("enregistre exactement la sélection, teste et déconnecte sans jeton dans le navigateur", async () => {
    const endpoint = { key: "databricks_test", host: HOST, warehouse_id: "wh1" };
    const fetcher = source(endpoint);
    expect((await selectWarehouse("finance", HOST, "wh1", "databricks_test", fetcher)).status).toBe("ok");
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toEqual(endpoint);
    for (const wrong of [{ ...endpoint, host: "https://adb-999.2.azuredatabricks.net" }, { ...endpoint, warehouse_id: "other" }, { ...endpoint, key: "other" }]) {
      expect((await selectWarehouse("finance", HOST, "wh1", "databricks_test", source(wrong))).status).toBe("error");
    }
    expect((await testOAuthConnection("finance", HOST, "wh1", source({ identity: "person", credential_expires_at: EXPIRES, can_cancel: true, state: "RUNNING" }))).status).toBe("ok");
    const remove = source(null, 204);
    expect(await disconnectOAuth("finance", HOST, remove)).toEqual({ status: "ok", value: null });
    expect(remove).toHaveBeenCalledWith(ROOT, expect.objectContaining({ method: "DELETE", body: JSON.stringify({ host: HOST }) }));
  });
});
