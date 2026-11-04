import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { AdminOutcome } from "./admin";
import type { Fetch } from "./api";
import { DatabricksOAuthPanel, leaveForDatabricks } from "./DatabricksOAuthPanel";

const HOST = "https://adb-123.2.azuredatabricks.net";
const OTHER = "https://adb-999.2.azuredatabricks.net";
const ROOT = "/api/spaces/finance/databricks-oauth";
const EXPIRES = "2026-11-04T12:00:00+00:00";
const WAREHOUSE = { id: "wh1", name: "Warehouse 1", state: "RUNNING" };
const STATUS = { configured: true, redirect_uri: "http://localhost:5174/auth/databricks/callback", connections: [] as { host: string; expires_at: string }[] };
const CONNECTED = { ...STATUS, connections: [{ host: HOST, expires_at: EXPIRES }] };
const DISCOVERY = { host: HOST, expires_at: EXPIRES, warehouses: [WAREHOUSE] };
const reply = (value: unknown, status = 200) => status === 204 ? new Response(null, { status }) : Response.json(value, { status });
type Answers = Record<string, unknown>;
const source = (answers: Answers): Mock<Fetch> => vi.fn<Fetch>().mockImplementation((url, init) => {
  const key = `${init?.method ?? "GET"} ${url}`;
  const found = answers[key];
  return typeof found === "function" ? (found as () => Promise<Response>)() : Promise.resolve(reply(found));
});
const write = async <T,>(run: () => Promise<AdminOutcome<T>>): Promise<boolean> => (await run()).status === "ok";
const open = async (fetcher: Fetch, options: { busy?: boolean; onWrite?: typeof write; leave?: (url: string) => void } = {}) => {
  render(<DatabricksOAuthPanel space="finance" fetcher={fetcher} busy={options.busy ?? false} onWrite={options.onWrite ?? write} leave={options.leave ?? vi.fn()} />);
  const button = screen.getByRole("button", { name: "Se connecter à Databricks" });
  if (button.getAttribute("aria-expanded") === "false") await userEvent.click(button);
};

beforeEach(() => { window.history.replaceState({}, "", "/"); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("connexion personnelle Databricks", () => {
  it("navigue vers Databricks avec la navigation du navigateur", () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });
    leaveForDatabricks(HOST);
    expect(assign).toHaveBeenCalledWith(HOST);
  });

  it.each([STATUS.redirect_uri, null])("explique la configuration requise et affiche le callback %s", async (redirect) => {
    const fetcher = source({ [`GET ${ROOT}`]: { configured: false, redirect_uri: redirect, connections: [] } });
    await open(fetcher);
    expect(await screen.findByText(/Configuration OAuth requise/)).toBeInTheDocument();
    expect(screen.queryByText(STATUS.redirect_uri) !== null).toBe(redirect !== null);
    await userEvent.click(screen.getByRole("button", { name: "Actualiser la connexion OAuth" }));
    await waitFor(() => { expect(fetcher).toHaveBeenCalledTimes(2); });
    await userEvent.click(screen.getByRole("button", { name: "Se connecter à Databricks" }));
    expect(screen.queryByText(/Configuration OAuth requise/)).not.toBeInTheDocument();
  });

  it.each([false, true])("affiche l'échec de lecture, même avec une écriture en cours : %s", async (busy) => {
    await open(source({ [`GET ${ROOT}`]: () => Promise.resolve(reply({ error: { code: "forbidden" } }, 403)) }), { busy });
    expect(await screen.findByText("Votre rôle ne permet pas cette action.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actualiser la connexion OAuth" })).toHaveProperty("disabled", busy);
  });

  it("valide l'URL, normalise le slash final et ouvre l'autorisation du bon workspace", async () => {
    let resolve!: (value: Response) => void;
    const fetcher = source({ [`GET ${ROOT}`]: STATUS, [`POST ${ROOT}/start`]: () => new Promise<Response>((done) => { resolve = done; }) });
    const leave = vi.fn();
    await open(fetcher, { leave });
    const field = await screen.findByLabelText("URL du workspace Databricks");
    await userEvent.click(screen.getByRole("button", { name: "Continuer vers Databricks" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Indiquez l'URL HTTPS");
    await userEvent.type(field, HOST + "/");
    await userEvent.click(screen.getByRole("button", { name: "Continuer vers Databricks" }));
    expect(screen.getByRole("button", { name: "Ouverture de Databricks…" })).toBeDisabled();
    const url = `${HOST}/oidc/v1/authorize?state=s`;
    await act(async () => { resolve(reply({ authorization_url: url })); await Promise.resolve(); });
    expect(leave).toHaveBeenCalledWith(url);
    expect(field).toHaveValue(HOST);
  });

  it("affiche le refus d'ouverture OAuth", async () => {
    await open(source({ [`GET ${ROOT}`]: STATUS, [`POST ${ROOT}/start`]: () => Promise.resolve(reply({ error: { code: "oauth_not_configured" } }, 503)) }));
    await userEvent.type(await screen.findByLabelText("URL du workspace Databricks"), HOST);
    await userEvent.click(screen.getByRole("button", { name: "Continuer vers Databricks" }));
    expect(await screen.findByText(/L’application OAuth Board n’est pas encore configurée/)).toBeInTheDocument();
  });

  it("reprend le retour OAuth, remplit le seul warehouse, teste et enregistre", async () => {
    window.history.replaceState({}, "", `/?databricks_oauth=connected&databricks_workspace=${encodeURIComponent(HOST)}`);
    let resolve!: (value: Response) => void;
    const fetcher = source({
      [`GET ${ROOT}`]: CONNECTED,
      [`POST ${ROOT}/warehouses`]: DISCOVERY,
      [`POST ${ROOT}/test`]: () => new Promise<Response>((done) => { resolve = done; }),
      [`POST ${ROOT}/select`]: { host: HOST, warehouse_id: "wh1", key: "ma_connexion-test" },
    });
    await open(fetcher);
    expect(await screen.findByLabelText("ID du warehouse détecté")).toHaveValue("wh1");
    expect(screen.getByLabelText("Clé du point d'accès OAuth")).toHaveValue("databricks_wh1");
    expect(screen.getByText(/Connexion personnelle Databricks établie/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tester avec ma connexion OAuth" }));
    expect(screen.getByText("Essai de la connexion en cours…")).toBeInTheDocument();
    await act(async () => { resolve(reply({ identity: "person", credential_expires_at: EXPIRES, can_cancel: true, state: "RUNNING" })); await Promise.resolve(); });
    expect(await screen.findByText(/Essai réussi pour l'identité person/)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Clé du point d'accès OAuth"));
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer ce warehouse" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choisissez un warehouse et une clé");
    await userEvent.type(screen.getByLabelText("Clé du point d'accès OAuth"), "ma_connexion-test");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer ce warehouse" }));
    await waitFor(() => { expect(fetcher).toHaveBeenCalledWith(`${ROOT}/select`, expect.objectContaining({ method: "POST", body: JSON.stringify({ host: HOST, warehouse_id: "wh1", key: "ma_connexion-test" }) })); });
    await userEvent.click(screen.getByRole("button", { name: "Charger les warehouses" }));
    expect(await screen.findByLabelText("ID du warehouse détecté")).toHaveValue("wh1");
    await userEvent.clear(screen.getByLabelText("URL du workspace Databricks"));
    expect(screen.queryByLabelText("ID du warehouse détecté")).not.toBeInTheDocument();
  });

  it("demande le choix entre plusieurs warehouses et conserve les noms", async () => {
    window.history.replaceState({}, "", "/?databricks_oauth=oauth_refused&databricks_workspace=invalid");
    await open(source({ [`GET ${ROOT}`]: CONNECTED, [`POST ${ROOT}/warehouses`]: { ...DISCOVERY, warehouses: [WAREHOUSE, { ...WAREHOUSE, id: "wh2", name: "Warehouse 2" }] } }));
    expect(await screen.findByLabelText("Warehouse accessible")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Tester avec ma connexion OAuth" })).toBeDisabled();
    expect(screen.getByText(/Databricks a refusé l’autorisation/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Clé du point d'accès OAuth"), "ma_cle");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer ce warehouse" }));
    expect(screen.getByText(/Choisissez un warehouse et une clé/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Warehouse accessible"), "wh2");
    expect(screen.getByLabelText("ID du warehouse détecté")).toHaveValue("wh2");
    expect(screen.getByLabelText("Clé du point d'accès OAuth")).toHaveValue("databricks_wh2");
  });

  it.each(["empty", "refused", "error"])("explique une découverte %s", async (kind) => {
    const value = kind === "empty" ? { ...DISCOVERY, warehouses: [] } : kind === "refused" ? { error: { code: "oauth_reconnect" } } : { malformed: true };
    await open(source({ [`GET ${ROOT}`]: CONNECTED, [`POST ${ROOT}/warehouses`]: () => Promise.resolve(reply(value, kind === "refused" ? 409 : 200)) }));
    const pattern = kind === "empty" ? /Aucun warehouse accessible/ : kind === "refused" ? /Votre connexion personnelle Databricks a expiré/ : /Warehouses indisponibles/;
    expect(await screen.findByText(pattern)).toBeInTheDocument();
  });

  it.each([true, false])("déconnecte uniquement après succès de l'écriture : %s", async (ok) => {
    let disconnected = false;
    const fetcher = source({
      [`GET ${ROOT}`]: () => Promise.resolve(reply(disconnected ? STATUS : CONNECTED)),
      [`POST ${ROOT}/warehouses`]: DISCOVERY,
      [`DELETE ${ROOT}`]: () => { disconnected = ok; return Promise.resolve(reply(null, 204)); },
    });
    const onWrite = async <T,>(run: () => Promise<AdminOutcome<T>>) => { await run(); return ok; };
    await open(fetcher, { onWrite });
    await screen.findByLabelText("Warehouse accessible");
    await userEvent.click(screen.getByRole("button", { name: "Déconnecter mon compte Databricks de ce workspace" }));
    await waitFor(() => { expect(fetcher).toHaveBeenCalledWith(ROOT, expect.objectContaining({ method: "DELETE" })); });
    if (ok) await waitFor(() => { expect(screen.queryByRole("button", { name: "Déconnecter mon compte Databricks de ce workspace" })).not.toBeInTheDocument(); });
    else expect(screen.getByRole("button", { name: "Déconnecter mon compte Databricks de ce workspace" })).toBeEnabled();
  });

  it("laisse choisir un workspace déjà connecté et ignore un résultat de callback inconnu", async () => {
    window.history.replaceState({}, "", "/?databricks_oauth=unknown");
    const fetcher = source({ [`GET ${ROOT}`]: { ...CONNECTED, connections: [...CONNECTED.connections, { host: OTHER, expires_at: EXPIRES }] }, [`POST ${ROOT}/warehouses`]: { ...DISCOVERY, host: OTHER } });
    await open(fetcher);
    expect(await screen.findByLabelText("URL du workspace Databricks")).toHaveValue("");
    await userEvent.click(screen.getByRole("button", { name: `Utiliser ${OTHER}` }));
    expect(await screen.findByLabelText("Warehouse accessible")).toHaveValue("wh1");
    expect(screen.getByLabelText("URL du workspace Databricks")).toHaveValue(OTHER);
  });
});
