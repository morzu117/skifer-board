import { onSessionLost } from "../identity/session";
import { onSpaceLost } from "../spaces/lost";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogBase, catalogUrl, diffUrl, EMPTY_QUERY, fetchCatalog, fetchDiff, fetchDocument, fetchVersions, type Fetch } from "./api";

// Vitest tourne depuis apps/web ; les exemples sont à la racine du dépôt (plan 04, C10).
const CONTRATS = resolve(process.cwd(), "../../contracts/catalogue");

function response(name: string): Response {
  const sample = JSON.parse(readFileSync(resolve(CONTRATS, `${name}.json`), "utf8")) as { status: number; body: unknown };
  return Response.json(sample.body, { status: sample.status });
}
afterEach(() => { vi.unstubAllGlobals(); });
/** Le catalogue se lit dans un espace (plan 08, E9) : toutes les lectures prennent l'espace en premier. */
const ESPACE = "finance";
it("construit l'URL, omet les paramètres vides, rogne q et encode les valeurs", () => {
  expect(catalogUrl(ESPACE, EMPTY_QUERY)).toBe("/api/spaces/finance/catalog");
  expect(catalogUrl(ESPACE, { ...EMPTY_QUERY, q: "  \t " })).toBe("/api/spaces/finance/catalog");
  expect(catalogUrl(ESPACE, { q: "  CA & été  ", domain: "a/b", owner: "a+b", status: "draft", kind: "kpi" }))
    .toBe("/api/spaces/finance/catalog?q=CA+%26+%C3%A9t%C3%A9&domain=a%2Fb&owner=a%2Bb&status=draft&kind=kpi");
});
describe.each(["catalogue", "fiche"] as const)("Lecture API : %s", (kind) => {
  const read = (fetcher: Fetch, signal = new AbortController().signal) => kind === "catalogue"
    ? fetchCatalog(ESPACE, EMPTY_QUERY, signal, fetcher) : fetchDocument(ESPACE, "revenu / été", signal, fetcher);
  it("décode 200 et transmet signal, Accept et identifiant encodé", async () => {
    const fetcher = vi.fn<Fetch>().mockResolvedValue(response(kind === "catalogue" ? "liste" : "fiche-revenu-net"));
    const signal = new AbortController().signal;
    expect(await read(fetcher, signal)).toMatchObject({ status: "ok", value: { provenance: { read_at: new Date("2026-11-01T10:30:00Z") } } });
    expect(fetcher).toHaveBeenCalledWith(kind === "catalogue" ? "/api/spaces/finance/catalog" : "/api/spaces/finance/catalog/revenu%20%2F%20%C3%A9t%C3%A9", { signal, headers: { Accept: "application/json" } });
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
  vi.stubGlobal("fetch", vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(response(url === "/api/spaces/finance/catalog" ? "liste" : "fiche-commande"))));
  expect(await fetchCatalog(ESPACE, EMPTY_QUERY, new AbortController().signal)).toMatchObject({ status: "ok" });
  expect(await fetchDocument(ESPACE, "commande", new AbortController().signal)).toMatchObject({ status: "ok" });
});

const ACCEPT = { headers: { Accept: "application/json" } };
const abandon = () => new DOMException("Abandonné", "AbortError");

describe("Versions d'une définition (plan 05, V1 et V2)", () => {
  const read = (fetcher: Fetch, signal = new AbortController().signal) => fetchVersions(ESPACE, "revenu / été", signal, fetcher);
  it("décode 200 et appelle la route des versions avec l'identifiant encodé", async () => {
    const fetcher = vi.fn<Fetch>().mockResolvedValue(response("versions-revenu-net"));
    const signal = new AbortController().signal;
    expect(await read(fetcher, signal)).toMatchObject({ status: "ok", value: { id: "revenu-net", current_version: 5 } });
    expect(fetcher).toHaveBeenCalledWith("/api/spaces/finance/catalog/revenu%20%2F%20%C3%A9t%C3%A9/versions", { signal, ...ACCEPT });
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
  const read = (fetcher: Fetch, signal = new AbortController().signal) => fetchDiff(ESPACE, "revenu-net", 4, 5, signal, fetcher);
  it("construit l'URL de l'écart avec l'identifiant encodé", () => {
    expect(diffUrl(ESPACE, "revenu-net", 4, 5)).toBe("/api/spaces/finance/catalog/revenu-net/diff?base=4&other=5");
    expect(diffUrl(ESPACE, "a/b c", 3, 12)).toBe("/api/spaces/finance/catalog/a%2Fb%20c/diff?base=3&other=12");
  });
  it("décode 200 et transmet signal et Accept", async () => {
    const fetcher = vi.fn<Fetch>().mockResolvedValue(response("ecart-revenu-net"));
    const signal = new AbortController().signal;
    expect(await read(fetcher, signal)).toMatchObject({ status: "ok", value: { id: "revenu-net", diff: { identical: false, by_severity: { warn: 1 } } } });
    expect(fetcher).toHaveBeenCalledWith("/api/spaces/finance/catalog/revenu-net/diff?base=4&other=5", { signal, ...ACCEPT });
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
  expect(await fetchVersions(ESPACE, "revenu-net", new AbortController().signal)).toMatchObject({ status: "ok" });
  expect(await fetchDiff(ESPACE, "revenu-net", 4, 5, new AbortController().signal)).toMatchObject({ status: "ok" });
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/spaces/finance/catalog/revenu-net/versions", "/api/spaces/finance/catalog/revenu-net/diff?base=4&other=5"]);
});

describe.each(["liste", "fiche"] as const)("Session du catalogue : %s", (route) => {
  const lire = (status: number) => {
    const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json({}, { status }));
    return route === "liste" ? fetchCatalog(ESPACE, EMPTY_QUERY, new AbortController().signal, fetcher)
      : fetchDocument(ESPACE, "revenu-net", new AbortController().signal, fetcher);
  };
  it("signale le 401 aux abonnés et demande une reconnexion", async () => {
    const perdu = vi.fn(); const quitter = onSessionLost(perdu);
    try {
      expect(await lire(401)).toEqual({ status: "error", message: "Session expirée : reconnectez-vous." });
      expect(perdu).toHaveBeenCalledOnce();
    } finally { quitter(); }
  });
  it.each([200, 400, 403, 404, 500, 503])("ne signale aucune session perdue pour HTTP %i", async (status) => {
    const perdu = vi.fn(); const quitter = onSessionLost(perdu);
    try { await lire(status); expect(perdu).not.toHaveBeenCalled(); }
    finally { quitter(); }
  });
});

describe("Catalogue par espace (plan 08, E9)", () => {
  // Identifiant hostile : un « / », un « ? », un « # », un « % » et un espace ne doivent jamais changer de route.
  const HOSTILE = "a/b?c#d%e f";
  const ENCODE = "a%2Fb%3Fc%23d%25e%20f";
  it("encode l'identifiant d'espace dans chaque adresse et ne produit jamais /api/catalog nu", () => {
    expect(catalogBase("finance")).toBe("/api/spaces/finance/catalog");
    expect(catalogBase(HOSTILE)).toBe(`/api/spaces/${ENCODE}/catalog`);
    expect(catalogUrl(HOSTILE, EMPTY_QUERY)).toBe(`/api/spaces/${ENCODE}/catalog`);
    expect(catalogUrl(HOSTILE, { ...EMPTY_QUERY, q: "x" })).toBe(`/api/spaces/${ENCODE}/catalog?q=x`);
    expect(diffUrl(HOSTILE, "revenu-net", 4, 5)).toBe(`/api/spaces/${ENCODE}/catalog/revenu-net/diff?base=4&other=5`);
  });
  it("transmet l'espace encodé aux quatre lectures", async () => {
    const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json({}, { status: 500 }));
    const signal = new AbortController().signal;
    await fetchCatalog(HOSTILE, EMPTY_QUERY, signal, fetcher);
    await fetchDocument(HOSTILE, "revenu-net", signal, fetcher);
    await fetchVersions(HOSTILE, "revenu-net", signal, fetcher);
    await fetchDiff(HOSTILE, "revenu-net", 4, 5, signal, fetcher);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `/api/spaces/${ENCODE}/catalog`,
      `/api/spaces/${ENCODE}/catalog/revenu-net`,
      `/api/spaces/${ENCODE}/catalog/revenu-net/versions`,
      `/api/spaces/${ENCODE}/catalog/revenu-net/diff?base=4&other=5`,
    ]);
    for (const [url] of fetcher.mock.calls) {
      expect(new URL(url, "http://board.invalid").pathname.split("/").slice(0, 5)).toEqual(["", "api", "spaces", ENCODE, "catalog"]);
    }
  });
  it.each(["liste", "fiche", "versions"] as const)("rend le 403 forbidden comme un rôle insuffisant, sans session perdue : %s", async (route) => {
    const interdit = Response.json({ error: { code: "forbidden", required: "reader" } }, { status: 403 });
    const fetcher = vi.fn<Fetch>().mockResolvedValue(interdit);
    const signal = new AbortController().signal;
    const perdu = vi.fn(); const quitter = onSessionLost(perdu);
    try {
      const issue = route === "liste" ? await fetchCatalog(ESPACE, EMPTY_QUERY, signal, fetcher)
        : route === "fiche" ? await fetchDocument(ESPACE, "revenu-net", signal, fetcher)
          : await fetchVersions(ESPACE, "revenu-net", signal, fetcher);
      expect(issue).toEqual({ status: "error", message: "Votre rôle dans cet espace ne permet pas de lire le catalogue." });
      expect(perdu).not.toHaveBeenCalled();
    } finally { quitter(); }
  });
  it("rend le 403 de l'écart comme un rôle insuffisant, pas comme un refus d'Atlas", async () => {
    const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json({ error: { code: "forbidden", required: "reader" } }, { status: 403 }));
    expect(await fetchDiff(ESPACE, "revenu-net", 4, 5, new AbortController().signal, fetcher))
      .toEqual({ status: "error", message: "Votre rôle dans cet espace ne permet pas de lire le catalogue." });
  });
  it("un 403 au corps illisible reste un rôle insuffisant", async () => {
    const fetcher = vi.fn<Fetch>().mockResolvedValue(new Response("<html>", { status: 403 }));
    expect(await fetchCatalog(ESPACE, EMPTY_QUERY, new AbortController().signal, fetcher))
      .toEqual({ status: "error", message: "Votre rôle dans cet espace ne permet pas de lire le catalogue." });
  });
  it("un 404 space_not_found de la liste n'est jamais lu comme un catalogue vide", async () => {
    const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json({ error: { code: "space_not_found" } }, { status: 404 }));
    expect(await fetchCatalog(ESPACE, EMPTY_QUERY, new AbortController().signal, fetcher)).toEqual({ status: "not_found" });
  });
});

describe("Espace perdu pendant la lecture du catalogue (plan 08, E4 et E7)", () => {
  type Lecture = "liste" | "fiche" | "versions" | "écart";
  const LECTURES: Lecture[] = ["liste", "fiche", "versions", "écart"];
  const lire = (route: Lecture, fetcher: Fetch) => {
    const signal = new AbortController().signal;
    return route === "liste" ? fetchCatalog(ESPACE, EMPTY_QUERY, signal, fetcher)
      : route === "fiche" ? fetchDocument(ESPACE, "revenu-net", signal, fetcher)
        : route === "versions" ? fetchVersions(ESPACE, "revenu-net", signal, fetcher)
          : fetchDiff(ESPACE, "revenu-net", 4, 5, signal, fetcher);
  };
  /** Nombre d'espaces perdus signalés pendant `action`. */
  async function signalements(action: () => Promise<unknown>): Promise<{ issue: unknown; perdus: number }> {
    const perdu = vi.fn();
    const quitter = onSpaceLost(perdu);
    try {
      const issue = await action();
      return { issue, perdus: perdu.mock.calls.length };
    } finally { quitter(); }
  }
  const introuvable = () => Response.json({ error: { code: "space_not_found" } }, { status: 404 });

  it.each(LECTURES)("un 404 space_not_found signale l'espace perdu, une seule fois : %s", async (route) => {
    const { issue, perdus } = await signalements(() => lire(route, vi.fn<Fetch>().mockResolvedValue(introuvable())));
    expect(issue).toEqual({ status: "not_found" });
    expect(perdus).toBe(1);
  });

  it.each(LECTURES)("l'exemple introuvable du contrat des espaces signale l'espace perdu : %s", async (route) => {
    const exemple = JSON.parse(readFileSync(resolve(CONTRATS, "../espaces/introuvable.json"), "utf8")) as { status: number; body: unknown };
    const { perdus } = await signalements(() => lire(route, vi.fn<Fetch>().mockResolvedValue(Response.json(exemple.body, { status: exemple.status }))));
    expect(perdus).toBe(1);
  });

  const AUTRES: [string, () => Response][] = [
    ["corps illisible", () => new Response("<html>introuvable</html>", { status: 404 })],
    ["corps vide", () => new Response(null, { status: 404 })],
    ["autre code", () => Response.json({ error: { code: "not_found" } }, { status: 404 })],
    ["document_not_found", () => Response.json({ error: { code: "document_not_found" } }, { status: 404 })],
    ["code non textuel", () => Response.json({ error: { code: 404 } }, { status: 404 })],
    ["sans error", () => Response.json({ code: "space_not_found" }, { status: 404 })],
    ["casse différente", () => Response.json({ error: { code: "SPACE_NOT_FOUND" } }, { status: 404 })],
  ];
  it.each(AUTRES.flatMap(([cas, corps]) => (["liste", "fiche", "versions"] as const).map((route) => [cas, route, corps] as const)))(
    "un 404 %s ne signale aucun espace perdu : %s",
    async (_cas, route, corps) => {
      const { issue, perdus } = await signalements(() => lire(route, vi.fn<Fetch>().mockResolvedValue(corps())));
      expect(issue).toEqual({ status: "not_found" });
      expect(perdus).toBe(0);
    },
  );

  it("la fiche inconnue du contrat (404 d'un document absent) ne signale aucun espace perdu", async () => {
    const { issue, perdus } = await signalements(() => lire("fiche", vi.fn<Fetch>().mockResolvedValue(response("fiche-inconnue"))));
    expect(issue).toEqual({ status: "not_found" });
    expect(perdus).toBe(0);
  });

  it.each([["ecart-version-inconnue", "refused"], ["ecart-irresoluble", "refused"]])("un refus d'Atlas sur l'écart (%s) ne signale aucun espace perdu", async (file, status) => {
    const { issue, perdus } = await signalements(() => lire("écart", vi.fn<Fetch>().mockResolvedValue(response(file))));
    expect(issue).toMatchObject({ status });
    expect(perdus).toBe(0);
  });

  it.each([403, 401, 500, 503])("aucun autre statut (HTTP %i) ne signale un espace perdu, même avec le code space_not_found", async (status) => {
    const { perdus } = await signalements(() => lire("liste", vi.fn<Fetch>().mockResolvedValue(Response.json({ error: { code: "space_not_found" } }, { status }))));
    expect(perdus).toBe(0);
  });

  it("le corps reste lisible après le test du code : la réponse n'est consommée qu'une fois par Board", async () => {
    const reponse = introuvable();
    const { perdus } = await signalements(() => lire("liste", vi.fn<Fetch>().mockResolvedValue(reponse)));
    expect(perdus).toBe(1);
    expect(reponse.bodyUsed).toBe(false);
  });
});
