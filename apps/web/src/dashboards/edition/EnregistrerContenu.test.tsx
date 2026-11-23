import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import componentExample from "../../../../../contracts/components/routes/creer.json";
import templateExample from "../../../../../contracts/page_templates/routes/creer.json";
import extraction from "../../../../../contracts/page_templates/extraction/dashboard-vers-modele.json";
import { decodeDashboard, type ExecutableComponent } from "../document";
import type { Fetch } from "../../spaces/api";
import { EnregistrerContenu } from "./EnregistrerContenu";
import { referenceKey } from "./useReferenceStates";
import { decodeComponent } from "../../components-lib/document";

const id = "00000000-0000-4000-8000-000000000001";
const owner = { issuer: "https://id.example.invalid", subject: "cora" };
const dashboard = decodeDashboard(extraction.dashboard);
const component = decodeComponent(extraction.components[0]?.document);
const refs = { [referenceKey({ kind: "component", id: component.id, revision: 2 })]: component };
const node: ExecutableComponent = { id, type: "analysis", reference: { analysis_id: id, revision: 2 }, presentation: { title: "Ventes", chart: "bars" } };
function server(kind: "modele" | "composant", refused = false) {
  return vi.fn<Fetch>().mockImplementation((_url, init) => {
    if (refused) return Promise.resolve(Response.json({ error: { code: "forbidden", required: "creator" } }, { status: 403 }));
    const draft = JSON.parse(init?.body as string) as Record<string, unknown>;
    const body = JSON.parse(JSON.stringify(kind === "modele" ? templateExample.body : componentExample.body).replaceAll("<uuid>", id).replaceAll("<commit>", "a".repeat(40))) as Record<string, unknown>;
    body[kind === "modele" ? "page_template" : "component"] = { ...draft, id, owner, api_version: kind === "modele" ? "board.page_template/v1" : "board.component/v1" };
    return Promise.resolve(Response.json(body, { status: 201, headers: { ETag: `"${"a".repeat(40)}"` } }));
  });
}
for (const kind of ["modele", "composant"] as const) {
  it(`${kind} : crée un brouillon indépendant et fournit le lien`, async () => {
    const fetcher = server(kind);
    const original = structuredClone(dashboard);
    render(kind === "modele" ? <EnregistrerContenu kind="modele" space="finance" fetcher={fetcher} dashboard={dashboard} components={refs} reason={null} /> : <EnregistrerContenu kind="composant" space="finance" fetcher={fetcher} node={node} analysisName="Analyse" reason={null} />);
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer comme/ }));
    const dialog = screen.getByRole("dialog"); expect(within(dialog).getByRole("textbox", { name: "Nom" })).toHaveValue(kind === "modele" ? "Pilotage" : "Ventes");
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Nom" })); await userEvent.type(within(dialog).getByRole("textbox", { name: "Nom" }), "Mon contenu");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Description" }), "Description");
    await userEvent.click(within(dialog).getByRole("button", { name: "Créer" }));
    const link = await screen.findByRole("link", { name: /Ouvrir la fiche/ }); expect(link).toHaveAttribute("href", `#/espaces/finance/${kind === "modele" ? "modeles" : "composants"}/${id}`);
    const sent = JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string) as Record<string, unknown>;
    expect(sent).toMatchObject({ name: "Mon contenu", description: "Description" });
    if (kind === "composant") expect(sent).toMatchObject({ kind: "visual", analysis: node.reference, presentation: node.presentation });
    expect(dashboard).toEqual(original);
  });
  it(`${kind} : garde et refus serveur`, async () => {
    const fetcher = server(kind, true);
    const props = kind === "modele" ? { kind, space: "finance", fetcher, dashboard, components: refs, reason: "Modifications non enregistrées." } as const : { kind, space: "finance", fetcher, node, analysisName: "Analyse", reason: "Modifications non enregistrées." } as const;
    const view = render(<EnregistrerContenu {...props} />);
    expect(screen.getByRole("button", { name: /Enregistrer comme/ })).toBeDisabled(); expect(screen.getByText("Modifications non enregistrées.")).toBeInTheDocument();
    view.rerender(<EnregistrerContenu {...props} reason={null} />);
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer comme/ })); await userEvent.click(screen.getByRole("button", { name: "Créer" }));
    expect(await screen.findByText(/Accès refusé · rôle requis : Créateur/)).toBeInTheDocument(); expect(fetcher).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape}"); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
}
it("refuse localement un composant non résolu", async () => {
  const fetcher = server("modele"); render(<EnregistrerContenu kind="modele" space="finance" fetcher={fetcher} dashboard={dashboard} components={{}} reason={null} />);
  await userEvent.click(screen.getByRole("button", { name: /Enregistrer comme/ })); await userEvent.click(screen.getByRole("button", { name: "Créer" }));
  expect(screen.getByText(/composant référencé est indisponible/)).toBeInTheDocument(); expect(fetcher).not.toHaveBeenCalled();
});
it("refuse une référence incohérente sans appel serveur", async () => {
  const fetcher = server("modele"); render(<EnregistrerContenu kind="modele" space="finance" fetcher={fetcher} dashboard={dashboard} components={{ [Object.keys(refs)[0] as string]: { ...component, id } }} reason={null} />);
  await userEvent.click(screen.getByRole("button", { name: /Enregistrer comme/ })); await userEvent.click(screen.getByRole("button", { name: "Créer" }));
  expect(screen.getByText(/ne correspond pas à la référence/)).toBeInTheDocument(); expect(fetcher).not.toHaveBeenCalled();
});
it("préremplit le nom de l'analyse et empêche le nom vide", async () => {
  const fetcher = server("composant"); render(<EnregistrerContenu kind="composant" space="finance" fetcher={fetcher} node={{ ...node, presentation: {} }} analysisName="Analyse" reason={null} />);
  const opener = screen.getByRole("button", { name: /Enregistrer comme/ }); await userEvent.click(opener);
  const input = screen.getByRole("textbox", { name: "Nom" }); expect(input).toHaveValue("Analyse"); await userEvent.clear(input); expect(screen.getByRole("button", { name: "Créer" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Annuler" })); await waitFor(() => { expect(opener).toHaveFocus(); });
});
it("n'envoie qu'une création et signale une erreur réseau", async () => {
  let finish: (response: Response) => void = () => undefined;
  const fetcher = vi.fn<Fetch>().mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<EnregistrerContenu kind="composant" space="finance" fetcher={fetcher} node={node} analysisName="Analyse" reason={null} />);
  await userEvent.click(screen.getByRole("button", { name: /Enregistrer comme/ }));
  const create = screen.getByRole("button", { name: "Créer" }); act(() => { fireEvent.click(create); fireEvent.click(create); }); fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); expect(screen.getByRole("dialog")).toBeInTheDocument();
  finish(new Response("erreur", { status: 500 })); expect(await screen.findByText(/hors contrat/)).toBeInTheDocument(); expect(fetcher).toHaveBeenCalledTimes(1);
});

it("enregistre un KPI avec sa seule présentation locale", async () => {
  const fetcher = server("composant");
  const kpi: ExecutableComponent = { id, type: "kpi", reference: { analysis_id: id, revision: 2 }, presentation: { number_format: "integer" } };
  render(<EnregistrerContenu kind="composant" space="finance" fetcher={fetcher} node={kpi} analysisName="Total" reason={null} />);
  await userEvent.click(screen.getByRole("button", { name: /Enregistrer comme/ })); await userEvent.click(screen.getByRole("button", { name: "Créer" }));
  expect(await screen.findByRole("link", { name: /Ouvrir la fiche/ })).toBeInTheDocument();
  expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toMatchObject({ kind: "kpi", presentation: { number_format: "integer" } });
});

it("présente les violations du refus serveur sans réessai", async () => {
  const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json({ error: { code: "invalid_component", reason: "missing_field", violations: [{ path: "/name", rule: "missing_field" }] } }, { status: 422 }));
  render(<EnregistrerContenu kind="composant" space="finance" fetcher={fetcher} node={node} analysisName="Analyse" reason={null} />);
  await userEvent.click(screen.getByRole("button", { name: /Enregistrer comme/ })); await userEvent.click(screen.getByRole("button", { name: "Créer" }));
  expect(await screen.findByRole("listitem")).toHaveTextContent("Nom : champ manquant"); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("présente les références personnelles refusées par le serveur", async () => {
  const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json({ error: { code: "personal_reference", components: [id] } }, { status: 409 }));
  render(<EnregistrerContenu kind="composant" space="finance" fetcher={fetcher} node={node} analysisName="Analyse" reason={null} />);
  await userEvent.click(screen.getByRole("button", { name: /Enregistrer comme/ })); await userEvent.click(screen.getByRole("button", { name: "Créer" }));
  expect(await screen.findByText(new RegExp(`Références concernées : ${id}`))).toBeInTheDocument(); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("conserve une règle propre aux modèles dans le refus", async () => {
  const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json({ error: { code: "invalid_page_template", reason: "duplicate_id", violations: [{ path: "/layout/0/particulier", rule: "duplicate_id" }] } }, { status: 422 }));
  render(<EnregistrerContenu kind="modele" space="finance" fetcher={fetcher} dashboard={dashboard} components={refs} reason={null} />);
  await userEvent.click(screen.getByRole("button", { name: /Enregistrer comme/ })); await userEvent.click(screen.getByRole("button", { name: "Créer" }));
  expect(await screen.findByRole("listitem")).toHaveTextContent("Structure · 1 · particulier : identifiant répété"); expect(fetcher).toHaveBeenCalledTimes(1);
});

it("garde la raison d'un conflit renvoyé par le serveur", async () => {
  const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json({ error: { code: "revision_conflict", reason: "stale" } }, { status: 409 }));
  render(<EnregistrerContenu kind="composant" space="finance" fetcher={fetcher} node={node} analysisName="Analyse" reason={null} />);
  await userEvent.click(screen.getByRole("button", { name: /Enregistrer comme/ })); await userEvent.click(screen.getByRole("button", { name: "Créer" }));
  expect(await screen.findByText(/Conflit de révision · raison : révision périmée/)).toBeInTheDocument();
});
it("affiche l'échec de validation de l'extraction sans appel serveur", async () => {
  const fetcher = server("modele");
  const invalid = { ...dashboard, description: "x".repeat(2001) };
  render(<EnregistrerContenu kind="modele" space="finance" fetcher={fetcher} dashboard={invalid} components={refs} reason={null} />);
  await userEvent.click(screen.getByRole("button", { name: "Enregistrer comme modèle" }));
  await userEvent.click(screen.getByRole("button", { name: "Créer" }));
  expect(screen.getByText(/Le modèle extrait est invalide/)).toBeInTheDocument(); expect(fetcher).not.toHaveBeenCalled();
});
