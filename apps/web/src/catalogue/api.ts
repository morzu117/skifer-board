import { ContractError } from "./decode";
import {
  decodeCatalogPage,
  decodeDiffPage,
  decodeDocumentPage,
  decodeRefusal,
  decodeUnavailable,
  decodeVersionsPage,
  type AtlasStatus,
  type CatalogPage,
  type DiffPage,
  type DocumentKind,
  type DocumentPage,
  type Refusal,
  type Unavailable,
  type UnavailableCode,
  type VersionsPage,
} from "./model";

export interface CatalogQuery {
  q: string;
  domain: string;
  owner: string;
  status: AtlasStatus | "";
  kind: DocumentKind | "";
}

export const EMPTY_QUERY: CatalogQuery = { q: "", domain: "", owner: "", status: "", kind: "" };

/** Issue d'une lecture : la réponse, l'indisponibilité d'Atlas, un document absent ou une erreur. */
export type Outcome<T> =
  | { status: "ok"; value: T }
  | ({ status: "unavailable" } & Unavailable)
  | { status: "not_found" }
  | { status: "error"; message: string };

/** Issue d'une demande d'écart : en plus, un refus à code fermé avec la raison d'Atlas. */
export type DiffOutcome = Outcome<DiffPage> | ({ status: "refused" } & Refusal);

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

interface Contract<T> {
  decode: (value: unknown) => T;
  /** Code d'erreur d'une réponse 503 pour cette route. */
  unavailable?: UnavailableCode;
}

async function read<T>(url: string, contract: Contract<T>, signal: AbortSignal, fetcher: Fetch): Promise<Outcome<T>> {
  const sent = await send(url, signal, fetcher);
  return "failure" in sent ? sent.failure : interpret(sent.response, contract, signal);
}

type Failure = { status: "error"; message: string };

async function send(url: string, signal: AbortSignal, fetcher: Fetch): Promise<{ response: Response } | { failure: Failure }> {
  try {
    return { response: await fetcher(url, { signal, headers: { Accept: "application/json" } }) };
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    return { failure: { status: "error", message: "Le serveur Board ne répond pas." } };
  }
}

async function interpret<T>(response: Response, { decode, unavailable }: Contract<T>, signal: AbortSignal): Promise<Outcome<T>> {
  try {
    if (response.ok) {
      return { status: "ok", value: decode(await response.json()) };
    }
    if (response.status === 503) {
      return { status: "unavailable", ...decodeUnavailable(await response.json(), unavailable) };
    }
    if (response.status === 404) {
      return { status: "not_found" };
    }
    return { status: "error", message: `Réponse inattendue du serveur (HTTP ${String(response.status)}).` };
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    return contractError(error);
  }
}

function contractError(error: unknown): Failure {
  const reason = error instanceof ContractError ? error.message : "corps illisible";
  return { status: "error", message: `Réponse du serveur hors contrat : ${reason}.` };
}

export function catalogUrl(query: CatalogQuery): string {
  const params = new URLSearchParams();
  const q = query.q.trim();
  if (q !== "") {
    params.set("q", q);
  }
  for (const key of ["domain", "owner", "status", "kind"] as const) {
    if (query[key] !== "") {
      params.set(key, query[key]);
    }
  }
  const search = params.toString();
  return search === "" ? "/api/catalog" : `/api/catalog?${search}`;
}

export function fetchCatalog(query: CatalogQuery, signal: AbortSignal, fetcher: Fetch = fetch): Promise<Outcome<CatalogPage>> {
  return read(catalogUrl(query), { decode: decodeCatalogPage }, signal, fetcher);
}

export function fetchDocument(id: string, signal: AbortSignal, fetcher: Fetch = fetch): Promise<Outcome<DocumentPage>> {
  return read(`/api/catalog/${encodeURIComponent(id)}`, { decode: decodeDocumentPage }, signal, fetcher);
}

export function fetchVersions(id: string, signal: AbortSignal, fetcher: Fetch = fetch): Promise<Outcome<VersionsPage>> {
  return read(`/api/catalog/${encodeURIComponent(id)}/versions`, { decode: decodeVersionsPage, unavailable: "history_unavailable" }, signal, fetcher);
}

export function diffUrl(id: string, base: number, other: number): string {
  return `/api/catalog/${encodeURIComponent(id)}/diff?${new URLSearchParams({ base: String(base), other: String(other) }).toString()}`;
}

/** Écart d'Atlas entre deux versions taguées ; un refus garde la raison donnée par Atlas. */
export async function fetchDiff(id: string, base: number, other: number, signal: AbortSignal, fetcher: Fetch = fetch): Promise<DiffOutcome> {
  const sent = await send(diffUrl(id, base, other), signal, fetcher);
  if ("failure" in sent) {
    return sent.failure;
  }
  const { response } = sent;
  if ([400, 404, 422].includes(response.status)) {
    let refusal: Refusal | null;
    try {
      refusal = decodeRefusal(await response.clone().json());
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      return contractError(error);
    }
    if (refusal !== null) {
      return { status: "refused", ...refusal };
    }
  }
  return interpret(response, { decode: decodeDiffPage, unavailable: "history_unavailable" }, signal);
}
