import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import sombre from "../../../../contracts/themes/fixtures/valid/skifer_ardoise.json";
import { chartOf } from "../charts/testing";
import type { Fetch } from "../spaces/api";
import { decodeTheme } from "./document";
import { defaultThemeDraft } from "./defaultDraft";
import { ApercuTheme } from "./ApercuTheme";
import { EditeurTheme } from "./EditeurTheme";

it("dessine les données embarquées avec le thème et ses formats sans réseau", async () => {
  const fetcher = vi.fn<Fetch>();
  const draft = defaultThemeDraft();
  draft.formats.number = "decimal_2";
  draft.chart_defaults.value = { number_format: "decimal_1" };
  draft.chart_defaults.bars = { legend: "shown", number_format: "integer" };
  const view = render(<EditeurTheme space="finance" initial={draft} fetcher={fetcher} />);
  const preview = screen.getByRole("region", { name: "Aperçu du thème" });
  expect(preview).toHaveClass("sb-theme-skifer-clair");
  expect(within(preview).getByText(/aucune exécution, aucune donnée/)).toBeInTheDocument();
  expect(within(preview).getByText(/ne sont pas encore rendues/)).not.toHaveTextContent("format de date");
  expect(within(preview).getByText(/234,5/)).toBeInTheDocument();
  expect(within(preview).getAllByRole("img")).toHaveLength(3);
  const image = within(preview).getByRole("img", { name: /^Barres de/ });
  const option = chartOf(image).getOption() as { legend: { show: boolean }[]; series: { itemStyle: { color: string } }[] };
  expect(option.legend[0]?.show).toBe(true);
  const initial = option.series[0]?.itemStyle.color;
  await userEvent.selectOptions(screen.getByLabelText("Série"), "ink");
  expect((chartOf(image).getOption() as typeof option).series[0]?.itemStyle.color).not.toBe(initial);
  expect(fetcher).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("link", { name: "Voir l’aperçu".replace("l’", "l'") }));
  expect(preview).toHaveFocus();
  view.unmount();
});

it("n'affiche jamais un aperçu périmé si le thème est invalide", async () => {
  const draft = defaultThemeDraft();
  const view = render(<EditeurTheme space="finance" initial={draft} />);
  await userEvent.clear(screen.getByLabelText("Nom"));
  const preview = screen.getByRole("region", { name: "Aperçu du thème" });
  expect(within(preview).getByText(/Aperçu indisponible/)).toBeInTheDocument();
  expect(within(preview).queryByRole("img")).not.toBeInTheDocument();
  await userEvent.click(within(preview).getByRole("button", { name: "Voir la liste des problèmes" }));
  expect(document.activeElement).toHaveAttribute("id", "theme-problemes");
  view.unmount();
  render(<ApercuTheme document={decodeTheme(sombre)} />);
  expect(screen.getByRole("region", { name: "Aperçu du thème" })).toHaveClass("sb-theme-skifer-ardoise");
});

it.each([["short", "2026-01-15"], ["medium", "15 janv. 2026"], ["long", "15 janvier 2026"], ["iso", "2026-01-15"]] as const)("affiche les dates fictives au format %s", (format, expected) => {
  const draft = defaultThemeDraft();
  draft.formats.date = format;
  render(<ApercuTheme document={draft} />);
  const preview = screen.getByRole("region", { name: "Aperçu du thème" });
  const line = within(preview).getByRole("img", { name: /^Ligne de/ });
  expect(line).toHaveTextContent(expected);
});

it("présente le KPI automatique et conserve le tableau sans export", async () => {
  const user = userEvent.setup();
  render(<ApercuTheme document={defaultThemeDraft()} />);
  const preview = screen.getByRole("region", { name: "Aperçu du thème" });
  expect(preview).toHaveAttribute("tabindex", "0");
  expect(within(preview).getByText("1234.5")).toBeInTheDocument();
  expect(within(preview).queryByRole("button", { name: "Exporter l'image" })).not.toBeInTheDocument();
  const chart = within(preview).getByRole("region", { name: "Barres fictives" });
  await user.click(within(chart).getByRole("tab", { name: "Tableau" }));
  expect(within(chart).getByRole("group", { name: "Valeurs de Barres fictives" })).toBeVisible();
});
