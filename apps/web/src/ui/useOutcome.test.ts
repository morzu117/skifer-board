import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useOutcome } from "./useOutcome";

type Issue = { status: "ok"; value: string };

function differee() {
  let resolve!: (value: Issue) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Issue>((ok, ko) => { resolve = ok; reject = ko; });
  return { promise, resolve, reject };
}

describe("useOutcome", () => {
  it("annonce le chargement, puis rend la réponse de la clé courante", async () => {
    const attente = differee();
    const load = vi.fn(() => attente.promise);
    const { result } = renderHook(() => useOutcome("a", load));
    expect(result.current).toEqual({ status: "loading" });
    expect(load).toHaveBeenCalledOnce();
    await act(async () => { attente.resolve({ status: "ok", value: "A" }); await Promise.resolve(); });
    expect(result.current).toEqual({ status: "ok", value: "A" });
  });

  it("ne relit pas quand seule la fonction change, et relit à chaque changement de clé", async () => {
    const lectures: string[] = [];
    const { result, rerender } = renderHook(({ cle }: { cle: string }) => useOutcome(cle, () => { lectures.push(cle); return Promise.resolve({ status: "ok", value: cle } as Issue); }), { initialProps: { cle: "a" } });
    await act(async () => { await Promise.resolve(); });
    rerender({ cle: "a" });
    rerender({ cle: "a" });
    expect(lectures).toEqual(["a"]);
    rerender({ cle: "b" });
    // La réponse de « a » n'est jamais présentée pour « b » : chargement jusqu'à la sienne.
    expect(result.current).toEqual({ status: "loading" });
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toEqual({ status: "ok", value: "b" });
    expect(lectures).toEqual(["a", "b"]);
  });

  it("utilise la dernière fonction reçue pour une nouvelle clé", async () => {
    const premiere = vi.fn(() => Promise.resolve({ status: "ok", value: "ancienne" } as Issue));
    const seconde = vi.fn(() => Promise.resolve({ status: "ok", value: "nouvelle" } as Issue));
    const { result, rerender } = renderHook(({ cle, load }) => useOutcome(cle, load), { initialProps: { cle: "a", load: premiere } });
    await act(async () => { await Promise.resolve(); });
    rerender({ cle: "b", load: seconde });
    await act(async () => { await Promise.resolve(); });
    expect(seconde).toHaveBeenCalledOnce();
    expect(premiere).toHaveBeenCalledOnce();
    expect(result.current).toEqual({ status: "ok", value: "nouvelle" });
  });

  it("abandonne la lecture précédente et ignore sa réponse tardive", async () => {
    const lentes = new Map<string, ReturnType<typeof differee>>([["a", differee()], ["b", differee()]]);
    const signaux = new Map<string, AbortSignal>();
    const { result, rerender } = renderHook(({ cle }: { cle: string }) => useOutcome(cle, (signal) => {
      signaux.set(cle, signal);
      return (lentes.get(cle) as ReturnType<typeof differee>).promise;
    }), { initialProps: { cle: "a" } });
    rerender({ cle: "b" });
    expect(signaux.get("a")?.aborted).toBe(true);
    expect(signaux.get("b")?.aborted).toBe(false);
    // « a » répond après coup : ni pour « b », ni plus tard si l'on revient à « a ».
    await act(async () => { lentes.get("a")?.resolve({ status: "ok", value: "A tardive" }); await Promise.resolve(); });
    expect(result.current).toEqual({ status: "loading" });
    await act(async () => { lentes.get("b")?.resolve({ status: "ok", value: "B" }); await Promise.resolve(); });
    expect(result.current).toEqual({ status: "ok", value: "B" });
  });

  it("revenir à une clé déjà lue la relit au lieu de servir l'ancienne réponse", async () => {
    let compteur = 0;
    const { result, rerender } = renderHook(({ cle }: { cle: string }) => useOutcome(cle, () => {
      compteur += 1;
      return Promise.resolve({ status: "ok", value: `${cle}#${String(compteur)}` } as Issue);
    }), { initialProps: { cle: "a" } });
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toEqual({ status: "ok", value: "a#1" });
    rerender({ cle: "b" });
    await act(async () => { await Promise.resolve(); });
    rerender({ cle: "a" });
    expect(result.current).toEqual({ status: "loading" });
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toEqual({ status: "ok", value: "a#3" });
  });

  it("un rejet (lecture abandonnée) laisse le chargement, sans erreur non gérée", async () => {
    const attente = differee();
    const { result } = renderHook(() => useOutcome("a", () => attente.promise));
    await act(async () => { attente.reject(new DOMException("Abandonné", "AbortError")); await Promise.resolve(); });
    expect(result.current).toEqual({ status: "loading" });
  });

  it("abandonne la lecture au démontage et n'écrit plus d'état ensuite", async () => {
    const attente = differee();
    let signal: AbortSignal | undefined;
    const erreurs = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { unmount } = renderHook(() => useOutcome("a", (recu) => { signal = recu; return attente.promise; }));
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => { attente.resolve({ status: "ok", value: "trop tard" }); await Promise.resolve(); });
    expect(erreurs).not.toHaveBeenCalled();
    erreurs.mockRestore();
  });
});
