import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import espace from "../../../contracts/espaces/espace.json";
import liste from "../../../contracts/espaces/liste.json";
import etabli from "../../../contracts/identite/me-etabli.json";
import local from "../../../contracts/identite/me-local.json";
import type { Fetch } from "./spaces/api";
import { App } from "./App";

afterEach(() => { window.history.replaceState(null, "", "/"); });
function setup(path: string, role: "admin" | "reader" = "admin", implicit = false) {
  window.history.replaceState(null, "", `/${path}`);
  const responses: Record<string, object> = { "/api/me": implicit ? local.body : etabli.body, "/api/spaces": liste.body, "/api/spaces/finance": { ...espace.body, role, implicit }, "/api/spaces/finance/themes": { themes: [], unreadable: 0 }, "/api/spaces/finance/page-templates": { page_templates: [], unreadable: 0 }, "/api/spaces/finance/components": { components: [], unreadable: 0 } };
  const fetcher = vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(Response.json(responses[url] ?? {}, { status: responses[url] ? 200 : 500 })));
  render(<App fetcher={fetcher} />);
  return fetcher;
}

it("ouvre la liste et son fil d'Ariane", async () => {
  setup("#/espaces/finance/themes");
  expect(await screen.findByRole("heading", { name: "Aucun thème à afficher" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Thèmes" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("navigation", { name: /fil d.ariane/i })).toHaveTextContent("Thèmes");
  await userEvent.click(screen.getByRole("button", { name: "Thèmes" }));
});

it("ouvre la route de l'éditeur", async () => {
  setup("#/espaces/finance/themes/nouveau");
  expect(await screen.findByRole("heading", { name: "Éditeur de thème" })).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: /fil d.ariane/i })).toHaveTextContent("FinanceThèmesÉditeur");
});

it.each([["reader", false, "sans rôle"], ["admin", true, "mode local"]] as const)("refuse la route selon le contexte", async (role, implicit, reason) => {
  const fetcher = setup("#/espaces/finance/themes", role, implicit);
  expect(await screen.findByText(`Thèmes indisponibles : ${reason}.`)).toBeInTheDocument();
  expect(within(screen.getByRole("navigation", { name: "Navigation principale" })).getByText("Thèmes")).toHaveTextContent(reason);
  expect(fetcher.mock.calls.some(([url]) => url.endsWith("/themes"))).toBe(false);
});

it("raccorde la route de l'historique du thème", async () => {
  setup("#/espaces/finance/themes/00000000-0000-4000-8000-000000000001/historique");
  expect(await screen.findByRole("heading", { name: "Historique du thème" })).toBeInTheDocument();
});

for (const [segment, label] of [["modeles", "Modèles de page"], ["composants", "Composants"]] as const) {
  it(`raccorde la liste ${label}`, async () => {
    setup(`#/espaces/finance/${segment}`);
    expect(await screen.findByRole("heading", { name: label, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /fil d.ariane/i })).toHaveTextContent(label);
    expect(screen.getByRole("button", { name: "Thèmes" })).toHaveAttribute("aria-current", "page");
  });
  it(`raccorde la future fiche ${label}`, async () => {
    setup(`#/espaces/finance/${segment}/exemple`);
    expect(await screen.findByText(/indisponible/)).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /fil d.ariane/i })).toHaveTextContent(label);
  });
}
