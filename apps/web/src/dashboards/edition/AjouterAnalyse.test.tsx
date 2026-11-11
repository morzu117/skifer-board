import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { ID } from "../../analyses/testing";
import { ANALYSES, N, openEditor, ROOT, type AnalysisSpec } from "./testing";

const ouvrir = async () => {
  const view = openEditor({ analyses: { ...ANALYSES, [N.bars]: { ...ANALYSES[N.bars] as AnalysisSpec, current: 2 } } });
  await screen.findByRole("heading", { name: "Pilotage", level: 1 });
  await waitFor(() => { expect(view.server.submitted()).toHaveLength(2); });
  return view;
};
const dialogue = () => screen.getByRole("dialog", { name: "Ajouter une analyse" });
const barre = () => screen.getByRole("toolbar", { name: "Actions de l'éditeur" });

it("ajoute une révision en colonne, exécute sa requête et annule en une étape", async () => {
  const { server } = await ouvrir();
  await userEvent.click(screen.getByRole("button", { name: /^Colonne 1 · 4/ }));
  await userEvent.click(screen.getByRole("button", { name: "Ajouter une analyse" }));
  await userEvent.type(within(dialogue()).getByRole("textbox", { name: "Rechercher une analyse" }), "région");
  await userEvent.click(await within(dialogue()).findByRole("button", { name: /Chiffre d'affaires par région/ }));
  expect(await within(dialogue()).findByText(/Modèle : sales/)).toBeInTheDocument();
  expect(within(dialogue()).getByRole("combobox", { name: "Révision" })).toHaveValue("2");
  await userEvent.selectOptions(within(dialogue()).getByRole("combobox", { name: "Révision" }), "1");
  await userEvent.selectOptions(within(dialogue()).getByRole("combobox", { name: "Révision" }), "2");
  await within(dialogue()).findByText(/Modèle : sales/);
  expect(within(dialogue()).queryByRole("radio", { name: "KPI" })).not.toBeInTheDocument();
  await userEvent.click(within(dialogue()).getByRole("button", { name: /^Ajouter$/ }));
  expect(screen.queryByRole("dialog", { name: "Ajouter une analyse" })).not.toBeInTheDocument();
  await waitFor(() => { expect(server.fetcher.mock.calls.filter(([url]) => url === `${ROOT}/analyses/${N.bars}/revisions/1`).length).toBeGreaterThan(0); });
  expect(screen.getAllByRole("button", { name: /^Visuel · Chiffre/ })).toHaveLength(2);
  await waitFor(() => { expect(server.submitted()).toHaveLength(3); });
  expect(server.submitted()[2]).toMatchObject({ analysis: { id: N.bars, revision: 2 }, filters: [{ column: "region", operator: "in", value: ["Nord", "Sud"] }] });
  await userEvent.click(within(barre()).getByRole("button", { name: "Annuler" }));
  expect(screen.getAllByRole("button", { name: /^Visuel · Chiffre/ })).toHaveLength(1);
  await userEvent.click(within(barre()).getByRole("button", { name: "Rétablir" }));
  expect(screen.getAllByRole("button", { name: /^Visuel · Chiffre/ })).toHaveLength(2);
  await userEvent.click(screen.getByRole("tab", { name: /^Filtres/ }));
  await userEvent.click(screen.getByRole("button", { name: "Nouveau filtre" }));
  await userEvent.type(screen.getByRole("textbox", { name: "Libellé" }), "Filtre ajouté");
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Dimension" }), "region:string");
  await userEvent.type(screen.getByRole("textbox", { name: "Valeur par défaut" }), "Nord");
  await userEvent.click(screen.getAllByRole("checkbox", { name: /Visuel · Chiffre/ })[1] as HTMLElement);
  await userEvent.click(screen.getByRole("button", { name: "Ajouter le filtre" }));
  await waitFor(() => { expect(server.submitted()).toHaveLength(4); });
  expect(server.submitted()[3]).toMatchObject({ analysis: { id: N.bars, revision: 2 }, filters: [{ column: "region", operator: "in", value: ["Nord", "Sud"] }, { column: "region", operator: "eq", value: "Nord" }] });
});

it("ajoute un KPI dans une rangée et colonne créées ensemble, au raccourci clavier", async () => {
  await ouvrir();
  await userEvent.click(screen.getByRole("button", { name: /^Section 2/ }));
  fireEvent.keyDown(screen.getByRole("button", { name: /^Section 2/ }), { key: "A", ctrlKey: true, shiftKey: true });
  await userEvent.click(await within(dialogue()).findByRole("button", { name: /Total · Partagée/ }));
  await userEvent.click(await within(dialogue()).findByRole("radio", { name: "KPI" }));
  await userEvent.click(within(dialogue()).getByRole("button", { name: /^Ajouter$/ }));
  expect(screen.getAllByRole("button", { name: /^KPI · Total/ })).toHaveLength(2);
  await userEvent.click(within(barre()).getByRole("button", { name: "Annuler" }));
  expect(screen.getAllByRole("button", { name: /^KPI · Total/ })).toHaveLength(1);
  await userEvent.click(within(barre()).getByRole("button", { name: "Rétablir" }));
  expect(screen.getAllByRole("button", { name: /^KPI · Total/ })).toHaveLength(2);
});

it("un refus de liste se lit et le dialogue se ferme", async () => {
  openEditor({ overrides: { [`GET ${ROOT}/analyses`]: Response.json({ error: { code: "forbidden" } }, { status: 403 }) } });
  await screen.findByRole("heading", { name: "Pilotage", level: 1 });
  await userEvent.click(screen.getByRole("button", { name: "Ajouter une analyse" }));
  expect(await within(dialogue()).findByText(/Analyses indisponibles/)).toBeInTheDocument();
  await userEvent.click(within(dialogue()).getByRole("button", { name: "Fermer" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("annonce les lectures en cours et leurs refus", async () => {
  const view = openEditor({ overrides: {
    [`GET ${ROOT}/analyses/${N.bars}/revisions`]: Response.json({ error: { code: "forbidden" } }, { status: 403 }),
    [`GET ${ROOT}/analyses/${N.bars}/revisions/1`]: Response.json({ error: { code: "forbidden" } }, { status: 403 }),
  } });
  await screen.findByRole("heading", { name: "Pilotage", level: 1 });
  await userEvent.click(screen.getByRole("button", { name: "Ajouter une analyse" }));
  await userEvent.click(await within(dialogue()).findByRole("button", { name: /Chiffre d'affaires par région/ }));
  expect(await within(dialogue()).findByText(/Historique indisponible/)).toBeInTheDocument();
  expect(await within(dialogue()).findByText(/Analyse indisponible/)).toBeInTheDocument();
  expect(within(dialogue()).queryByRole("button", { name: /^Ajouter$/ })).not.toBeInTheDocument();
  view.unmount();
});

it("sans section, refuse l'ajout sans fermer le dialogue", async () => {
  const { decodeDashboardDraft } = await import("../document");
  const { sampleDraft } = await import("./testing");
  openEditor({ draft: decodeDashboardDraft({ ...sampleDraft(), filters: [], layout: { sections: [] } }), tiles: [] });
  await screen.findByRole("heading", { name: "Pilotage", level: 1 });
  await userEvent.click(screen.getByRole("button", { name: "Ajouter une analyse" }));
  await userEvent.click(await within(dialogue()).findByRole("button", { name: /Total · Partagée/ }));
  await within(dialogue()).findByRole("radio", { name: "KPI" });
  await userEvent.click(within(dialogue()).getByRole("radio", { name: "KPI" }));
  await userEvent.click(within(dialogue()).getByRole("radio", { name: "Visuel" }));
  await userEvent.click(within(dialogue()).getByRole("button", { name: /^Ajouter$/ }));
  expect(screen.getByText("Ajoutez ou sélectionnez d'abord une section.")).toBeInTheDocument();
  expect(dialogue()).toBeInTheDocument();
});

it("signale une analyse personnelle dans un dashboard partagé", async () => {
  openEditor({ analyses: { ...ANALYSES, [N.bars]: { ...ANALYSES[N.bars] as AnalysisSpec, visibility: "personal" } } });
  await screen.findByRole("heading", { name: "Pilotage", level: 1 });
  expect(await screen.findByText(/Ce dashboard partagé référence une analyse personnelle/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Ajouter une analyse" }));
  await userEvent.click(await within(dialogue()).findByRole("button", { name: /Chiffre d'affaires par région · Personnelle/ }));
  expect(await within(dialogue()).findByText(/Une analyse personnelle ne peut pas/)).toBeInTheDocument();
});

it("dit quand la recherche est vide et affiche l'état non vérifié de l'analyse", async () => {
  openEditor({ analyses: { ...ANALYSES, [N.bars]: { ...ANALYSES[N.bars] as AnalysisSpec, state: "unverified" } } });
  await screen.findByRole("heading", { name: "Pilotage", level: 1 });
  await userEvent.click(screen.getByRole("button", { name: "Ajouter une analyse" }));
  const search = within(dialogue()).getByRole("textbox", { name: "Rechercher une analyse" });
  await userEvent.type(search, "Introuvable");
  expect(await within(dialogue()).findByText("Aucune analyse ne correspond à la recherche.")).toBeInTheDocument();
  await userEvent.clear(search);
  await userEvent.click(await within(dialogue()).findByRole("button", { name: /Chiffre d'affaires par région/ }));
  expect(await within(dialogue()).findByText(/Non vérifiée : Le catalogue/)).toBeInTheDocument();
});

it("choisit la révision courante de l'historique quand la liste est en retard", async () => {
  const { route } = await import("../../analyses/testing");
  const listed = route("lister", [[ID, N.bars]]).body as { analyses: Record<string, unknown>[] };
  const view = openEditor({ analyses: { ...ANALYSES, [N.bars]: { ...ANALYSES[N.bars] as AnalysisSpec, current: 2 } }, overrides: { [`GET ${ROOT}/analyses`]: Response.json(listed) } });
  await screen.findByRole("heading", { name: "Pilotage", level: 1 });
  await userEvent.click(screen.getByRole("button", { name: "Ajouter une analyse" }));
  await userEvent.click(await within(dialogue()).findByRole("button", { name: /Chiffre d'affaires/ }));
  await waitFor(() => { expect(within(dialogue()).getByRole("combobox", { name: "Révision" })).toHaveValue("2"); });
  await waitFor(() => { expect(view.server.fetcher.mock.calls.some(([url]) => url === `${ROOT}/analyses/${N.bars}/revisions/2`)).toBe(true); });
});

it("enregistre l'épingle r1 choisie alors que la révision courante est r2", async () => {
  const { server } = await ouvrir();
  await userEvent.click(screen.getByRole("button", { name: "Ajouter une analyse" }));
  await userEvent.click(await within(dialogue()).findByRole("button", { name: /Chiffre d'affaires par région/ }));
  const revision = await within(dialogue()).findByRole("combobox", { name: "Révision" });
  expect(revision).toHaveValue("2");
  await userEvent.selectOptions(revision, "1");
  await userEvent.click(within(dialogue()).getByRole("button", { name: /^Ajouter$/ }));
  await userEvent.click(within(barre()).getByRole("button", { name: "Enregistrer" }));
  await waitFor(() => { expect(server.saved()).toHaveLength(1); });
  const sent = server.saved()[0] as { layout: { sections: { rows: { columns: { children: { reference?: { analysis_id: string; revision: number } }[] }[] }[] }[] } };
  const children = sent.layout.sections.flatMap((section) => section.rows.flatMap((row) => row.columns.flatMap((column) => column.children)));
  expect(children.filter((node) => node.reference?.analysis_id === N.bars).map((node) => node.reference?.revision)).toEqual([1, 1]);
});
