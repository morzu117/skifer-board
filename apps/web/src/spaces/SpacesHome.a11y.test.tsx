import { screen } from "@testing-library/react";
import { describe, it, vi } from "vitest";

import liste from "../../../../contracts/espaces/liste.json";
import administration from "../../../../contracts/espaces/liste-administration.json";
import { THEMES } from "../charts/theme";
import { expectAccessible, renderThemed } from "../test/a11y";
import { useOutcome } from "../ui/useOutcome";
import { fetchSpaces, type Fetch } from "./api";
import { SpacesHome } from "./SpacesHome";

/** La coque lit la liste et la passe à l'accueil (plan 08, 8.3) : ce banc fait de même. */
function Accueil({ fetcher }: { fetcher: Fetch }) {
  const listed = useOutcome("spaces", (signal) => fetchSpaces(signal, fetcher));
  return <SpacesHome listed={listed} />;
}

const servir = (exemple: { status: number; body: unknown }) => vi.fn<Fetch>().mockResolvedValue(Response.json(exemple.body, { status: exemple.status }));
const jamais = () => new Promise<Response>(() => undefined);

describe.each(THEMES)("Accessibilité de l'accueil des espaces · $label", (theme) => {
  it.each([
    ["chargement", () => vi.fn<Fetch>().mockImplementation(jamais)],
    ["liste", () => servir(liste)],
    ["administration", () => servir(administration)],
    ["vide", () => vi.fn<Fetch>().mockResolvedValue(Response.json({ spaces: [], platform_admin: false }))],
    ["erreur", () => vi.fn<Fetch>().mockRejectedValue(new TypeError("réseau"))],
  ])("aucune violation axe : %s", async (etat, fabrique) => {
    const { container } = renderThemed(<main><Accueil fetcher={fabrique()} /></main>, theme);
    if (etat === "liste" || etat === "administration") await screen.findByRole("list", { name: "Espaces" });
    if (etat === "vide") await screen.findByRole("region", { name: "Aucun espace" });
    if (etat === "erreur") await screen.findByRole("alert");
    await expectAccessible(container);
  });
});
