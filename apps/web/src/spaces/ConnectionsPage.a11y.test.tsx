import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, vi } from "vitest";

import espace from "../../../../contracts/espaces/espace.json";
import { THEMES } from "../charts/theme";
import { expectAccessible, renderThemed } from "../test/a11y";
import type { Fetch } from "./api";
import { ConnectionsPage } from "./ConnectionsPage";
import { decodeSpace } from "./model";

const FINANCE = decodeSpace(espace.body, "espace");
const REF = { issuer: "https://id.example.invalid", subject: "admin" };
const AT = "2026-11-03T10:00:00+00:00";
const LIST = { connections: [{ name: "source", created_at: AT, created_by: REF, bindings: [
  { environment: "DEV", connector: "databricks", endpoint_key: "warehouse-prod", identity_mode: "service", set_at: AT, set_by: REF, credential_state: "configured" },
  { environment: "TEST", state: "unconfigured" },
  { environment: "PROD", state: "unconfigured" },
] }] };

function server(loading = false): Fetch {
  return vi.fn<Fetch>().mockImplementation((url: string) => {
    if (loading) return new Promise<Response>(() => undefined);
    if (url.endsWith("/connections")) return Promise.resolve(Response.json(LIST));
    if (url.endsWith("/events")) return Promise.resolve(Response.json({ events: [] }));
    return Promise.reject(new Error("unexpected"));
  });
}

describe.each(THEMES)("Accessibilité de « Connexions » · $label", (theme) => {
  it("aucune violation axe pendant la lecture", async () => {
    const { container } = renderThemed(<main><ConnectionsPage space={FINANCE} fetcher={server(true)} target="DEV" /></main>, theme);
    await expectAccessible(container);
  });

  it("aucune violation axe pour les liaisons et la création", async () => {
    const { container } = renderThemed(<main><ConnectionsPage space={FINANCE} fetcher={server()} target="DEV" /></main>, theme);
    await screen.findByRole("region", { name: "Connexion source" });
    await expectAccessible(container);
  });

  it("aucune violation axe pour configuration, secret et confirmation", async () => {
    const { container } = renderThemed(<main><ConnectionsPage space={FINANCE} fetcher={server()} target="DEV" /></main>, theme);
    const source = await screen.findByRole("region", { name: "Connexion source" });
    const dev = within(source).getByRole("region", { name: "source · DEV" });
    await userEvent.click(within(dev).getByRole("button", { name: "Modifier la liaison" }));
    await expectAccessible(container);
    await userEvent.click(within(dev).getByRole("button", { name: "Remplacer l'identifiant" }));
    await expectAccessible(container);
    await userEvent.click(within(dev).getByRole("button", { name: "Retirer la liaison" }));
    await expectAccessible(container);
  });
});
