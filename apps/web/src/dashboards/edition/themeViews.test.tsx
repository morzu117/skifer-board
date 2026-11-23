import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import themeRoute from "../../../../../contracts/themes/routes/lire.json";
import { decodeTheme } from "../../themes/document";
import { useEditor } from "./EditorContext";
import { N, openEditor, ROOT, sampleDraft } from "./testing";

vi.mock("./Palette", () => ({ Palette: () => {
  const editor = useEditor();
  return <button onClick={() => { editor.run({ type: "set_theme", theme: { theme_id: N.text, revision: 1 } }, "thème"); }}>Choisir thème</button>;
} }));
const commit = "a".repeat(40);
const reply = (body: object) => Response.json(body, { headers: { etag: `"${commit}"` } });
function theme(invalid = false) {
  const body = JSON.parse(JSON.stringify(themeRoute.body).replaceAll("<uuid>", N.text).replaceAll("<commit>", commit)) as Record<string, unknown>;
  const source = decodeTheme(body.theme);
  body.theme = { ...source, formats: { ...source.formats, number: "decimal_2" }, chart_defaults: {}, ...(invalid ? { sequential: ["blue", "blue", "blue"] } : {}) };
  return body;
}
function open(body: object) {
  const draft = { ...sampleDraft(), filters: [], layout: { sections: [{ id: N.s1, rows: [{ id: N.r1, columns: [{ id: N.c1, span: 12, children: [{ id: N.kpi, type: "kpi" as const, reference: { analysis_id: N.total, revision: 1 }, presentation: {} }] }] }] }] } };
  return openEditor({ draft, tiles: [{ id: N.kpi, state: "ready" }], overrides: { [`GET ${ROOT}/themes/${N.text}`]: reply(body), [`GET ${ROOT}/themes/${N.text}?revision=1`]: reply(body) } });
}

it("applique le format du thème aux propriétés, au canevas et à l'aperçu", async () => {
  open(theme());
  fireEvent.click(await screen.findByText("Choisir thème"));
  await waitFor(() => { expect(within(screen.getAllByRole("group", { name: "Total" })[0] as HTMLElement).getByText("12,00")).toBeInTheDocument(); });
  fireEvent.click(screen.getByRole("button", { name: "KPI · Total" }));
  expect(screen.getByRole("combobox", { name: /^Format des nombres/ })).toHaveValue("decimal_2");
  expect(screen.getAllByText("Origine : Thème : Clair").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Aperçu lecteur" }));
  const preview = screen.getByRole("region", { name: "Aperçu lecteur" });
  expect(within(preview).getByText("12,00")).toBeInTheDocument();
});

it("écarte les défauts d'un thème refusé lors du repli", async () => {
  open(theme(true));
  fireEvent.click(await screen.findByText("Choisir thème"));
  await screen.findByText("Référence non approuvée pour un dashboard partagé.");
  expect(screen.getByText("Thème en cours de lecture ou indisponible : le thème de repli est affiché.")).toBeInTheDocument();
  const tile = (await screen.findAllByRole("group", { name: "Total" }))[0] as HTMLElement;
  await waitFor(() => { expect(within(tile).getByText("12")).toBeInTheDocument(); });
  expect(within(tile).queryByText("12,00")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "KPI · Total" }));
  expect(screen.queryByText("Origine : Thème : Clair")).not.toBeInTheDocument();
});
