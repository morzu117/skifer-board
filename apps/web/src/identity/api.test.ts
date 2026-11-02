import { afterEach, describe, expect, it, vi } from "vitest";
import local from "../../../../contracts/identite/me-local.json";
import etabli from "../../../../contracts/identite/me-etabli.json";
import anonyme from "../../../../contracts/identite/non-authentifie.json";
import deconnexion from "../../../../contracts/identite/deconnexion.json";
import origine from "../../../../contracts/identite/origine-refusee.json";
import { fetchMe, logout, type Fetch } from "./api";

const reponse = (exemple: { body: unknown; status: number }) => Response.json(exemple.body, { status: exemple.status });
const signal = () => new AbortController().signal;
afterEach(() => { vi.unstubAllGlobals(); });

describe("Lecture de /api/me", () => {
  it.each([
    [local, { status: "local" }],
    [etabli, { status: "established", identity: etabli.body.identity, expiresAt: new Date(etabli.body.expires_at) }],
    [anonyme, { status: "unauthenticated", loginUrl: anonyme.body.error.login_url }],
  ])("interprète le contrat %j", async (exemple, attendu) => {
    const fetcher = vi.fn<Fetch>().mockResolvedValue(reponse(exemple));
    const abort = signal();
    expect(await fetchMe(abort, fetcher)).toEqual(attendu);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/me", { signal: abort, headers: { Accept: "application/json" } });
  });
  it.each([
    [401, {}, "hors contrat"], [200, {}, "hors contrat"], [500, {}, "HTTP 500"],
  ])("signale la réponse HTTP %i hors contrat ou en erreur", async (status, body, message) => {
    expect(await fetchMe(signal(), vi.fn<Fetch>().mockResolvedValue(Response.json(body, { status })))).toEqual({ status: "error", message: expect.stringContaining(message) as string });
  });
  it("signale un JSON illisible", async () => {
    expect(await fetchMe(signal(), vi.fn<Fetch>().mockResolvedValue(new Response("{illisible")))).toEqual({ status: "error", message: expect.stringContaining("corps illisible") as string });
  });
  it("signale le serveur qui ne répond pas", async () => {
    expect(await fetchMe(signal(), vi.fn<Fetch>().mockRejectedValue(new Error("réseau")))).toEqual({ status: "error", message: "Le serveur Board ne répond pas." });
  });
  it.each(["requête", "corps"])("propage l'abandon pendant la lecture : %s", async (phase) => {
    const controller = new AbortController();
    const erreur = new DOMException("Abandonné", "AbortError");
    const fetcher = vi.fn<Fetch>().mockImplementation(() => {
      if (phase === "requête") { controller.abort(); return Promise.reject(erreur); }
      return Promise.resolve({ ok: true, status: 200, json: () => { controller.abort(); return Promise.reject(erreur); } } as Response);
    });
    await expect(fetchMe(controller.signal, fetcher)).rejects.toBe(erreur);
  });
  it("utilise fetch global quand il n'est pas injecté", async () => {
    vi.stubGlobal("fetch", vi.fn<Fetch>().mockResolvedValue(reponse(local)));
    expect(await fetchMe(signal())).toEqual({ status: "local" });
  });
});

describe("Déconnexion", () => {
  it("envoie POST /auth/logout et décode la redirection", async () => {
    const fetcher = vi.fn<Fetch>().mockResolvedValue(reponse(deconnexion));
    expect(await logout(fetcher)).toEqual({ status: "ok", redirect: "/" });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/auth/logout", { method: "POST", headers: { Accept: "application/json" } });
  });
  it("annonce le refus d'origine avec son code HTTP", async () => {
    expect(await logout(vi.fn<Fetch>().mockResolvedValue(reponse(origine)))).toEqual({ status: "error", message: expect.stringContaining("HTTP 403") as string });
  });
  it("annonce un rejet de fetch", async () => {
    expect(await logout(vi.fn<Fetch>().mockRejectedValue(new Error("réseau")))).toEqual({ status: "error", message: "Le serveur Board ne répond pas." });
  });
  it.each([{ redirect: "https://ailleurs.invalid" }, { redirect: "//ailleurs.invalid" }, { redirect: "accueil" }, {}])("refuse une redirection hors contrat : %j", async (body) => {
    expect(await logout(vi.fn<Fetch>().mockResolvedValue(Response.json(body)))).toEqual({ status: "error", message: expect.stringContaining("hors contrat") as string });
  });
  it("refuse un corps illisible", async () => {
    expect(await logout(vi.fn<Fetch>().mockResolvedValue(new Response("{illisible")))).toEqual({ status: "error", message: expect.stringContaining("corps illisible") as string });
  });
  it("utilise fetch global quand il n'est pas injecté", async () => {
    vi.stubGlobal("fetch", vi.fn<Fetch>().mockResolvedValue(reponse(deconnexion)));
    expect(await logout()).toEqual({ status: "ok", redirect: "/" });
  });
});
