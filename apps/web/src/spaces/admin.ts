import { ContractError } from "../catalogue/decode";
import { reportSessionLost } from "../identity/session";
import { spaceUrl, type Fetch } from "./api";
import { reportSpaceLost } from "./lost";
import { decodeBinding, decodeEvents, decodeMembers, decodePeople, decodeSpace, type Binding, type KnownPerson, type Principal, type Role, type Space, type SpaceEvent } from "./model";

/**
 * Administration d'un espace (plan 08, 8.4) : membres, journal, recherche de personnes, création.
 * Le serveur décide de tout (E7) : l'écran rend ses refus tels quels, avec leur raison.
 */

/** Refus à codes fermés du serveur (E8, E11, E12, et contrôle d'origine du plan 06). */
export const REFUSALS = [
  "invalid_request",
  "invalid_parameter",
  "space_exists",
  "unknown_person",
  "last_admin",
  "binding_not_found",
  "space_not_found",
  "forbidden",
  "local_mode",
  "origin_refused",
] as const;

export type RefusalCode = (typeof REFUSALS)[number];

export interface Refusal {
  code: RefusalCode;
  /** Champ en cause d'un `invalid_request`. */
  field: string | null;
}

export type AdminOutcome<T> = { status: "ok"; value: T } | ({ status: "refused" } & Refusal) | { status: "error"; message: string };

export const REFUSAL_LABELS: Record<RefusalCode, string> = {
  invalid_request: "La demande est incomplète ou mal formée.",
  invalid_parameter: "La recherche est vide ou trop longue.",
  space_exists: "Cet identifiant est déjà pris par un espace.",
  unknown_person: "Cette personne n'est pas connue de Board : elle doit s'être connectée une fois.",
  last_admin: "C'est la dernière liaison administrateur de l'espace : ajoutez d'abord un autre administrateur.",
  binding_not_found: "Cette liaison n'existe plus : la liste a été relue.",
  space_not_found: "Espace introuvable.",
  forbidden: "Votre rôle ne permet pas cette action.",
  local_mode: "En mode local, l'espace n'a pas de membres à gérer.",
  origin_refused: "La demande ne vient pas de cette page : elle a été refusée.",
};

function refusalOf(value: unknown): Refusal | null {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return null;
  }
  const { error } = value;
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  const code = (REFUSALS as readonly unknown[]).includes(error.code) ? (error.code as RefusalCode) : null;
  if (code === null) {
    return null;
  }
  const field = "field" in error && typeof error.field === "string" ? error.field : null;
  return { code, field };
}

interface Call<T> {
  url: string;
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  decode: (value: unknown) => T;
}

async function call<T>({ url, method = "GET", body, decode }: Call<T>, signal: AbortSignal | undefined, fetcher: Fetch): Promise<AdminOutcome<T>> {
  let response: Response;
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    if (signal !== undefined) {
      init.signal = signal;
    }
    // Requête de même origine : le navigateur pose l'en-tête `Origin` que le serveur contrôle (plan 06, I8).
    response = await fetcher(url, init);
  } catch (error) {
    if (signal?.aborted === true) {
      throw error;
    }
    return { status: "error", message: "Le serveur Board ne répond pas." };
  }
  if (response.status === 401) {
    reportSessionLost();
    return { status: "error", message: "Session expirée : reconnectez-vous." };
  }
  try {
    if (response.ok) {
      return { status: "ok", value: decode(response.status === 204 ? null : await response.json()) };
    }
    // Un refus sans corps JSON (proxy, panne) se dit par son statut, pas comme un contrat rompu.
    const refusal = refusalOf(await response.json().catch(() => null));
    if (refusal === null) {
      return { status: "error", message: `Réponse inattendue du serveur (HTTP ${String(response.status)}).` };
    }
    if (refusal.code === "space_not_found") {
      // Accès retiré pendant l'usage : la coque relit l'espace (E4).
      reportSpaceLost();
    }
    return { status: "refused", ...refusal };
  } catch (error) {
    if (signal?.aborted === true) {
      throw error;
    }
    const reason = error instanceof ContractError ? error.message : "corps illisible";
    return { status: "error", message: `Réponse du serveur hors contrat : ${reason}.` };
  }
}

export function fetchMembers(space: string, signal: AbortSignal, fetcher: Fetch = fetch): Promise<AdminOutcome<readonly Binding[]>> {
  return call({ url: `${spaceUrl(space)}/members`, decode: decodeMembers }, signal, fetcher);
}

export function fetchEvents(space: string, signal: AbortSignal, fetcher: Fetch = fetch): Promise<AdminOutcome<readonly SpaceEvent[]>> {
  return call({ url: `${spaceUrl(space)}/events`, decode: decodeEvents }, signal, fetcher);
}

export function searchPeople(query: string, signal: AbortSignal, fetcher: Fetch = fetch): Promise<AdminOutcome<readonly KnownPerson[]>> {
  return call({ url: `/api/people?${new URLSearchParams({ q: query.trim() }).toString()}`, decode: decodePeople }, signal, fetcher);
}

/** Pose une liaison, ou change son rôle ; une liaison inchangée est acceptée sans journal (E12). */
export function setMember(space: string, principal: Principal, role: Role, fetcher: Fetch = fetch): Promise<AdminOutcome<Binding>> {
  return call({ url: `${spaceUrl(space)}/members`, method: "POST", body: { principal, role }, decode: (value) => decodeBinding(value, "liaison") }, undefined, fetcher);
}

export function removeMember(space: string, binding: string, fetcher: Fetch = fetch): Promise<AdminOutcome<null>> {
  return call({ url: `${spaceUrl(space)}/members/${encodeURIComponent(binding)}`, method: "DELETE", decode: () => null }, undefined, fetcher);
}

export interface NewSpace {
  id: string;
  name: string;
  firstAdmin: Principal;
}

export function createSpace(space: NewSpace, fetcher: Fetch = fetch): Promise<AdminOutcome<Space>> {
  return call(
    { url: "/api/spaces", method: "POST", body: { id: space.id, name: space.name, first_admin: space.firstAdmin }, decode: (value) => decodeSpace(value, "espace") },
    undefined,
    fetcher,
  );
}
