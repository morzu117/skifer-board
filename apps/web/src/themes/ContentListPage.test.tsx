import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import espace from "../../../../contracts/espaces/espace.json";
import models from "../../../../contracts/page_templates/routes/lister.json";
import components from "../../../../contracts/components/routes/lister.json";
import consumers from "../../../../contracts/components/routes/consommateurs.json";
import { decodeSpace } from "../spaces/model";
import type { Fetch } from "../spaces/api";
import { routeFromHash, routeHash } from "../shell/route";
import { ContentListPage } from "./ContentListPage";

const id = "00000000-0000-4000-8000-000000000001";
const example = (value: unknown) => JSON.parse(JSON.stringify(value).replaceAll("<uuid>", id).replaceAll("<commit>", "a".repeat(40))) as unknown;
const space = decodeSpace(espace.body, "espace");
for (const kind of ["modeles", "composants"] as const) {
  it(`construit les routes ${kind}`, () => {
    const list = { page: kind, space: "finance" } as const;
    const detail = { page: kind === "modeles" ? "modele" as const : "composant" as const, space: "finance", id };
    expect(routeFromHash(routeHash(list))).toEqual(list); expect(routeFromHash(routeHash(detail))).toEqual(detail);
    expect(routeFromHash(routeHash({ ...detail, view: "history" }))).toEqual({ ...detail, view: "history" });
    expect(routeFromHash(routeHash({ ...detail, revision: 2 }))).toEqual({ ...detail, revision: 2 });
  });
  it(`liste ${kind} et actualise`, async () => {
    const fetcher = vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(Response.json(example(url.endsWith("/consumers") ? consumers.body : kind === "modeles" ? models.body : components.body))));
    render(<ContentListPage space={space} fetcher={fetcher} kind={kind} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    await screen.findByRole("table");
    if (kind === "modeles") expect(screen.getByText(/aucun dashboard n'en dépend/)).toBeInTheDocument();
    else await waitFor(() => { expect(fetcher.mock.calls.some(([url]) => url.endsWith("/consumers"))).toBe(true); });
    await userEvent.click(screen.getByRole("button", { name: "Actualiser" }));
    await userEvent.click(screen.getByRole("button", { name: "Skifer ardoise" }));
  });
  for (const role of ["admin", "creator"] as const) it(`${kind} vide pour ${role}`, async () => {
    const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json({ [kind === "modeles" ? "page_templates" : "components"]: [], unreadable: 0 }));
    render(<ContentListPage space={{ ...space, role }} fetcher={fetcher} kind={kind} />);
    expect(await screen.findByRole("heading", { name: /Aucun .* à afficher/ })).toBeInTheDocument();
  });
  it(`${kind} illisibles`, async () => {
    const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json({ [kind === "modeles" ? "page_templates" : "components"]: [], unreadable: 1 }));
    render(<ContentListPage space={space} fetcher={fetcher} kind={kind} />);
    expect(await screen.findByText(/illisible/)).toBeInTheDocument();
  });
  for (const failure of ["error", "refusal"] as const) it(`${kind} ${failure}`, async () => {
    const fetcher = vi.fn<Fetch>().mockImplementation(() => failure === "error" ? Promise.reject(new Error("panne")) : Promise.resolve(Response.json({ error: { code: "forbidden", required: "creator" } }, { status: 403 })));
    render(<ContentListPage space={space} fetcher={fetcher} kind={kind} />);
    expect(await screen.findByText(/indisponibles/)).toBeInTheDocument();
  });
}
it.each(["loading", "error", "refusal"] as const)("consommateurs %s", async (state) => {
  const fetcher = vi.fn<Fetch>().mockImplementation((url) => url.endsWith("/consumers") ? state === "loading" ? new Promise<Response>(() => undefined) : state === "error" ? Promise.reject(new Error("panne")) : Promise.resolve(Response.json({ error: { code: "forbidden", required: "creator" } }, { status: 403 })) : Promise.resolve(Response.json(example(components.body))));
  render(<ContentListPage space={space} fetcher={fetcher} kind="composants" />);
  expect(await screen.findByText(state === "loading" ? "lecture…" : /indisponible :/)).toBeInTheDocument();
});
it("montre l'approbation et l'écart", async () => {
  const body = example(components.body) as { components: Record<string, unknown>[]; unreadable: number };
  const item = body.components[0] as Record<string, unknown>;
  body.components = [{ ...item, state: "approved", approved_revision: 1 }, { ...item, id: "00000000-0000-4000-8000-000000000002", revision: 2, approved_revision: 1, index_state: "index_stale" }]; body.unreadable = 1;
  const fetcher = vi.fn<Fetch>().mockImplementation((url) => Promise.resolve(Response.json(url.endsWith("/consumers") ? { id: url.split("/").at(-2), consumers: [], others: 2 } : body)));
  render(<ContentListPage space={space} fetcher={fetcher} kind="composants" />);
  expect(await screen.findByText("Approuvé · r1")).toBeInTheDocument(); expect(screen.getByText(/révision r1 approuvée/)).toBeInTheDocument(); expect(screen.getByText("Index périmé")).toBeInTheDocument();
});
