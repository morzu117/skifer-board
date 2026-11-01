import { ContractError } from "./decode";
import {
  decodeCatalogPage,
  decodeDocumentPage,
  decodeUnavailable,
  type AtlasStatus,
  type CatalogPage,
  type DocumentKind,
  type DocumentPage,
  type Unavailable,
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

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

async function read<T>(url: string, decode: (value: unknown) => T, signal: AbortSignal, fetcher: Fetch): Promise<Outcome<T>> {
  let response: Response;
  try {
    response = await fetcher(url, { signal, headers: { Accept: "application/json" } });
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    return { status: "error", message: "Le serveur Board ne répond pas." };
  }
  try {
    if (response.ok) {
      return { status: "ok", value: decode(await response.json()) };
    }
    if (response.status === 503) {
      return { status: "unavailable", ...decodeUnavailable(await response.json()) };
    }
    if (response.status === 404) {
      return { status: "not_found" };
    }
    return { status: "error", message: `Réponse inattendue du serveur (HTTP ${String(response.status)}).` };
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    const reason = error instanceof ContractError ? error.message : "corps illisible";
    return { status: "error", message: `Réponse du serveur hors contrat : ${reason}.` };
  }
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
  return read(catalogUrl(query), decodeCatalogPage, signal, fetcher);
}

export function fetchDocument(id: string, signal: AbortSignal, fetcher: Fetch = fetch): Promise<Outcome<DocumentPage>> {
  return read(`/api/catalog/${encodeURIComponent(id)}`, decodeDocumentPage, signal, fetcher);
}
