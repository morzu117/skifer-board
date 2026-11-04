import { ContractError } from "../catalogue/decode";
import { reportSessionLost } from "../identity/session";
import { spaceUrl, type Fetch } from "./api";
import { reportSpaceLost } from "./lost";
import { ENVIRONMENTS, type Environment } from "../shell/sections";
import {
  decodeBinding,
  decodeEvents,
  decodeGrant,
  decodeGrants,
  decodeMembers,
  decodePeople,
  decodeSpace,
  type Binding,
  type DeployGrant,
  type KnownPerson,
  type Principal,
  type Role,
  type Space,
  type SpaceEvent,
} from "./model";
import { decodeConfiguration, decodeParameter, decodeStoredValue, type Configuration, type DeclarationInput, type Parameter, type StoredValue } from "./parameters";

/**
 * Administration d'un espace (plan 08, 8.4 ; plan 09, 9.4 ; plan 10, 10.3) : membres, droits de
 * déployer, paramètres, journal, recherche de personnes, création.
 * Le serveur décide de tout (E7) : l'écran rend ses refus tels quels, avec leur raison.
 */

/** Refus à codes fermés du serveur (plan 08, E8, E11, E12 ; plan 09, V9 ; plan 10, P8 ; contrôle d'origine du plan 06). */
export const REFUSALS = [
  "invalid_request",
  "invalid_parameter",
  "space_exists",
  "unknown_person",
  "last_admin",
  "binding_not_found",
  "grant_not_found",
  "parameter_not_found",
  "parameter_exists",
  "parameter_limit",
  "values_incompatible",
  "space_not_found",
  "forbidden",
  "local_mode",
  "origin_refused",
  "connection_exists",
  "connection_not_found",
  "connection_binding_not_found",
  "connection_in_use",
  "vault_unavailable",
  "credential_not_found",
  "credential_not_allowed",
  "connector_unavailable",
  "endpoint_not_configured",
  "identity_unavailable",
  "credential_rejected",
  "redirect_refused",
  "invalid_upstream",
  "engine_unavailable",
  "execution_not_found",
  "result_unavailable",
  "worker_unavailable",
  "binding_changed",
] as const;

export type RefusalCode = (typeof REFUSALS)[number];

export interface Refusal {
  code: RefusalCode;
  /** Champ en cause d'un `invalid_request`. */
  field: string | null;
  /** Environnements dont il faut d'abord vider la valeur, pour `values_incompatible` (plan 10, P5). */
  environments?: readonly Environment[] | undefined;
  /** Environnement où manque le droit de déployer, pour un `forbidden` qui le demande (plan 10, P6). */
  environment?: Environment | undefined;
}

export type AdminOutcome<T> = { status: "ok"; value: T } | ({ status: "refused" } & Refusal) | { status: "error"; message: string };

export const REFUSAL_LABELS: Record<RefusalCode, string> = {
  invalid_request: "La demande est incomplète ou mal formée.",
  invalid_parameter: "La recherche est vide ou trop longue.",
  space_exists: "Cet identifiant est déjà pris par un espace.",
  unknown_person: "Cette personne n'est pas connue de Board : elle doit s'être connectée une fois.",
  last_admin: "C'est la dernière liaison administrateur de l'espace : ajoutez d'abord un autre administrateur.",
  binding_not_found: "Cette liaison n'existe plus : la liste a été relue.",
  grant_not_found: "Ce droit de déployer n'existe plus : la liste a été relue.",
  parameter_not_found: "Ce paramètre n'existe plus : la liste a été relue.",
  parameter_exists: "Un paramètre porte déjà ce nom dans l'espace.",
  parameter_limit: "L'espace a déjà 100 paramètres, le maximum.",
  values_incompatible: "Des valeurs déjà posées ne respecteraient plus cette déclaration : videz-les d'abord.",
  space_not_found: "Espace introuvable.",
  forbidden: "Votre rôle ne permet pas cette action.",
  local_mode: "En mode local, l'espace implicite ne se gère pas.",
  origin_refused: "La demande ne vient pas de cette page : elle a été refusée.",
  connection_exists: "Une connexion porte déjà ce nom dans l'espace.",
  connection_not_found: "Cette connexion n'existe plus : la liste a été relue.",
  connection_binding_not_found: "Cette liaison n'existe plus : la liste a été relue.",
  connection_in_use: "Cette connexion possède encore une liaison : retirez ses liaisons avant de la supprimer.",
  vault_unavailable: "Le coffre des identifiants est indisponible.",
  credential_not_found: "Aucun identifiant n'est configuré pour cette liaison.",
  credential_not_allowed: "Cette liaison n'accepte pas d'identifiant de service.",
  connector_unavailable: "La source ne répond pas pour le moment.",
  endpoint_not_configured: "Ce point d'accès n'est pas déclaré sur le serveur.",
  identity_unavailable: "L'identité personnelle n'est pas encore disponible pour cette source.",
  credential_rejected: "La source a refusé cet identifiant.",
  redirect_refused: "La source a tenté une redirection, refusée par Board.",
  invalid_upstream: "La source a renvoyé une réponse hors contrat.",
  engine_unavailable: "Le moteur sémantique n'est pas configuré sur le serveur.",
  execution_not_found: "Cette exécution est introuvable ou ne vous appartient plus.",
  result_unavailable: "Le résultat de cette exécution n'est pas disponible.",
  worker_unavailable: "La file d'exécution est pleine ou indisponible.",
  binding_changed: "La liaison de cette connexion a changé : relancez la demande.",
};

export function refusalOf(value: unknown): Refusal | null {
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
  if (code === "values_incompatible" && "environments" in error && Array.isArray(error.environments)) {
    // Dans l'ordre de promotion, et seulement des environnements connus : le reste n'est pas recopié.
    const named: readonly unknown[] = error.environments;
    return { code, field, environments: ENVIRONMENTS.filter((environment) => named.includes(environment)) };
  }
  if (code === "forbidden" && "required" in error && error.required === "deploy" && "environment" in error) {
    const environment = ENVIRONMENTS.find((known) => known === error.environment);
    if (environment !== undefined) {
      return { code, field, environment };
    }
  }
  return { code, field };
}

export interface Call<T> {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  decode: (value: unknown) => T;
}

export async function call<T>({ url, method = "GET", body, decode }: Call<T>, signal: AbortSignal | undefined, fetcher: Fetch): Promise<AdminOutcome<T>> {
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

export function fetchGrants(space: string, signal: AbortSignal, fetcher: Fetch = fetch): Promise<AdminOutcome<readonly DeployGrant[]>> {
  return call({ url: `${spaceUrl(space)}/deploy-grants`, decode: decodeGrants }, signal, fetcher);
}

/** Accorde le droit de déployer ; un droit déjà accordé est rendu tel quel, sans journal (plan 09, V5). */
export function grantDeploy(space: string, environment: Environment, principal: Principal, fetcher: Fetch = fetch): Promise<AdminOutcome<DeployGrant>> {
  return call(
    { url: `${spaceUrl(space)}/deploy-grants`, method: "POST", body: { environment, principal }, decode: (value) => decodeGrant(value, "accord") },
    undefined,
    fetcher,
  );
}

export function revokeDeploy(space: string, grant: string, fetcher: Fetch = fetch): Promise<AdminOutcome<null>> {
  return call({ url: `${spaceUrl(space)}/deploy-grants/${encodeURIComponent(grant)}`, method: "DELETE", decode: () => null }, undefined, fetcher);
}

export function fetchParameters(space: string, signal: AbortSignal, fetcher: Fetch = fetch): Promise<AdminOutcome<Configuration>> {
  return call({ url: `${spaceUrl(space)}/parameters`, decode: decodeConfiguration }, signal, fetcher);
}

function parameterUrl(space: string, name: string): string {
  return `${spaceUrl(space)}/parameters/${encodeURIComponent(name)}`;
}

export function declareParameter(space: string, name: string, declaration: DeclarationInput, fetcher: Fetch = fetch): Promise<AdminOutcome<Parameter>> {
  return call(
    {
      url: `${spaceUrl(space)}/parameters`,
      method: "POST",
      body: { name, ...declaration },
      decode: (value) => decodeParameter(value, "paramètre"),
    },
    undefined,
    fetcher,
  );
}

/** Change une déclaration ; le nom, immuable, n'est que dans l'adresse (plan 10, P3). */
export function redeclareParameter(space: string, name: string, declaration: DeclarationInput, fetcher: Fetch = fetch): Promise<AdminOutcome<Parameter>> {
  return call(
    { url: parameterUrl(space, name), method: "PUT", body: declaration, decode: (value) => decodeParameter(value, "paramètre") },
    undefined,
    fetcher,
  );
}

/** Retire la déclaration et ses valeurs (plan 10, P5). */
export function removeParameter(space: string, name: string, fetcher: Fetch = fetch): Promise<AdminOutcome<null>> {
  return call({ url: parameterUrl(space, name), method: "DELETE", decode: () => null }, undefined, fetcher);
}

export function setParameterValue(
  space: string,
  name: string,
  environment: Environment,
  value: unknown,
  fetcher: Fetch = fetch,
): Promise<AdminOutcome<StoredValue>> {
  return call(
    { url: `${parameterUrl(space, name)}/values/${environment}`, method: "PUT", body: { value }, decode: (found) => decodeStoredValue(found, "valeur") },
    undefined,
    fetcher,
  );
}

export function clearParameterValue(space: string, name: string, environment: Environment, fetcher: Fetch = fetch): Promise<AdminOutcome<null>> {
  return call({ url: `${parameterUrl(space, name)}/values/${environment}`, method: "DELETE", decode: () => null }, undefined, fetcher);
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
