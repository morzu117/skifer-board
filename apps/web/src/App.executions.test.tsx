import { render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi, type Mock } from "vitest";
import espace from "../../../contracts/espaces/espace.json";
import liste from "../../../contracts/espaces/liste.json";
import etabli from "../../../contracts/identite/me-etabli.json";
import type { Fetch } from "./identity/api";
import { App } from "./App";

function open(spaces: { status: number; body: unknown }): Mock<Fetch> {
  window.history.replaceState(null, "", "/#/espaces/finance/executions");
  const table: Record<string, { status: number; body: unknown }> = {
    "GET /api/me": etabli,
    "GET /api/spaces": spaces,
    "GET /api/spaces/finance": espace,
    "GET /api/spaces/finance/executions?scope=mine": { status: 200, body: { executions: [] } },
  };
  const fetcher = vi.fn<Fetch>().mockImplementation((url, init) => {
    const found = table[`${init?.method ?? "GET"} ${url}`];
    return found === undefined ? Promise.reject(new Error(`Unexpected ${url}`)) : Promise.resolve(Response.json(found.body, { status: found.status }));
  });
  render(<App fetcher={fetcher} leave={vi.fn()} />);
  return fetcher;
}
afterEach(() => { window.history.replaceState(null, "", "/"); });

it("ouvre la route d'exécutions dans l'espace confirmé et nomme son fil d'Ariane", async () => {
  const fetcher = open(liste);
  expect(await screen.findByRole("heading", { level: 1, name: "Exécutions" })).toBeInTheDocument();
  expect(await screen.findByText("Aucune exécution dans cette vue.")).toBeInTheDocument();
  const crumb = within(screen.getByRole("navigation", { name: "Fil d'Ariane" })).getAllByRole("listitem");
  expect(crumb.map((item) => item.textContent)).toEqual(["Finance", "Exécutions"]);
  expect(fetcher.mock.calls.map(([url]) => url)).toContain("/api/spaces/finance/executions?scope=mine");
});

it("lit les exécutions même si la liste du sélecteur est momentanément indisponible", async () => {
  open({ status: 503, body: { error: { code: "state_unavailable" } } });
  expect(await screen.findByText("Aucune exécution dans cette vue.")).toBeInTheDocument();
});
