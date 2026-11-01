import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChartCard, type NavigableItem } from "./ChartCard";
import type { TableSpec } from "./DataTable";
import type { ChartOption } from "./echarts";
import { clickItem } from "./testing";

const option: ChartOption = {
  xAxis: { type: "category", data: ["IDF", "ARA", "OCC"] },
  yAxis: { type: "value" },
  series: [{ type: "bar", data: [7, 5, 4] }],
};
const table: TableSpec = { caption: "CA par région", rowKey: "region", columns: [{ key: "region", label: "Région" }], rows: [{ region: "IDF" }] };
const items: NavigableItem[] = [
  { key: "IDF", announcement: "IDF : 7" },
  { key: "ARA", announcement: "ARA : 5" },
  { key: "OCC", announcement: "OCC : 4" },
];

function setup(props: Partial<Parameters<typeof ChartCard>[0]> = {}) {
  const onSelect = vi.fn();
  render(<ChartCard title="CA net par région" description="Histogramme du CA net par région" option={option} table={table} items={items} source="ca-region" dimension="region" onSelect={onSelect} exportBackground="#FFFFFF" {...props} />);
  return { onSelect, group: screen.getByRole("group", { name: "CA net par région" }) };
}

const live = (): HTMLElement => document.querySelector("[aria-live]") as HTMLElement;

describe("ChartCard", () => {
  it("bascule entre graphique et tableau à la souris et au clavier", async () => {
    setup();
    const chartTab = screen.getByRole("tab", { name: "Graphique" });
    expect(chartTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("img", { name: "Histogramme du CA net par région" })).toBeVisible();
    await userEvent.click(screen.getByRole("tab", { name: "Tableau" }));
    expect(screen.getByRole("group", { name: "CA par région" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Exporter l'image" })).toBeDisabled();
    screen.getByRole("tab", { name: "Tableau" }).focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(chartTab).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Tableau" })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Tab}");
    expect(screen.getByRole("tab", { name: "Tableau" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(chartTab);
    expect(chartTab).toHaveAttribute("aria-selected", "true");
  });

  it("parcourt, annonce et sélectionne au clavier", async () => {
    const { onSelect, group } = setup();
    expect(group).toHaveAccessibleDescription(/Entrée ou Espace pour sélectionner/);
    group.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(live()).toHaveTextContent("IDF : 7");
    await userEvent.keyboard("{ArrowDown}{ArrowRight}{ArrowRight}");
    expect(live()).toHaveTextContent("OCC : 4");
    await userEvent.keyboard("{ArrowUp}");
    expect(live()).toHaveTextContent("ARA : 5");
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Home}");
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{End}{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    expect(live()).toHaveTextContent("IDF : 7");
    await userEvent.keyboard("a");
    await userEvent.keyboard("{Escape}");
    expect(live()).toBeEmptyDOMElement();
    expect(onSelect.mock.calls).toEqual([
      [{ type: "toggle", source: "ca-region", dimension: "region", key: "ARA" }],
      [{ type: "toggle", source: "ca-region", dimension: "region", key: "IDF" }],
      [{ type: "clear", source: "ca-region" }],
    ]);
  });

  it("sélectionne au clic sur un élément", () => {
    const { onSelect } = setup();
    clickItem(screen.getByRole("img"), { name: "OCC", dataIndex: 2 });
    expect(onSelect).toHaveBeenCalledWith({ type: "toggle", source: "ca-region", dimension: "region", key: "OCC" });
  });

  it("se parcourt sans se sélectionner quand aucune dimension n'est sélectionnable", async () => {
    const onSelect = vi.fn();
    const { group } = setup({ dimension: undefined, onSelect });
    expect(group).toHaveAccessibleDescription("Flèches pour parcourir les valeurs.");
    group.focus();
    await userEvent.keyboard("{ArrowRight}{Enter}");
    clickItem(screen.getByRole("img"), { name: "OCC", dataIndex: 2 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("tolère l'absence de gestionnaire et d'éléments", async () => {
    const { group } = setup({ onSelect: undefined, items: [] });
    group.focus();
    await userEvent.keyboard("{Enter}{ArrowRight}{Enter}{Escape}");
    expect(live()).toBeEmptyDOMElement();
  });

  it("sélectionne sans gestionnaire sans erreur", async () => {
    const { group } = setup({ onSelect: undefined });
    group.focus();
    await userEvent.keyboard("{ArrowRight}{Enter}");
    expect(live()).toHaveTextContent("IDF : 7");
  });

  it("exporte l'image vectorielle sous le nom de la tuile", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Exporter l'image" }));
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe("CA net par région.svg");
    expect(link.href).toMatch(/^data:image\/svg\+xml/);
    click.mockRestore();
  });

  it("affiche le pied et les actions", () => {
    setup({ footer: <span>Définition Atlas v3</span>, actions: <a href="#analyse">Ouvrir l'analyse</a> });
    expect(screen.getByText("Définition Atlas v3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ouvrir l'analyse" })).toBeInTheDocument();
  });
});
