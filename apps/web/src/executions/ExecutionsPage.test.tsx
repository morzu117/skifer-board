import { tableFromArrays, tableToIPC } from "apache-arrow";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi, type Mock } from "vitest";
import espace from "../../../../contracts/espaces/espace.json";
import type { Fetch } from "../spaces/api";
import { decodeSpace, type Space } from "../spaces/model";
import { cellText, durationOf, ExecutionsPage } from "./ExecutionsPage";
import { decodeExecution } from "./model";

const ID = "11111111-1111-1111-1111-111111111111";
const ROOT = "/api/spaces/finance/executions";
const ARROW = tableToIPC(tableFromArrays({ total: [12] }), "stream");
const base = {
  id: ID, space_id: "finance", environment: "DEV", connection: "source", state: "succeeded",
  created_at: "2026-11-04T00:00:00Z", started_at: "2026-11-04T00:00:01Z", finished_at: "2026-11-04T00:00:02Z",
  deadline_at: "2026-11-04T00:00:30Z", can_cancel: false, cancel_requested: false,
  error_code: null, rows: 1, size: ARROW.byteLength, truncated: true,
};
const proof = { evidence_id: "proof-1", sql_hash: "abc123", execution_status: "succeeded", model_keys: ["orders"] };
const detail = { ...base, evidence: proof, connector_run_id: null };
const running = { ...base, state: "running", finished_at: null, rows: null, size: null, truncated: null, can_cancel: true };
const FINANCE = decodeSpace(espace.body, "espace");
const reader: Space = { ...FINANCE, role: "reader" };
const admin: Space = { ...FINANCE, role: "admin" };
type Reply = { status: number; body: unknown } | Response;
function response(reply: Reply): Response { return reply instanceof Response ? reply : Response.json(reply.body, { status: reply.status }); }
function server(table: Record<string, Reply>): Mock<Fetch> {
  return vi.fn<Fetch>().mockImplementation((url, init) => {
    const found = table[`${init?.method ?? "GET"} ${url}`];
    return found === undefined ? Promise.reject(new Error(`Unexpected ${url}`)) : Promise.resolve(response(found));
  });
}
function open(space: Space, replies: Record<string, Reply>, platformAdmin = false) {
  const fetcher = server(replies);
  render(<ExecutionsPage space={space} platformAdmin={platformAdmin} fetcher={fetcher} target="DEV" />);
  return fetcher;
}
const listed = (items: unknown[] = [base]) => ({ status: 200, body: { executions: items } });

it("montre la lecture, le vide et l'accès lecteur sans portée d'administration", async () => {
  const fetcher = open(reader, { [`GET ${ROOT}?scope=mine`]: listed([]) });
  expect(screen.getByText("Lecture des exécutions…")).toHaveAttribute("aria-busy", "true");
  expect(await screen.findByText("Aucune exécution dans cette vue.")).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Portée des exécutions" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Retour au catalogue" })).toHaveAttribute("href", "#/espaces/finance/catalogue");
  await userEvent.click(screen.getByRole("button", { name: "Skifer ardoise" }));
  expect(screen.getByRole("button", { name: "Skifer ardoise" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("heading", { level: 1, name: "Exécutions" }).closest(".sb-executions")).toHaveClass("sb-theme-skifer-ardoise");
  await userEvent.click(screen.getByRole("button", { name: "Actualiser" }));
  await waitFor(() => { expect(fetcher).toHaveBeenCalledTimes(2); });
});

it("annonce directement l'indisponibilité du mode local sans appeler les exécutions", () => {
  const fetcher = open({ ...reader, implicit: true }, {});
  expect(screen.getByText("Les exécutions suivies ne sont pas disponibles en mode local.")).toBeInTheDocument();
  expect(fetcher).not.toHaveBeenCalled();
});

it("réserve la portée espace à l'administration et montre les métadonnées", async () => {
  open(admin, { [`GET ${ROOT}?scope=mine`]: listed(), [`GET ${ROOT}?scope=space`]: listed([running]), [`GET ${ROOT}/${ID}`]: { status: 200, body: running } });
  expect(await screen.findByRole("button", { name: /source · DEV/ })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Espace" }));
  expect(await screen.findByText("En cours")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /source · DEV/ }));
  expect(await screen.findByText("Détail de l'exécution")).toBeInTheDocument();
  expect(screen.getByText("Demander l'annulation")).toBeInTheDocument();
  expect(screen.queryByText("proof-1")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Les miennes" }));
  expect(screen.queryByRole("region", { name: "Détail de l'exécution" })).not.toBeInTheDocument();
});

it("l'administration sans rôle lit l'espace sans formulaire ni droit de lire les résultats", async () => {
  open({ ...admin, role: null }, { [`GET ${ROOT}?scope=space`]: listed() });
  expect(await screen.findByRole("button", { name: /source · DEV/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Les miennes" })).toBeDisabled();
  expect(screen.queryByRole("region", { name: "Lancer une exécution" })).not.toBeInTheDocument();
});

it("montre un résultat Arrow borné et la troncature, puis le referme", async () => {
  open(reader, {
    [`GET ${ROOT}?scope=mine`]: listed(),
    [`GET ${ROOT}/${ID}`]: { status: 200, body: detail },
    [`GET ${ROOT}/${ID}/result`]: new Response(ARROW.slice().buffer, { headers: { "Content-Type": "application/vnd.apache.arrow.stream" } }),
  });
  await userEvent.click(await screen.findByRole("button", { name: /source · DEV/ }));
  const card = await screen.findByRole("region", { name: "Détail de l'exécution" });
  expect(card).toHaveTextContent("tronqué");
  expect(card).toHaveTextContent("proof-1");
  expect(card).not.toHaveTextContent("SELECT");
  await userEvent.click(within(card).getByRole("button", { name: "Aperçu du résultat" }));
  const preview = await screen.findByRole("region", { name: "Aperçu du résultat" });
  expect(within(preview).getByRole("columnheader", { name: "total" })).toBeInTheDocument();
  expect(within(preview).getByRole("cell", { name: "12" })).toBeInTheDocument();
  await userEvent.click(within(card).getByRole("button", { name: "Aperçu du résultat" }));
  expect(screen.queryByRole("region", { name: "Aperçu du résultat" })).not.toBeInTheDocument();
});

it("montre un résultat vide sans annoncer de troncature", async () => {
  const bytes = tableToIPC(tableFromArrays({ total: [] }), "stream");
  const empty = { ...base, rows: 0, size: bytes.byteLength, truncated: false };
  open(reader, {
    [`GET ${ROOT}?scope=mine`]: listed([empty]),
    [`GET ${ROOT}/${ID}`]: { status: 200, body: { ...empty, evidence: proof, connector_run_id: null } },
    [`GET ${ROOT}/${ID}/result`]: new Response(bytes.slice().buffer, { headers: { "Content-Type": "application/vnd.apache.arrow.stream" } }),
  });
  await userEvent.click(await screen.findByRole("button", { name: /source · DEV/ }));
  const card = await screen.findByRole("region", { name: "Détail de l'exécution" });
  expect(card).not.toHaveTextContent("tronqué");
  await userEvent.click(within(card).getByRole("button", { name: "Aperçu du résultat" }));
  expect(await screen.findByText("Aucune ligne dans ce résultat.")).toBeInTheDocument();
});

it("affiche un refus du résultat sans exposer de ligne", async () => {
  open(reader, {
    [`GET ${ROOT}?scope=mine`]: listed(),
    [`GET ${ROOT}/${ID}`]: { status: 200, body: detail },
    [`GET ${ROOT}/${ID}/result`]: { status: 409, body: { error: { code: "result_unavailable" } } },
  });
  await userEvent.click(await screen.findByRole("button", { name: /source · DEV/ }));
  await userEvent.click(await screen.findByRole("button", { name: "Aperçu du résultat" }));
  expect(await screen.findByText(/résultat de cette exécution n'est pas disponible/)).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Aperçu du résultat" })).not.toBeInTheDocument();
});

it("valide une demande déclarative, la soumet et suit son état", async () => {
  const queued = { ...base, state: "queued", started_at: null, finished_at: null, rows: null, size: null, truncated: null };
  const fetcher = open(reader, { [`GET ${ROOT}?scope=mine`]: listed([]), [`POST ${ROOT}`]: { status: 202, body: queued }, [`GET ${ROOT}/${ID}`]: { status: 200, body: { ...queued, evidence: null, connector_run_id: null } } });
  await screen.findByText("Aucune exécution dans cette vue.");
  await userEvent.click(screen.getByRole("button", { name: "Lancer" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Vérifiez la connexion");
  await userEvent.type(screen.getByRole("textbox", { name: "Connexion" }), "source");
  await userEvent.type(screen.getByRole("textbox", { name: "Modèle sémantique" }), "orders");
  await userEvent.type(screen.getByRole("textbox", { name: /Métriques/ }), "total");
  await userEvent.type(screen.getByRole("textbox", { name: /Dimensions/ }), "region");
  await userEvent.click(screen.getByRole("button", { name: "Lancer" }));
  expect(await screen.findByText("Exécution soumise. Son état est suivi ci-dessous.")).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Détail de l'exécution" })).toHaveTextContent("En attente");
  const post = fetcher.mock.calls.find(([url, init]) => url === ROOT && init?.method === "POST");
  const body = post?.[1]?.body;
  expect(typeof body).toBe("string");
  if (typeof body === "string") expect(JSON.parse(body)).toEqual({ connection: "source", environment: "DEV", model: "orders", metrics: ["total"], dimensions: ["region"], filters: [] });
});

it("rend un refus de soumission et contrôle les noms du formulaire", async () => {
  open(reader, { [`GET ${ROOT}?scope=mine`]: listed([]), [`POST ${ROOT}`]: { status: 403, body: { error: { code: "forbidden" } } } });
  await screen.findByText("Aucune exécution dans cette vue.");
  await userEvent.type(screen.getByRole("textbox", { name: "Connexion" }), "source");
  await userEvent.type(screen.getByRole("textbox", { name: "Modèle sémantique" }), "orders");
  await userEvent.type(screen.getByRole("textbox", { name: /Métriques/ }), "total,total");
  await userEvent.click(screen.getByRole("button", { name: "Lancer" }));
  expect(screen.getByRole("alert")).toHaveTextContent("noms uniques");
  await userEvent.clear(screen.getByRole("textbox", { name: /Métriques/ }));
  await userEvent.type(screen.getByRole("textbox", { name: /Métriques/ }), "total");
  await userEvent.click(screen.getByRole("button", { name: "Lancer" }));
  expect(await screen.findByText("Votre rôle ne permet pas cette action.")).toBeInTheDocument();
});

it("rend les refus et les pannes de la liste, du détail et du résultat", async () => {
  const { unmount } = render(<ExecutionsPage space={reader} platformAdmin={false} fetcher={server({ [`GET ${ROOT}?scope=mine`]: { status: 409, body: { error: { code: "local_mode" } } } })} target="DEV" />);
  expect(await screen.findByText("Les exécutions suivies ne sont pas disponibles en mode local.")).toBeInTheDocument();
  unmount();
  const view = render(<ExecutionsPage space={reader} platformAdmin={false} fetcher={server({ [`GET ${ROOT}?scope=mine`]: { status: 403, body: { error: { code: "forbidden" } } } })} target="DEV" />);
  expect(await screen.findByText("Votre rôle ne permet pas cette action.")).toBeInTheDocument();
  view.unmount();
  const other = open(reader, { [`GET ${ROOT}?scope=mine`]: listed(), [`GET ${ROOT}/${ID}`]: { status: 502, body: {} } });
  await userEvent.click(await screen.findByRole("button", { name: /source · DEV/ }));
  expect(await screen.findByText(/Détail indisponible/)).toBeInTheDocument();
  expect(other).toHaveBeenCalled();
});

it("annule selon la capacité réelle et signale la demande encore en cours", async () => {
  const cancelled = { ...running, cancel_requested: true, can_cancel: false };
  open(reader, { [`GET ${ROOT}?scope=mine`]: listed([running]), [`GET ${ROOT}/${ID}`]: { status: 200, body: { ...running, evidence: null, connector_run_id: null } }, [`POST ${ROOT}/${ID}/cancel`]: { status: 200, body: { ...cancelled, evidence: null, connector_run_id: null } } });
  await userEvent.click(await screen.findByRole("button", { name: /source · DEV/ }));
  await userEvent.click(await screen.findByRole("button", { name: "Demander l'annulation" }));
  expect(await screen.findByText("Annulation demandée, en attente de confirmation de la source.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Demander l'annulation" })).not.toBeInTheDocument();
});

it("montre un refus d'annulation et permet de relire le détail", async () => {
  const fetcher = open(reader, {
    [`GET ${ROOT}?scope=mine`]: listed([running]),
    [`GET ${ROOT}/${ID}`]: { status: 200, body: { ...running, evidence: null, connector_run_id: null } },
    [`POST ${ROOT}/${ID}/cancel`]: { status: 409, body: { error: { code: "binding_changed" } } },
  });
  await userEvent.click(await screen.findByRole("button", { name: /source · DEV/ }));
  await userEvent.click(await screen.findByRole("button", { name: "Demander l'annulation" }));
  expect(await screen.findByText(/connexion a changé/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Actualiser le détail" }));
  await waitFor(() => { expect(fetcher.mock.calls.filter(([url]) => url === `${ROOT}/${ID}`)).toHaveLength(2); });
});

it("montre un échec terminal, la trace et un résultat refusé", async () => {
  const failed = { ...base, state: "failed", error_code: "execution_failed", rows: null, size: null, truncated: null, connector_run_id: ID, evidence: null };
  open(reader, { [`GET ${ROOT}?scope=mine`]: listed([{ ...failed, connector_run_id: undefined, evidence: undefined }]), [`GET ${ROOT}/${ID}`]: { status: 200, body: failed } });
  await userEvent.click(await screen.findByRole("button", { name: /source · DEV/ }));
  const card = await screen.findByRole("region", { name: "Détail de l'exécution" });
  expect(card).toHaveTextContent("execution_failed");
  expect(card).toHaveTextContent("Trace connecteur");
  expect(card).not.toHaveTextContent("Aperçu du résultat");
});

it("rend les durées et cellules sans chaîne d'objet implicite", () => {
  const run = decodeExecution({ ...base, size: ARROW.byteLength }, "finance");
  expect(durationOf(run)).toBe("1,0 s");
  expect(durationOf({ ...run, startedAt: null })).toBe("Pas encore démarrée");
  expect(durationOf({ ...run, finishedAt: null })).toBe("En cours");
  expect(cellText(null)).toBe("—");
  expect(cellText(undefined)).toBe("—");
  expect(cellText(new Date("2026-11-04T00:00:00Z"))).toBe("2026-11-04T00:00:00.000Z");
  expect(cellText(12)).toBe("12");
  expect(cellText(true)).toBe("true");
  expect(cellText(12n)).toBe("12");
  expect(cellText({ private: true })).toBe("Valeur complexe");
});
