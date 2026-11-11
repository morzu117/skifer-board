import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { expectAccessible } from "../test/a11y";
import { OngletConsommateurs } from "./Consommateurs";
import { analysesServer, ID, ROOT, route } from "./testing";

const endpoint = `GET ${ROOT}/${ID}/consumers`;
it("affiche les seuls dashboards visibles et le décompte des autres", async () => {
  const fetcher = analysesServer({ [endpoint]: route("consommateurs") });
  const view = render(<OngletConsommateurs space="finance" id={ID} fetcher={fetcher} />);
  expect(screen.getByRole("status")).toHaveTextContent("Lecture des consommateurs");
  const link = await screen.findByRole("link", { name: `Dashboard ${ID}` });
  expect(link).toHaveAttribute("href", `#/espaces/finance/dashboards/${ID}`);
  expect(screen.getByText("Autres dépendants que vous ne voyez pas : 1.")).toBeInTheDocument();
  await expectAccessible(view.container);
});
it("affiche la liste vide", async () => {
  render(<OngletConsommateurs space="finance" id={ID} fetcher={analysesServer({ [endpoint]: route("consommateurs-aucun") })} />);
  expect(await screen.findByText("Aucun consommateur.")).toBeInTheDocument();
});
it.each([["refus", { status: 403, body: { error: { code: "forbidden" } } }], ["erreur", { status: 500, body: {} }]] as const)("affiche l'échec %s", async (_name, response) => {
  render(<OngletConsommateurs space="finance" id={ID} fetcher={analysesServer({ [endpoint]: response })} />);
  expect(await screen.findByText(/Consommateurs indisponibles/)).toBeInTheDocument();
});
it("n'appelle rien avec un identifiant invalide", async () => {
  const fetcher = vi.fn();
  render(<OngletConsommateurs space="finance" id="invalide" fetcher={fetcher} />);
  expect(await screen.findByText(/Consommateurs indisponibles/)).toBeInTheDocument();
  expect(fetcher).not.toHaveBeenCalled();
});
