import { render, screen } from "@testing-library/react";
import { afterEach, it, vi } from "vitest";
import { App } from "../App";
import { expectAccessible } from "../test/a11y";
import { LoginScreen } from "./LoginScreen";
import type { Fetch } from "./api";

afterEach(() => { window.history.replaceState(null, "", "/"); });
it.each([null, "token_refused", "session_expired"] as const)("connexion accessible, raison : %s", async (reason) => {
  const { container } = render(<LoginScreen loginUrl="/auth/login" reason={reason} />);
  await expectAccessible(container);
});
it("écran d'identité indisponible accessible", async () => {
  const fetcher = vi.fn<Fetch>().mockRejectedValue(new Error("hors ligne"));
  const { container } = render(<App fetcher={fetcher} leave={vi.fn()} />);
  await screen.findByRole("alert");
  await expectAccessible(container);
});
