import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, vi } from "vitest";

import dernier from "../../../../contracts/espaces/dernier-administrateur.json";
import espace from "../../../../contracts/espaces/espace.json";
import interdit from "../../../../contracts/espaces/interdit.json";
import journal from "../../../../contracts/espaces/journal.json";
import membres from "../../../../contracts/espaces/membres.json";
import personnes from "../../../../contracts/espaces/personnes.json";
import { THEMES } from "../charts/theme";
import { expectAccessible, renderThemed } from "../test/a11y";
import type { Fetch } from "./api";
import { decodeSpace } from "./model";
import { MembersPage } from "./MembersPage";

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
const BASE = { "GET /api/spaces/finance/members": membres, "GET /api/spaces/finance/events": journal };
const rendre = (fetcher: Fetch, theme: (typeof THEMES)[number]) => renderThemed(<main><MembersPage space={FINANCE} fetcher={fetcher} /></main>, theme);
const lue = async () => { await screen.findByRole("table", { name: "Liaisons de l'espace" }); await screen.findByRole("list", { name: "Journal de l'espace" }); };

describe.each(THEMES)("Accessibilité de « Membres et rôles » · $label", (theme) => {
  it("aucune violation axe : lecture en cours", async () => {
    const { container } = rendre(serveur({ "GET /api/spaces/finance/members": "jamais", "GET /api/spaces/finance/events": "jamais" }), theme);
    await expectAccessible(container);
  });

  it("aucune violation axe : liaisons, ajout et journal", async () => {
    const { container } = rendre(serveur(BASE), theme);
    await lue();
    await expectAccessible(container);
  });

  it("aucune violation axe : confirmation d'un changement de rôle", async () => {
    const { container } = rendre(serveur(BASE), theme);
    await lue();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Rôle de Dominique Leroy" }), "admin");
    await screen.findByRole("group", { name: /Passer Dominique Leroy/ });
    await expectAccessible(container);
  });

  it("aucune violation axe : refus du dernier administrateur", async () => {
    const { container } = rendre(serveur({ ...BASE, "DELETE /api/spaces/finance/members/5b0e4c1e-7a51-4f0e-9a8e-1f2d3c4b5a60": dernier }), theme);
    await lue();
    await userEvent.click(screen.getByRole("button", { name: "Retirer Groupe finance-admins" }));
    await userEvent.click(screen.getByRole("button", { name: "Retirer" }));
    await screen.findByRole("alert");
    await lue();
    await expectAccessible(container);
  });

  it("aucune violation axe : ajout d'une personne, résultats de recherche et membre déjà lié", async () => {
    const { container } = rendre(serveur({ ...BASE, "GET /api/people?q=leroy": personnes }), theme);
    await lue();
    const formulaire = screen.getByRole("form", { name: "Ajouter une liaison" });
    await userEvent.click(within(formulaire).getByRole("radio", { name: "Personne connue" }));
    await userEvent.type(within(formulaire).getByRole("searchbox"), "leroy{Enter}");
    await within(formulaire).findByRole("list", { name: "Personnes trouvées" });
    await expectAccessible(container);
    await userEvent.click(within(formulaire).getByRole("button", { name: /Dominique Leroy/ }));
    await userEvent.selectOptions(within(formulaire).getByRole("combobox", { name: "Rôle" }), "admin");
    await userEvent.click(within(formulaire).getByRole("button", { name: "Ajouter la liaison" }));
    await within(formulaire).findByRole("group", { name: /Passer Dominique Leroy/ });
    await expectAccessible(container);
  });

  it("aucune violation axe : accès refusé et panne", async () => {
    const { container } = rendre(serveur({ "GET /api/spaces/finance/members": interdit }), theme);
    await waitFor(() => { if (screen.getAllByRole("alert").length < 2) throw new Error("attente"); });
    await expectAccessible(container);
  });
});
