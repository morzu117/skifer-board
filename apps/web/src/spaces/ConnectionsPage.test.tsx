import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "vitest";

import espace from "../../../../contracts/espaces/espace.json";
import type { Fetch } from "./api";
import { CONNECTION_REMINDER, ConnectionsPage } from "./ConnectionsPage";
import { decodeSpace } from "./model";

const FINANCE = decodeSpace(espace.body, "espace");
const REF = { issuer: "https://id.example.invalid", subject: "admin" };
const AT = "2026-11-03T10:00:00+00:00";
const ROOT = "/api/spaces/finance/connections";
const ENDPOINTS = "/api/spaces/finance/connection-endpoints";
const JOURNAL = "/api/spaces/finance/events";
const BINDING = `${ROOT}/source/bindings/DEV`;
const EMPTY = (environment: string) => ({ environment, state: "unconfigured" });
const bound = (environment: string, extra: Record<string, unknown> = {}) => ({
  environment, connector: "databricks", endpoint_key: "warehouse-prod", identity_mode: "service",
  set_at: AT, set_by: REF, credential_state: "configured", ...extra,
});
const connection = (bindings: unknown[] = [bound("DEV"), EMPTY("TEST"), EMPTY("PROD")]) => ({
  name: "source", created_at: AT, created_by: REF, bindings,
});
const list = (items: unknown[] = [connection()]) => ({ connections: items });
const reply = (body: unknown, status = 200) => status === 204 ? new Response(null, { status }) : Response.json(body, { status });
type Reply = { status: number; body: unknown } | (() => Promise<Response>);
function server(extra: Record<string, Reply> = {}, body: unknown = list()): Mock<Fetch> {
  const responses: Record<string, Reply> = {
    [`GET ${ROOT}`]: { status: 200, body },
    [`GET ${ENDPOINTS}`]: { status: 200, body: { endpoints: [] } },
    [`GET ${JOURNAL}`]: { status: 200, body: { events: [] } },
    ...extra,
  };
  return vi.fn<Fetch>().mockImplementation((url, init) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    const found = responses[key];
    if (found === undefined) return Promise.reject(new Error(`Unexpected ${key}`));
    return typeof found === "function" ? found() : Promise.resolve(reply(found.body, found.status));
  });
}
const calls = (fetcher: Mock<Fetch>, method: string, url: string) => fetcher.mock.calls.filter(([found, init]) => found === url && (init?.method ?? "GET") === method);

async function open(fetcher: Mock<Fetch>, target: "DEV" | "TEST" | "PROD" = "DEV") {
  const view = render(<ConnectionsPage space={FINANCE} fetcher={fetcher} target={target} />);
  await screen.findByText("Aucun événement.");
  await waitFor(() => { expect(screen.queryByText("Lecture des connexions…")).not.toBeInTheDocument(); });
  return view;
}

describe("points d'accès Databricks dans Board", () => {
  it("valide la saisie, crée le point et efface les champs", async () => {
    const endpoint = { key: "azure-test", host: "https://adb-123.2.azuredatabricks.net", warehouse_id: "abc123" };
    const fetcher = server({ [`POST ${ENDPOINTS}`]: { status: 201, body: endpoint } });
    await open(fetcher);
    const form = await screen.findByRole("form", { name: "Ajouter un point d'accès Databricks" });
    await userEvent.click(within(form).getByRole("button", { name: "Enregistrer le point d'accès" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("Indiquez une clé");
    await userEvent.type(within(form).getByRole("textbox", { name: "Clé du point d'accès" }), "azure-test");
    await userEvent.type(within(form).getByRole("textbox", { name: "URL du workspace" }), endpoint.host);
    await userEvent.type(within(form).getByRole("textbox", { name: "ID du SQL warehouse" }), "abc123");
    expect(within(form).queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(within(form).getByRole("button", { name: "Enregistrer le point d'accès" }));
    await waitFor(() => { expect(calls(fetcher, "POST", ENDPOINTS)).toHaveLength(1); });
    expect(JSON.parse(calls(fetcher, "POST", ENDPOINTS)[0]?.[1]?.body as string)).toEqual(endpoint);
    await waitFor(() => { expect(within(form).getByRole("textbox", { name: "Clé du point d'accès" })).toHaveValue(""); });
  });

  it("affiche la liste, annule puis confirme le retrait", async () => {
    const endpoint = { key: "azure-test", host: "https://adb-123.2.azuredatabricks.net", warehouse_id: "abc123" };
    const fetcher = server({
      [`GET ${ENDPOINTS}`]: { status: 200, body: { endpoints: [endpoint] } },
      [`DELETE ${ENDPOINTS}/azure-test`]: { status: 204, body: null },
    });
    await open(fetcher);
    expect(await screen.findByText(endpoint.host)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retirer azure-test" }));
    await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(calls(fetcher, "DELETE", `${ENDPOINTS}/azure-test`)).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Retirer azure-test" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmer le retrait" }));
    await waitFor(() => { expect(calls(fetcher, "DELETE", `${ENDPOINTS}/azure-test`)).toHaveLength(1); });
  });

  it("conserve la saisie et la confirmation quand le serveur refuse", async () => {
    const endpoint = { key: "azure-test", host: "https://adb-123.2.azuredatabricks.net", warehouse_id: "abc123" };
    const fetcher = server({
      [`GET ${ENDPOINTS}`]: { status: 200, body: { endpoints: [endpoint] } },
      [`POST ${ENDPOINTS}`]: { status: 409, body: { error: { code: "endpoint_exists" } } },
      [`DELETE ${ENDPOINTS}/azure-test`]: { status: 409, body: { error: { code: "endpoint_in_use" } } },
    });
    await open(fetcher);
    const form = await screen.findByRole("form", { name: "Ajouter un point d'accès Databricks" });
    await userEvent.type(within(form).getByRole("textbox", { name: "Clé du point d'accès" }), "azure-test");
    await userEvent.type(within(form).getByRole("textbox", { name: "URL du workspace" }), endpoint.host);
    await userEvent.type(within(form).getByRole("textbox", { name: "ID du SQL warehouse" }), "abc123");
    await userEvent.click(within(form).getByRole("button", { name: "Enregistrer le point d'accès" }));
    await waitFor(() => { expect(calls(fetcher, "POST", ENDPOINTS)).toHaveLength(1); });
    expect(within(form).getByRole("textbox", { name: "Clé du point d'accès" })).toHaveValue("azure-test");
    await userEvent.click(screen.getByRole("button", { name: "Retirer azure-test" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmer le retrait" }));
    await waitFor(() => { expect(calls(fetcher, "DELETE", `${ENDPOINTS}/azure-test`)).toHaveLength(1); });
    expect(screen.getByRole("button", { name: "Confirmer le retrait" })).toBeInTheDocument();
  });

  it("annonce les états de lecture et de refus", async () => {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>((done) => { resolve = done; });
    const fetcher = server({ [`GET ${ENDPOINTS}`]: () => pending });
    render(<ConnectionsPage space={FINANCE} fetcher={fetcher} target="DEV" />);
    expect(screen.getByText("Lecture des points d'accès…")).toBeInTheDocument();
    await act(async () => { resolve(reply({ error: { code: "forbidden" } }, 403)); await pending; });
    expect(await screen.findByText("Votre rôle ne permet pas cette action.")).toBeInTheDocument();
  });
});

describe("Connexions : lecture et états", () => {
  it("annonce la lecture, puis montre trois environnements, l'état du coffre et aucune valeur secrète", async () => {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>((done) => { resolve = done; });
    const fetcher = server({ [`GET ${ROOT}`]: () => pending });
    render(<ConnectionsPage space={FINANCE} fetcher={fetcher} target="DEV" />);
    expect(screen.getByRole("heading", { level: 1, name: "Connexions" })).toBeInTheDocument();
    expect(screen.getByText(CONNECTION_REMINDER)).toBeInTheDocument();
    expect(screen.getByText("Lecture des connexions…")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("form", { name: "Créer une connexion" })).not.toBeInTheDocument();
    await act(async () => { resolve(reply(list())); await Promise.resolve(); });
    const source = screen.getByRole("region", { name: "Connexion source" });
    expect(within(source).getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent)).toEqual(["DEV", "TEST", "PROD"]);
    expect(within(source).getByText("Configuré")).toBeInTheDocument();
    expect(within(source).getAllByText("Aucune liaison configurée.")).toHaveLength(2);
    expect(source).not.toHaveTextContent("secret-sentinelle");
    expect(screen.getByRole("navigation", { name: "Administration de l'espace" })).toContainElement(screen.getByRole("link", { name: "Connexions" }));
    expect(screen.getByRole("link", { name: "Connexions" })).toHaveAttribute("aria-current", "page");
    expect(fetcher.mock.calls.filter(([, init]) => (init?.method ?? "GET") !== "GET")).toHaveLength(0);
  });

  it("dit le vide et propose la création, sans ligne fantôme", async () => {
    await open(server({}, list([])));
    expect(screen.getByText("Aucune connexion dans cet espace.")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Créer une connexion" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Connexion source/ })).not.toBeInTheDocument();
  });

  it.each([
    [{ status: 403, body: { error: { code: "forbidden" } } }, "Votre rôle ne permet pas cette action."],
    [{ status: 409, body: { error: { code: "local_mode" } } }, "En mode local, l'espace implicite ne se gère pas."],
    [{ status: 500, body: {} }, "Connexions indisponibles"],
    [{ status: 200, body: { connections: [connection([EMPTY("DEV"), EMPTY("DEV"), EMPTY("PROD")])] } }, "hors contrat"],
  ])("rend un refus ou un échec sans formulaire", async (response, message) => {
    await open(server({ [`GET ${ROOT}`]: response }));
    expect(screen.getByRole("region", { name: "Connexions logiques" })).toHaveTextContent(message);
    expect(screen.queryByRole("form", { name: "Créer une connexion" })).not.toBeInTheDocument();
  });

  it("montre les états sans identifiant serveur et l'indisponibilité du coffre", async () => {
    await open(server({}, list([connection([
      bound("DEV", { credential_state: "unavailable" }),
      bound("TEST", { identity_mode: "person", credential_state: "unconfigured" }),
      bound("PROD", { connector: "duckdb", credential_state: "unconfigured" }),
    ])])));
    expect(screen.getByText("Indisponible")).toBeInTheDocument();
    expect(screen.getAllByText("Sans identifiant serveur")).toHaveLength(2);
    expect(screen.getByText(/La fédération de l'identité personnelle/)).toBeInTheDocument();
  });

  it("dit qu'un identifiant Databricks de service reste à configurer", async () => {
    await open(server({}, list([connection([bound("DEV", { credential_state: "unconfigured" }), EMPTY("TEST"), EMPTY("PROD")])])));
    expect(screen.getByText("À configurer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Poser un identifiant" })).toBeInTheDocument();
  });
});

describe("Connexions : actions", () => {
  it("valide le nom, crée une connexion et relit la liste", async () => {
    const fetcher = server({ [`POST ${ROOT}`]: { status: 201, body: connection() } }, list([]));
    await open(fetcher);
    const form = screen.getByRole("form", { name: "Créer une connexion" });
    const input = within(form).getByRole("textbox", { name: "Nom logique" });
    await userEvent.type(input, "Bad");
    await userEvent.click(within(form).getByRole("button", { name: "Créer la connexion" }));
    expect(screen.getByText(/Un nom commence/)).toBeInTheDocument();
    expect(calls(fetcher, "POST", ROOT)).toHaveLength(0);
    await userEvent.clear(input);
    await userEvent.type(input, "source");
    await userEvent.click(within(form).getByRole("button", { name: "Créer la connexion" }));
    await screen.findByText("Connexion source créée.");
    expect(input).toHaveValue("");
    expect(JSON.parse(calls(fetcher, "POST", ROOT)[0]?.[1]?.body as string)).toEqual({ name: "source" });
    await waitFor(() => { expect(calls(fetcher, "GET", ROOT).length).toBeGreaterThan(1); });
  });

  it("garde le nom saisi quand le serveur refuse la création", async () => {
    const fetcher = server({ [`POST ${ROOT}`]: { status: 409, body: { error: { code: "connection_exists" } } }, }, list([]));
    await open(fetcher);
    const form = screen.getByRole("form", { name: "Créer une connexion" });
    const input = within(form).getByRole("textbox", { name: "Nom logique" });
    await userEvent.type(input, "source");
    await userEvent.click(within(form).getByRole("button", { name: "Créer la connexion" }));
    await screen.findByText("Une connexion porte déjà ce nom dans l'espace.");
    expect(input).toHaveValue("source");
  });

  it("explique qu'une liaison empêche le retrait de la connexion", async () => {
    const fetcher = server({ [`DELETE ${ROOT}/source`]: { status: 409, body: { error: { code: "connection_in_use" } } } });
    await open(fetcher);
    await userEvent.click(screen.getByRole("button", { name: "Retirer la connexion source" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmer le retrait" }));
    await screen.findByText("Cette connexion possède encore une liaison : retirez ses liaisons avant de la supprimer.");
  });

  it("configure une liaison, affiche le mode personne et refuse une clé invalide", async () => {
    const url = `${ROOT}/source/bindings/TEST`;
    const fetcher = server({ [`PUT ${url}`]: { status: 200, body: bound("TEST", { endpoint_key: "warehouse-test", identity_mode: "person", credential_state: "unconfigured" }) } });
    await open(fetcher, "TEST");
    const panel = screen.getByRole("region", { name: "source · TEST" });
    expect(panel).toHaveClass("sb-connection__environment--target");
    await userEvent.click(within(panel).getByRole("button", { name: "Configurer la liaison" }));
    const form = within(panel).getByRole("form", { name: "Configurer source · TEST" });
    await userEvent.selectOptions(within(form).getByRole("combobox", { name: "Connecteur" }), "databricks");
    await userEvent.selectOptions(within(form).getByRole("combobox", { name: "Mode d'identité" }), "person");
    expect(within(form).getByText(/La connexion personnelle ne pourra pas/)).toBeInTheDocument();
    const key = within(form).getByRole("textbox", { name: "Clé du point d'accès" });
    await userEvent.type(key, "bad/key");
    await userEvent.click(within(form).getByRole("button", { name: "Enregistrer la liaison" }));
    expect(within(form).getByText(/La clé commence/)).toBeInTheDocument();
    expect(calls(fetcher, "PUT", url)).toHaveLength(0);
    await userEvent.clear(key);
    await userEvent.type(key, "warehouse-test");
    await userEvent.click(within(form).getByRole("button", { name: "Enregistrer la liaison" }));
    await screen.findByText("Liaison TEST de source enregistrée.");
    expect(JSON.parse(calls(fetcher, "PUT", url)[0]?.[1]?.body as string)).toEqual({ connector: "databricks", endpoint_key: "warehouse-test", identity_mode: "person" });
  });

  it("préremplit la liaison existante et garde l'éditeur après un refus du serveur", async () => {
    const fetcher = server({ [`PUT ${BINDING}`]: { status: 409, body: { error: { code: "endpoint_not_configured" } } } });
    await open(fetcher);
    const panel = screen.getByRole("region", { name: "source · DEV" });
    await userEvent.click(within(panel).getByRole("button", { name: "Modifier la liaison" }));
    const form = within(panel).getByRole("form", { name: "Configurer source · DEV" });
    expect(within(form).getByRole("combobox", { name: "Connecteur" })).toHaveValue("databricks");
    expect(within(form).getByRole("textbox", { name: "Clé du point d'accès" })).toHaveValue("warehouse-prod");
    expect(within(form).getByRole("combobox", { name: "Mode d'identité" })).toHaveValue("service");
    await userEvent.click(within(form).getByRole("button", { name: "Enregistrer la liaison" }));
    await screen.findByText("Ce point d'accès n'est pas déclaré sur le serveur.");
    expect(within(panel).getByRole("form", { name: "Configurer source · DEV" })).toBeInTheDocument();
  });

  it("efface le champ secret dès la soumission, y compris si le serveur refuse", async () => {
    const fetcher = server({ [`PUT ${BINDING}/credential`]: { status: 409, body: { error: { code: "vault_unavailable" } } } });
    await open(fetcher);
    const panel = screen.getByRole("region", { name: "source · DEV" });
    await userEvent.click(within(panel).getByRole("button", { name: "Remplacer l'identifiant" }));
    const form = within(panel).getByRole("form", { name: "Identifiant source · DEV" });
    const input = within(form).getByLabelText<HTMLInputElement>("Nouvel identifiant");
    await userEvent.type(input, "secret-sentinelle");
    await userEvent.click(within(form).getByRole("button", { name: "Enregistrer l'identifiant" }));
    expect(input.value).toBe("");
    await screen.findByText("Le coffre des identifiants est indisponible.");
    expect(document.body.textContent).not.toContain("secret-sentinelle");
    expect(JSON.parse(calls(fetcher, "PUT", `${BINDING}/credential`)[0]?.[1]?.body as string)).toEqual({ secret: "secret-sentinelle" });
  });

  it("efface le secret et ferme le formulaire après l'écriture acceptée", async () => {
    const fetcher = server({ [`PUT ${BINDING}/credential`]: { status: 204, body: null } });
    await open(fetcher);
    const panel = screen.getByRole("region", { name: "source · DEV" });
    await userEvent.click(within(panel).getByRole("button", { name: "Remplacer l'identifiant" }));
    const form = within(panel).getByRole("form", { name: "Identifiant source · DEV" });
    await userEvent.type(within(form).getByLabelText("Nouvel identifiant"), "secret-sentinelle");
    await userEvent.click(within(form).getByRole("button", { name: "Enregistrer l'identifiant" }));
    await screen.findByText("Identifiant DEV de source enregistré.");
    expect(within(panel).queryByRole("form", { name: "Identifiant source · DEV" })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("secret-sentinelle");
  });

  it("essaie la liaison sans SQL, puis annonce identité, état, expiration et annulation", async () => {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>((done) => { resolve = done; });
    const fetcher = server({ [`POST ${BINDING}/test`]: () => pending });
    await open(fetcher);
    const panel = screen.getByRole("region", { name: "source · DEV" });
    await userEvent.click(within(panel).getByRole("button", { name: "Tester la connexion" }));
    expect(within(panel).getByText("Essai de la connexion en cours…")).toHaveAttribute("aria-busy", "true");
    await act(async () => { resolve(reply({ identity: "service", credential_expires_at: null, can_cancel: true, state: "RUNNING" })); await Promise.resolve(); });
    expect(within(panel).getByText(/Essai réussi pour l'identité service/)).toHaveTextContent("état RUNNING · expiration inconnue · annulation disponible");
    expect(calls(fetcher, "POST", `${BINDING}/test`)[0]?.[1]?.body).toBeUndefined();
  });

  it.each([
    [{ status: 409, body: { error: { code: "credential_rejected" } } }, "Essai refusé"],
    [{ status: 500, body: {} }, "Essai indisponible"],
  ])("dit le refus ou la panne de l'essai", async (result, message) => {
    const fetcher = server({ [`POST ${BINDING}/test`]: result });
    await open(fetcher);
    const panel = screen.getByRole("region", { name: "source · DEV" });
    await userEvent.click(within(panel).getByRole("button", { name: "Tester la connexion" }));
    await waitFor(() => { expect(panel).toHaveTextContent(message); });
  });

  it("l'essai DuckDB annonce l'absence d'annulation et l'expiration datée", async () => {
    const localBinding = bound("DEV", { connector: "duckdb", credential_state: "unconfigured" });
    const fetcher = server({ [`POST ${BINDING}/test`]: { status: 200, body: { identity: "local", credential_expires_at: AT, can_cancel: false, state: "available" } } }, list([connection([localBinding, EMPTY("TEST"), EMPTY("PROD")])]));
    await open(fetcher);
    const panel = screen.getByRole("region", { name: "source · DEV" });
    await userEvent.click(within(panel).getByRole("button", { name: "Tester la connexion" }));
    await waitFor(() => { expect(panel).toHaveTextContent("annulation indisponible"); });
    expect(panel).toHaveTextContent("expiration");
  });

  it.each([
    ["Retirer la connexion source", "DELETE", `${ROOT}/source`, "Connexion source retirée."],
    ["Retirer la liaison", "DELETE", BINDING, "Liaison DEV de source retirée."],
    ["Retirer l'identifiant", "DELETE", `${BINDING}/credential`, "Identifiant DEV de source retiré."],
  ])("confirme %s et annonce le résultat", async (button, method, url, done) => {
    const fetcher = server({ [`${method} ${url}`]: { status: 204, body: null } });
    await open(fetcher);
    await userEvent.click(screen.getByRole("button", { name: button }));
    expect(calls(fetcher, method, url)).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Confirmer le retrait" }));
    await screen.findByText(done);
    expect(calls(fetcher, method, url)).toHaveLength(1);
  });

  it("annuler le retrait n'écrit rien", async () => {
    const fetcher = server();
    await open(fetcher);
    await userEvent.click(screen.getByRole("button", { name: "Retirer la connexion source" }));
    await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(calls(fetcher, "DELETE", `${ROOT}/source`)).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Retirer la liaison" }));
    await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(calls(fetcher, "DELETE", BINDING)).toHaveLength(0);
  });
});
