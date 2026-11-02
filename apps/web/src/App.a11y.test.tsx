import { screen } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import catalogue from "../../../contracts/catalogue/liste.json";
import espace from "../../../contracts/espaces/espace.json";
import introuvable from "../../../contracts/espaces/introuvable.json";
import liste from "../../../contracts/espaces/liste.json";
import etabli from "../../../contracts/identite/me-etabli.json";
import { THEMES } from "./charts/theme";
import type { Fetch } from "./identity/api";
import { expectAccessible, renderThemed } from "./test/a11y";

import { App } from "./App";

type Exemple = { status: number; body: unknown };
const ROUTES: Readonly<Record<string, Exemple>> = {
  "/api/me": etabli,
  "/api/spaces": liste,
  "/api/spaces/finance": espace,
  "/api/spaces/finance/catalog": catalogue,
  "/api/spaces/inconnu": introuvable,
  "/api/spaces/plateforme": { status: 200, body: { ...espace.body, id: "plateforme", name: "Plateforme", role: null } },
  "/api/spaces/panne": { status: 500, body: {} },
};
const fetcher = vi.fn<Fetch>().mockImplementation((url) => {
  const exemple = ROUTES[url];
  return exemple === undefined ? Promise.reject(new Error(url)) : Promise.resolve(Response.json(exemple.body, { status: exemple.status }));
});
afterEach(() => { window.history.replaceState(null, "", "/"); });

describe.each(THEMES)("Accessibilité de la coque avec espaces · $label", (theme) => {
  it.each([
    ["accueil des espaces", "#/", () => screen.findByRole("list", { name: "Espaces" })],
    ["catalogue d'un espace", "#/espaces/finance/catalogue", () => screen.findByRole("table")],
    ["espace introuvable", "#/espaces/inconnu/catalogue", () => screen.findByRole("heading", { name: "Espace introuvable" })],
    ["administration sans rôle", "#/espaces/plateforme/catalogue", () => screen.findByText(/sans rôle dans cet espace/)],
    ["espace indisponible", "#/espaces/panne/catalogue", () => screen.findByRole("heading", { level: 1, name: "Espace indisponible" })],
  ])("aucune violation axe : %s", async (_page, hash, attendre) => {
    window.history.replaceState(null, "", `/${hash}`);
    const { container } = renderThemed(<App fetcher={fetcher} leave={() => undefined} />, theme);
    await attendre();
    await screen.findByRole("option", { name: "Finance" });
    await expectAccessible(container);
  });
});
