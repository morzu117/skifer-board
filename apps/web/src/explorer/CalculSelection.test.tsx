import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Decimal, makeData, makeVector, Table, TimestampMicrosecond, tableFromArrays } from "apache-arrow";
import { describe, expect, it, vi } from "vitest";
import exemple from "../../../../contracts/executions/contextuel-detail.json";
import champs from "../../../../contracts/executions/champs.json";
import derive from "../../../../contracts/executions/contextuel-selection.json";
import tronque from "../../../../contracts/executions/contextuel-tronque.json";
import part from "../../../../contracts/executions/contextuel-part.json";
import indisponible from "../../../../contracts/executions/contextuel-indisponible.json";
import { THEMES } from "../charts/theme";
import { chartOf, clickItem } from "../charts/testing";
import { decodeExecution } from "../executions/model";
import type { Fetch } from "../spaces/api";
import { expectAccessible, renderThemed } from "../test/a11y";
import { REASONS, decodeFields } from "./model";
import { CalculSelection, nombreLisible, pourcentageExact } from "./CalculSelection";
import { Resultat } from "./Resultat";

const base = decodeExecution(exemple.body, "finance");
const run = { ...base, resultContract: { dimensions: ["region", "annee"], metrics: [{ name: "revenue", aggregation: "sum" as const, additivity: "additive" as const }], completeness: "complete" as const } };
const model = decodeFields(champs.body).models[0] as ReturnType<typeof decodeFields>["models"][number];
const input = { connection: "source", environment: "DEV" as const, model: "orders", metrics: ["revenue"], dimensions: ["region", "annee"], filters: [] };
const table = tableFromArrays({ region: ["Nord", "Nord", "Sud", "Sud"], annee: [2025, 2026, 2025, 2026], revenue: [5, 7, 8, 9] });
const reponsePart = { ...part.body, rows: [{ share: 0.5 }], row_count: 2 };
function serveur(total: unknown = derive.body, share: unknown = reponsePart) {
  return vi.fn<Fetch>().mockImplementation((_url, init) => {
    const body = JSON.parse(init?.body as string) as { operation: string };
    return Promise.resolve(Response.json(body.operation === "aggregate" ? total : share));
  });
}

describe.each(THEMES)("sélection accessible sous $label", (theme) => {
  it("sélectionne une ligne au clavier et calcule total et part", async () => {
    const fetcher = serveur();
    const { container } = renderThemed(<Resultat table={table} input={input} model={model} theme={theme} context={{ run, fetcher }} />, theme);
    await userEvent.click(screen.getByRole("tab", { name: "Tableau" }));
    const ligne = screen.getByRole("checkbox", { name: /^Sélectionner la ligne 1(?: :|$)/ });
    ligne.focus(); await userEvent.keyboard(" ");
    expect(ligne.closest("tr")).toHaveClass("sb-row--selected");
    expect(screen.getByRole("region", { name: "Sélection personnelle" }).closest(".sb-card")).toHaveClass("sb-chart-card");
    expect(await screen.findByRole("row", { name: /Total :/ })).toHaveTextContent("12");
    expect(screen.getByRole("row", { name: /Part :/ })).toHaveTextContent("0,5");
    expect(screen.getByRole("region", { name: "Calculs contextuels" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByText(/Faites défiler les calculs/)).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toEqual({ operation: "aggregate", metric: "revenue", group_by: [], selection: { region: ["Nord"], annee: [2025] }, scope: null, denominator: null });
    expect(JSON.parse(fetcher.mock.calls[1]?.[1]?.body as string)).toEqual({ operation: "share", metric: "revenue", group_by: [], selection: { region: ["Nord"], annee: [2025] }, scope: null, denominator: "loaded_result" });
    await expectAccessible(container);
    await userEvent.keyboard(" ");
    expect(screen.queryByText(/Sélection personnelle/)).not.toBeInTheDocument();
  });
});

it("refuse la sélection en escalier sans appeler le calcul", async () => {
  const fetcher = serveur(); render(<Resultat table={table} input={input} model={model} theme={THEMES[0]} context={{ run, fetcher }} />);
  await userEvent.click(screen.getByRole("tab", { name: "Tableau" }));
  await userEvent.click(screen.getByRole("checkbox", { name: /^Sélectionner la ligne 1(?: :|$)/ }));
  await screen.findByRole("row", { name: /Total :/ });
  await userEvent.click(screen.getByRole("checkbox", { name: /^Sélectionner la ligne 2(?: :|$)/ }));
  await waitFor(() => { expect(fetcher).toHaveBeenCalledTimes(4); });
  await userEvent.click(screen.getByRole("checkbox", { name: /^Sélectionner la ligne 3(?: :|$)/ }));
  expect(screen.getByText(/Total indisponible pour cette sélection.*escalier/)).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it("refuse le grand entier sans en altérer la valeur", async () => {
  const fetcher = serveur();
  const data = tableFromArrays({ region: [9007199254740993n], revenue: [1] });
  render(<Resultat table={data} input={{ ...input, dimensions: ["region"] }} model={model} theme={THEMES[0]} context={{ run, fetcher }} />);
  await userEvent.click(screen.getByRole("tab", { name: "Tableau" }));
  expect(screen.getByRole("cell", { name: "9007199254740993" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("checkbox", { name: /^Sélectionner la ligne 1(?: :|$)/ }));
  expect(screen.getByText(/entier dépasse la précision exacte/)).toBeInTheDocument();
  expect(fetcher).not.toHaveBeenCalled();
});

it("sélectionne une barre et affiche un total partiel", async () => {
  const fetcher = serveur(tronque.body, { ...reponsePart, partial: true });
  const { container } = render(<Resultat table={table} input={input} model={model} theme={THEMES[0]} context={{ run: { ...run, truncated: true }, fetcher }} />);
  clickItem(container.querySelector('[role="img"]') as HTMLElement, { name: "Nord", dataIndex: 0, seriesIndex: 0 });
  expect(await screen.findByRole("row", { name: /Total :/ })).toHaveTextContent("17");
  const series = chartOf(container.querySelector('[role="img"]') as HTMLElement).getOption().series as { data: { itemStyle: { color: string } }[] }[];
  expect(series[0]?.data[0]?.itemStyle.color).toBe(THEMES[0].selected);
  expect(screen.getByText(/Sélection personnelle/)).toHaveTextContent("sur le résultat chargé");
  await userEvent.click(screen.getByRole("tab", { name: "Tableau" }));
  expect(screen.getByRole("checkbox", { name: /^Sélectionner la ligne 1(?: :|$)/ })).toBeChecked();
  await userEvent.click(screen.getByRole("button", { name: "Effacer la sélection" }));
  expect(screen.queryByText(/Sélection personnelle/)).not.toBeInTheDocument();
});

it.each(REASONS)("explique l'indisponibilité %s", async (reason) => {
  const fetcher = serveur({ ...indisponible.body, reason }, { ...indisponible.body, reason });
  render(<CalculSelection run={run} selection={{ region: ["Nord"] }} fetcher={fetcher} />);
  const notices = await screen.findAllByText(/Le chiffre doit être demandé au moteur/);
  expect(notices).toHaveLength(2);
  expect(notices[0]).not.toHaveTextContent(reason);
});

it("garde le calcul frais lorsque la réponse périmée arrive ensuite", async () => {
  const pending: ((response: Response) => void)[] = [];
  const fetcher = vi.fn<Fetch>().mockImplementation(() => new Promise<Response>((resolve) => { pending.push(resolve); }));
  const { rerender } = render(<CalculSelection run={run} selection={{ region: ["Nord"] }} fetcher={fetcher} />);
  await waitFor(() => { expect(pending).toHaveLength(2); });
  rerender(<CalculSelection run={run} selection={{ region: ["Sud"] }} fetcher={fetcher} />);
  await waitFor(() => { expect(pending).toHaveLength(4); });
  await act(async () => { pending[2]?.(Response.json(tronque.body)); pending[3]?.(Response.json(reponsePart)); await Promise.resolve(); });
  expect(await screen.findByRole("row", { name: /Total :/ })).toHaveTextContent("17");
  const ancienTotal = Response.json(derive.body); const lectureTotal = vi.spyOn(ancienTotal, "json");
  const anciennePart = Response.json(reponsePart); const lecturePart = vi.spyOn(anciennePart, "json");
  await act(async () => { pending[0]?.(ancienTotal); pending[1]?.(anciennePart); await waitFor(() => { expect(lectureTotal).toHaveBeenCalled(); expect(lecturePart).toHaveBeenCalled(); }); });
  expect(screen.getByRole("row", { name: /Total :/ })).toHaveTextContent("17");
  expect(screen.queryByText(/Calcul de la sélection/)).not.toBeInTheDocument();
});

it("calcule chaque métrique du contrat et conserve les entiers exacts", async () => {
  const multiple = { ...run, resultContract: { ...run.resultContract, metrics: [...run.resultContract.metrics, { name: "clients", aggregation: "count" as const, additivity: "additive" as const }] } };
  const fetcher = vi.fn<Fetch>().mockImplementation((_url, init) => {
    const body = JSON.parse(init?.body as string) as { metric: string; operation: string };
    const response = body.operation === "aggregate" ? { ...derive.body, rows: [{ [body.metric]: { type: "integer", value: "9007199254740993" } }] } : reponsePart;
    return Promise.resolve(Response.json(response));
  });
  render(<CalculSelection run={multiple} selection={{ region: ["Nord"] }} fetcher={fetcher} />);
  expect(await screen.findAllByText(/9007199254740993/)).toHaveLength(2);
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it("signale un contrat absent sans appeler le serveur", () => {
  const fetcher = serveur();
  render(<CalculSelection run={{ ...run, resultContract: null }} selection={{ region: ["Nord"] }} fetcher={fetcher} />);
  expect(screen.getByText(/contrat du résultat est absent/)).toHaveTextContent("demandé au moteur");
  expect(fetcher).not.toHaveBeenCalled();
});

it("ne réaffiche pas le calcul de l'exécution précédente", async () => {
  const fetcher = serveur();
  const { rerender } = render(<CalculSelection run={run} selection={{ region: ["Nord"] }} fetcher={fetcher} />);
  expect(await screen.findByRole("row", { name: /Total :/ })).toBeInTheDocument();
  let resolve!: (response: Response) => void;
  const retard = vi.fn<Fetch>().mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
  rerender(<CalculSelection run={{ ...run, id: "22222222-2222-2222-2222-222222222222" }} selection={{ region: ["Nord"] }} fetcher={retard} />);
  expect(screen.queryByRole("row", { name: /Total :/ })).not.toBeInTheDocument();
  expect(screen.getByText(/Calcul de la sélection/)).toBeInTheDocument();
  await waitFor(() => { expect(resolve).toBeTypeOf("function"); });
});

it("explique une panne de calcul sans relancer le moteur", async () => {
  const fetcher = vi.fn<Fetch>().mockResolvedValue(Response.json({}, { status: 500 }));
  render(<CalculSelection run={run} selection={{ region: ["Nord"] }} fetcher={fetcher} />);
  expect(await screen.findAllByText(/Le chiffre doit être demandé au moteur/)).toHaveLength(2);
  expect(fetcher).toHaveBeenCalledTimes(2);
});


it("sélectionne la barre au clavier et efface la sélection avec Échap", async () => {
  const fetcher = serveur();
  const data = tableFromArrays({ region: ["Nord", "Sud"], revenue: [5, 8] });
  render(<Resultat table={data} input={{ ...input, dimensions: ["region"] }} model={model} theme={THEMES[0]} context={{ run, fetcher }} />);
  const graphique = screen.getByRole("group", { name: "Résultat" });
  graphique.focus();
  await userEvent.keyboard("{ArrowRight}{Enter}");
  expect(await screen.findByRole("row", { name: /Total :/ })).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByText(/Sélection personnelle/)).not.toBeInTheDocument();
});

it("transmet la valeur temporelle Arrow dans son unité exacte", async () => {
  const vecteur = makeVector(makeData({ type: new TimestampMicrosecond(), length: 1, data: new BigInt64Array([1234001n]) }));
  const data = new Table({ jour: vecteur, revenue: makeVector(new Float64Array([1])) });
  const fetcher = serveur();
  render(<Resultat table={data} input={{ ...input, dimensions: ["jour"] }} model={model} theme={THEMES[0]} context={{ run, fetcher }} />);
  await userEvent.click(screen.getByRole("tab", { name: "Tableau" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Sélectionner la ligne 1 : jour : 1970-01-01T00:00:01.234001" }));
  await waitFor(() => { expect(fetcher).toHaveBeenCalledTimes(2); });
  const body = JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string) as { selection: { jour: number[] } };
  expect(body.selection.jour).toEqual([1234001]);
});


it("accepte exactement les entiers aux bornes de ±2 puissance 53", async () => {
  const fetcher = serveur();
  const data = tableFromArrays({ region: [9007199254740992n, -9007199254740992n], revenue: [1, 2] });
  render(<Resultat table={data} input={{ ...input, dimensions: ["region"] }} model={model} theme={THEMES[0]} context={{ run, fetcher }} />);
  await userEvent.click(screen.getByRole("tab", { name: "Tableau" }));
  await userEvent.click(screen.getByRole("checkbox", { name: /^Sélectionner la ligne 1(?: :|$)/ }));
  await waitFor(() => { expect(fetcher).toHaveBeenCalledTimes(2); });
  const body = JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string) as { selection: { region: number[] } };
  expect(body.selection.region).toEqual([2 ** 53]);
  await userEvent.click(screen.getByRole("checkbox", { name: /^Sélectionner la ligne 2(?: :|$)/ }));
  await waitFor(() => { expect(fetcher).toHaveBeenCalledTimes(4); });
  const second = JSON.parse(fetcher.mock.calls[2]?.[1]?.body as string) as { selection: { region: number[] } };
  expect(second.selection.region).toEqual([2 ** 53, -(2 ** 53)]);
});

it("ignore une barre absente d'un groupe incomplet", () => {
  const fetcher = serveur();
  const data = tableFromArrays({ region: ["Nord", "Nord", "Sud"], annee: [2025, 2026, 2025], revenue: [5, 7, 8] });
  const { container } = render(<Resultat table={data} input={input} model={model} theme={THEMES[0]} context={{ run, fetcher }} />);
  clickItem(container.querySelector('[role="img"]') as HTMLElement, { name: "Sud", dataIndex: 1, seriesIndex: 1 });
  expect(fetcher).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Effacer la sélection" })).not.toBeInTheDocument();
});


it("explique un refus du serveur sans relancer le moteur", async () => {
  const fetcher = vi.fn<Fetch>().mockImplementation(() => Promise.resolve(Response.json({ error: { code: "forbidden" } }, { status: 403 })));
  render(<CalculSelection run={run} selection={{ region: ["Nord"] }} fetcher={fetcher} />);
  expect(await screen.findAllByText(/Votre rôle ne permet pas cette action/)).toHaveLength(2);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each(["exécution", "espace"])("ignore la réponse tardive après changement d'%s", async (contexte) => {
  const pending: ((response: Response) => void)[] = [];
  const fetcher = vi.fn<Fetch>().mockImplementation(() => new Promise<Response>((resolve) => { pending.push(resolve); }));
  const { rerender } = render(<CalculSelection run={run} selection={{ region: ["Nord"] }} fetcher={fetcher} />);
  await waitFor(() => { expect(pending).toHaveLength(2); });
  const next = contexte === "exécution" ? { ...run, id: "22222222-2222-2222-2222-222222222222" } : { ...run, space: "autre" };
  rerender(<CalculSelection run={next} selection={{ region: ["Nord"] }} fetcher={fetcher} />);
  await waitFor(() => { expect(pending).toHaveLength(4); });
  await act(async () => { pending[0]?.(Response.json(derive.body)); pending[1]?.(Response.json(reponsePart)); await Promise.resolve(); });
  expect(screen.queryByText(/Sélection personnelle/)).not.toBeInTheDocument();
  await act(async () => { pending[2]?.(Response.json(tronque.body)); pending[3]?.(Response.json(reponsePart)); await Promise.resolve(); });
  expect(await screen.findByRole("row", { name: /Total :/ })).toHaveTextContent("17");
});

it("affiche les valeurs nulles ou absentes sans inventer de chiffre", async () => {
  const fetcher = serveur({ ...derive.body, rows: [{ revenue: null }] }, { ...reponsePart, rows: [] });
  render(<CalculSelection run={run} selection={{ region: ["Nord"] }} fetcher={fetcher} />);
  expect(await screen.findByRole("row", { name: /Total :/ })).toHaveTextContent("—");
  expect(screen.getByRole("row", { name: /Part :/ })).toHaveTextContent("—");
});

it("ignore les positions graphiques absentes et masque le calcul sans contexte", async () => {
  const fetcher = serveur();
  const data = tableFromArrays({ region: ["Nord", "Sud"], annee: [2025, 2026], revenue: [5, 8] });
  const { container, rerender } = render(<Resultat table={data} input={input} model={model} theme={THEMES[0]} context={{ run, fetcher }} />);
  clickItem(container.querySelector('[role="img"]') as HTMLElement, { name: "Nord", dataIndex: 0, seriesIndex: 0 });
  expect(await screen.findByText(/Sélection personnelle/)).toBeInTheDocument();
  rerender(<Resultat table={data} input={input} model={model} theme={THEMES[0]} />);
  expect(screen.queryByRole("table", { name: /Calculs contextuels/ })).not.toBeInTheDocument();
});

it("ignore un index de barre hors du résultat", () => {
  const fetcher = serveur();
  const data = tableFromArrays({ region: ["Nord"], revenue: [1] });
  const { container } = render(<Resultat table={data} input={{ ...input, dimensions: ["region"] }} model={model} theme={THEMES[0]} context={{ run, fetcher }} />);
  clickItem(container.querySelector('[role="img"]') as HTMLElement, { name: "absent", dataIndex: 12, seriesIndex: 0 });
  expect(fetcher).not.toHaveBeenCalled();
});


it("ne convertit pas une dimension décimale en flottant pour la sélectionner", async () => {
  const decimal = makeVector(makeData({ type: new Decimal(2, 12), length: 1, data: new Uint32Array([125, 0, 0, 0]) }));
  const data = new Table({ region: decimal, revenue: makeVector(new Float64Array([1])) });
  const fetcher = serveur();
  render(<Resultat table={data} input={{ ...input, dimensions: ["region"] }} model={model} theme={THEMES[0]} context={{ run, fetcher }} />);
  await userEvent.click(screen.getByRole("tab", { name: "Tableau" }));
  await userEvent.click(screen.getByRole("checkbox", { name: /^Sélectionner la ligne 1(?: :|$)/ }));
  expect(screen.getByText(/dimension décimale ne peut pas être transmise exactement/)).toBeInTheDocument();
  expect(fetcher).not.toHaveBeenCalled();
});


it("parcourt au clavier toutes les séries des barres groupées", async () => {
  const fetcher = serveur();
  render(<Resultat table={table} input={input} model={model} theme={THEMES[0]} context={{ run, fetcher }} />);
  screen.getByRole("group", { name: "Résultat" }).focus();
  await userEvent.keyboard("{End}{Enter}");
  await waitFor(() => { expect(fetcher).toHaveBeenCalledTimes(2); });
  const body = JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string) as { selection: { region: string[]; annee: number[] } };
  expect(body.selection).toEqual({ region: ["Sud"], annee: [2026] });
});

it("sélectionne une barre simple à la souris", async () => {
  const fetcher = serveur();
  const data = tableFromArrays({ region: ["Nord", "Sud"], revenue: [1, 2] });
  const { container } = render(<Resultat table={data} input={{ ...input, dimensions: ["region"] }} model={model} theme={THEMES[0]} context={{ run, fetcher }} />);
  clickItem(container.querySelector('[role="img"]') as HTMLElement, { name: "Sud", dataIndex: 1, seriesIndex: 0 });
  await waitFor(() => { expect(fetcher).toHaveBeenCalledTimes(2); });
  const body = JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string) as { selection: { region: string[] } };
  expect(body.selection.region).toEqual(["Sud"]);
});

it("annonce une métrique absente sur une barre groupée", async () => {
  const data = tableFromArrays({ region: ["Nord"], annee: [2025] });
  render(<Resultat table={data} input={input} model={model} theme={THEMES[0]} />);
  screen.getByRole("group", { name: "Résultat" }).focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(screen.getByText(/Nord · 2025 · revenue : —/)).toBeInTheDocument();
});


it.each([
  ["0.29411764705882354", "29,411764705882354"], ["0.5", "50"], ["-0.125", "-12,5"],
  ["0.0000000000000000000001", "0,00000000000000000001"], ["9007199254740993.01", "900719925474099301"],
  ["1e-7", "0,00001"], ["1e+3", "100000"], ["mot", null], ["1e999999", null],
])("convertit le rapport exact %s en pourcentage", (rapport, attendu) => {
  expect(pourcentageExact(rapport)).toBe(attendu);
});

it("explique un dénominateur nul et affiche la preuve source", async () => {
  const share = { ...reponsePart, rows: [{ share: null }], notes: ["zero_or_null_denominator"] };
  render(<CalculSelection run={run} selection={{ region: ["Nord"] }} fetcher={serveur(derive.body, share)} />);
  expect(await screen.findByText(/dénominateur est nul ou absent/)).toBeInTheDocument();
  expect(screen.getByRole("row", { name: /Part :/ })).toHaveTextContent("—");
  expect(screen.getByRole("row", { name: /Part :/ })).toHaveTextContent(`preuve source : ${derive.body.source_evidence_id}`);
});

it("affiche un pourcentage décimal exact et conserve le rapport accessible", async () => {
  const share = { ...reponsePart, rows: [{ share: { type: "decimal", value: "0.12345678901234567890123456789" } }] };
  render(<CalculSelection run={run} selection={{ region: ["Nord"] }} fetcher={serveur(derive.body, share)} />);
  const texte = await screen.findByRole("row", { name: /Part :/ });
  await waitFor(() => { expect(texte).toHaveTextContent("≈ 12,35"); });
  expect(texte).toHaveTextContent("rapport exact : 0,12345678901234567890123456789");
  expect(texte).not.toHaveTextContent("exact : 12,345678901234567890123456789 %");
});

it("affiche une part exacte sans signe d'arrondi pour des zéros finaux", async () => {
  const share = { ...reponsePart, rows: [{ share: { type: "decimal", value: "0.705000" } }] };
  render(<CalculSelection run={run} selection={{ region: ["Nord"] }} fetcher={serveur(derive.body, share)} />);
  const row = await screen.findByRole("row", { name: /Part :/ });
  expect(row).toHaveTextContent("70,50 % (rapport exact : 0,705000)");
  expect(row).not.toHaveTextContent("≈");
});

it.each(["total", "part"]) ("masque tous les chiffres si la preuve du %s diffère", async (champ) => {
  const autre = "preuve-etrangere";
  const total = champ === "total" ? { ...derive.body, source_evidence_id: autre } : derive.body;
  const share = champ === "part" ? { ...reponsePart, source_evidence_id: autre } : reponsePart;
  render(<CalculSelection run={run} selection={{ region: ["Nord"] }} fetcher={serveur(total, share)} />);
  const message = await screen.findByText(/preuve source preuve-etrangere ne correspond pas/);
  expect(message).toHaveTextContent("Les chiffres sont masqués");
  expect(screen.queryByText(/Total :|Part :/)).not.toBeInTheDocument();
});

it("refuse les chiffres lorsqu'aucune preuve d'exécution n'est disponible", async () => {
  render(<CalculSelection run={{ ...run, proof: null }} selection={{ region: ["Nord"] }} fetcher={serveur()} />);
  expect(await screen.findByText(/preuve de l'exécution est absente/)).toBeInTheDocument();
  expect(screen.queryByText(/Total :|Part :/)).not.toBeInTheDocument();
});

it("ne présente pas une part non numérique comme un pourcentage", async () => {
  const share = { ...reponsePart, rows: [{ share: "indéterminée" }] };
  render(<CalculSelection run={run} selection={{ region: ["Nord"] }} fetcher={serveur(derive.body, share)} />);
  expect(await screen.findByText(/la part n'est pas numérique/)).toBeInTheDocument();
});

it("temporise les calculs et abandonne une sélection modifiée avant l'envoi", async () => {
  vi.useFakeTimers();
  try {
    const fetcher = serveur();
    const { rerender, unmount } = render(<CalculSelection run={run} selection={{ region: ["Nord"] }} fetcher={fetcher} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(249); });
    expect(fetcher).not.toHaveBeenCalled();
    rerender(<CalculSelection run={run} selection={{ region: ["Sud"] }} fetcher={fetcher} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(249); });
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toMatchObject({ selection: { region: ["Sud"] } });
    rerender(<CalculSelection run={run} selection={{ region: ["Est"] }} fetcher={fetcher} />);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});


it.each([
  ["12", "12"], ["12.5", "12,5"], ["abc", "abc"],
  ["70.500", "70,50"], ["70.0000", "70,00"], ["-1.2300", "-1,23"],
  ["0.004", "≈ 0,00 (exact : 0,004)"], ["-9.995", "≈ -10,00 (exact : -9,995)"],
  ["9007199254740993.126", "≈ 9007199254740993,13 (exact : 9007199254740993,126)"],
])("formate sans perte %s", (valeur, attendu) => { expect(nombreLisible(valeur)).toBe(attendu); });

it.each([[0, "0 ligne"], [1, "1 ligne"], [2, "2 lignes"]])("accorde %i lignes et présente un total exact", async (count, attendu) => {
  const long = { ...derive.body, row_count: count, rows: [{ revenue: { type: "decimal", value: "12345678901234567890.126" } }] };
  render(<CalculSelection run={run} selection={{ region: ["Nord"] }} fetcher={serveur(long)} />);
  const row = await screen.findByRole("row", { name: /Total :/ });
  expect(row).toHaveTextContent(attendu);
  expect(row).toHaveTextContent("≈ 12345678901234567890,13 (exact : 12345678901234567890,126)");
});
