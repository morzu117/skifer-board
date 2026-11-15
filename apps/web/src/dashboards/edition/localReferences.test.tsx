import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import componentRoute from "../../../../../contracts/components/routes/lire.json";
import themeRoute from "../../../../../contracts/themes/routes/lire.json";
import { TOKEN_CATALOG } from "../../themes/catalog";
import { chartThemeOf } from "../../themes/chartTheme";
import { decodeTheme } from "../../themes/document";
import { SKIFER_CLAIR } from "../../charts/theme";
import { analysisBody, ANALYSES, dashboardBody, N, openEditor, ROOT, sampleDraft } from "./testing";
import { ID } from "../testing";
import { useEditor } from "./EditorContext";

vi.mock("./Palette", () => ({ Palette: () => {
  const editor = useEditor();
  return <><button onClick={() => { editor.run({ type: "set_theme", theme: { theme_id: N.text, revision: 1 } }, "thème"); }}>Choisir thème</button><button onClick={() => { editor.run({ type: "insert_component", parent: N.c1, index: 0, component: { component_id: N.text, revision: 1 } }, "composant"); }}>Insérer composant</button></>;
} }));
vi.mock("./Tuile", () => ({ Tuile: ({ theme }: { theme: { series: string } }) => <div data-testid="chart-theme">{theme.series}</div> }));
const commit = "a".repeat(40);
const fixture = (value: unknown) => JSON.parse(JSON.stringify(value).replaceAll("<uuid>", N.text).replaceAll("<commit>", commit)) as Record<string, unknown>;
const reply = (body: object) => Response.json(body, { headers: { etag: `"${commit}"` } });

it("charge le thème choisi localement et l'applique aux tuiles", async () => {
  const body = fixture(themeRoute.body);
  const decoded = decodeTheme(body.theme);
  body.theme = { ...decoded, roles: { ...decoded.roles, marks: { ...decoded.roles.marks, series: "ink" } } };
  const expected = chartThemeOf(decodeTheme(body.theme), TOKEN_CATALOG).series;
  expect(expected).not.toBe(SKIFER_CLAIR.series);
  openEditor({ overrides: { [`GET ${ROOT}/themes/${N.text}`]: reply(body), [`GET ${ROOT}/themes/${N.text}?revision=1`]: reply(body) } });
  fireEvent.click(await screen.findByText("Choisir thème"));
  await waitFor(() => { expect(screen.getAllByTestId("chart-theme")[0]).toHaveTextContent(expected); });
  fireEvent.click(await screen.findByRole("button", { name: /^Visuel ·/ }));
  expect(await screen.findAllByText(`Origine : Thème : ${decoded.name}`)).not.toHaveLength(0);
});

it("soumet le même corps après choix d'un thème différent", async () => {
  const draft = { ...sampleDraft(), filters: [], layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: [{ id: N.visual, type: "analysis" as const, reference: { analysis_id: N.bars, revision: 1 }, presentation: {} }] }] }] }] } };
  const tiles = [{ id: N.visual, state: "ready" as const }];
  const request = (server: ReturnType<typeof openEditor>["server"]) => server.fetcher.mock.calls.find(([url, init]) => url === `${ROOT}/executions` && init?.method === "POST")?.[1]?.body;
  const before = openEditor({ draft, tiles });
  await waitFor(() => { expect(before.server.submitted()).toHaveLength(1); });
  const initial = request(before.server);
  expect(typeof initial).toBe("string");
  before.unmount();
  const body = fixture(themeRoute.body);
  const decoded = decodeTheme(body.theme);
  body.theme = { ...decoded, roles: { ...decoded.roles, marks: { ...decoded.roles.marks, series: "ink" } } };
  let release: ((response: Response) => void) | undefined;
  const delayed = new Promise<Response>((resolve) => { release = resolve; });
  const after = openEditor({ draft, tiles, overrides: { [`GET ${ROOT}/themes/${N.text}`]: reply(body), [`GET ${ROOT}/themes/${N.text}?revision=1`]: reply(body), [`GET ${ROOT}/analyses/${N.bars}/revisions/1`]: () => delayed } });
  fireEvent.click(await screen.findByText("Choisir thème"));
  await waitFor(() => { expect(screen.getByTestId("chart-theme")).toHaveTextContent(chartThemeOf(decodeTheme(body.theme), TOKEN_CATALOG).series); });
  release?.(Response.json(analysisBody(N.bars, ANALYSES[N.bars] as never)));
  await waitFor(() => { expect(after.server.submitted()).toHaveLength(1); });
  expect(request(after.server)).toBe(initial);
});

it("signale un thème résolu dont la palette est invalide", async () => {
  const body = fixture(themeRoute.body);
  body.theme = { ...decodeTheme(body.theme), sequential: ["blue", "blue", "blue"] };
  const { server } = openEditor({ overrides: { [`GET ${ROOT}/themes/${N.text}`]: reply(body), [`GET ${ROOT}/themes/${N.text}?revision=1`]: reply(body) } });
  fireEvent.click(await screen.findByText("Choisir thème"));
  await waitFor(() => { expect(server.fetcher.mock.calls.some(([url]) => url === `${ROOT}/themes/${N.text}?revision=1`)).toBe(true); });
  await waitFor(() => { expect(screen.getByText("Thème en cours de lecture ou indisponible : le thème de repli est affiché.")).toBeInTheDocument(); });
  await waitFor(() => { expect(screen.getAllByTestId("chart-theme")[0]).toHaveTextContent(SKIFER_CLAIR.series); });
});

it("lit et soumet un composant inséré localement", async () => {
  const body = fixture(componentRoute.body);
  body.component = { ...(body.component as object), analysis: { analysis_id: N.bars, revision: 1 } };
  const draft = { ...sampleDraft(), filters: [], layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: [] }] }] }] } };
  const { server } = openEditor({ draft, tiles: [], overrides: { [`GET ${ROOT}/components/${N.text}`]: reply(body), [`GET ${ROOT}/components/${N.text}?revision=1`]: reply(body) } });
  fireEvent.click(await screen.findByText("Insérer composant"));
  await waitFor(() => { expect(server.submitted()).toHaveLength(1); });
});

it("bloque et ne soumet pas un composant local illisible", async () => {
  const draft = { ...sampleDraft(), filters: [], layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: [] }] }] }] } };
  const error = () => Promise.resolve(new Response("panne", { status: 500 }));
  const { server } = openEditor({ draft, tiles: [], overrides: { [`GET ${ROOT}/components/${N.text}`]: error, [`GET ${ROOT}/components/${N.text}?revision=1`]: error } });
  fireEvent.click(await screen.findByText("Insérer composant"));
  await waitFor(() => { expect(server.fetcher.mock.calls.some(([url]) => url === `${ROOT}/components/${N.text}?revision=1`)).toBe(true); });
  expect(await screen.findByText("Composant indisponible : la tuile ne s’exécute pas.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
  expect(server.submitted()).toHaveLength(0);
});

it.each(["lecture", "échec"] as const)("signale le repli pendant %s du thème", async (state) => {
  const pending = () => new Promise<Response>(() => undefined);
  const error = () => Promise.resolve(new Response("panne", { status: 500 }));
  const read = state === "lecture" ? pending : error;
  openEditor({ overrides: { [`GET ${ROOT}/themes/${N.text}`]: read, [`GET ${ROOT}/themes/${N.text}?revision=1`]: read } });
  fireEvent.click(await screen.findByText("Choisir thème"));
  expect(await screen.findByText("Thème en cours de lecture ou indisponible : le thème de repli est affiché.")).toBeInTheDocument();
  expect(screen.getAllByTestId("chart-theme")[0]).toHaveTextContent(SKIFER_CLAIR.series);
  expect(screen.queryByText("Référence non approuvée pour un dashboard partagé.")).not.toBeInTheDocument();
});

it("complète resolved quand le thème inchangé manque dans la réponse du dashboard", async () => {
  const body = fixture(themeRoute.body);
  const decoded = decodeTheme(body.theme);
  body.theme = { ...decoded, roles: { ...decoded.roles, marks: { ...decoded.roles.marks, series: "ink" } } };
  const expected = chartThemeOf(decodeTheme(body.theme), TOKEN_CATALOG).series;
  const draft = { ...sampleDraft(), theme: { theme_id: N.text, revision: 1 } };
  const dashboard = { ...dashboardBody(draft), resolved: { components: {} } };
  openEditor({ draft, overrides: { [`GET ${ROOT}/dashboards/${ID}`]: Response.json(dashboard), [`GET ${ROOT}/themes/${N.text}`]: reply(body), [`GET ${ROOT}/themes/${N.text}?revision=1`]: reply(body) } });
  await waitFor(() => { expect(screen.getAllByTestId("chart-theme")[0]).toHaveTextContent(expected); });
  expect(screen.queryByText("Thème en cours de lecture ou indisponible : le thème de repli est affiché.")).not.toBeInTheDocument();
});
