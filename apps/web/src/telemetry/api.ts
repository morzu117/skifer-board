import type { Fetch } from "../spaces/api";
import { call, type AdminOutcome } from "../spaces/admin";
import { decodeSummary, type Summary, type Window } from "./model";

/** Résumé d'une fenêtre ; le serveur réserve la lecture à l'administration de la plateforme (T7). */
export function fetchTelemetry(window: Window, signal: AbortSignal, fetcher: Fetch = fetch): Promise<AdminOutcome<Summary>> {
  return call({ url: `/api/telemetry?${new URLSearchParams({ window }).toString()}`, decode: (value) => decodeSummary(value, window) }, signal, fetcher);
}
