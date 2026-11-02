import { act, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import liste from "../../../contracts/catalogue/liste.json";

import local from "../../../contracts/identite/me-local.json";
import etabli from "../../../contracts/identite/me-etabli.json";
import anonyme from "../../../contracts/identite/non-authentifie.json";
import deconnexion from "../../../contracts/identite/deconnexion.json";
import origine from "../../../contracts/identite/origine-refusee.json";
import type { Fetch } from "./identity/api";
import { LOGIN_REASON_LABELS } from "./identity/model";

import { App } from "./App";

describe("App", () => {
  it("affiche la coque et change d'environnement", async () => {
    render(<App fetcher={vi.fn<Fetch>().mockResolvedValue(Response.json(local.body))} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Prototype graphique" })).toBeInTheDocument();
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
  const fetcher = vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(Response.json(url === "/api/me" ? local.body : liste.body)));
  vi.stubGlobal("fetch", fetcher);
  render(<App />);
  const nav = await screen.findByRole("navigation", { name: "Navigation principale" });
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

const reponse = (exemple: { body: unknown; status: number }) => Response.json(exemple.body, { status: exemple.status });
function differee() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((ok) => { resolve = ok; });
  return { promise, resolve };
}
function aucuneDonnee() {
  expect(screen.queryByRole("navigation", { name: "Navigation principale" })).not.toBeInTheDocument();
  expect(screen.queryByText("Catalogue Atlas")).not.toBeInTheDocument();
  expect(screen.queryByText("Prototype graphique")).not.toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
}
it("annonce la lecture de l'identité sans afficher de données", () => {
  const fetcher = vi.fn<Fetch>().mockReturnValue(differee().promise);
  render(<App fetcher={fetcher} leave={vi.fn()} />);
  expect(screen.getByRole("status")).toHaveTextContent("Lecture de l'identité…");
  expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
  aucuneDonnee();
});
it("le mode local ouvre la coque sans déconnexion", async () => {
  render(<App fetcher={vi.fn<Fetch>().mockResolvedValue(reponse(local))} leave={vi.fn()} />);
  expect(await screen.findByText(/Identité non établie/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Prototype graphique" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Se déconnecter" })).not.toBeInTheDocument();
});
it("établit l'identité puis déconnecte par POST avant de quitter vers /", async () => {
  const attente = differee();
  const fetcher = vi.fn<Fetch>().mockResolvedValueOnce(reponse(etabli)).mockReturnValueOnce(attente.promise);
  const leave = vi.fn();
  render(<App fetcher={fetcher} leave={leave} />);
  expect(await screen.findByText(`Données évaluées pour ${etabli.body.identity.name}`, { exact: true })).toBeInTheDocument();
  expect(screen.queryByText(/Entité/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Se déconnecter" }));
  expect(fetcher).toHaveBeenLastCalledWith("/auth/logout", { method: "POST", headers: { Accept: "application/json" } });
  expect(leave).not.toHaveBeenCalled();
  await act(async () => { attente.resolve(reponse(deconnexion)); await Promise.resolve(); });
  expect(leave).toHaveBeenCalledExactlyOnceWith("/");
});
it("annonce l'échec de déconnexion et ne quitte pas la page", async () => {
  const fetcher = vi.fn<Fetch>().mockResolvedValueOnce(reponse(etabli)).mockResolvedValueOnce(reponse(origine));
  const leave = vi.fn();
  render(<App fetcher={fetcher} leave={leave} />);
  await userEvent.click(await screen.findByRole("button", { name: "Se déconnecter" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("La déconnexion a été refusée (HTTP 403).");
  expect(leave).not.toHaveBeenCalled();
});
it.each(["/", "/#/catalogue"])("le 401 ferme toute donnée sur %s et respecte le lien reçu", async (url) => {
  window.history.replaceState(null, "", url);
  const donnees = vi.fn<Fetch>().mockResolvedValue(reponse(anonyme));
  vi.stubGlobal("fetch", donnees);
  const loginUrl = "/auth/login?retour=board";
  const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json({ error: { ...anonyme.body.error, login_url: loginUrl } }, { status: anonyme.status }));
  render(<App fetcher={fetcher} leave={vi.fn()} />);
  expect(await screen.findByRole("heading", { level: 1, name: "Connexion requise" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Se connecter" })).toHaveAttribute("href", loginUrl);
  aucuneDonnee();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(donnees).not.toHaveBeenCalled();
});
it("affiche le refus fermé revenu du fournisseur", async () => {
  window.history.replaceState(null, "", "/?login_error=token_refused");
  render(<App fetcher={vi.fn<Fetch>().mockResolvedValue(reponse(anonyme))} leave={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(LOGIN_REASON_LABELS.token_refused);
  aucuneDonnee();
});
it("l'erreur d'identité reste fermée et Réessayer relance la lecture", async () => {
  const attente = differee();
  const fetcher = vi.fn<Fetch>().mockRejectedValueOnce(new Error("hors ligne")).mockReturnValueOnce(attente.promise);
  render(<App fetcher={fetcher} leave={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Identité indisponible");
  aucuneDonnee();
  await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
  expect(screen.getByRole("status")).toHaveTextContent("Lecture de l'identité…");
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => { attente.resolve(reponse(local)); await Promise.resolve(); });
  expect(screen.getByText(/Identité non établie/)).toBeInTheDocument();
});
it("un catalogue en 401 retire la coque et annonce la session expirée", async () => {
  const catalogue = vi.fn<Fetch>().mockResolvedValue(reponse(anonyme));
  vi.stubGlobal("fetch", catalogue);
  render(<App fetcher={vi.fn<Fetch>().mockResolvedValue(reponse(etabli))} leave={vi.fn()} />);
  await userEvent.click(await screen.findByRole("button", { name: "Catalogue Atlas" }));
  expect(await screen.findByRole("heading", { name: "Connexion requise" })).toBeInTheDocument();
  expect(catalogue).toHaveBeenCalledWith("/api/catalog", expect.anything());
  expect(screen.getByRole("status")).toHaveTextContent("Votre session a expiré");
  expect(screen.getByRole("link", { name: "Se connecter" })).toHaveAttribute("href", "/auth/login");
  aucuneDonnee();
});
it("la déconnexion utilise la navigation pleine page par défaut", async () => {
  // Une destination de même page permet d'observer assign dans jsdom sans réseau.
  const fetcher = vi.fn<Fetch>().mockResolvedValueOnce(reponse(etabli)).mockResolvedValueOnce(Response.json({ redirect: "/#deconnecte" }));
  render(<App fetcher={fetcher} />);
  await userEvent.click(await screen.findByRole("button", { name: "Se déconnecter" }));
  await waitFor(() => { expect(window.location.hash).toBe("#deconnecte"); });
});
