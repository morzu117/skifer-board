import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, vi } from "vitest";

import accordInconnu from "../../../../contracts/espaces/accord-inconnu.json";
import accords from "../../../../contracts/espaces/accords.json";
import espace from "../../../../contracts/espaces/espace.json";
import interdit from "../../../../contracts/espaces/interdit.json";
import journalAccords from "../../../../contracts/espaces/journal-accords.json";
import personnes from "../../../../contracts/espaces/personnes.json";
import { THEMES } from "../charts/theme";
import { expectAccessible, renderThemed } from "../test/a11y";
import type { Fetch } from "./api";
import { EnvironmentsPage } from "./EnvironmentsPage";
import { decodeSpace } from "./model";

type Exemple = { status: number; body: unknown };
const FINANCE = decodeSpace(espace.body, "espace");
const jamais = () => new Promise<Response>(() => undefined);
function serveur(table: Readonly<Record<string, Exemple | "jamais">>) {
  return vi.fn<Fetch>().mockImplementation((url, init) => {
    const exemple = table[`${init?.method ?? "GET"} ${url}`];
    if (exemple === undefined) return Promise.reject(new TypeError("réseau"));
    return exemple === "jamais" ? jamais() : Promise.resolve(Response.json(exemple.body, { status: exemple.status }));
  });
}
const BASE = { "GET /api/spaces/finance/deploy-grants": accords, "GET /api/spaces/finance/events": journalAccords };
const rendre = (fetcher: Fetch, theme: (typeof THEMES)[number]) => renderThemed(<main><EnvironmentsPage space={FINANCE} fetcher={fetcher} target="TEST" /></main>, theme);
const lue = async () => {
  await screen.findByRole("list", { name: "Droits de déployer, dans l'ordre de promotion" });
  await screen.findByRole("list", { name: "Journal de l'espace" });
};

describe.each(THEMES)("Accessibilité de « Environnements » · $label", (theme) => {
  it("aucune violation axe : lecture en cours", async () => {
    const { container } = rendre(serveur({ "GET /api/spaces/finance/deploy-grants": "jamais", "GET /api/spaces/finance/events": "jamais" }), theme);
    await expectAccessible(container);
  });

  it("aucune violation axe : pipeline avec cible, accords, formulaire et journal", async () => {
    const { container } = rendre(serveur(BASE), theme);
    await lue();
    await expectAccessible(container);
  });

  it("aucune violation axe : confirmation d'un retrait", async () => {
    const { container } = rendre(serveur(BASE), theme);
    await lue();
    await userEvent.click(screen.getByRole("button", { name: "Retirer le droit de déployer en TEST : Dominique Leroy" }));
    await screen.findByRole("group", { name: /Retirer le droit de déployer en TEST/ });
    await expectAccessible(container);
  });

  it("aucune violation axe : refus d'un retrait et bandeau focalisé", async () => {
    const { container } = rendre(serveur({ ...BASE, "DELETE /api/spaces/finance/deploy-grants/7a4b9c0d-1e2f-4a3b-9c4d-5e6f7a8b9c0d": accordInconnu }), theme);
    await lue();
    await userEvent.click(screen.getByRole("button", { name: "Retirer le droit de déployer en DEV : Groupe finance-createurs" }));
    await userEvent.click(screen.getByRole("button", { name: "Retirer" }));
    await screen.findByRole("alert");
    await lue();
    await expectAccessible(container);
  });

  it("aucune violation axe : personne cherchée, puis doublon signalé", async () => {
    const { container } = rendre(serveur({ ...BASE, "GET /api/people?q=leroy": personnes }), theme);
    await lue();
    const formulaire = screen.getByRole("form", { name: "Accorder un droit de déployer" });
    await userEvent.click(within(formulaire).getByRole("radio", { name: "Personne connue" }));
    await userEvent.type(within(formulaire).getByRole("searchbox"), "leroy{Enter}");
    await within(formulaire).findByRole("list", { name: "Personnes trouvées" });
    await expectAccessible(container);
    await userEvent.click(within(formulaire).getByRole("button", { name: /Dominique Leroy/ }));
    await within(formulaire).findByText(/peut déjà déployer en TEST/);
    await expectAccessible(container);
  });

  it("aucune violation axe : accès refusé et panne", async () => {
    const { container } = rendre(serveur({ "GET /api/spaces/finance/deploy-grants": interdit }), theme);
    await waitFor(() => { if (screen.getAllByRole("alert").length < 2) throw new Error("attente"); });
    await expectAccessible(container);
  });
});
