import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi, type Mock } from "vitest";

import espace from "../../../contracts/espaces/espace.json";
import liste from "../../../contracts/espaces/liste.json";
import locale from "../../../contracts/espaces/liste-locale.json";
import etabli from "../../../contracts/identite/me-etabli.json";
import local from "../../../contracts/identite/me-local.json";
import type { Fetch } from "./identity/api";
import { App } from "./App";

type Example = { status: number; body: unknown };
function server(table: Record<string, Example>): Mock<Fetch> {
  return vi.fn<Fetch>().mockImplementation((url, init) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    const found = table[key];
    if (found === undefined) return Promise.reject(new Error(`Unexpected ${key}`));
    return Promise.resolve(Response.json(found.body, { status: found.status }));
  });
}
function open(hash: string, table: Record<string, Example>) {
  window.history.replaceState(null, "", `/${hash}`);
  const fetcher = server(table);
  render(<App fetcher={fetcher} leave={vi.fn()} />);
  return fetcher;
}
afterEach(() => { window.history.replaceState(null, "", "/"); });

it("ouvre Connexions pour l'administration, avec fil d'Ariane et cible de l'environnement", async () => {
  const fetcher = open("#/espaces/finance/connexions", {
    "GET /api/me": etabli,
    "GET /api/spaces": liste,
    "GET /api/spaces/finance": espace,
    "GET /api/spaces/finance/connections": { status: 200, body: { connections: [] } },
    "GET /api/spaces/finance/events": { status: 200, body: { events: [] } },
  });
  expect(await screen.findByRole("heading", { level: 1, name: "Connexions" })).toBeInTheDocument();
  expect(await screen.findByText("Aucune connexion dans cet espace.")).toBeInTheDocument();
  const crumb = within(screen.getByRole("navigation", { name: "Fil d'Ariane" })).getAllByRole("listitem");
  expect(crumb.map((item) => item.textContent)).toEqual(["Finance", "Connexions"]);
  expect(within(screen.getByRole("navigation", { name: "Navigation principale" })).getByRole("button", { name: "Espace & connexions" })).toHaveAttribute("aria-current", "page");
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(expect.arrayContaining(["/api/spaces/finance/connections"]));
  const target = () => screen.getByRole("region", { name: "Connexions logiques" }).querySelector(".sb-connection__environment--target");
  expect(target()).toBeNull(); // aucune connexion, donc aucune liaison cible
  await userEvent.click(within(screen.getByRole("banner")).getByRole("button", { name: "TEST" }));
  expect(window.location.hash).toBe("#/espaces/finance/connexions");
});

it("le mode local dit que le registre d'espace ne se gère pas", async () => {
  const fetcher = open("#/espaces/local/connexions", {
    "GET /api/me": local,
    "GET /api/spaces": locale,
    "GET /api/spaces/local": { status: 200, body: locale.body.spaces[0] },
  });
  expect(await screen.findByRole("heading", { level: 1, name: "Connexions" })).toBeInTheDocument();
  expect(screen.getByText(/En mode local, les connexions d'un espace ne se gèrent pas/)).toBeInTheDocument();
  expect(fetcher.mock.calls.map(([url]) => url)).not.toContain("/api/spaces/local/connections");
});
