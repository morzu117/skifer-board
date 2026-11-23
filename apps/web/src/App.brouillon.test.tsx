import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import espace from "../../../contracts/espaces/espace.json";
import liste from "../../../contracts/espaces/liste.json";
import etabli from "../../../contracts/identite/me-etabli.json";
import type { Fetch } from "./spaces/api";
import { App } from "./App";

vi.mock("./dashboards/DashboardsPage", () => ({ DashboardsPage: ({ onLocalChange }: { onLocalChange: (value: boolean) => void }) => <><button onClick={() => { onLocalChange(true); }}>Brouillon</button><button onClick={() => { onLocalChange(false); }}>Liste</button></> }));
afterEach(() => { window.history.replaceState(null, "", "/"); });
it("ajoute Éditeur au fil d'Ariane uniquement pendant le brouillon local", async () => {
  window.history.replaceState(null, "", "/#/espaces/finance/dashboards");
  const responses: Record<string, object> = { "/api/me": etabli.body, "/api/spaces": liste.body, "/api/spaces/finance": espace.body };
  const fetcher = vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(Response.json(responses[url] ?? {}, { status: responses[url] ? 200 : 500 })));
  render(<App fetcher={fetcher} />);
  const start = await screen.findByRole("button", { name: "Brouillon" });
  const crumbs = () => within(screen.getByRole("navigation", { name: "Fil d'Ariane" })).getAllByRole("listitem").map((item) => item.textContent);
  expect(crumbs()).toEqual(["Finance", "Dashboards"]);
  fireEvent.click(start); expect(crumbs()).toEqual(["Finance", "Dashboards", "Éditeur"]);
  fireEvent.click(screen.getByRole("button", { name: "Liste" })); expect(crumbs()).toEqual(["Finance", "Dashboards"]);
});
