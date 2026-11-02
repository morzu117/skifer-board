import { ContractError, object, text } from "../catalogue/decode";
import { decodeMe, decodeUnauthenticated, type Person } from "./model";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Issue de la lecture de l'identité : mode local, identité établie, connexion requise ou erreur. */
export type IdentityOutcome =
  | { status: "local" }
  | { status: "established"; identity: Person; expiresAt: Date }
  | { status: "unauthenticated"; loginUrl: string }
  | { status: "error"; message: string };

function contractError(error: unknown): { status: "error"; message: string } {
  const reason = error instanceof ContractError ? error.message : "corps illisible";
  return { status: "error", message: `Réponse du serveur hors contrat : ${reason}.` };
}

export async function fetchMe(signal: AbortSignal, fetcher: Fetch = fetch): Promise<IdentityOutcome> {
  let response: Response;
  try {
    response = await fetcher("/api/me", { signal, headers: { Accept: "application/json" } });
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    return { status: "error", message: "Le serveur Board ne répond pas." };
  }
  try {
    if (response.status === 401) {
      return { status: "unauthenticated", loginUrl: decodeUnauthenticated(await response.json()) };
    }
    if (!response.ok) {
      return { status: "error", message: `Réponse inattendue du serveur (HTTP ${String(response.status)}).` };
    }
    const me = decodeMe(await response.json());
    return me.established ? { status: "established", identity: me.identity, expiresAt: me.expiresAt } : { status: "local" };
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    return contractError(error);
  }
}

export type LogoutOutcome = { status: "ok"; redirect: string } | { status: "error"; message: string };

/** Déconnexion : le serveur révoque la session ; le navigateur suit ensuite l'adresse rendue. */
export async function logout(fetcher: Fetch = fetch): Promise<LogoutOutcome> {
  let response: Response;
  try {
    // Requête de même origine : le navigateur pose l'en-tête `Origin` que le serveur contrôle (I8).
    response = await fetcher("/auth/logout", { method: "POST", headers: { Accept: "application/json" } });
  } catch {
    return { status: "error", message: "Le serveur Board ne répond pas." };
  }
  if (!response.ok) {
    return { status: "error", message: `La déconnexion a été refusée (HTTP ${String(response.status)}).` };
  }
  try {
    const { redirect } = object({ redirect: text })(await response.json(), "réponse");
    if (!redirect.startsWith("/") || redirect.startsWith("//")) {
      throw new ContractError("réponse.redirect : chemin de Board attendu");
    }
    return { status: "ok", redirect };
  } catch (error) {
    return contractError(error);
  }
}
