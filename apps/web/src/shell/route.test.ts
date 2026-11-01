import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { navigate, routeFromHash, useRoute } from "./route";
afterEach(() => { window.history.replaceState(null, "", "/"); });
it.each(["", "#/", "#/inconnue", "#/catalogue", "#/catalogue/autre"])("résout l'ancre %s", (hash) => {
  expect(routeFromHash(hash)).toBe(hash === "#/catalogue" ? "catalogue" : "prototype");
});
it("navigue et notifie le hook au hashchange, puis se désabonne", () => {
  const { result, unmount } = renderHook(useRoute);
  expect(result.current).toBe("prototype");
  act(() => { navigate("catalogue"); window.dispatchEvent(new HashChangeEvent("hashchange")); });
  expect(window.location.hash).toBe("#/catalogue");
  expect(result.current).toBe("catalogue");
  act(() => { navigate("prototype"); window.dispatchEvent(new HashChangeEvent("hashchange")); });
  expect(result.current).toBe("prototype");
  unmount();
});
