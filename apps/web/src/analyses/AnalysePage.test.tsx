import { StrictMode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import espace from "../../../../contracts/espaces/espace.json";
import { decodeSpace } from "../spaces/model";
import { expectAccessible } from "../test/a11y";
import { AnalysePage } from "./AnalysePage";
import { analysesServer, changed, COMMIT, ID, OTHER_ID, ROOT, route, type Exemple } from "./testing";

const space = decodeSpace(espace.body, "espace");
const FICHE = `GET ${ROOT}/${ID}`;
const OPENED = `POST ${ROOT}/${ID}/opened`;
const ALL = { owner: true, revise: true, delete: true, duplicate: true };
const withPermissions = (example: Exemple, permissions: Record<string, boolean>): Exemple => changed(example, "body.permissions", permissions);
const open = (routes: Parameters<typeof analysesServer>[0], revision?: number) => {
  const fetcher = analysesServer({ [OPENED]: route("ouvrir"), ...routes });
  return { fetcher, ...render(<AnalysePage space={space} id={ID} revision={revision} fetcher={fetcher} />) };
};
const opened = (fetcher: ReturnType<typeof analysesServer>) => fetcher.mock.calls.filter(([url, init]) => url === `${ROOT}/${ID}/opened` && init?.method === "POST");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Événements d'ouverture envoyés, dans l'ordre : identifiant client et révision lue. */
const events = (fetcher: ReturnType<typeof analysesServer>) => opened(fetcher).map(([, init]) => JSON.parse(init?.body as string) as { event_id: string; revision: number });

afterEach(() => { window.location.hash = ""; });

it("montre l'en-tête : nom, description, visibilité, propriétaire, révision, état et provenance", async () => {
  const { container } = open({ [FICHE]: route("lire") });
  expect(screen.getByRole("status")).toHaveTextContent("Lecture de l'analyse…");
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Analyse");
  expect(await screen.findByRole("heading", { level: 1, name: "Chiffre d'affaires" })).toBeInTheDocument();
  expect(screen.getByText("Suivi.")).toBeInTheDocument();
  const card = screen.getByRole("heading", { name: "Fiche" }).closest("section") ?? container;
  expect(within(card).getByText("Partagée")).toBeInTheDocument();
  expect(within(card).getByText("Prête")).toBeInTheDocument();
  expect(within(card).getByText(/Les références de la requête existent dans le catalogue/)).toBeInTheDocument();
  expect(screen.getByText("Propriétaire").nextElementSibling).toHaveTextContent("cora (https://id.example.invalid)");
  expect(screen.getByText("Révision").nextElementSibling).toHaveTextContent("r1 sur r1");
  expect(screen.getByText("Révisée par").nextElementSibling).toHaveTextContent("cora");
  expect(screen.getByText("Provenance").nextElementSibling).toHaveTextContent(`commit ${COMMIT}`);
  expect(screen.getByText("Provenance").nextElementSibling).toHaveTextContent(/2026/);
  expect(screen.getByText("Identifiant stable").nextElementSibling).toHaveTextContent(ID);
  expect(screen.getByRole("link", { name: "Retour aux analyses" })).toHaveAttribute("href", "#/espaces/finance/analyses");
  expect(screen.queryByText(/Références que le catalogue ne confirme pas/)).not.toBeInTheDocument();
  await expectAccessible(container);
  await userEvent.click(screen.getByRole("button", { name: "Skifer ardoise" }));
  expect(container.firstElementChild).toHaveClass("sb-theme-skifer-ardoise");
  await expectAccessible(container);
});

it("sans droit, aucune action d'écriture n'est offerte, et le chemin vers l'Explorateur est dit indisponible", async () => {
  open({ [FICHE]: route("lire") });
  await screen.findByRole("heading", { name: "Chiffre d'affaires" });
  expect(screen.queryByRole("button", { name: "Dupliquer" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Supprimer" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Nouvelle révision" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Ouvrir dans l'Explorateur" })).toBeDisabled();
  expect(screen.getByText(/ne sont pas encore disponibles/)).toBeInTheDocument();
});

it.each([
  [{ duplicate: true }, ["Dupliquer"], ["Supprimer", "Nouvelle révision"]],
  [{ revise: true, delete: true }, ["Supprimer", "Nouvelle révision"], ["Dupliquer"]],
])("les permissions %j offrent %j et rien d'autre", async (granted, shown, hidden) => {
  open({ [FICHE]: withPermissions(route("lire"), { owner: false, revise: false, delete: false, duplicate: false, ...granted }) });
  await screen.findByRole("heading", { name: "Chiffre d'affaires" });
  for (const name of shown) expect(screen.getByRole("button", { name })).toBeInTheDocument();
  for (const name of hidden) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
});

it("« Nouvelle révision » reste une action à venir, désactivée", async () => {
  open({ [FICHE]: withPermissions(route("lire"), ALL) });
  expect(await screen.findByRole("button", { name: "Nouvelle révision" })).toBeDisabled();
});

it("le propriétaire se lit « Vous »", async () => {
  open({ [FICHE]: withPermissions(route("lire"), ALL) });
  await screen.findByRole("heading", { name: "Chiffre d'affaires" });
  expect(screen.getByText("Propriétaire").nextElementSibling).toHaveTextContent("Vous (https://id.example.invalid)");
});

it("une référence non résolue est montrée telle qu'enregistrée, avec sa règle, et jamais remplacée", async () => {
  const { container } = open({ [FICHE]: route("lire-non-resolue") });
  const banner = await screen.findByRole("alert");
  expect(banner).toHaveTextContent("Références que le catalogue ne confirme pas, montrées telles qu'enregistrées");
  expect(banner).toHaveTextContent("Métrique introuvable dans le catalogue · /query/metrics/0 · \"revenue\"");
  expect(screen.getAllByText("Référence non résolue").length).toBeGreaterThan(0);
  expect(screen.getByText(/Ils sont montrés tels qu'enregistrés : rien n'est remplacé ni deviné/)).toBeInTheDocument();
  expect(screen.queryByText("Prête")).not.toBeInTheDocument();
  // La requête de l'onglet par défaut marque la métrique à sa place.
  expect(screen.getByText("Métriques").nextElementSibling).toHaveTextContent("revenue Métrique introuvable dans le catalogue");
  await expectAccessible(container);
});

it("une analyse non vérifiée dit qu'elle n'est ni confirmée ni infirmée", async () => {
  open({ [FICHE]: route("lire-non-verifiee") });
  await screen.findByRole("heading", { name: "Chiffre d'affaires" });
  expect(screen.getByText("Non vérifiée")).toBeInTheDocument();
  expect(screen.getByText(/ni confirmées ni infirmées/)).toBeInTheDocument();
  expect(screen.queryByText("Prête")).not.toBeInTheDocument();
  expect(screen.queryByText(/Références que le catalogue ne confirme pas/)).not.toBeInTheDocument();
});

it("un index en retard est décrit comme un décalage, et les permissions du serveur décident des actions", async () => {
  open({ [FICHE]: route("lire-index-perime") });
  await screen.findByRole("heading", { name: "Écrite hors index" });
  expect(screen.getByText("Index en retard")).toBeInTheDocument();
  expect(screen.getByText(/le contenu affiché vient du dépôt \(git\) et la liste peut être en retard/)).toBeInTheDocument();
  expect(screen.queryByText(/droits ne sont pas établis|aucune écriture n'est offerte/)).not.toBeInTheDocument();
  expect(screen.getByText("Révision").nextElementSibling).toHaveTextContent("r2 sur r2");
  expect(screen.queryByRole("button", { name: "Dupliquer" })).not.toBeInTheDocument();
});

it("avec un index en retard, les actions accordées par le serveur restent offertes", async () => {
  open({ [FICHE]: withPermissions(route("lire-index-perime"), ALL) });
  await screen.findByRole("heading", { name: "Écrite hors index" });
  expect(screen.getByRole("button", { name: "Dupliquer" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Supprimer" })).toBeInTheDocument();
});

it("les sept onglets se lisent un à un, un seul panneau est monté à la fois", async () => {
  open({
    [FICHE]: route("lire"), [`GET ${ROOT}/${ID}/revisions`]: route("historique"), [`GET ${ROOT}/${ID}/usage`]: route("usage"),
  });
  await screen.findByRole("heading", { name: "Chiffre d'affaires" });
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Requête", "Calculs contextuels", "Présentation par défaut", "Révisions", "Consommateurs", "Usage", "Preuves"]);
  const panel = () => screen.getAllByRole("tabpanel").filter((node) => !node.hidden);
  expect(panel()).toHaveLength(1);
  expect(panel()[0]).toHaveTextContent("Connexion");
  await userEvent.click(screen.getByRole("tab", { name: "Calculs contextuels" }));
  expect(panel()[0]).toHaveTextContent("Agrégat de revenue par region");
  await userEvent.click(screen.getByRole("tab", { name: "Présentation par défaut" }));
  expect(panel()[0]).toHaveTextContent("Barres (bars)");
  await userEvent.click(screen.getByRole("tab", { name: "Révisions" }));
  expect(await screen.findByRole("list", { name: "Historique des révisions" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("tab", { name: "Consommateurs" }));
  expect(panel()[0]).toHaveTextContent("Aucun consommateur");
  await userEvent.click(screen.getByRole("tab", { name: "Usage" }));
  expect(await screen.findByRole("table", { name: "Usage de l'analyse" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("tab", { name: "Preuves" }));
  expect(panel()[0]).toHaveTextContent("Indisponible");
  expect(screen.getByRole("tab", { name: "Preuves" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tab", { name: "Requête" })).toHaveAttribute("tabindex", "-1");
});

it("les flèches, Début et Fin déplacent l'onglet actif et son focus ; une autre touche ne fait rien", async () => {
  open({ [FICHE]: route("lire") });
  await screen.findByRole("heading", { name: "Chiffre d'affaires" });
  const tab = (name: string) => screen.getByRole("tab", { name });
  tab("Requête").focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(tab("Calculs contextuels")).toHaveAttribute("aria-selected", "true");
  expect(tab("Calculs contextuels")).toHaveFocus();
  await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
  expect(tab("Preuves")).toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{ArrowRight}");
  expect(tab("Requête")).toHaveFocus();
  await userEvent.keyboard("{End}");
  expect(tab("Preuves")).toHaveFocus();
  await userEvent.keyboard("{Home}");
  expect(tab("Requête")).toHaveFocus();
  await userEvent.keyboard("a");
  expect(tab("Requête")).toHaveAttribute("aria-selected", "true");
});

it("l'ouverture est consignée une fois par affichage, avec la révision lue et un identifiant client", async () => {
  const { fetcher } = open({ [FICHE]: route("lire") });
  await waitFor(() => { expect(opened(fetcher)).toHaveLength(1); });
  const sent = events(fetcher);
  expect(sent[0]?.revision).toBe(1);
  expect(sent[0]?.event_id).toMatch(UUID);
  await userEvent.click(screen.getByRole("tab", { name: "Preuves" }));
  await userEvent.click(screen.getByRole("tab", { name: "Requête" }));
  expect(opened(fetcher)).toHaveLength(1);
});

it("un re-rendu du même affichage n'envoie rien de plus", async () => {
  const { fetcher, rerender } = open({ [FICHE]: route("lire") });
  await waitFor(() => { expect(opened(fetcher)).toHaveLength(1); });
  rerender(<AnalysePage space={space} id={ID} revision={undefined} fetcher={fetcher} />);
  await screen.findByRole("heading", { name: "Chiffre d'affaires" });
  expect(events(fetcher)).toHaveLength(1);
});

it("StrictMode, qui rejoue les effets, n'envoie l'ouverture qu'une fois", async () => {
  const fetcher = analysesServer({ [OPENED]: route("ouvrir"), [FICHE]: route("lire") });
  render(<StrictMode><AnalysePage space={space} id={ID} revision={undefined} fetcher={fetcher} /></StrictMode>);
  await screen.findByRole("heading", { name: "Chiffre d'affaires" });
  await waitFor(() => { expect(opened(fetcher)).toHaveLength(1); });
  await userEvent.click(screen.getByRole("tab", { name: "Preuves" }));
  expect(events(fetcher)).toHaveLength(1);
});

it("chaque révision affichée a son identifiant : lire r1 puis r2 envoie deux événements distincts", async () => {
  const second = changed(route("revision"), "body.revision", 2);
  const fetcher = analysesServer({ [OPENED]: route("ouvrir"), [`GET ${ROOT}/${ID}/revisions/1`]: route("revision"), [`GET ${ROOT}/${ID}/revisions/2`]: second });
  const { rerender } = render(<AnalysePage space={space} id={ID} revision={1} fetcher={fetcher} />);
  await waitFor(() => { expect(opened(fetcher)).toHaveLength(1); });
  rerender(<AnalysePage space={space} id={ID} revision={2} fetcher={fetcher} />);
  await waitFor(() => { expect(opened(fetcher)).toHaveLength(2); });
  const sent = events(fetcher);
  expect(sent.map((event) => event.revision)).toEqual([1, 2]);
  expect(sent[0]?.event_id).not.toBe(sent[1]?.event_id);
});

it("« Relire l'analyse » après un conflit est un nouvel affichage : un second événement, avec un identifiant neuf", async () => {
  const { fetcher } = open({ [FICHE]: withPermissions(route("lire"), ALL), [`DELETE ${ROOT}/${ID}?expected_revision=1`]: route("refus-revision-conflit") });
  await userEvent.click(await screen.findByRole("button", { name: "Supprimer" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirmer la suppression" }));
  await userEvent.click(await screen.findByRole("button", { name: "Relire l'analyse" }));
  await waitFor(() => { expect(opened(fetcher)).toHaveLength(2); });
  const sent = events(fetcher);
  expect(sent.map((event) => event.revision)).toEqual([1, 1]);
  expect(sent[0]?.event_id).toMatch(UUID);
  expect(sent[1]?.event_id).toMatch(UUID);
  expect(sent[0]?.event_id).not.toBe(sent[1]?.event_id);
});

it("l'échec de l'événement n'abîme pas l'écran", async () => {
  const { fetcher, container } = open({ [FICHE]: route("lire"), [OPENED]: route("refus-ouverture-introuvable") });
  await screen.findByRole("heading", { name: "Chiffre d'affaires" });
  await waitFor(() => { expect(opened(fetcher)).toHaveLength(1); });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(container).toHaveTextContent("Connexion");
});

it("un événement qui lève une exception n'abîme pas non plus l'écran", async () => {
  const served = analysesServer({ [FICHE]: route("lire") });
  const fetcher = (url: string, init?: RequestInit) => (init?.method === "POST" ? Promise.reject(new Error("réseau coupé")) : served(url, init));
  render(<AnalysePage space={space} id={ID} revision={undefined} fetcher={fetcher} />);
  await screen.findByRole("heading", { name: "Chiffre d'affaires" });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("aucun événement n'est consigné quand l'analyse n'a pas été lue", async () => {
  const { fetcher } = open({ [FICHE]: route("refus-analyse-inconnue") });
  await screen.findByRole("alert");
  expect(opened(fetcher)).toHaveLength(0);
});

it.each([
  ["refus-analyse-inconnue", "introuvable ou ne vous est pas accessible"],
  ["refus-depot-indisponible", "Le dépôt des analyses est indisponible."],
  ["refus-interdit", "Votre rôle ne permet pas cette action."],
])("la lecture refusée (%s) s'affiche telle quelle, sans fiche", async (name, text) => {
  const { container } = open({ [FICHE]: route(name) });
  expect(await screen.findByRole("alert")).toHaveTextContent(text);
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Analyse");
  await expectAccessible(container);
});

it("le mode local se dit sans alarme et une panne dit qu'il n'y a rien à afficher", async () => {
  const local = open({ [FICHE]: route("refus-mode-local") });
  expect(await screen.findByText("Les analyses ne sont pas disponibles en mode local.")).toBeInTheDocument();
  local.unmount();
  open({});
  expect(await screen.findByRole("alert")).toHaveTextContent("Analyse indisponible");
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
});

it("lit une révision passée : bandeau, lien vers la courante, aucune écriture (dont Dupliquer) même si le serveur l'accorde", async () => {
  const { fetcher } = open({ [`GET ${ROOT}/${ID}/revisions/1`]: withPermissions(route("revision"), ALL) }, 1);
  await screen.findByText(/Vous lisez la révision 1 ; la révision courante est la 2\./);
  expect(screen.getByRole("link", { name: "Lire la révision courante" })).toHaveAttribute("href", `#/espaces/finance/analyses/${ID}`);
  expect(screen.getByText("Révision").nextElementSibling).toHaveTextContent("r1 sur r2");
  // Aucune écriture : Dupliquer copierait la révision courante, pas celle qu'on lit.
  for (const name of ["Dupliquer", "Supprimer", "Nouvelle révision"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  expect(screen.getByText(/ouvrez la révision courante pour dupliquer/)).toBeInTheDocument();
  await waitFor(() => { expect(opened(fetcher)).toHaveLength(1); });
  expect(events(fetcher)[0]).toMatchObject({ revision: 1 });
});

it("une analyse supprimée garde son historique lisible et n'offre aucune action de suppression ou de révision", async () => {
  open({ [`GET ${ROOT}/${ID}/revisions/1`]: route("revision-supprimee") }, 1);
  await screen.findByText(/Cette analyse est supprimée : son historique reste lisible, aucune action n'est possible\./);
  expect(screen.getByText("Révision").nextElementSibling?.textContent).toBe("r1");
  expect(screen.queryByText(/Vous lisez la révision/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Supprimer" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Nouvelle révision" })).not.toBeInTheDocument();
  expect(screen.queryByText(/ouvrez la révision courante pour dupliquer/)).not.toBeInTheDocument();
});

it("une révision numérotée invalide n'appelle pas le serveur et se dit", async () => {
  const { fetcher } = open({}, 0);
  expect(await screen.findByRole("alert")).toHaveTextContent("Le numéro de révision est invalide.");
  expect(fetcher).not.toHaveBeenCalled();
});

it("dupliquer crée la copie personnelle puis ouvre sa fiche", async () => {
  const { fetcher } = open({ [FICHE]: withPermissions(route("lire"), ALL), [`POST ${ROOT}/${ID}/duplicate`]: route("dupliquer", [[ID, OTHER_ID]]) });
  await userEvent.click(await screen.findByRole("button", { name: "Dupliquer" }));
  await waitFor(() => { expect(window.location.hash).toBe(`#/espaces/finance/analyses/${OTHER_ID}`); });
  expect(fetcher).toHaveBeenCalledWith(`${ROOT}/${ID}/duplicate`, expect.objectContaining({ method: "POST" }));
});

it("une duplication refusée ou en erreur s'affiche et reste sur la fiche", async () => {
  const refused = open({ [FICHE]: withPermissions(route("lire"), ALL), [`POST ${ROOT}/${ID}/duplicate`]: route("refus-interdit") });
  await userEvent.click(await screen.findByRole("button", { name: "Dupliquer" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Votre rôle ne permet pas cette action.");
  expect(alert.parentElement).toHaveFocus();
  expect(screen.getByRole("button", { name: "Dupliquer" })).toBeEnabled();
  expect(window.location.hash).toBe("");
  refused.unmount();
  open({ [FICHE]: withPermissions(route("lire"), ALL) });
  await userEvent.click(await screen.findByRole("button", { name: "Dupliquer" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Action non confirmée :");
  expect(window.location.hash).toBe("");
});

it("supprimer demande confirmation, annuler ne supprime rien", async () => {
  const { fetcher } = open({ [FICHE]: withPermissions(route("lire"), ALL) });
  await userEvent.click(await screen.findByRole("button", { name: "Supprimer" }));
  const group = screen.getByRole("group", { name: /Supprimer cette analyse/ });
  expect(within(group).getByRole("button", { name: "Confirmer la suppression" })).toHaveFocus();
  expect(screen.queryByRole("button", { name: "Supprimer" })).not.toBeInTheDocument();
  await userEvent.click(within(group).getByRole("button", { name: "Annuler" }));
  expect(screen.getByRole("button", { name: "Supprimer" })).toBeInTheDocument();
  expect(fetcher.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
});

it("confirmer supprime la révision lue (expected_revision), puis relit l'analyse : état supprimé, plus de révision courante ni d'action", async () => {
  const { fetcher, container } = open({
    [FICHE]: withPermissions(route("lire"), ALL), [`DELETE ${ROOT}/${ID}?expected_revision=1`]: route("supprimer"), [`GET ${ROOT}/${ID}/revisions/1`]: route("revision-supprimee"),
  });
  await userEvent.click(await screen.findByRole("button", { name: "Supprimer" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirmer la suppression" }));
  expect(await screen.findByText(/Cette analyse est supprimée : son historique reste lisible, aucune action n'est possible\./)).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledWith(`${ROOT}/${ID}?expected_revision=1`, expect.objectContaining({ method: "DELETE" }));
  expect(fetcher).toHaveBeenCalledWith(`${ROOT}/${ID}/revisions/1`, expect.anything());
  expect(screen.getByText("Révision").nextElementSibling?.textContent).toBe("r1");
  for (const name of ["Dupliquer", "Supprimer", "Nouvelle révision", "Confirmer la suppression"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  expect(screen.queryByText(/sur r1/)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Retour aux analyses" })).toBeInTheDocument();
  // Une analyse supprimée n'est pas ouverte : seul l'affichage d'avant la suppression a consigné un événement.
  expect(events(fetcher)).toHaveLength(1);
  await expectAccessible(container);
});

it("supprimer depuis l'adresse d'une révision numérotée courante relit aussi : état supprimé, plus de bouton Supprimer", async () => {
  const URL_R2 = `GET ${ROOT}/${ID}/revisions/2`;
  let reads = 0;
  const current = withPermissions(changed(route("revision"), "body.revision", 2), ALL);
  const { fetcher } = open({
    [URL_R2]: () => { reads += 1; return reads === 1 ? current : changed(route("revision-supprimee"), "body.revision", 2); },
    [`DELETE ${ROOT}/${ID}?expected_revision=2`]: route("supprimer"),
  }, 2);
  await userEvent.click(await screen.findByRole("button", { name: "Supprimer" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirmer la suppression" }));
  expect(await screen.findByText(/Cette analyse est supprimée : son historique reste lisible/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Supprimer" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Dupliquer" })).not.toBeInTheDocument();
  expect(reads).toBe(2);
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
});

it("si la relecture après une suppression réussie est refusée (404 pour un administrateur non propriétaire), la suppression reste confirmée", async () => {
  const { container } = open({
    [FICHE]: withPermissions(route("lire"), ALL), [`DELETE ${ROOT}/${ID}?expected_revision=1`]: route("supprimer"), [`GET ${ROOT}/${ID}/revisions/1`]: route("refus-analyse-inconnue"),
  });
  await userEvent.click(await screen.findByRole("button", { name: "Supprimer" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirmer la suppression" }));
  const banner = await screen.findByText(/Analyse supprimée\. Elle n'est plus visible que de son propriétaire\./);
  expect(banner).toBeInTheDocument();
  expect(within(banner.closest(".sb-banner") as HTMLElement).getByRole("link", { name: "Retour aux analyses" })).toHaveAttribute("href", "#/espaces/finance/analyses");
  expect(screen.queryByText(/introuvable ou ne vous est pas accessible/)).not.toBeInTheDocument();
  // L'ancien contenu n'est plus affiché.
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Supprimer" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Chiffre d'affaires" })).not.toBeInTheDocument();
  await expectAccessible(container);
});

it("si la relecture après une suppression réussie échoue autrement, la suppression est dite et l'échec aussi", async () => {
  open({ [FICHE]: withPermissions(route("lire"), ALL), [`DELETE ${ROOT}/${ID}?expected_revision=1`]: route("supprimer") });
  await userEvent.click(await screen.findByRole("button", { name: "Supprimer" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirmer la suppression" }));
  await screen.findByText(/Analyse supprimée\. Sa relecture a échoué, l'ancien contenu n'est plus affiché\./);
  expect(screen.getByRole("alert")).toHaveTextContent("Analyse indisponible");
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
});

it("la suppression envoie la révision lue et non un 1 constant, depuis une révision courante supérieure à 1", async () => {
  const { fetcher } = open({ [FICHE]: withPermissions(route("lire-index-perime"), ALL), [`DELETE ${ROOT}/${ID}?expected_revision=2`]: route("supprimer"), [`GET ${ROOT}/${ID}/revisions/2`]: changed(route("revision-supprimee"), "body.revision", 2) });
  await userEvent.click(await screen.findByRole("button", { name: "Supprimer" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirmer la suppression" }));
  await screen.findByText(/Cette analyse est supprimée/);
  const sent = fetcher.mock.calls.filter(([, init]) => init?.method === "DELETE").map(([url]) => url);
  expect(sent).toEqual([`${ROOT}/${ID}?expected_revision=2`]);
  expect(fetcher).toHaveBeenCalledWith(`${ROOT}/${ID}/revisions/2`, expect.anything());
});

it("une analyse encore utilisée refuse la suppression et nomme ses consommateurs", async () => {
  open({ [FICHE]: withPermissions(route("lire"), ALL), [`DELETE ${ROOT}/${ID}?expected_revision=1`]: route("refus-analyse-utilisee") });
  await userEvent.click(await screen.findByRole("button", { name: "Supprimer" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirmer la suppression" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Cette analyse est encore utilisée");
  expect(alert).toHaveTextContent(`Consommateurs : dashboard ${ID}.`);
  expect(screen.queryByText(/Analyse supprimée/)).not.toBeInTheDocument();
  expect(screen.queryByRole("group", { name: /Supprimer cette analyse/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Supprimer" })).toBeInTheDocument();
});

it("un conflit de révision propose de relire l'analyse, qui est alors relue", async () => {
  let reads = 0;
  const { fetcher } = open({
    [FICHE]: () => { reads += 1; return reads === 1 ? withPermissions(route("lire"), ALL) : withPermissions(route("lire"), { owner: false, revise: false, delete: false, duplicate: false }); },
    [`DELETE ${ROOT}/${ID}?expected_revision=1`]: route("refus-revision-conflit"),
  });
  await userEvent.click(await screen.findByRole("button", { name: "Supprimer" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirmer la suppression" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Une autre révision a été enregistrée entre-temps");
  await userEvent.click(screen.getByRole("button", { name: "Relire l'analyse" }));
  await waitFor(() => { expect(screen.queryByRole("button", { name: "Supprimer" })).not.toBeInTheDocument(); });
  expect(fetcher.mock.calls.filter(([url, init]) => url === `${ROOT}/${ID}` && (init?.method ?? "GET") === "GET")).toHaveLength(2);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("une suppression en erreur ne dit pas qu'elle a réussi", async () => {
  open({ [FICHE]: withPermissions(route("lire"), ALL) });
  await userEvent.click(await screen.findByRole("button", { name: "Supprimer" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirmer la suppression" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Action non confirmée :");
  expect(screen.queryByText(/Analyse supprimée/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Relire l'analyse" })).not.toBeInTheDocument();
});
