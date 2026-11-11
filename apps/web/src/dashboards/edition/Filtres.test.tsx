import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { decodeRevision } from "../../analyses/model";
import type { Editor } from "./EditorContext";
import type { CommonFilter } from "../document";
import { FiltreForm, ValeurFiltre } from "./Filtres";
import { ANALYSES, analysisBody, MODELS, N, sampleDraft, type AnalysisSpec } from "./testing";
import { buildTree } from "./tree";

const mock = vi.hoisted(() => ({ editor: {} as Editor }));
vi.mock("./EditorContext", () => ({ useEditor: () => mock.editor }));

beforeEach(() => {
  const pinned = decodeRevision(analysisBody(N.bars, ANALYSES[N.bars] as AnalysisSpec), "finance");
  mock.editor = { catalog: MODELS, analyses: { [N.visual]: { pinned, current: 1 } }, tree: buildTree(sampleDraft()), readOnly: false, run: vi.fn().mockReturnValue(true), select: vi.fn(), setValue: vi.fn() } as unknown as Editor;
});

it("ne propose aucune cible sans catalogue et demande une dimension", async () => {
  mock.editor = { ...mock.editor, catalog: null };
  render(<FiltreForm />);
  expect(screen.getByText("Aucune tuile compatible connue.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Ajouter le filtre" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Choisissez une dimension");
});

it("demande une cible et refuse des valeurs hors de la liste autorisée", async () => {
  render(<FiltreForm />);
  await userEvent.type(screen.getByRole("textbox", { name: "Libellé" }), "Zone");
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Dimension" }), "region:string");
  await userEvent.click(screen.getByRole("button", { name: "Ajouter le filtre" }));
  expect(screen.getByRole("alert")).toHaveTextContent("au moins une cible");
  await userEvent.click(screen.getByRole("checkbox", { name: /Visuel/ }));
  await userEvent.type(screen.getByRole("textbox", { name: "Valeur par défaut" }), "Nord");
  await userEvent.type(screen.getByRole("textbox", { name: "Valeurs autorisées" }), "Sud");
  await userEvent.click(screen.getByRole("button", { name: "Ajouter le filtre" }));
  expect(screen.getByRole("alert")).toHaveTextContent("valeur par défaut parmi les valeurs autorisées");
  expect(mock.editor.run).not.toHaveBeenCalled();
});

it("saisit une liste et une valeur numérique suivant le type du catalogue", async () => {
  const models = MODELS.map((model) => ({ ...model, dimensions: model.dimensions.map((dimension) => dimension.name === "region" ? { ...dimension, type: "number" as const } : dimension) }));
  mock.editor = { ...mock.editor, catalog: models };
  render(<FiltreForm />);
  await userEvent.type(screen.getByRole("textbox", { name: "Libellé" }), "Nombre");
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Dimension" }), "region:number");
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Opérateur" }), "between");
  await userEvent.click(screen.getByRole("checkbox", { name: /Visuel/ }));
  await userEvent.type(screen.getByRole("textbox", { name: "Valeur par défaut" }), "1{Enter}2");
  await userEvent.click(screen.getByRole("button", { name: "Ajouter le filtre" }));
  expect(mock.editor.run).toHaveBeenCalledWith({ type: "add_filter", value: { label: "Nombre", dimension: "region", operator: "between", targets: [N.visual], default: [1, 2] } }, "Filtre ajouté.");
});

it("les propriétés retirent les deux champs facultatifs et suppriment le filtre", async () => {
  const filter = { ...sampleDraft().filters[0] as CommonFilter, default: "Nord", allowed: ["Nord", "Sud"] };
  const done = vi.fn();
  render(<FiltreForm filter={filter} onDone={done} />);
  await userEvent.clear(screen.getByRole("textbox", { name: "Valeur par défaut" }));
  await userEvent.clear(screen.getByRole("textbox", { name: "Valeurs autorisées" }));
  await userEvent.click(screen.getByRole("button", { name: "Appliquer les propriétés" }));
  expect(mock.editor.run).toHaveBeenCalledWith(expect.objectContaining({ type: "update_filter", remove: ["default", "allowed"] }), "Filtre modifié.");
  await userEvent.click(screen.getByRole("button", { name: "Supprimer le filtre" }));
  expect(mock.editor.run).toHaveBeenCalledWith({ type: "delete_filter", id: filter.id }, "Filtre supprimé.");
  expect(done).toHaveBeenCalledTimes(2);
});

it("applique une liste de travail et permet d'effacer le filtre", async () => {
  const filter = { ...sampleDraft().filters[0] as CommonFilter, operator: "in" as const, default: ["Nord"] };
  const { container } = render(<ValeurFiltre filter={filter} />);
  await userEvent.clear(within(container).getByRole("textbox"));
  await userEvent.type(within(container).getByRole("textbox"), "Nord{Enter}Sud");
  await userEvent.click(screen.getByRole("button", { name: "Appliquer la valeur" }));
  expect(mock.editor.setValue).toHaveBeenCalledWith(filter.id, ["Nord", "Sud"]);
  await userEvent.click(screen.getByRole("button", { name: "Effacer le filtre" }));
  expect(mock.editor.setValue).toHaveBeenCalledWith(filter.id, null);
});

it("saisit des booléens et refuse une valeur incompatible", async () => {
  const models = MODELS.map((model) => ({ ...model, dimensions: model.dimensions.map((dimension) => dimension.name === "region" ? { ...dimension, type: "boolean" as const } : dimension) }));
  mock.editor = { ...mock.editor, catalog: models };
  render(<FiltreForm />);
  await userEvent.type(screen.getByRole("textbox", { name: "Libellé" }), "Oui ou non");
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Dimension" }), "region:boolean");
  await userEvent.click(screen.getByRole("checkbox", { name: /Visuel/ }));
  await userEvent.type(screen.getByRole("textbox", { name: "Valeur par défaut" }), "autre");
  await userEvent.click(screen.getByRole("button", { name: "Ajouter le filtre" }));
  expect(screen.getByRole("alert")).toHaveTextContent("incompatible");
  await userEvent.clear(screen.getByRole("textbox", { name: "Valeur par défaut" }));
  await userEvent.type(screen.getByRole("textbox", { name: "Valeur par défaut" }), "true");
  await userEvent.type(screen.getByRole("textbox", { name: "Valeurs autorisées" }), "true{Enter}false");
  await userEvent.click(screen.getByRole("button", { name: "Ajouter le filtre" }));
  expect(mock.editor.run).toHaveBeenCalledWith({ type: "add_filter", value: { label: "Oui ou non", dimension: "region", operator: "eq", targets: [N.visual], default: true, allowed: [true, false] } }, "Filtre ajouté.");
});

it("refuse une valeur numérique vide et une erreur inattendue sans fermer le formulaire", async () => {
  const models = MODELS.map((model) => ({ ...model, dimensions: model.dimensions.map((dimension) => dimension.name === "region" ? { ...dimension, type: "number" as const } : dimension) }));
  mock.editor = { ...mock.editor, catalog: models, run: vi.fn(() => { throw new Error("panne"); }) };
  render(<FiltreForm />);
  await userEvent.type(screen.getByRole("textbox", { name: "Libellé" }), "Nombre");
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Dimension" }), "region:number");
  await userEvent.click(screen.getByRole("checkbox", { name: /Visuel/ }));
  await userEvent.type(screen.getByRole("textbox", { name: "Valeur par défaut" }), " ");
  await userEvent.click(screen.getByRole("button", { name: "Ajouter le filtre" }));
  expect(screen.getByRole("alert")).toBeInTheDocument();
  await userEvent.clear(screen.getByRole("textbox", { name: "Valeur par défaut" }));
  await userEvent.click(screen.getByRole("button", { name: "Ajouter le filtre" }));
  expect(screen.getByRole("alert")).toHaveTextContent("panne");
});

it("une commande refusée ne ferme pas et garde les cibles inconnues retirables", async () => {
  const filter = { ...sampleDraft().filters[0] as CommonFilter, default: "Nord", allowed: ["Nord"] };
  mock.editor = { ...mock.editor, catalog: MODELS.filter((model) => model.name !== "sales"), tree: [], run: vi.fn().mockReturnValue(false) };
  const done = vi.fn();
  render(<FiltreForm filter={filter} onDone={done} />);
  expect(screen.getByRole("checkbox", { name: N.visual })).toBeChecked();
  await userEvent.click(screen.getByRole("button", { name: "Appliquer les propriétés" }));
  await userEvent.click(screen.getByRole("button", { name: "Supprimer le filtre" }));
  expect(done).not.toHaveBeenCalled();
});

it("conserve le défaut et les valeurs autorisées lors d'une modification", async () => {
  const filter = { ...sampleDraft().filters[0] as CommonFilter, default: "Nord", allowed: ["Nord", "Sud"] };
  render(<FiltreForm filter={filter} />);
  await userEvent.click(screen.getByRole("button", { name: "Appliquer les propriétés" }));
  expect(mock.editor.run).toHaveBeenCalledWith({ type: "update_filter", id: filter.id, value: { label: filter.label, dimension: filter.dimension, operator: filter.operator, targets: filter.targets, default: "Nord", allowed: ["Nord", "Sud"] }, remove: [] }, "Filtre modifié.");
});

it("utilise le nom d'une dimension dont le libellé est vide", () => {
  mock.editor = { ...mock.editor, catalog: MODELS.map((model) => ({ ...model, dimensions: model.dimensions.map((dimension) => ({ ...dimension, label: "" })) })) };
  render(<FiltreForm />);
  expect(screen.getByRole("option", { name: "region · region (string)" })).toBeInTheDocument();
});

it("ne propose que les tuiles dont le modèle expose la dimension et le type sélectionnés", async () => {
  const numeric = decodeRevision(analysisBody(N.total, { ...ANALYSES[N.total] as AnalysisSpec, query: { ...(ANALYSES[N.total] as AnalysisSpec).query, model: "numerique" } }), "finance");
  const absent = decodeRevision(analysisBody(N.bars, { ...ANALYSES[N.bars] as AnalysisSpec, query: { ...(ANALYSES[N.bars] as AnalysisSpec).query, model: "sans_region" } }), "finance");
  const base = MODELS[0] as (typeof MODELS)[number];
  mock.editor = { ...mock.editor, analyses: { ...mock.editor.analyses, [N.kpi]: { pinned: numeric, current: 1 }, [N.rule]: { pinned: absent, current: 1 } }, catalog: [base, { ...base, name: "numerique", dimensions: base.dimensions.map((d) => d.name === "region" ? { ...d, type: "number" as const } : d) }, { ...base, name: "sans_region", dimensions: base.dimensions.filter((d) => d.name === "region").map((d) => ({ ...d, name: "autre" })) }] };
  render(<FiltreForm />);
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Dimension" }), "region:string");
  expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  expect(screen.getByRole("checkbox", { name: /Visuel/ })).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Dimension" }), "region:number");
  expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  expect(screen.getByRole("checkbox", { name: /KPI/ })).toBeInTheDocument();
});

it("retire toutes les anciennes cibles quand la dimension change", async () => {
  mock.editor = { ...mock.editor, catalog: MODELS.map((model) => model.name === "sales" ? { ...model, dimensions: [...model.dimensions, { ...model.dimensions[1] as (typeof model.dimensions)[number], name: "autre", label: "Autre" }] } : model) };
  render(<FiltreForm />);
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Dimension" }), "region:string");
  await userEvent.click(screen.getByRole("checkbox", { name: /Visuel/ }));
  expect(screen.getByRole("checkbox", { name: /Visuel/ })).toBeChecked();
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Dimension" }), "autre:string");
  expect(screen.getByRole("checkbox", { name: /Visuel/ })).not.toBeChecked();
});

it("ignore les lignes vides des valeurs autorisées et de la liste de travail", async () => {
  render(<FiltreForm />);
  await userEvent.type(screen.getByRole("textbox", { name: "Libellé" }), "Zone");
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Dimension" }), "region:string");
  await userEvent.click(screen.getByRole("checkbox", { name: /Visuel/ }));
  await userEvent.type(screen.getByRole("textbox", { name: "Valeurs autorisées" }), "Nord{Enter}{Enter}Sud{Enter}");
  await userEvent.click(screen.getByRole("button", { name: "Ajouter le filtre" }));
  expect(vi.mocked(mock.editor.run).mock.calls[0]?.[0]).toEqual({ type: "add_filter", value: { label: "Zone", dimension: "region", operator: "eq", targets: [N.visual], allowed: ["Nord", "Sud"] } });
  const filter = { ...sampleDraft().filters[0] as CommonFilter, operator: "in" as const };
  const view = render(<ValeurFiltre filter={filter} />);
  await userEvent.type(within(view.container).getByRole("textbox"), "Nord{Enter}{Enter}Sud{Enter}");
  await userEvent.click(within(view.container).getByRole("button", { name: "Appliquer la valeur" }));
  expect(mock.editor.setValue).toHaveBeenCalledWith(filter.id, ["Nord", "Sud"]);
});
