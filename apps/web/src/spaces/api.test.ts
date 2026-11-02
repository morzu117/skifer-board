import { afterEach, describe, expect, it, vi } from "vitest";

import espace from "../../../../contracts/espaces/espace.json";
import interdit from "../../../../contracts/espaces/interdit.json";
import introuvable from "../../../../contracts/espaces/introuvable.json";
import liste from "../../../../contracts/espaces/liste.json";
import anonyme from "../../../../contracts/identite/non-authentifie.json";
import { onSessionLost } from "../identity/session";
import { fetchSpace, fetchSpaces, spaceUrl, type Fetch, type SpaceOutcome } from "./api";

const reponse = (exemple: { status: number; body: unknown }) => Response.json(exemple.body, { status: exemple.status });
const ACCEPT = { headers: { Accept: "application/json" } };
afterEach(() => { vi.unstubAllGlobals(); });

/** Écoute la perte de session pendant `lecture` et rend le nombre de signalements. */
async function signalements<T>(lecture: () => Promise<T>): Promise<{ issue: T; perdues: number }> {
  const perdu = vi.fn();
  const quitter = onSessionLost(perdu);
  try {
    const issue = await lecture();
    return { issue, perdues: perdu.mock.calls.length };
  } finally { quitter(); }
}

it("encode l'identifiant d'espace dans son adresse", () => {
  expect(spaceUrl("finance")).toBe("/api/spaces/finance");
  expect(spaceUrl("a/b?c#d%e f")).toBe("/api/spaces/a%2Fb%3Fc%23d%25e%20f");
  expect(spaceUrl("café")).toBe("/api/spaces/caf%C3%A9");
});

describe.each(["liste", "espace"] as const)("Lecture des espaces : %s", (route) => {
  const lire = (fetcher: Fetch, signal = new AbortController().signal): Promise<SpaceOutcome<unknown>> => route === "liste" ? fetchSpaces(signal, fetcher) : fetchSpace("finance", signal, fetcher);
  const adresse = route === "liste" ? "/api/spaces" : "/api/spaces/finance";

  it("décode 200 et transmet signal, Accept et adresse", async () => {
    const fetcher = vi.fn<Fetch>().mockResolvedValue(reponse(route === "liste" ? liste : espace));
    const signal = new AbortController().signal;
    const issue = await lire(fetcher, signal);
    expect(issue.status).toBe("ok");
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(adresse, { signal, ...ACCEPT });
    if (route === "liste") expect(issue).toMatchObject({ value: { platformAdmin: false, spaces: [{ id: "finance", role: "creator" }, { id: "rh", role: "reader" }] } });
    else expect(issue).toMatchObject({ value: { id: "finance", role: "admin", createdAt: new Date("2026-11-02T09:00:00Z") } });
  });
  it("traduit 404 space_not_found en introuvable, sans rien d'autre", async () => {
    expect(await lire(vi.fn<Fetch>().mockResolvedValue(reponse(introuvable)))).toEqual({ status: "not_found" });
  });
  it("traduit tout 404 en introuvable, même sans corps lisible : inconnu et non-membre ne se distinguent pas", async () => {
    expect(await lire(vi.fn<Fetch>().mockResolvedValue(new Response("<html>", { status: 404 })))).toEqual({ status: "not_found" });
  });
  it("signale le 401 aux abonnés et demande une reconnexion", async () => {
    const { issue, perdues } = await signalements(() => lire(vi.fn<Fetch>().mockResolvedValue(reponse(anonyme))));
    expect(issue).toEqual({ status: "error", message: "Session expirée : reconnectez-vous." });
    expect(perdues).toBe(1);
  });
  it.each([200, 403, 404, 409, 500, 503])("ne signale aucune session perdue pour HTTP %i", async (status) => {
    const { perdues } = await signalements(() => lire(vi.fn<Fetch>().mockResolvedValue(Response.json({}, { status }))));
    expect(perdues).toBe(0);
  });
  it.each([400, 403, 409, 500, 503])("signale un autre statut HTTP %i sans donnée", async (status) => {
    expect(await lire(vi.fn<Fetch>().mockResolvedValue(Response.json({}, { status })))).toEqual({ status: "error", message: `Réponse inattendue du serveur (HTTP ${String(status)}).` });
  });
  it("rend le 403 forbidden du serveur comme une erreur, jamais comme un succès", async () => {
    expect(await lire(vi.fn<Fetch>().mockResolvedValue(reponse(interdit)))).toEqual({ status: "error", message: "Réponse inattendue du serveur (HTTP 403)." });
  });
  it("signale le serveur qui ne répond pas", async () => {
    expect(await lire(vi.fn<Fetch>().mockRejectedValue(new TypeError("réseau")))).toEqual({ status: "error", message: "Le serveur Board ne répond pas." });
  });
  it("refuse un corps hors contrat en nommant le champ en cause", async () => {
    const corps = route === "liste" ? { ...liste.body, platform_admin: "oui" } : { ...espace.body, role: "owner" };
    const champ = route === "liste" ? "réponse.platform_admin : booléen attendu" : "espace.role : reader | creator | admin attendu";
    expect(await lire(vi.fn<Fetch>().mockResolvedValue(Response.json(corps)))).toEqual({ status: "error", message: `Réponse du serveur hors contrat : ${champ}.` });
  });
  it("refuse la réponse de l'autre route : une liste n'est pas un espace, ni l'inverse", async () => {
    const issue = await lire(vi.fn<Fetch>().mockResolvedValue(reponse(route === "liste" ? espace : liste)));
    expect(issue).toEqual({ status: "error", message: expect.stringContaining("hors contrat") as string });
  });
  it("signale un JSON illisible", async () => {
    expect(await lire(vi.fn<Fetch>().mockResolvedValue(new Response("{invalide")))).toEqual({ status: "error", message: "Réponse du serveur hors contrat : corps illisible." });
  });
  it.each(["réseau", "corps"])("propage l'abandon pendant %s", async (phase) => {
    const controller = new AbortController();
    controller.abort();
    const error = new DOMException("Abandonné", "AbortError");
    const fetcher = phase === "réseau" ? vi.fn<Fetch>().mockRejectedValue(error)
      : vi.fn<Fetch>().mockResolvedValue({ ok: true, status: 200, json: () => Promise.reject(error) } as unknown as Response);
    await expect(lire(fetcher, controller.signal)).rejects.toBe(error);
  });
});

it("utilise fetch global par défaut pour la liste et pour un espace", async () => {
  const fetcher = vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(reponse(url === "/api/spaces" ? liste : espace)));
  vi.stubGlobal("fetch", fetcher);
  expect(await fetchSpaces(new AbortController().signal)).toMatchObject({ status: "ok" });
  expect(await fetchSpace("finance", new AbortController().signal)).toMatchObject({ status: "ok", value: { id: "finance" } });
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/spaces", "/api/spaces/finance"]);
});

describe("Espace rendu par le serveur", () => {
  it.each([["rh"], ["Finance"], ["finance "], [""]])("refuse un espace dont l'identifiant rendu (%j) n'est pas celui demandé", async (rendu) => {
    const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json({ ...espace.body, id: rendu }));
    expect(await fetchSpace("finance", new AbortController().signal, fetcher))
      .toEqual({ status: "error", message: "Réponse du serveur hors contrat : espace.id : identifiant demandé attendu." });
  });
  it("transmet l'identifiant demandé encodé et accepte l'espace rendu identique", async () => {
    const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json({ ...espace.body, id: "a/b" }));
    expect(await fetchSpace("a/b", new AbortController().signal, fetcher)).toMatchObject({ status: "ok", value: { id: "a/b" } });
    expect(fetcher).toHaveBeenCalledWith("/api/spaces/a%2Fb", expect.anything());
  });
  it("vérifie le type de l'identifiant avant de le comparer", async () => {
    const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json({ ...espace.body, id: 7 }));
    expect(await fetchSpace("7", new AbortController().signal, fetcher))
      .toEqual({ status: "error", message: "Réponse du serveur hors contrat : espace.id : texte attendu." });
  });
});
