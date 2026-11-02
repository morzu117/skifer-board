import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import liste from "../../../../contracts/espaces/liste.json";
import administration from "../../../../contracts/espaces/liste-administration.json";
import locale from "../../../../contracts/espaces/liste-locale.json";
import { useOutcome } from "../ui/useOutcome";
import { fetchSpaces, type Fetch } from "./api";
import { decodeSpaceList } from "./model";
import { SpacesHome } from "./SpacesHome";

/** La coque lit la liste et la passe à l'accueil (plan 08, 8.3) : ce banc fait de même. */
function Accueil({ fetcher }: { fetcher: Fetch }) {
  const listed = useOutcome("spaces", (signal) => fetchSpaces(signal, fetcher));
  return <SpacesHome listed={listed} />;
}

const reponse = (exemple: { status: number; body: unknown }) => Response.json(exemple.body, { status: exemple.status });
function differee() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((ok) => { resolve = ok; });
  return { promise, resolve };
}
const servir = (exemple: { status: number; body: unknown }) => vi.fn<Fetch>().mockResolvedValue(reponse(exemple));
const items = () => within(screen.getByRole("list", { name: "Espaces" })).getAllByRole("listitem");

describe("Accueil des espaces (écrans §1.1, plan 08, 8.3)", () => {
  it("annonce la lecture, sans liste ni bouton de création, puis lit /api/spaces", async () => {
    const attente = differee();
    const fetcher = vi.fn<Fetch>().mockReturnValue(attente.promise);
    render(<Accueil fetcher={fetcher} />);
    expect(screen.getByRole("heading", { level: 1, name: "Vos espaces" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Lecture des espaces…");
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("list", { name: "Espaces" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Créer un espace/ })).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/spaces", expect.objectContaining({ signal: expect.any(AbortSignal) as AbortSignal }));
    await act(async () => { attente.resolve(reponse(liste)); await Promise.resolve(); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(items()).toHaveLength(2);
  });

  it("liste chaque espace avec son rôle, son rattachement Atlas, son identifiant et le lien vers son catalogue", async () => {
    render(<Accueil fetcher={servir(liste)} />);
    await screen.findByRole("list", { name: "Espaces" });
    const [finance, rh] = items();
    expect(within(finance as HTMLElement).getByRole("link", { name: "Finance" })).toHaveAttribute("href", "#/espaces/finance/catalogue");
    expect(finance).toHaveTextContent("Créateur");
    expect(finance).toHaveTextContent("Atlas : skifer-atlas · finance");
    expect(within(rh as HTMLElement).getByRole("link", { name: "Ressources humaines" })).toHaveAttribute("href", "#/espaces/rh/catalogue");
    expect(rh).toHaveTextContent("Lecteur");
    expect(rh).not.toHaveTextContent("Créateur");
    expect(screen.queryByRole("link", { name: /Créer un espace/ })).not.toBeInTheDocument();
    expect(screen.getByText(/ne donne aucun droit sur les données/)).toBeInTheDocument();
  });

  it("encode l'identifiant dans le lien d'un espace", async () => {
    const corps = structuredClone(liste.body);
    (corps.spaces[0] as { id: string }).id = "a/b c";
    render(<Accueil fetcher={vi.fn<Fetch>().mockResolvedValue(Response.json(corps))} />);
    expect(await screen.findByRole("link", { name: "Finance" })).toHaveAttribute("href", "#/espaces/a%2Fb%20c/catalogue");
  });

  it("n'offre la création qu'à l'administration de la plateforme, et dit son absence de rôle", async () => {
    render(<Accueil fetcher={servir(administration)} />);
    const lien = await screen.findByRole("link", { name: "Créer un espace" });
    // La création est livrée (8.4) : un lien vers sa page, plus de bouton inactif « à venir ».
    expect(lien).toHaveAttribute("href", "#/nouvel-espace");
    expect(screen.queryByRole("button", { name: /Créer un espace/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/à venir/)).not.toBeInTheDocument();
    const [finance] = items();
    expect(finance).toHaveTextContent("Administration de la plateforme");
    expect(finance).not.toHaveTextContent(/Lecteur|Créateur|Administrateur(?! de)/);
  });

  it("montre l'espace local du mode sans OIDC (E11)", async () => {
    render(<Accueil fetcher={servir(locale)} />);
    await screen.findByRole("list", { name: "Espaces" });
    expect(screen.getByRole("link", { name: "Local" })).toHaveAttribute("href", "#/espaces/local/catalogue");
    expect(items()[0]).toHaveTextContent("Administrateur");
    expect(screen.queryByRole("link", { name: /Créer un espace/ })).not.toBeInTheDocument();
  });

  it("distingue la liste vide d'une erreur", async () => {
    render(<Accueil fetcher={vi.fn<Fetch>().mockResolvedValue(Response.json({ spaces: [], platform_admin: false }))} />);
    const vide = await screen.findByRole("region", { name: "Aucun espace" });
    expect(vide).toHaveTextContent("Vous n'êtes membre d'aucun espace.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Espaces" })).not.toBeInTheDocument();
  });

  it("une liste vide pour l'administration de la plateforme garde le bouton de création", async () => {
    render(<Accueil fetcher={vi.fn<Fetch>().mockResolvedValue(Response.json({ spaces: [], platform_admin: true }))} />);
    expect(await screen.findByRole("region", { name: "Aucun espace" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Créer un espace" })).toHaveAttribute("href", "#/nouvel-espace");
  });

  it.each([
    ["serveur muet", () => vi.fn<Fetch>().mockRejectedValue(new TypeError("réseau")), "Le serveur Board ne répond pas."],
    ["HTTP 500", () => vi.fn<Fetch>().mockResolvedValue(Response.json({}, { status: 500 })), "Réponse inattendue du serveur (HTTP 500)."],
    ["corps hors contrat", () => vi.fn<Fetch>().mockResolvedValue(Response.json({ spaces: [{ id: "x" }], platform_admin: true })), "hors contrat"],
    ["404", () => vi.fn<Fetch>().mockResolvedValue(Response.json({}, { status: 404 })), "réponse inattendue du serveur."],
  ])("annonce l'erreur (%s) sans liste ni bouton de création", async (_cas, fabrique, message) => {
    render(<Accueil fetcher={fabrique()} />);
    const alerte = await screen.findByRole("alert");
    expect(alerte).toHaveTextContent("Espaces indisponibles");
    expect(alerte).toHaveTextContent(message);
    expect(alerte).toHaveTextContent("Aucune donnée n'est affichée.");
    expect(screen.queryByRole("list", { name: "Espaces" })).not.toBeInTheDocument();
    // Un corps hors contrat qui dit `platform_admin: true` ne fait pas apparaître la création.
    expect(screen.queryByRole("link", { name: /Créer un espace/ })).not.toBeInTheDocument();
  });

  it.each(["chargement", "liste", "erreur"])("garde le lien vers le prototype hors espace : %s", async (etat) => {
    const fetcher = etat === "chargement" ? vi.fn<Fetch>().mockReturnValue(differee().promise)
      : etat === "liste" ? servir(liste) : vi.fn<Fetch>().mockRejectedValue(new TypeError("réseau"));
    render(<Accueil fetcher={fetcher} />);
    if (etat === "liste") await screen.findByRole("list", { name: "Espaces" });
    if (etat === "erreur") await screen.findByRole("alert");
    expect(screen.getByRole("link", { name: "Prototype graphique" })).toHaveAttribute("href", "#/prototype");
  });
});

describe("Accueil des espaces : lien « Membres et rôles » (plan 08, 8.4)", () => {
  const espace = (id: string, role: "reader" | "creator" | "admin" | null, implicit = false) => ({
    id, name: `Espace ${id}`, atlas: "skifer-atlas", created_at: "2026-11-02T09:00:00+00:00",
    created_by: { issuer: "https://id.example.invalid", subject: "s" }, role, implicit,
  });
  const lienMembres = (nom: string) => screen.queryByRole("link", { name: `Membres et rôles de ${nom}` });

  it("n'offre les membres qu'aux espaces que la personne administre", async () => {
    const corps = { spaces: [espace("a", "admin"), espace("c", "creator"), espace("l", "reader")], platform_admin: false };
    render(<Accueil fetcher={vi.fn<Fetch>().mockResolvedValue(Response.json(corps))} />);
    await screen.findByRole("list", { name: "Espaces" });
    expect(lienMembres("Espace a")).toHaveAttribute("href", "#/espaces/a/membres");
    expect(lienMembres("Espace a")).toHaveTextContent("Membres et rôles");
    expect(lienMembres("Espace c")).not.toBeInTheDocument();
    expect(lienMembres("Espace l")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /^Membres et rôles/ })).toHaveLength(1);
  });

  it("l'administration de la plateforme gère tous les espaces, même sans rôle (E6)", async () => {
    render(<Accueil fetcher={servir(administration)} />);
    await screen.findByRole("list", { name: "Espaces" });
    expect(lienMembres("Finance")).toHaveAttribute("href", "#/espaces/finance/membres");
    // Le lien principal de l'espace reste celui de son catalogue.
    expect(screen.getByRole("link", { name: "Finance" })).toHaveAttribute("href", "#/espaces/finance/catalogue");
  });

  it("aucun lien de membres pour l'espace implicite du mode local, même administrateur (E11)", async () => {
    render(<Accueil fetcher={servir(locale)} />);
    await screen.findByRole("list", { name: "Espaces" });
    expect(screen.queryByRole("link", { name: /Membres et rôles/ })).not.toBeInTheDocument();
  });

  it("aucun lien de membres pour un simple membre (liste du contrat)", async () => {
    render(<Accueil fetcher={servir(liste)} />);
    await screen.findByRole("list", { name: "Espaces" });
    expect(screen.queryByRole("link", { name: /Membres et rôles/ })).not.toBeInTheDocument();
  });

  it("encode l'identifiant dans le lien des membres", async () => {
    const corps = { spaces: [{ ...espace("x", "admin"), id: "a/b c" }], platform_admin: false };
    render(<Accueil fetcher={vi.fn<Fetch>().mockResolvedValue(Response.json(corps))} />);
    expect(await screen.findByRole("link", { name: "Membres et rôles de Espace x" })).toHaveAttribute("href", "#/espaces/a%2Fb%20c/membres");
  });
});

describe("Accueil des espaces : liste reçue de la coque", () => {
  it("ne lit rien lui-même : il affiche ce que la coque lui passe", () => {
    const espion = vi.fn<Fetch>();
    vi.stubGlobal("fetch", espion);
    try {
      const { rerender } = render(<SpacesHome listed={{ status: "loading" }} />);
      expect(screen.getByRole("status")).toHaveTextContent("Lecture des espaces…");
      rerender(<SpacesHome listed={{ status: "ok", value: decodeSpaceList(liste.body) }} />);
      expect(items()).toHaveLength(2);
      rerender(<SpacesHome listed={{ status: "error", message: "Le serveur Board ne répond pas." }} />);
      expect(screen.getByRole("alert")).toHaveTextContent("Espaces indisponibles : Le serveur Board ne répond pas.");
      expect(screen.queryByRole("list", { name: "Espaces" })).not.toBeInTheDocument();
      rerender(<SpacesHome listed={{ status: "not_found" }} />);
      expect(screen.getByRole("alert")).toHaveTextContent("réponse inattendue du serveur.");
      expect(espion).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
