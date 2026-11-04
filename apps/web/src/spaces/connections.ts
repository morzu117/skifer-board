import { boolean, ContractError, instant, list, nullable, object, oneOf, text } from "../catalogue/decode";
import { ENVIRONMENTS, type Environment } from "../shell/sections";
import { call, type AdminOutcome } from "./admin";
import { spaceUrl, type Fetch } from "./api";
import type { PersonRef } from "./model";

export const CONNECTORS = ["duckdb", "databricks"] as const;
export type Connector = (typeof CONNECTORS)[number];
export const IDENTITIES = ["service", "person"] as const;
export type IdentityMode = (typeof IDENTITIES)[number];
export const CREDENTIAL_STATES = ["unconfigured", "configured", "unavailable"] as const;
export type CredentialState = (typeof CREDENTIAL_STATES)[number];
export const CONNECTION_NAME = /^[a-z][a-z0-9_]{0,62}$/;
export const ENDPOINT_KEY = /^[a-z][a-z0-9_-]{0,62}$/;
export const DATABRICKS_HOST = /^https:\/\/[a-z0-9.-]+\.(?:azuredatabricks\.net|cloud\.databricks\.com|gcp\.databricks\.com)$/;

export interface DatabricksEndpoint { key: string; host: string; warehouseId: string }

export function decodeEndpoint(value: unknown, path: string): DatabricksEndpoint {
  const raw = object({ key: text, host: text, warehouse_id: text })(value, path);
  if (!ENDPOINT_KEY.test(raw.key) || !DATABRICKS_HOST.test(raw.host) || !/^[a-zA-Z0-9_-]{1,64}$/.test(raw.warehouse_id)) {
    throw new ContractError(`${path} : point d'accès Databricks invalide`);
  }
  return { key: raw.key, host: raw.host, warehouseId: raw.warehouse_id };
}

export function decodeEndpoints(value: unknown): readonly DatabricksEndpoint[] {
  const found = object({ endpoints: list(decodeEndpoint) })(value, "réponse").endpoints;
  const keys = found.map((endpoint) => endpoint.key);
  if (new Set(keys).size !== keys.length || keys.join("|") !== [...keys].sort().join("|")) {
    throw new ContractError("réponse.endpoints : clés distinctes et triées attendues");
  }
  return found;
}

export type ConnectionBinding =
  | { state: "unconfigured"; environment: Environment }
  | {
      state: "configured";
      environment: Environment;
      connector: Connector;
      endpointKey: string;
      identityMode: IdentityMode;
      setAt: Date;
      setBy: PersonRef;
      credentialState: CredentialState;
    };

export interface LogicalConnection {
  name: string;
  createdAt: Date;
  createdBy: PersonRef;
  bindings: readonly ConnectionBinding[];
}

export interface Probe {
  identity: "local" | "service" | "person";
  credentialExpiresAt: Date | null;
  canCancel: boolean;
  state: string;
}

const ref = object<PersonRef>({ issuer: text, subject: text });

export function decodeConnectionBinding(value: unknown, path: string): ConnectionBinding {
  if (typeof value === "object" && value !== null && "state" in value) {
    const raw = object({ environment: oneOf(ENVIRONMENTS), state: oneOf(["unconfigured"] as const) })(value, path);
    return raw;
  }
  const raw = object({
    environment: oneOf(ENVIRONMENTS),
    connector: oneOf(CONNECTORS),
    endpoint_key: text,
    identity_mode: oneOf(IDENTITIES),
    set_at: instant,
    set_by: ref,
    credential_state: oneOf(CREDENTIAL_STATES),
  })(value, path);
  if (!ENDPOINT_KEY.test(raw.endpoint_key)) {
    throw new ContractError(`${path}.endpoint_key : clé déclarée attendue`);
  }
  if (raw.identity_mode === "person" && raw.credential_state !== "unconfigured") {
    throw new ContractError(`${path}.credential_state : aucun identifiant serveur en mode personne`);
  }
  return {
    state: "configured",
    environment: raw.environment,
    connector: raw.connector,
    endpointKey: raw.endpoint_key,
    identityMode: raw.identity_mode,
    setAt: raw.set_at,
    setBy: raw.set_by,
    credentialState: raw.credential_state,
  };
}

export function decodeConnection(value: unknown, path: string): LogicalConnection {
  const raw = object({
    name: text,
    created_at: instant,
    created_by: ref,
    bindings: list(decodeConnectionBinding),
  })(value, path);
  if (!CONNECTION_NAME.test(raw.name)) {
    throw new ContractError(`${path}.name : nom de connexion attendu`);
  }
  if (raw.bindings.map((binding) => binding.environment).join("|") !== ENVIRONMENTS.join("|")) {
    throw new ContractError(`${path}.bindings : DEV | TEST | PROD attendus dans cet ordre`);
  }
  return { name: raw.name, createdAt: raw.created_at, createdBy: raw.created_by, bindings: raw.bindings };
}

export function decodeConnections(value: unknown): readonly LogicalConnection[] {
  const found = object({ connections: list(decodeConnection) })(value, "réponse").connections;
  const names = found.map((connection) => connection.name);
  if (new Set(names).size !== names.length) {
    throw new ContractError("réponse.connections : noms distincts attendus");
  }
  return found;
}

export function decodeProbe(value: unknown): Probe {
  const raw = object({
    identity: oneOf(["local", "service", "person"] as const),
    credential_expires_at: nullable(instant),
    can_cancel: boolean,
    state: oneOf(["available", "STARTING", "RUNNING", "STOPPING", "STOPPED", "DELETING", "DELETED"] as const),
  })(value, "essai");
  if ((raw.identity === "local") !== (raw.state === "available") || raw.can_cancel !== (raw.identity !== "local")) {
    throw new ContractError("essai : identité, état et annulation incohérents");
  }
  return { identity: raw.identity, credentialExpiresAt: raw.credential_expires_at, canCancel: raw.can_cancel, state: raw.state };
}

const url = (space: string) => `${spaceUrl(space)}/connections`;
const endpointsUrl = (space: string) => `${spaceUrl(space)}/connection-endpoints`;

export function fetchEndpoints(space: string, signal: AbortSignal, fetcher: Fetch): Promise<AdminOutcome<readonly DatabricksEndpoint[]>> {
  return call({ url: endpointsUrl(space), decode: decodeEndpoints }, signal, fetcher);
}

export function createEndpoint(space: string, endpoint: DatabricksEndpoint, fetcher: Fetch): Promise<AdminOutcome<DatabricksEndpoint>> {
  return call({
    url: endpointsUrl(space), method: "POST",
    body: { key: endpoint.key, host: endpoint.host, warehouse_id: endpoint.warehouseId },
    decode: (value) => {
      const found = decodeEndpoint(value, "point d'accès");
      if (found.key !== endpoint.key || found.host !== endpoint.host || found.warehouseId !== endpoint.warehouseId) {
        throw new ContractError("point d'accès : valeur demandée attendue");
      }
      return found;
    },
  }, undefined, fetcher);
}

export function removeEndpoint(space: string, key: string, fetcher: Fetch): Promise<AdminOutcome<null>> {
  return call({ url: `${endpointsUrl(space)}/${encodeURIComponent(key)}`, method: "DELETE", decode: () => null }, undefined, fetcher);
}
const named = (space: string, name: string) => `${url(space)}/${encodeURIComponent(name)}`;
const bindingUrl = (space: string, name: string, environment: Environment) => `${named(space, name)}/bindings/${environment}`;

export function fetchConnections(space: string, signal: AbortSignal, fetcher: Fetch): Promise<AdminOutcome<readonly LogicalConnection[]>> {
  return call({ url: url(space), decode: decodeConnections }, signal, fetcher);
}

export function createConnection(space: string, name: string, fetcher: Fetch): Promise<AdminOutcome<LogicalConnection>> {
  return call({ url: url(space), method: "POST", body: { name }, decode: (value) => {
    const found = decodeConnection(value, "connexion");
    if (found.name !== name) throw new ContractError("connexion.name : nom demandé attendu");
    return found;
  } }, undefined, fetcher);
}

export function removeConnection(space: string, name: string, fetcher: Fetch): Promise<AdminOutcome<null>> {
  return call({ url: named(space, name), method: "DELETE", decode: () => null }, undefined, fetcher);
}

export function setConnectionBinding(
  space: string, name: string, environment: Environment, connector: Connector, endpointKey: string, identityMode: IdentityMode, fetcher: Fetch,
): Promise<AdminOutcome<ConnectionBinding>> {
  return call({
    url: bindingUrl(space, name, environment), method: "PUT",
    body: { connector, endpoint_key: endpointKey, identity_mode: identityMode },
    decode: (value) => {
      const found = decodeConnectionBinding(value, "liaison");
      if (found.environment !== environment || found.state !== "configured") {
        throw new ContractError("liaison : environnement configuré attendu");
      }
      return found;
    },
  }, undefined, fetcher);
}

export function removeConnectionBinding(space: string, name: string, environment: Environment, fetcher: Fetch): Promise<AdminOutcome<null>> {
  return call({ url: bindingUrl(space, name, environment), method: "DELETE", decode: () => null }, undefined, fetcher);
}

export function setConnectionCredential(space: string, name: string, environment: Environment, secret: string, fetcher: Fetch): Promise<AdminOutcome<null>> {
  return call({ url: `${bindingUrl(space, name, environment)}/credential`, method: "PUT", body: { secret }, decode: () => null }, undefined, fetcher);
}

export function removeConnectionCredential(space: string, name: string, environment: Environment, fetcher: Fetch): Promise<AdminOutcome<null>> {
  return call({ url: `${bindingUrl(space, name, environment)}/credential`, method: "DELETE", decode: () => null }, undefined, fetcher);
}

export function testConnection(space: string, name: string, environment: Environment, fetcher: Fetch): Promise<AdminOutcome<Probe>> {
  return call({ url: `${bindingUrl(space, name, environment)}/test`, method: "POST", decode: decodeProbe }, undefined, fetcher);
}

export function testEndpoint(space: string, key: string, secret: string, fetcher: Fetch): Promise<AdminOutcome<Probe>> {
  return call({ url: `${endpointsUrl(space)}/${encodeURIComponent(key)}/test`, method: "POST", body: { secret }, decode: decodeProbe }, undefined, fetcher);
}
