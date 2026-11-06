import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import { afterEach, expect, it, vi } from "vitest";
import espace from "../../../../contracts/espaces/espace.json";
import exemple from "../../../../contracts/executions/contextuel-detail.json";
import { analysesServer, CATALOG, changed, ID, ROOT, route, type Exemple } from "../analyses/testing";
import { decodeSpace } from "../spaces/model";
import type { Fetch } from "../spaces/api";
import { expectAccessible } from "../test/a11y";
import { ExplorerPage } from "./ExplorerPage";

const EXP = "/api/spaces/finance";
const RUN = "22222222-2222-4222-8222-222222222222";
const SHEET = `GET ${ROOT}/${ID}`;
const REVISIONS = `POST ${ROOT}/${ID}/revisions`;
const CREATE = `POST ${ROOT}`;
const EXECUTE = `POST ${EXP}/executions`;
const ALL = { owner: true, revise: true, delete: true, duplicate: true };
const bytes = tableToIPC(tableFromArrays({ region: ["Nord", "Sud"], revenue: [12, 7] }), "stream");
const running = { id: RUN, space_id: "finance", environment: "DEV", connection: "finance", state: "running", created_at: "2026-11-04T00:00:00Z", started_at: "2026-11-04T00:00:01Z", finished_at: null, deadline_at: "2026-11-04T00:01:00Z", can_cancel: true, cancel_requested: false, error_code: null, rows: null, size: null, truncated: null };
const success = { ...running, state: "succeeded", finished_at: "2026-11-04T00:00:02Z", can_cancel: false, rows: 2, size: bytes.byteLength, truncated: false, evidence: { ...exemple.body.evidence, evidence_id: "preuve", sql_hash: "sha256:v1:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", execution_status: "succeeded", model_keys: ["sales"] }, connector_run_id: null, result_contract: null };
const queued = (): Exemple => route("executer-avec-reference", [["<state>", "queued"], ['"<started_at>"', "null"]]);

const withRole = (role: string | null, implicit = false) => decodeSpace({ ...espace.body, role, implicit }, "espace");
/** La fiche `lire` portant les calculs que l'Explorateur sait porter (aucun) et les droits donnés. */
const sheet = (permissions: Record<string, boolean> = ALL): Exemple => changed(changed(route("lire"), "body.analysis.contextual", []), "body.permissions", permissions);

/** Faux serveur : catalogue de l'Explorateur, routes d'analyses du test, et le flux Arrow du résultat. */
function server(routes: Record<string, Exemple | (() => Exemple)> = {}) {
  const base = analysesServer({
    [`GET ${EXP}/explorer/connections`]: { status: 200, body: { connections: ["finance"] } },
    [`GET ${EXP}/explorer/fields`]: { status: 200, body: { models: CATALOG.models } },
    ...routes,
  });
  return vi.fn<Fetch>().mockImplementation((url, init) => (url === `${EXP}/executions/${RUN}/result`
    ? Promise.resolve(new Response(bytes.slice().buffer, { headers: { "content-type": "application/vnd.apache.arrow.stream" } }))
    : base(url, init)));
}
const open = (fetcher: Fetch, analysis?: { id: string; revision?: number }, space = withRole("admin")) => render(<ExplorerPage space={space} target="DEV" analysis={analysis} fetcher={fetcher} />);
const calls = (fetcher: ReturnType<typeof server>, method: string, url: string) => fetcher.mock.calls.filter(([target, init]) => target === url && (init?.method ?? "GET") === method);
const sent = (fetcher: ReturnType<typeof server>, method: string, url: string, at = 0) => JSON.parse((calls(fetcher, method, url)[at]?.[1]?.body ?? "null") as string) as Record<string, unknown>;
const analysis = () => screen.getByRole("region", { name: "Analyse" });
const click = (name: string | RegExp) => userEvent.click(screen.getByRole("button", { name }));
const panel = (name: string) => screen.getByRole("group", { name });

afterEach(() => { window.location.hash = ""; });

async function ready() {
  await screen.findByRole("heading", { name: "Champs" });
}

it("sauvegarde l'exploration comme analyse : aperçu, ce qui n'est pas gardé, une seule écriture au double clic, lien vers la fiche", async () => {
  const fetcher = server({ [CREATE]: route("creer") });
  const { container } = open(fetcher);
  await ready();
  await userEvent.click(screen.getByRole("checkbox", { name: /Chiffre d'affaires/ }));
  await userEvent.click(screen.getByRole("checkbox", { name: /Région/ }));
  await click("Sauvegarder comme analyse");
  const form = panel("Sauvegarder comme analyse");
  expect(within(form).getByRole("heading", { name: "Sauvegarder comme analyse" })).toHaveFocus();
  expect(within(form).getByRole("button", { name: "Sauvegarder l'analyse" })).toBeDisabled();
  expect(within(form).getByText(/Aperçu indisponible : analyse\.name/)).toBeInTheDocument();
  await userEvent.type(within(form).getByLabelText("Nom de l'analyse"), "Ventes par région");
  await userEvent.type(within(form).getByLabelText("Description"), "Suivi");
  await userEvent.click(within(form).getByRole("radio", { name: "Partagée" }));
  const preview = within(form).getByRole("group", { name: "Aperçu de l'analyse" });
  expect(preview).toHaveTextContent("Ventes par région");
  expect(preview).toHaveTextContent("Barres (bars)");
  expect(preview).toHaveTextContent("Non sauvegardé");
  expect(preview).toHaveTextContent("Sélection de lignes ou de barres : le format ne garde ni sélection ni donnée");
  expect(within(form).getByText(/Partagée : lisible par les membres de l'espace/)).toBeInTheDocument();
  await expectAccessible(container);
  await userEvent.click(screen.getByRole("button", { name: "Skifer ardoise" }));
  await expectAccessible(container);
  // Deux clics avant tout rendu : le verrou de l'écriture, posé de façon synchrone, empêche la seconde.
  const save = within(form).getByRole("button", { name: "Sauvegarder l'analyse" });
  act(() => { fireEvent.click(save); fireEvent.click(save); });
  expect(await within(form).findByText("Analyse sauvegardée.")).toBeInTheDocument();
  expect(calls(fetcher, "POST", ROOT)).toHaveLength(1);
  expect(sent(fetcher, "POST", ROOT)).toEqual({
    name: "Ventes par région", description: "Suivi", visibility: "shared",
    query: { connection: "finance", model: "sales", metrics: ["revenue"], dimensions: ["region"], filters: [] },
    contextual: [], presentation: { chart: "bars" },
  });
  expect(within(form).getByRole("link", { name: "Ouvrir la fiche" })).toHaveAttribute("href", `#/espaces/finance/analyses/${ID}`);
  expect(within(form).getByLabelText("Nom de l'analyse")).toBeDisabled();
  expect(within(form).getByRole("button", { name: "Sauvegarder l'analyse" })).toBeDisabled();
  await userEvent.click(within(form).getByRole("button", { name: "Fermer" }));
  expect(screen.queryByRole("group", { name: "Sauvegarder comme analyse" })).not.toBeInTheDocument();
});

it("enregistre les calculs de sélection comme calculs contextuels quand la case est cochée", async () => {
  const fetcher = server({ [CREATE]: route("creer") });
  open(fetcher);
  await ready();
  await userEvent.click(screen.getByRole("checkbox", { name: /Chiffre d'affaires/ }));
  await userEvent.click(within(analysis()).getByRole("checkbox", { name: /Enregistrer comme calculs contextuels/ }));
  await click("Sauvegarder comme analyse");
  await userEvent.type(screen.getByLabelText("Nom de l'analyse"), "Total");
  expect(panel("Sauvegarder comme analyse")).toHaveTextContent("Agrégat de revenue par sans regroupement · périmètre : sélection courante");
  expect(panel("Sauvegarder comme analyse")).toHaveTextContent("Part de revenue par sans regroupement · dénominateur : résultat chargé");
  await click("Sauvegarder l'analyse");
  await screen.findByText("Analyse sauvegardée.");
  expect(sent(fetcher, "POST", ROOT).contextual).toEqual([
    { operation: "aggregate", metric: "revenue", group_by: [], scope: null },
    { operation: "share", metric: "revenue", group_by: [], denominator: "loaded_result" },
  ]);
});

it.each([
  ["reader", false, /votre rôle est reader/],
  [null, false, /aucun rôle dans cet espace/],
  ["admin", true, /mode local/],
])("rôle %s (local : %s) : « Sauvegarder comme analyse » est visible, désactivé, avec sa raison", async (role, implicit, reason) => {
  const { container } = open(server(), undefined, withRole(role, implicit));
  await ready();
  const button = screen.getByRole("button", { name: "Sauvegarder comme analyse" });
  expect(button).toBeDisabled();
  expect(button).toHaveAccessibleDescription(reason);
  await expectAccessible(container);
});

it("dit chaque refus d'écriture tel que le serveur le formule, violations comprises, sans perdre le brouillon", async () => {
  let answer: Exemple = route("refus-analyse-invalide");
  const fetcher = server({ [CREATE]: () => answer });
  open(fetcher);
  await ready();
  await userEvent.click(screen.getByRole("checkbox", { name: /Chiffre d'affaires/ }));
  await click("Sauvegarder comme analyse");
  await userEvent.type(screen.getByLabelText("Nom de l'analyse"), "Brouillon");
  await click("Sauvegarder l'analyse");
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("L'analyse est invalide : des règles ne sont pas respectées.");
  expect(within(alert).getByText("/query/model").parentElement).toHaveTextContent("modèle introuvable dans le catalogue");
  expect(screen.getByLabelText("Nom de l'analyse")).toHaveValue("Brouillon");
  expect(screen.getByRole("button", { name: "Sauvegarder l'analyse" })).toBeEnabled();
  answer = route("refus-interdit");
  await click("Sauvegarder l'analyse");
  await waitFor(() => { expect(screen.getByRole("alert")).toHaveTextContent("Votre rôle ne permet pas cette action."); });
  expect(screen.queryByText("/query/model")).not.toBeInTheDocument();
  answer = { status: 500, body: {} };
  await click("Sauvegarder l'analyse");
  await waitFor(() => { expect(screen.getByRole("alert")).toHaveTextContent("Action non confirmée"); });
  expect(calls(fetcher, "POST", ROOT)).toHaveLength(3);
  expect(screen.queryByText("Analyse sauvegardée.")).not.toBeInTheDocument();
});

it("affiche un chemin vide comme le document entier", async () => {
  const body = { error: { code: "invalid_analysis", reason: "schema_violation", violations: [{ path: "", rule: "schema_violation" }] } };
  open(server({ [CREATE]: { status: 422, body } }));
  await ready();
  await userEvent.click(screen.getByRole("checkbox", { name: /Chiffre d'affaires/ }));
  await click("Sauvegarder comme analyse");
  await userEvent.type(screen.getByLabelText("Nom de l'analyse"), "x");
  await click("Sauvegarder l'analyse");
  expect(await screen.findByText("(document)")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("document hors du schéma");
});

it("ne sauvegarde pas une exploration sans métrique : l'aperçu dit pourquoi", async () => {
  open(server());
  await ready();
  await click("Sauvegarder comme analyse");
  await userEvent.type(screen.getByLabelText("Nom de l'analyse"), "Vide");
  expect(screen.getByText(/Aperçu indisponible : Choisissez une connexion et au moins une métrique/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sauvegarder l'analyse" })).toBeDisabled();
});

// --- Réouverture ---

it("rouvre une analyse : état restauré, bandeau, aucun événement d'ouverture, exécutions liées à la révision", async () => {
  const fetcher = server({ [SHEET]: sheet(), [EXECUTE]: queued() });
  const { container } = open(fetcher, { id: ID });
  expect(screen.getByRole("status")).toHaveTextContent("Chargement des champs et connexions…");
  expect(await screen.findByText(/Exploration à partir de « Chiffre d'affaires », révision 1/)).toBeInTheDocument();
  expect(screen.getByText("Identique à la révision ouverte")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ouvrir la fiche" })).toHaveAttribute("href", `#/espaces/finance/analyses/${ID}`);
  expect(screen.getByRole("button", { name: "Retirer Chiffre d'affaires" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retirer Région" })).toBeInTheDocument();
  expect(screen.getByText(/region in Nord,Sud/)).toBeInTheDocument();
  expect(screen.getByText(/Les exécutions sont liées à l'analyse \(révision 1\)/)).toBeInTheDocument();
  await expectAccessible(container);
  await userEvent.click(screen.getByRole("button", { name: "Skifer ardoise" }));
  await expectAccessible(container);
  await click("Exécuter");
  await waitFor(() => { expect(calls(fetcher, "POST", `${EXP}/executions`)).toHaveLength(1); });
  expect(sent(fetcher, "POST", `${EXP}/executions`)).toMatchObject({ model: "sales", metrics: ["revenue"], analysis: { id: ID, revision: 1 } });
  expect(fetcher.mock.calls.some(([url]) => url.endsWith("/opened"))).toBe(false);
});

it("dit quand l'exploration s'écarte de la révision ouverte, et le redit quand elle y revient", async () => {
  open(server({ [SHEET]: sheet() }), { id: ID });
  await screen.findByText("Identique à la révision ouverte");
  await click("Retirer le filtre region");
  expect(screen.getByText("Modifiée depuis l'ouverture")).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Dimension du filtre"), "region");
  await userEvent.selectOptions(screen.getByLabelText("Opérateur"), "in");
  await userEvent.type(screen.getByLabelText(/^Valeur/), "Sud, Nord");
  await click("Ajouter le filtre");
  expect(screen.getByText("Identique à la révision ouverte")).toBeInTheDocument();
  await click("Retirer Chiffre d'affaires");
  expect(screen.getByText("Modifiée depuis l'ouverture")).toBeInTheDocument();
});

it("détache visiblement les exécutions quand le modèle change, sans les rejouer sans référence", async () => {
  const fetcher = server({ [SHEET]: sheet(), [EXECUTE]: queued() });
  open(fetcher, { id: ID });
  await screen.findByText(/Les exécutions sont liées/);
  await userEvent.selectOptions(screen.getByLabelText("Modèle"), "sales_orders");
  expect(screen.getByText(/Le modèle a changé : les exécutions ne sont plus liées à l'analyse/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Détacher de l'analyse" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("checkbox", { name: /Chiffre d'affaires/ }));
  await click("Exécuter");
  await waitFor(() => { expect(calls(fetcher, "POST", `${EXP}/executions`)).toHaveLength(1); });
  expect(sent(fetcher, "POST", `${EXP}/executions`)).not.toHaveProperty("analysis");
});

it("le détachement du modèle est durable : revenir au modèle d'origine ne rattache pas l'exploration", async () => {
  const fetcher = server({ [SHEET]: sheet(), [EXECUTE]: queued() });
  open(fetcher, { id: ID });
  await screen.findByText(/Les exécutions sont liées/);
  await userEvent.selectOptions(screen.getByLabelText("Modèle"), "sales_orders");
  await userEvent.selectOptions(screen.getByLabelText("Modèle"), "sales");
  expect(screen.getByLabelText("Modèle")).toHaveValue("sales");
  expect(screen.getByText(/Le modèle a changé : les exécutions ne sont plus liées à l'analyse/)).toHaveTextContent("Revenir au modèle d'origine ne rétablit pas le lien");
  expect(screen.queryByText(/Les exécutions sont liées/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Détacher de l'analyse" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("checkbox", { name: /Chiffre d'affaires/ }));
  await click("Exécuter");
  await waitFor(() => { expect(calls(fetcher, "POST", `${EXP}/executions`)).toHaveLength(1); });
  expect(sent(fetcher, "POST", `${EXP}/executions`)).toMatchObject({ model: "sales" });
  expect(sent(fetcher, "POST", `${EXP}/executions`)).not.toHaveProperty("analysis");
});

it("détache explicitement l'exploration de l'analyse", async () => {
  const fetcher = server({ [SHEET]: sheet(), [EXECUTE]: queued() });
  open(fetcher, { id: ID });
  await screen.findByText(/Les exécutions sont liées/);
  await click("Détacher de l'analyse");
  expect(screen.getByText(/Détachée : les exécutions partent sans référence à l'analyse/)).toBeInTheDocument();
  await click("Exécuter");
  await waitFor(() => { expect(calls(fetcher, "POST", `${EXP}/executions`)).toHaveLength(1); });
  expect(sent(fetcher, "POST", `${EXP}/executions`)).not.toHaveProperty("analysis");
  expect(screen.getByText(/Exploration à partir de/)).toBeInTheDocument();
});

it.each([
  ["refus-reference-introuvable", "Cette analyse est introuvable ou ne vous est pas accessible."],
  ["refus-reference-modele", "Le modèle de la demande n'est pas celui de l'analyse référencée."],
])("le refus %s s'affiche tel quel et la demande n'est pas rejouée sans référence", async (name, text) => {
  const fetcher = server({ [SHEET]: sheet(), [EXECUTE]: route(name) });
  open(fetcher, { id: ID });
  await screen.findByText(/Les exécutions sont liées/);
  await click("Exécuter");
  expect(await screen.findByText(new RegExp(`Exécution indisponible : ${text.replaceAll(".", "\\.")}`))).toBeInTheDocument();
  await new Promise((resolve) => { setTimeout(resolve, 50); });
  expect(calls(fetcher, "POST", `${EXP}/executions`)).toHaveLength(1);
  expect(screen.getByText(/Les exécutions sont liées à l'analyse/)).toBeInTheDocument();
});

it("ouvre une révision numérotée qui n'est pas la courante : bandeau, aucune nouvelle révision, duplication possible", async () => {
  const past = changed(changed(route("revision"), "body.analysis.contextual", []), "body.current_revision", 2);
  const fetcher = server({ [`GET ${ROOT}/${ID}/revisions/1`]: changed(past, "body.permissions", ALL) });
  open(fetcher, { id: ID, revision: 1 });
  expect(await screen.findByText(/révision 1\./)).toBeInTheDocument();
  expect(screen.getByText(/La révision courante est la 2 : une révision enregistrée part toujours de la courante/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ouvrir la fiche" })).toHaveAttribute("href", `#/espaces/finance/analyses/${ID}/revisions/1`);
  expect(screen.queryByRole("button", { name: "Nouvelle révision" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Dupliquer" })).toBeEnabled();
});

it("sans droit de révision ni de duplication, ces actions ne sont pas offertes", async () => {
  open(server({ [SHEET]: sheet({ owner: false, revise: false, delete: false, duplicate: false }) }), { id: ID });
  await screen.findByText(/Exploration à partir de/);
  expect(screen.queryByRole("button", { name: "Nouvelle révision" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Dupliquer" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sauvegarder comme analyse" })).toBeEnabled();
});

// --- Réouverture impossible ---

it("n'ouvre pas à moitié une analyse que l'Explorateur ne sait pas représenter, et dit pourquoi", async () => {
  const { container } = open(server({ [SHEET]: changed(route("lire"), "body.permissions", ALL) }), { id: ID });
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Cette analyse ne s'ouvre pas dans l'Explorateur : rien n'est ouvert à moitié.");
  expect(alert).toHaveTextContent(/Calcul contextuel 1 \(Agrégat de revenue par region/);
  expect(screen.queryByRole("heading", { name: "Champs" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Retour à la fiche" })).toHaveAttribute("href", `#/espaces/finance/analyses/${ID}`);
  expect(screen.getByRole("link", { name: "Explorer sans analyse" })).toHaveAttribute("href", "#/espaces/finance/explorer");
  await expectAccessible(container);
});

it.each([
  ["lire-non-resolue", /État « Référence non résolue »/],
  ["lire-non-verifiee", /État « Non vérifiée »/],
])("l'état %s ferme l'ouverture avec sa raison", async (name, reason) => {
  open(server({ [SHEET]: changed(route(name), "body.analysis.contextual", []) }), { id: ID });
  expect(await screen.findByRole("alert")).toHaveTextContent(reason);
  expect(screen.queryByRole("heading", { name: "Champs" })).not.toBeInTheDocument();
});

it("ouvre une analyse dont l'index est en retard : le contenu vient du dépôt", async () => {
  open(server({ [SHEET]: changed(route("lire-index-perime"), "body.analysis.contextual", []) }), { id: ID });
  expect(await screen.findByText(/Exploration à partir de/)).toBeInTheDocument();
});

it("ferme l'ouverture d'une analyse supprimée, avec une révision numérotée dans le lien de retour", async () => {
  open(server({ [`GET ${ROOT}/${ID}/revisions/1`]: changed(route("revision-supprimee"), "body.analysis.contextual", []) }), { id: ID, revision: 1 });
  expect(await screen.findByRole("alert")).toHaveTextContent("L'analyse est supprimée");
  expect(screen.getByRole("link", { name: "Retour à la fiche" })).toHaveAttribute("href", `#/espaces/finance/analyses/${ID}/revisions/1`);
});

it("ferme l'ouverture quand le catalogue de l'Explorateur n'offre pas ce que l'analyse demande", async () => {
  open(server({ [SHEET]: changed(changed(route("lire"), "body.analysis.contextual", []), "body.analysis.query.model", "fantome") }), { id: ID });
  expect(await screen.findByRole("alert")).toHaveTextContent("Le modèle « fantome » n'est pas dans le catalogue de l'Explorateur.");
});

it("une lecture refusée, en erreur ou en mode local ne montre rien d'une analyse", async () => {
  const refused = open(server({ [SHEET]: route("refus-analyse-inconnue") }), { id: ID });
  expect(await screen.findByRole("alert")).toHaveTextContent("Cette analyse est introuvable ou ne vous est pas accessible.");
  expect(screen.getByRole("link", { name: "Explorer sans analyse" })).toBeInTheDocument();
  refused.unmount();
  const broken = open(server({ [SHEET]: { status: 500, body: {} } }), { id: ID });
  expect(await screen.findByRole("alert")).toHaveTextContent("Analyse indisponible");
  broken.unmount();
  open(server({ [SHEET]: route("refus-mode-local") }), { id: ID });
  expect(await screen.findByText("L'exploration n'est pas disponible en mode local.")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Champs" })).not.toBeInTheDocument();
});

// --- Nouvelle révision ---

async function reopened(routes: Record<string, Exemple | (() => Exemple)> = {}, permissions = ALL) {
  const fetcher = server({ [SHEET]: sheet(permissions), ...routes });
  const view = open(fetcher, { id: ID });
  await screen.findByText(/Exploration à partir de/);
  return { fetcher, ...view };
}

it("révise par l'écran d'impact : droits relus, impact, aperçu, expected_revision, lien vers les révisions de la fiche", async () => {
  const { fetcher, container } = await reopened({ [REVISIONS]: route("reviser") });
  await click("Nouvelle révision");
  const form = await screen.findByRole("group", { name: "Nouvelle révision" });
  const impact = within(form).getByRole("region", { name: "Impact de la révision" });
  expect(impact).toHaveTextContent("Révision courante remplacée");
  expect(impact).toHaveTextContent("r1 de « Chiffre d'affaires » ; elle reste lisible dans l'historique.");
  expect(impact).toHaveTextContent("Indisponible : aucune route ne lit les consommateurs avant le lot 07.");
  expect(within(impact).getByRole("radio", { name: "Nouvelle révision de l'analyse" })).toBeChecked();
  expect(within(form).getByLabelText("Nom de l'analyse")).toHaveValue("Chiffre d'affaires");
  expect(within(form).getByLabelText("Description")).toHaveValue("Suivi.");
  expect(within(form).getByRole("radio", { name: "Partagée" })).toBeChecked();
  expect(within(form).getByRole("group", { name: "Aperçu de l'analyse" })).toHaveTextContent("Barres (bars)");
  expect(screen.queryByRole("button", { name: "Partager" })).not.toBeInTheDocument();
  await expectAccessible(container);
  await userEvent.click(screen.getByRole("button", { name: "Skifer ardoise" }));
  await expectAccessible(container);
  await userEvent.clear(within(form).getByLabelText("Nom de l'analyse"));
  await userEvent.type(within(form).getByLabelText("Nom de l'analyse"), "Révisée");
  await userEvent.dblClick(within(form).getByRole("button", { name: "Enregistrer la nouvelle révision" }));
  expect(await within(form).findByText(/Révision 2 enregistrée\./)).toBeInTheDocument();
  expect(calls(fetcher, "POST", `${ROOT}/${ID}/revisions`)).toHaveLength(1);
  expect(sent(fetcher, "POST", `${ROOT}/${ID}/revisions`)).toMatchObject({ expected_revision: 1, name: "Révisée", visibility: "shared" });
  expect(within(form).getByRole("link", { name: "Voir les révisions dans la fiche" })).toHaveAttribute("href", `#/espaces/finance/analyses/${ID}/historique`);
  expect(screen.queryByRole("region", { name: "Impact de la révision" })).not.toBeInTheDocument();
  // L'Explorateur prend la révision 2 pour référence, sous le nom enregistré.
  expect(screen.getByText(/Exploration à partir de « Révisée », révision 2/)).toBeInTheDocument();
  expect(screen.getByText("Identique à la révision ouverte")).toBeInTheDocument();
});

it("après une révision publiée avec un autre modèle, la référence est reconstruite à partir de la révision renvoyée", async () => {
  const revised = changed(route("reviser"), "body.analysis.query.model", "sales_orders");
  const { fetcher } = await reopened({ [REVISIONS]: revised, [EXECUTE]: queued() });
  await userEvent.selectOptions(screen.getByLabelText("Modèle"), "sales_orders");
  await userEvent.click(screen.getByRole("checkbox", { name: /^Commandes · count/ }));
  await click("Nouvelle révision");
  await click("Enregistrer la nouvelle révision");
  expect(await screen.findByText(/Révision 2 enregistrée\./)).toBeInTheDocument();
  expect(sent(fetcher, "POST", `${ROOT}/${ID}/revisions`)).toMatchObject({ expected_revision: 1, query: { model: "sales_orders" } });
  expect(screen.getByText(/Exploration à partir de « Révisée », révision 2/)).toBeInTheDocument();
  // Le modèle de la référence est celui que le serveur a renvoyé : les exécutions de ce modèle y sont liées.
  expect(screen.getByText(/Les exécutions sont liées à l'analyse \(révision 2\)/)).toBeInTheDocument();
  await click("Exécuter");
  await waitFor(() => { expect(calls(fetcher, "POST", `${EXP}/executions`)).toHaveLength(1); });
  expect(sent(fetcher, "POST", `${EXP}/executions`)).toMatchObject({ model: "sales_orders", analysis: { id: ID, revision: 2 } });
  // Revenir à l'ancien modèle : ce n'est plus celui de la référence, l'exécution part sans.
  await userEvent.selectOptions(screen.getByLabelText("Modèle"), "sales");
  expect(screen.getByText(/Le modèle a changé/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("checkbox", { name: /Chiffre d'affaires/ }));
  await click("Exécuter");
  await waitFor(() => { expect(calls(fetcher, "POST", `${EXP}/executions`)).toHaveLength(2); });
  expect(sent(fetcher, "POST", `${EXP}/executions`, 1)).toMatchObject({ model: "sales" });
  expect(sent(fetcher, "POST", `${EXP}/executions`, 1)).not.toHaveProperty("analysis");
});

it("une révision publiée après un détachement explicite rétablit la référence à la révision renvoyée", async () => {
  const { fetcher } = await reopened({ [REVISIONS]: route("reviser"), [EXECUTE]: queued() });
  await click("Détacher de l'analyse");
  await click("Nouvelle révision");
  await click("Enregistrer la nouvelle révision");
  await screen.findByText(/Révision 2 enregistrée\./);
  expect(screen.getByText(/Les exécutions sont liées à l'analyse \(révision 2\)/)).toBeInTheDocument();
  await click("Exécuter");
  await waitFor(() => { expect(calls(fetcher, "POST", `${EXP}/executions`)).toHaveLength(1); });
  expect(sent(fetcher, "POST", `${EXP}/executions`)).toMatchObject({ analysis: { id: ID, revision: 2 } });
});

it("un refus ou une panne qui n'est pas un conflit laisse la révision possible", async () => {
  let answer: Exemple = route("refus-interdit");
  await reopened({ [REVISIONS]: () => answer });
  await click("Nouvelle révision");
  await click("Enregistrer la nouvelle révision");
  expect(await screen.findByRole("alert")).toHaveTextContent("Votre rôle ne permet pas cette action.");
  expect(screen.queryByRole("region", { name: "Révision courante différente" })).not.toBeInTheDocument();
  answer = { status: 500, body: {} };
  await click("Enregistrer la nouvelle révision");
  await waitFor(() => { expect(screen.getByRole("alert")).toHaveTextContent("Action non confirmée"); });
  expect(screen.queryByRole("region", { name: "Révision courante différente" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Enregistrer la nouvelle révision" })).toBeEnabled();
});

it("un contenu identique ne crée aucune révision et le dit", async () => {
  await reopened({ [REVISIONS]: changed(changed(route("reviser-identique"), "body.revision", 1), "body.current_revision", 1) });
  await click("Nouvelle révision");
  await userEvent.click(await screen.findByRole("button", { name: "Enregistrer la nouvelle révision" }));
  expect(await screen.findByText("Contenu identique, aucune révision créée.")).toBeInTheDocument();
  expect(screen.getByText(/Exploration à partir de « Chiffre d'affaires », révision 1/)).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "Ouvrir la fiche" })).toHaveLength(2);
});

/** Une révision 2 existe côté serveur : les deux premières lectures (ouverture, droits) voient la 1, les suivantes la 2. */
async function conflicted(routes: Record<string, Exemple | (() => Exemple)> = {}, afterOpening: Exemple | (() => Exemple) = changed(changed(sheet(), "body.revision", 2), "body.current_revision", 2)) {
  let reads = 0;
  const fetcher = server({
    [SHEET]: () => (++reads <= 2 ? sheet() : typeof afterOpening === "function" ? afterOpening() : afterOpening),
    [REVISIONS]: route("refus-revision-conflit"),
    [CREATE]: route("creer"),
    [EXECUTE]: queued(),
    ...routes,
  });
  const view = open(fetcher, { id: ID });
  await screen.findByText(/Exploration à partir de/);
  await click("Nouvelle révision");
  await screen.findByRole("group", { name: "Nouvelle révision" });
  // La relecture des droits voit encore la révision 1 : le conflit vient de l'écriture.
  await userEvent.clear(screen.getByLabelText("Nom de l'analyse"));
  await userEvent.type(screen.getByLabelText("Nom de l'analyse"), "Mon brouillon");
  await click("Enregistrer la nouvelle révision");
  expect((await screen.findAllByText(/Une autre révision a été enregistrée entre-temps/)).length).toBeGreaterThan(0);
  return { fetcher, ...view };
}

it("sur un conflit, ne relit jamais pour écraser : deux issues seulement, la révision ouverte reste la r1", async () => {
  const { fetcher, container } = await conflicted();
  const divergence = await screen.findByRole("region", { name: "Révision courante différente" });
  // Le numéro de la révision courante vient d'une relecture qui n'est pas adoptée.
  expect(await within(divergence).findByRole("button", { name: "Ouvrir la révision courante (r2)" })).toBeInTheDocument();
  expect(within(divergence).getByRole("button", { name: "Copie indépendante" })).toBeInTheDocument();
  expect(within(divergence).getByText(/Enregistrer par-dessus la révision courante \(r2\) effacerait ses changements sans que vous les ayez vus : ce n'est pas offert/)).toBeInTheDocument();
  expect(within(divergence).getByRole("link", { name: /Voir ce qui a changé/ })).toHaveAttribute("href", `#/espaces/finance/analyses/${ID}/historique/1/2`);
  expect(within(divergence).getByRole("link", { name: /Voir ce qui a changé/ })).toHaveAttribute("target", "_blank");
  expect(screen.queryByRole("button", { name: /Relire/ })).not.toBeInTheDocument();
  // Plus aucune écriture de révision n'est offerte, et le brouillon est gardé.
  expect(screen.queryByRole("button", { name: "Enregistrer la nouvelle révision" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Enregistrer la copie" })).toBeEnabled();
  expect(screen.getByLabelText("Nom de l'analyse")).toHaveValue("Mon brouillon");
  // Sans réouverture, le bandeau et les exécutions disent toujours la révision 1.
  expect(screen.getByText(/Exploration à partir de « Chiffre d'affaires », révision 1/)).toBeInTheDocument();
  expect(screen.getByText(/Les exécutions sont liées à l'analyse \(révision 1\)/)).toBeInTheDocument();
  await click("Exécuter");
  await waitFor(() => { expect(calls(fetcher, "POST", `${EXP}/executions`)).toHaveLength(1); });
  expect(sent(fetcher, "POST", `${EXP}/executions`)).toMatchObject({ analysis: { id: ID, revision: 1 } });
  // Une seule écriture de révision a été tentée, avec la révision réellement ouverte.
  expect(calls(fetcher, "POST", `${ROOT}/${ID}/revisions`)).toHaveLength(1);
  expect(sent(fetcher, "POST", `${ROOT}/${ID}/revisions`)).toMatchObject({ expected_revision: 1 });
  await expectAccessible(container);
});

it("ouvrir la révision courante demande d'abord d'abandonner le brouillon, puis rouvre l'Explorateur par l'API", async () => {
  const { container } = await conflicted();
  await click("Ouvrir la révision courante (r2)");
  const ask = panel("Abandonner le brouillon");
  expect(ask).toHaveTextContent("Ouvrir la révision courante (r2) abandonne votre brouillon");
  await expectAccessible(container);
  await userEvent.click(within(ask).getByRole("button", { name: "Annuler" }));
  expect(screen.queryByRole("group", { name: "Abandonner le brouillon" })).not.toBeInTheDocument();
  expect(window.location.hash).toBe("");
  await click("Ouvrir la révision courante (r2)");
  await userEvent.click(within(panel("Abandonner le brouillon")).getByRole("button", { name: "Abandonner le brouillon et ouvrir" }));
  expect(window.location.hash).toBe(`#/espaces/finance/explorer/analyses/${ID}/revisions/2`);
});

it("avant d'ouvrir la révision courante, on peut en faire une copie indépendante du brouillon", async () => {
  const { fetcher } = await conflicted();
  await click("Ouvrir la révision courante (r2)");
  await userEvent.click(within(panel("Abandonner le brouillon")).getByRole("button", { name: "Faire d'abord une copie indépendante" }));
  expect(screen.queryByRole("group", { name: "Abandonner le brouillon" })).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(window.location.hash).toBe("");
  await click("Enregistrer la copie");
  expect(await screen.findByText("Analyse sauvegardée.")).toBeInTheDocument();
  expect(sent(fetcher, "POST", ROOT)).toMatchObject({ name: "Mon brouillon", visibility: "shared" });
  expect(calls(fetcher, "POST", `${ROOT}/${ID}/revisions`)).toHaveLength(1);
});

it("« Copie indépendante » du conflit enregistre le brouillon comme une autre analyse", async () => {
  const { fetcher } = await conflicted();
  await click("Copie indépendante");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await click("Enregistrer la copie");
  expect(await screen.findByText("Analyse sauvegardée.")).toBeInTheDocument();
  expect(sent(fetcher, "POST", ROOT)).toMatchObject({ name: "Mon brouillon" });
  expect(calls(fetcher, "POST", `${ROOT}/${ID}/revisions`)).toHaveLength(1);
});

it("si la révision courante ne peut pas être relue après un conflit, elle n'est ni nommée ni offerte, aucune seconde écriture n'est possible", async () => {
  const { fetcher } = await conflicted({}, { status: 500, body: {} });
  const divergence = await screen.findByRole("region", { name: "Révision courante différente" });
  await waitFor(() => { expect(within(divergence).getByRole("alert")).toHaveTextContent("Révision courante indisponible"); });
  expect(within(divergence).queryByRole("button", { name: /Ouvrir la révision courante/ })).not.toBeInTheDocument();
  expect(within(divergence).getByRole("button", { name: "Copie indépendante" })).toBeInTheDocument();
  expect(within(divergence).getByText(/effacerait ses changements/)).toHaveTextContent("Enregistrer par-dessus la révision courante effacerait");
  // La courante n'est pas connue : le lien garde la forme simple.
  expect(within(divergence).getByRole("link", { name: /Voir ce qui a changé/ })).toHaveAttribute("href", `#/espaces/finance/analyses/${ID}/historique`);
  expect(screen.getByText(/Exploration à partir de « Chiffre d'affaires », révision 1/)).toBeInTheDocument();
  // Aucune écriture de révision : le bouton n'existe plus, la raison est dite, et une seule tentative a été faite.
  expect(screen.queryByRole("button", { name: "Enregistrer la nouvelle révision" })).not.toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "Nouvelle révision de l'analyse" })).toBeDisabled();
  expect(panel("Nouvelle révision")).toHaveTextContent("Une nouvelle révision n'est pas possible depuis cette exploration.");
  expect(calls(fetcher, "POST", `${ROOT}/${ID}/revisions`)).toHaveLength(1);
});

it("pendant la relecture de la courante qui suit un conflit, aucune écriture de révision n'est possible", async () => {
  let reads = 0;
  const base = server({ [SHEET]: sheet(), [REVISIONS]: route("refus-revision-conflit") });
  const fetcher = vi.fn<Fetch>().mockImplementation((url, init) => (url === `${ROOT}/${ID}` && (init?.method ?? "GET") === "GET" && ++reads > 2 ? new Promise<Response>(() => undefined) : base(url, init)));
  open(fetcher, { id: ID });
  await screen.findByText(/Exploration à partir de/);
  await click("Nouvelle révision");
  await screen.findByRole("group", { name: "Nouvelle révision" });
  await click("Enregistrer la nouvelle révision");
  const divergence = await screen.findByRole("region", { name: "Révision courante différente" });
  expect(within(divergence).getByText("Lecture de la révision courante…")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Enregistrer la nouvelle révision" })).not.toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "Nouvelle révision de l'analyse" })).toBeDisabled();
  expect(within(divergence).queryByRole("button", { name: /Ouvrir la révision courante/ })).not.toBeInTheDocument();
  expect(calls(base, "POST", `${ROOT}/${ID}/revisions`)).toHaveLength(1);
});

it("le conflit est mémorisé : fermer puis rouvrir le panneau ne rend pas l'écriture, même si la relecture revoit la révision ouverte", async () => {
  const { fetcher } = await conflicted({}, sheet());
  await click("Annuler");
  await click("Nouvelle révision");
  const form = await screen.findByRole("group", { name: "Nouvelle révision" });
  expect(await within(form).findByRole("region", { name: "Révision courante différente" })).toBeInTheDocument();
  expect(within(form).queryByRole("button", { name: "Enregistrer la nouvelle révision" })).not.toBeInTheDocument();
  expect(within(form).getByRole("button", { name: "Copie indépendante" })).toBeInTheDocument();
  expect(calls(fetcher, "POST", `${ROOT}/${ID}/revisions`)).toHaveLength(1);
});

it("quand la relecture voit déjà une autre révision, la révision n'est pas offerte : seules la copie et l'ouverture de la courante le sont", async () => {
  let reads = 0;
  const other = () => changed(changed(sheet(), "body.revision", 2), "body.current_revision", 2);
  const fetcher = server({ [SHEET]: () => (++reads === 1 ? sheet() : other()), [CREATE]: route("creer") });
  open(fetcher, { id: ID });
  await screen.findByText(/Exploration à partir de/);
  await click("Nouvelle révision");
  const form = await screen.findByRole("group", { name: "Nouvelle révision" });
  expect(form).toHaveTextContent("Une autre révision a été enregistrée entre-temps : la révision courante est la 2, vous explorez la 1.");
  expect(within(form).getByRole("radio", { name: "Nouvelle révision de l'analyse" })).toBeDisabled();
  expect(within(form).getByRole("radio", { name: /Copie indépendante/ })).toBeChecked();
  expect(within(form).getByRole("button", { name: "Ouvrir la révision courante (r2)" })).toBeInTheDocument();
  expect(within(form).getByRole("link", { name: /Voir ce qui a changé/ })).toBeInTheDocument();
  await click("Enregistrer la copie");
  expect(await screen.findByText("Analyse sauvegardée.")).toBeInTheDocument();
  expect(calls(fetcher, "POST", `${ROOT}/${ID}/revisions`)).toHaveLength(0);
});

it("quand le serveur n'accorde plus la révision à la relecture, seule la copie est offerte", async () => {
  let reads = 0;
  const fetcher = server({ [SHEET]: () => (++reads === 1 ? sheet() : sheet({ owner: false, revise: false, delete: false, duplicate: true })) });
  open(fetcher, { id: ID });
  await screen.findByText(/Exploration à partir de/);
  await click("Nouvelle révision");
  const form = await screen.findByRole("group", { name: "Nouvelle révision" });
  expect(form).toHaveTextContent("Le serveur n'accorde pas la révision de cette analyse à votre compte.");
  expect(within(form).getByRole("radio", { name: "Nouvelle révision de l'analyse" })).toBeDisabled();
  expect(within(form).getByRole("button", { name: "Enregistrer la copie" })).toBeEnabled();
});

it("une relecture des droits qui échoue ferme la révision avec la raison", async () => {
  let reads = 0;
  const fetcher = server({ [SHEET]: () => (++reads === 1 ? sheet() : { status: 500, body: {} }) });
  open(fetcher, { id: ID });
  await screen.findByText(/Exploration à partir de/);
  await click("Nouvelle révision");
  expect(await screen.findByRole("alert")).toHaveTextContent("Révision courante indisponible");
  expect(screen.queryByRole("button", { name: "Enregistrer la nouvelle révision" })).not.toBeInTheDocument();
  await click("Fermer");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("en mode local, une relecture des droits dit le mode local", async () => {
  let reads = 0;
  const fetcher = server({ [SHEET]: () => (++reads === 1 ? sheet() : route("refus-mode-local")) });
  open(fetcher, { id: ID });
  await screen.findByText(/Exploration à partir de/);
  await click("Nouvelle révision");
  expect(await screen.findByText("Les analyses ne sont pas disponibles en mode local.")).toBeInTheDocument();
});

// --- Duplication ---

it("duplique par createAnalysis avec l'exploration courante, et le dit", async () => {
  const fetcher = (await reopened({ [CREATE]: route("creer") })).fetcher;
  await click("Dupliquer");
  const form = panel("Dupliquer l'analyse");
  expect(form).toHaveTextContent("Crée une analyse indépendante à partir de ce que vous explorez maintenant, modifications non sauvegardées comprises");
  expect(within(form).getByLabelText("Nom de l'analyse")).toHaveValue("Copie de Chiffre d'affaires");
  expect(within(form).getByRole("radio", { name: "Personnelle" })).toBeChecked();
  await click("Retirer le filtre region");
  await click("Enregistrer la copie");
  expect(await screen.findByText("Analyse sauvegardée.")).toBeInTheDocument();
  expect(sent(fetcher, "POST", ROOT)).toMatchObject({ name: "Copie de Chiffre d'affaires", visibility: "personal", query: { filters: [] } });
  expect(calls(fetcher, "POST", `${ROOT}/${ID}/duplicate`)).toHaveLength(0);
});

it("une copie sans droit de création est désactivée avec la raison", async () => {
  const fetcher = server({ [SHEET]: sheet() });
  open(fetcher, { id: ID }, withRole("reader"));
  await screen.findByText(/Exploration à partir de/);
  expect(screen.getByRole("button", { name: "Dupliquer" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Dupliquer" })).toHaveAccessibleDescription(/votre rôle est reader/);
});

// --- Type de graphique ---

it("sauvegarde le type de graphique montré dans le résultat, et l'ouvre avec celui de l'analyse", async () => {
  const fetcher = server({ [SHEET]: sheet(), [EXECUTE]: { status: 202, body: running }, [`GET ${EXP}/executions/${RUN}`]: { status: 200, body: success }, [CREATE]: route("creer") });
  open(fetcher, { id: ID });
  await screen.findByText(/Exploration à partir de/);
  await click("Exécuter");
  const select = await screen.findByLabelText("Type de graphique", undefined, { timeout: 3000 });
  expect(select).toHaveValue("barres");
  await userEvent.selectOptions(select, "ligne");
  expect(screen.getByText("Modifiée depuis l'ouverture")).toBeInTheDocument();
  await click("Sauvegarder comme analyse");
  await userEvent.type(screen.getByLabelText("Nom de l'analyse"), "En ligne");
  expect(panel("Sauvegarder comme analyse")).toHaveTextContent("Ligne (line)");
  await click("Sauvegarder l'analyse");
  await screen.findByText("Analyse sauvegardée.");
  expect(sent(fetcher, "POST", ROOT).presentation).toEqual({ chart: "line" });
  await click("Réinitialiser");
  await userEvent.click(screen.getByRole("checkbox", { name: /Chiffre d'affaires/ }));
  await click("Fermer");
  await click("Sauvegarder comme analyse");
  await userEvent.type(screen.getByLabelText("Nom de l'analyse"), "Valeur");
  // Sans résultat affiché, le type est celui de l'analyse ouverte.
  expect(panel("Sauvegarder comme analyse")).toHaveTextContent("Barres (bars)");
});

it("le choix de l'écran d'impact change l'écriture : copie indépendante ou nouvelle révision", async () => {
  const { fetcher } = await reopened({ [CREATE]: route("creer") });
  await click("Nouvelle révision");
  const form = await screen.findByRole("group", { name: "Nouvelle révision" });
  await userEvent.click(within(form).getByRole("radio", { name: /Copie indépendante/ }));
  expect(within(form).getByRole("button", { name: "Enregistrer la copie" })).toBeEnabled();
  expect(within(form).queryByRole("button", { name: "Enregistrer la nouvelle révision" })).not.toBeInTheDocument();
  await userEvent.click(within(form).getByRole("radio", { name: "Nouvelle révision de l'analyse" }));
  expect(within(form).getByRole("button", { name: "Enregistrer la nouvelle révision" })).toBeEnabled();
  expect(calls(fetcher, "POST", ROOT)).toHaveLength(0);
});
