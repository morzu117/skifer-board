import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fetchComponent, fetchComponentRevision } from "../../components-lib/client";
import { fetchTheme, fetchThemeRevision } from "../../themes/client";
import type { Fetch } from "../../spaces/api";
import { N, sampleDraft } from "./testing";
import { referenceKey, referencesOf, useReferenceStates } from "./useReferenceStates";

vi.mock("../../components-lib/client", () => ({ fetchComponent: vi.fn(), fetchComponentRevision: vi.fn() }));
vi.mock("../../themes/client", () => ({ fetchTheme: vi.fn(), fetchThemeRevision: vi.fn() }));
const response = (revision: number, state: "draft" | "approved") => ({ status: "ok" as const, value: { revision, state, approvedRevision: state === "approved" ? revision : null } });
const fetcher = vi.fn<Fetch>();
const component = { kind: "component" as const, id: N.visual, revision: 1 };
const theme = { kind: "theme" as const, id: N.kpi, revision: 2 };

describe("états des références", () => {
  it("déduplique les références imbriquées du brouillon", () => {
    const draft = { ...sampleDraft(), theme: { theme_id: N.kpi, revision: 2 }, layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: [{ id: N.text, type: "component" as const, component: { component_id: N.visual, revision: 1 } }, { id: N.kpi, type: "component" as const, component: { component_id: N.visual, revision: 1 } }] }] }] }] } };
    expect(referencesOf(draft)).toEqual([component, theme]);
    expect(referencesOf(sampleDraft())).toEqual([]);
  });
  it("lit révisions épinglées et courantes et garde les refus non résolus", async () => {
    vi.mocked(fetchComponent).mockResolvedValue(response(3, "approved") as never);
    vi.mocked(fetchComponentRevision).mockResolvedValue(response(1, "draft") as never);
    vi.mocked(fetchTheme).mockResolvedValue(response(2, "approved") as never);
    vi.mocked(fetchThemeRevision).mockResolvedValue({ status: "error", message: "panne" });
    const { result } = renderHook(() => useReferenceStates("finance", "ada", "dashboard", [component, theme], fetcher));
    await waitFor(() => { expect(result.current[referenceKey(component)]).toEqual({ state: "draft", approved_revision: 3, current_revision: 3 }); });
    expect(result.current[referenceKey(theme)]).toEqual({ state: "unresolved" });
  });
  it("annule les lectures au changement de session", async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(fetchComponent).mockImplementation((_space, _id, s) => { signal = s; return new Promise(() => undefined); });
    vi.mocked(fetchComponentRevision).mockImplementation(() => new Promise(() => undefined));
    const { rerender, unmount } = renderHook(({ identity }) => useReferenceStates("finance", identity, "dashboard", [component], fetcher), { initialProps: { identity: "ada" } });
    await waitFor(() => { expect(signal).toBeDefined(); });
    const previous = signal;
    rerender({ identity: "bea" });
    expect(previous?.aborted).toBe(true);
    unmount();
    expect(signal?.aborted).toBe(true);
  });
  it("partage la lecture courante entre plusieurs révisions", async () => {
    vi.mocked(fetchComponent).mockReset().mockResolvedValue(response(3, "approved") as never);
    vi.mocked(fetchComponentRevision).mockReset().mockResolvedValue(response(1, "draft") as never);
    const second = { ...component, revision: 2 };
    const { result } = renderHook(() => useReferenceStates("finance", "ada", "dashboard", [component, second, component], fetcher));
    await waitFor(() => { expect(result.current[referenceKey(second)]).toBeDefined(); });
    expect(fetchComponent).toHaveBeenCalledTimes(1);
    expect(fetchComponentRevision).toHaveBeenCalledTimes(2);
  });
  it("ne réutilise pas une réponse de A après A → B → A", async () => {
    let release: ((value: never) => void) | undefined;
    vi.mocked(fetchComponent).mockReset().mockResolvedValueOnce(response(1, "approved") as never).mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    vi.mocked(fetchComponentRevision).mockReset().mockResolvedValue(response(1, "approved") as never);
    const { result, rerender } = renderHook(({ space }) => useReferenceStates(space, "ada", "dashboard", [component], fetcher), { initialProps: { space: "a" } });
    await waitFor(() => { expect(result.current[referenceKey(component)]?.state).toBe("approved"); });
    rerender({ space: "b" });
    expect(result.current[referenceKey(component)]).toBeUndefined();
    rerender({ space: "a" });
    expect(result.current[referenceKey(component)]).toBeUndefined();
    act(() => { release?.(response(1, "draft") as never); });
    await waitFor(() => { expect(result.current[referenceKey(component)]?.state).toBe("approved"); });
  });
});
it("conserve la clé inchangée pendant la lecture et remplace aussitôt un refus", async () => {
  let finish: ((value: never) => void) | undefined;
  vi.mocked(fetchComponent).mockReset().mockResolvedValueOnce(response(1, "approved") as never).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  vi.mocked(fetchComponentRevision).mockReset().mockResolvedValue(response(1, "approved") as never);
  const second = { ...component, id: N.kpi };
  const { result, rerender } = renderHook(({ refs }) => useReferenceStates("finance", "ada", "dashboard", refs, fetcher), { initialProps: { refs: [component] } });
  await waitFor(() => { expect(result.current[referenceKey(component)]?.state).toBe("approved"); });
  rerender({ refs: [component, second] });
  expect(result.current[referenceKey(component)]?.state).toBe("approved"); expect(result.current[referenceKey(second)]).toBeUndefined();
  // Le refus d'une clé ne doit pas réutiliser le succès d'une autre.
  act(() => { finish?.({ status: "error", message: "panne" } as never); });
  await waitFor(() => { expect(result.current[referenceKey(second)]?.state).toBe("unresolved"); });
  expect(result.current[referenceKey(component)]?.state).toBe("approved");
});
it("un refus reçu remplace immédiatement l'ancien état, même si une autre lecture attend", async () => {
  let finishA: ((value: never) => void) | undefined;
  let count = 0;
  vi.mocked(fetchComponent).mockReset().mockImplementation((_space, id) => {
    if (id !== component.id) return new Promise(() => undefined);
    if (count++ === 0) return Promise.resolve(response(1, "approved") as never);
    return new Promise((resolve) => { finishA = resolve; });
  });
  vi.mocked(fetchComponentRevision).mockReset().mockResolvedValue(response(1, "approved") as never);
  const second = { ...component, id: N.kpi };
  const { result, rerender } = renderHook(({ refs }) => useReferenceStates("finance", "ada", "dashboard", refs, fetcher), { initialProps: { refs: [component] } });
  await waitFor(() => { expect(result.current[referenceKey(component)]?.state).toBe("approved"); });
  rerender({ refs: [component, second] }); expect(result.current[referenceKey(component)]?.state).toBe("approved");
  act(() => { finishA?.({ status: "error", message: "refus" } as never); });
  await waitFor(() => { expect(result.current[referenceKey(component)]?.state).toBe("unresolved"); });
  expect(result.current[referenceKey(second)]).toBeUndefined();
});
it("rend une lecture rejetée non résolue", async () => {
  vi.mocked(fetchComponent).mockReset().mockRejectedValue(new Error("panne"));
  vi.mocked(fetchComponentRevision).mockReset().mockResolvedValue(response(1, "approved") as never);
  const { result } = renderHook(() => useReferenceStates("finance", "ada", "dashboard", [component], fetcher));
  await waitFor(() => { expect(result.current[referenceKey(component)]).toEqual({ state: "unresolved" }); });
});
it("isole le rejet dans une nouvelle session", async () => {
  vi.mocked(fetchComponent).mockReset().mockResolvedValueOnce(response(1, "approved") as never).mockRejectedValueOnce(new Error("panne"));
  vi.mocked(fetchComponentRevision).mockReset().mockResolvedValue(response(1, "approved") as never);
  const { result, rerender } = renderHook(({ identity }) => useReferenceStates("finance", identity, "dashboard", [component], fetcher), { initialProps: { identity: "ada" } });
  await waitFor(() => { expect(result.current[referenceKey(component)]?.state).toBe("approved"); });
  rerender({ identity: "bea" });
  await waitFor(() => { expect(result.current[referenceKey(component)]).toEqual({ state: "unresolved" }); });
});
it("ignore le rejet d'une lecture annulée", async () => {
  let reject: (error: Error) => void = () => undefined;
  vi.mocked(fetchComponent).mockReset().mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  vi.mocked(fetchComponentRevision).mockReset().mockResolvedValue(response(1, "approved") as never);
  const { result, rerender } = renderHook(({ refs }) => useReferenceStates("finance", "ada", "dashboard", refs, fetcher), { initialProps: { refs: [component] } });
  rerender({ refs: [] });
  await act(async () => { reject(new Error("annulée")); await Promise.resolve(); });
  expect(result.current).toEqual({});
});
it("ignore également une réponse reçue après annulation", async () => {
  let finish: (value: never) => void = () => undefined;
  vi.mocked(fetchComponent).mockReset().mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  vi.mocked(fetchComponentRevision).mockReset().mockResolvedValue(response(1, "approved") as never);
  const { result, rerender } = renderHook(({ refs }) => useReferenceStates("finance", "ada", "dashboard", refs, fetcher), { initialProps: { refs: [component] } });
  rerender({ refs: [] });
  await act(async () => { finish(response(1, "approved") as never); await Promise.resolve(); });
  expect(result.current).toEqual({});
});

it("garde la même identité entre deux rendus sans changement", async () => {
  vi.mocked(fetchComponent).mockReset().mockResolvedValue(response(1, "approved") as never);
  vi.mocked(fetchComponentRevision).mockReset().mockResolvedValue(response(1, "approved") as never);
  const { result, rerender } = renderHook(() => useReferenceStates("finance", "ada", "dashboard", [component], fetcher));
  await waitFor(() => { expect(result.current[referenceKey(component)]?.state).toBe("approved"); });
  const previous = result.current;
  rerender();
  expect(result.current).toBe(previous);
});
