import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import liste from "../../../contracts/catalogue/liste.json";

import { App } from "./App";

describe("App", () => {
  it("affiche la coque et change d'environnement", async () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: "Prototype graphique" })).toBeInTheDocument();
    expect(screen.getByText("Identité non établie · données de démonstration")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "PROD" }));
    expect(screen.getByRole("button", { name: "PROD" })).toHaveAttribute("aria-pressed", "true");
  });
});


afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});
it("lie la marque à l'accueil et livre Catalogue Atlas avec son fil d'Ariane", async () => {
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(Response.json(liste.body)));
  vi.stubGlobal("fetch", fetcher);
  render(<App />);
  const nav = screen.getByRole("navigation", { name: "Navigation principale" });
  expect(within(nav).getByRole("link", { name: "Skifer Board" })).toHaveAttribute("href", "#/");
  expect(within(nav).getAllByRole("button")).toHaveLength(1);
  for (const name of ["Explorer", "Analyses", "Dashboards", "Déploiements", "Espace & connexions"]) {
    expect(within(nav).getByText(name)).toHaveTextContent("à venir");
  }
  await userEvent.click(within(nav).getByRole("button", { name: "Catalogue Atlas" }));
  await screen.findByRole("heading", { level: 1, name: "Catalogue Atlas" });
  await screen.findByRole("table");
  expect(window.location.hash).toBe("#/catalogue");
  expect(fetcher).toHaveBeenCalledWith("/api/catalog", expect.anything());
  expect(screen.getByRole("navigation", { name: "Fil d'Ariane" })).toHaveTextContent("Catalogue Atlas");
  expect(within(nav).getByRole("button", { name: "Catalogue Atlas" })).toHaveAttribute("aria-current", "page");
  await userEvent.click(within(nav).getByRole("link", { name: "Skifer Board" }));
  await waitFor(() => { expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Prototype graphique"); });
  expect(screen.getByRole("navigation", { name: "Fil d'Ariane" })).toHaveTextContent("Prototype graphique");
});
