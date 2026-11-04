import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import local from "../../../../contracts/identite/me-local.json";
import etabli from "../../../../contracts/identite/me-etabli.json";
import type { Fetch } from "./api";
import { reportSessionLost } from "./session";
import { useIdentity } from "./useIdentity";

function differee() {
  let resolve!: (response: Response) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Response>((ok, ko) => { resolve = ok; reject = ko; });
  return { promise, resolve, reject };
}
const reponse = (exemple: { body: unknown; status: number }) => Response.json(exemple.body, { status: exemple.status });
afterEach(() => { vi.unstubAllGlobals(); });
it("passe du chargement à l'issue avec fetch par défaut", async () => {
  const attente = differee();
  vi.stubGlobal("fetch", vi.fn<Fetch>().mockReturnValue(attente.promise));
  const { result } = renderHook(() => useIdentity());
  expect(result.current.state).toEqual({ status: "loading" });
  await act(async () => { attente.resolve(reponse(local)); await Promise.resolve(); });
  expect(result.current.state).toEqual({ status: "local" });
});
it("relance une lecture en repassant par le chargement", async () => {
  const attente = differee();
  const fetcher = vi.fn<Fetch>().mockResolvedValueOnce(new Response("", { status: 500 })).mockReturnValueOnce(attente.promise);
  const { result } = renderHook(() => useIdentity(fetcher));
  await waitFor(() => { expect(result.current.state.status).toBe("error"); });
  act(() => { result.current.retry(); });
  expect(result.current.state).toEqual({ status: "loading" });
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => { attente.resolve(reponse(etabli)); await Promise.resolve(); });
  expect(result.current.state).toMatchObject({ status: "established", identity: etabli.body.identity });
});
it("ne montre pas l'ancienne réponse pendant la nouvelle tentative", async () => {
  const ancienne = differee(); const nouvelle = differee();
  const fetcher = vi.fn<Fetch>().mockReturnValueOnce(ancienne.promise).mockReturnValueOnce(nouvelle.promise);
  const { result } = renderHook(() => useIdentity(fetcher));
  act(() => { result.current.retry(); });
  expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  await act(async () => { ancienne.resolve(reponse(etabli)); await Promise.resolve(); });
  expect(result.current.state).toEqual({ status: "loading" });
  await act(async () => { nouvelle.resolve(reponse(local)); await Promise.resolve(); });
  expect(result.current.state).toEqual({ status: "local" });
});
it("une réponse dépassée ne remplace jamais l'issue plus récente", async () => {
  const ancienne = differee(); const nouvelle = differee();
  const fetcher = vi.fn<Fetch>().mockReturnValueOnce(ancienne.promise).mockReturnValueOnce(nouvelle.promise);
  const { result } = renderHook(() => useIdentity(fetcher));
  act(() => { result.current.retry(); });
  await act(async () => { nouvelle.resolve(reponse(etabli)); await Promise.resolve(); });
  const courante = result.current.state;
  expect(courante.status).toBe("established");
  await act(async () => { ancienne.resolve(reponse(local)); await Promise.resolve(); });
  expect(result.current.state).toEqual(courante);
});
it.each([false, true])("la perte de session l'emporte, identité déjà établie : %s", async (dejaEtablie) => {
  const attente = differee();
  const fetcher = vi.fn<Fetch>().mockReturnValue(attente.promise);
  const { result } = renderHook(() => useIdentity(fetcher));
  if (dejaEtablie) {
    await act(async () => { attente.resolve(reponse(etabli)); await Promise.resolve(); });
    expect(result.current.state.status).toBe("established");
  }
  act(() => { reportSessionLost(); });
  expect(result.current.state).toEqual({ status: "lost" });
  if (!dejaEtablie) await act(async () => { attente.resolve(reponse(etabli)); await Promise.resolve(); });
  expect(result.current.state).toEqual({ status: "lost" });
});
it("abandonne au démontage et absorbe le rejet sans erreur", async () => {
  const attente = differee();
  const fetcher = vi.fn<Fetch>().mockReturnValue(attente.promise);
  const { unmount } = renderHook(() => useIdentity(fetcher));
  unmount();
  expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  await act(async () => { attente.reject(new DOMException("Abandonné", "AbortError")); await Promise.resolve(); });
});
