import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, vi } from "vitest";

import espace from "../../../../contracts/espaces/espace.json";
import interdit from "../../../../contracts/espaces/interdit.json";
import journalParametres from "../../../../contracts/espaces/journal-parametres.json";
import parametres from "../../../../contracts/espaces/parametres.json";
import valeurInvalide from "../../../../contracts/espaces/valeur-invalide.json";
import valeursIncompatibles from "../../../../contracts/espaces/valeurs-incompatibles.json";
import { THEMES } from "../charts/theme";
import { expectAccessible, renderThemed } from "../test/a11y";
import type { Fetch } from "./api";
import { decodeSpace } from "./model";
import { ParametersPage } from "./ParametersPage";

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
const PARAMETRES = "GET /api/spaces/finance/parameters";
const BASE = { [PARAMETRES]: parametres, "GET /api/spaces/finance/events": journalParametres };
const rendre = (fetcher: Fetch, theme: (typeof THEMES)[number]) => renderThemed(<main><ParametersPage space={FINANCE} fetcher={fetcher} target="TEST" /></main>, theme);
const lue = async () => {
  await screen.findByRole("table", { name: "Paramètres et valeurs par environnement" });
  await screen.findByRole("list", { name: "Journal de l'espace" });
};
const sansDroit = () => {
  const corps = structuredClone(parametres.body);
  for (const environment of corps.environments) environment.can_set = false;
  return { status: 200, body: corps };
};
const aucun = () => {
  const corps = structuredClone(parametres.body) as { parameters: unknown[]; environments: { values: unknown[]; missing: unknown[]; complete: boolean }[] };
  corps.parameters = [];
  for (const environment of corps.environments) Object.assign(environment, { values: [], missing: [], complete: true });
  return { status: 200, body: corps };
};

describe.each(THEMES)("Accessibilité de « Paramètres » · $label", (theme) => {
  it("aucune violation axe : lecture en cours", async () => {
    const { container } = rendre(serveur({ [PARAMETRES]: "jamais", "GET /api/spaces/finance/events": "jamais" }), theme);
    await expectAccessible(container);
  });

  it("aucune violation axe : grille avec cible, formulaires et journal", async () => {
    const { container } = rendre(serveur(BASE), theme);
    await lue();
    await expectAccessible(container);
  });

  it("aucune violation axe : confirmation d'un vidage, puis d'un retrait", async () => {
    const { container } = rendre(serveur(BASE), theme);
    await lue();
    await userEvent.click(screen.getByRole("button", { name: "Vider la valeur de lignes_max en TEST" }));
    await screen.findByRole("group", { name: /^Vider la valeur de lignes_max en TEST/ });
    await expectAccessible(container);
    await userEvent.click(screen.getByRole("button", { name: "Retirer le paramètre region" }));
    await screen.findByRole("group", { name: /^Retirer le paramètre region/ });
    await expectAccessible(container);
  });

  it("aucune violation axe : valeur choisie depuis la grille (liste), puis refusée", async () => {
    const { container } = rendre(serveur({ ...BASE, "PUT /api/spaces/finance/parameters/region/values/DEV": valeurInvalide }), theme);
    await lue();
    await userEvent.click(screen.getByRole("button", { name: "Poser la valeur de region en DEV" }));
    const formulaire = screen.getByRole("form", { name: "Poser une valeur" });
    await userEvent.selectOptions(within(formulaire).getByRole("combobox", { name: /^Valeur/ }), "eu-west");
    await expectAccessible(container);
    await userEvent.click(within(formulaire).getByRole("button", { name: "Poser la valeur" }));
    await screen.findByRole("alert");
    await expectAccessible(container);
  });

  it("aucune violation axe : modification d'une déclaration refusée (valeurs incompatibles)", async () => {
    const { container } = rendre(serveur({ ...BASE, "PUT /api/spaces/finance/parameters/lignes_max": valeursIncompatibles }), theme);
    await lue();
    await userEvent.click(screen.getByRole("button", { name: "Modifier la déclaration de lignes_max" }));
    await expectAccessible(container);
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer la déclaration" }));
    await screen.findByRole("alert");
    await expectAccessible(container);
  });

  it("aucune violation axe : déclaration d'un choix et d'un booléen", async () => {
    const { container } = rendre(serveur(BASE), theme);
    await lue();
    const formulaire = screen.getByRole("form", { name: "Déclarer un paramètre" });
    await userEvent.selectOptions(within(formulaire).getByRole("combobox", { name: "Type" }), "choice");
    await userEvent.type(within(formulaire).getByRole("textbox", { name: /^Valeurs possibles/ }), "a{Enter}b");
    await expectAccessible(container);
    await userEvent.selectOptions(within(formulaire).getByRole("combobox", { name: "Type" }), "boolean");
    await expectAccessible(container);
  });

  it("aucune violation axe : aucun environnement ouvert, puis aucun paramètre", async () => {
    const premier = rendre(serveur({ ...BASE, [PARAMETRES]: sansDroit() }), theme);
    await lue();
    await expectAccessible(premier.container);
    premier.unmount();
    const second = rendre(serveur({ ...BASE, [PARAMETRES]: aucun() }), theme);
    await screen.findByText(/Aucun paramètre déclaré/);
    await expectAccessible(second.container);
  });

  it("aucune violation axe : accès refusé", async () => {
    const { container } = rendre(serveur({ [PARAMETRES]: interdit, "GET /api/spaces/finance/events": interdit }), theme);
    await waitFor(() => { if (screen.getAllByRole("alert").length < 2) throw new Error("attente"); });
    await expectAccessible(container);
  });
});
