import { ContractError } from "../catalogue/decode";
import { reportSessionLost } from "../identity/session";
import { decodeSpace, decodeSpaceList, type Space, type SpaceList } from "./model";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Issue d'une lecture d'espace. `not_found` couvre sans distinction un espace inconnu et un
 * espace dont on n'est pas membre : le serveur ne dit pas lequel, la page non plus (plan 08, E7).
 */
export type SpaceOutcome<T> = { status: "ok"; value: T } | { status: "not_found" } | { status: "error"; message: string };

async function read<T>(url: string, decode: (value: unknown) => T, signal: AbortSignal, fetcher: Fetch): Promise<SpaceOutcome<T>> {
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
    if (response.status === 404) {
      return { status: "not_found" };
    }
    if (response.status === 401) {
      reportSessionLost();
      return { status: "error", message: "Session expirée : reconnectez-vous." };
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

export function spaceUrl(id: string): string {
  return `/api/spaces/${encodeURIComponent(id)}`;
}

/** Espaces de la personne, avec son rôle ; tous pour un administrateur de la plateforme. */
export function fetchSpaces(signal: AbortSignal, fetcher: Fetch = fetch): Promise<SpaceOutcome<SpaceList>> {
  return read("/api/spaces", decodeSpaceList, signal, fetcher);
}

export function fetchSpace(id: string, signal: AbortSignal, fetcher: Fetch = fetch): Promise<SpaceOutcome<Space>> {
  return read(
    spaceUrl(id),
    (value) => {
      const space = decodeSpace(value, "espace");
      // Le catalogue lu est celui de l'espace rendu : il doit être celui demandé.
      if (space.id !== id) {
        throw new ContractError("espace.id : identifiant demandé attendu");
      }
      return space;
    },
    signal,
    fetcher,
  );
}
