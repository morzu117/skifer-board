import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { expectAccessible } from "../test/a11y";
import { ListeConsommateurs, OngletConsommateurs } from "./Consommateurs";
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

it("résout le nom visible depuis la liste sans lire les dashboards masqués", async () => {
  const { route: dashboardRoute } = await import("../dashboards/testing");
  const example = dashboardRoute("lister");
  const body = example.body as { dashboards: { id: string; name: string }[] };
  (body.dashboards[0] as { id: string; name: string }).id = ID;
  (body.dashboards[0] as { id: string; name: string }).name = "Pilotage lisible";
  const fetcher = analysesServer({ [endpoint]: route("consommateurs"), "GET /api/spaces/finance/dashboards": example });
  render(<OngletConsommateurs space="finance" id={ID} fetcher={fetcher} />);
  expect(await screen.findByRole("link", { name: "Pilotage lisible" })).toHaveAttribute("href", `#/espaces/finance/dashboards/${ID}`);
  expect(screen.getByText("Autres dépendants que vous ne voyez pas : 1.")).toBeInTheDocument();
  expect(fetcher.mock.calls.filter(([url]) => url.includes("/dashboards"))).toHaveLength(1);
  expect(fetcher.mock.calls.some(([url]) => url.includes(`/dashboards/${ID}`))).toBe(false);
});

it("aucune lecture de liste si tous les consommateurs sont masqués", async () => {
  const { changed } = await import("./testing");
  const example = changed(route("consommateurs"), "body.consumers", []);
  const fetcher = analysesServer({ [endpoint]: example });
  render(<OngletConsommateurs space="finance" id={ID} fetcher={fetcher} />);
  expect(await screen.findByText("Autres dépendants que vous ne voyez pas : 1.")).toBeInTheDocument();
  expect(fetcher.mock.calls.some(([url]) => url.includes("/dashboards"))).toBe(false);
});

it("garde l'identifiant si la liste lisible ne contient pas le dashboard", async () => {
  let deliver!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => { deliver = resolve; });
  const fetcher = vi.fn(() => response);
  render(<ListeConsommateurs space="finance" consumers={[{ kind: "dashboard", id: ID }]} others={0} fetcher={fetcher} />);
  await waitFor(() => { expect(fetcher).toHaveBeenCalledOnce(); });
  await act(async () => { deliver(Response.json({ dashboards: [], unreadable: 0 })); await response; });
  expect(screen.getByRole("link", { name: `Dashboard ${ID}` })).toBeInTheDocument();
});

it("les noms changent avec l'espace et ignorent une réponse tardive", async () => {
  const { route: dashboardRoute } = await import("../dashboards/testing");
  const example = dashboardRoute("lister").body as { dashboards: { id: string; name: string }[] };
  const make = (name: string) => { const body = structuredClone(example); const first = body.dashboards[0] as { id: string; name: string }; first.id = ID; first.name = name; return Response.json(body); };
  let deliver!: (response: Response) => void;
  const ancien = new Promise<Response>((resolve) => { deliver = resolve; });
  const fetcher = vi.fn((url: string) => url.includes("/finance/") ? ancien : Promise.resolve(make("Nouveau nom")));
  const consumers = [{ kind: "dashboard" as const, id: ID }];
  const view = render(<ListeConsommateurs space="finance" consumers={consumers} others={0} fetcher={fetcher} />);
  await waitFor(() => { expect(fetcher).toHaveBeenCalledOnce(); });
  view.rerender(<ListeConsommateurs space="autre" consumers={consumers} others={0} fetcher={fetcher} />);
  expect(await screen.findByRole("link", { name: "Nouveau nom" })).toHaveAttribute("href", `#/espaces/autre/dashboards/${ID}`);
  await act(async () => { deliver(make("Ancien nom")); await ancien; });
  expect(screen.queryByRole("link", { name: "Ancien nom" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Nouveau nom" })).toBeInTheDocument();
});
