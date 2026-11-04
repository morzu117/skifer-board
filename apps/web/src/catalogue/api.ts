import { reportSessionLost } from "../identity/session";
import { reportSpaceLost } from "../spaces/lost";
import { ContractError, object, text } from "./decode";
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
      if (await isSpaceNotFound(response)) {
        // Accès retiré pendant la lecture : la coque relit l'espace (plan 08, E4).
        reportSpaceLost();
      }
      return { status: "not_found" };
    }
    if (response.status === 403) {
      // Administrateur de la plateforme sans rôle dans l'espace : il ne lit pas le catalogue (plan 08, E6).
      return { status: "error", message: "Votre rôle dans cet espace ne permet pas de lire le catalogue." };
    }
    if (response.status === 401) {
      // Session expirée ou révoquée : la coque passe à l'écran de connexion (plan 06, 6.3).
      reportSessionLost();
      return { status: "error", message: "Session expirée : reconnectez-vous." };
    }
    return { status: "error", message: `Réponse inattendue du serveur (HTTP ${String(response.status)}).` };
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    return contractError(error);
  }
}

/** Réponse 404 de la garde d'espace, et non d'un document absent. Un corps illisible n'en est pas une. */
async function isSpaceNotFound(response: Response): Promise<boolean> {
  try {
    const { error } = object({ error: object({ code: text }) })(await response.clone().json(), "réponse");
    return error.code === "space_not_found";
  } catch {
    return false;
  }
}

function contractError(error: unknown): Failure {
  const reason = error instanceof ContractError ? error.message : "corps illisible";
  return { status: "error", message: `Réponse du serveur hors contrat : ${reason}.` };
}

/** Le catalogue se lit dans un espace (plan 08, E9). */
export function catalogBase(space: string): string {
  return `/api/spaces/${encodeURIComponent(space)}/catalog`;
}

export function catalogUrl(space: string, query: CatalogQuery): string {
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
  const base = catalogBase(space);
  return search === "" ? base : `${base}?${search}`;
}

export function fetchCatalog(space: string, query: CatalogQuery, signal: AbortSignal, fetcher: Fetch = fetch): Promise<Outcome<CatalogPage>> {
  return read(catalogUrl(space, query), { decode: decodeCatalogPage }, signal, fetcher);
}

export function fetchDocument(space: string, id: string, signal: AbortSignal, fetcher: Fetch = fetch): Promise<Outcome<DocumentPage>> {
  return read(`${catalogBase(space)}/${encodeURIComponent(id)}`, { decode: decodeDocumentPage }, signal, fetcher);
}

export function fetchVersions(space: string, id: string, signal: AbortSignal, fetcher: Fetch = fetch): Promise<Outcome<VersionsPage>> {
  return read(`${catalogBase(space)}/${encodeURIComponent(id)}/versions`, { decode: decodeVersionsPage, unavailable: "history_unavailable" }, signal, fetcher);
}

export function diffUrl(space: string, id: string, base: number, other: number): string {
  return `${catalogBase(space)}/${encodeURIComponent(id)}/diff?${new URLSearchParams({ base: String(base), other: String(other) }).toString()}`;
}

/** Écart d'Atlas entre deux versions taguées ; un refus garde la raison donnée par Atlas. */
export async function fetchDiff(space: string, id: string, base: number, other: number, signal: AbortSignal, fetcher: Fetch = fetch): Promise<DiffOutcome> {
  const sent = await send(diffUrl(space, id, base, other), signal, fetcher);
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
