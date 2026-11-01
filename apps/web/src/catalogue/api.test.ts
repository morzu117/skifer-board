import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogUrl, diffUrl, EMPTY_QUERY, fetchCatalog, fetchDiff, fetchDocument, fetchVersions, type Fetch } from "./api";

// Vitest tourne depuis apps/web ; les exemples sont à la racine du dépôt (plan 04, C10).
const CONTRATS = resolve(process.cwd(), "../../contracts/catalogue");

function response(name: string): Response {
  const sample = JSON.parse(readFileSync(resolve(CONTRATS, `${name}.json`), "utf8")) as { status: number; body: unknown };
  return Response.json(sample.body, { status: sample.status });
}
afterEach(() => { vi.unstubAllGlobals(); });
it("construit l'URL, omet les paramètres vides, rogne q et encode les valeurs", () => {
  expect(catalogUrl(EMPTY_QUERY)).toBe("/api/catalog");
  expect(catalogUrl({ ...EMPTY_QUERY, q: "  \t " })).toBe("/api/catalog");
  expect(catalogUrl({ q: "  CA & été  ", domain: "a/b", owner: "a+b", status: "draft", kind: "kpi" }))
    .toBe("/api/catalog?q=CA+%26+%C3%A9t%C3%A9&domain=a%2Fb&owner=a%2Bb&status=draft&kind=kpi");
});
describe.each(["catalogue", "fiche"] as const)("Lecture API : %s", (kind) => {
  const read = (fetcher: Fetch, signal = new AbortController().signal) => kind === "catalogue"
    ? fetchCatalog(EMPTY_QUERY, signal, fetcher) : fetchDocument("revenu / été", signal, fetcher);
  it("décode 200 et transmet signal, Accept et identifiant encodé", async () => {
    const fetcher = vi.fn<Fetch>().mockResolvedValue(response(kind === "catalogue" ? "liste" : "fiche-revenu-net"));
    const signal = new AbortController().signal;
    expect(await read(fetcher, signal)).toMatchObject({ status: "ok", value: { provenance: { read_at: new Date("2026-11-01T10:30:00Z") } } });
    expect(fetcher).toHaveBeenCalledWith(kind === "catalogue" ? "/api/catalog" : "/api/catalog/revenu%20%2F%20%C3%A9t%C3%A9", { signal, headers: { Accept: "application/json" } });
  });
  it.each([["indisponible", "unavailable"], ["fiche-inconnue", "not_found"]])("traduit %s", async (file, status) => {
    expect(await read(vi.fn<Fetch>().mockResolvedValue(response(file)))).toMatchObject({ status });
  });
  it.each([400, 500])("signale HTTP %i", async (status) => {
    expect(await read(vi.fn<Fetch>().mockResolvedValue(Response.json({}, { status })))).toEqual({ status: "error", message: expect.stringContaining(`HTTP ${status}`) as string });
  });
  it.each([200, 503])("refuse un corps hors contrat avec HTTP %i", async (status) => {
    expect(await read(vi.fn<Fetch>().mockResolvedValue(Response.json({}, { status })))).toEqual({ status: "error", message: expect.stringContaining("hors contrat") as string });
  });
  it("signale un JSON illisible", async () => {
    expect(await read(vi.fn<Fetch>().mockResolvedValue(new Response("{invalide")))).toEqual({ status: "error", message: expect.stringContaining("corps illisible") as string });
  });
  it("signale le serveur qui ne répond pas", async () => {
    expect(await read(vi.fn<Fetch>().mockRejectedValue(new Error("réseau")))).toEqual({ status: "error", message: expect.stringContaining("ne répond pas") as string });
  });
  it.each(["réseau", "corps"])("propage l'abandon pendant %s", async (phase) => {
    const controller = new AbortController();
    controller.abort();
    const error = new DOMException("Abandonné", "AbortError");
    const fetcher = phase === "réseau" ? vi.fn<Fetch>().mockRejectedValue(error)
      : vi.fn<Fetch>().mockResolvedValue({ ok: true, json: () => Promise.reject(error) } as Response);
    await expect(read(fetcher, controller.signal)).rejects.toBe(error);
  });
});
it("utilise aussi fetch global par défaut pour les deux routes", async () => {
  vi.stubGlobal("fetch", vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(response(url === "/api/catalog" ? "liste" : "fiche-commande"))));
  expect(await fetchCatalog(EMPTY_QUERY, new AbortController().signal)).toMatchObject({ status: "ok" });
  expect(await fetchDocument("commande", new AbortController().signal)).toMatchObject({ status: "ok" });
});

const ACCEPT = { headers: { Accept: "application/json" } };
const abandon = () => new DOMException("Abandonné", "AbortError");

describe("Versions d'une définition (plan 05, V1 et V2)", () => {
  const read = (fetcher: Fetch, signal = new AbortController().signal) => fetchVersions("revenu / été", signal, fetcher);
  it("décode 200 et appelle la route des versions avec l'identifiant encodé", async () => {
    const fetcher = vi.fn<Fetch>().mockResolvedValue(response("versions-revenu-net"));
    const signal = new AbortController().signal;
    expect(await read(fetcher, signal)).toMatchObject({ status: "ok", value: { id: "revenu-net", current_version: 5 } });
    expect(fetcher).toHaveBeenCalledWith("/api/catalog/revenu%20%2F%20%C3%A9t%C3%A9/versions", { signal, ...ACCEPT });
  });
  it("traduit le document absent", async () => {
    expect(await read(vi.fn<Fetch>().mockResolvedValue(response("fiche-inconnue")))).toEqual({ status: "not_found" });
  });
  it("traduit l'historique indisponible avec sa raison et son détail", async () => {
    expect(await read(vi.fn<Fetch>().mockResolvedValue(response("versions-indisponible")))).toEqual({
      status: "unavailable",
      code: "history_unavailable",
      problem: "repository_missing",
      detail: "Le clone de l'espace Atlas est introuvable à l'emplacement configuré.",
    });
  });
  it("refuse un 503 qui porte le code du catalogue : ce n'est pas le contrat de la route", async () => {
    expect(await read(vi.fn<Fetch>().mockResolvedValue(response("indisponible")))).toEqual({ status: "error", message: expect.stringContaining("hors contrat") as string });
  });
  it("refuse une liste de versions hors contrat", async () => {
    expect(await read(vi.fn<Fetch>().mockResolvedValue(response("fiche-revenu-net")))).toEqual({ status: "error", message: expect.stringContaining("versions.id") as string });
  });
  it("signale le serveur qui ne répond pas", async () => {
    expect(await read(vi.fn<Fetch>().mockRejectedValue(new TypeError("réseau")))).toEqual({ status: "error", message: "Le serveur Board ne répond pas." });
  });
  it.each(["réseau", "corps"])("propage l'abandon pendant %s", async (phase) => {
    const controller = new AbortController();
    controller.abort();
    const error = abandon();
    const fetcher = phase === "réseau" ? vi.fn<Fetch>().mockRejectedValue(error)
      : vi.fn<Fetch>().mockResolvedValue({ ok: true, status: 200, json: () => Promise.reject(error) } as Response);
    await expect(read(fetcher, controller.signal)).rejects.toBe(error);
  });
});

describe("Écart entre deux versions (plan 05, V4 et V6)", () => {
  const read = (fetcher: Fetch, signal = new AbortController().signal) => fetchDiff("revenu-net", 4, 5, signal, fetcher);
  it("construit l'URL de l'écart avec l'identifiant encodé", () => {
    expect(diffUrl("revenu-net", 4, 5)).toBe("/api/catalog/revenu-net/diff?base=4&other=5");
    expect(diffUrl("a/b c", 3, 12)).toBe("/api/catalog/a%2Fb%20c/diff?base=3&other=12");
  });
  it("décode 200 et transmet signal et Accept", async () => {
    const fetcher = vi.fn<Fetch>().mockResolvedValue(response("ecart-revenu-net"));
    const signal = new AbortController().signal;
    expect(await read(fetcher, signal)).toMatchObject({ status: "ok", value: { id: "revenu-net", diff: { identical: false, by_severity: { warn: 1 } } } });
    expect(fetcher).toHaveBeenCalledWith("/api/catalog/revenu-net/diff?base=4&other=5", { signal, ...ACCEPT });
  });
  it("décode deux versions identiques", async () => {
    expect(await read(vi.fn<Fetch>().mockResolvedValue(response("ecart-identique")))).toMatchObject({ status: "ok", value: { diff: { identical: true } } });
  });
  it.each([
    ["ecart-version-inconnue", 404, "version_not_found", "Version 9 de « revenu-net » introuvable."],
    ["ecart-concept", 400, "diff_not_supported", "Un concept n'a pas de graphe : ses versions ne se comparent pas."],
    ["ecart-irresoluble", 422, "diff_unavailable", "La version 3 de « revenu-net » n'est pas un document valide."],
  ])("rend le refus %s (HTTP %i) avec le détail d'Atlas", async (name, _status, code, detail) => {
    expect(await read(vi.fn<Fetch>().mockResolvedValue(response(name)))).toEqual({ status: "refused", code, detail });
  });
  it("traduit le document absent (404 document_not_found)", async () => {
    expect(await read(vi.fn<Fetch>().mockResolvedValue(response("fiche-inconnue")))).toEqual({ status: "not_found" });
  });
  it("traite un paramètre invalide (400 invalid_parameter) comme une erreur, pas comme un refus", async () => {
    expect(await read(vi.fn<Fetch>().mockResolvedValue(response("ecart-parametre-invalide")))).toEqual({ status: "error", message: expect.stringContaining("HTTP 400") as string });
  });
  it("traduit l'historique indisponible", async () => {
    expect(await read(vi.fn<Fetch>().mockResolvedValue(response("versions-indisponible")))).toMatchObject({ status: "unavailable", problem: "repository_missing" });
  });
  it("refuse un 503 portant le code du catalogue", async () => {
    expect(await read(vi.fn<Fetch>().mockResolvedValue(response("indisponible")))).toEqual({ status: "error", message: expect.stringContaining("hors contrat") as string });
  });
  it.each([400, 404, 422])("signale un corps illisible en HTTP %i comme hors contrat", async (status) => {
    expect(await read(vi.fn<Fetch>().mockResolvedValue(new Response("{invalide", { status })))).toEqual({ status: "error", message: expect.stringContaining("corps illisible") as string });
  });
  it.each([400, 422])("refuse un refus sans code en HTTP %i", async (status) => {
    expect(await read(vi.fn<Fetch>().mockResolvedValue(Response.json({ error: {} }, { status })))).toEqual({ status: "error", message: expect.stringContaining("réponse.error.code") as string });
  });
  it("refuse un refus connu sans détail", async () => {
    expect(await read(vi.fn<Fetch>().mockResolvedValue(Response.json({ error: { code: "diff_unavailable" } }, { status: 422 })))).toEqual({ status: "error", message: expect.stringContaining("réponse.error.detail") as string });
  });
  it.each([422, 500])("signale un autre code d'erreur en HTTP %i", async (status) => {
    expect(await read(vi.fn<Fetch>().mockResolvedValue(Response.json({ error: { code: "internal_error" } }, { status })))).toEqual({ status: "error", message: expect.stringContaining(`HTTP ${status}`) as string });
  });
  it("refuse un écart hors contrat", async () => {
    expect(await read(vi.fn<Fetch>().mockResolvedValue(response("versions-revenu-net")))).toEqual({ status: "error", message: expect.stringContaining("hors contrat") as string });
  });
  it("signale le serveur qui ne répond pas", async () => {
    expect(await read(vi.fn<Fetch>().mockRejectedValue(new TypeError("réseau")))).toEqual({ status: "error", message: "Le serveur Board ne répond pas." });
  });
  it.each(["réseau", "corps d'un refus", "corps d'un écart"])("propage l'abandon pendant la lecture : %s", async (phase) => {
    const controller = new AbortController();
    controller.abort();
    const error = abandon();
    const body = { json: () => Promise.reject(error) };
    const fetcher = phase === "réseau" ? vi.fn<Fetch>().mockRejectedValue(error)
      : phase === "corps d'un refus" ? vi.fn<Fetch>().mockResolvedValue({ ok: false, status: 422, clone: () => body } as unknown as Response)
        : vi.fn<Fetch>().mockResolvedValue({ ok: true, status: 200, ...body } as unknown as Response);
    await expect(read(fetcher, controller.signal)).rejects.toBe(error);
  });
});
it("utilise fetch global par défaut pour les versions et l'écart", async () => {
  const fetcher = vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(response(url.endsWith("/versions") ? "versions-revenu-net" : "ecart-revenu-net")));
  vi.stubGlobal("fetch", fetcher);
  expect(await fetchVersions("revenu-net", new AbortController().signal)).toMatchObject({ status: "ok" });
  expect(await fetchDiff("revenu-net", 4, 5, new AbortController().signal)).toMatchObject({ status: "ok" });
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/catalog/revenu-net/versions", "/api/catalog/revenu-net/diff?base=4&other=5"]);
});
