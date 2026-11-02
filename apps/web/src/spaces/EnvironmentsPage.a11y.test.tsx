import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, vi } from "vitest";

import accordInconnu from "../../../../contracts/espaces/accord-inconnu.json";
import accords from "../../../../contracts/espaces/accords.json";
import espace from "../../../../contracts/espaces/espace.json";
import interdit from "../../../../contracts/espaces/interdit.json";
import journalAccords from "../../../../contracts/espaces/journal-accords.json";
import parametres from "../../../../contracts/espaces/parametres.json";
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
const BASE = { "GET /api/spaces/finance/deploy-grants": accords, "GET /api/spaces/finance/events": journalAccords, "GET /api/spaces/finance/parameters": parametres };
const rendre = (fetcher: Fetch, theme: (typeof THEMES)[number]) => renderThemed(<main><EnvironmentsPage space={FINANCE} fetcher={fetcher} target="TEST" /></main>, theme);
const lue = async () => {
  await screen.findByRole("list", { name: "Droits de déployer, dans l'ordre de promotion" });
  await screen.findByRole("list", { name: "Journal de l'espace" });
};

describe.each(THEMES)("Accessibilité de « Environnements » · $label", (theme) => {
  it("aucune violation axe : lecture en cours", async () => {
    const { container } = rendre(serveur({ "GET /api/spaces/finance/deploy-grants": "jamais", "GET /api/spaces/finance/events": "jamais", "GET /api/spaces/finance/parameters": "jamais" }), theme);
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

  it("aucune violation axe : complétude incomplète (exemple réel), lien « Paramètres » de chaque carte", async () => {
    const { container } = rendre(serveur(BASE), theme);
    await lue();
    await screen.findAllByText(/^incomplet · /);
    await expectAccessible(container);
  });

  it("aucune violation axe : environnements complets", async () => {
    const complet = structuredClone(parametres.body) as unknown as { parameters: unknown[]; environments: { values: { name: string }[]; missing: string[]; complete: boolean }[] };
    complet.parameters = complet.parameters.slice(1, 2);
    for (const environment of complet.environments) {
      environment.values = environment.values.filter((value) => value.name === "lignes_max");
      environment.missing = [];
      environment.complete = true;
    }
    const { container } = rendre(serveur({ ...BASE, "GET /api/spaces/finance/parameters": { status: 200, body: complet } }), theme);
    await lue();
    await screen.findAllByText("paramètres complets");
    await expectAccessible(container);
  });

  it("aucune violation axe : aucun paramètre déclaré", async () => {
    const { container: vide } = rendre(serveur({ ...BASE, "GET /api/spaces/finance/parameters": { status: 200, body: { parameters: [], environments: ["DEV", "TEST", "PROD"].map((code) => ({ code, can_set: true, complete: true, missing: [], values: [] })) } } }), theme);
    await screen.findAllByText("Aucun paramètre déclaré.");
    await expectAccessible(vide);
  });

  it("aucune violation axe : complétude en lecture", async () => {
    const { container } = rendre(serveur({ ...BASE, "GET /api/spaces/finance/parameters": "jamais" }), theme);
    await lue();
    await screen.findAllByText("Lecture des paramètres…");
    await expectAccessible(container);
  });

  it("aucune violation axe : complétude indisponible avec son bandeau", async () => {
    const { container: panne } = rendre(serveur({ ...BASE, "GET /api/spaces/finance/parameters": { status: 500, body: {} } }), theme);
    await screen.findByText(/^Complétude des paramètres indisponible/);
    await expectAccessible(panne);
  });

  it("aucune violation axe : accès refusé et panne", async () => {
    const { container } = rendre(serveur({ "GET /api/spaces/finance/deploy-grants": interdit, "GET /api/spaces/finance/parameters": interdit }), theme);
    await waitFor(() => { if (screen.getAllByRole("alert").length < 2) throw new Error("attente"); });
    await expectAccessible(container);
  });
});
