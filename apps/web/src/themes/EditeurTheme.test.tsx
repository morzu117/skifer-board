import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import espace from "../../../../contracts/espaces/espace.json";
import interdit from "../../../../contracts/themes/routes/refus-interdit.json";
import lire from "../../../../contracts/themes/routes/lire.json";
import { decodeSpace } from "../spaces/model";
import type { Fetch } from "../spaces/api";
import { decodeThemeRevision } from "./model";
import { defaultThemeDraft } from "./defaultDraft";
import { EditeurTheme, ThemeEditorPage } from "./EditeurTheme";

const space = decodeSpace(espace.body, "espace");
it("édite les champs et affiche les problèmes sans remplacer les tokens", async () => {
  const user = userEvent.setup();
  render(<EditeurTheme space="finance" initial={defaultThemeDraft()} />);
  await user.type(screen.getByLabelText("Nom"), "x");
  await user.selectOptions(screen.getByLabelText("Série"), "ink");
  await user.selectOptions(screen.getByLabelText("Texte", { selector: "select" }), "ink");
  await user.selectOptions(screen.getByLabelText("Base"), "skifer-ardoise");
  expect(screen.getByRole("heading", { name: "Problèmes" })).toBeInTheDocument();
  expect(screen.getAllByText(/enregistré, pas encore rendu/)).toHaveLength(4);
  await user.selectOptions(screen.getByLabelText("Base"), "skifer-clair");
  await user.click(screen.getByText("Palettes", { selector: "summary" }));
  await user.selectOptions(screen.getByLabelText("Palier à ajouter Catégorielle"), "ink");
  await user.click(screen.getByRole("button", { name: "Ajouter Catégorielle" }));
  await user.click(screen.getByRole("button", { name: "Monter le palier 2 de la palette catégorielle" }));
  await user.click(screen.getByRole("button", { name: "Descendre le palier 1 de la palette catégorielle" }));
  await user.click(screen.getByRole("button", { name: "Retirer le palier 1 de la palette catégorielle" }));
  await user.click(screen.getByText("Typographie et densité", { selector: "summary" }));
  await user.selectOptions(screen.getByLabelText("Échelle"), "large");
  await user.selectOptions(screen.getByLabelText("Densité"), "airy");
  await user.click(screen.getByText("Formats", { selector: "summary" }));
  await user.selectOptions(screen.getByLabelText("Nombres"), "integer");
  expect(screen.getByText("Court : rendu actuel, AAAA-MM-JJ")).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Dates"), "iso");
  await user.click(screen.getByText("Défauts des graphiques", { selector: "summary" }));
  await user.selectOptions(screen.getByLabelText("Valeur · Légende"), "shown");
  await user.selectOptions(screen.getByLabelText("Valeur · Légende"), "");
  for (let i = 0; i < 8; i++) { const button = screen.getByRole("button", { name: "Ajouter Catégorielle" }); if (!button.hasAttribute("disabled")) await user.click(button); }
  for (let i = 0; i < 8; i++) { const button = screen.getByRole("button", { name: "Retirer le palier 1 de la palette catégorielle" }); if (!button.hasAttribute("disabled")) await user.click(button); }
  await user.click(screen.getByRole("button", { name: "Skifer ardoise" }));
});
it("lit un thème ou rend son échec", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const body = JSON.parse(JSON.stringify(lire.body).replaceAll("<uuid>", id).replaceAll("<commit>", "a".repeat(40))) as unknown;
  const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json(body, { headers: { ETag: `"${'a'.repeat(40)}"` } }));
  const view = render(<ThemeEditorPage space={space} id={id} identity="a" fetcher={fetcher} />);
  expect(screen.getByRole("status")).toHaveTextContent("Lecture du thème");
  await screen.findByRole("heading", { name: "Éditeur de thème" });
  view.unmount();
  render(<ThemeEditorPage space={space} id={id} identity="a" fetcher={vi.fn<Fetch>().mockResolvedValue(new Response("panne", { status: 500 }))} />);
  expect(await screen.findByText(/Thème indisponible/)).toBeInTheDocument();
  view.unmount();
});

it("affiche le refus de lecture", async () => {
  render(<ThemeEditorPage space={space} id="00000000-0000-4000-8000-000000000001" identity="a" fetcher={vi.fn<Fetch>().mockResolvedValue(Response.json(interdit.body, { status: interdit.status }))} />);
  expect(await screen.findByText(/Accès refusé/)).toBeInTheDocument();
});

it("accepte un nom vide et explique les refus de déplacement", async () => {
  const user = userEvent.setup();
  render(<EditeurTheme space="finance" initial={defaultThemeDraft()} />);
  const name = screen.getByLabelText("Nom");
  expect(screen.getByText("Non enregistré")).toBeInTheDocument();
  await user.clear(name);
  expect(screen.getByText("Modifié")).toBeInTheDocument();
  expect(name).toHaveValue("");
  expect(screen.getByText(/Nom requis/).parentElement).toHaveTextContent("/name");
  await user.type(name, "Nouveau");
  expect(screen.queryByText(/Nom requis/)).not.toBeInTheDocument();
  await user.click(screen.getByText("Palettes", { selector: "summary" }));
  const middle = screen.getByLabelText("Divergente · palier 2");
  expect(within(middle).getByRole("option", { name: /^surface ·/ })).toBeInTheDocument();
  expect(within(screen.getByLabelText("Catégorielle · palier 1")).queryByRole("option", { name: /^surface ·/ })).not.toBeInTheDocument();
  expect(within(screen.getByLabelText("Séquentielle · palier 1")).getByRole("option", { name: /^surface ·/ })).toBeInTheDocument();
  await user.selectOptions(middle, "surface");
  expect(screen.getByText(/palier central doit être neutre/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Monter le palier 2 de la palette divergente" }));
  expect(screen.getByText("Ce token n’est pas admissible à cet emplacement.")).toHaveAttribute("role", "status");
  await user.selectOptions(middle, "neutral.bg");
  expect(screen.getAllByRole("status")[0]).toBeEmptyDOMElement();
});

it("annule et rétablit au clavier ou par les boutons, sauf dans les champs", async () => {
  const user = userEvent.setup();
  render(<EditeurTheme space="finance" initial={defaultThemeDraft()} />);
  const name = screen.getByLabelText("Nom");
  await user.type(name, "x");
  await user.keyboard("{Control>}z{/Control}");
  expect(name).toHaveValue("Skifer clairx");
  const undoButton = screen.getByRole("button", { name: /^Annuler$/ });
  undoButton.focus();
  await user.keyboard("{Control>}z{/Control}");
  expect(name).toHaveValue("Skifer clair");
  await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
  expect(name).toHaveValue("Skifer clairx");
  await user.click(undoButton);
  await user.keyboard("{Meta>}y{/Meta}");
  expect(name).toHaveValue("Skifer clairx");
  await user.click(undoButton);
  await user.click(screen.getByRole("button", { name: "Rétablir" }));
  expect(name).toHaveValue("Skifer clairx");
  await user.keyboard("{Meta>}z{/Meta}");
  await user.keyboard("{Meta>}{Shift>}z{/Shift}{/Meta}");
  await user.keyboard("{Control>}a{/Control}");
});

const savedId = "00000000-0000-4000-8000-000000000001";
const commitHash = "a".repeat(40);
function themeResponse(draft: unknown, number: number, approved: number | null = null) {
  const base = JSON.parse(JSON.stringify(lire.body).replaceAll("<uuid>", savedId).replaceAll("<commit>", commitHash)) as { revision: number; approved_revision: number | null; theme: Record<string, unknown> };
  base.revision = number; base.approved_revision = approved;
  const fields = { ...draft as Record<string, unknown> };
  delete fields.expected_revision;
  base.theme = { ...base.theme, ...fields };
  return Response.json(base, { status: 201, headers: { ETag: `"${commitHash}"` } });
}
function revisionResponse() {
  const body = JSON.parse(JSON.stringify(lire.body).replaceAll("<uuid>", savedId).replaceAll("<commit>", commitHash)) as unknown;
  return Response.json(body, { headers: { ETag: `"${commitHash}"` } });
}

it("enregistre une création et rejoint le thème sans garde", async () => {
  const user = userEvent.setup();
  window.history.replaceState(null, "", "/#/espaces/finance/themes/nouveau");
  const fetcher = vi.fn<Fetch>().mockImplementation((_url, options) => Promise.resolve(themeResponse(JSON.parse(options?.body as string) as unknown, 1)));
  render(<ThemeEditorPage space={space} id="nouveau" identity="a" fetcher={fetcher} />);
  await user.clear(screen.getByLabelText("Nom"));
  expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
  await user.type(screen.getByLabelText("Nom"), "Créé");
  await user.click(screen.getByRole("button", { name: "Enregistrer" }));
  await vi.waitFor(() => { expect(window.location.hash).toBe(`#/espaces/finance/themes/${savedId}`); });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([1, null])("révise avec approbation %s et libère la garde", async (approved) => {
  const user = userEvent.setup();
  const fetcher = vi.fn<Fetch>().mockImplementation((_url, options) => options?.method === "PUT" ? Promise.resolve(themeResponse(JSON.parse(options.body as string) as unknown, 2, approved)) : Promise.resolve(revisionResponse()));
  window.history.replaceState(null, "", `/#/espaces/finance/themes/${savedId}`);
  render(<ThemeEditorPage space={space} id={savedId} identity="a" fetcher={fetcher} />);
  const name = await screen.findByLabelText("Nom");
  await user.type(name, "x");
  await user.click(screen.getByRole("button", { name: "Enregistrer" }));
  const notice = await screen.findByText(/Révision r2 enregistrée en brouillon/);
  if (approved === null) expect(notice).not.toHaveTextContent("révision approuvée");
  else expect(notice).toHaveTextContent("La révision approuvée r1 reste celle des dashboards partagés.");
  expect(fetcher.mock.calls[1]?.[1]?.body).toContain('"expected_revision":1');
  await user.click(screen.getByRole("link", { name: "Retour à la liste des thèmes" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("préserve le brouillon au conflit et relit seulement sur demande", async () => {
  const user = userEvent.setup();
  const fetcher = vi.fn<Fetch>().mockImplementation((_url, options) => options?.method === "PUT" ? Promise.resolve(Response.json({ error: { code: "revision_conflict", reason: "stale" } }, { status: 409 })) : Promise.resolve(revisionResponse()));
  render(<ThemeEditorPage space={space} id={savedId} identity="a" fetcher={fetcher} />);
  await user.type(await screen.findByLabelText("Nom"), "x");
  await user.click(screen.getByRole("button", { name: "Enregistrer" }));
  expect(await screen.findByText(/Conflit de révision/)).toBeInTheDocument();
  expect(screen.getByLabelText("Nom")).toHaveValue("Clairx");
  expect(fetcher).toHaveBeenCalledTimes(2);
  await user.click(screen.getByRole("button", { name: "Recharger" }));
  expect(await screen.findByDisplayValue("Clair")).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it.each([
  ["forbidden", { code: "forbidden", required: "creator" }, "Accès refusé"],
  ["not_owner", { code: "not_owner" }, "Vous n'êtes pas propriétaire"],
  ["local_mode", { code: "local_mode" }, "Mode local"],
  ["invalid_theme", { code: "invalid_theme", reason: "missing_field", violations: [{ path: "/base", rule: "missing_field" }] }, "champ manquant"],
] as const)("affiche le refus %s sans perdre le brouillon", async (_code, error, expected) => {
  const user = userEvent.setup();
  const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json({ error }, { status: 403 }));
  render(<EditeurTheme space="finance" initial={defaultThemeDraft()} fetcher={fetcher} />);
  await user.type(screen.getByLabelText("Nom"), "x");
  await user.click(screen.getByRole("button", { name: "Enregistrer" }));
  expect(await screen.findByText(new RegExp(expected, "i"))).toBeInTheDocument();
  expect(screen.getByLabelText("Nom")).toHaveValue("Skifer clairx");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("garde le brouillon après une erreur réseau ou un contenu enregistré différent", async () => {
  const user = userEvent.setup();
  const fetcher = vi.fn<Fetch>().mockRejectedValueOnce(new Error("panne")).mockResolvedValueOnce(themeResponse({ ...defaultThemeDraft(), name: "Autre" }, 1));
  render(<EditeurTheme space="finance" initial={defaultThemeDraft()} fetcher={fetcher} />);
  await user.type(screen.getByLabelText("Nom"), "x");
  await user.click(screen.getByRole("button", { name: "Enregistrer" }));
  expect(await screen.findByText(/Enregistrement non confirmé/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Enregistrer" }));
  expect(await screen.findByText(/contenu enregistré diffère/)).toBeInTheDocument();
  expect(screen.getByLabelText("Nom")).toHaveValue("Skifer clairx");
});

it("protège la sortie du brouillon", async () => {
  const user = userEvent.setup();
  window.history.replaceState(null, "", "/#/espaces/finance/themes/nouveau");
  render(<EditeurTheme space="finance" initial={defaultThemeDraft()} />);
  await user.type(screen.getByLabelText("Nom"), "x");
  await user.click(screen.getByRole("link", { name: "Retour à la liste des thèmes" }));
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Rester" }));
  await user.click(screen.getByRole("link", { name: "Retour à la liste des thèmes" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Quitter sans enregistrer" }));
  expect(window.location.hash).toBe("#/espaces/finance/themes");
});

it("ne lance pas deux enregistrements simultanés", () => {
  const fetcher = vi.fn<Fetch>().mockImplementation(() => new Promise<Response>(() => undefined));
  render(<EditeurTheme space="finance" initial={defaultThemeDraft()} fetcher={fetcher} />);
  const button = screen.getByRole("button", { name: "Enregistrer" });
  act(() => { fireEvent.click(button); fireEvent.click(button); });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("refuse aussi une tentative forcée avec un nom vide", async () => {
  const user = userEvent.setup();
  const fetcher = vi.fn<Fetch>();
  render(<EditeurTheme space="finance" initial={defaultThemeDraft()} fetcher={fetcher} />);
  await user.clear(screen.getByLabelText("Nom"));
  const button = screen.getByRole("button", { name: "Enregistrer" });
  button.removeAttribute("disabled");
  fireEvent.click(button);
  expect(fetcher).not.toHaveBeenCalled();
});

it("lit la révision demandée sans permettre de modification", async () => {
  const user = userEvent.setup();
  const fetcher = vi.fn<Fetch>().mockResolvedValue(revisionResponse());
  render(<ThemeEditorPage space={space} id={savedId} identity="a" fetcher={fetcher} historical={1} />);
  expect(await screen.findByText(/Révision r1 en lecture seule/)).toBeInTheDocument();
  expect(screen.getByLabelText("Nom")).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Enregistrer" })).not.toBeInTheDocument();
  expect(fetcher.mock.calls[0]?.[0]).toContain("?revision=1");
  screen.getByRole("link", { name: "Historique des révisions" }).focus();
  await user.keyboard("{Control>}z{/Control}");
  expect(screen.getByLabelText("Nom")).toHaveValue("Clair");
});

const readTheme = () => ({ ...decodeThemeRevision(JSON.parse(JSON.stringify(lire.body).replaceAll("<uuid>", savedId).replaceAll("<commit>", commitHash)) as unknown, "finance"), etag: `"${commitHash}"` });
it("confirme la suppression et montre les consommateurs visibles et cachés", async () => {
  const user = userEvent.setup();
  const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json({ error: { code: "content_in_use", consumers: [{ kind: "dashboard", id: savedId }], others: 2 } }, { status: 409 }));
  const revision = readTheme();
  render(<EditeurTheme space="finance" initial={revision.theme} revision={revision} fetcher={fetcher} />);
  await user.click(screen.getByRole("button", { name: "Supprimer le thème" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Supprimer le thème « Clair » ? Ses révisions restent dans l’historique du dépôt. Les modifications non enregistrées seront perdues.");
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Annuler" }));
  expect(fetcher).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Supprimer le thème" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirmer la suppression" }));
  expect(await screen.findByText(/Thème utilisé/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: `Dashboard ${savedId}` })).toHaveAttribute("href", `#/espaces/finance/dashboards/${savedId}`);
  expect(screen.getByText("et 2 autres dashboards que vous ne voyez pas")).toBeInTheDocument();
});
it("quitte après suppression même avec un brouillon modifié", async () => {
  const user = userEvent.setup();
  window.history.replaceState(null, "", `/#/espaces/finance/themes/${savedId}`);
  const revision = readTheme();
  const fetcher = vi.fn<Fetch>().mockResolvedValue(new Response(null, { status: 204 }));
  render(<EditeurTheme space="finance" initial={revision.theme} revision={revision} fetcher={fetcher} />);
  await user.type(screen.getByLabelText("Nom"), "x");
  await user.click(screen.getByRole("button", { name: "Supprimer le thème" }));
  await user.click(screen.getByRole("button", { name: "Confirmer la suppression" }));
  await vi.waitFor(() => { expect(window.location.hash).toBe("#/espaces/finance/themes"); });
  expect(fetcher.mock.calls[0]?.[0]).toContain("?expected_revision=1");
});
it.each(["réseau", "interdit", "cachés"])("présente l'échec de suppression %s", async (mode) => {
  const user = userEvent.setup();
  const fetcher = vi.fn<Fetch>().mockImplementation(() => mode === "réseau" ? Promise.reject(new Error("panne")) : Promise.resolve(Response.json({ error: mode === "interdit" ? { code: "forbidden", required: "creator" } : { code: "content_in_use", consumers: [], others: 1 } }, { status: mode === "interdit" ? 403 : 409 })));
  const revision = readTheme();
  render(<EditeurTheme space="finance" initial={revision.theme} revision={revision} fetcher={fetcher} />);
  await user.click(screen.getByRole("button", { name: "Supprimer le thème" }));
  await user.click(screen.getByRole("button", { name: "Confirmer la suppression" }));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
});
it("montre le badge approuvé sans offrir l’approbation et masque toute action en historique", () => {
  const revision = { ...readTheme(), state: "approved" as const, approvedRevision: 1 };
  const view = render(<EditeurTheme space="finance" initial={revision.theme} revision={revision} admin onReload={vi.fn()} />);
  expect(screen.getByText("Approuvé r1")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Approuver" })).not.toBeInTheDocument();
  view.unmount();
  render(<EditeurTheme space="finance" initial={revision.theme} revision={revision} historical admin onReload={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Supprimer le thème" })).not.toBeInTheDocument();
});

it("ferme le dialogue de suppression par Échap et évite les doubles requêtes", async () => {
  const user = userEvent.setup();
  const fetcher = vi.fn<Fetch>().mockImplementation(() => new Promise<Response>(() => undefined));
  const revision = readTheme();
  render(<EditeurTheme space="finance" initial={revision.theme} revision={revision} fetcher={fetcher} />);
  await user.click(screen.getByRole("button", { name: "Supprimer le thème" }));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Supprimer le thème" }));
  const button = screen.getByRole("button", { name: "Confirmer la suppression" });
  act(() => { fireEvent.click(button); fireEvent.click(button); });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("rend le refus de suppression sans autres consommateurs", async () => {
  const user = userEvent.setup();
  const revision = readTheme();
  const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json({ error: { code: "content_in_use", consumers: [{ kind: "dashboard", id: savedId }], others: 0 } }, { status: 409 }));
  render(<EditeurTheme space="finance" initial={revision.theme} revision={revision} fetcher={fetcher} />);
  await user.click(screen.getByRole("button", { name: "Supprimer le thème" }));
  await user.click(screen.getByRole("button", { name: "Confirmer la suppression" }));
  expect(await screen.findByText(/Thème utilisé/)).toBeInTheDocument();
  expect(screen.queryByText(/autres dashboards que vous ne voyez pas/)).not.toBeInTheDocument();
});

it("empêche les modifications pendant une approbation en cours", async () => {
  const user = userEvent.setup();
  const fetcher = vi.fn<Fetch>().mockImplementation(() => new Promise<Response>(() => undefined));
  const revision = readTheme();
  render(<EditeurTheme space="finance" initial={revision.theme} revision={revision} fetcher={fetcher} admin onReload={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Approuver" }));
  expect(screen.getByLabelText("Nom")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Supprimer le thème" })).toBeDisabled();
  await user.keyboard("{Control>}z{/Control}");
});

it("ne propose pas l’approbation au créateur d’un brouillon", async () => {
  const fetcher = vi.fn<Fetch>().mockResolvedValue(revisionResponse());
  render(<ThemeEditorPage space={{ ...space, role: "creator" }} id={savedId} identity="a" fetcher={fetcher} />);
  await screen.findByRole("heading", { name: "Éditeur de thème" });
  expect(screen.queryByRole("region", { name: "Approbation du thème" })).not.toBeInTheDocument();
});
it("demande d'enregistrer avant d'approuver un brouillon modifié", async () => {
  const user = userEvent.setup();
  const revision = readTheme();
  render(<EditeurTheme space="finance" initial={revision.theme} revision={revision} admin onReload={vi.fn()} />);
  await user.type(screen.getByLabelText("Nom"), "x");
  const button = screen.getByRole("button", { name: "Approuver" });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("title", "Enregistrez les modifications avant l'approbation.");
  expect(screen.getByText("Enregistrez les modifications avant l'approbation.")).toBeInTheDocument();
});
