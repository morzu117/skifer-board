import { onSessionLost } from "../identity/session";
import { onSpaceLost } from "../spaces/lost";
import { describe, expect, it, vi } from "vitest";
import type { ThemeDraft } from "./client";
import type { Fetch } from "../spaces/api";
import { approveTheme, createTheme, deleteTheme, fetchThemeDiff, reviseTheme, fetchTheme, fetchThemeApprovals, fetchThemeConsumers, fetchThemeHistory, fetchThemeRevision, fetchThemes } from "./client";

const routes = import.meta.glob<{ status: number; body: unknown }>("../../../../contracts/themes/routes/*.json", { eager: true, import: "default" });
const ID = "00000000-0000-4000-8000-000000000001";
const COMMIT = "a".repeat(40);
const root = `/api/spaces/finance/themes`;
function body(name: string): unknown {
  return JSON.parse(JSON.stringify(routes[`../../../../contracts/themes/routes/${name}.json`]?.body).replaceAll("<uuid>", ID).replaceAll("<commit>", COMMIT)) as unknown;
}
const serve = (name: string, status = 200, etag = `"${COMMIT}"`) => vi.fn<Fetch>().mockResolvedValue(Response.json(body(name), { status, headers: { etag } }));
const signal = () => new AbortController().signal;

describe("lectures des thèmes", () => {
  it("liste et lit les révisions, y compris leur ETag", async () => {
    const abort = signal();
    const list = serve("lister");
    expect(await fetchThemes("finance", abort, list)).toMatchObject({ status: "ok", value: { unreadable: 0 } });
    expect(list).toHaveBeenCalledWith(root, { method: "GET", headers: { Accept: "application/json" }, signal: abort });
    const read = serve("lire");
    expect(await fetchTheme("finance", ID, abort, read)).toMatchObject({ status: "ok", value: { etag: `"${COMMIT}"`, state: "draft" } });
    expect(read).toHaveBeenCalledWith(`${root}/${ID}`, { method: "GET", headers: { Accept: "application/json" }, signal: abort });
    const numbered = serve("lire");
    expect(await fetchThemeRevision("finance", ID, 1, abort, numbered)).toMatchObject({ status: "ok" });
    expect(numbered).toHaveBeenLastCalledWith(`${root}/${ID}?revision=1`, expect.anything());
  });
  it("lit historique, approbations et consommateurs", async () => {
    const abort = signal();
    for (const [name, invoke, suffix] of [
      ["historique", fetchThemeHistory, "history"], ["approbations", fetchThemeApprovals, "approvals"], ["consommateurs", fetchThemeConsumers, "consumers"],
    ] as const) {
      const fetcher = serve(name);
      expect(await invoke("finance", ID, abort, fetcher)).toMatchObject({ status: "ok" });
      expect(fetcher).toHaveBeenCalledWith(`${root}/${ID}/${suffix}`, expect.objectContaining({ signal: abort }));
    }
  });
  it("ne soumet pas des paramètres invalides", async () => {
    const fetcher = serve("lire"); const abort = signal();
    expect(await fetchThemes("..", abort, fetcher)).toMatchObject({ status: "error" });
    expect(await fetchTheme("finance", "x", abort, fetcher)).toMatchObject({ status: "error" });
    expect(await fetchTheme("finance", ID, abort, fetcher, 0)).toMatchObject({ status: "error" });
    for (const invoke of [fetchThemeHistory, fetchThemeApprovals, fetchThemeConsumers]) expect(await invoke("finance", "x", abort, fetcher)).toMatchObject({ status: "error" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuse les réponses incorrectes et les échecs réseau", async () => {
    const abort = signal();
    expect(await fetchTheme("finance", ID, abort, serve("lire", 200, "bad"))).toMatchObject({ status: "error" });
    expect(await fetchTheme("finance", ID, abort, serve("lire"), 2)).toMatchObject({ status: "error" });
    expect(await fetchTheme("finance", ID, abort, vi.fn<Fetch>().mockResolvedValue(Response.json({ ...body("lire") as object, id: "00000000-0000-4000-8000-000000000002" }, { headers: { etag: `"${COMMIT}"` } })))).toMatchObject({ status: "error" });
    expect(await fetchThemes("finance", abort, serve("lister", 201))).toMatchObject({ status: "error" });
    expect(await fetchThemes("finance", abort, vi.fn<Fetch>().mockRejectedValue(new Error("panne")))).toMatchObject({ status: "error" });
    expect(await fetchThemes("finance", abort, vi.fn<Fetch>().mockResolvedValue(new Response("bad", { status: 500 })))).toMatchObject({ status: "error" });
    expect(await fetchThemes("finance", abort, vi.fn<Fetch>().mockResolvedValue(new Response(null, { status: 401 })))).toMatchObject({ status: "error" });
  });
  it("transmet les refus et l'annulation", async () => {
    const abort = signal();
    expect(await fetchThemes("finance", abort, serve("refus-inconnu", 404))).toMatchObject({ status: "refused", code: "theme_not_found" });
    expect(await fetchThemes("finance", abort, serve("refus-inconnu", 404, "x"))).toMatchObject({ status: "refused" });
    expect(await fetchThemes("finance", abort, vi.fn<Fetch>().mockResolvedValue(Response.json({ error: { code: "space_not_found" } }, { status: 404 })))).toMatchObject({ status: "refused" });
    const controller = new AbortController(); controller.abort();
    await expect(fetchThemes("finance", controller.signal, vi.fn<Fetch>().mockRejectedValue(new Error("annulé")))).rejects.toThrow("annulé");
    const later = new AbortController();
    const failing = vi.fn<Fetch>().mockImplementation(() => Promise.resolve(new Response("invalid", { status: 200 })));
    later.abort();
    await expect(fetchThemes("finance", later.signal, failing)).rejects.toThrow();
  });
});


describe("écritures des thèmes", () => {
  const document = (body("lire") as { theme: Record<string, unknown> }).theme;
  const draft = Object.fromEntries(Object.entries(document).filter(([key]) => !["api_version", "id", "owner"].includes(key)));
  const sent = draft as unknown as ThemeDraft;
  it("crée, révise et supprime avec les requêtes attendues", async () => {
    const create = serve("creer", 201);
    expect(await createTheme("finance", sent, create)).toMatchObject({ status: "ok", value: { revision: 1, etag: `"${COMMIT}"` } });
    expect(create).toHaveBeenCalledWith(root, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(sent) });
    const revise = serve("reviser", 201);
    expect(await reviseTheme("finance", ID, sent, 1, revise)).toMatchObject({ status: "ok", value: { revision: 2 } });
    expect(revise).toHaveBeenCalledWith(`${root}/${ID}`, { method: "PUT", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ ...sent, expected_revision: 1 }) });
    expect(await reviseTheme("finance", ID, sent, 1, serve("lire", 200))).toMatchObject({ status: "ok" });
    const remove = vi.fn<Fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    expect(await deleteTheme("finance", ID, 1, remove)).toEqual({ status: "ok", value: null });
    expect(remove).toHaveBeenCalledWith(`${root}/${ID}?expected_revision=1`, { method: "DELETE", headers: { Accept: "application/json" } });
  });
  it("refuse les entrées et réponses hors contrat", async () => {
    const fetcher = serve("creer", 201);
    expect(await createTheme("..", sent, fetcher)).toMatchObject({ status: "error" });
    for (const bad of [{ ...sent, id: ID }, { ...sent, name: "" }]) expect(await createTheme("finance", bad, fetcher)).toMatchObject({ status: "error" });
    expect(await reviseTheme("finance", ID, sent, 0, fetcher)).toMatchObject({ status: "error" });
    expect(await reviseTheme("finance", ID, { ...sent, id: ID } as ThemeDraft, 1, fetcher)).toMatchObject({ status: "error" });
    expect(await deleteTheme("finance", "x", 1, fetcher)).toMatchObject({ status: "error" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await createTheme("finance", sent, serve("lire", 200))).toMatchObject({ status: "error" });
    expect(await createTheme("finance", sent, serve("reviser", 201))).toMatchObject({ status: "error" });
    expect(await createTheme("finance", sent, serve("creer", 201, "bad"))).toMatchObject({ status: "error" });
    expect(await reviseTheme("finance", ID, sent, 1, serve("lire", 201))).toMatchObject({ status: "error" });
    expect(await deleteTheme("finance", ID, 1, serve("lire", 200))).toMatchObject({ status: "error" });
    expect(await deleteTheme("finance", ID, 1, serve("refus-content-in-use", 409))).toMatchObject({ status: "refused", code: "content_in_use" });
  });
});


it("compare et approuve des révisions avec leurs paramètres", async () => {
  const abort = signal();
  const diff = serve("diff");
  expect(await fetchThemeDiff("finance", ID, 1, 2, abort, diff)).toMatchObject({ status: "ok", value: { base: 1, other: 2 } });
  expect(diff).toHaveBeenCalledWith(`${root}/${ID}/diff?from=1&to=2`, { method: "GET", headers: { Accept: "application/json" }, signal: abort });
  const approval = serve("approver", 201);
  expect(await approveTheme("finance", ID, 1, 2, approval)).toMatchObject({ status: "ok", value: { state: "approved" } });
  expect(approval).toHaveBeenCalledWith(`${root}/${ID}/approvals`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ revision: 1, expected_revision: 2 }) });
  expect(await fetchThemeDiff("finance", ID, 0, 2, abort, diff)).toMatchObject({ status: "error" });
  expect(await fetchThemeDiff("finance", ID, 1, 0, abort, diff)).toMatchObject({ status: "error" });
  expect(await approveTheme("finance", ID, 0, 2, approval)).toMatchObject({ status: "error" });
  expect(await approveTheme("finance", ID, 1, 0, approval)).toMatchObject({ status: "error" });
  expect(await fetchThemeDiff("finance", ID, 1, 2, abort, serve("diff", 201))).toMatchObject({ status: "error" });
  expect(await approveTheme("finance", ID, 1, 2, serve("approver", 200))).toMatchObject({ status: "error" });
});

it("signale les pertes de session et d’espace", async () => {
  const session = vi.fn(); const space = vi.fn();
  const offSession = onSessionLost(session); const offSpace = onSpaceLost(space);
  try {
    await fetchThemes("finance", signal(), vi.fn<Fetch>().mockResolvedValue(new Response(null, { status: 401 })));
    await fetchThemes("finance", signal(), vi.fn<Fetch>().mockResolvedValue(Response.json({ error: { code: "space_not_found" } }, { status: 404 })));
    expect(session).toHaveBeenCalledTimes(1); expect(space).toHaveBeenCalledTimes(1);
  } finally { offSession(); offSpace(); }
});

it("refuse une création approuvée ou attribuée à une autre personne", async () => {
  const document = (body("lire") as { theme: Record<string, unknown> }).theme;
  const draft = Object.fromEntries(Object.entries(document).filter(([key]) => !["api_version", "id", "owner"].includes(key))) as unknown as ThemeDraft;
  const source = body("creer") as Record<string, unknown>;
  for (const forged of [{ ...source, state: "approved", approved_revision: 1 }, { ...source, revised_by: { issuer: "other", subject: "other" } }]) {
    const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json(forged, { status: 201, headers: { etag: `"${COMMIT}"` } }));
    expect(await createTheme("finance", draft, fetcher)).toMatchObject({ status: "error" });
  }
});
