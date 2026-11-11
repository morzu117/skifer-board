import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { decodeDashboardDraft } from "../document";
import { ANALYSES, N, openEditor, ROOT, sampleDraft, uuid } from "./testing";

const ready = async (options: Parameters<typeof openEditor>[0] = {}) => {
  const view = openEditor(options);
  await screen.findByRole("heading", { name: "Pilotage", level: 1 });
  return view;
};
const panel = () => document.querySelector<HTMLElement>(".sb-bottom__panel:not([hidden])") as HTMLElement;
const tab = (name: RegExp) => screen.getByRole("tab", { name });
const withFilters = (filters: object[], base: object = sampleDraft()) => decodeDashboardDraft({ ...base, filters });
const item = (name: string) => screen.getAllByRole("treeitem", { name })[0] as HTMLElement;
const press = (name: string, key: string) => { const node = item(name); node.focus(); fireEvent.keyDown(node, { key }); };

describe("onglets", () => {
  it("annoncent leur compte, se parcourent au clavier en boucle et ne gardent que leur panneau", async () => {
    await ready({ tiles: [{ id: N.visual, state: "unavailable", reason: "analysis_unavailable" }, { id: N.kpi, state: "ready" }], state: "unresolved_reference" });
    await waitFor(() => { expect(tab(/^Problèmes/)).toHaveTextContent("Problèmes (1, dont 1 bloquant)"); });
    expect(tab(/^Filtres/)).toHaveTextContent("Filtres (1)");
    expect(tab(/^Problèmes/)).toHaveAttribute("aria-selected", "true");
    expect(tab(/^Structure/)).toHaveAttribute("tabindex", "-1");
    tab(/^Problèmes/).focus();
    fireEvent.keyDown(tab(/^Problèmes/), { key: "ArrowRight" });
    expect(tab(/^Structure/)).toHaveAttribute("aria-selected", "true");
    expect(tab(/^Structure/)).toHaveFocus();
    expect(panel().id).toBe("sb-bottom-panel-structure");
    fireEvent.keyDown(tab(/^Structure/), { key: "End" });
    expect(tab(/^Filtres/)).toHaveFocus();
    fireEvent.keyDown(tab(/^Filtres/), { key: "ArrowRight" });
    expect(tab(/^Problèmes/)).toHaveFocus();
    fireEvent.keyDown(tab(/^Problèmes/), { key: "ArrowLeft" });
    expect(tab(/^Filtres/)).toHaveFocus();
    fireEvent.keyDown(tab(/^Filtres/), { key: "Home" });
    expect(tab(/^Problèmes/)).toHaveFocus();
    fireEvent.keyDown(tab(/^Problèmes/), { key: "a" });
    expect(tab(/^Problèmes/)).toHaveAttribute("aria-selected", "true");
    await userEvent.click(tab(/^Filtres/));
    expect(panel().id).toBe("sb-bottom-panel-filters");
  });
});

describe("problèmes", () => {
  it("sans problème, le dit ; tant que les analyses se lisent ou que le catalogue manque, il le dit aussi", async () => {
    await ready();
    await waitFor(() => { expect(screen.queryByText(/Catalogue non lu/)).not.toBeInTheDocument(); });
    expect(within(panel()).getByText("Aucun problème détecté.")).toBeInTheDocument();
    expect(within(panel()).getByText("Aucun problème ne bloque l'enregistrement.")).toBeInTheDocument();
  });

  it("tant qu'une analyse épinglée n'est pas lue, dit que des problèmes peuvent manquer", async () => {
    await ready({ overrides: { [`GET ${ROOT}/analyses/${N.bars}/revisions/1`]: () => new Promise<Response>(() => undefined) } });
    expect(screen.getByText("Lecture des analyses épinglées en cours : les problèmes de chaque tuile ne sont pas encore tous connus.")).toBeInTheDocument();
  });

  it("sans catalogue, la compatibilité des filtres n'est pas vérifiée et le dit", async () => {
    await ready({ overrides: { [`GET ${ROOT}/explorer/fields`]: Response.json({}, { status: 500 }) } });
    expect(await screen.findByText("Catalogue non lu : la compatibilité des filtres avec les dimensions n'est pas vérifiée.")).toBeInTheDocument();
  });

  it("liste chaque problème avec sa gravité, son détail et son nœud, et mène à lui", async () => {
    const extra = Array.from({ length: 18 }, (_, index) => ({ id: uuid(200 + index), rows: index === 0 ? Array.from({ length: 24 }, (__, row) => ({ id: uuid(300 + row), columns: [{ id: uuid(400 + row), span: 12, children: [] }] })) : [] }));
    const base = sampleDraft();
    const draft = decodeDashboardDraft({ ...base, filters: [{ id: N.filter, label: "Région", dimension: "nope", operator: "eq", targets: [N.visual] }], layout: { sections: [...base.layout.sections, ...extra] } });
    await ready({ draft, analyses: { ...ANALYSES, [N.bars]: { ...(ANALYSES[N.bars] as (typeof ANALYSES)[string]), current: 2 } }, tiles: [{ id: N.visual, state: "ready" }, { id: N.kpi, state: "unavailable", reason: "analysis_unavailable" }], state: "unresolved_reference" });
    await waitFor(() => { expect(screen.queryByText(/Lecture des analyses épinglées en cours/)).not.toBeInTheDocument(); });
    const links = within(panel()).getAllByRole("button").map((button) => button.textContent);
    expect(links.some((text) => /Avertissement.*Révision d'analyse en retard.*Visuel · Chiffre d'affaires par région.*épinglée r1, courante r2/.test(text))).toBe(true);
    expect(links.some((text) => /Bloquant.*Analyse indisponible.*KPI/.test(text))).toBe(true);
    expect(links.some((text) => /Bloquant.*Filtre incompatible.*Filtre « Région »/.test(text))).toBe(true);
    expect(links.some((text) => /Avertissement.*Limite du format atteinte.*Dashboard.*limite : sections/.test(text))).toBe(true);
    expect(links.some((text) => /Limite du format atteinte.*Section 3.*limite : \/layout\/sections\/2\/rows/.test(text))).toBe(true);
    expect(screen.getByText("Un problème bloquant empêche l'enregistrement : corrigez-le d'abord.")).toBeInTheDocument();

    await userEvent.click(within(panel()).getByRole("button", { name: /Analyse indisponible/ }));
    expect(screen.getByRole("heading", { name: /^Propriétés · KPI/ })).toBeInTheDocument();
    await userEvent.click(within(panel()).getByRole("button", { name: /Limite du format atteinte.*Dashboard/ }));
    expect(screen.getByRole("heading", { name: "Propriétés · Dashboard" })).toBeInTheDocument();
    await userEvent.click(tab(/^Problèmes/));
    await userEvent.click(within(panel()).getByRole("button", { name: /Filtre incompatible/ }));
    expect(tab(/^Filtres/)).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById(`sb-filter-${N.filter}`)).toHaveFocus();
  });
});

describe("structure", () => {
  const open = async () => { await ready(); await userEvent.click(tab(/^Structure/)); };

  it("est un arbre accessible : niveaux, effectifs, rangs et états", async () => {
    await open();
    const tree = screen.getByRole("tree", { name: "Structure du dashboard" });
    expect(tree).toHaveAccessibleDescription(/Flèches pour parcourir/);
    const section = item("Section 1 · Ventes");
    expect(section).toHaveAttribute("aria-level", "1");
    expect(section).toHaveAttribute("aria-setsize", "2");
    expect(section).toHaveAttribute("aria-posinset", "1");
    expect(section).toHaveAttribute("aria-expanded", "true");
    expect(item("Colonne 2 · 4/12")).toHaveAttribute("aria-level", "3");
    expect(item("Séparateur")).not.toHaveAttribute("aria-expanded");
    expect(section).toHaveAttribute("tabindex", "0");
    expect(item("Section 2")).toHaveAttribute("tabindex", "-1");
  });

  it("se parcourt aux flèches, Début et Fin, se replie et se déplie", async () => {
    await open();
    press("Section 1 · Ventes", "ArrowDown");
    expect(item("Rangée 1")).toHaveFocus();
    expect(item("Rangée 1")).toHaveAttribute("tabindex", "0");
    press("Rangée 1", "ArrowUp");
    expect(item("Section 1 · Ventes")).toHaveFocus();
    press("Section 1 · Ventes", "ArrowUp");
    expect(item("Section 1 · Ventes")).toHaveFocus();
    press("Section 1 · Ventes", "End");
    expect(item("Section 2")).toHaveFocus();
    press("Section 2", "ArrowDown");
    expect(item("Section 2")).toHaveFocus();
    press("Section 2", "Home");
    expect(item("Section 1 · Ventes")).toHaveFocus();
    press("Section 1 · Ventes", "ArrowRight");
    expect(item("Rangée 1")).toHaveFocus();
    press("Rangée 1", "ArrowLeft");
    expect(item("Rangée 1")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("treeitem", { name: "Colonne 1 · 4/12" })).not.toBeInTheDocument();
    press("Rangée 1", "ArrowRight");
    expect(item("Rangée 1")).toHaveAttribute("aria-expanded", "true");
    press("Rangée 1", "ArrowLeft");
    press("Rangée 1", "ArrowLeft");
    expect(item("Section 1 · Ventes")).toHaveFocus();
    press("Section 1 · Ventes", "ArrowLeft");
    expect(screen.queryByRole("treeitem", { name: "Rangée 1" })).not.toBeInTheDocument();
    press("Section 1 · Ventes", "ArrowLeft");
    expect(item("Section 1 · Ventes")).toHaveFocus();
    press("Section 2", "ArrowRight");
    expect(item("Section 2")).toHaveFocus();
    press("Section 1 · Ventes", "ArrowRight");
    expect(item("Section 1 · Ventes")).toHaveAttribute("aria-expanded", "true");
    press("Section 1 · Ventes", "x");
    expect(item("Section 1 · Ventes")).toHaveAttribute("aria-expanded", "true");
  });

  it("Entrée, Espace et le clic sélectionnent le nœud, dont les propriétés s'ouvrent", async () => {
    await open();
    press("Section 2", "Enter");
    expect(item("Section 2")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Propriétés · Section 2" })).toBeInTheDocument();
    press("Séparateur", " ");
    expect(item("Séparateur")).toHaveAttribute("aria-selected", "true");
    await userEvent.click(item("Colonne 1 · 4/12"));
    expect(screen.getByRole("heading", { name: /^Propriétés · Colonne 1/ })).toBeInTheDocument();
    expect(item("Colonne 1 · 4/12")).toHaveAttribute("tabindex", "0");
  });

  it("sans section, le dit", async () => {
    await ready({ draft: decodeDashboardDraft({ ...sampleDraft(), filters: [], layout: { sections: [] } }), tiles: [] });
    await userEvent.click(tab(/^Structure/));
    expect(screen.getByText("Aucune section : la structure est vide.")).toBeInTheDocument();
  });
});

describe("filtres", () => {
  it("liste, en lecture seule, chaque filtre avec ses valeurs et ses cibles, qui mènent au nœud", async () => {
    const draft = withFilters([
      { id: N.filter, label: "Région", dimension: "region", operator: "eq", default: "Nord", targets: [N.visual] },
      { id: uuid(31), label: "Zones", dimension: "region", operator: "in", default: ["Nord"], allowed: ["Nord", "Sud"], targets: [N.visual] },
    ]);
    await ready({ draft });
    await userEvent.click(tab(/^Filtres/));
    expect(screen.getByText("Lecture seule : les filtres communs ne s'éditent pas encore.")).toBeInTheDocument();
    const rows = within(panel()).getAllByRole("listitem").filter((one) => one.classList.contains("sb-filters__item"));
    expect(rows[0]).toHaveTextContent("Région · dimension region · égal à · défaut Nord · cibles :Visuel · Chiffre d'affaires par région");
    expect(rows[1]).toHaveTextContent("Zones · dimension region · parmi · défaut Nord · valeurs permises Nord, Sud · cibles :");
    await userEvent.click(within(rows[0] as HTMLElement).getByRole("button", { name: "Visuel · Chiffre d'affaires par région" }));
    expect(screen.getByRole("heading", { name: /^Propriétés · Visuel/ })).toBeInTheDocument();
  });

  it("sans filtre, le dit", async () => {
    await ready({ draft: withFilters([]) });
    await userEvent.click(tab(/^Filtres/));
    expect(screen.getByText(/^Aucun filtre commun\./)).toBeInTheDocument();
  });
});
