import { afterEach, describe, expect, it, vi } from "vitest";

import fenetreInvalide from "../../../../contracts/telemetrie/fenetre-invalide.json";
import interdit from "../../../../contracts/telemetrie/interdit.json";
import lecture7j from "../../../../contracts/telemetrie/lecture-7j.json";
import lecture from "../../../../contracts/telemetrie/lecture.json";
import modeLocal from "../../../../contracts/telemetrie/mode-local.json";
import vide from "../../../../contracts/telemetrie/vide.json";
import { onSessionLost } from "../identity/session";
import type { Fetch } from "../spaces/api";
import { onSpaceLost } from "../spaces/lost";
import { fetchTelemetry } from "./api";
import { decodeSummary, WINDOWS } from "./model";

// Lecture de la télémétrie (plan 11, T7) : `GET /api/telemetry?window=`, réservée à
// l'administration de la plateforme. Les réponses sont les exemples du serveur réel.

type Exemple = { status: number; body: unknown };
const servir = (exemple: Exemple) => vi.fn<Fetch>().mockResolvedValue(Response.json(exemple.body, { status: exemple.status }));
const signal = () => new AbortController().signal;
let quitter: (() => void)[] = [];
afterEach(() => {
  for (const fin of quitter) fin();
  quitter = [];
});
const ecouter = () => {
  const session = vi.fn();
  const espace = vi.fn();
  quitter.push(onSessionLost(session), onSpaceLost(espace));
  return { session, espace };
};

describe("fetchTelemetry", () => {
  it.each(WINDOWS)("demande la fenêtre %s, en GET, en JSON, avec le signal", async (fenetre) => {
    const fetcher = servir({ status: 200, body: { ...lecture.body, window: fenetre } });
    const controleur = new AbortController();
    await fetchTelemetry(fenetre, controleur.signal, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(`/api/telemetry?window=${fenetre}`);
    expect(init?.method).toBe("GET");
    expect(init?.headers).toEqual({ Accept: "application/json" });
    expect(init?.body).toBeUndefined();
    expect(init?.signal).toBe(controleur.signal);
  });

  it("200 : le résumé décodé de la fenêtre demandée", async () => {
    expect(await fetchTelemetry("24h", signal(), servir(lecture))).toEqual({ status: "ok", value: decodeSummary(lecture.body, "24h") });
    expect(await fetchTelemetry("7d", signal(), servir(lecture7j))).toEqual({ status: "ok", value: decodeSummary(lecture7j.body, "7d") });
    expect(await fetchTelemetry("24h", signal(), servir(vide))).toMatchObject({ status: "ok", value: { period: null, operations: [] } });
  });

  it("200 d'une autre fenêtre que la demandée : réponse hors contrat, aucune donnée", async () => {
    expect(await fetchTelemetry("7d", signal(), servir(lecture))).toEqual({
      status: "error",
      message: "Réponse du serveur hors contrat : télémétrie.window : fenêtre demandée attendue.",
    });
  });

  it("200 au corps hors contrat ou illisible", async () => {
    const corps = structuredClone(lecture.body);
    (corps.operations[0] as { count: unknown }).count = -1;
    expect(await fetchTelemetry("24h", signal(), servir({ status: 200, body: corps }))).toEqual({
      status: "error",
      message: "Réponse du serveur hors contrat : télémétrie.operations[0].count : entier positif attendu.",
    });
    const illisible = vi.fn<Fetch>().mockResolvedValue(new Response("<html>", { status: 200 }));
    expect(await fetchTelemetry("24h", signal(), illisible)).toEqual({ status: "error", message: "Réponse du serveur hors contrat : corps illisible." });
  });

  it("403 : refus « forbidden », sans perte d'espace ni de session", async () => {
    const { session, espace } = ecouter();
    expect(await fetchTelemetry("24h", signal(), servir(interdit))).toEqual({ status: "refused", code: "forbidden", field: null });
    expect(session).not.toHaveBeenCalled();
    expect(espace).not.toHaveBeenCalled();
  });

  it("409 : mode local", async () => {
    expect(await fetchTelemetry("30d", signal(), servir(modeLocal))).toEqual({ status: "refused", code: "local_mode", field: null });
  });

  it("400 : fenêtre refusée, champ nommé", async () => {
    expect(await fetchTelemetry("24h", signal(), servir(fenetreInvalide))).toEqual({ status: "refused", code: "invalid_request", field: "window" });
  });

  it("401 : session perdue, signalée à la coque", async () => {
    const { session } = ecouter();
    const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json({ error: { code: "unauthenticated" } }, { status: 401 }));
    expect(await fetchTelemetry("24h", signal(), fetcher)).toEqual({ status: "error", message: "Session expirée : reconnectez-vous." });
    expect(session).toHaveBeenCalledTimes(1);
  });

  it("refus inconnu ou sans corps : dit par son statut", async () => {
    expect(await fetchTelemetry("24h", signal(), servir({ status: 500, body: { error: { code: "boom" } } }))).toEqual({
      status: "error",
      message: "Réponse inattendue du serveur (HTTP 500).",
    });
    expect(await fetchTelemetry("24h", signal(), vi.fn<Fetch>().mockResolvedValue(new Response("panne", { status: 502 })))).toEqual({
      status: "error",
      message: "Réponse inattendue du serveur (HTTP 502).",
    });
  });

  it("panne réseau : le serveur ne répond pas", async () => {
    expect(await fetchTelemetry("24h", signal(), vi.fn<Fetch>().mockRejectedValue(new TypeError("réseau")))).toEqual({
      status: "error",
      message: "Le serveur Board ne répond pas.",
    });
  });

  it("une lecture abandonnée lève, sans être prise pour une panne", async () => {
    const controleur = new AbortController();
    controleur.abort();
    const abandon = new DOMException("abandon", "AbortError");
    await expect(fetchTelemetry("24h", controleur.signal, vi.fn<Fetch>().mockRejectedValue(abandon))).rejects.toBe(abandon);
  });

  it("utilise fetch par défaut", async () => {
    const global = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(vide.body));
    try {
      expect(await fetchTelemetry("24h", signal())).toMatchObject({ status: "ok" });
      expect(global).toHaveBeenCalledWith("/api/telemetry?window=24h", expect.anything());
    } finally {
      global.mockRestore();
    }
  });
});
