import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ID, route } from "../testing";
import { ConflitDashboard } from "./ConflitDashboard";
import { dashboardBody, editorServer, ROOT, sampleDraft } from "./testing";

const copyId = "00000000-0000-4000-8000-000000000099";
const copy = JSON.parse(JSON.stringify(route("dupliquer").body).replaceAll(ID, copyId)) as Record<string, unknown>;
const renderConflict = (server: ReturnType<typeof editorServer>) => render(<ConflitDashboard space="finance" id={ID} opened={1} draft={sampleDraft()} fetcher={server.fetcher} onReopen={vi.fn()} />);

it.each(["refused", "error"] as const)("rend l'échec %s de la duplication", async (mode) => {
  const server = editorServer({ overrides: { [`POST ${ROOT}/dashboards/${ID}/duplicate`]: mode === "refused" ? Response.json({ error: { code: "local_mode" } }, { status: 403 }) : Response.json({}, { status: 500 }) } });
  renderConflict(server);
  await userEvent.click(screen.getByRole("button", { name: "Copie indépendante" }));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
});

it.each(["refused", "error"] as const)("après échec %s de révision, conserve la copie et ne la recrée pas", async (mode) => {
  const server = editorServer({ overrides: {
    [`POST ${ROOT}/dashboards/${ID}/duplicate`]: Response.json(copy, { status: 201 }),
    [`POST ${ROOT}/dashboards/${copyId}/revisions`]: mode === "refused" ? Response.json({ error: { code: "revision_conflict", reason: "stale" } }, { status: 409 }) : Response.json({}, { status: 500 }),
  } });
  renderConflict(server);
  await userEvent.click(screen.getByRole("button", { name: "Copie indépendante" }));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Réessayer la révision de la copie" }));
  await waitFor(() => { expect(server.fetcher.mock.calls.filter(([url]) => url.endsWith("/duplicate"))).toHaveLength(1); });
  expect(server.fetcher.mock.calls.filter(([url]) => url === `${ROOT}/dashboards/${copyId}/revisions`)).toHaveLength(2);
});

it("ne double pas une duplication en attente", async () => {
  let release!: (value: Response) => void;
  const response = new Promise<Response>((resolve) => { release = resolve; });
  const server = editorServer({ overrides: { [`POST ${ROOT}/dashboards/${ID}/duplicate`]: () => response } });
  renderConflict(server);
  const button = screen.getByRole("button", { name: "Copie indépendante" });
  act(() => { fireEvent.click(button); fireEvent.click(button); });
  expect(server.fetcher.mock.calls.filter(([url]) => url.endsWith("/duplicate"))).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Copie en cours…" })).toBeDisabled();
  await act(async () => { release(Response.json({}, { status: 500 })); await response; });
});

it("dit l'échec de la relecture courante sans offrir sa réouverture", async () => {
  const server = editorServer({ overrides: { [`GET ${ROOT}/dashboards/${ID}`]: Response.json({}, { status: 500 }) } });
  renderConflict(server);
  expect(await screen.findByText(/Révision courante indisponible/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Rouvrir la révision courante" })).not.toBeInTheDocument();
});

it.each(["empty", "error"] as const)("rend l'écart %s et permet d'annuler la réouverture", async (mode) => {
  const diff = mode === "empty" ? Response.json({ id: ID, base: 1, other: 2, changes: [] }) : Response.json({}, { status: 500 });
  const server = editorServer({ overrides: { [`GET ${ROOT}/dashboards/${ID}`]: Response.json(dashboardBody(sampleDraft(), { revision: 2 })), [`GET ${ROOT}/dashboards/${ID}/diff?base=1&other=2`]: diff } });
  renderConflict(server);
  await userEvent.click(await screen.findByRole("button", { name: "Rouvrir la révision courante" }));
  await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
  expect(screen.queryByRole("group", { name: "Abandonner les modifications" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Voir l'écart" }));
  expect(await screen.findByText(mode === "empty" ? "Aucune différence structurelle." : /Écart indisponible/)).toBeInTheDocument();
});
