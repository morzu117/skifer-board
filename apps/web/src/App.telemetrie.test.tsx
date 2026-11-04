import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import administration from "../../../contracts/espaces/liste-administration.json";
import liste from "../../../contracts/espaces/liste.json";
import locale from "../../../contracts/espaces/liste-locale.json";
import etabli from "../../../contracts/identite/me-etabli.json";
import local from "../../../contracts/identite/me-local.json";
import interdit from "../../../contracts/telemetrie/interdit.json";
import lecture7j from "../../../contracts/telemetrie/lecture-7j.json";
import lecture from "../../../contracts/telemetrie/lecture.json";
import modeLocal from "../../../contracts/telemetrie/mode-local.json";
import type { Fetch } from "./identity/api";

import { App } from "./App";

// Écran « Télémétrie » dans la coque (plan 11, 11.4) : route hors espace, fil d'Ariane, lien de
// l'accueil pour l'administration de la plateforme, refus et mode local dits tels quels.

type Exemple = { status: number; body: unknown };
const ADMIN: Readonly<Record<string, Exemple>> = {
  "GET /api/me": etabli,
  "GET /api/spaces": administration,
  "GET /api/telemetry?window=24h": lecture,
  "GET /api/telemetry?window=7d": lecture7j,
};
function routeur(table: Readonly<Record<string, Exemple>>): Mock<Fetch> {
  return vi.fn<Fetch>().mockImplementation((url, init) => {
    const cle = `${init?.method ?? "GET"} ${url}`;
    const exemple = table[cle];
    if (exemple === undefined) return Promise.reject(new Error(`appel inattendu : ${cle}`));
    return Promise.resolve(Response.json(exemple.body, { status: exemple.status }));
  });
}
function ouvrir(hash: string, table: Readonly<Record<string, Exemple>> = ADMIN) {
  window.history.replaceState(null, "", `/${hash}`);
  const fetcher = routeur(table);
  render(<App fetcher={fetcher} leave={vi.fn()} />);
  return fetcher;
}
const lus = (fetcher: Mock<Fetch>) => fetcher.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`);
const filAriane = () => within(screen.getByRole("navigation", { name: "Fil d'Ariane" })).getAllByRole("listitem").map((item) => item.textContent);
const nav = () => screen.getByRole("navigation", { name: "Navigation principale" });
const tableau = () => screen.findByRole("table", { name: "Opérations, les plus lentes d'abord (p95 décroissant)" });

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("« Télémétrie » dans la coque (plan 11, 11.4)", () => {
  it("#/telemetrie ouvre l'écran : fil d'Ariane « Vos espaces › Télémétrie », aucune entrée courante, aucune lecture d'espace", async () => {
    const fetcher = ouvrir("#/telemetrie");
    expect(await screen.findByRole("heading", { level: 1, name: "Télémétrie" })).toBeInTheDocument();
    await tableau();
    expect(filAriane()).toEqual(["Vos espaces", "Télémétrie"]);
    for (const bouton of within(nav()).queryAllByRole("button")) expect(bouton).not.toHaveAttribute("aria-current");
    expect(lus(fetcher).filter((cle) => cle.startsWith("GET /api/spaces/"))).toEqual([]);
    expect(lus(fetcher).filter((cle) => cle.includes("catalog"))).toEqual([]);
    expect(lus(fetcher).filter((cle) => !cle.startsWith("GET"))).toEqual([]);
    expect(lus(fetcher).filter((cle) => cle.includes("/api/telemetry"))).toEqual(["GET /api/telemetry?window=24h"]);
  });

  it("l'accueil de l'administration de la plateforme mène à la télémétrie, et la fenêtre se change", async () => {
    const fetcher = ouvrir("#/");
    await userEvent.click(await screen.findByRole("link", { name: "Télémétrie" }));
    await waitFor(() => { expect(window.location.hash).toBe("#/telemetrie"); });
    await tableau();
    expect(filAriane()).toEqual(["Vos espaces", "Télémétrie"]);
    await userEvent.click(screen.getByRole("button", { name: "7 j" }));
    expect(await screen.findByRole("region", { name: "Opérations sur les 7 derniers jours" })).toBeInTheDocument();
    // La fenêtre n'est pas gardée dans l'adresse (écart de 11.4).
    expect(window.location.hash).toBe("#/telemetrie");
    expect(lus(fetcher).filter((cle) => cle.includes("/api/telemetry"))).toEqual(["GET /api/telemetry?window=24h", "GET /api/telemetry?window=7d"]);
  });

  it("« Télémétrie » est la page courante du fil d'Ariane ; revenir à l'accueil relit la liste", async () => {
    const fetcher = ouvrir("#/telemetrie");
    await tableau();
    const miettes = within(screen.getByRole("navigation", { name: "Fil d'Ariane" })).getAllByRole("listitem");
    expect(miettes.map((miette) => miette.getAttribute("aria-current"))).toEqual([null, "page"]);
    const avant = lus(fetcher).filter((cle) => cle === "GET /api/spaces").length;
    window.location.hash = "#/";
    expect(await screen.findByRole("heading", { level: 1, name: "Vos espaces" })).toBeInTheDocument();
    await screen.findByRole("link", { name: "Télémétrie" });
    expect(lus(fetcher).filter((cle) => cle === "GET /api/spaces").length).toBeGreaterThan(avant);
    expect(screen.queryByRole("table", { name: /Opérations/ })).not.toBeInTheDocument();
  });

  it("sans administration de la plateforme, ni lien à l'accueil, et l'adresse directe dit le refus du serveur", async () => {
    const table = { ...ADMIN, "GET /api/spaces": liste, "GET /api/telemetry?window=24h": interdit };
    ouvrir("#/", table);
    await screen.findByRole("list", { name: "Espaces" });
    expect(screen.queryByRole("link", { name: "Télémétrie" })).not.toBeInTheDocument();
    window.location.hash = "#/telemetrie";
    expect(await screen.findByText("La télémétrie est réservée à l'administration de la plateforme.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(filAriane()).toEqual(["Vos espaces", "Télémétrie"]);
  });

  it("en mode local : pas de lien, et l'adresse directe dit le mode local", async () => {
    const table = { "GET /api/me": local, "GET /api/spaces": locale, "GET /api/telemetry?window=24h": modeLocal };
    ouvrir("#/", table);
    await screen.findByRole("list", { name: "Espaces" });
    expect(screen.queryByRole("link", { name: "Télémétrie" })).not.toBeInTheDocument();
    window.location.hash = "#/telemetrie";
    expect(await screen.findByText(/^En mode local, sans fournisseur d'identité/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Fenêtre" })).not.toBeInTheDocument();
    // La bascule d'environnement de la coque, elle, reste.
    expect(within(screen.getByRole("banner")).getByRole("group", { name: "Environnement" })).toBeInTheDocument();
  });

  it("une session perdue pendant la lecture renvoie à la connexion, sans donnée affichée", async () => {
    ouvrir("#/telemetrie", { ...ADMIN, "GET /api/telemetry?window=24h": { status: 401, body: { error: { code: "unauthenticated" } } } });
    expect(await screen.findByText("Votre session a expiré. Reconnectez-vous pour continuer.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Télémétrie" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
