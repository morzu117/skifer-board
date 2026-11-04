import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import liste from "../../../../contracts/espaces/liste.json";
import administration from "../../../../contracts/espaces/liste-administration.json";
import locale from "../../../../contracts/espaces/liste-locale.json";
import { useOutcome } from "../ui/useOutcome";
import { fetchSpaces, type Fetch } from "./api";
import { SpacesHome } from "./SpacesHome";

// Lien « Télémétrie » de l'accueil des espaces (plan 11, 11.4) : offert à l'administration de la
// plateforme seule, à côté de « Créer un espace ».

function Accueil({ fetcher }: { fetcher: Fetch }) {
  const listed = useOutcome("spaces", (signal) => fetchSpaces(signal, fetcher));
  return <SpacesHome listed={listed} />;
}
const ouvrirListe = async (corps: unknown) => {
  render(<Accueil fetcher={vi.fn<Fetch>().mockResolvedValue(Response.json(corps))} />);
  await screen.findByRole("list", { name: "Espaces" });
};
const lien = () => screen.queryByRole("link", { name: "Télémétrie" });
const espace = (id: string, role: "reader" | "creator" | "admin" | null, implicit = false) => ({
  id, name: `Espace ${id}`, atlas: "skifer-atlas", created_at: "2026-11-02T09:00:00+00:00",
  created_by: { issuer: "https://id.example.invalid", subject: "s" }, role, implicit,
  environments: [{ code: "DEV", deploy: true }, { code: "TEST", deploy: true }, { code: "PROD", deploy: true }],
});

describe("Accueil des espaces : lien « Télémétrie » (plan 11, 11.4)", () => {
  it("l'administration de la plateforme a le lien, bouton secondaire avant « Créer un espace », seul principal", async () => {
    render(<Accueil fetcher={vi.fn<Fetch>().mockResolvedValue(Response.json(administration.body))} />);
    await screen.findByRole("list", { name: "Espaces" });
    expect(lien()).toHaveAttribute("href", "#/telemetrie");
    expect(lien()).toHaveClass("sb-button");
    expect(lien()).not.toHaveClass("sb-button--primary");
    const creer = screen.getByRole("link", { name: "Créer un espace" });
    expect(creer).toHaveClass("sb-button--primary");
    expect(lien()?.parentElement).toBe(creer.parentElement);
    expect(lien()?.parentElement).toHaveClass("sb-spaces__admin");
    expect(lien()?.compareDocumentPosition(creer)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(document.querySelectorAll(".sb-button--primary")).toHaveLength(1);
    // Hors de la liste : le lien est dans l'en-tête de page, pas dans une entrée d'espace.
    expect(screen.getByRole("list", { name: "Espaces" })).not.toContainElement(lien());
  });

  it("l'administration de la plateforme sans aucun espace a encore le lien", async () => {
    render(<Accueil fetcher={vi.fn<Fetch>().mockResolvedValue(Response.json({ spaces: [], platform_admin: true }))} />);
    await screen.findByRole("region", { name: "Aucun espace" });
    expect(lien()).toHaveAttribute("href", "#/telemetrie");
  });

  it("pas de lien pour un administrateur d'espace qui n'administre pas la plateforme", async () => {
    await ouvrirListe({ spaces: [espace("a", "admin"), espace("b", "admin")], platform_admin: false });
    expect(screen.getAllByRole("link", { name: /^Membres et rôles de/ })).toHaveLength(2);
    expect(lien()).not.toBeInTheDocument();
    expect(screen.queryByText("Télémétrie")).not.toBeInTheDocument();
  });

  it.each([["liste du contrat (créatrice, lectrice)", liste.body], ["mode local", locale.body]])("pas de lien : %s", async (_, corps) => {
    await ouvrirListe(corps);
    expect(lien()).not.toBeInTheDocument();
    expect(screen.queryByText("Télémétrie")).not.toBeInTheDocument();
  });

  it("pas de lien pendant la lecture, ni si la liste est indisponible", async () => {
    const lecture = render(<Accueil fetcher={vi.fn<Fetch>().mockImplementation(() => new Promise<Response>(() => undefined))} />);
    expect(screen.getByRole("status")).toHaveTextContent("Lecture des espaces…");
    expect(lien()).not.toBeInTheDocument();
    lecture.unmount();
    render(<Accueil fetcher={vi.fn<Fetch>().mockRejectedValue(new TypeError("réseau"))} />);
    await screen.findByRole("alert");
    expect(lien()).not.toBeInTheDocument();
  });
});
