import { screen } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import catalogue from "../../../contracts/catalogue/liste.json";
import espace from "../../../contracts/espaces/espace.json";
import introuvable from "../../../contracts/espaces/introuvable.json";
import journal from "../../../contracts/espaces/journal.json";
import membres from "../../../contracts/espaces/membres.json";
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
  // Membres et rôles, création d'un espace (plan 08, 8.4).
  "/api/spaces/finance/members": membres,
  "/api/spaces/finance/events": journal,
  // Bascule marquée du droit de déployer et ligne « Déploiement » (plan 09, 9.3).
  "/api/spaces/deployeur": { status: 200, body: { ...espace.body, id: "deployeur", name: "Déployeur", role: "creator", environments: [{ code: "DEV", deploy: true }, { code: "TEST", deploy: true }, { code: "PROD", deploy: false }] } },
  "/api/spaces/deployeur/catalog": catalogue,
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
    ["membres et rôles", "#/espaces/finance/membres", () => screen.findByRole("list", { name: "Journal de l'espace" })],
    ["espace avec droit de déployer en DEV et TEST", "#/espaces/deployeur/catalogue", () => screen.findByText("DEV, TEST", { selector: ".sb-space-switch__deploy .sb-mono" })],
    ["nouvel espace sans administration", "#/nouvel-espace", () => screen.findByText(/Seuls les administrateurs de la plateforme/)],
  ])("aucune violation axe : %s", async (_page, hash, attendre) => {
    window.history.replaceState(null, "", `/${hash}`);
    const { container } = renderThemed(<App fetcher={fetcher} leave={() => undefined} />, theme);
    await attendre();
    await screen.findByRole("option", { name: "Finance" });
    await expectAccessible(container);
  });
});
