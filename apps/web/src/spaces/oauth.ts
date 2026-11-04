import { boolean, ContractError, instant, list, nullable, object, oneOf, text } from "../catalogue/decode";
import { call, type AdminOutcome } from "./admin";
import type { Fetch } from "./api";
import { DATABRICKS_HOST, decodeEndpoint, decodeProbe, type DatabricksEndpoint, type Probe } from "./connections";

export interface OAuthConnection { host: string; expiresAt: Date }
export interface OAuthStatus { configured: boolean; redirectUri: string | null; connections: readonly OAuthConnection[] }
export interface Warehouse { id: string; name: string; state: string }
export interface Discovery { host: string; expiresAt: Date; warehouses: readonly Warehouse[] }
const path = (space: string) => `/api/spaces/${encodeURIComponent(space)}/databricks-oauth`;

export function decodeOAuthStatus(value: unknown): OAuthStatus {
  const raw = object({ configured: boolean, redirect_uri: nullable(text), connections: list((item: unknown) => {
    const found = object({ host: text, expires_at: instant })(item, "connexion OAuth");
    if (!DATABRICKS_HOST.test(found.host)) throw new ContractError("Workspace OAuth invalide");
    return { host: found.host, expiresAt: found.expires_at };
  }) })(value, "OAuth Databricks");
  if (new Set(raw.connections.map((item) => item.host)).size !== raw.connections.length || (raw.configured && raw.redirect_uri === null)) throw new ContractError("Configuration OAuth incohérente");
  return { configured: raw.configured, redirectUri: raw.redirect_uri, connections: raw.connections };
}

export function decodeDiscovery(value: unknown): Discovery {
  const raw = object({ host: text, expires_at: instant, warehouses: list((item: unknown) => {
    const found = object({ id: text, name: text, state: oneOf(["STARTING", "RUNNING", "STOPPING", "STOPPED", "DELETING", "DELETED"] as const) })(item, "warehouse");
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(found.id) || found.name.trim().length === 0) throw new ContractError("Warehouse invalide");
    return found;
  }) })(value, "découverte Databricks");
  if (!DATABRICKS_HOST.test(raw.host) || new Set(raw.warehouses.map((item) => item.id)).size !== raw.warehouses.length) throw new ContractError("Découverte incohérente");
  return { host: raw.host, expiresAt: raw.expires_at, warehouses: raw.warehouses };
}

export function fetchOAuthStatus(space: string, signal: AbortSignal, fetcher: Fetch): Promise<AdminOutcome<OAuthStatus>> {
  return call({ url: path(space), method: "GET", decode: decodeOAuthStatus }, signal, fetcher);
}

export function startOAuth(space: string, host: string, fetcher: Fetch, returnTo: "connections" | "executions" = "connections"): Promise<AdminOutcome<string>> {
  return call({ url: `${path(space)}/start`, method: "POST", body: returnTo === "connections" ? { host } : { host, return_to: returnTo }, decode: (value) => {
    const raw = object({ authorization_url: text })(value, "autorisation OAuth");
    const parsed = new URL(raw.authorization_url);
    if (parsed.origin !== host || parsed.pathname !== "/oidc/v1/authorize" || parsed.hash !== "" || parsed.username !== "" || parsed.password !== "") throw new ContractError("Adresse d'autorisation invalide");
    return raw.authorization_url;
  } }, undefined, fetcher);
}

export function discoverWarehouses(space: string, host: string, fetcher: Fetch): Promise<AdminOutcome<Discovery>> {
  return call({ url: `${path(space)}/warehouses`, method: "POST", body: { host }, decode: (value) => {
    const found = decodeDiscovery(value);
    if (found.host !== host) throw new ContractError("Workspace demandé attendu");
    return found;
  } }, undefined, fetcher);
}

export function selectWarehouse(space: string, host: string, warehouseId: string, key: string, fetcher: Fetch): Promise<AdminOutcome<DatabricksEndpoint>> {
  return call({ url: `${path(space)}/select`, method: "POST", body: { host, warehouse_id: warehouseId, key }, decode: (value) => {
    const found = decodeEndpoint(value, "point d'accès OAuth");
    if (found.host !== host || found.warehouseId !== warehouseId || found.key !== key) throw new ContractError("Point d'accès demandé attendu");
    return found;
  } }, undefined, fetcher);
}

export function testOAuthConnection(space: string, host: string, warehouseId: string, fetcher: Fetch): Promise<AdminOutcome<Probe>> {
  return call({ url: `${path(space)}/test`, method: "POST", body: { host, warehouse_id: warehouseId }, decode: decodeProbe }, undefined, fetcher);
}

export function disconnectOAuth(space: string, host: string, fetcher: Fetch): Promise<AdminOutcome<null>> {
  return call({ url: path(space), method: "DELETE", body: { host }, decode: () => null }, undefined, fetcher);
}
