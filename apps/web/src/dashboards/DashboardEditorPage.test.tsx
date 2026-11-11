import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import espace from "../../../../contracts/espaces/espace.json";
import { ID } from "../analyses/testing";
import type { Fetch } from "../spaces/api";
import { decodeSpace } from "../spaces/model";
import { expectAccessible } from "../test/a11y";
import { DashboardEditorPage } from "./DashboardEditorPage";
import { dashboardBody, N, ROOT, sampleDraft } from "./edition/testing";
import { route } from "./testing";

const space = decodeSpace(espace.body, "espace");
const reply = (fetcher: Fetch) => render(<DashboardEditorPage space={space} id={ID} fetcher={fetcher} environment="DEV" identity="cora" />);
const answer = (example: { status: number; body: unknown }) => vi.fn<Fetch>().mockImplementation(() => Promise.resolve(Response.json(example.body, { status: example.status })));

it("annonce la lecture, puis ouvre l'éditeur et change de thème", async () => {
  const fetcher = vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(url === `${ROOT}/dashboards/${ID}` ? Response.json(dashboardBody(sampleDraft(), { tiles: [{ id: N.visual, state: "unverified" }, { id: N.kpi, state: "unverified" }], state: "unverified" })) : Response.json({}, { status: 500 })));
  const { container } = reply(fetcher);
  expect(screen.getByRole("status")).toHaveTextContent("Lecture du dashboard…");
  await screen.findByRole("heading", { name: "Pilotage", level: 1 });
  expect(container.firstElementChild).toHaveClass("sb-theme-skifer-clair");
  await userEvent.click(within(screen.getByRole("group", { name: "Thème" })).getByRole("button", { pressed: false }));
  expect(container.firstElementChild).toHaveClass("sb-theme-skifer-ardoise");
});

it.each(["refus-dashboard-inconnu", "refus-interdit", "refus-depot-indisponible"])("un refus (%s) s'affiche tel quel, avec le retour à la liste", async (name) => {
  const { container } = reply(answer(route(name)));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Retour à la liste des dashboards" })).toHaveAttribute("href", "#/espaces/finance/dashboards");
  expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  await expectAccessible(container);
});

it("le mode local se dit sans alarme", async () => {
  reply(answer(route("refus-mode-local")));
  expect(await screen.findByText("Les dashboards ne sont pas disponibles en mode local.")).toBeInTheDocument();
});

it("une panne de lecture s'affiche comme telle, sans éditeur", async () => {
  reply(vi.fn<Fetch>().mockRejectedValue(new TypeError("réseau")));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Enregistrer" })).not.toBeInTheDocument();
});

it("une autre identité relit le dashboard : l'éditeur et ses modifications de la personne précédente disparaissent", async () => {
  const fetcher = vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(url === `${ROOT}/dashboards/${ID}` ? Response.json(dashboardBody(sampleDraft(), { tiles: [{ id: N.visual, state: "unverified" }, { id: N.kpi, state: "unverified" }], state: "unverified" })) : Response.json({}, { status: 500 })));
  const view = reply(fetcher);
  await screen.findByRole("heading", { name: "Pilotage", level: 1 });
  await userEvent.click(screen.getByRole("button", { name: "Ajouter une section" }));
  expect(screen.getByText("Modifications non enregistrées")).toBeInTheDocument();
  const reads = () => fetcher.mock.calls.filter(([url]) => url === `${ROOT}/dashboards/${ID}`).length;
  expect(reads()).toBe(1);
  view.rerender(<DashboardEditorPage space={space} id={ID} fetcher={fetcher} environment="DEV" identity="bob" />);
  expect(screen.getByRole("status")).toHaveTextContent("Lecture du dashboard…");
  await screen.findByRole("heading", { name: "Pilotage", level: 1 });
  expect(reads()).toBe(2);
  expect(screen.getByText("Tout est enregistré")).toBeInTheDocument();
});

it("ouvre une révision numérotée en lecture seule même si le serveur permet la révision courante", async () => {
  const body = { ...dashboardBody(sampleDraft()), current_revision: 2 };
  const fetcher = vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(url === `${ROOT}/dashboards/${ID}/revisions/1` ? Response.json(body) : Response.json({}, { status: 500 })));
  render(<DashboardEditorPage space={space} id={ID} revision={1} fetcher={fetcher} environment="DEV" identity="cora" />);
  expect(await screen.findByText("Révision historique en lecture seule.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Enregistrer" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Ajouter une section" })).not.toBeInTheDocument();
  const node = screen.getByRole("button", { name: "Section 2" });
  fireEvent.keyDown(node, { key: "Delete" });
  expect(screen.getByText("Le serveur n'accorde pas la modification de ce dashboard à votre compte.")).toBeInTheDocument();
  fireEvent.keyDown(node, { key: "A", ctrlKey: true, shiftKey: true });
  expect(screen.queryByRole("dialog", { name: "Ajouter une analyse" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Section 2" })).toBeInTheDocument();
  expect(fetcher.mock.calls.filter(([url]) => url.includes("/dashboards/"))).toHaveLength(1);
});

it("ne lit aucune révision pour un identifiant ou numéro invalide", async () => {
  const fetcher = vi.fn<Fetch>();
  const view = render(<DashboardEditorPage space={space} id="invalide" revision={1} fetcher={fetcher} environment="DEV" identity="cora" />);
  expect(await screen.findByText(/Dashboard indisponible/)).toBeInTheDocument();
  expect(fetcher).not.toHaveBeenCalled();
  view.unmount();
  render(<DashboardEditorPage space={space} id={ID} revision={0} fetcher={fetcher} environment="DEV" identity="cora" />);
  expect(await screen.findByText(/Dashboard indisponible/)).toBeInTheDocument();
  expect(fetcher).not.toHaveBeenCalled();
});
