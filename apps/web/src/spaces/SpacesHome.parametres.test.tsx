import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import liste from "../../../../contracts/espaces/liste.json";
import administration from "../../../../contracts/espaces/liste-administration.json";
import locale from "../../../../contracts/espaces/liste-locale.json";
import { useOutcome } from "../ui/useOutcome";
import { fetchSpaces, type Fetch } from "./api";
import { SpacesHome } from "./SpacesHome";

// Lien « Paramètres » de l'accueil des espaces (plan 10, 10.3) : offert à qui gère l'espace, comme
// « Membres et rôles » et « Environnements ».

function Accueil({ fetcher }: { fetcher: Fetch }) {
  const listed = useOutcome("spaces", (signal) => fetchSpaces(signal, fetcher));
  return <SpacesHome listed={listed} />;
}
const espace = (id: string, role: "reader" | "creator" | "admin" | null, implicit = false) => ({
  id, name: `Espace ${id}`, atlas: "skifer-atlas", created_at: "2026-11-02T09:00:00+00:00",
  created_by: { issuer: "https://id.example.invalid", subject: "s" }, role, implicit,
  environments: [{ code: "DEV", deploy: true }, { code: "TEST", deploy: true }, { code: "PROD", deploy: true }],
});
const ouvrirListe = async (corps: unknown) => {
  render(<Accueil fetcher={vi.fn<Fetch>().mockResolvedValue(Response.json(corps))} />);
  await screen.findByRole("list", { name: "Espaces" });
};
const lien = (nom: string) => screen.queryByRole("link", { name: `Paramètres de ${nom}` });

describe("Accueil des espaces : lien « Paramètres » (plan 10, 10.3)", () => {
  it("n'offre les paramètres qu'aux espaces que la personne administre, même si elle peut déployer ailleurs", async () => {
    await ouvrirListe({ spaces: [espace("a", "admin"), espace("c", "creator"), espace("l", "reader")], platform_admin: false });
    expect(lien("Espace a")).toHaveAttribute("href", "#/espaces/a/parametres");
    expect(lien("Espace a")).toHaveTextContent(/^Paramètres$/);
    expect(lien("Espace c")).not.toBeInTheDocument();
    expect(lien("Espace l")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /^Paramètres de/ })).toHaveLength(1);
  });

  it("vient en dernier, après « Environnements », dans l'ordre des onglets", async () => {
    await ouvrirListe({ spaces: [espace("a", "admin")], platform_admin: false });
    const entree = within(screen.getByRole("list", { name: "Espaces" })).getAllByRole("listitem")[0] as HTMLElement;
    const liens = within(entree).getAllByRole("link");
    expect(liens.at(-1)).toBe(lien("Espace a"));
    expect(liens.at(-1)).toHaveClass("sb-spaces__members");
  });

  it("l'administration de la plateforme a le lien, même sans rôle ou simple lectrice", async () => {
    render(<Accueil fetcher={vi.fn<Fetch>().mockResolvedValue(Response.json(administration.body))} />);
    await screen.findByRole("list", { name: "Espaces" });
    expect(lien("Finance")).toHaveAttribute("href", "#/espaces/finance/parametres");
  });

  it("l'administration de la plateforme a le lien pour un espace où elle est lectrice", async () => {
    await ouvrirListe({ spaces: [espace("l", "reader")], platform_admin: true });
    expect(lien("Espace l")).toHaveAttribute("href", "#/espaces/l/parametres");
  });

  it("aucun lien pour l'espace implicite du mode local, ni pour la liste du contrat (créatrice, lectrice)", async () => {
    const premier = render(<Accueil fetcher={vi.fn<Fetch>().mockResolvedValue(Response.json(locale.body))} />);
    await screen.findByRole("list", { name: "Espaces" });
    expect(screen.queryByRole("link", { name: /Paramètres/ })).not.toBeInTheDocument();
    premier.unmount();
    render(<Accueil fetcher={vi.fn<Fetch>().mockResolvedValue(Response.json(liste.body))} />);
    await screen.findByRole("list", { name: "Espaces" });
    expect(screen.queryByRole("link", { name: /Paramètres/ })).not.toBeInTheDocument();
  });

  it("encode l'identifiant dans le lien", async () => {
    await ouvrirListe({ spaces: [{ ...espace("x", "admin"), id: "a/b c" }], platform_admin: false });
    expect(lien("Espace x")).toHaveAttribute("href", "#/espaces/a%2Fb%20c/parametres");
  });
});
