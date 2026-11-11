import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { navigate } from "./route";
import { useExitGuard } from "./useExitGuard";

afterEach(() => { window.history.replaceState(null, "", "/"); });

it("sans changement, ne retient rien", () => {
  const { result } = renderHook(() => useExitGuard(false));
  act(() => { navigate({ page: "dashboards", space: "finance" }); });
  expect(window.location.hash).toBe("#/espaces/finance/dashboards");
  expect(result.current.pending).toBeNull();
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  render(<a href="#/espaces/finance/analyses">Ailleurs</a>);
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  screen.getByRole("link").dispatchEvent(click);
  expect(click.defaultPrevented).toBe(false);
});

it("avec des changements, retient navigate et les liens d'ancre, et propose de rester ou de partir", async () => {
  const { result, rerender } = renderHook(({ dirty }) => useExitGuard(dirty), { initialProps: { dirty: true } });
  act(() => { navigate({ page: "dashboards", space: "finance" }); });
  expect(window.location.hash).toBe("");
  expect(result.current.pending).toBe("#/espaces/finance/dashboards");
  act(() => { result.current.stay(); });
  expect(result.current.pending).toBeNull();
  render(<><a href="#/espaces/finance/analyses">Ailleurs</a><a href="https://example.invalid/">Dehors</a></>);
  const prevented: boolean[] = [];
  document.addEventListener("click", (one) => { prevented.push(one.defaultPrevented); });
  await userEvent.click(screen.getByRole("link", { name: "Ailleurs" }));
  expect(prevented).toEqual([true]);
  expect(result.current.pending).toBe("#/espaces/finance/analyses");
  act(() => { result.current.stay(); });
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  const outside = new MouseEvent("click", { bubbles: true, cancelable: true });
  screen.getByRole("link", { name: "Dehors" }).addEventListener("click", (one) => { one.preventDefault(); });
  screen.getByRole("link", { name: "Dehors" }).dispatchEvent(outside);
  expect(result.current.pending).toBeNull();
  act(() => { navigate({ page: "home" }); });
  act(() => { result.current.leave(); });
  expect(result.current.pending).toBeNull();
  expect(window.location.hash).toBe("#/");
  rerender({ dirty: false });
  act(() => { navigate({ page: "dashboards", space: "finance" }); });
  expect(window.location.hash).toBe("#/espaces/finance/dashboards");
});

it("au changement d'adresse, rétablit celle de la page et retient l'adresse demandée ; ignore le retour à la même adresse", async () => {
  window.history.replaceState(null, "", "/#/espaces/finance/dashboards/un");
  const { result } = renderHook(() => useExitGuard(true));
  window.location.hash = "#/espaces/finance/analyses";
  await waitFor(() => { expect(result.current.pending).toBe("#/espaces/finance/analyses"); });
  expect(window.location.hash).toBe("#/espaces/finance/dashboards/un");
  act(() => { result.current.stay(); });
  act(() => { window.dispatchEvent(new HashChangeEvent("hashchange")); });
  expect(result.current.pending).toBeNull();
  window.location.hash = "#/";
  await waitFor(() => { expect(result.current.pending).toBe("#/"); });
  act(() => { result.current.leave(); });
  await waitFor(() => { expect(window.location.hash).toBe("#/"); });
  expect(result.current.pending).toBeNull();
});

it("le bouton Précédent du navigateur passe par la garde", async () => {
  window.history.replaceState(null, "", "/#/espaces/finance/analyses");
  window.location.hash = "#/espaces/finance/dashboards/un";
  const { result } = renderHook(() => useExitGuard(true));
  window.history.back();
  await waitFor(() => { expect(result.current.pending).toBe("#/espaces/finance/analyses"); });
  expect(window.location.hash).toBe("#/espaces/finance/dashboards/un");
});

it("sans changement, un changement d'adresse n'est pas retenu", async () => {
  const { result } = renderHook(() => useExitGuard(false));
  window.location.hash = "#/espaces/finance/analyses";
  await waitFor(() => { expect(window.location.hash).toBe("#/espaces/finance/analyses"); });
  expect(result.current.pending).toBeNull();
});

it("une adresse saisie à la main (hashchange sans popstate) est rétablie puis quittée d'un pas en arrière ; Précédent (popstate) ne recule pas", () => {
  window.history.replaceState(null, "", "/#/espaces/finance/dashboards/un");
  const { result } = renderHook(() => useExitGuard(true));
  const go = vi.spyOn(window.history, "go").mockImplementation(() => undefined);
  window.history.pushState(null, "", "#/espaces/finance/analyses");
  act(() => { window.dispatchEvent(new HashChangeEvent("hashchange")); });
  expect(window.location.hash).toBe("#/espaces/finance/dashboards/un");
  expect(result.current.pending).toBe("#/espaces/finance/analyses");
  expect(go).toHaveBeenCalledExactlyOnceWith(-1);
  act(() => { result.current.stay(); });
  window.history.pushState(null, "", "#/");
  act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
  expect(window.location.hash).toBe("#/espaces/finance/dashboards/un");
  expect(result.current.pending).toBe("#/");
  expect(go).toHaveBeenCalledOnce();
  go.mockRestore();
});

it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])("laisse le navigateur gérer les clics modifiés %s", (options) => {
  const { result } = renderHook(() => useExitGuard(true));
  render(<a href="#/espaces/finance/analyses">Ailleurs</a>);
  const link = screen.getByRole("link");
  link.addEventListener("click", (event) => { event.preventDefault(); });
  act(() => { link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...options })); });
  expect(result.current.pending).toBeNull();
});
