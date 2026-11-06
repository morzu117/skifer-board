import { call, type AdminOutcome } from "../spaces/admin";
import { spaceUrl, type Fetch } from "../spaces/api";
import { ContractError } from "../catalogue/decode";
import { CONNECTION_NAME } from "../spaces/connections";
import { decodeContextual, decodeContextualBody, decodeFields, type ContextualBody, type ContextualResult, type ExplorerModel } from "./model";
export { submitExecution, fetchExecution, fetchExecutions, cancelExecution, fetchResult } from "../executions/client";

export function fetchFields(space: string, signal: AbortSignal, fetcher: Fetch = fetch): Promise<AdminOutcome<{ models: readonly ExplorerModel[] }>> {
  return call({ url: `${spaceUrl(space)}/explorer/fields`, decode: decodeFields }, signal, fetcher);
}
export function fetchExplorerConnections(space: string, signal: AbortSignal, fetcher: Fetch = fetch): Promise<AdminOutcome<readonly string[]>> {
  return call({ url: `${spaceUrl(space)}/explorer/connections`, decode: (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).join() !== "connections" || !("connections" in value) || !Array.isArray(value.connections)) throw new ContractError("connexions : liste attendue");
    const names: unknown[] = value.connections;
    if (names.some((item) => typeof item !== "string" || !CONNECTION_NAME.test(item)) || new Set(names).size !== names.length) throw new ContractError("connexions : noms invalides");
    return names as string[];
  } }, signal, fetcher);
}
export function computeContextual(space: string, id: string, body: ContextualBody, fetcher: Fetch = fetch): Promise<AdminOutcome<ContextualResult>> {
  let validated: ContextualBody;
  try {
    validated = decodeContextualBody(body);
  } catch {
    return Promise.resolve({ status: "error", message: "La demande de calcul est invalide." });
  }
  return call({ url: `${spaceUrl(space)}/executions/${encodeURIComponent(id)}/contextual`, method: "POST", body: validated, decode: decodeContextual }, undefined, fetcher);
}
