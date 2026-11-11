import { act, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import catalogue from "../../../contracts/catalogue/liste.json";
import espace from "../../../contracts/espaces/espace.json";
import introuvable from "../../../contracts/espaces/introuvable.json";
import liste from "../../../contracts/espaces/liste.json";
import administration from "../../../contracts/espaces/liste-administration.json";
import locale from "../../../contracts/espaces/liste-locale.json";

import local from "../../../contracts/identite/me-local.json";
import etabli from "../../../contracts/identite/me-etabli.json";
import anonyme from "../../../contracts/identite/non-authentifie.json";
import deconnexion from "../../../contracts/identite/deconnexion.json";
import origine from "../../../contracts/identite/origine-refusee.json";
import type { Fetch } from "./identity/api";
import { LOGIN_REASON_LABELS } from "./identity/model";

import { App } from "./App";
import * as identityHook from "./identity/useIdentity";
import { CATALOG } from "./analyses/testing";

type Exemple = { status: number; body: unknown };
type Reponse = Exemple | (() => Promise<Response>);
const reponse = (exemple: Exemple) => Response.json(exemple.body, { status: exemple.status });
/** Réponses simulées à partir des exemples du serveur réel ; toute autre adresse est un appel inattendu. */
const ROUTES: Readonly<Record<string, Exemple>> = {
  "/api/me": local,
  "/api/spaces": liste,
  "/api/spaces/finance": espace,
  "/api/spaces/finance/catalog": catalogue,
};
function routeur(table: Readonly<Record<string, Reponse>>) {
  return vi.fn<Fetch>().mockImplementation((url) => {
    const exemple = table[url];
    if (exemple === undefined) return Promise.reject(new Error(`appel inattendu : ${url}`));
    return typeof exemple === "function" ? exemple() : Promise.resolve(reponse(exemple));
  });
}
/** Adresses du catalogue lues hors espace : l'interface n'en produit plus aucune (plan 08, E9). */
function catalogueGlobal(fetcher: Mock<Fetch>): string[] {
  return fetcher.mock.calls.map(([url]) => url).filter((url) => url.startsWith("/api/catalog"));
}

describe("App", () => {
  it("affiche la coque et change d'environnement", async () => {
    // Le prototype graphique vit hors espace, sous #/prototype (plan 08, 8.3).
    window.history.replaceState(null, "", "/#/prototype");
    render(<App fetcher={routeur({ "/api/me": local })} />);
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
it("lie la marque à l'accueil et livre Catalogue Atlas dans l'espace, avec son fil d'Ariane", async () => {
  const fetcher = vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(reponse(ROUTES[url] ?? introuvable)));
  vi.stubGlobal("fetch", fetcher);
  render(<App />);
  const nav = await screen.findByRole("navigation", { name: "Navigation principale" });
  expect(within(nav).getByRole("link", { name: "Skifer Board" })).toHaveAttribute("href", "#/");
  // À l'accueil, hors espace, aucune section n'est offerte ; le catalogue et les membres se lisent « dans un espace ».
  expect(within(nav).queryAllByRole("button")).toHaveLength(0);
  expect(within(nav).getByText("Déploiements")).toHaveTextContent("à venir");
  expect(within(nav).getByText("Explorer")).toHaveTextContent("Explorerdans un espace");
  expect(within(nav).getByText("Analyses")).toHaveTextContent("Analysesdans un espace");
  expect(within(nav).getByText("Dashboards")).toHaveTextContent("Dashboardsdans un espace");
  expect(within(nav).getByText("Catalogue Atlas")).toHaveTextContent("Catalogue Atlasdans un espace");
  expect(within(nav).getByText("Espace & connexions")).toHaveTextContent("Espace & connexionsdans un espace");
  await userEvent.click(await screen.findByRole("link", { name: "Finance" }));
  await screen.findByRole("heading", { level: 1, name: "Catalogue Atlas" });
  await screen.findByRole("table");
  expect(window.location.hash).toBe("#/espaces/finance/catalogue");
  expect(fetcher).toHaveBeenCalledWith("/api/spaces/finance", expect.anything());
  expect(fetcher).toHaveBeenCalledWith("/api/spaces/finance/catalog", expect.anything());
  expect(screen.getByRole("navigation", { name: "Fil d'Ariane" })).toHaveTextContent("Catalogue Atlas");
  expect(within(screen.getByRole("navigation", { name: "Fil d'Ariane" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Finance", "Catalogue Atlas"]);
  // L'espace confirmé dit « Administrateur » : Catalogue Atlas et Espace & connexions sont livrés (plan 08, 8.4).
  expect(within(nav).getAllByRole("button").map((bouton) => bouton.textContent)).toEqual(["Explorer", "Analyses", "Dashboards", "Catalogue Atlas", "Espace & connexions"]);
  expect(within(nav).getByRole("button", { name: "Catalogue Atlas" })).toHaveAttribute("aria-current", "page");
  expect(within(nav).getByRole("button", { name: "Espace & connexions" })).not.toHaveAttribute("aria-current");
  expect(within(nav).getByText("Déploiements")).toHaveTextContent("à venir");
  expect(nav).toHaveTextContent("skifer-atlas");
  // Revenir au catalogue par la navigation garde l'espace.
  await userEvent.click(within(nav).getByRole("button", { name: "Catalogue Atlas" }));
  expect(window.location.hash).toBe("#/espaces/finance/catalogue");
  await userEvent.click(within(nav).getByRole("link", { name: "Skifer Board" }));
  await waitFor(() => { expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Vos espaces"); });
  expect(screen.getByRole("navigation", { name: "Fil d'Ariane" })).toHaveTextContent("Vos espaces");
  expect(nav).toHaveTextContent("Aucun espace choisi");
  expect(catalogueGlobal(fetcher)).toEqual([]);
});

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
  window.history.replaceState(null, "", "/#/prototype");
  render(<App fetcher={routeur({ "/api/me": local, "/api/spaces": locale })} leave={vi.fn()} />);
  expect(await screen.findByText(/Identité non établie/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Prototype graphique" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Se déconnecter" })).not.toBeInTheDocument();
});
it("établit l'identité puis déconnecte par POST avant de quitter vers /", async () => {
  const attente = differee();
  const fetcher = routeur({ "/api/me": etabli, "/api/spaces": liste, "/auth/logout": () => attente.promise });
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
  const fetcher = routeur({ "/api/me": etabli, "/api/spaces": liste, "/auth/logout": origine });
  const leave = vi.fn();
  render(<App fetcher={fetcher} leave={leave} />);
  await userEvent.click(await screen.findByRole("button", { name: "Se déconnecter" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("La déconnexion a été refusée (HTTP 403).");
  expect(leave).not.toHaveBeenCalled();
});
it.each(["/", "/#/catalogue", "/#/prototype", "/#/espaces/finance/catalogue"])("le 401 ferme toute donnée sur %s et respecte le lien reçu", async (url) => {
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
  const catalogue = routeur({ ...ROUTES, "/api/me": etabli, "/api/spaces/finance/catalog": anonyme });
  render(<App fetcher={catalogue} leave={vi.fn()} />);
  await userEvent.click(await screen.findByRole("link", { name: "Finance" }));
  expect(await screen.findByRole("heading", { name: "Connexion requise" })).toBeInTheDocument();
  expect(catalogue).toHaveBeenCalledWith("/api/spaces/finance/catalog", expect.anything());
  expect(screen.getByRole("status")).toHaveTextContent("Votre session a expiré");
  expect(screen.getByRole("link", { name: "Se connecter" })).toHaveAttribute("href", "/auth/login");
  aucuneDonnee();
});
it("la déconnexion utilise la navigation pleine page par défaut", async () => {
  // Une destination de même page permet d'observer assign dans jsdom sans réseau.
  const fetcher = routeur({ "/api/me": etabli, "/api/spaces": liste, "/auth/logout": { status: 200, body: { redirect: "/#deconnecte" } } });
  render(<App fetcher={fetcher} />);
  await userEvent.click(await screen.findByRole("button", { name: "Se déconnecter" }));
  await waitFor(() => { expect(window.location.hash).toBe("#deconnecte"); });
});

describe("Espaces dans la coque (plan 08, 8.3)", () => {
  const ouvrir = (hash: string, table: Readonly<Record<string, Reponse>>, rendre = true) => {
    window.history.replaceState(null, "", `/${hash}`);
    const fetcher = routeur(table);
    if (rendre) render(<App fetcher={fetcher} leave={vi.fn()} />);
    return fetcher;
  };
  const filAriane = () => within(screen.getByRole("navigation", { name: "Fil d'Ariane" })).getAllByRole("listitem").map((item) => item.textContent);
  const pastille = () => screen.queryByText(/^Rôle :/);
  const selecteur = () => screen.getByRole("combobox", { name: "Espace" });
  const naviguer = (hash: string) => {
    act(() => {
      window.history.replaceState(null, "", `/${hash}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
  };

  it("l'accueil liste les espaces, et le sélecteur n'affiche aucun rôle hors d'un espace", async () => {
    const fetcher = ouvrir("#/", { ...ROUTES, "/api/me": etabli });
    expect(await screen.findByRole("heading", { level: 1, name: "Vos espaces" })).toBeInTheDocument();
    await screen.findByRole("list", { name: "Espaces" });
    expect(filAriane()).toEqual(["Vos espaces"]);
    expect(selecteur()).toHaveValue("");
    expect(within(selecteur()).getAllByRole("option").map((option) => option.textContent)).toEqual(["Choisir un espace", "Finance", "Ressources humaines"]);
    expect(pastille()).not.toBeInTheDocument();
    expect(fetcher.mock.calls.map(([url]) => url).filter((url) => url !== "/api/spaces")).toEqual(["/api/me"]);
  });

  it("le sélecteur mène au catalogue de l'espace choisi, avec le rôle confirmé par le serveur", async () => {
    const fetcher = ouvrir("#/", { ...ROUTES, "/api/me": etabli, "/api/spaces/rh": { status: 200, body: { ...espace.body, id: "rh", name: "Ressources humaines", role: "reader" } }, "/api/spaces/rh/catalog": catalogue });
    await screen.findByRole("list", { name: "Espaces" });
    await userEvent.selectOptions(selecteur(), "Ressources humaines");
    await waitFor(() => { expect(window.location.hash).toBe("#/espaces/rh/catalogue"); });
    await screen.findByRole("table");
    expect(selecteur()).toHaveValue("rh");
    expect(pastille()).toHaveTextContent("Rôle : Lecteur");
    expect(filAriane()).toEqual(["Ressources humaines", "Catalogue Atlas"]);
    expect(fetcher).toHaveBeenCalledWith("/api/spaces/rh/catalog", expect.anything());
    expect(catalogueGlobal(fetcher)).toEqual([]);
  });

  it("la pastille vient de l'espace confirmé, pas de la liste", async () => {
    // La liste dit « Créateur » pour finance ; le serveur confirme « Administrateur ».
    ouvrir("#/espaces/finance/catalogue", { ...ROUTES, "/api/me": etabli });
    await screen.findByRole("table");
    expect(pastille()).toHaveTextContent("Rôle : Administrateur");
  });

  it("n'affiche aucun rôle tant que le serveur n'a pas confirmé l'espace", async () => {
    const attente = differee();
    ouvrir("#/espaces/finance/catalogue", { ...ROUTES, "/api/me": etabli, "/api/spaces/finance": () => attente.promise });
    expect(await screen.findByText("Lecture de l'espace…")).toHaveAttribute("aria-busy", "true");
    await screen.findByRole("option", { name: "Finance" });
    expect(pastille()).not.toBeInTheDocument();
    expect(selecteur()).toHaveValue("");
    expect(screen.queryByRole("heading", { name: "Catalogue Atlas" })).not.toBeInTheDocument();
    expect(filAriane()).toEqual(["Espace"]);
    await act(async () => { attente.resolve(reponse(espace)); await Promise.resolve(); });
    expect(await screen.findByText("Rôle : Administrateur")).toBeInTheDocument();
  });

  // Un identifiant hors du format E1 ne désigne aucun espace : rien n'est demandé au serveur.
  it.each([
    ".", "..", "%2e%2e", "a%2Fb%20c", "Finance", "FINANCE", "a", "-finance", "finance-", "fin_ance", "fin%C3%A9", "%", "%25",
    "a".repeat(41), "x%20y",
  ])("« Espace introuvable » sans aucune requête d'espace pour l'identifiant hors format %j", async (segment) => {
    const fetcher = ouvrir(`#/espaces/${segment}/catalogue`, { ...ROUTES, "/api/me": etabli });
    expect(await screen.findByRole("heading", { level: 1, name: "Espace introuvable" })).toBeInTheDocument();
    await screen.findByRole("option", { name: "Finance" });
    expect(fetcher.mock.calls.map(([url]) => url).filter((url) => url !== "/api/me" && url !== "/api/spaces")).toEqual([]);
    expect(screen.getByRole("main").textContent).toBe("Espace introuvableRetour à vos espaces");
  });

  it.each(["ab", "a".repeat(40), "f-1", "0-9"])("un identifiant au format E1 (%s) est demandé au serveur", async (id) => {
    const fetcher = ouvrir(`#/espaces/${id}/catalogue`, { ...ROUTES, [`/api/spaces/${id}`]: introuvable });
    expect(await screen.findByRole("heading", { level: 1, name: "Espace introuvable" })).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(`/api/spaces/${id}`, expect.anything());
  });

  it("un espace rendu sous un autre identifiant n'ouvre aucun catalogue", async () => {
    const fetcher = ouvrir("#/espaces/rh/catalogue", { ...ROUTES, "/api/spaces/rh": espace });
    expect(await screen.findByRole("heading", { level: 1, name: "Espace indisponible" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("espace.id : identifiant demandé attendu");
    expect(pastille()).not.toBeInTheDocument();
    expect(fetcher.mock.calls.map(([url]) => url).filter((url) => url.includes("catalog"))).toEqual([]);
  });

  it.each([
    ["inconnu", "/api/spaces/inexistant-secret", "#/espaces/inexistant-secret/catalogue", introuvable],
    ["non-membre", "/api/spaces/paie-direction", "#/espaces/paie-direction/catalogue", introuvable],
    ["404 sans corps", "/api/spaces/paie-direction", "#/espaces/paie-direction/catalogue", { status: 404, body: null }],
  ])("« Espace introuvable » pour un espace %s, sans rien dire de plus", async (_cas, adresse, hash, exemple) => {
    const fetcher = ouvrir(hash, { ...ROUTES, "/api/me": etabli, [adresse]: exemple });
    expect(await screen.findByRole("heading", { level: 1, name: "Espace introuvable" })).toBeInTheDocument();
    await screen.findByRole("option", { name: "Finance" });
    expect(screen.getByRole("link", { name: "Retour à vos espaces" })).toHaveAttribute("href", "#/");
    expect(filAriane()).toEqual(["Espace introuvable"]);
    expect(pastille()).not.toBeInTheDocument();
    expect(selecteur()).toHaveValue("");
    // L'identifiant demandé n'est repris nulle part dans la page.
    const identifiant = adresse.slice("/api/spaces/".length);
    expect(document.body).not.toHaveTextContent(identifiant);
    expect(document.body.innerHTML).not.toContain(identifiant);
    expect(screen.getByRole("main").textContent).toBe("Espace introuvableRetour à vos espaces");
    expect(fetcher.mock.calls.map(([url]) => url).filter((url) => url.includes("catalog"))).toEqual([]);
    expect(screen.getByRole("navigation", { name: "Navigation principale" })).toHaveTextContent("Aucun espace choisi");
  });

  it("un espace inconnu et un espace refusé donnent exactement la même page", async () => {
    const pages: string[] = [];
    for (const [hash, adresse] of [["#/espaces/inconnu/catalogue", "/api/spaces/inconnu"], ["#/espaces/refuse/catalogue", "/api/spaces/refuse"]] as const) {
      const { container, unmount } = render(<App fetcher={ouvrir(hash, { ...ROUTES, [adresse]: introuvable }, false)} leave={vi.fn()} />);
      await screen.findByRole("heading", { name: "Espace introuvable" });
      await screen.findByRole("option", { name: "Finance" });
      // Seuls diffèrent les identifiants techniques de React (useId).
      pages.push(container.innerHTML.replace(/_r_[a-z0-9]+_/g, "ID"));
      unmount();
    }
    expect(pages[0]).toBe(pages[1]);
  });

  it("l'administration de la plateforme sans rôle ne lit pas le catalogue de l'espace", async () => {
    const fetcher = ouvrir("#/espaces/finance/catalogue", { ...ROUTES, "/api/me": etabli, "/api/spaces": administration, "/api/spaces/finance": { status: 200, body: { ...espace.body, role: null } } });
    const bandeau = await screen.findByText(/Vous administrez la plateforme sans rôle dans cet espace/);
    // Il en gère les membres (E6) : le bandeau y mène (plan 08, 8.4).
    expect(within(bandeau).getByRole("link", { name: "Gérer les membres" })).toHaveAttribute("href", "#/espaces/finance/membres");
    expect(bandeau).toHaveTextContent("son catalogue ne vous est pas lisible");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Finance");
    // Le fil d'Ariane ne nomme pas un catalogue illisible.
    expect(filAriane()).toEqual(["Finance"]);
    expect(pastille()).toHaveTextContent("Rôle : Administration de la plateforme");
    expect(screen.queryByRole("heading", { name: "Catalogue Atlas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Navigation principale" });
    // Le catalogue est fermé « sans rôle » ; les membres, gérés par la plateforme, sont offerts.
    await waitFor(() => { expect(within(nav).getAllByRole("button").map((bouton) => bouton.textContent)).toEqual(["Espace & connexions"]); });
    expect(within(nav).getByText("Catalogue Atlas")).toHaveTextContent("Catalogue Atlassans rôle");
    // Laisser au catalogue le temps d'une lecture éventuelle : aucune ne doit partir.
    await act(async () => { await new Promise((fin) => setTimeout(fin, 20)); });
    expect(fetcher.mock.calls.map(([url]) => url).filter((url) => url.includes("catalog"))).toEqual([]);
  });

  it.each([
    ["HTTP 500", { status: 500, body: {} }, "Réponse inattendue du serveur (HTTP 500)."],
    ["HTTP 403", { status: 403, body: { error: { code: "forbidden", required: "reader" } } }, "Réponse inattendue du serveur (HTTP 403)."],
    ["hors contrat", { status: 200, body: { ...espace.body, role: "owner" } }, "Réponse du serveur hors contrat : espace.role"],
    ["serveur muet", () => Promise.reject(new TypeError("réseau")), "Le serveur Board ne répond pas."],
  ] as [string, Reponse, string][])("l'erreur d'espace (%s) n'affiche ni catalogue ni rôle", async (_cas, exemple, message) => {
    const fetcher = ouvrir("#/espaces/finance/catalogue", { ...ROUTES, "/api/me": etabli, "/api/spaces/finance": exemple });
    expect(await screen.findByRole("heading", { level: 1, name: "Espace indisponible" })).toBeInTheDocument();
    const alerte = screen.getByRole("alert");
    expect(alerte).toHaveTextContent(message);
    expect(alerte).toHaveTextContent("Aucune donnée n'est affichée.");
    expect(pastille()).not.toBeInTheDocument();
    expect(filAriane()).toEqual(["Espace"]);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(fetcher.mock.calls.map(([url]) => url).filter((url) => url.includes("catalog"))).toEqual([]);
  });

  it("la réponse du premier espace n'apparaît jamais pour le second", async () => {
    const finance = differee();
    const rh = differee();
    const fetcher = ouvrir("#/espaces/finance/catalogue", {
      ...ROUTES, "/api/me": etabli,
      "/api/spaces/finance": () => finance.promise,
      "/api/spaces/rh": () => rh.promise,
      "/api/spaces/rh/catalog": catalogue,
    });
    await screen.findByText("Lecture de l'espace…");
    naviguer("#/espaces/rh/catalogue");
    await waitFor(() => { expect(fetcher).toHaveBeenCalledWith("/api/spaces/rh", expect.anything()); });
    const signalFinance = fetcher.mock.calls.find(([url]) => url === "/api/spaces/finance")?.[1]?.signal;
    expect(signalFinance?.aborted).toBe(true);
    // Le serveur répond pour finance après coup, comme si l'abandon n'avait pas été entendu.
    await act(async () => { finance.resolve(reponse(espace)); await Promise.resolve(); });
    expect(screen.getByText("Lecture de l'espace…")).toBeInTheDocument();
    expect(pastille()).not.toBeInTheDocument();
    expect(screen.queryByText("Rôle : Administrateur")).not.toBeInTheDocument();
    expect(filAriane()).toEqual(["Espace"]);
    expect(selecteur()).toHaveValue("");
    expect(fetcher).not.toHaveBeenCalledWith("/api/spaces/finance/catalog", expect.anything());
    await act(async () => { rh.resolve(reponse({ status: 200, body: { ...espace.body, id: "rh", name: "Ressources humaines", role: "reader" } })); await Promise.resolve(); });
    expect(await screen.findByText("Rôle : Lecteur")).toBeInTheDocument();
    expect(filAriane()).toEqual(["Ressources humaines", "Catalogue Atlas"]);
    await screen.findByRole("table");
    expect(fetcher).not.toHaveBeenCalledWith("/api/spaces/finance/catalog", expect.anything());
  });

  it("changer d'espace retire aussitôt le rôle et le catalogue du précédent", async () => {
    const rh = differee();
    const fetcher = ouvrir("#/espaces/finance/catalogue", { ...ROUTES, "/api/me": etabli, "/api/spaces/rh": () => rh.promise });
    await screen.findByRole("table");
    expect(pastille()).toHaveTextContent("Rôle : Administrateur");
    await userEvent.selectOptions(selecteur(), "rh");
    await waitFor(() => { expect(screen.getByText("Lecture de l'espace…")).toBeInTheDocument(); });
    expect(pastille()).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Navigation principale" })).toHaveTextContent("Aucun espace choisi");
    expect(fetcher).not.toHaveBeenCalledWith("/api/spaces/rh/catalog", expect.anything());
  });

  it("la liste du catalogue d'un espace quitté n'apparaît pas dans le suivant", async () => {
    const listeFinance = differee();
    const fetcher = ouvrir("#/espaces/finance/catalogue", {
      ...ROUTES, "/api/me": etabli,
      "/api/spaces/finance/catalog": () => listeFinance.promise,
      "/api/spaces/rh": { status: 200, body: { ...espace.body, id: "rh", name: "Ressources humaines", role: "reader" } },
      "/api/spaces/rh/catalog": { status: 200, body: { ...catalogue.body, entries: [] } },
    });
    await screen.findByText("Chargement du catalogue…");
    naviguer("#/espaces/rh/catalogue");
    expect(await screen.findByText("0 définitions")).toBeInTheDocument();
    await act(async () => { listeFinance.resolve(reponse(catalogue)); await Promise.resolve(); });
    expect(screen.getByText("0 définitions")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(fetcher.mock.calls.find(([url]) => url === "/api/spaces/finance/catalog")?.[1]?.signal?.aborted).toBe(true);
  });

  it.each(["/api/spaces", "/api/spaces/finance"])("un 401 sur %s mène à l'écran de connexion sans donnée", async (adresse) => {
    ouvrir("#/espaces/finance/catalogue", { ...ROUTES, "/api/me": etabli, [adresse]: anonyme });
    expect(await screen.findByRole("heading", { name: "Connexion requise" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Votre session a expiré");
    expect(screen.getByRole("link", { name: "Se connecter" })).toHaveAttribute("href", "/auth/login");
    aucuneDonnee();
    expect(screen.queryByRole("combobox", { name: "Espace" })).not.toBeInTheDocument();
  });

  it("un 401 sur la liste de l'accueil mène aussi à la connexion", async () => {
    ouvrir("#/", { ...ROUTES, "/api/me": etabli, "/api/spaces": anonyme });
    expect(await screen.findByRole("heading", { name: "Connexion requise" })).toBeInTheDocument();
    aucuneDonnee();
  });

  it("le mode local ouvre l'espace implicite « local » et son catalogue", async () => {
    const espaceLocal = locale.body.spaces[0];
    const fetcher = ouvrir("#/", { "/api/me": local, "/api/spaces": locale, "/api/spaces/local": { status: 200, body: espaceLocal }, "/api/spaces/local/catalog": catalogue });
    expect(await screen.findByText(/Identité non établie/)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("link", { name: "Local" }));
    await screen.findByRole("table");
    expect(window.location.hash).toBe("#/espaces/local/catalogue");
    expect(pastille()).toHaveTextContent("Rôle : Administrateur");
    expect(selecteur()).toHaveValue("local");
    expect(fetcher).toHaveBeenCalledWith("/api/spaces/local/catalog", expect.anything());
    expect(screen.queryByRole("button", { name: "Se déconnecter" })).not.toBeInTheDocument();
  });

  it("une liste d'espaces illisible n'empêche pas d'ouvrir l'espace demandé", async () => {
    ouvrir("#/espaces/finance/catalogue", { ...ROUTES, "/api/spaces": { status: 500, body: {} } });
    await screen.findByRole("table");
    expect(within(selecteur()).getAllByRole("option").map((option) => option.textContent)).toEqual(["Espaces indisponibles", "Finance"]);
    expect(pastille()).toHaveTextContent("Rôle : Administrateur");
  });

  it("une ancre inconnue ou l'ancien #/catalogue mène à l'accueil, sans lecture du catalogue", async () => {
    for (const hash of ["#/catalogue", "#/espaces/", "#/nimporte"]) {
      const fetcher = ouvrir(hash, ROUTES, false);
      const { unmount } = render(<App fetcher={fetcher} leave={vi.fn()} />);
      expect(await screen.findByRole("heading", { level: 1, name: "Vos espaces" })).toBeInTheDocument();
      await screen.findByRole("list", { name: "Espaces" });
      expect(fetcher.mock.calls.map(([url]) => url).filter((url) => url.includes("catalog"))).toEqual([]);
      unmount();
    }
  });

  it("le prototype reste accessible hors espace, sans lecture d'espace ni rôle", async () => {
    const fetcher = ouvrir("#/prototype", ROUTES);
    expect(await screen.findByRole("heading", { level: 1, name: "Prototype graphique" })).toBeInTheDocument();
    expect(filAriane()).toEqual(["Prototype graphique"]);
    expect(pastille()).not.toBeInTheDocument();
    expect(fetcher.mock.calls.map(([url]) => url).filter((url) => url.startsWith("/api/spaces/"))).toEqual([]);
  });

  it("revenir à l'accueil depuis un espace retire le rôle du sélecteur", async () => {
    ouvrir("#/espaces/finance/catalogue", ROUTES);
    await screen.findByRole("table");
    naviguer("#/");
    expect(await screen.findByRole("heading", { level: 1, name: "Vos espaces" })).toBeInTheDocument();
    expect(pastille()).not.toBeInTheDocument();
    expect(selecteur()).toHaveValue("");
  });

  it("un espace retiré pendant la lecture du catalogue s'affiche « Espace introuvable », liste relue", async () => {
    // Le serveur confirme l'espace, puis la liaison est retirée (E4) : le catalogue et l'espace répondent 404.
    let retire = false;
    const fetcher = ouvrir("#/espaces/finance/catalogue", {
      ...ROUTES, "/api/me": etabli,
      "/api/spaces/finance": () => Promise.resolve(reponse(retire ? introuvable : espace)),
      "/api/spaces": () => Promise.resolve(reponse(retire ? { status: 200, body: { ...liste.body, spaces: liste.body.spaces.slice(1) } } : liste)),
      "/api/spaces/finance/catalog": () => { retire = true; return Promise.resolve(reponse(introuvable)); },
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Espace introuvable" })).toBeInTheDocument();
    expect(screen.queryByText(/service du catalogue est introuvable/)).not.toBeInTheDocument();
    expect(pastille()).not.toBeInTheDocument();
    // La liste relue ne propose plus l'espace retiré.
    await waitFor(() => { expect(within(selecteur()).getAllByRole("option").map((option) => option.textContent)).toEqual(["Choisir un espace", "Ressources humaines"]); });
    const lus = fetcher.mock.calls.map(([url]) => url);
    expect(lus.filter((url) => url === "/api/spaces/finance")).toHaveLength(2);
    expect(lus.filter((url) => url === "/api/spaces").length).toBeGreaterThanOrEqual(2);
    expect(lus.filter((url) => url === "/api/spaces/finance/catalog")).toHaveLength(1);
  });

  const lectures = (fetcher: Mock<Fetch>, url: string) => fetcher.mock.calls.filter(([lu]) => lu === url).length;

  it("relit la liste des espaces à chaque navigation, une seule fois par page", async () => {
    const fetcher = ouvrir("#/", { ...ROUTES, "/api/me": etabli });
    await screen.findByRole("list", { name: "Espaces" });
    // L'accueil reçoit la liste de la coque : une seule lecture pour le sélecteur et la page.
    expect(lectures(fetcher, "/api/spaces")).toBe(1);
    naviguer("#/espaces/finance/catalogue");
    await screen.findByRole("table");
    expect(lectures(fetcher, "/api/spaces")).toBe(2);
    naviguer("#/prototype");
    expect(await screen.findByRole("heading", { level: 1, name: "Prototype graphique" })).toBeInTheDocument();
    await waitFor(() => { expect(lectures(fetcher, "/api/spaces")).toBe(3); });
    naviguer("#/");
    await screen.findByRole("list", { name: "Espaces" });
    await waitFor(() => { expect(lectures(fetcher, "/api/spaces")).toBe(4); });
  });

  it("une liaison ajoutée ailleurs apparaît dans le sélecteur à la navigation suivante", async () => {
    let ajoute = false;
    ouvrir("#/", {
      ...ROUTES, "/api/me": etabli,
      "/api/spaces": () => Promise.resolve(reponse(ajoute ? liste : { status: 200, body: { ...liste.body, spaces: liste.body.spaces.slice(0, 1) } })),
      "/api/spaces/finance": espace,
    });
    await screen.findByRole("list", { name: "Espaces" });
    expect(within(selecteur()).getAllByRole("option").map((option) => option.textContent)).toEqual(["Choisir un espace", "Finance"]);
    ajoute = true;
    naviguer("#/espaces/finance/catalogue");
    await waitFor(() => { expect(within(selecteur()).getAllByRole("option").map((option) => option.textContent)).toEqual(["Choisir un espace", "Finance", "Ressources humaines"]); });
  });

  it("le sélecteur dit « Lecture des espaces… » tant que la liste n'est pas lue, puis la propose", async () => {
    const attente = differee();
    ouvrir("#/", { ...ROUTES, "/api/me": etabli, "/api/spaces": () => attente.promise });
    await waitFor(() => { expect(within(selecteur()).getAllByRole("option").map((option) => option.textContent)).toEqual(["Lecture des espaces…"]); });
    expect(screen.queryByText("Espaces indisponibles")).not.toBeInTheDocument();
    expect(pastille()).not.toBeInTheDocument();
    await act(async () => { attente.resolve(reponse(liste)); await Promise.resolve(); });
    await waitFor(() => { expect(within(selecteur()).getAllByRole("option").map((option) => option.textContent)).toEqual(["Choisir un espace", "Finance", "Ressources humaines"]); });
  });

  it("une liste illisible se dit « Espaces indisponibles » dans le sélecteur, distincte de la lecture", async () => {
    ouvrir("#/espaces/finance/catalogue", { ...ROUTES, "/api/me": etabli, "/api/spaces": { status: 500, body: {} } });
    await screen.findByRole("table");
    await waitFor(() => { expect(within(selecteur()).getAllByRole("option").map((option) => option.textContent)).toEqual(["Espaces indisponibles", "Finance"]); });
    expect(selecteur()).toHaveValue("finance");
  });

  it("dans un espace lisible, Catalogue Atlas est livré ; hors d'un espace confirmé il se lit « dans un espace »", async () => {
    ouvrir("#/espaces/finance/catalogue", { ...ROUTES, "/api/me": etabli });
    await screen.findByRole("table");
    const nav = screen.getByRole("navigation", { name: "Navigation principale" });
    expect(within(nav).getByRole("button", { name: "Catalogue Atlas" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).queryByText("dans un espace")).not.toBeInTheDocument();
    expect(within(nav).getByText("Déploiements")).toHaveTextContent("à venir");
    expect(within(nav).getByRole("button", { name: "Analyses" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Dashboards" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Espace & connexions" })).toBeInTheDocument();
    for (const hash of ["#/prototype", "#/espaces/inconnu", "#/"]) {
      naviguer(hash);
      await waitFor(() => { expect(within(nav).queryByRole("button", { name: "Catalogue Atlas" })).not.toBeInTheDocument(); });
      expect(within(nav).getByText("Catalogue Atlas")).toHaveTextContent("Catalogue Atlasdans un espace");
    }
  });

  it("pendant la lecture de l'espace, Catalogue Atlas n'est pas encore livré", async () => {
    const attente = differee();
    ouvrir("#/espaces/finance/catalogue", { ...ROUTES, "/api/me": etabli, "/api/spaces/finance": () => attente.promise });
    const nav = await screen.findByRole("navigation", { name: "Navigation principale" });
    await waitFor(() => { expect(within(nav).getByText("Catalogue Atlas")).toHaveTextContent("dans un espace"); });
    expect(within(nav).queryByRole("button", { name: "Catalogue Atlas" })).not.toBeInTheDocument();
    await act(async () => { attente.resolve(reponse(espace)); await Promise.resolve(); });
    expect(await within(nav).findByRole("button", { name: "Catalogue Atlas" })).toBeInTheDocument();
  });

  it("un espace perdu relit aussi la liste, même sans changer de page", async () => {
    let retire = false;
    const fetcher = ouvrir("#/espaces/finance/catalogue", {
      ...ROUTES, "/api/me": etabli,
      "/api/spaces/finance": () => Promise.resolve(reponse(retire ? introuvable : espace)),
      "/api/spaces/finance/catalog": () => { retire = true; return Promise.resolve(reponse(introuvable)); },
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Espace introuvable" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#/espaces/finance/catalogue");
    await waitFor(() => { expect(lectures(fetcher, "/api/spaces")).toBe(2); });
  });

  // Plan 08, E4 : un espace reconfirmé alors que le catalogue répond space_not_found n'est relu qu'une
  // fois ; le catalogue reste en échec affiché, sans nouvelle lecture automatique.
  it("un catalogue en 404 space_not_found sur un espace confirmé ne boucle pas sans fin", async () => {
    const fetcher = ouvrir("#/espaces/finance/catalogue", {
      ...ROUTES, "/api/me": etabli,
      "/api/spaces/finance/catalog": introuvable,
    });
    await new Promise((fin) => setTimeout(fin, 500));
    const catalogue = lectures(fetcher, "/api/spaces/finance/catalog");
    const espaceLu = lectures(fetcher, "/api/spaces/finance");
    expect(catalogue).toBeLessThanOrEqual(2);
    expect(espaceLu).toBeLessThanOrEqual(2);
  });
});


it("un changement d'identité efface la coque et l'Explorateur puis relit leurs données", async () => {
  window.history.replaceState(null, "", "/#/espaces/finance/explorer");
  const person = { issuer: "https://id.example.invalid", subject: "cora", name: "Cora", email: null, groups: [] };
  const state = (subject: string) => ({ state: { status: "established" as const, identity: { ...person, subject }, expiresAt: new Date() }, retry: vi.fn() });
  const identity = vi.spyOn(identityHook, "useIdentity").mockReturnValue(state("cora"));
  const listeSuivante = differee();
  const espaceSuivant = differee();
  let lists = 0;
  let spaces = 0;
  const fetcher = vi.fn<Fetch>().mockImplementation((url) => {
    if (url === "/api/spaces") return ++lists === 1 ? Promise.resolve(reponse(liste)) : listeSuivante.promise;
    if (url === "/api/spaces/finance") return ++spaces === 1 ? Promise.resolve(reponse(espace)) : espaceSuivant.promise;
    if (url.endsWith("/explorer/fields")) return Promise.resolve(Response.json({ models: CATALOG.models }));
    if (url.endsWith("/explorer/connections")) return Promise.resolve(Response.json({ connections: ["finance"] }));
    return Promise.reject(new Error(url));
  });
  const view = render(<App fetcher={fetcher} />);
  await screen.findByRole("heading", { name: "Explorer", level: 1 });
  await waitFor(() => { expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/explorer/fields"))).toHaveLength(1); });
  identity.mockReturnValue(state("bob"));
  view.rerender(<App fetcher={fetcher} />);
  expect(screen.queryByRole("heading", { name: "Explorer", level: 1 })).not.toBeInTheDocument();
  expect(screen.queryByText("Finance", { selector: "option" })).not.toBeInTheDocument();
  await waitFor(() => { expect(lists).toBe(2); expect(spaces).toBe(2); });
  act(() => { listeSuivante.resolve(reponse(liste)); espaceSuivant.resolve(reponse(espace)); });
  await screen.findByRole("heading", { name: "Explorer", level: 1 });
  await waitFor(() => { expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/explorer/fields"))).toHaveLength(2); });
  identity.mockRestore();
});
