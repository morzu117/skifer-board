import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, vi } from "vitest";
import liste from "../../../../contracts/catalogue/liste.json";
import revenu from "../../../../contracts/catalogue/fiche-revenu-net.json";
import commande from "../../../../contracts/catalogue/fiche-commande.json";
import inconnue from "../../../../contracts/catalogue/fiche-inconnue.json";
import versions from "../../../../contracts/catalogue/versions-revenu-net.json";
import versionsConcept from "../../../../contracts/catalogue/versions-concept.json";
import historiqueIndisponible from "../../../../contracts/catalogue/versions-indisponible.json";
import ecart from "../../../../contracts/catalogue/ecart-revenu-net.json";
import identique from "../../../../contracts/catalogue/ecart-identique.json";
import versionInconnue from "../../../../contracts/catalogue/ecart-version-inconnue.json";
import irresoluble from "../../../../contracts/catalogue/ecart-irresoluble.json";
import { expectAccessible } from "../test/a11y";
import { CataloguePage } from "./CataloguePage";
import type { Fetch } from "./api";

interface Sample {
  status: number;
  body: unknown;
}
const ECART = "/api/spaces/finance/catalog/revenu-net/diff?base=4&other=5";
function routeur(overrides: Readonly<Record<string, Sample>> = {}) {
  const table: Readonly<Record<string, Sample>> = {
    "/api/spaces/finance/catalog": liste, "/api/spaces/finance/catalog/revenu-net": revenu, "/api/spaces/finance/catalog/commande": commande,
    "/api/spaces/finance/catalog/revenu-net/versions": versions, "/api/spaces/finance/catalog/commande/versions": versionsConcept, [ECART]: ecart, ...overrides,
  };
  return vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(Response.json((table[url] ?? inconnue).body, { status: (table[url] ?? inconnue).status })));
}
async function ouvrir(fetcher: Fetch, label = "Revenu net") {
  const { container } = render(<CataloguePage space="finance" fetcher={fetcher} now={() => new Date("2026-11-01T12:30:00Z")} />);
  await userEvent.click(await screen.findByRole("button", { name: label }));
  return { container, panel: await screen.findByRole("complementary", { name: label }) };
}

it.each<[string, Sample, RegExp]>([
  ["écart ouvert", ecart, /2 écarts entre la v4 et la v5/],
  ["écart identique", identique, /Aucun écart/],
  ["refus : version inconnue", versionInconnue, /Écart indisponible : Version 9/],
  ["refus : version irrésoluble", irresoluble, /Écart indisponible : La version 3/],
  ["écart en erreur", { status: 500, body: {} }, /L'écart n'a pas pu être lu/],
])("Accessibilité de la fiche avec historique : %s", async (_name, sample, attendu) => {
  const { container, panel } = await ouvrir(routeur({ [ECART]: sample }));
  await within(panel).findByRole("heading", { name: "Versions · 3" });
  // Les versions vont de la plus récente à la plus ancienne : le premier bouton est celui de la v4.
  const [v4] = within(panel).getAllByRole("button", { name: "Écart avec la v5" });
  await userEvent.click(v4 as HTMLElement);
  await within(panel).findByText(attendu);
  await expectAccessible(container);
});
it("Accessibilité de la fiche, historique indisponible", async () => {
  const { container, panel } = await ouvrir(routeur({ "/api/spaces/finance/catalog/revenu-net/versions": historiqueIndisponible }));
  await within(panel).findByText(/Historique indisponible/);
  await expectAccessible(container);
});
it("Accessibilité de la fiche, historique et écart en cours de lecture", async () => {
  const fetcher = routeur();
  const { container, panel } = await ouvrir(fetcher);
  await within(panel).findByRole("heading", { name: "Versions · 3" });
  fetcher.mockReturnValueOnce(new Promise<Response>(() => undefined));
  const [v4] = within(panel).getAllByRole("button", { name: "Écart avec la v5" });
  await userEvent.click(v4 as HTMLElement);
  await within(panel).findByText("Calcul de l'écart par Atlas…");
  await expectAccessible(container);
});
it("Accessibilité de la fiche d'un concept sans version taguée", async () => {
  const { container, panel } = await ouvrir(routeur(), "Commande");
  await within(panel).findByText("Aucune version taguée dans Atlas.");
  await expectAccessible(container);
});
