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
    await waitFor(() => { expect(result.current[referenceKey(component)]).toEqual({ state: "draft", approved_revision: null, current_revision: 3 }); });
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
