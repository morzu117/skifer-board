import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import revised from "../../../../contracts/themes/routes/reviser.json";
import first from "../../../../contracts/themes/routes/lire.json";
import diff from "../../../../contracts/themes/routes/diff.json";
import approval from "../../../../contracts/themes/routes/approver.json";
import type { Fetch } from "../spaces/api";
import { decodeThemeRevision } from "./model";
import { ApprobationTheme } from "./ApprobationTheme";

const id = "00000000-0000-4000-8000-000000000001";
const expand = (body: unknown) => JSON.parse(JSON.stringify(body).replaceAll("<uuid>", id).replaceAll("<commit>", "a".repeat(40))) as unknown;
const revision = (body: unknown) => ({ ...decodeThemeRevision(expand(body), "finance"), etag: `"${"a".repeat(40)}"` });
const past = revision(revised.body);
const initial = revision(first.body);
function response(changes: unknown[]) { return Response.json({ ...(expand(diff.body) as object), changes }); }
const change = (path: string, kind: string, before: unknown, after: unknown) => ({ path, kind, node: null, id: null, before, after });
const changes = [change("/roles/marks/series", "modified", "blue", "ink"), change("/categorical/2", "added", null, "blue"), change("/chart_defaults/line/legend", "removed", "auto", null), change("/name", "modified", "Clair", "Autre"), change("/chart_defaults/value", "added", null, { legend: "shown", number_format: "integer" }), change("/density", "modified", "normal", "airy")];

it("présente chaque genre de diff, ses valeurs et les pastilles de tokens", async () => {
  const onReload = vi.fn();
  const onBusyChange = vi.fn();
  const fetcher = vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(url.includes("/diff?") ? response(changes) : Response.json({ ...(expand(approval.body) as object), approved_revision: 2 }, { status: 201 })));
  render(<ApprobationTheme space="finance" revision={past} fetcher={fetcher} dirty={false} onReload={onReload} onBusyChange={onBusyChange} />);
  expect(screen.getByRole("button", { name: "Approuver" })).toBeDisabled();
  const table = await screen.findByRole("table");
  expect(within(table).getAllByText("Ajouté")).toHaveLength(2);
  expect(within(table).getByText("Retiré")).toBeInTheDocument();
  expect(within(table).getAllByText("Modifié")).toHaveLength(3);
  expect(table).toHaveTextContent("Aérée");
  expect(table).toHaveTextContent("Légende : Affichée");
  expect(table.querySelectorAll(".sb-themes__swatch")).toHaveLength(3);
  expect(table).toHaveTextContent("/roles/marks/series");
  await userEvent.click(screen.getByRole("button", { name: "Approuver" }));
  await vi.waitFor(() => { expect(onReload).toHaveBeenCalledOnce(); });
  expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
  expect(fetcher.mock.calls[1]?.[1]?.body).toBe('{"revision":2,"expected_revision":2}');
});

it("montre la première approbation et bloque un brouillon modifié", async () => {
  const user = userEvent.setup();
  const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json(expand(approval.body), { status: 201 }));
  const reload = vi.fn();
  const view = render(<ApprobationTheme space="finance" revision={initial} fetcher={fetcher} dirty onReload={reload} />);
  expect(screen.getByRole("heading", { name: "Première approbation" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Approuver" })).toBeDisabled();
  view.rerender(<ApprobationTheme space="finance" revision={initial} fetcher={fetcher} dirty={false} onReload={reload} />);
  await user.click(screen.getByRole("button", { name: "Approuver" }));
  await vi.waitFor(() => { expect(reload).toHaveBeenCalledOnce(); });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([
  [{ code: "revision_conflict", reason: "stale" }, "Conflit de révision"],
  [{ code: "already_approved" }, "Révision déjà approuvée"],
  [{ code: "forbidden", required: "admin" }, "Accès refusé"],
] as const)("affiche le refus d'approbation %s sans relancer", async (error, label) => {
  const fetcher = vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(url.includes("/diff?") ? response(changes) : Response.json({ error }, { status: 409 })));
  const reload = vi.fn();
  render(<ApprobationTheme space="finance" revision={past} fetcher={fetcher} dirty={false} onReload={reload} />);
  await screen.findByRole("table");
  await userEvent.click(screen.getByRole("button", { name: "Approuver" }));
  expect(await screen.findByText(new RegExp(label))).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(2);
  if (error.code === "revision_conflict") {
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approuver" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Recharger le thème" }));
    expect(reload).toHaveBeenCalledOnce();
  }
});

it("refuse un diff illisible et le diff vide reste approvable", async () => {
  const view = render(<ApprobationTheme space="finance" revision={past} fetcher={vi.fn<Fetch>().mockRejectedValue(new Error("panne"))} dirty={false} onReload={vi.fn()} />);
  expect(await screen.findByText(/Diff indisponible/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Approuver" })).toBeDisabled();
  view.unmount();
  render(<ApprobationTheme space="finance" revision={past} fetcher={vi.fn<Fetch>().mockResolvedValue(response([]))} dirty={false} onReload={vi.fn()} />);
  expect(await screen.findByText("Aucune différence structurelle.")).toBeInTheDocument();
});

it("rend un refus de diff et les erreurs d'approbation", async () => {
  const refused = vi.fn<Fetch>().mockResolvedValue(Response.json({ error: { code: "forbidden", required: "admin" } }, { status: 403 }));
  const view = render(<ApprobationTheme space="finance" revision={past} fetcher={refused} dirty={false} onReload={vi.fn()} />);
  expect(await screen.findByText(/Diff indisponible : Accès refusé/)).toBeInTheDocument();
  view.unmount();
  const error = vi.fn<Fetch>().mockRejectedValue(new Error("panne"));
  render(<ApprobationTheme space="finance" revision={initial} fetcher={error} dirty={false} onReload={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Approuver" }));
  expect(await screen.findByText(/Le serveur Board ne répond pas/)).toBeInTheDocument();
});

it("refuse une approbation qui confirme une autre révision", async () => {
  const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json({ ...(expand(approval.body) as object), approved_revision: 2 }, { status: 201 }));
  render(<ApprobationTheme space="finance" revision={initial} fetcher={fetcher} dirty={false} onReload={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Approuver" }));
  expect(await screen.findByText(/révision différente/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Approuver" })).toBeDisabled();
});

it("ne lance pas deux approbations simultanées", () => {
  const fetcher = vi.fn<Fetch>().mockImplementation(() => new Promise<Response>(() => undefined));
  render(<ApprobationTheme space="finance" revision={initial} fetcher={fetcher} dirty={false} onReload={vi.fn()} />);
  const button = screen.getByRole("button", { name: "Approuver" });
  act(() => { fireEvent.click(button); fireEvent.click(button); });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
