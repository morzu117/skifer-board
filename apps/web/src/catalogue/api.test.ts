import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogUrl, EMPTY_QUERY, fetchCatalog, fetchDocument, type Fetch } from "./api";

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
