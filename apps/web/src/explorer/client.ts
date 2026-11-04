import { call, type AdminOutcome } from "../spaces/admin";
import { spaceUrl, type Fetch } from "../spaces/api";
import { decodeContextual, decodeContextualBody, decodeFields, type ContextualBody, type ContextualResult, type ExplorerModel } from "./model";
export { submitExecution, fetchExecution, fetchExecutions, cancelExecution, fetchResult } from "../executions/client";

export function fetchFields(space: string, signal: AbortSignal, fetcher: Fetch = fetch): Promise<AdminOutcome<{ models: readonly ExplorerModel[] }>> {
  return call({ url: `${spaceUrl(space)}/explorer/fields`, decode: decodeFields }, signal, fetcher);
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
