import { tableFromIPC, type Table } from "apache-arrow";
import { decodeReference, type AnalysisReference } from "../analyses/reference";
import { ContractError } from "../catalogue/decode";
import { reportSessionLost } from "../identity/session";
import { call, refusalOf, type AdminOutcome } from "../spaces/admin";
import { spaceUrl, type Fetch } from "../spaces/api";
import { reportSpaceLost } from "../spaces/lost";
import type { Environment } from "../shell/sections";
import { decodeExecution, decodeExecutions, type Execution } from "./model";

const url = (space: string) => `${spaceUrl(space)}/executions`;
const named = (space: string, id: string) => `${url(space)}/${encodeURIComponent(id)}`;

export interface ExecutionInput {
  connection: string;
  environment: Environment;
  model: string;
  metrics: readonly string[];
  dimensions: readonly string[];
  filters: readonly { column: string; operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "between"; value: string | number | boolean | readonly (string | number | boolean)[] }[];
  /** Analyse d'où la demande est partie (plan 18, A8) : vérifiée par le serveur, absente du corps quand il n'y en a pas. */
  analysis?: AnalysisReference;
}

export function fetchExecutions(space: string, scope: "mine" | "space", signal: AbortSignal, fetcher: Fetch = fetch): Promise<AdminOutcome<readonly Execution[]>> {
  return call({ url: `${url(space)}?scope=${scope}`, decode: (value) => decodeExecutions(value, space) }, signal, fetcher);
}

export function fetchExecution(space: string, id: string, signal: AbortSignal, fetcher: Fetch = fetch): Promise<AdminOutcome<Execution>> {
  return call({ url: named(space, id), decode: (value) => {
    const found = decodeExecution(value, space);
    if (found.id !== id) throw new ContractError("exécution.id : identifiant demandé attendu");
    return found;
  } }, signal, fetcher);
}

export function submitExecution(space: string, input: ExecutionInput, fetcher: Fetch = fetch): Promise<AdminOutcome<Execution>> {
  let body: ExecutionInput = input;
  if (input.analysis !== undefined) {
    // Sans référence, le corps est celui du plan 17, octet pour octet ; avec, elle est vérifiée avant l'envoi.
    try {
      body = { ...input, analysis: decodeReference(input.analysis) };
    } catch {
      return Promise.resolve({ status: "error", message: "La référence d'analyse est invalide." });
    }
  }
  return call({ url: url(space), method: "POST", body, decode: (value) => decodeExecution(value, space) }, undefined, fetcher);
}

export function cancelExecution(space: string, id: string, fetcher: Fetch = fetch): Promise<AdminOutcome<Execution>> {
  return call({ url: `${named(space, id)}/cancel`, method: "POST", decode: (value) => {
    const found = decodeExecution(value, space);
    if (found.id !== id) throw new ContractError("exécution.id : identifiant demandé attendu");
    return found;
  } }, undefined, fetcher);
}

/** Le flux Arrow se lit après une réussite, sous les mêmes bornes que le serveur. */
export async function fetchResult(space: string, execution: Execution, signal: AbortSignal, fetcher: Fetch = fetch): Promise<AdminOutcome<Table>> {
  if (execution.state !== "succeeded" || execution.rows === null || execution.size === null) {
    return { status: "error", message: "Le résultat n'est pas disponible." };
  }
  let response: Response;
  try {
    response = await fetcher(`${named(space, execution.id)}/result`, { signal, headers: { Accept: "application/vnd.apache.arrow.stream" } });
  } catch (error) {
    if (signal.aborted) throw error;
    return { status: "error", message: "Le serveur Board ne répond pas." };
  }
  if (response.status === 401) {
    reportSessionLost();
    return { status: "error", message: "Session expirée : reconnectez-vous." };
  }
  if (!response.ok) {
    const refused = refusalOf(await response.json().catch(() => null));
    if (refused === null) return { status: "error", message: `Réponse inattendue du serveur (HTTP ${String(response.status)}).` };
    if (refused.code === "space_not_found") reportSpaceLost();
    return { status: "refused", ...refused };
  }
  try {
    if (response.headers.get("content-type") !== "application/vnd.apache.arrow.stream") {
      throw new ContractError("résultat : type Arrow attendu");
    }
    const length = response.headers.get("content-length");
    if (length !== null && (!/^(0|[1-9]\d*)$/.test(length) || Number(length) > 1024 * 1024 || Number(length) !== execution.size)) {
      throw new ContractError("résultat : taille incohérente");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== execution.size || bytes.byteLength > 1024 * 1024) {
      throw new ContractError("résultat : taille incohérente");
    }
    const table = tableFromIPC(bytes);
    const names = table.schema.fields.map((field) => field.name);
    if (table.numRows !== execution.rows || table.numRows > 1000 || names.length === 0 || new Set(names).size !== names.length) {
      throw new ContractError("résultat : lignes ou colonnes incohérentes");
    }
    return { status: "ok", value: table };
  } catch (error) {
    if (signal.aborted) throw error;
    const reason = error instanceof ContractError ? error.message : "flux Arrow illisible";
    return { status: "error", message: `Réponse du serveur hors contrat : ${reason}.` };
  }
}
