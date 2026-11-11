import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { tableFromArrays, type Table } from "apache-arrow";
import { describe, expect, it, vi } from "vitest";

import { decodeRevision, type AnalysisRevision } from "../../analyses/model";
import { SKIFER_ARDOISE, SKIFER_CLAIR } from "../../charts/theme";
import executionExample from "../../../../../contracts/executions/contextuel-detail.json";
import { decodeExecution, type Execution } from "../../executions/model";
import { renderThemed, expectAccessible } from "../../test/a11y";
import type { AnalysisComponent, Defaults, KpiComponent } from "../document";
import { OutcomeError, type TileState } from "./useTiles";
import { Tuile } from "./Tuile";
import { analysisBody, ANALYSES, MODELS, N } from "./testing";

const pinned = (id: string, extra: Partial<(typeof ANALYSES)[string]> = {}): AnalysisRevision => decodeRevision(analysisBody(id, { ...(ANALYSES[id] as (typeof ANALYSES)[string]), ...extra }), "finance");
const visual = (presentation: AnalysisComponent["presentation"] = {}): AnalysisComponent => ({ id: N.visual, type: "analysis", reference: { analysis_id: N.bars, revision: 1 }, presentation });
const kpi = (presentation: KpiComponent["presentation"] = {}): KpiComponent => ({ id: N.kpi, type: "kpi", reference: { analysis_id: N.total, revision: 1 }, presentation });
const execution = decodeExecution(executionExample.body, "finance");
const byRegion = tableFromArrays({ region: ["Nord", "Sud"], revenue: [12, 5] });
const single = tableFromArrays({ revenue: [17] });
const truncatedRun: Execution = { ...execution, truncated: true };
const success = (result: Table = byRegion, run: Execution = execution): TileState => ({ status: "success", result, execution: run });

interface Options { component?: AnalysisComponent | KpiComponent; state: TileState | undefined; pinned?: AnalysisRevision | undefined; defaults?: Defaults; catalog?: typeof MODELS | null }
const show = (options: Options) => {
  const { component = visual(), state, defaults = {}, catalog = null } = options;
  return render(<Tuile component={component} state={state} pinned={"pinned" in options ? options.pinned : pinned(N.bars)} defaults={defaults} catalog={catalog} theme={SKIFER_CLAIR} />);
};

describe("états d'une tuile (§0.2)", () => {
  it("lecture de l'analyse épinglée, sans titre connu : le titre est celui du composant ou un titre générique", () => {
    show({ state: undefined, pinned: undefined });
    expect(screen.getByRole("status")).toHaveTextContent("Lecture de l'analyse épinglée…");
    expect(screen.getByRole("group", { name: "Visuel épinglé" })).toBeInTheDocument();
  });

  it("titre générique d'un KPI, ou titre porté par le composant", () => {
    const { unmount } = show({ component: kpi(), state: { status: "reading" }, pinned: undefined });
    expect(screen.getByRole("group", { name: "KPI épinglé" })).toBeInTheDocument();
    unmount();
    show({ component: visual({ title: "Mon titre" }), state: { status: "reading" }, pinned: undefined });
    expect(screen.getByRole("group", { name: "Mon titre" })).toBeInTheDocument();
  });

  it("analyse illisible : refus ou panne rendus tels quels, sans exécution", () => {
    const { unmount } = show({ state: { status: "unreadable", outcome: { status: "refused", code: "forbidden", field: null } as never } });
    expect(screen.getByRole("alert")).toHaveTextContent(/Analyse épinglée illisible : .*Aucune exécution n'est lancée\./);
    unmount();
    show({ state: { status: "unreadable", outcome: { status: "error", message: "Le serveur Board ne répond pas." } } });
    expect(screen.getByRole("alert")).toHaveTextContent("Analyse épinglée illisible : Le serveur Board ne répond pas. Aucune exécution n'est lancée.");
  });

  it.each([
    [{ status: "waiting" }, /En attente d'une place : quatre exécutions au plus/],
    [{ status: "running" }, /Exécution en cours…/],
    [{ status: "cancelled" }, /Exécution annulée : aucun résultat\./],
  ] as const)("%j", (state, text) => {
    show({ state });
    expect(screen.getByRole("status")).toHaveTextContent(text);
  });

  it("indisponible : la raison, et aucune exécution lancée", () => {
    show({ state: { status: "unavailable", reason: "filter_incompatible" } });
    expect(screen.getByText("Indisponible")).toBeInTheDocument();
    expect(screen.getByText(/Un filtre commun ne s'applique pas à cette tuile/)).toBeInTheDocument();
    expect(screen.getByText("Aucune exécution n'a été lancée pour cette tuile.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it.each([["DENY", "DENY · accès refusé"], ["REQUIRE_HUMAN", "REQUIRE_HUMAN · validation humaine requise"]] as const)("%s s'affiche tel quel, sans nouvel essai ni résultat", (decision, text) => {
    show({ state: { status: "denied", decision, execution } });
    expect(screen.getByRole("alert")).toHaveTextContent(text);
    expect(screen.getByRole("alert")).toHaveTextContent(`Exécution : ${execution.id}`);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("Preuve")).not.toBeInTheDocument();
  });

  it("échec : refus du serveur, panne réseau, code de l'exécution ou échec sans détail", () => {
    const refused = new OutcomeError({ status: "refused", code: "forbidden", field: null } as never);
    const { unmount } = show({ state: { status: "error", error: refused } });
    expect(screen.getByRole("alert")).toHaveTextContent(/Échec de la tuile : .* Rien n'est affiché à la place\./);
    unmount();
    const down = show({ state: { status: "error", error: new OutcomeError({ status: "error", message: "Panne réseau." }) } });
    expect(screen.getByRole("alert")).toHaveTextContent("Échec de la tuile : Panne réseau.");
    down.unmount();
    const coded = show({ state: { status: "error", error: "execution_failed", execution: { ...execution, errorCode: "execution_failed" } } });
    expect(screen.getByRole("alert")).toHaveTextContent(/Échec de la tuile : .+ Rien n'est affiché/);
    expect(screen.getByRole("alert")).not.toHaveTextContent("Échec de l'exécution.");
    coded.unmount();
    show({ state: { status: "error", error: "inconnu", execution: { ...execution, errorCode: null } } });
    expect(screen.getByRole("alert")).toHaveTextContent("Échec de la tuile : Échec de l'exécution.");
  });

  it("l'échec d'une tuile dont l'exécution est connue en donne l'identifiant, pour le diagnostic", () => {
    show({ state: { status: "error", error: new Error("résultat perdu"), execution } });
    expect(screen.getByRole("alert")).toHaveTextContent(`Exécution ${execution.id}.`);
    expect(screen.getByRole("alert")).toHaveTextContent("Échec de l'exécution.");
  });

  it("sans exécution connue, l'échec n'invente aucun identifiant", () => {
    show({ state: { status: "error", error: new OutcomeError({ status: "error", message: "Panne réseau." }) } });
    expect(screen.getByRole("alert")).not.toHaveTextContent("Exécution ");
  });

  it("un résultat sans provenance n'est pas affiché", () => {
    show({ state: success(byRegion, { ...execution, proof: null }) });
    expect(screen.getByRole("alert")).toHaveTextContent("Le résultat n'est pas affiché : la provenance (preuve, empreinte SQL) est absente de la réponse.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("aucune ligne : le dit, avec les filtres appliqués et la provenance", () => {
    const none = tableFromArrays({ revenue: [] as number[] });
    const first = show({ state: { status: "empty", result: none, execution } });
    expect(screen.getByRole("status")).toHaveTextContent(/Aucune ligne pour ce contexte\. Filtres appliqués : tenant eq/);
    expect(screen.getByLabelText(/^Provenance ·/)).toHaveTextContent(execution.proof?.evidenceId ?? "");
    first.unmount();
    const bare = { ...execution, proof: { ...(execution.proof as NonNullable<Execution["proof"]>), filters: [] } };
    const second = show({ state: { status: "empty", result: none, execution: bare } });
    expect(screen.getByRole("status")).toHaveTextContent(/^Aucune ligne pour ce contexte\.$/);
    const noValue = { ...execution, proof: { ...(execution.proof as NonNullable<Execution["proof"]>), filters: [{ ...(execution.proof as NonNullable<Execution["proof"]>).filters[0] as NonNullable<Execution["proof"]>["filters"][number], value: null }] } };
    second.unmount();
    show({ state: { status: "empty", result: none, execution: noValue } });
    expect(screen.getByRole("status")).toHaveTextContent("sans valeur");
  });
});

describe("résultat partiel (§0.2)", () => {
  const PARTIAL = /Résultat partiel : une limite de la source ou du résultat a été atteinte/;
  it("un visuel, un KPI et un état vide tronqués le disent, sans cacher le résultat ni la provenance", () => {
    const chart = show({ state: success(byRegion, truncatedRun) });
    expect(screen.getByText(PARTIAL)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Provenance ·/)).toBeInTheDocument();
    chart.unmount();
    const value = show({ component: kpi(), pinned: pinned(N.total), state: success(single, truncatedRun) });
    expect(screen.getByText(PARTIAL)).toBeInTheDocument();
    value.unmount();
    show({ state: { status: "empty", result: tableFromArrays({ revenue: [] as number[] }), execution: truncatedRun } });
    expect(screen.getByText(PARTIAL)).toBeInTheDocument();
  });
  it("l'affichage impossible d'un résultat tronqué dit aussi qu'il est partiel", () => {
    show({ component: kpi(), pinned: pinned(N.total), state: success(byRegion, truncatedRun) });
    expect(screen.getByText(PARTIAL)).toBeInTheDocument();
    expect(screen.getByText(/Affichage impossible/)).toBeInTheDocument();
  });
  it("un résultat complet ne porte aucun bandeau", () => {
    show({ state: success() });
    expect(screen.queryByText(PARTIAL)).not.toBeInTheDocument();
  });
});

describe("résultat et provenance (§0.3)", () => {
  it("un visuel : graphique, tableau des valeurs exactes et pied de provenance complet", () => {
    show({ state: success() });
    expect(screen.getByRole("heading", { name: "Chiffre d'affaires par région" })).toBeInTheDocument();
    const footer = within(screen.getByLabelText(/^Provenance ·/));
    expect(footer.getByText("Preuve").nextSibling).toHaveTextContent(execution.proof?.evidenceId ?? "");
    expect(footer.getByText("Empreinte SQL").nextSibling).toHaveTextContent(execution.proof?.sqlHash ?? "");
    expect(footer.getByText("Certification des sources").nextSibling).toHaveTextContent("inconnue");
    expect(footer.getByText("Âge des données").nextSibling).toHaveTextContent("inconnu");
    expect(screen.getByRole("img", { name: /Barres de revenue : 2 lignes/ })).toBeInTheDocument();
  });

  it("applique le format demandé et l'infobulle avec la définition du catalogue", () => {
    show({ component: visual({ number_format: "integer", tooltip: "value_and_definition", threshold: { value: 3, label: "Cible" } }), state: success(), catalog: MODELS });
    expect(screen.getByRole("img", { name: /Barres de revenue/ })).toBeInTheDocument();
  });

  it("un KPI : la valeur, formatée à la demande, et la provenance", () => {
    show({ component: kpi({ number_format: "decimal_1" }), state: success(single), pinned: pinned(N.total) });
    expect(screen.getAllByRole("group", { name: "Total" })[0]).toHaveTextContent("17,0");
    expect(screen.getByLabelText(/^Provenance ·/)).toBeInTheDocument();
  });

  it("un KPI sans valeur ne montre pas zéro", () => {
    show({ component: kpi(), state: success(tableFromArrays({ revenue: [null as unknown as number] })), pinned: pinned(N.total) });
    expect(screen.getAllByRole("group", { name: "Total" })[0]).toHaveTextContent("—");
    expect(screen.getAllByRole("group", { name: "Total" })[1]).toHaveTextContent(/^Total—$/);
  });

  it("un KPI dont la colonne manque au résultat ne montre pas non plus de valeur", () => {
    show({ component: kpi(), state: success(tableFromArrays({ autre: [1] })), pinned: pinned(N.total) });
    expect(screen.getAllByRole("group", { name: "Total" })[1]).toHaveTextContent(/^Total—$/);
  });

  it("un KPI de plusieurs métriques met la première en valeur et dit que toutes figurent au tableau", () => {
    const two = pinned(N.total, { query: { ...(ANALYSES[N.total] as (typeof ANALYSES)[string]).query, metrics: ["revenue", "orders"] } });
    show({ component: kpi(), state: success(tableFromArrays({ revenue: [17], orders: [5] })), pinned: two });
    expect(screen.getByText(/La requête rend 2 métriques : seule la première, revenue, est mise en valeur/)).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("un KPI de plusieurs lignes : affichage impossible, le tableau reste", () => {
    show({ component: kpi(), state: success(byRegion), pinned: pinned(N.total) });
    expect(screen.getByText(/^Affichage impossible : Un KPI/)).toHaveTextContent("Affichage impossible : Un KPI montre une seule valeur : le résultat compte 2 lignes.");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Provenance ·/)).toBeInTheDocument();
  });

  it("un type Valeur sur un résultat à dimensions : affichage impossible, jamais une approximation", () => {
    show({ component: visual({ chart: "value" }), state: success() });
    expect(screen.getByText(/^Affichage impossible : Le type Valeur ne montre qu'un résultat sans dimension/)).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("un seuil de KPI se lit en texte", () => {
    show({ component: kpi({ threshold: { value: 20, label: "Cible" } }), state: success(single), pinned: pinned(N.total) });
    expect(screen.getByText("Seuil Cible : 20")).toBeInTheDocument();
  });

  it.each([[SKIFER_CLAIR], [SKIFER_ARDOISE]])("sans défaut d'accessibilité, thème %#", async (theme) => {
    const { container } = renderThemed(<Tuile component={visual()} state={success()} pinned={pinned(N.bars)} defaults={{}} catalog={null} theme={theme} />, theme);
    await expectAccessible(container);
  });
});

it("affiche les détails de provenance et ouvre le panneau Preuves", async () => {
  show({ state: success() });
  const provenance = within(screen.getByLabelText(/^Provenance ·/));
  expect(provenance.getByText("Durée")).toBeInTheDocument();
  expect(provenance.getByRole("button", { name: "Copier l'empreinte" })).toBeInTheDocument();
  await userEvent.click(provenance.getByRole("button", { name: "Preuves" }));
  expect(provenance.getByRole("region", { name: "Preuves" })).toBeVisible();
});

it("distingue le catalogue en lecture ou en échec et propose l'annulation d'une exécution", async () => {
  const first = show({ state: { status: "reading", source: "catalog" } });
  expect(screen.getByRole("status")).toHaveTextContent("Lecture du catalogue");
  first.unmount();
  const second = show({ state: { status: "unreadable", source: "catalog", outcome: { status: "error", message: "Panne" } } });
  expect(screen.getByRole("alert")).toHaveTextContent("Catalogue illisible");
  expect(screen.queryByRole("button", { name: "Réessayer" })).not.toBeInTheDocument();
  second.unmount();
  const cancel = vi.fn();
  render(<Tuile component={visual()} state={{ status: "running" }} pinned={pinned(N.bars)} defaults={{}} catalog={null} theme={SKIFER_CLAIR} onCancel={cancel} />);
  await userEvent.click(screen.getByRole("button", { name: /Annuler l/ }));
  expect(cancel).toHaveBeenCalledOnce();
});

it("une tuile annulée propose de relancer", async () => {
  const restart = vi.fn();
  render(<Tuile component={visual()} state={{ status: "cancelled" }} pinned={pinned(N.bars)} defaults={{}} catalog={null} theme={SKIFER_CLAIR} onRestart={restart} />);
  await userEvent.click(screen.getByRole("button", { name: "Relancer" }));
  expect(restart).toHaveBeenCalledOnce();
});
