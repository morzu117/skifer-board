import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, vi } from "vitest";
import liste from "../../../../contracts/catalogue/liste.json";
import ancienne from "../../../../contracts/catalogue/liste-ancienne.json";
import indisponible from "../../../../contracts/catalogue/indisponible.json";
import revenu from "../../../../contracts/catalogue/fiche-revenu-net.json";
import invalide from "../../../../contracts/catalogue/fiche-invalide.json";
import commande from "../../../../contracts/catalogue/fiche-commande.json";
import versions from "../../../../contracts/catalogue/versions-revenu-net.json";
import versionsConcept from "../../../../contracts/catalogue/versions-concept.json";
import { expectAccessible } from "../test/a11y";
import { CataloguePage } from "./CataloguePage";
import type { Fetch } from "./api";

it.each([
  ["liste", liste], ["stale", ancienne], ["indisponible", indisponible], ["erreur", { status: 500, body: {} }],
] as const)("Accessibilité du catalogue : %s", async (_name, sample) => {
  const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json(sample.body, { status: sample.status }));
  const { container } = render(<CataloguePage fetcher={fetcher} now={() => new Date("2026-11-01T12:30:00Z")} />);
  if (sample.status === 200) await screen.findByRole("table");
  else await screen.findByRole("alert");
  await expectAccessible(container);
});
it("Accessibilité du catalogue en chargement", async () => {
  const { container } = render(<CataloguePage fetcher={() => new Promise<Response>(() => undefined)} />);
  await expectAccessible(container);
});
it.each([revenu, invalide, commande])("Accessibilité de la liste avec fiche $body.document.entry.label ouverte", async (sample) => {
  // La fiche lit aussi son historique (plan 05, 5.3) : versions taguées pour le KPI, aucune sinon.
  const historique = sample.body.document.entry.id === "revenu-net" ? versions.body : { ...versionsConcept.body, id: sample.body.document.entry.id };
  const fetcher = vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(Response.json(url === "/api/catalog" ? liste.body : url.endsWith("/versions") ? historique : sample.body)));
  const { container } = render(<CataloguePage fetcher={fetcher} now={() => new Date("2026-11-01T12:30:00Z")} />);
  await userEvent.click(await screen.findByRole("button", { name: sample.body.document.entry.label }));
  await screen.findByRole("heading", { level: 2, name: sample.body.document.entry.label });
  await screen.findByRole("heading", { level: 3, name: /^Versions · / });
  await expectAccessible(container);
});
