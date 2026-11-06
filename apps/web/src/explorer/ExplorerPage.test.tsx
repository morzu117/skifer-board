import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import { expect, it, vi } from "vitest";
import exemple from "../../../../contracts/executions/contextuel-detail.json";
import champs from "../../../../contracts/executions/champs.json";
import connexions from "../../../../contracts/executions/explorer-connexions.json";
import espace from "../../../../contracts/espaces/espace.json";
import { decodeSpace } from "../spaces/model";
import type { Fetch } from "../spaces/api";
import { onSessionLost } from "../identity/session";
import { expectAccessible } from "../test/a11y";
import { ExplorerPage } from "./ExplorerPage";

const space = decodeSpace(espace.body, "espace");
const root = "/api/spaces/finance";
const id = "11111111-1111-1111-1111-111111111111";
const bytes = tableToIPC(tableFromArrays({ revenue: [12] }), "stream");
const running = { id, space_id: "finance", environment: "DEV", connection: "source", state: "running", created_at: "2026-11-04T00:00:00Z", started_at: "2026-11-04T00:00:01Z", finished_at: null, deadline_at: "2026-11-04T00:01:00Z", can_cancel: true, cancel_requested: false, error_code: null, rows: null, size: null, truncated: null };
const success = { ...running, state: "succeeded", finished_at: "2026-11-04T00:00:02Z", can_cancel: false, rows: 1, size: bytes.byteLength, truncated: false, evidence: { ...exemple.body.evidence, evidence_id: "preuve", sql_hash: "sha256:v1:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", execution_status: "succeeded", model_keys: ["orders"] }, connector_run_id: null, result_contract: null };
const fields = { models: [{ ...champs.body.models[0], dimensions: [...(champs.body.models[0]?.dimensions ?? []), { name: "prix", label: "Prix", description: "Prix unitaire", type: "number", is_time: false }, { name: "actif", label: "Actif", description: "Actif", type: "boolean", is_time: false }] }] };
function server(overrides: Record<string, Response> = {}) {
  return vi.fn<Fetch>().mockImplementation((url, init) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    const routes: Record<string, Response> = {
      [`GET ${root}/explorer/connections`]: Response.json(connexions.body),
      [`GET ${root}/explorer/fields`]: Response.json(fields),
      [`POST ${root}/executions`]: Response.json(running),
      [`POST ${root}/executions/${id}/cancel`]: Response.json({ ...running, can_cancel: false, cancel_requested: true }),
      [`GET ${root}/executions/${id}`]: Response.json(success),
      [`GET ${root}/executions/${id}/result`]: new Response(bytes.slice().buffer, { headers: { "content-type": "application/vnd.apache.arrow.stream" } }),
      ...overrides,
    };
    return Promise.resolve((routes[key] ?? Response.json({}, { status: 500 })).clone());
  });
}
function ouvrir(fetcher: Fetch = server()) { return render(<ExplorerPage space={space} target="DEV" fetcher={fetcher} />); }

it("compose, valide et soumet la requête typée puis suit le résultat", async () => {
  const fetcher = server(); const { container } = ouvrir(fetcher);
  expect(screen.getByText(/Chargement des champs/)).toBeInTheDocument();
  await screen.findByText(/Filtre temporel indisponible/);
  await expectAccessible(container);
  await userEvent.click(screen.getByRole("button", { name: "Skifer ardoise" }));
  await expectAccessible(container);
  await userEvent.click(screen.getByRole("button", { name: "Exécuter" }));
  expect(screen.getByRole("alert")).toHaveTextContent("au moins une métrique");
  await userEvent.click(screen.getByRole("checkbox", { name: /Chiffre d'affaires/ }));
  await userEvent.click(screen.getByRole("checkbox", { name: /Jour/ }));
  await userEvent.selectOptions(screen.getByLabelText("Dimension du filtre"), "prix");
  await userEvent.selectOptions(screen.getByLabelText("Opérateur"), "between");
  await userEvent.type(screen.getByLabelText("Valeur"), "2");
  await userEvent.type(screen.getByLabelText("Borne supérieure"), "4");
  await userEvent.click(screen.getByRole("button", { name: "Ajouter le filtre" }));
  await userEvent.click(screen.getByRole("button", { name: "Exécuter" }));
  await waitFor(() => { expect(fetcher).toHaveBeenCalledWith(`${root}/executions`, expect.objectContaining({ method: "POST", body: JSON.stringify({ connection: "source", environment: "DEV", model: "orders", metrics: ["revenue"], dimensions: ["jour"], filters: [{ column: "prix", operator: "between", value: [2, 4] }] }) })); });
  await userEvent.click(await screen.findByRole("tab", { name: "Tableau" }, { timeout: 3000 }));
  expect(screen.queryByRole("button", { name: "Annuler l'exécution" })).not.toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "12" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Réinitialiser" }));
  expect(screen.queryByRole("region", { name: "Résultat" })).not.toBeInTheDocument();
});

it("annule une exécution et retire les champs et filtres au clavier", async () => {
  ouvrir(); await screen.findByLabelText(/Chiffre d'affaires/);
  await userEvent.click(screen.getByRole("checkbox", { name: /Chiffre d'affaires/ }));
  await userEvent.click(screen.getByRole("checkbox", { name: /Jour/ }));
  await userEvent.click(screen.getByRole("button", { name: "Retirer Jour" }));
  await userEvent.selectOptions(screen.getByLabelText("Dimension du filtre"), "prix");
  await userEvent.selectOptions(screen.getByLabelText("Opérateur"), "in");
  await userEvent.type(screen.getByLabelText(/Valeur/), "2, 3");
  await userEvent.click(screen.getByRole("button", { name: "Ajouter le filtre" }));
  await userEvent.click(screen.getByRole("button", { name: "Retirer le filtre prix" }));
  await userEvent.click(screen.getByRole("button", { name: "Exécuter" }));
  await userEvent.click(await screen.findByRole("button", { name: "Annuler l'exécution" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Annuler l'exécution" })).not.toBeInTheDocument());
  expect(screen.getByText(/Annulation demandée/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Retirer Chiffre d'affaires" }));
});

it("affiche le vide et les refus", async () => {
  const { unmount } = ouvrir(server({ [`GET ${root}/explorer/connections`]: Response.json({ connections: [] }) }));
  expect(await screen.findByText("Aucune connexion dans cet espace.")).toBeInTheDocument(); unmount();
  ouvrir(server({ [`GET ${root}/explorer/fields`]: Response.json({ error: { code: "engine_unavailable" } }, { status: 503 }) }));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
});

it("efface la requête lorsque l'environnement change", async () => {
  const fetcher = server();
  const { rerender } = ouvrir(fetcher);
  await userEvent.click(await screen.findByRole("checkbox", { name: /Chiffre d'affaires/ }));
  expect(screen.getByRole("button", { name: "Retirer Chiffre d'affaires" })).toBeInTheDocument();
  rerender(<ExplorerPage space={space} target="PROD" fetcher={fetcher} />);
  expect(screen.queryByRole("button", { name: "Retirer Chiffre d'affaires" })).not.toBeInTheDocument();
  expect(screen.getByText(/Environnement : PROD/)).toBeInTheDocument();
});

it("valide les filtres et permet de rechercher un champ", async () => {
  ouvrir(); await screen.findByText(/Filtre temporel indisponible/);
  await userEvent.type(screen.getByLabelText("Rechercher un champ"), "Prix");
  expect(screen.queryByRole("checkbox", { name: /Jour/ })).not.toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText("Rechercher un champ"));
  await userEvent.selectOptions(screen.getByLabelText("Dimension du filtre"), "prix");
  await userEvent.click(screen.getByRole("button", { name: "Ajouter le filtre" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Vérifiez la valeur");
  await userEvent.selectOptions(screen.getByLabelText("Dimension du filtre"), "actif");
  await userEvent.click(screen.getByRole("button", { name: "Ajouter le filtre" }));
  expect(screen.getByRole("alert")).toHaveTextContent("booléenne");
  await userEvent.selectOptions(screen.getByLabelText("Valeur"), "true");
  await userEvent.click(screen.getByRole("button", { name: "Ajouter le filtre" }));
  expect(screen.getByText(/actif eq true/)).toBeInTheDocument();
});

it.each([
  ["connexions", `${root}/explorer/connections`, { error: { code: "forbidden" } }, 403],
  ["mode local", `${root}/explorer/connections`, { error: { code: "local_mode" } }, 403],
  ["catalogue vide", `${root}/explorer/fields`, { models: [] }, 200],
  ["mode local champs", `${root}/explorer/fields`, { error: { code: "local_mode" } }, 403],
])("affiche l'état %s", async (_nom, url, body, status) => {
  const { container } = ouvrir(server({ [`GET ${url}`]: Response.json(body, { status }) }));
  await waitFor(() => { expect(screen.queryByText(/Chargement des champs/)).not.toBeInTheDocument(); });
  expect(screen.queryByRole("button", { name: "Exécuter" })).not.toBeInTheDocument();
  await expectAccessible(container);
  await userEvent.click(screen.getByRole("button", { name: "Skifer ardoise" }));
  await expectAccessible(container);
});

it("change de connexion et de modèle et réinitialise les champs", async () => {
  const autres = { models: [fields.models[0], { ...fields.models[0], name: "autre", label: "Autre", metrics: [{ name: "m", label: "Mesure", description: "", aggregation: null, additivity: "non_additive" }] }] };
  ouvrir(server({ [`GET ${root}/explorer/connections`]: Response.json({ connections: ["source", "autre"] }), [`GET ${root}/explorer/fields`]: Response.json(autres) }));
  await userEvent.click(await screen.findByRole("checkbox", { name: /Chiffre d'affaires/ }));
  await userEvent.selectOptions(screen.getByLabelText("Connexion"), "autre");
  await userEvent.selectOptions(screen.getByLabelText("Modèle"), "autre");
  expect(screen.getByText(/type inconnu/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Retirer Chiffre d'affaires" })).not.toBeInTheDocument();
});

it("affiche le refus de soumission et d'annulation", async () => {
  const refusal = () => Response.json({ error: { code: "forbidden" } }, { status: 403 });
  const { unmount } = ouvrir(server({ [`POST ${root}/executions`]: refusal() }));
  await userEvent.click(await screen.findByRole("checkbox", { name: /Chiffre d'affaires/ }));
  await userEvent.click(screen.getByRole("button", { name: "Exécuter" }));
  expect(await screen.findByText(/Exécution indisponible : Votre rôle/)).toBeInTheDocument(); unmount();
  ouvrir(server({ [`POST ${root}/executions/${id}/cancel`]: refusal() }));
  await userEvent.click(await screen.findByRole("checkbox", { name: /Chiffre d'affaires/ }));
  await userEvent.click(screen.getByRole("button", { name: "Exécuter" }));
  await waitFor(() => { expect(screen.getByRole("button", { name: "Annuler l'exécution" })).toBeEnabled(); });
  await userEvent.click(screen.getByRole("button", { name: "Annuler l'exécution" }));
  expect(await screen.findByText(/Exécution indisponible : Votre rôle/)).toBeInTheDocument();
});

it.each(["suivi", "résultat"])("affiche l'erreur de %s", async (etape) => {
  const path = etape === "suivi" ? `${root}/executions/${id}` : `${root}/executions/${id}/result`;
  ouvrir(server({ [`GET ${path}`]: Response.json({ error: { code: "forbidden" } }, { status: 403 }) }));
  await userEvent.click(await screen.findByRole("checkbox", { name: /Chiffre d'affaires/ }));
  await userEvent.click(screen.getByRole("button", { name: "Exécuter" }));
  expect(await screen.findByText(etape === "suivi" ? /Suivi interrompu : Votre rôle/ : /Exécution indisponible : Votre rôle/, {}, { timeout: 3000 })).toBeInTheDocument();
});

it("écarte la soumission tardive après réinitialisation", async () => {
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>((done) => { resolve = done; });
  const base = server();
  const fetcher = vi.fn<Fetch>().mockImplementation((url, init) => url === `${root}/executions` && init?.method === "POST" ? pending : base(url, init));
  ouvrir(fetcher);
  await userEvent.click(await screen.findByRole("checkbox", { name: /Chiffre d'affaires/ }));
  await userEvent.click(screen.getByRole("button", { name: "Exécuter" }));
  await userEvent.click(screen.getByRole("button", { name: "Réinitialiser" }));
  const reponse = Response.json(running); const lecture = vi.spyOn(reponse, "json");
  await act(async () => { resolve(reponse); await waitFor(() => { expect(lecture).toHaveBeenCalled(); }); });
  expect(screen.getByRole("button", { name: "Exécuter" })).toBeEnabled();
  expect(screen.queryByText(/Chargement du résultat|Annulation demandée|Exécution indisponible/)).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("écarte l'annulation tardive après réinitialisation", async () => {
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>((done) => { resolve = done; });
  const base = server();
  const fetcher = vi.fn<Fetch>().mockImplementation((url, init) => url === `${root}/executions/${id}/cancel` ? pending : base(url, init));
  ouvrir(fetcher);
  await userEvent.click(await screen.findByRole("checkbox", { name: /Chiffre d'affaires/ }));
  await userEvent.click(screen.getByRole("button", { name: "Exécuter" }));
  await waitFor(() => { expect(screen.getByRole("button", { name: "Annuler l'exécution" })).toBeEnabled(); });
  await userEvent.click(screen.getByRole("button", { name: "Annuler l'exécution" }));
  await userEvent.click(screen.getByRole("button", { name: "Réinitialiser" }));
  const reponse = Response.json({ ...running, can_cancel: false, cancel_requested: true }); const lecture = vi.spyOn(reponse, "json");
  await act(async () => { resolve(reponse); await waitFor(() => { expect(lecture).toHaveBeenCalled(); }); });
  expect(screen.getByRole("button", { name: "Exécuter" })).toBeEnabled();
  expect(screen.queryByText(/Chargement du résultat|Annulation demandée|Exécution indisponible/)).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("écarte le suivi tardif après réinitialisation", async () => {
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>((done) => { resolve = done; });
  const base = server();
  const fetcher = vi.fn<Fetch>().mockImplementation((url, init) => url === `${root}/executions/${id}` ? pending : base(url, init));
  ouvrir(fetcher);
  await userEvent.click(await screen.findByRole("checkbox", { name: /Chiffre d'affaires/ }));
  await userEvent.click(screen.getByRole("button", { name: "Exécuter" }));
  await waitFor(() => { expect(fetcher.mock.calls.some(([url]) => url === `${root}/executions/${id}`)).toBe(true); }, { timeout: 3000 });
  await userEvent.click(screen.getByRole("button", { name: "Réinitialiser" }));
  const reponse = Response.json({ ...running, evidence: null, connector_run_id: null }); const lecture = vi.spyOn(reponse, "json");
  await act(async () => { resolve(reponse); await waitFor(() => { expect(lecture).toHaveBeenCalled(); }); });
  expect(screen.getByRole("button", { name: "Exécuter" })).toBeEnabled();
  expect(screen.queryByText(/Chargement du résultat|Annulation demandée|Exécution indisponible/)).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("affiche la raison d'une exécution refusée", async () => {
  const denied = { ...running, state: "denied", finished_at: "2026-11-04T00:00:02Z", can_cancel: false, error_code: "deny", evidence: null, connector_run_id: null };
  ouvrir(server({ [`GET ${root}/executions/${id}`]: Response.json(denied) }));
  await userEvent.click(await screen.findByRole("checkbox", { name: /Chiffre d'affaires/ }));
  await userEvent.click(screen.getByRole("button", { name: "Exécuter" }));
  expect(await screen.findByText(/DENY · accès refusé/, {}, { timeout: 3000 })).toBeInTheDocument();
});

it("valide un filtre texte et un modèle sans métrique", async () => {
  const modele = { ...fields.models[0], metrics: [], dimensions: [{ name: "ville", label: "Ville", description: "", type: "string", is_time: false }] };
  ouvrir(server({ [`GET ${root}/explorer/fields`]: Response.json({ models: [modele] }) }));
  await userEvent.selectOptions(await screen.findByLabelText("Dimension du filtre"), "ville");
  await userEvent.type(screen.getByLabelText("Valeur"), "Paris");
  await userEvent.click(screen.getByRole("button", { name: "Ajouter le filtre" }));
  expect(screen.getByRole("alert")).toBeInTheDocument();
});

it.each(["annulation", "suivi", "résultat"])("ignore une réponse de %s après réinitialisation", async (etape) => {
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>((done) => { resolve = done; });
  const base = server();
  const path = etape === "annulation" ? `${root}/executions/${id}/cancel` : etape === "suivi" ? `${root}/executions/${id}` : `${root}/executions/${id}/result`;
  const fetcher = vi.fn<Fetch>().mockImplementation((url, init) => url === path ? pending : base(url, init));
  ouvrir(fetcher);
  await userEvent.click(await screen.findByRole("checkbox", { name: /Chiffre d'affaires/ }));
  await userEvent.click(screen.getByRole("button", { name: "Exécuter" }));
  if (etape === "annulation") {
    await waitFor(() => { expect(screen.getByRole("button", { name: "Annuler l'exécution" })).toBeEnabled(); });
    await userEvent.click(screen.getByRole("button", { name: "Annuler l'exécution" }));
  } else {
    await waitFor(() => { expect(fetcher.mock.calls.some(([url]) => url === path)).toBe(true); }, { timeout: 3000 });
  }
  await userEvent.click(screen.getByRole("button", { name: "Réinitialiser" }));
  resolve(Response.json({ error: { code: "forbidden" } }, { status: 403 }));
  await waitFor(() => { expect(screen.getByRole("button", { name: "Exécuter" })).toBeEnabled(); });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it.each(["suivi", "résultat"])("accepte l'abandon de la lecture du %s", async (etape) => {
  const base = server();
  const path = etape === "suivi" ? `${root}/executions/${id}` : `${root}/executions/${id}/result`;
  const fetcher = vi.fn<Fetch>().mockImplementation((url, init) => {
    if (url !== path) return base(url, init);
    return new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener("abort", () => { reject(new Error("abandonné")); }); });
  });
  ouvrir(fetcher);
  await userEvent.click(await screen.findByRole("checkbox", { name: /Chiffre d'affaires/ }));
  await userEvent.click(screen.getByRole("button", { name: "Exécuter" }));
  await waitFor(() => { expect(fetcher.mock.calls.some(([url]) => url === path)).toBe(true); }, { timeout: 3000 });
  await userEvent.click(screen.getByRole("button", { name: "Réinitialiser" }));
});


it("signale la perte de session pendant la lecture des champs", async () => {
  const lost = vi.fn();
  const unsubscribe = onSessionLost(lost);
  ouvrir(server({ [`GET ${root}/explorer/fields`]: new Response(null, { status: 401 }) }));
  await waitFor(() => { expect(lost).toHaveBeenCalled(); });
  expect(await screen.findByRole("alert")).toHaveTextContent("Session expirée");
  unsubscribe();
});

it("efface la requête lors du changement d'espace", async () => {
  const fetcher = server();
  const { rerender } = ouvrir(fetcher);
  await userEvent.click(await screen.findByRole("checkbox", { name: /Chiffre d'affaires/ }));
  rerender(<ExplorerPage space={{ ...space, id: "autre" }} target="DEV" fetcher={fetcher} />);
  expect(screen.queryByRole("button", { name: "Retirer Chiffre d'affaires" })).not.toBeInTheDocument();
  expect(await screen.findByRole("alert")).toBeInTheDocument();
});


it.each(["environnement", "espace"])("efface le résultat affiché au changement de %s", async (contexte) => {
  const fetcher = server();
  const { rerender } = ouvrir(fetcher);
  await userEvent.click(await screen.findByRole("checkbox", { name: /Chiffre d'affaires/ }));
  await userEvent.click(screen.getByRole("button", { name: "Exécuter" }));
  expect(await screen.findByRole("tab", { name: "Tableau" }, { timeout: 3000 })).toBeInTheDocument();
  rerender(<ExplorerPage space={contexte === "espace" ? { ...space, id: "autre" } : space} target={contexte === "environnement" ? "PROD" : "DEV"} fetcher={fetcher} />);
  expect(screen.queryByRole("tab", { name: "Tableau" })).not.toBeInTheDocument();
  expect(screen.queryByText("preuve")).not.toBeInTheDocument();
});

it("Entrée dans la recherche ou les bornes n'exécute pas et ajoute seulement le filtre", async () => {
  const fetcher = server(); const { container } = ouvrir(fetcher);
  await userEvent.click(await screen.findByRole("checkbox", { name: /Chiffre d'affaires/ }));
  fireEvent.submit(container.querySelector("form") as HTMLFormElement);
  const recherche = screen.getByLabelText("Rechercher un champ");
  await userEvent.type(recherche, "jour{Enter}");
  expect(fetcher.mock.calls.filter(([url, init]) => url === `${root}/executions` && init?.method === "POST")).toHaveLength(0);
  await userEvent.clear(recherche);
  await userEvent.selectOptions(screen.getByLabelText("Dimension du filtre"), "prix");
  await userEvent.selectOptions(screen.getByLabelText("Opérateur"), "between");
  await userEvent.type(screen.getByLabelText("Borne supérieure"), "4");
  await userEvent.type(screen.getByLabelText("Valeur"), "2{Enter}");
  expect(screen.getByText(/prix between 2,4/)).toBeInTheDocument();
  expect(fetcher.mock.calls.filter(([url, init]) => url === `${root}/executions` && init?.method === "POST")).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "Retirer le filtre prix" }));
  await userEvent.type(screen.getByLabelText("Borne supérieure"), "{Enter}");
  expect(screen.getByText(/prix between 2,4/)).toBeInTheDocument();
  expect(fetcher.mock.calls.filter(([url, init]) => url === `${root}/executions` && init?.method === "POST")).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "Exécuter" }));
  await waitFor(() => { expect(fetcher.mock.calls.filter(([url, init]) => url === `${root}/executions` && init?.method === "POST")).toHaveLength(1); });
});

it("propose de reprendre un suivi interrompu sans présumer de l'état réel", async () => {
  const base = server();
  let lectures = 0;
  const fetcher = vi.fn<Fetch>().mockImplementation((url, init) => {
    if (url === `${root}/executions/${id}` && ++lectures === 1) return Promise.resolve(Response.json({ error: { code: "forbidden" } }, { status: 403 }));
    return base(url, init);
  });
  ouvrir(fetcher);
  await userEvent.click(await screen.findByRole("checkbox", { name: /Chiffre d'affaires/ }));
  await userEvent.click(screen.getByRole("button", { name: "Exécuter" }));
  const interruption = await screen.findByText(/Suivi interrompu/, {}, { timeout: 3000 });
  expect(interruption).toHaveTextContent("Suivi interrompu");
  expect(interruption).toHaveTextContent("état réel de l’exécution est inconnu");
  expect(screen.getByRole("button", { name: "Exécuter" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Annuler l'exécution" })).not.toBeInTheDocument();
  expect(screen.getByText(/annulation est indisponible pendant l’interruption/)).toHaveAttribute("role", "status");
  expect(fetcher.mock.calls.some(([url, init]) => url === `${root}/executions/${id}/cancel` && init?.method === "POST")).toBe(false);
  expect(screen.queryByRole("tab", { name: "Tableau" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Reprendre le suivi" }));
  expect(screen.getByRole("button", { name: "Annuler l'exécution" })).toBeEnabled();
  expect(await screen.findByRole("tab", { name: "Tableau" }, { timeout: 3000 })).toBeInTheDocument();
});

it("explique l'indisponibilité de l'annulation et permet de réinitialiser un suivi interrompu", async () => {
  ouvrir(server({ [`POST ${root}/executions`]: Response.json({ ...running, can_cancel: false }), [`GET ${root}/executions/${id}`]: Response.json({ error: { code: "forbidden" } }, { status: 403 }) }));
  await userEvent.click(await screen.findByRole("checkbox", { name: /Chiffre d'affaires/ }));
  await userEvent.click(screen.getByRole("button", { name: "Exécuter" }));
  expect(await screen.findByText(/capacité du connecteur/)).toHaveAttribute("role", "status");
  expect(screen.queryByRole("button", { name: "Annuler l'exécution" })).not.toBeInTheDocument();
  expect(await screen.findByText(/Suivi interrompu/, {}, { timeout: 3000 })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Réinitialiser" }));
  expect(screen.queryByText(/Suivi interrompu/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Exécuter" })).toBeEnabled();
});


it("explique une panne technique du suivi", async () => {
  ouvrir(server({ [`GET ${root}/executions/${id}`]: Response.json({}, { status: 500 }) }));
  await userEvent.click(await screen.findByRole("checkbox", { name: /Chiffre d'affaires/ }));
  await userEvent.click(screen.getByRole("button", { name: "Exécuter" }));
  expect(await screen.findByText(/Suivi interrompu/, {}, { timeout: 3000 })).toHaveTextContent("état réel de l’exécution est inconnu");
});


it("utilise le nom moteur lorsque les libellés sont vides", async () => {
  const modele = champs.body.models[0];
  if (modele === undefined || modele.metrics[0] === undefined || modele.dimensions[0] === undefined) throw new Error("Champs attendus");
  const sansLibelles = { models: [{ ...modele, metrics: [{ ...modele.metrics[0], label: "" }], dimensions: [{ ...modele.dimensions[0], label: "" }] }] };
  ouvrir(server({ [`GET ${root}/explorer/fields`]: Response.json(sansLibelles) }));
  await userEvent.click(await screen.findByRole("checkbox", { name: /sum/ }));
  await userEvent.click(screen.getByRole("checkbox", { name: /date/ }));
  expect(screen.getByRole("button", { name: "Retirer revenue" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retirer jour" })).toBeInTheDocument();
});
