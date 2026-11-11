import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import espace from "../../../../contracts/espaces/espace.json";
import { decodeSpace } from "../spaces/model";
import { expectAccessible, renderThemed } from "../test/a11y";
import { SKIFER_ARDOISE } from "../charts/theme";
import { bodyOf, dashboardsServer, ID, ROOT, route } from "./testing";
import { NouveauDashboard } from "./NouveauDashboard";

const space = decodeSpace(espace.body, "espace").id;
const creating = (routes: Parameters<typeof dashboardsServer>[0], onClose = vi.fn()) => {
  const fetcher = dashboardsServer(routes);
  const view = render(<NouveauDashboard space={space} fetcher={fetcher} onClose={onClose} />);
  return { fetcher, onClose, ...view };
};
afterEach(() => { window.location.hash = ""; });

it("crée un dashboard vide avec le nom, la description et la visibilité, puis ouvre l'éditeur", async () => {
  const { fetcher } = creating({ [`POST ${ROOT}`]: route("creer") });
  expect(screen.getByRole("textbox", { name: "Nom du dashboard" })).toHaveFocus();
  expect(screen.getByRole("button", { name: "Créer et ouvrir" })).toBeDisabled();
  await userEvent.type(screen.getByRole("textbox", { name: "Nom du dashboard" }), "Pilotage");
  await userEvent.type(screen.getByRole("textbox", { name: "Description" }), "Suivi.");
  expect(screen.getByRole("radio", { name: "Personnel" })).toBeChecked();
  await userEvent.click(screen.getByRole("radio", { name: "Partagé" }));
  expect(screen.getByText(/Il ne peut épingler que des analyses partagées/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Créer et ouvrir" }));
  await waitFor(() => { expect(window.location.hash).toBe(`#/espaces/finance/dashboards/${ID}`); });
  expect(JSON.parse(bodyOf(fetcher))).toEqual({ name: "Pilotage", description: "Suivi.", visibility: "shared", defaults: {}, filters: [], layout: { sections: [] } });
});

it("ne double jamais la création et dit qu'elle est en cours", async () => {
  let release: () => void = () => undefined;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const fetcher = vi.fn((_url: string, init?: RequestInit) => hold.then(() => Response.json(route("creer").body, { status: 201, headers: { "x-method": init?.method ?? "" } })));
  render(<NouveauDashboard space={space} fetcher={fetcher} onClose={() => undefined} />);
  await userEvent.type(screen.getByRole("textbox", { name: "Nom du dashboard" }), "Pilotage{Enter}{Enter}");
  expect(screen.getByRole("button", { name: "Création…" })).toBeDisabled();
  release();
  await waitFor(() => { expect(window.location.hash).toContain("/dashboards/"); });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("n'envoie rien tant que le nom est vide ou fait d'espaces", async () => {
  const { fetcher } = creating({});
  await userEvent.type(screen.getByRole("textbox", { name: "Nom du dashboard" }), "   {Enter}");
  expect(fetcher).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Créer et ouvrir" })).toBeDisabled();
});

it.each([
  ["refus-interdit", "Votre rôle ne permet pas cette action."],
  ["refus-depot-indisponible", "dépôt"],
  ["refus-dashboard-invalide-filtre", "/filters/0/targets/0 : dimension non exposée par le modèle"],
  ["refus-reference-personnelle", "Composants :"],
])("affiche le refus %s tel quel, sans ouvrir l'éditeur", async (name, text) => {
  creating({ [`POST ${ROOT}`]: route(name) });
  await userEvent.type(screen.getByRole("textbox", { name: "Nom du dashboard" }), "Pilotage{Enter}");
  expect(await screen.findByRole("alert")).toHaveTextContent(text);
  expect(window.location.hash).toBe("");
  expect(screen.getByRole("button", { name: "Créer et ouvrir" })).toBeEnabled();
});

it("une panne se dit non confirmée et ne prétend ni échec ni succès", async () => {
  creating({});
  await userEvent.type(screen.getByRole("textbox", { name: "Nom du dashboard" }), "Pilotage{Enter}");
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Création non confirmée");
  expect(alert).toHaveTextContent("relisez la liste avant de recommencer");
  expect(window.location.hash).toBe("");
});

it("Annuler ferme le dialogue sans rien envoyer", async () => {
  const { fetcher, onClose } = creating({});
  await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(fetcher).not.toHaveBeenCalled();
});

it("est accessible dans les deux thèmes, refus affiché compris", async () => {
  const fetcher = dashboardsServer({ [`POST ${ROOT}`]: route("refus-interdit") });
  const { container } = render(<NouveauDashboard space={space} fetcher={fetcher} onClose={() => undefined} />);
  await expectAccessible(container);
  await userEvent.type(screen.getByRole("textbox", { name: "Nom du dashboard" }), "x{Enter}");
  await screen.findByRole("alert");
  await expectAccessible(container);
  const dark = renderThemed(<NouveauDashboard space={space} fetcher={fetcher} onClose={() => undefined} />, SKIFER_ARDOISE);
  await expectAccessible(dark.container);
});

it("un envoi forcé sans nom, ou pendant la création, ne soumet rien de plus", async () => {
  let release: () => void = () => undefined;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const fetcher = vi.fn(() => hold.then(() => Response.json(route("creer").body, { status: 201 })));
  render(<NouveauDashboard space={space} fetcher={fetcher} onClose={() => undefined} />);
  const form = screen.getByRole("textbox", { name: "Nom du dashboard" }).closest("form") as HTMLFormElement;
  fireEvent.submit(form);
  expect(fetcher).not.toHaveBeenCalled();
  await userEvent.type(screen.getByRole("textbox", { name: "Nom du dashboard" }), "Pilotage");
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(fetcher).toHaveBeenCalledTimes(1);
  release();
  await waitFor(() => { expect(window.location.hash).toBe(`#/espaces/finance/dashboards/${ID}`); });
});

it("annuler pendant la création ne navigue pas quand le serveur répond", async () => {
  let release: () => void = () => undefined;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const fetcher = vi.fn(() => hold.then(() => Response.json(route("creer").body, { status: 201 })));
  const close = vi.fn();
  render(<NouveauDashboard space={space} fetcher={fetcher} onClose={close} />);
  await userEvent.type(screen.getByRole("textbox", { name: "Nom du dashboard" }), "Pilotage{Enter}");
  await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
  release();
  await waitFor(() => { expect(close).toHaveBeenCalledOnce(); });
  await hold;
  expect(window.location.hash).toBe("");
});

it("ne navigue pas si le dialogue est démonté pendant la création", async () => {
  let finish!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => { finish = resolve; });
  const { unmount } = render(<NouveauDashboard space={space} fetcher={vi.fn(() => response)} onClose={vi.fn()} />);
  await userEvent.type(screen.getByRole("textbox", { name: "Nom du dashboard" }), "Pilotage{Enter}");
  unmount();
  finish(Response.json(route("creer").body, { status: 201 }));
  await response;
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  expect(window.location.hash).toBe("");
});
